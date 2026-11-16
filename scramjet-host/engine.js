import { Controller, ManagedPlugin } from "@mercuryworkshop/scramjet-controller";
import { ScramjetHeaders } from "@mercuryworkshop/scramjet";
import LibcurlClient from "@mercuryworkshop/libcurl-transport";
import BareClient from "@mercuryworkshop/bare-transport";
import { validateNavigation, redactUrl } from "../shared/address.js";
import { validateTransport } from "./config.js";
import { publicAssetRequest } from "./cache.js";
import { isBlocked, loadFiltering } from "./filtering.js";

const resourceTypes = { style: "stylesheet", iframe: "document", document: "document", audio: "media", video: "media", "": "xmlhttprequest" };

function requestType(destination) { return resourceTypes[destination] || destination || "other"; }
function httpTarget(value) { return validateNavigation(value).href; }
function documentKey(value) { const url = new URL(value); url.hash = ""; return url.href; }

export async function createEngine(element, config, cache, emit) {
  const transportName = validateTransport(config);
  const label = transportName === "bare" ? "Bare" : "Wisp";
  const lifetime = new AbortController();
  const sockets = new Set();
  let currentClient;
  let currentUrl;
  let firstDocument = true;
  let cacheVersion = "";
  const documents = new Map();
  const filtered = (url, method, type) => {
    if (!config.adblock || !isBlocked(url, currentUrl || url, type)) return false;
    if (config.logging) emit({ event: "request", url: redactUrl(url), method, type, status: 204, route: "SCRAMJET", size: 0, duration: 0, filter: "BLOCKED" });
    return true;
  };
  emit({ event: "progress", message: `Preparing Scramjet rewriter and ${label} transport` });
  if (config.adblock) await loadFiltering();
  const transport = transportName === "bare" ? new BareClient(config.bareUrl) : new LibcurlClient({ wisp: config.wispUrl });
  await transport.init();
  const rawRequest = transport.request.bind(transport);
  transport.request = async (url, method, body, rawHeaders, signal) => {
    httpTarget(url.href);
    const headers = new Headers(rawHeaders);
    const type = requestType(headers.get("sec-fetch-dest") || "");
    if (filtered(url.href, method, type)) return { status: 204, statusText: "No Content", headers: [["X-Bromine-Adblock", "blocked"]], body: null };
    const started = performance.now();
    if (config.logging) emit({ event: "progress", message: `Requesting ${type} through ${label}`, url: url.href });
    try {
      const response = await rawRequest(url, method, body, rawHeaders, signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal);
      if (transportName === "bare") {
        response.headers = response.headers.flatMap(([name, value]) =>
          Array.isArray(value) ? value.map((item) => [name, item]) : [[name, value]]);
      }
      const responseHeaders = new Headers(response.headers);
      if (config.logging) emit({
        event: "request", url: redactUrl(url.href), method, type, status: response.status, route: "SCRAMJET",
        size: responseHeaders.has("content-length") ? Number(responseHeaders.get("content-length")) : null,
        duration: performance.now() - started, filter: "ALLOWED",
      });
      return response;
    } catch (error) {
      if (signal?.aborted) throw error;
      emit({ event: "request", url: redactUrl(url.href), method, type, status: "FAILED", route: "SCRAMJET", size: null, duration: performance.now() - started, filter: "ALLOWED" });
      throw new Error(`The ${label} request failed. Check the ${label} endpoint, its allowed origins/destinations, and the site's availability.`, { cause: error });
    }
  };
  const rawConnect = transport.connect.bind(transport);
  transport.connect = (url, protocols, headers, onopen, onmessage, onclose, onerror) => {
    const target = new URL(url);
    if (!["ws:", "wss:"].includes(target.protocol)) throw new Error("Only website WebSocket connections are supported.");
    target.protocol = target.protocol === "wss:" ? "https:" : "http:";
    httpTarget(target.href);
    if (filtered(target.href, "GET", "websocket")) throw new Error("The website WebSocket was filtered by uBlock Origin.");
    let close;
    const connection = rawConnect(url, protocols, headers, onopen, onmessage, (...args) => {
      sockets.delete(close);
      onclose?.(...args);
    }, onerror);
    close = connection[1];
    sockets.add(close);
    return [connection[0], (...args) => { sockets.delete(close); close(...args); }];
  };
  const registration = await navigator.serviceWorker.register("/worker.js");
  const worker = await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  const controller = new Controller({
    transport,
    serviceworker: registration.active || worker.active,
    config: { scramjetPath: "/vendor/scramjet.js", wasmPath: "/vendor/scramjet.wasm", injectPath: "/vendor/controller.inject.js" },
    scramjetConfig: { flags: { allowInvalidJs: false, allowFailedIntercepts: false } },
  });
  await controller.wait();
  const requests = new WeakMap();
  class BrowserPlugin extends ManagedPlugin {
    constructor() { super("bromine-browser", []); }
    install(frame) {
      super.install(frame);
      this.tap(frame.hooks.fetch.intercept, ({ request, parsed }, props) => {
        httpTarget(parsed.url.href);
        if (filtered(parsed.url.href, request.method, requestType(parsed.destination))) {
          props.response = { status: 204, statusText: "No Content", headers: ScramjetHeaders.fromRawHeaders([["X-Bromine-Adblock", "blocked"]]), body: null };
        }
      });
      this.tap(frame.hooks.fetch.request, async ({ request, parsed }, props) => {
        const options = {
          url: parsed.url.href, method: request.method, headers: new Headers(props.init.headers),
          destination: parsed.destination, cacheMode: request.cache, site: new URL(currentUrl).hostname, version: cacheVersion,
        };
        requests.set(request, options);
        if (!publicAssetRequest(options)) return;
        const cached = await cache.match(options);
        if (cached) {
          options.hit = true;
          props.earlyResponse = cached;
          if (config.logging) emit({ event: "request", url: redactUrl(parsed.url.href), method: request.method, type: requestType(parsed.destination), status: cached.status, route: "SCRAMJET", size: Number(cached.headers.get("X-Bromine-Size")), duration: 0, filter: "CACHE HIT" });
        }
      });
      this.tap(frame.hooks.fetch.preresponse, ({ request, parsed }, { response }) => {
        if (["iframe", "document"].includes(parsed.destination)) {
          documents.set(documentKey(parsed.url.href), { status: response.status, verification: response.headers.get("cf-mitigated") === "challenge" });
          if (documents.size > 50) documents.delete(documents.keys().next().value);
        }
        const options = requests.get(request);
        if (options && !options.hit) cache.put(options, response, response.rawHeaders);
      });
      this.tap(frame.hooks.error.request, ({ rawrequest }) => {
        emit({ event: "error", message: `A Scramjet request failed. Check ${label} connectivity, allowed hosts, or the Request inspector.`, url: currentUrl });
        if (config.logging) emit({ event: "progress", message: `Failed ${rawrequest.method} request`, url: currentUrl });
      });
      this.tap(frame.hooks.init.post, ({ window: siteWindow, client, isTopLevel }) => {
        if (!isTopLevel) return;
        currentClient = client;
        currentUrl = httpTarget(client.url.href);
        emit({ event: "navigation", url: currentUrl, replace: firstDocument });
        firstDocument = false;
        const status = documents.get(documentKey(currentUrl))?.status;
        const verification = documents.get(documentKey(currentUrl))?.verification || client.initHeaders.get("cf-mitigated") === "challenge";
        emit({ event: "progress", message: verification ? "Site verification required; use Open directly for first-party verification" :
          status >= 400 ? `Site returned HTTP ${status}; sign-in or verification may require Open directly` :
            "Document received; executing scripts and styles", url: currentUrl, failed: verification || status >= 400 });
        let faviconUrl;
        let faviconAbort;
        const appearance = () => {
          const title = siteWindow.document.title || new URL(currentUrl).hostname;
          emit({ event: "appearance", title });
          const icon = siteWindow.document.querySelector('link[rel~="icon"]');
          if (!icon || icon.href === faviconUrl) return;
          faviconUrl = icon.href;
          faviconAbort?.abort();
          const abort = faviconAbort = new AbortController();
          (async () => {
            const response = await fetch(client.rewriteUrl(client.unrewriteUrl(icon.href), { destination: "image" }), { signal: abort.signal });
            if (!response.ok || !response.body) throw new Error("Site favicon unavailable.");
            const type = (response.headers.get("content-type") || "").split(";")[0].trim();
            if (!/^image\/(?:png|jpeg|gif|webp|avif|x-icon|vnd\.microsoft\.icon|svg\+xml)$/i.test(type)) throw new Error("Unsupported site favicon type.");
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 128 * 1024) { abort.abort(); throw new Error("Site favicon exceeds the metadata size limit."); }
              chunks.push(value);
            }
            if (!abort.signal.aborted && currentClient === client) emit({ event: "appearance", title, favicon: new Blob(chunks, { type }) });
          })().catch(() => {
            if (!abort.signal.aborted && currentClient === client) emit({ event: "appearance", title, faviconError: true });
          });
        };
        const observer = new MutationObserver(appearance);
        observer.observe(siteWindow.document.head, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["href", "rel"] });
        siteWindow.addEventListener("pagehide", () => { observer.disconnect(); faviconAbort?.abort(); }, { once: true });
        siteWindow.addEventListener("DOMContentLoaded", appearance, { once: true });
        siteWindow.addEventListener("load", () => {
          appearance();
          emit({ event: "loaded", url: currentUrl, message: "Scramjet frame loaded; site functionality is not verified" });
        }, { once: true });
        siteWindow.addEventListener("error", () => emit({ event: "progress", message: "A website script failed; see Request inspector", failed: true, url: currentUrl }));
        this.tap(client.hooks.lifecycle.navigate, ({ type }, props) => {
          if (type === "history") return;
          currentUrl = httpTarget(String(props.url));
          emit({ event: "navigation", url: currentUrl, replace: false, kind: type });
        });
        for (const [method, replace] of [["pushState", false], ["replaceState", true]]) {
          client.Proxy(`History.prototype.${method}`, { apply(context) {
            const result = context.call();
            currentUrl = httpTarget(client.url.href);
            emit({ event: "navigation", url: currentUrl, replace, kind: "history" });
            context.return(result);
          } });
        }
        client.Proxy("window.open", { apply(context) {
          if (context.args[0]) emit({ event: "new-tab", url: httpTarget(new URL(String(context.args[0]), currentUrl).href) });
          context.return(null);
        } });
        siteWindow.addEventListener("click", (event) => {
          const anchor = event.target.closest?.("a[href]");
          if (event.defaultPrevented || !anchor) return;
          if (anchor.hasAttribute("download")) {
            event.preventDefault();
            emit({ event: "download", url: httpTarget(client.unrewriteUrl(anchor.href)) });
            return;
          }
          if (!(anchor.target === "_blank" || event.ctrlKey || event.metaKey)) return;
          event.preventDefault();
          emit({ event: "new-tab", url: httpTarget(client.unrewriteUrl(anchor.href)) });
        });
      });
    }
  }
  const frame = controller.createFrame(element, { plugins: [new BrowserPlugin()] });
  return {
    go(url, options) {
      currentUrl = httpTarget(url);
      cacheVersion = options.cacheVersion || "";
      config.logging = options.logging;
      documents.clear();
      firstDocument = true;
      frame.go(currentUrl);
    },
    async clearStorage(origin) {
      if (!currentClient || new URL(currentClient.url.href).origin !== origin) throw new Error("Open this site in Scramjet before clearing its saved storage.");
      // This pinned core's Storage.clear() enumerates array indices, not keys.
      for (const storage of [currentClient.global.localStorage, currentClient.global.sessionStorage]) {
        for (const key of Object.keys(storage)) storage.removeItem(key);
      }
    },
    async download(url, headers, signal) {
      const target = new URL(httpTarget(url));
      const requestHeaders = new Headers(headers);
      for (const name of requestHeaders.keys()) if (name !== "range") requestHeaders.delete(name);
      const cookies = controller.cookieJar.getCookies(target, false, "strict");
      if (cookies) requestHeaders.set("Cookie", cookies);
      return transport.request(target, "GET", null, [...requestHeaders], signal);
    },
    close() {
      lifetime.abort();
      for (const close of sockets) close();
      sockets.clear();
      if (transportName === "wisp") transport.session.close();
    },
  };
}
