import { proxyUrl, unproxyUrl, resourceUrl, moduleUrl } from "../shared/proxy-url.js";
import { redactUrl } from "../shared/address.js";
import { proxyRequest, proxyAuthorization, siteAuthorization } from "../shared/proxy-request.js";
import { mapSrcset } from "../shared/srcset.js";
import { decodeCssUrl } from "../shared/css-url.js";
import { siteStorage, storageSeedPrefix, validStorageEntries } from "../shared/site-storage.js";
import {
  applySiteCookie, cookieDomainMatches, cookieMatches, decodeCookieState, documentCookie, encodeCookieState, normalizeSiteCookie,
} from "../shared/cookie-jar.js";
import valueParser from "postcss-value-parser";
import { MemoryCache, MemoryCacheStorage } from "./memory-cache.js";

const script = document.currentScript;
const nativeLocation = window.location;
const target = script.dataset.target;
let base = script.dataset.base || target;
function initialUrl(value) {
  const url = new URL(value);
  // Fragments are not sent to the HTTP proxy.
  if (!url.hash) url.hash = nativeLocation.hash;
  return url.href;
}
let pageUrl = initialUrl(target);
if (base === target) base = pageUrl;
const requestUrl = initialUrl(script.dataset.request);
const adblock = script.dataset.adblock !== "0";
let logging = script.dataset.logging === "1";
const cache = script.dataset.cache !== "0";
const cacheVersion = script.dataset.cacheVersion || "";
const responseStatus = Number(script.dataset.responseStatus);
const verification = script.dataset.verification === "1";
const proxyOrigin = new URL(location.href).origin;
let cookies = decodeCookieState(script.dataset.cookieState || "");
// Site DOM snapshots must not clone or reload the proxy's bootstrap.
script.remove();
const pendingCookieChanges = [];
const send = (data, transfer = []) => { if (parent !== window) parent.postMessage(data, "*", transfer); };
const progress = (stage, url = pageUrl) => send({ type: "bromine:progress", requestUrl, stage, url: redactUrl(url), status: responseStatus, verification });
progress("bootstrap");
window.addEventListener("load", () => progress("loaded"), { once: true });
window.addEventListener("error", (event) => {
  const url = event.filename ? sourceUrl(event.filename) : pageUrl;
  progress(event.error?.name === "SecurityError" ? "sandbox-error" : "script-error", /^https?:\/\//i.test(url) ? url : pageUrl);
});
window.addEventListener("unhandledrejection", (event) => progress(event.reason?.name === "SecurityError" ? "sandbox-error" : "script-error"));

try { void navigator.serviceWorker; }
catch (error) {
  if (error.name !== "SecurityError") throw error;
  // Feature detection must not advertise an API disabled by the opaque sandbox.
  delete Navigator.prototype.serviceWorker;
}

function sourceUrl(value) {
  if (!value || !value.startsWith("/api/proxy?") && !value.startsWith(`${proxyOrigin}/api/proxy?`)) return value;
  return unproxyUrl(value, proxyOrigin);
}

Object.defineProperties(document, {
  URL: { configurable: true, get: () => pageUrl },
  documentURI: { configurable: true, get: () => pageUrl },
  baseURI: { configurable: true, get: () => base },
});

function resource(value, type = "xmlhttprequest", module = false) {
  let url;
  const pageContext = new URL(pageUrl);
  if (["script", "stylesheet", "image", "font", "media"].includes(type)) pageContext.pathname = "/";
  pageContext.search = "";
  pageContext.hash = "";
  try { url = new URL(String(value), base); } catch { return resourceUrl(value, base, proxyOrigin, { adblock, origin: pageContext.href, type, logging, cache, cacheVersion }); }
  if (url.origin === proxyOrigin && url.pathname === "/api/proxy" && url.searchParams.has("url")) {
    url.searchParams.set("origin", pageContext.href);
    url.searchParams.set("type", type);
    if (module) url.searchParams.set("module", "1");
    else url.searchParams.delete("module");
    if (cacheVersion) url.searchParams.set("cacheVersion", cacheVersion);
    return url.href;
  }
  return resourceUrl(value, base, proxyOrigin, { adblock, origin: pageContext.href, type, logging, cache, cacheVersion, module });
}
Object.defineProperty(globalThis, "__bromineModuleUrl", {
  value: (value, scriptUrl) => moduleUrl(value, scriptUrl, proxyOrigin, { adblock, origin: new URL(pageUrl).origin + "/", logging, cache, cacheVersion }),
});
function originalUrl(value) {
  return unproxyUrl(resource(value), proxyOrigin);
}
function updatePageUrl(value, replace) {
  if (base === pageUrl) base = value;
  pageUrl = value;
  send({ type: "bromine:history", requestUrl, url: pageUrl, replace });
}
function navigateLocation(value, replace = false) {
  const destination = new URL(String(value), base);
  if (!["http:", "https:"].includes(destination.protocol)) throw new DOMException("Only HTTP(S) navigation is supported.", "NotSupportedError");
  const previous = new URL(pageUrl);
  if (destination.origin === previous.origin && destination.pathname === previous.pathname && destination.search === previous.search &&
      destination.hash !== previous.hash) {
    updatePageUrl(destination.href, replace);
    if (replace) nativeLocation.replace(nativeLocation.href.split("#")[0] + destination.hash);
    else nativeLocation.hash = destination.hash;
  } else if (parent === window) nativeLocation[replace ? "replace" : "assign"](resource(destination.href, "document"));
  else send({ type: "bromine:navigate", url: destination.href, replace });
}
const siteLocation = {
  assign: (value) => navigateLocation(value),
  replace: (value) => navigateLocation(value, true),
  reload: () => nativeLocation.reload(),
  toString: () => pageUrl,
  [Symbol.toPrimitive]: () => pageUrl,
};
for (const name of ["href", "origin", "protocol", "host", "hostname", "port", "pathname", "search", "hash"]) {
  Object.defineProperty(siteLocation, name, {
    enumerable: true,
    get: () => new URL(pageUrl)[name],
    ...(name === "origin" ? {} : { set(value) {
      if (name === "href") { navigateLocation(value); return; }
      const url = new URL(pageUrl);
      url[name] = value;
      navigateLocation(url.href);
    } }),
  });
}
function locationObject(object) {
  return new Proxy(object, {
    get: (target, name) => name === "location" ? siteLocation : Reflect.get(target, name, target),
    set(target, name, value) {
      if (name !== "location") return Reflect.set(target, name, value, target);
      navigateLocation(value);
      return true;
    },
  });
}
const siteWindow = locationObject(window);
const siteDocument = locationObject(document);
Object.defineProperties(globalThis, {
  __bromineDocumentUrl: { value: pageUrl },
  __bromineLocation: { value: siteLocation },
  __bromineLocationObject: { value: (object) => object === window ? siteWindow : object === document ? siteDocument : object },
});
window.addEventListener("hashchange", () => {
  const url = new URL(pageUrl);
  url.hash = nativeLocation.hash;
  if (url.href !== pageUrl) updatePageUrl(url.href, false);
});
window.addEventListener("popstate", () => {
  const url = unproxyUrl(nativeLocation.href, proxyOrigin);
  if (url !== pageUrl && new URL(url).origin === new URL(pageUrl).origin) updatePageUrl(url, true);
});
for (const name of ["oldURL", "newURL"]) {
  const descriptor = Object.getOwnPropertyDescriptor(HashChangeEvent.prototype, name);
  Object.defineProperty(HashChangeEvent.prototype, name, {
    ...descriptor, get() { return sourceUrl(descriptor.get.call(this)); },
  });
}
function cookieIdentity(cookie) {
  return `${cookie.name}\n${cookie.domain}\n${cookie.path}\n${cookie.hostOnly ? "1" : "0"}`;
}
function requestCookies(requestUrl) {
  const host = new URL(pageUrl).hostname;
  const request = new URL(requestUrl);
  if (request.hostname !== host) return [];
  const matches = cookies.filter((cookie) => !cookie.httpOnly && cookieMatches(cookie, request.href, host));
  const identities = new Set(matches.map(cookieIdentity));
  for (const cookie of pendingCookieChanges) {
    if (cookieMatches(cookie, request.href, host) || cookie.expiresAt !== null && cookie.expiresAt <= Date.now()) {
      if (!identities.has(cookieIdentity(cookie))) matches.push(cookie);
    }
  }
  return matches;
}
function receiveCookieChanges(encoded) {
  if (!encoded) return;
  const host = new URL(pageUrl).hostname;
  for (const cookie of decodeCookieState(encoded)) {
    if (cookie.hostOnly ? cookie.domain !== host : !cookieDomainMatches(host, cookie.domain)) continue;
    cookies = applySiteCookie(cookies, cookie);
  }
}
function persistCookie(cookie) {
  if (parent !== top || cookie.httpOnly) return;
  send({ type: "bromine:cookie", requestUrl, url: pageUrl, cookie });
}

const storageOrigin = new URL(target).origin;
let storageSeed = { local: [], session: [], bridgeId: "" };
if (window.name.startsWith(storageSeedPrefix)) {
  const serialized = window.name.slice(storageSeedPrefix.length);
  window.name = "";
  try {
    const saved = JSON.parse(serialized);
    if (!saved || typeof saved.bridgeId !== "string" || !validStorageEntries(saved.local) || !validStorageEntries(saved.session)) throw new Error("Invalid saved site storage.");
    if (saved.origin === storageOrigin) storageSeed = saved;
  } catch {
    send({ type: "bromine:unsupported", message: "Saved site storage could not be restored. This page may require signing in again." });
  }
}
const saveStorage = (area) => (entries) => {
  if (parent === top && parent !== window) send({ type: "bromine:storage", requestUrl, origin: storageOrigin, bridgeId: storageSeed.bridgeId, area, entries });
};
const local = siteStorage(storageSeed.local, saveStorage("local"));
const session = siteStorage(storageSeed.session, saveStorage("session"));
Object.defineProperty(window, "localStorage", { configurable: true, value: local.storage });
Object.defineProperty(window, "sessionStorage", { configurable: true, value: session.storage });
if (parent === top && parent !== window) window.addEventListener("beforeunload", () => {
  // Carry only this origin's state across native same-frame reloads and form posts.
  window.name = storageSeedPrefix + JSON.stringify({ origin: storageOrigin, bridgeId: storageSeed.bridgeId, local: local.snapshot(), session: session.snapshot() });
});
Object.defineProperties(window, {
  caches: { configurable: true, value: new MemoryCacheStorage() },
  Cache: { configurable: true, value: MemoryCache },
  CacheStorage: { configurable: true, value: MemoryCacheStorage },
});
Object.defineProperty(document, "cookie", {
  configurable: true,
  get: () => documentCookie(cookies, pageUrl),
  set: (raw) => {
    const cookie = normalizeSiteCookie(String(raw), pageUrl, { allowHttpOnly: false });
    if (!cookie) return;
    const identity = cookieIdentity(cookie);
    if (cookies.some((item) => item.httpOnly && cookieIdentity(item) === identity)) return;
    cookies = applySiteCookie(cookies, cookie);
    pendingCookieChanges.push(cookie);
    persistCookie(cookie);
  },
});
if (parent === top) window.addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.type !== "bromine:cookie-synced" ||
      event.data.requestUrl !== requestUrl || typeof event.data.key !== "string") return;
  const index = pendingCookieChanges.findIndex((cookie) => cookieIdentity(cookie) === event.data.key);
  if (index !== -1) pendingCookieChanges.splice(index, 1);
});

function cssResources(value) {
  const parsed = valueParser(value);
  parsed.walk((node) => {
    if (node.type !== "function" || node.value.toLowerCase() !== "url") return;
    const raw = node.nodes.length === 1 && node.nodes[0].type === "string" ? node.nodes[0].value : valueParser.stringify(node.nodes).trim();
    if (raw.startsWith("#")) return;
    node.nodes = [{ type: "string", quote: '"', value: resource(decodeCssUrl(raw), "image") }];
    return false;
  });
  return parsed.toString();
}
const nativeSetAttribute = Element.prototype.setAttribute;
const nativeGetAttribute = Element.prototype.getAttribute;
const urlAttributes = new Set(["src", "href", "action", "formaction", "poster", "background", "data"]);
Element.prototype.getAttribute = function (name) {
  const value = nativeGetAttribute.call(this, name);
  const attribute = String(name).toLowerCase();
  if (value === null) return value;
  if (["srcset", "imagesrcset"].includes(attribute)) return mapSrcset(value, sourceUrl);
  return urlAttributes.has(attribute) ? sourceUrl(value) : value;
};
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
function setInternalAttribute(element, name, value) {
  // Unchanged URL writes can feed consent-script MutationObservers indefinitely.
  if (nativeGetAttribute.call(element, name) !== value) nativeSetAttribute.call(element, name, value);
}
for (const name of ["pushState", "replaceState"]) {
  const native = History.prototype[name];
  History.prototype[name] = function (state, unused, url) {
    if (this !== window.history || url == null || url === "") return native.call(this, state, unused, url);
    const destination = new URL(originalUrl(String(url)), pageUrl);
    if (destination.origin !== new URL(pageUrl).origin) throw new DOMException("History cannot change the site's origin.", "SecurityError");
    const result = native.call(this, state, unused, resource(destination.href, "document"));
    updatePageUrl(destination.href, name === "replaceState");
    return result;
  };
}
function attributeValue(element, name, value) {
  name = name.toLowerCase();
  const tag = element.tagName.toLowerCase();
  if (["img", "script", "link", "audio", "video"].includes(tag) && name === "crossorigin") return "use-credentials";
  if (["img", "script", "link", "audio", "video"].includes(tag) &&
      ["src", "srcset", "imagesrcset", "href", "poster"].includes(name)) {
    setInternalAttribute(element, "crossorigin", "use-credentials");
  }
  if (name === "style") return cssResources(value);
  if (["srcset", "imagesrcset"].includes(name)) return mapSrcset(value, (url) => resource(url, "image"));
  const types = { img: "image", script: "script", link: "stylesheet", iframe: "subdocument", video: "media", audio: "media", source: "media", a: "document", area: "document" };
  if (["src", "href", "poster", "background"].includes(name) && !value.trim().startsWith("#")) {
    if (["img", "script", "link", "audio", "video"].includes(tag)) setInternalAttribute(element, "crossorigin", "use-credentials");
    const module = tag === "script" && (nativeGetAttribute.call(element, "type") || "").toLowerCase() === "module" ||
      tag === "link" && (nativeGetAttribute.call(element, "rel") || "").toLowerCase().split(/\s+/).includes("modulepreload");
    return resource(value, module ? "script" : types[tag] || "other", module);
  }
  return value;
}
Element.prototype.setAttribute = function (name, value) {
  const result = nativeSetAttribute.call(this, name, attributeValue(this, name, String(value)));
  if (["type", "rel"].includes(String(name).toLowerCase())) refreshModuleResource(this);
  return result;
};
function refreshModuleResource(element) {
  const attribute = element.tagName === "SCRIPT" ? "src" : element.tagName === "LINK" ? "href" : null;
  if (!attribute) return;
  const value = nativeGetAttribute.call(element, attribute);
  if (value) setInternalAttribute(element, attribute, attributeValue(element, attribute, value));
}
for (const [constructor, property] of [[HTMLScriptElement, "type"], [HTMLLinkElement, "rel"]]) {
  const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, property);
  Object.defineProperty(constructor.prototype, property, {
    ...descriptor, set(value) { descriptor.set.call(this, value); refreshModuleResource(this); },
  });
}
for (const [constructor, property] of [
  [HTMLImageElement, "src"], [HTMLImageElement, "srcset"], [HTMLScriptElement, "src"],
  [HTMLImageElement, "crossOrigin"], [HTMLScriptElement, "crossOrigin"], [HTMLLinkElement, "crossOrigin"],
  [HTMLMediaElement, "crossOrigin"],
  [HTMLLinkElement, "href"], [HTMLIFrameElement, "src"], [HTMLMediaElement, "src"],
  [HTMLSourceElement, "src"], [HTMLSourceElement, "srcset"], [HTMLAnchorElement, "href"],
  [HTMLAreaElement, "href"], [HTMLFormElement, "action"], [HTMLButtonElement, "formAction"],
  [HTMLInputElement, "src"], [HTMLInputElement, "formAction"], [HTMLObjectElement, "data"],
]) {
  const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, property);
  if (!descriptor?.set) continue;
  Object.defineProperty(constructor.prototype, property, {
    ...descriptor,
    get() {
      const value = descriptor.get.call(this);
      return property === "srcset" ? mapSrcset(value, sourceUrl) : sourceUrl(value);
    },
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
const NativeHeaders = window.Headers;
window.Request = class extends NativeRequest {
  constructor(input, options) { super(typeof input === "string" || input instanceof URL ? resource(String(input)) : input, { ...options, mode: "cors" }); }
};

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, options) => {
  const raw = input instanceof NativeRequest ? input.url : String(input);
  const credentials = options?.credentials ?? (input instanceof NativeRequest ? input.credentials : "same-origin");
  const start = performance.now();
  const request = await proxyRequest(input, options, resource, NativeRequest);
  const headers = new NativeHeaders(request.headers);
  const targetUrl = unproxyUrl(request.url, proxyOrigin);
  if (logging) progress("request-start", targetUrl);
  proxyAuthorization(headers, targetUrl, pageUrl);
  const includeSiteCookies = credentials !== "omit" && new URL(targetUrl).hostname === new URL(pageUrl).hostname;
  const siteCookies = includeSiteCookies ? requestCookies(targetUrl) : [];
  if (includeSiteCookies) headers.set("X-Bromine-Site-Cookies", encodeCookieState(siteCookies));
  else headers.delete("X-Bromine-Site-Cookies");
  let response;
  try { response = await nativeFetch(request, { headers, credentials: "include" }); }
  catch (error) {
    progress("request-error", targetUrl);
    if (logging) send({ type: "bromine:request", url: redactUrl(targetUrl), method: request.method, failed: true, resourceType: "xmlhttprequest", duration: performance.now() - start });
    throw error;
  }
  receiveCookieChanges(response.headers.get("X-Bromine-Cookie-Changes"));
  if (logging) send({ type: "bromine:request", url: redactUrl(originalUrl(raw)),
    method: options?.method || (input instanceof NativeRequest ? input.method : "GET"), status: response.status, resourceType: "xmlhttprequest",
    duration: performance.now() - start, size: Number(response.headers.get("content-length")) || null,
    blocked: response.headers.get("X-Bromine-Adblock") === "blocked", cache: response.headers.get("X-Bromine-Cache"), filterKnown: true });
  return response;
};
const nativeOpen = XMLHttpRequest.prototype.open;
const xhrTargets = new WeakMap();
const xhrMethods = new WeakMap();
XMLHttpRequest.prototype.open = function (method, url, ...args) {
  const proxied = resource(String(url));
  xhrTargets.set(this, unproxyUrl(proxied, proxyOrigin));
  xhrMethods.set(this, String(method).toUpperCase());
  return nativeOpen.call(this, method, proxied, ...args);
};
const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
  const lower = String(name).toLowerCase();
  if (["x-bromine-site-cookies", "x-bromine-site-authorization"].includes(lower)) return;
  if (lower === "authorization") {
    if (!String(value).trim()) return;
    return nativeSetRequestHeader.call(this, "X-Bromine-Site-Authorization", siteAuthorization(value, xhrTargets.get(this), pageUrl));
  }
  return nativeSetRequestHeader.call(this, name, value);
};
const nativeSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (body) {
  const targetUrl = xhrTargets.get(this);
  const start = performance.now();
  if (logging && targetUrl) progress("request-start", targetUrl);
  this.addEventListener("loadend", () => {
    if (!targetUrl) return;
    if (this.status === 0) progress("request-error", targetUrl);
    if (logging) send({ type: "bromine:request", url: redactUrl(targetUrl), method: xhrMethods.get(this),
      status: this.status || undefined, failed: this.status === 0, resourceType: "xmlhttprequest", duration: performance.now() - start,
      cache: this.getResponseHeader("X-Bromine-Cache"), blocked: this.getResponseHeader("X-Bromine-Adblock") === "blocked", filterKnown: true });
  }, { once: true });
  if (targetUrl && new URL(targetUrl).hostname === new URL(pageUrl).hostname) {
    const siteCookies = requestCookies(targetUrl);
    nativeSetRequestHeader.call(this, "X-Bromine-Site-Cookies", encodeCookieState(siteCookies));
    this.addEventListener("loadend", () => receiveCookieChanges(this.getResponseHeader("X-Bromine-Cookie-Changes")), { once: true });
  }
  this.withCredentials = true;
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
    const config = { url, proxyOrigin, adblock, origin: target, logging, cache, cacheVersion, cookies: cookies.filter((cookie) => !cookie.httpOnly) };
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
  if (!anchor || event.defaultPrevented || event.button !== 0) return;
  const raw = anchor.getAttribute("href");
  if (raw.startsWith("#")) return;
  const destination = originalUrl(raw);
  const url = new URL(destination);
  if (!["http:", "https:"].includes(url.protocol)) return;
  if (anchor.hasAttribute("download")) {
    if (parent === window) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    send({ type: "bromine:download", requestUrl, url: destination });
    return;
  }
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
  form.action = proxyOrigin + proxyUrl(url.href, { adblock, origin: new URL(pageUrl).origin, type: "document", logging, cache, cacheVersion });
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
  if (event.source === parent && event.data?.type === "bromine:logging" && typeof event.data.enabled === "boolean") logging = event.data.enabled;
});
{
  const observer = new PerformanceObserver((list) => {
    if (!logging) return;
    for (const entry of list.getEntries()) {
      if (["fetch", "xmlhttprequest"].includes(entry.initiatorType) || !entry.name.includes("/api/proxy?")) continue;
      const url = new URL(entry.name);
      send({ type: "bromine:request", url: redactUrl(unproxyUrl(entry.name, proxyOrigin)), method: "GET", status: entry.responseStatus || 0,
        resourceType: url.searchParams.get("type") || entry.initiatorType, duration: entry.duration, size: entry.encodedBodySize,
        cache: entry.transferSize === 0 && entry.decodedBodySize > 0 ? "hit" : null, blocked: false });
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
    favicon: favicon ? resource(favicon, "image") : undefined,
    error: document.querySelector("[data-proxy-error]")?.textContent,
    status: responseStatus,
    verification,
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
