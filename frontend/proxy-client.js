import { proxyUrl, unproxyUrl, resourceUrl } from "../shared/proxy-url.js";
import { redactUrl } from "../shared/address.js";
import valueParser from "postcss-value-parser";
import { MemoryCache, MemoryCacheStorage } from "./memory-cache.js";

const script = document.currentScript;
const target = script.dataset.target;
let base = script.dataset.base || target;
let pageUrl = target;
const requestUrl = script.dataset.request;
const adblock = script.dataset.adblock !== "0";
const logging = script.dataset.logging === "1";
const cache = script.dataset.cache !== "0";
const proxyOrigin = new URL(location.href).origin;
const send = (data, transfer = []) => { if (parent !== window) parent.postMessage(data, "*", transfer); };

function resource(value, type = "xmlhttprequest") {
  return resourceUrl(value, base, proxyOrigin, { adblock, origin: target, type, logging, cache });
}
function originalUrl(value) {
  return unproxyUrl(resource(value), proxyOrigin);
}

function memoryStorage() {
  const values = new Map();
  const methods = Object.create(null);
  Object.defineProperties(methods, {
    getItem: { value: (key) => values.get(String(key)) ?? null },
    setItem: { value: (key, value) => { values.set(String(key), String(value)); } },
    removeItem: { value: (key) => { values.delete(String(key)); } },
    clear: { value: () => values.clear() },
    key: { value: (index) => [...values.keys()][index] ?? null },
    length: { get: () => values.size, configurable: true },
  });
  return new Proxy(methods, {
    get: (object, name) => name in object ? Reflect.get(object, name) : values.get(String(name)),
    set: (_object, name, value) => { values.set(String(name), String(value)); return true; },
  });
}
Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage() });
Object.defineProperty(window, "sessionStorage", { configurable: true, value: memoryStorage() });
Object.defineProperties(window, {
  caches: { configurable: true, value: new MemoryCacheStorage() },
  Cache: { configurable: true, value: MemoryCache },
  CacheStorage: { configurable: true, value: MemoryCacheStorage },
});
const cookies = new Map();
Object.defineProperty(document, "cookie", {
  configurable: true,
  get: () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
  set: (raw) => {
    const pair = String(raw).split(";")[0];
    const split = pair.indexOf("=");
    if (split > 0) cookies.set(pair.slice(0, split).trim(), pair.slice(split + 1));
  },
});

function cssResources(value) {
  const parsed = valueParser(value);
  parsed.walk((node) => {
    if (node.type !== "function" || node.value.toLowerCase() !== "url") return;
    const raw = node.nodes.length === 1 && node.nodes[0].type === "string" ? node.nodes[0].value : valueParser.stringify(node.nodes).trim();
    if (raw.startsWith("#")) return;
    node.nodes = [{ type: "string", quote: '"', value: resource(raw, "image") }];
    return false;
  });
  return parsed.toString();
}
const nativeSetAttribute = Element.prototype.setAttribute;
const contentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
const blankWindows = new WeakMap();
Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
  ...contentWindow,
  get() {
    const child = contentWindow.get.call(this);
    if (!child || this.getAttribute("src") !== "about:blank") return child;
    if (!blankWindows.has(child)) {
      const frame = this;
      blankWindows.set(child, new Proxy(Object.create(null), {
        get(_object, name) {
          // Sandbox descendants cannot lend native History methods; lend only our own.
          if (name === "history" && frame.getAttribute("src") === "about:blank") return window.history;
          const value = Reflect.get(child, name, child);
          return typeof value === "function" ? value.bind(child) : value;
        },
      }));
    }
    return blankWindows.get(child);
  },
});
for (const name of ["pushState", "replaceState"]) {
  const native = History.prototype[name];
  History.prototype[name] = function (state, unused, url) {
    if (this !== window.history || url == null || url === "") return native.call(this, state, unused, url);
    const destination = new URL(originalUrl(String(url)), pageUrl);
    if (destination.origin !== new URL(pageUrl).origin) throw new DOMException("History cannot change the site's origin.", "SecurityError");
    const result = native.call(this, state, unused, resource(destination.href, "document"));
    if (base === pageUrl) base = destination.href;
    pageUrl = destination.href;
    send({ type: "bromine:history", requestUrl, url: pageUrl, replace: name === "replaceState" });
    return result;
  };
}
function attributeValue(element, name, value) {
  name = name.toLowerCase();
  const tag = element.tagName.toLowerCase();
  if (name === "style") return cssResources(value);
  if (["srcset", "imagesrcset"].includes(name) && !value.includes("data:")) return value.split(",").map((candidate) => {
    const [url, ...descriptor] = candidate.trim().split(/\s+/);
    return [resource(url, "image"), ...descriptor].join(" ");
  }).join(", ");
  const types = { img: "image", script: "script", link: "stylesheet", iframe: "subdocument", video: "media", audio: "media", source: "media", a: "document", area: "document" };
  if (["src", "href", "poster", "background"].includes(name) && !value.trim().startsWith("#")) return resource(value, types[tag] || "other");
  return value;
}
Element.prototype.setAttribute = function (name, value) {
  return nativeSetAttribute.call(this, name, attributeValue(this, name, String(value)));
};
for (const [constructor, property] of [
  [HTMLImageElement, "src"], [HTMLImageElement, "srcset"], [HTMLScriptElement, "src"],
  [HTMLLinkElement, "href"], [HTMLIFrameElement, "src"], [HTMLMediaElement, "src"],
  [HTMLSourceElement, "src"], [HTMLSourceElement, "srcset"], [HTMLAnchorElement, "href"],
]) {
  const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, property);
  if (!descriptor?.set) continue;
  Object.defineProperty(constructor.prototype, property, {
    ...descriptor,
    set(value) { descriptor.set.call(this, attributeValue(this, property, String(value))); },
  });
}
const innerHTML = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
function htmlResources(source) {
  const template = document.createElement("template");
  innerHTML.set.call(template, source);
  for (const element of template.content.querySelectorAll("*")) {
    for (const attr of [...element.attributes]) nativeSetAttribute.call(element, attr.name, attributeValue(element, attr.name, attr.value));
    if (element.tagName === "STYLE") element.textContent = cssResources(element.textContent);
  }
  return innerHTML.get.call(template);
}
Object.defineProperty(Element.prototype, "innerHTML", { ...innerHTML, set(value) { innerHTML.set.call(this, htmlResources(String(value))); } });
const adjacentHTML = Element.prototype.insertAdjacentHTML;
Element.prototype.insertAdjacentHTML = function (position, source) { return adjacentHTML.call(this, position, htmlResources(String(source))); };
const setStyleProperty = CSSStyleDeclaration.prototype.setProperty;
CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) { return setStyleProperty.call(this, name, cssResources(String(value)), priority); };
for (const property of ["background", "backgroundImage", "listStyleImage", "cssText"]) {
  const descriptor = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, property);
  if (descriptor?.set) Object.defineProperty(CSSStyleDeclaration.prototype, property, { ...descriptor, set(value) { descriptor.set.call(this, cssResources(String(value))); } });
}
const insertRule = CSSStyleSheet.prototype.insertRule;
CSSStyleSheet.prototype.insertRule = function (rule, index) { return insertRule.call(this, cssResources(String(rule)), index); };
const NativeRequest = window.Request;
window.Request = class extends NativeRequest {
  constructor(input, options) { super(typeof input === "string" || input instanceof URL ? resource(String(input)) : input, { ...options, mode: "cors", credentials: "omit" }); }
};

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, options) => {
  const raw = input instanceof NativeRequest ? input.url : String(input);
  const start = performance.now();
  const response = input instanceof NativeRequest ? await nativeFetch(new NativeRequest(resource(input.url), input), { ...options, mode: "cors", credentials: "omit" }) :
    await nativeFetch(resource(raw), { ...options, mode: "cors", credentials: "omit" });
  if (logging) send({ type: "bromine:request", url: redactUrl(originalUrl(raw)),
    method: options?.method || (input instanceof NativeRequest ? input.method : "GET"), status: response.status, resourceType: "xmlhttprequest",
    duration: performance.now() - start, size: Number(response.headers.get("content-length")) || null,
    blocked: response.headers.get("X-Bromine-Adblock") === "blocked", cache: response.headers.get("X-Bromine-Cache"), filterKnown: true });
  return response;
};
const nativeOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...args) {
  return nativeOpen.call(this, method, resource(String(url)), ...args);
};
const nativeSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (body) {
  if (this.withCredentials) this.withCredentials = false;
  return nativeSend.call(this, body);
};
const NativeWorker = window.Worker;
window.Worker = class ProxyWorker extends NativeWorker {
  constructor(value, options = {}) {
    const url = originalUrl(String(value));
    if (!/^https?:/.test(url)) {
      super(value, options);
      return;
    }
    if (options.type === "module") throw new DOMException("Module workers are not supported by this proxy.", "NotSupportedError");
    const config = { url, proxyOrigin, adblock, origin: target, logging, cache };
    const blob = new Blob([`self.BROMINE_WORKER_CONFIG=${JSON.stringify(config)};`, globalThis.BROMINE_WORKER_SOURCE], { type: "text/javascript" });
    const bootstrap = URL.createObjectURL(blob);
    try { super(bootstrap, options); }
    catch (error) { URL.revokeObjectURL(bootstrap); throw error; }
    this.bootstrap = bootstrap;
    const ready = (event) => {
      if (event.data?.type !== "bromine:worker-ready") return;
      event.stopImmediatePropagation();
      this.removeEventListener("message", ready, true);
      this.release();
    };
    this.addEventListener("message", ready, true);
    this.addEventListener("error", () => this.release(), { once: true });
  }
  release() {
    if (this.bootstrap) URL.revokeObjectURL(this.bootstrap);
    this.bootstrap = null;
  }
  terminate() { this.release(); return super.terminate(); }
};
const NativeWebSocket = window.WebSocket;
window.WebSocket = class ProxyWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(value, protocols = []) {
    super();
    const url = new URL(String(value), base);
    if (!["ws:", "wss:"].includes(url.protocol)) throw new DOMException("The WebSocket URL must use ws or wss.", "SyntaxError");
    this.url = url.href;
    this.readyState = ProxyWebSocket.CONNECTING;
    this.extensions = "";
    this._binaryType = "blob";
    this.protocol = "";
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.port = null;
    if (parent === window) {
      this.native = new NativeWebSocket(this.url, protocols);
      for (const name of ["open", "message", "error", "close"]) this.native.addEventListener(name, (event) => {
        this.readyState = this.native.readyState;
        this.protocol = this.native.protocol;
        this.dispatch(name, event);
      });
      return;
    }
    const requestedProtocols = typeof protocols === "string" ? [protocols] : [...protocols];
    if (requestedProtocols.length > 20 || new Set(requestedProtocols).size !== requestedProtocols.length ||
        requestedProtocols.some((protocol) => !/^[!#$%&'*+\-.^_`|~\da-z]+$/i.test(protocol))) {
      throw new DOMException("The WebSocket protocols are invalid.", "SyntaxError");
    }
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = ({ data }) => this.receive(data);
    this.port.start();
    send({ type: "bromine:websocket", url: this.url, protocols: requestedProtocols }, [channel.port2]);
  }
  dispatch(type, event) {
    this.dispatchEvent(event);
    this[`on${type}`]?.call(this, event);
  }
  get bufferedAmount() { return this.native?.bufferedAmount || 0; }
  get binaryType() { return this.native?.binaryType || this._binaryType; }
  set binaryType(value) {
    if (!["blob", "arraybuffer"].includes(value)) throw new DOMException("Invalid binaryType value.", "SyntaxError");
    this._binaryType = value;
    if (this.native) this.native.binaryType = value;
  }
  receive(message) {
    if (message?.type === "open") {
      this.protocol = message.protocol;
      this.readyState = ProxyWebSocket.OPEN;
      this.dispatch("open", new Event("open"));
    } else if (message?.type === "message") {
      let data = message.data;
      if (data instanceof ArrayBuffer && this.binaryType === "blob") data = new Blob([data]);
      this.dispatch("message", new MessageEvent("message", { data, origin: new URL(this.url).origin }));
    } else if (message?.type === "error") {
      this.dispatch("error", new Event("error"));
    } else if (message?.type === "close") {
      this.readyState = ProxyWebSocket.CLOSED;
      this.port?.close();
      this.dispatch("close", new CloseEvent("close", { code: message.code || 1006, reason: message.reason || "", wasClean: message.code === 1000 }));
    }
  }
  send(data) {
    if (this.readyState !== ProxyWebSocket.OPEN) throw new DOMException("The WebSocket is not open.", "InvalidStateError");
    if (this.native) return this.native.send(data);
    this.port.postMessage({ type: "send", data });
  }
  close(code = 1000, reason = "") {
    if (this.readyState >= ProxyWebSocket.CLOSING) return;
    this.readyState = ProxyWebSocket.CLOSING;
    if (this.native) return this.native.close(code, reason);
    this.port.postMessage({ type: "close", code, reason: String(reason).slice(0, 120) });
  }
};
window.WebSocket.CONNECTING = 0;
window.WebSocket.OPEN = 1;
window.WebSocket.CLOSING = 2;
window.WebSocket.CLOSED = 3;
document.addEventListener("click", (event) => {
  const anchor = event.target.closest?.("a[href]");
  if (!anchor || event.defaultPrevented || event.button !== 0 || anchor.hasAttribute("download")) return;
  const raw = anchor.getAttribute("href");
  if (raw.startsWith("#")) return;
  const destination = originalUrl(raw);
  const url = new URL(destination);
  if (!["http:", "https:"].includes(url.protocol)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (parent === window) location.href = proxyOrigin + proxyUrl(destination, { adblock });
  else send({ type: "bromine:navigate", url: destination, newTab: event.ctrlKey || event.metaKey || anchor.target === "_blank" });
}, true);
window.open = (url) => {
  if (!url) return null;
  const destination = originalUrl(String(url));
  if (parent === window) location.href = resource(destination, "document");
  else send({ type: "bromine:navigate", url: destination, newTab: true });
  return null;
};
function routeForm(form, submitter) {
  const action = submitter?.hasAttribute("formaction") ? submitter.getAttribute("formaction") : form.getAttribute("action");
  const url = new URL(originalUrl(action || target));
  const method = (submitter?.hasAttribute("formmethod") ? submitter.formMethod : form.method).toLowerCase();
  if (method === "dialog") return false;
  if (method === "get") {
    url.search = new URLSearchParams(new FormData(form, submitter)).toString();
    if (parent === window) location.href = proxyOrigin + proxyUrl(url.href, { adblock, logging, cache });
    else send({ type: "bromine:navigate", url: url.href });
    return true;
  }
  form.action = proxyOrigin + proxyUrl(url.href, { adblock, origin: target, type: "document", logging, cache });
  send({ type: "bromine:form", url: url.href });
  return false;
}
document.addEventListener("submit", (event) => {
  if (event.target instanceof HTMLFormElement && !event.defaultPrevented && routeForm(event.target, event.submitter)) event.preventDefault();
});
const nativeSubmit = HTMLFormElement.prototype.submit;
HTMLFormElement.prototype.submit = function () {
  if (!routeForm(this)) return nativeSubmit.call(this);
};
window.addEventListener("message", (event) => {
  if (event.source === parent && event.data?.type === "bromine:stop") window.stop();
});
if (logging) {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (["fetch", "xmlhttprequest"].includes(entry.initiatorType) || !entry.name.includes("/api/proxy?")) continue;
      const url = new URL(entry.name);
      send({ type: "bromine:request", url: redactUrl(unproxyUrl(entry.name, proxyOrigin)), method: "GET", status: entry.responseStatus || 0,
        resourceType: url.searchParams.get("type") || entry.initiatorType, duration: entry.duration, size: entry.encodedBodySize, blocked: false });
    }
  });
  observer.observe({ type: "resource", buffered: true });
}
document.addEventListener("DOMContentLoaded", () => {
  const favicon = document.querySelector('link[rel~="icon"]')?.href;
  send({
    type: "bromine:ready",
    requestUrl,
    url: pageUrl,
    title: document.title,
    favicon,
    error: document.querySelector("[data-proxy-error]")?.textContent,
  });
  const refresh = document.querySelector("[data-proxy-refresh]");
  if (refresh) {
    const { url, seconds } = JSON.parse(refresh.dataset.proxyRefresh);
    setTimeout(() => {
      if (parent === window) location.href = proxyOrigin + proxyUrl(url, { adblock });
      else send({ type: "bromine:navigate", url });
    }, Math.min(seconds * 1000, 2147483647));
  }
});
