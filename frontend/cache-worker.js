const prefix = "bromine-cache-";
const configCache = "bromine-config-v1";
const configKey = new URL("/__bromine_cache_config__", self.location.origin).href;
let config = { enabled: true, limitMB: 256 };
let initialized = false;
let mutations = Promise.resolve();
function mutate(task) {
  mutations = mutations.then(task).catch(async (error) => {
    config.enabled = false;
    for (const client of await self.clients.matchAll()) client.postMessage({ type: "bromine:cache-error", message: `Cache disabled after an error: ${error.message}` });
  });
  return mutations;
}

async function initialize() {
  if (initialized) return;
  const response = await (await caches.open(configCache)).match(configKey);
  if (response) config = { ...await response.json(), enabled: true };
  initialized = true;
}

async function records() {
  const rows = [];
  for (const name of (await caches.keys()).filter((name) => name.startsWith(prefix))) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      rows.push({ name, request, size: Number(response.headers.get("X-Bromine-Size") || 0), used: Number(response.headers.get("X-Bromine-Used") || 0) });
    }
  }
  return rows;
}

async function evict() {
  const rows = (await records()).sort((a, b) => a.used - b.used);
  let size = rows.reduce((total, row) => total + row.size, 0);
  let count = rows.length;
  for (const row of rows) {
    if (size <= config.limitMB * 1024 * 1024 && count <= 200) break;
    await (await caches.open(row.name)).delete(row.request);
    size -= row.size;
    count--;
  }
}

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
  event.waitUntil((async () => {
    try {
      await initialize();
      await mutations;
      const { action } = event.data;
      if (action === "configure") {
        const value = event.data.config;
        if (typeof value.enabled !== "boolean" || ![64, 128, 256, 512, 1024, 2048].includes(value.limitMB)) throw new Error("Invalid cache configuration.");
        config = value;
        await (await caches.open(configCache)).put(configKey, new Response(JSON.stringify(config)));
        await evict();
      }
      if (action === "clear") {
        await mutations;
        for (const row of await records()) {
          const parameters = new URL(row.request.url).searchParams;
          const hostname = new URL(parameters.get("url")).hostname;
          const originHost = parameters.get("origin") ? new URL(parameters.get("origin")).hostname : hostname;
          if (event.data.site && hostname !== event.data.site && originHost !== event.data.site) continue;
          if (event.data.category && row.name !== `${prefix}${event.data.category}-v1`) continue;
          await (await caches.open(row.name)).delete(row.request);
        }
      }
      const rows = await records();
      event.ports[0].postMessage({ bytes: rows.reduce((total, row) => total + row.size, 0), entries: rows.length, limitMB: config.limitMB });
    } catch (error) { event.ports[0].postMessage({ error: error.message }); }
  })());
});

async function cachedFetch(request, event) {
  await initialize();
  const url = new URL(request.url);
  if (!config.enabled || !["script", "stylesheet", "image", "font", "media"].includes(url.searchParams.get("type")) || url.searchParams.get("cache") === "0" ||
      request.headers.has("range") || request.headers.has("x-bromine-site-authorization")) return fetch(request);
  const type = url.searchParams.get("type");
  const category = type === "image" ? "image" : type === "font" ? "font" : type === "media" ? "media" : "http";
  const cache = await caches.open(`${prefix}${category}-v1`);
  const cached = await cache.match(request);
  if (cached && Date.now() < Number(cached.headers.get("X-Bromine-Expires") || 0)) {
    const headers = new Headers(cached.headers);
    headers.set("X-Bromine-Cache", "hit");
    headers.set("X-Bromine-Used", String(Date.now()));
    const response = new Response(cached.body, { status: cached.status, headers });
    const copy = response.clone();
    event.waitUntil(mutate(() => cache.put(request, copy)));
    return response;
  }
  const response = await fetch(request);
  const age = Math.max(0, Number(response.headers.get("Age") || 0));
  const ttl = Math.min(900, Number(response.headers.get("X-Bromine-Cache-Ttl")) - age);
  const expires = Date.now() + ttl * 1000;
  if (response.status === 200 && response.headers.get("X-Bromine-Cacheable") === "1" && ttl > 0) {
    const copy = response.clone();
    const stored = mutate(async () => {
      if (Number(copy.headers.get("content-length")) > 4 * 1024 * 1024) { copy.body.cancel(); return; }
      const reader = copy.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4 * 1024 * 1024 || size > config.limitMB * 1024 * 1024) { reader.cancel(); return; }
        chunks.push(value);
      }
      const body = new Blob(chunks);
      const headers = new Headers(copy.headers);
      headers.set("X-Bromine-Size", String(size));
      headers.set("X-Bromine-Used", String(Date.now()));
      headers.set("X-Bromine-Stored", String(Date.now()));
      headers.set("X-Bromine-Expires", String(expires));
      await cache.put(request, new Response(body, { status: copy.status, headers }));
      await evict();
    });
    event.waitUntil(stored);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname === "/api/proxy" && url.searchParams.has("url") && event.request.method === "GET") {
    event.respondWith(cachedFetch(event.request, event));
  }
});
