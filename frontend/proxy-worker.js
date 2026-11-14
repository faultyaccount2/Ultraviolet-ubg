import { resourceUrl } from "../shared/proxy-url.js";
import { MemoryCache, MemoryCacheStorage } from "./memory-cache.js";

const config = self.BROMINE_WORKER_CONFIG;
delete self.BROMINE_WORKER_CONFIG;
const resource = (value, type = "xmlhttprequest") => resourceUrl(String(value), config.url, config.proxyOrigin, { ...config, type });
Object.defineProperties(self, {
  caches: { configurable: true, value: new MemoryCacheStorage() },
  Cache: { configurable: true, value: MemoryCache },
  CacheStorage: { configurable: true, value: MemoryCacheStorage },
});
const NativeRequest = self.Request;
self.Request = class extends NativeRequest {
  constructor(input, options) {
    super(typeof input === "string" || input instanceof URL ? resource(input) : input, { ...options, mode: "cors", credentials: "omit" });
  }
};
const nativeFetch = self.fetch.bind(self);
self.fetch = (input, options) => {
  const request = input instanceof NativeRequest ? new NativeRequest(resource(input.url), input) : resource(input);
  return nativeFetch(request, { ...options, mode: "cors", credentials: "omit" });
};
const nativeOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...args) { return nativeOpen.call(this, method, resource(url), ...args); };
const nativeSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (body) { this.withCredentials = false; return nativeSend.call(this, body); };
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
