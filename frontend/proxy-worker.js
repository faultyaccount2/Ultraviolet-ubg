import { resourceUrl } from "../shared/proxy-url.js";
import { proxyRequest } from "../shared/proxy-request.js";
import { applySiteCookie, cookieDomainMatches, cookieMatches, decodeCookieState, encodeCookieState } from "../shared/cookie-jar.js";
import { MemoryCache, MemoryCacheStorage } from "./memory-cache.js";

const config = self.BROMINE_WORKER_CONFIG;
delete self.BROMINE_WORKER_CONFIG;
const resource = (value, type = "xmlhttprequest") => {
  const url = new URL(String(value), config.url);
  if (url.origin === config.proxyOrigin && url.pathname === "/api/proxy" && url.searchParams.has("url")) {
    url.searchParams.set("origin", config.url);
    url.searchParams.set("type", type);
    return url.href;
  }
  return resourceUrl(String(value), config.url, config.proxyOrigin, { ...config, origin: config.url, type });
};
Object.defineProperties(self, {
  caches: { configurable: true, value: new MemoryCacheStorage() },
  Cache: { configurable: true, value: MemoryCache },
  CacheStorage: { configurable: true, value: MemoryCacheStorage },
});
const NativeRequest = self.Request;
self.Request = class extends NativeRequest {
  constructor(input, options) {
    super(typeof input === "string" || input instanceof URL ? resource(input) : input, { ...options, mode: "cors" });
  }
};
const nativeFetch = self.fetch.bind(self);
self.fetch = async (input, options) => {
  const credentials = options?.credentials ?? (input instanceof NativeRequest ? input.credentials : "same-origin");
  const request = await proxyRequest(input, options, resource, NativeRequest);
  const target = new URL(request.url).searchParams.get("url");
  const host = new URL(config.url).hostname;
  const includeSiteCookies = credentials !== "omit" && target && new URL(target).hostname === host;
  const cookies = includeSiteCookies ?
    config.cookies.filter((cookie) => !cookie.httpOnly && cookieMatches(cookie, target, host)) : [];
  const headers = new Headers(request.headers);
  if (includeSiteCookies) headers.set("X-Bromine-Site-Cookies", encodeCookieState(cookies));
  else headers.delete("X-Bromine-Site-Cookies");
  const response = await nativeFetch(request, { headers, credentials: "include" });
  for (const cookie of decodeCookieState(response.headers.get("X-Bromine-Cookie-Changes") || "")) {
    if (cookie.hostOnly ? cookie.domain !== host : !cookieDomainMatches(host, cookie.domain)) continue;
    config.cookies = applySiteCookie(config.cookies, cookie);
  }
  return response;
};
const nativeOpen = XMLHttpRequest.prototype.open;
const xhrTargets = new WeakMap();
XMLHttpRequest.prototype.open = function (method, url, ...args) {
  const proxied = resource(url);
  xhrTargets.set(this, new URL(proxied).searchParams.get("url"));
  return nativeOpen.call(this, method, proxied, ...args);
};
const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
  if (String(name).toLowerCase() === "x-bromine-site-cookies") return;
  return nativeSetRequestHeader.call(this, name, value);
};
const nativeSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (body) {
  const target = xhrTargets.get(this);
  const host = new URL(config.url).hostname;
  const includeSiteCookies = target && new URL(target).hostname === host;
  const cookies = includeSiteCookies ?
    config.cookies.filter((cookie) => !cookie.httpOnly && cookieMatches(cookie, target, host)) : [];
  if (includeSiteCookies) nativeSetRequestHeader.call(this, "X-Bromine-Site-Cookies", encodeCookieState(cookies));
  this.withCredentials = true;
  this.addEventListener("loadend", () => {
    for (const cookie of decodeCookieState(this.getResponseHeader("X-Bromine-Cookie-Changes") || "")) {
      if (cookie.hostOnly ? cookie.domain !== host : !cookieDomainMatches(host, cookie.domain)) continue;
      config.cookies = applySiteCookie(config.cookies, cookie);
    }
  }, { once: true });
  return nativeSend.call(this, body);
};
const nativeImport = self.importScripts.bind(self);
self.importScripts = (...urls) => nativeImport(...urls.map((url) => resource(url, "script")));
self.WebSocket = class extends EventTarget {
  constructor() {
    super();
    throw new DOMException("The relay does not support WebSockets inside workers.", "NotSupportedError");
  }
};
self.importScripts(config.url);
self.postMessage({ type: "bromine:worker-ready" });
