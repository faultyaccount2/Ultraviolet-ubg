import { validateNavigation } from "../shared/address.js";
import { validateWispUrl } from "./config.js";
import { PublicAssetCache } from "./cache.js";
import { Downloads } from "../frontend/downloads.js";

const status = document.querySelector("#status");
const site = document.querySelector("#site");
const allowedOrigins = window.BROMINE_SCRAMJET_CONFIG?.origins || [];
const standalone = window === window.top;
const address = document.querySelector("#address");
const standaloneConfig = {
  wispUrl: window.BROMINE_SCRAMJET_CONFIG?.wispUrl || "",
  limitMB: 256, adblock: true, logging: false, concurrent: 2, proxyEngine: "scramjet",
};
let port;
let engine;
let engineConfig;
let loadingEngine;
const downloads = new Map();
function showStatus(message) {
  status.textContent = message;
  status.hidden = false;
}
const emit = (message) => {
  port?.postMessage(message);
  if (!standalone) return;
  if (message.event === "navigation") address.value = message.url;
  if (message.event === "appearance") document.title = `${message.title || "Website"} - Scramjet`;
  if (["progress", "error", "loaded"].includes(message.event) && message.message) showStatus(message.message);
  if (message.event === "new-tab") {
    const url = new URL("/", location.origin);
    url.hash = new URLSearchParams({ url: validateNavigation(message.url).href }).toString();
    window.open(url.href, "_blank", "noopener,noreferrer");
  }
  if (message.event === "download") {
    try { standaloneDownloads.add(validateNavigation(message.url).href); }
    catch (error) { showStatus(error.message); }
  }
};
const cache = new PublicAssetCache(caches, () => emit({ event: "error", message: "The Scramjet public asset cache failed. Check browser storage availability." }));
const standaloneDownloads = standalone ? new Downloads({
  route: validateNavigation,
  options: () => standaloneConfig,
  notify: showStatus,
  changed() {
    const item = standaloneDownloads.items[0];
    if (item?.status === "failed") showStatus(`Download failed: ${item.error}`);
    else if (item?.status === "saved") showStatus(`Download saved: ${item.name}`);
  },
  async fetchResource(url, options) {
    const runtime = await getEngine(standaloneConfig);
    const response = await runtime.download(url, [...options.headers], options.signal);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
  },
}) : null;

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
  validateWispUrl(config.wispUrl);
  if (engine && engineConfig?.wispUrl === config.wispUrl && engineConfig?.adblock === config.adblock) return engine;
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

async function navigateStandalone() {
  try {
    const value = address.value.trim();
    const url = validateNavigation(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`).href;
    address.value = url;
    await command({ action: "navigate", url, config: standaloneConfig });
  } catch (error) {
    showStatus(error.message);
  }
}

if (standalone) {
  document.querySelector("#standalone").hidden = false;
  showStatus("Enter a website address to browse through Scramjet and Wisp.");
  document.querySelector("#navigation").addEventListener("submit", (event) => {
    event.preventDefault();
    navigateStandalone();
  });
  document.querySelector("#reload").addEventListener("click", navigateStandalone);
  const initialUrl = new URLSearchParams(location.hash.slice(1)).get("url");
  if (initialUrl) { address.value = initialUrl; navigateStandalone(); }
}

window.addEventListener("message", (event) => {
  if (event.source !== parent || !allowedOrigins.includes(event.origin) || event.data?.type !== "bromine:scramjet-connect" || !event.ports[0]) return;
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
  for (const item of [...standaloneDownloads?.items || []]) standaloneDownloads.action(item, "remove");
  for (const download of downloads.values()) download.abort();
  downloads.clear();
  engine?.close();
});
