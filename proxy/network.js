import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { promisify } from "node:util";
import { gunzip, inflate, brotliDecompress } from "node:zlib";
import { isPublicAddress, validateNavigation } from "../shared/address.js";
export { isPublicAddress } from "../shared/address.js";

export const MAX_REWRITE_BYTES = 64 * 1024 * 1024;
const retryableDnsErrors = new Set(["EBUSY", "EAI_AGAIN", "ETIMEOUT", "ETIMEDOUT", "ESERVFAIL"]);
const retryableTransportErrors = new Set(["ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT"]);
const poolOptions = { keepAlive: true, maxSockets: 32, maxTotalSockets: 128, maxFreeSockets: 4, timeout: 5000 };
const agents = { "http:": new http.Agent(poolOptions), "https:": new https.Agent(poolOptions) };
for (const agent of Object.values(agents)) {
  const getName = agent.getName;
  agent.getName = function (options) {
    // A changed DNS answer must never reuse a socket pinned to an older answer.
    return `${getName.call(this, options)}:${options.bromineAddressKey}`;
  };
}

function waitForRetry(signal, delay) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

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
  let records;
  for (let attempt = 0;; attempt++) {
    try {
      records = await new Promise((fulfill, reject) => {
        signal.throwIfAborted();
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        resolve(host, { all: true, verbatim: true }).then(fulfill, reject).finally(() => signal.removeEventListener("abort", abort));
      });
      break;
    } catch (error) {
      if (attempt === 2 || !retryableDnsErrors.has(error.code)) throw error;
      await waitForRetry(signal, 25 * (attempt + 1));
    }
  }
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
  const reusable = ["GET", "HEAD"].includes(method) &&
    !Object.keys(headers).some((name) => /^(?:authorization|cookie)$/i.test(name));
  const bromineAddressKey = records.map(({ address, family }) => `${family}:${address}`).sort().join(",");
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    let attempts = 0;
    const send = () => {
      if (signal.aborted) { reject(signal.reason); return; }
      // The socket uses only the validated addresses; TLS still verifies the URL hostname.
      const request = transport.request(url, {
        method, headers, signal, agent: reusable ? agents[url.protocol] : false,
        bromineAddressKey, lookup: pinnedLookup(records), timeout: 0,
        maxHeaderSize: 64 * 1024,
      }, (response) => {
        resolve({ status: response.statusCode, headers: response.headers, stream: response });
      });
      request.on("error", (error) => {
        if (attempts === 0 && ["GET", "HEAD"].includes(method) && retryableTransportErrors.has(error.code)) {
          attempts++;
          waitForRetry(signal, 25).then(send, reject);
          return;
        }
        reject(error);
      });
      if (body?.length) request.write(body);
      request.end();
    };
    send();
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
