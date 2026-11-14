import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { promisify } from "node:util";
import { gunzip, inflate, brotliDecompress } from "node:zlib";
import { isPublicAddress, validateNavigation } from "../shared/address.js";
export { isPublicAddress } from "../shared/address.js";

export const MAX_REWRITE_BYTES = 64 * 1024 * 1024;
export class ProxyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function validateTarget(value) {
  let url;
  try { url = validateNavigation(value); }
  catch (error) { throw new ProxyError(/Private|ports/.test(error.message) ? 403 : 400, error.message); }
  url.hash = "";
  return url;
}

export async function resolvePublicTarget(url, signal, resolve = lookup) {
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(host)) return [{ address: host, family: isIP(host) }];
  const records = await new Promise((fulfill, reject) => {
    signal.throwIfAborted();
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    resolve(host, { all: true, verbatim: true }).then(fulfill, reject).finally(() => signal.removeEventListener("abort", abort));
  });
  if (!records.length || records.some(({ address }) => !isPublicAddress(address))) {
    throw new ProxyError(403, "The destination resolves to a private or reserved address.");
  }
  return records;
}

export function pinnedLookup(records) {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, records);
    else callback(null, records[0].address, records[0].family);
  };
}

export function requestResource(url, { records, method, body, headers, signal }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    // The socket uses only the validated addresses; TLS still verifies the URL hostname.
    const request = transport.request(url, {
      method, headers, signal, agent: false, lookup: pinnedLookup(records),
      maxHeaderSize: 64 * 1024,
    }, (response) => {
      resolve({ status: response.statusCode, headers: response.headers, stream: response });
    });
    request.on("error", reject);
    if (body?.length) request.write(body);
    request.end();
  });
}

export async function decodeBody(response) {
  const encoding = response.headers["content-encoding"]?.toLowerCase();
  if (!encoding || encoding === "identity") return response.body;
  const decoders = { gzip: gunzip, deflate: inflate, br: brotliDecompress };
  if (!decoders[encoding]) throw new ProxyError(502, "The upstream response uses an unsupported compression format.");
  return promisify(decoders[encoding])(response.body, { maxOutputLength: MAX_REWRITE_BYTES });
}

export async function collectBody(response) {
  if (response.body) return response.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of response.stream) {
    size += chunk.length;
    if (size > MAX_REWRITE_BYTES) throw new ProxyError(413, "This HTML/CSS document is too large to safely rewrite. Binary downloads and media are streamed without this document-processing limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
