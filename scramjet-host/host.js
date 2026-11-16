import { validateNavigation } from "../shared/address.js";
import { validateTransport } from "./config.js";
import { PublicAssetCache } from "./cache.js";

const status = document.querySelector("#status");
const site = document.querySelector("#site");
const allowedOrigins = window.BROMINE_SCRAMJET_CONFIG?.origins || [];
const standalone = window === window.top;
let port;
let engine;
let engineConfig;
let loadingEngine;
const downloads = new Map();
const emit = (message) => {
  port?.postMessage(message);
};
const cache = new PublicAssetCache(caches, () => emit({ event: "error", message: "The Scramjet public asset cache failed. Check browser storage availability." }));

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error("A Scramjet runtime file could not be loaded. Check the isolated frontend deployment."));
    document.head.append(script);
  });
}

async function getEngine(config) {
  validateTransport(config);
  if (engine && engineConfig?.wispUrl === config.wispUrl && engineConfig?.bareUrl === config.bareUrl &&
      engineConfig?.transport === config.transport && engineConfig?.adblock === config.adblock) return engine;
  if (loadingEngine) return loadingEngine;
  loadingEngine = (async () => {
    engine?.close();
    engine = undefined;
    engineConfig = undefined;
    if (!window.$scramjet) {
      await loadScript("/vendor/scramjet.js");
      await loadScript("/vendor/controller.api.js");
    }
    const { createEngine } = await import("./engine.js");
    engineConfig = { ...config };
    engine = await createEngine(site, engineConfig, cache, emit);
    return engine;
  })().finally(() => { loadingEngine = null; });
  return loadingEngine;
}

async function command(data) {
  const { action, config } = data;
  if (config) {
    if (![64, 128, 256, 512, 1024, 2048].includes(config.limitMB)) throw new Error("Invalid Scramjet cache size.");
    cache.limitMB = config.limitMB;
  }
  if (action === "cache-stats") { await cache.evict(); return cache.stats(); }
  if (action === "cache-clear") return cache.clear({ site: data.site, category: data.category });
  if (action === "logging") { if (engineConfig) engineConfig.logging = data.enabled === true; return {}; }
  if (action === "clear-storage") {
    if (!engine) throw new Error("This site's Scramjet storage is not open.");
    await engine.clearStorage(new URL(data.url).origin);
    return {};
  }
  if (action === "navigate") {
    const url = validateNavigation(data.url).href;
    status.hidden = false;
    status.textContent = "Starting Scramjet...";
    const runtime = await getEngine(config);
    runtime.go(url, { cacheVersion: data.cacheVersion, logging: config.logging });
    status.hidden = true;
    site.hidden = false;
    return {};
  }
  if (action === "download") {
    const abort = new AbortController();
    downloads.set(data.id, abort);
    try {
      const runtime = await getEngine(config);
      if (abort.signal.aborted) throw new DOMException("The download was cancelled.", "AbortError");
      const response = await runtime.download(validateNavigation(data.url).href, data.headers || [], abort.signal);
      const reader = response.body?.getReader();
      if (!reader) { downloads.delete(data.id); return response; }
      const body = new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) { downloads.delete(data.id); controller.close(); }
            else controller.enqueue(value);
          } catch (error) { downloads.delete(data.id); controller.error(error); }
        },
        cancel(reason) {
          downloads.delete(data.id);
          abort.abort();
          return reader.cancel(reason);
        },
      });
      return { ...response, body };
    } catch (error) { downloads.delete(data.id); throw error; }
  }
  throw new Error("Unsupported Scramjet command.");
}

if (standalone) {
  const { startStandalone } = await import("./tabs.js");
  startStandalone();
}

window.addEventListener("message", (event) => {
  if (standalone || event.source !== parent || !(allowedOrigins.includes(event.origin) || event.origin === location.origin) ||
      event.data?.type !== "bromine:scramjet-connect" || !event.ports[0]) return;
  port?.close();
  port = event.ports[0];
  port.onmessage = async ({ data }) => {
    if (!data || !Number.isSafeInteger(data.id)) return;
    if (data.action === "cancel") { downloads.get(data.id)?.abort(); downloads.delete(data.id); return; }
    try {
      const result = await command(data);
      const transfer = result?.body instanceof ReadableStream || result?.body instanceof ArrayBuffer ? [result.body] : [];
      port.postMessage({ id: data.id, result }, transfer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Scramjet operation failed.";
      status.textContent = message;
      if (data.action === "navigate") { status.hidden = false; site.hidden = true; }
      port.postMessage({ id: data.id, error: message });
    }
  };
  port.start();
  emit({ event: "ready" });
});

window.addEventListener("pagehide", () => {
  for (const download of downloads.values()) download.abort();
  downloads.clear();
  engine?.close();
});
