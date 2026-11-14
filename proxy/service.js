// SPDX-License-Identifier: GPL-3.0-or-later
import { ProxyError, validateTarget, resolvePublicTarget, requestResource, decodeBody, collectBody } from "./network.js";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { errorHtml, rewriteHtml, rewriteCss } from "./rewrite.js";
import { isBlocked } from "./filtering.js";
import { proxyParameters } from "../shared/proxy-url.js";

const requestTypes = new Set(["document", "subdocument", "script", "stylesheet", "image", "font", "media", "object", "xmlhttprequest", "other"]);
const redirects = new Set([301, 302, 303, 307, 308]);
const MAX_REQUEST_BYTES = 1024 * 1024;
const isolatedDocumentPolicy = "sandbox allow-scripts allow-forms allow-downloads; base-uri 'none'";

async function readBody(req) {
  const contentType = req.headers["content-type"] || "";
  const supported = /^(application\/(?:x-www-form-urlencoded|json(?:\+protobuf)?)|text\/plain)(?:;|$)/i.test(contentType);
  let body;
  if (Buffer.isBuffer(req.body)) body = req.body;
  else if (typeof req.body === "string") body = Buffer.from(req.body);
  else if (req.body && typeof req.body === "object") {
    if (!supported) throw new ProxyError(415, "Only URL-encoded, JSON and text POST bodies are supported. Multipart uploads are not supported.");
    if (/^application\/json(?:\+protobuf)?(?:;|$)/i.test(contentType)) body = Buffer.from(JSON.stringify(req.body));
    else {
      const fields = new URLSearchParams();
      for (const [name, value] of Object.entries(req.body)) {
        for (const item of Array.isArray(value) ? value : [value]) fields.append(name, String(item));
      }
      body = Buffer.from(fields.toString());
    }
  } else {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) throw new ProxyError(413, "The POST body exceeds the 1 MB limit.");
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks);
  }
  if (body.length > MAX_REQUEST_BYTES) throw new ProxyError(413, "The POST body exceeds the 1 MB limit.");
  if (body.length && !supported) throw new ProxyError(415, "Only URL-encoded, JSON and text POST bodies are supported. Multipart uploads are not supported.");
  return body;
}

function textBody(body, contentType) {
  const charset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || "utf-8";
  try { return new TextDecoder(charset).decode(body); }
  catch { throw new ProxyError(502, `The page encoding (${charset}) is not supported.`); }
}

function headers(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  res.setHeader("Access-Control-Expose-Headers", "X-Bromine-Adblock, X-Bromine-Cacheable, X-Bromine-Cache, Content-Range, Accept-Ranges, Content-Length");
  res.setHeader("Timing-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Content-Security-Policy", `${isolatedDocumentPolicy}; frame-ancestors 'self'`);
}

export function createProxyHandler({ resolve, send = requestResource, blocked = isBlocked } = {}) {
  return async function handler(req, res) {
    headers(res);
    let requested;
    let adblock = true;
    const disconnected = new AbortController();
    res.once?.("close", () => { if (!res.writableEnded) disconnected.abort(); });
    try {
      if (req.method === "OPTIONS") {
        const requestedHeaders = req.headers["access-control-request-headers"] || "";
        if (requestedHeaders.length > 4096 || requestedHeaders.split(",").some((name) => name.trim() && !/^[!#$%&'*+\-.^_`|~\da-z]+$/i.test(name.trim()))) {
          throw new ProxyError(400, "Invalid CORS request headers.");
        }
        res.setHeader("Access-Control-Allow-Headers", ["Content-Type", "Range", requestedHeaders].filter(Boolean).join(", "));
        res.setHeader("Vary", "Access-Control-Request-Headers");
        res.statusCode = 204;
        return res.end();
      }
      if (!["GET", "HEAD", "POST"].includes(req.method)) {
        res.setHeader("Allow", "GET, HEAD, POST, OPTIONS");
        throw new ProxyError(405, "Only GET, HEAD and POST requests are supported.");
      }
      const query = new URL(req.url, "https://proxy.example").searchParams;
      if (query.getAll("url").length !== 1) throw new ProxyError(400, "Supply exactly one HTTP(S) target using the url parameter.");
      const raw = query.get("url");
      if (raw.length > 8192) throw new ProxyError(414, "The target address is too long.");
      const initial = validateTarget(raw);
      for (const [name, value] of query) if (!proxyParameters.has(name)) initial.searchParams.append(name, value);
      requested = initial.href + new URL(raw).hash;
      adblock = query.get("adblock") !== "0";
      const origin = query.get("origin") ? validateTarget(query.get("origin")).href : initial.href;
      const type = query.get("type") || "document";
      if (!requestTypes.has(type)) throw new ProxyError(400, "Invalid resource type.");
      // An opaque parent frame cannot match 'self'; nested documents remain sandboxed.
      if (type === "subdocument") res.setHeader("Content-Security-Policy", isolatedDocumentPolicy);
      const signal = AbortSignal.any([AbortSignal.timeout(290000), disconnected.signal]);
      let method = req.method;
      let body = method === "POST" ? await readBody(req) : undefined;
      let url = initial;
      let response;
      for (let count = 0; count <= 5; count++) {
        if (adblock && await blocked(url.href, origin, type)) {
          res.setHeader("X-Bromine-Adblock", "blocked");
          res.statusCode = 204;
          return res.end();
        }
        const records = await resolvePublicTarget(url, signal, resolve);
        const outgoingHeaders = {
          accept: req.headers.accept || "*/*",
          "accept-encoding": "identity",
          "user-agent": req.headers["user-agent"] || "Mozilla/5.0 (compatible; BromineHTTPProxy/1.0)",
          "accept-language": req.headers["accept-language"] || "en-US,en;q=0.9",
          referer: new URL(origin).origin + "/",
        };
        if (req.headers.range) {
          if (!/^bytes=(?:\d+-\d*|-\d+)$/.test(req.headers.range)) throw new ProxyError(400, "Only a single valid byte range is supported.");
          outgoingHeaders.range = req.headers.range;
        }
        if (body) {
          if (req.headers["content-type"]) outgoingHeaders["content-type"] = req.headers["content-type"];
          outgoingHeaders["content-length"] = String(body.length);
        }
        response = await send(url, { records, method, body, headers: outgoingHeaders, signal });
        if (!redirects.has(response.status) || !response.headers.location) break;
        response.stream?.destroy();
        if (count === 5) throw new ProxyError(502, "The site redirected too many times.");
        const destination = validateTarget(new URL(response.headers.location, url).href);
        if (method === "POST" && [301, 302, 303].includes(response.status)) { method = "GET"; body = undefined; }
        if (body && destination.origin !== url.origin) throw new ProxyError(502, "A cross-site redirect attempted to forward a POST body.");
        url = destination;
      }
      const contentType = response.headers["content-type"] || "application/octet-stream";
      const rewriting = req.method !== "HEAD" && response.status !== 206 && /^(?:text\/html|application\/xhtml\+xml|text\/css)(?:;|$)/i.test(contentType);
      if (response.headers["content-range"]) res.setHeader("Content-Range", response.headers["content-range"]);
      if (response.headers["accept-ranges"]) res.setHeader("Accept-Ranges", response.headers["accept-ranges"]);
      if (req.method === "GET" && response.status === 200 && !response.headers["set-cookie"] &&
          /(?:public|max-age=|immutable)/i.test(response.headers["cache-control"] || "") &&
          !/private|no-store/i.test(response.headers["cache-control"] || "")) res.setHeader("X-Bromine-Cacheable", "1");
      if (!rewriting) {
        res.setHeader("Content-Type", contentType);
        if (response.headers["content-encoding"]) res.setHeader("Content-Encoding", response.headers["content-encoding"]);
        if (response.headers["content-length"]) res.setHeader("Content-Length", response.headers["content-length"]);
        res.statusCode = response.status;
        if (req.method === "HEAD") { response.stream?.resume(); return res.end(); }
        if (typeof res.write === "function") {
          res.flushHeaders?.();
          return await pipeline(response.stream || Readable.from([response.body]), res);
        }
        return res.end(response.body);
      }
      response.body = await collectBody(response);
      let output = await decodeBody(response);
      if (req.method !== "HEAD" && response.status !== 206 && /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) {
        output = Buffer.from(rewriteHtml(textBody(output, contentType), url.href + new URL(raw).hash, requested, adblock, {
          logging: query.get("logging") === "1", cache: query.get("cache") !== "0",
        }));
        res.setHeader("Content-Type", "text/html; charset=utf-8");
      } else if (req.method !== "HEAD" && response.status !== 206 && /^text\/css(?:;|$)/i.test(contentType)) {
        output = Buffer.from(rewriteCss(textBody(output, contentType), url.href, { adblock, origin, logging: query.get("logging") === "1", cache: query.get("cache") !== "0" }));
        res.setHeader("Content-Type", "text/css; charset=utf-8");
      } else res.setHeader("Content-Type", contentType);
      res.statusCode = response.status;
      if (typeof res.write === "function") {
        res.flushHeaders?.();
        return await pipeline(Readable.from((function* () {
          for (let offset = 0; offset < output.length; offset += 65536) yield output.subarray(offset, offset + 65536);
        })()), res);
      }
      return res.end(output);
    } catch (error) {
      let status = error instanceof ProxyError ? error.status : 502;
      let message = error instanceof ProxyError ? error.message : "The upstream page could not be fetched. It may require cookies, anti-bot verification, or an unsupported browser feature.";
      if (res.headersSent) {
        if (!disconnected.signal.aborted) console.error("HTTP proxy stream failed:", error);
        return res.destroy?.(error);
      }
      if (error.name === "AbortError" || error.name === "TimeoutError") { status = 504; message = "The proxy stream exceeded its execution time limit."; }
      else if (!(error instanceof ProxyError)) console.error("HTTP proxy request failed:", { name: error.name, code: error.code, message: error.message });
      res.statusCode = status;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      const output = requested ? rewriteHtml(errorHtml(message), requested, requested, adblock) : errorHtml(message);
      return res.end(req.method === "HEAD" ? undefined : output);
    }
  };
}
