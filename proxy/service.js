// SPDX-License-Identifier: GPL-3.0-or-later
import { ProxyError, validateTarget, resolvePublicTarget, requestResource, decodeBody, collectBody } from "./network.js";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { readFile } from "node:fs/promises";
import setCookieParser from "set-cookie-parser";
import publicSuffixListModule from "@gorhill/ubo-core/lib/publicsuffixlist/publicsuffixlist.js";
import { errorHtml, rewriteHtml, rewriteCss } from "./rewrite.js";
import { isBlocked } from "./filtering.js";
import { proxyParameters } from "../shared/proxy-url.js";
import {
  applySiteCookie, cookieDomainMatches, cookieHeader, cookieMatches, cookiePathMatches, decodeCookieStateStrict,
  decodeSiteCookie, encodeCookieState, normalizeSiteCookie, parseCookieHeader, siteCookieName,
  siteCookiePrefix, MAX_COOKIE_STATE_BYTES, MAX_SITE_COOKIES,
} from "../shared/cookie-jar.js";

const requestTypes = new Set(["document", "subdocument", "script", "stylesheet", "image", "font", "media", "object", "xmlhttprequest", "other", "cookie-sync"]);
const redirects = new Set([301, 302, 303, 307, 308]);
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_FORWARDED_HEADER_BYTES = 16 * 1024;
const MAX_COOKIE_RESPONSE_BYTES = 16 * 1024;
const forwardedHeaderNames = new Set([
  "x-youtube-client-name", "x-youtube-client-version", "x-youtube-bootstrap-logged-in",
  "x-youtube-page-label", "x-youtube-page-cl", "x-youtube-utc-offset", "x-youtube-device",
  "x-youtube-time-zone", "x-youtube-ad-signals",
  "x-goog-api-key", "x-goog-visitor-id", "x-goog-request-time", "x-goog-authuser", "x-goog-pageid",
  "x-origin", "x-client-data", "x-discord-locale", "x-discord-timezone", "x-super-properties",
  "x-fingerprint", "x-context-properties", "x-debug-options",
  "x-msedge-clientid", "x-msedge-ref", "x-mse-clientid", "x-mse-cf",
]);
const isolatedDocumentPolicy = "sandbox allow-scripts allow-forms allow-downloads; base-uri 'none'";
const require = createRequire(import.meta.url);
const publicSuffixListPath = resolvePath(dirname(require.resolve("@gorhill/ubo-core")), "build/publicsuffixlist.json");
let publicSuffixListPromise;

function publicSuffixList() {
  if (!publicSuffixListPromise) {
    publicSuffixListPromise = readFile(publicSuffixListPath, "utf8").then((source) => {
      const selfie = JSON.parse(source);
      const loaded = publicSuffixListModule.fromSelfie({
        magic: selfie.magic,
        buf32: Uint32Array.from(Object.values(selfie.buf32)),
      });
      if (!loaded) throw new Error("The bundled public suffix list could not be initialized.");
      return publicSuffixListModule;
    });
  }
  return publicSuffixListPromise;
}

function validCookieRecord(cookie, requestUrl, originHost, suffixes) {
  if (!cookie || typeof cookie.name !== "string" || typeof cookie.value !== "string" ||
      typeof cookie.domain !== "string" || typeof cookie.path !== "string" ||
      typeof cookie.hostOnly !== "boolean" || typeof cookie.secure !== "boolean" ||
      typeof cookie.httpOnly !== "boolean") return false;
  const url = new URL(requestUrl);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const domain = cookie.domain.toLowerCase().replace(/^\./, "").replace(/\.$/, "");
  const origin = String(originHost).toLowerCase().replace(/\.$/, "");
  if (cookie.domain !== domain || !cookie.path.startsWith("/") ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(domain) || !cookieDomainMatches(host, domain)) return false;
  if (Buffer.byteLength(`${siteCookieName(origin, cookie)}=${encodeCookieState(cookie)}`) > 3800) return false;
  if (cookie.sameSite === "none" && !cookie.secure ||
      cookie.name.startsWith("__Secure-") && !cookie.secure ||
      cookie.name.startsWith("__Host-") && (!cookie.secure || !cookie.hostOnly || cookie.path !== "/")) return false;
  if (cookie.hostOnly ? domain !== host || domain !== origin : !cookieDomainMatches(origin, domain)) return false;
  if (!cookie.hostOnly && suffixes.getPublicSuffix(domain) === domain) return false;
  return !cookie.secure || url.protocol === "https:";
}

function storedSiteCookies(req, host, requestUrl, suffixes) {
  const cookies = [];
  const prefix = siteCookiePrefix(host);
  for (const [name, value] of parseCookieHeader(req.headers.cookie)) {
    if (!name.startsWith(prefix)) continue;
    const cookie = decodeSiteCookie(value);
    if (!cookie || siteCookieName(host, cookie) !== name ||
        !validCookieRecord(cookie, requestUrl, host, suffixes) ||
        cookie.expiresAt !== null && cookie.expiresAt <= Date.now()) continue;
    cookies.push(cookie);
  }
  return cookies.slice(-MAX_SITE_COOKIES);
}

function cookieApplicationHeader(host, cookie, secure) {
  const name = siteCookieName(host, cookie);
  const value = encodeCookieState(cookie);
  const attributes = [`${name}=${value}`, "Path=/api/proxy", "HttpOnly", "SameSite=None"];
  if (secure) attributes.push("Secure");
  if (cookie.expiresAt !== null) {
    const seconds = Math.floor((cookie.expiresAt - Date.now()) / 1000);
    attributes.push(`Max-Age=${Math.max(0, Math.min(seconds, 34560000))}`);
  }
  return attributes.join("; ");
}

function cookieStateHeader(cookies) {
  const value = encodeCookieState(cookies);
  if (Buffer.byteLength(value) > MAX_COOKIE_RESPONSE_BYTES) {
    throw new ProxyError(502, "The site's visible cookie state exceeds the 16 KB response limit.");
  }
  return value;
}

function upstreamCookieHeader(cookies, requestUrl, originHost) {
  try { return cookieHeader(cookies, requestUrl, originHost); }
  catch (error) {
    if (error instanceof TypeError) throw new ProxyError(413, error.message);
    throw error;
  }
}

function appendCookieWrites(res, writes, secure) {
  if (!writes.size) return;
  const values = [...writes.values()].map(({ host, cookie }) => cookieApplicationHeader(host, cookie, secure));
  if (values.reduce((size, value) => size + Buffer.byteLength(value), 0) > MAX_COOKIE_RESPONSE_BYTES) {
    throw new ProxyError(502, "The site's cookie updates exceed the 16 KB response limit.");
  }
  res.setHeader("Set-Cookie", values);
}

async function readBody(req) {
  const contentType = req.headers["content-type"] || "";
  const supported = /^(application\/(?:x-www-form-urlencoded|json(?:\+protobuf)?|xml)|text\/(?:plain|xml))(?:;|$)/i.test(contentType);
  const structured = /^application\/(?:x-www-form-urlencoded|json(?:\+protobuf)?)(?:;|$)/i.test(contentType);
  // Vercel's lazy body getter parses compressed JSON before we can forward it.
  const suppliedBody = Object.getOwnPropertyDescriptor(req, "body")?.value;
  let body;
  if (Buffer.isBuffer(suppliedBody)) body = suppliedBody;
  else if (typeof suppliedBody === "string") body = Buffer.from(suppliedBody);
  else if (suppliedBody && typeof suppliedBody === "object") {
    if (!structured) throw new ProxyError(415, "Only URL-encoded and JSON object bodies are supported. Multipart uploads are not supported.");
    if (/^application\/json(?:\+protobuf)?(?:;|$)/i.test(contentType)) body = Buffer.from(JSON.stringify(suppliedBody));
    else {
      const fields = new URLSearchParams();
      for (const [name, value] of Object.entries(suppliedBody)) {
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
  if (body.length && !supported) throw new ProxyError(415, "Only URL-encoded, JSON, XML and text POST bodies are supported. Multipart uploads are not supported.");
  return body;
}

function textBody(body, contentType) {
  const charset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || "utf-8";
  try { return new TextDecoder(charset).decode(body); }
  catch { throw new ProxyError(502, `The page encoding (${charset}) is not supported.`); }
}

function headers(res, req) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  const origin = req.headers.origin;
  const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProtocol === "https" ? "https" : "http";
  const applicationOrigin = req.headers.host ? `${protocol}://${req.headers.host}` : "";
  const credentialedOrigin = origin === "null" || origin === applicationOrigin;
  res.setHeader("Access-Control-Allow-Origin", credentialedOrigin ? origin : "*");
  if (credentialedOrigin) res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range, X-Bromine-Site-Cookies");
  res.setHeader("Access-Control-Expose-Headers", "X-Bromine-Adblock, X-Bromine-Cacheable, X-Bromine-Cache, X-Bromine-Cookie-Changes, Content-Range, Accept-Ranges, Content-Length");
  res.setHeader("Timing-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Content-Security-Policy", `${isolatedDocumentPolicy}; frame-ancestors 'self'`);
}

function cookieWritesFromRecords(records, host, requestUrl, suffixes, existing) {
  const writes = new Map();
  const cookies = existing.slice();
  for (const cookie of records) {
    if (cookie.httpOnly || !validCookieRecord(cookie, requestUrl, host, suffixes)) {
      throw new ProxyError(400, "The proxied page supplied an invalid or inaccessible cookie.");
    }
    const name = siteCookieName(host, cookie);
    if (existing.some((item) => item.httpOnly && siteCookieName(host, item) === name)) continue;
    const next = applySiteCookie(cookies, cookie);
    cookies.splice(0, cookies.length, ...next);
    writes.set(name, { host, cookie });
  }
  return { cookies, writes };
}

function isApplicationOrigin(req) {
  const origin = req.headers.origin;
  const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProtocol === "https" ? "https" : "http";
  return Boolean(req.headers.host && origin === `${protocol}://${req.headers.host}`);
}

function clientCookieRecords(req) {
  const value = req.headers["x-bromine-site-cookies"];
  if (value === undefined) return null;
  if (typeof value !== "string" || Buffer.byteLength(value) > MAX_COOKIE_STATE_BYTES) {
    throw new ProxyError(413, "The cookie update exceeds the 16 KB limit.");
  }
  const cookies = decodeCookieStateStrict(value);
  if (!cookies) throw new ProxyError(400, "The cookie update is malformed.");
  return cookies;
}

export function createProxyHandler({ resolve, send = requestResource, blocked = isBlocked } = {}) {
  return async function handler(req, res) {
    headers(res, req);
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
      const originUrl = query.get("origin") ? validateTarget(query.get("origin")) : initial;
      const origin = originUrl.href;
      const originHost = originUrl.hostname.toLowerCase().replace(/\.$/, "");
      const type = query.get("type") || "document";
      if (!requestTypes.has(type)) throw new ProxyError(400, "Invalid resource type.");
      const suffixes = await publicSuffixList();
      const secureApplicationCookie = true;
      const pendingCookieWrites = new Map();
      let siteCookies = [];
      if (type === "cookie-sync") {
        if (req.method !== "POST" || !isApplicationOrigin(req) || initial.hostname !== originHost) {
          throw new ProxyError(403, "Cookie updates must come from the browser application for the matching site.");
        }
        const records = clientCookieRecords(req);
        if (!records || records.length === 0) throw new ProxyError(400, "No site cookie updates were supplied.");
        siteCookies = storedSiteCookies(req, originHost, initial.href, suffixes);
        const result = cookieWritesFromRecords(records, originHost, initial.href, suffixes, siteCookies);
        for (const [name, value] of result.writes) pendingCookieWrites.set(name, value);
        appendCookieWrites(res, pendingCookieWrites, secureApplicationCookie);
        res.statusCode = 204;
        return res.end();
      }
      const isDocumentNavigation = req.headers["sec-fetch-mode"] === "navigate" &&
        ["document", "iframe"].includes(req.headers["sec-fetch-dest"]);
      if (isDocumentNavigation && ["document", "subdocument"].includes(type) && initial.hostname === originHost) {
        siteCookies = storedSiteCookies(req, originHost, initial.href, suffixes);
      }
      const clientCookies = type === "xmlhttprequest" ? clientCookieRecords(req) : null;
      if (clientCookies && (initial.hostname !== originHost || initial.hostname !== new URL(origin).hostname)) {
        throw new ProxyError(403, "Site cookies cannot be sent to a different host.");
      }
      const acceptUpstreamCookies = isDocumentNavigation && ["document", "subdocument"].includes(type) ||
        type === "xmlhttprequest" && clientCookies !== null;
      // An opaque parent frame cannot match 'self'; nested documents remain sandboxed.
      if (type === "subdocument") res.setHeader("Content-Security-Policy", isolatedDocumentPolicy);
      const signal = AbortSignal.any([AbortSignal.timeout(290000), disconnected.signal]);
      let method = req.method;
      let body = method === "POST" ? await readBody(req) : undefined;
      let url = initial;
      let response;
      const cookieChanges = [];
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
        if (method !== "GET" || type === "xmlhttprequest") outgoingHeaders.origin = new URL(origin).origin;
        let forwardedHeaderBytes = 0;
        for (const [name, value] of Object.entries(req.headers)) {
          if (!forwardedHeaderNames.has(name) || typeof value !== "string") continue;
          const bytes = Buffer.byteLength(name) + Buffer.byteLength(value);
          if (bytes > 8192 || forwardedHeaderBytes + bytes > MAX_FORWARDED_HEADER_BYTES) continue;
          outgoingHeaders[name] = value;
          forwardedHeaderBytes += bytes;
        }
        if (clientCookies && type === "xmlhttprequest" && url.hostname === originHost) {
          siteCookies = storedSiteCookies(req, originHost, url.href, suffixes);
          const protectedCookies = new Set(siteCookies
            .filter((cookie) => cookie.httpOnly && cookieMatches(cookie, url.href, originHost))
            .map((cookie) => siteCookieName(originHost, cookie)));
          for (const cookie of clientCookies) {
            if (cookie.httpOnly || !validCookieRecord(cookie, url.href, originHost, suffixes) ||
                !cookieMatches(cookie, url.href, originHost) &&
                !(cookie.expiresAt !== null && cookie.expiresAt <= Date.now())) {
              throw new ProxyError(400, "The proxied page supplied an invalid or out-of-scope cookie.");
            }
          }
          for (const cookie of clientCookies) {
            if (protectedCookies.has(siteCookieName(originHost, cookie))) continue;
            siteCookies = applySiteCookie(siteCookies, cookie);
          }
          outgoingHeaders.cookie = upstreamCookieHeader(siteCookies, url.href, originHost);
        } else if (isDocumentNavigation && ["document", "subdocument"].includes(type) &&
            url.hostname === originHost) {
          outgoingHeaders.cookie = upstreamCookieHeader(siteCookies, url.href, originHost);
        }
        if (req.headers.range) {
          if (!/^bytes=(?:\d+-\d*|-\d+)$/.test(req.headers.range)) throw new ProxyError(400, "Only a single valid byte range is supported.");
          outgoingHeaders.range = req.headers.range;
        }
        if (body) {
          if (req.headers["content-type"]) outgoingHeaders["content-type"] = req.headers["content-type"];
          if (req.headers["content-encoding"]) {
            const encoding = String(req.headers["content-encoding"]).toLowerCase();
            if (!["identity", "gzip", "deflate", "br"].includes(encoding)) {
              throw new ProxyError(415, "The POST body uses an unsupported content encoding.");
            }
            outgoingHeaders["content-encoding"] = encoding;
          }
          outgoingHeaders["content-length"] = String(body.length);
        }
        response = await send(url, { records, method, body, headers: outgoingHeaders, signal });
        const setCookieHeader = response.headers["set-cookie"];
        const setCookieLines = Array.isArray(setCookieHeader) ?
          setCookieHeader.flatMap((value) => setCookieParser.splitCookiesString(value)) :
          setCookieParser.splitCookiesString(setCookieHeader || "");
        if (acceptUpstreamCookies && url.hostname === originHost && setCookieLines.length > 0) {
          if (setCookieLines.length > MAX_SITE_COOKIES) throw new ProxyError(502, "The site sent too many cookie updates.");
          for (const line of setCookieLines) {
            const cookie = normalizeSiteCookie(line, url.href);
            if (!cookie || !validCookieRecord(cookie, url.href, originHost, suffixes)) continue;
            const name = siteCookieName(originHost, cookie);
            const previous = siteCookies.find((item) => siteCookieName(originHost, item) === name);
            siteCookies = applySiteCookie(siteCookies, cookie);
            pendingCookieWrites.set(name, { host: originHost, cookie });
            if (!cookie.httpOnly) cookieChanges.push(cookie);
            else if (previous && !previous.httpOnly) cookieChanges.push({ ...previous, value: "", expiresAt: Date.now() });
          }
        }
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
      const visibleCookieChanges = cookieChanges.filter((cookie) => !cookie.httpOnly &&
        validCookieRecord(cookie, originUrl.href, originHost, suffixes) && cookiePathMatches(cookie, originUrl.href));
      if (visibleCookieChanges.length > 0 && type === "xmlhttprequest" && clientCookies !== null) {
        res.setHeader("X-Bromine-Cookie-Changes", cookieStateHeader(visibleCookieChanges));
      }
      if (response.headers["content-range"]) res.setHeader("Content-Range", response.headers["content-range"]);
      appendCookieWrites(res, pendingCookieWrites, secureApplicationCookie);
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
          cookieState: isDocumentNavigation && url.hostname === originHost ?
            cookieStateHeader(siteCookies.filter((cookie) => !cookie.httpOnly && cookieMatches(cookie, url.href, originHost))) : "",
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
