import { proxyUrl } from "../shared/proxy-url.js";
import { redactUrl } from "../shared/address.js";

export class Downloads {
  constructor({ route, options, changed, notify }) {
    this.route = route;
    this.options = options;
    this.changed = changed;
    this.notify = notify;
    this.items = [];
    this.running = 0;
  }

  add(url) {
    this.route(url);
    const decision = { mode: "proxy" };
    const decoded = decodeURIComponent(new URL(url).pathname.split("/").pop() || "download").replace(/[<>:"/\\|?*]/g, "_");
    const name = [...decoded].map((character) => character.charCodeAt(0) < 32 ? "_" : character).join("");
    if (this.items.length >= 50) throw new Error("Remove a download-history entry before starting more downloads (limit: 50).");
    const item = { id: crypto.randomUUID(), url, name, route: decision.mode, status: "queued", size: 0, total: 0, chunks: [], speed: 0, time: Date.now() };
    this.items.unshift(item);
    this.pump();
    this.changed();
  }

  pump() {
    while (this.running < this.options().concurrent) {
      const item = this.items.find((item) => item.status === "queued");
      if (!item) break;
      item.status = "loading";
      this.running++;
      this.run(item).finally(() => { this.running--; this.changed(); this.pump(); });
    }
  }

  async run(item) {
    item.controller = new AbortController();
    const begin = performance.now();
    const initialSize = item.size;
    try {
      const response = await fetch(proxyUrl(item.url, { adblock: this.options().adblock, cache: false, type: "other" }), {
        signal: item.controller.signal, credentials: "omit",
        headers: item.size ? { Range: `bytes=${item.size}-` } : {},
      });
      if (response.headers.get("X-Bromine-Adblock") === "blocked") throw new Error("The download was filtered by uBlock Origin.");
      if (!response.ok) throw new Error(`Proxy download failed (HTTP ${response.status}).`);
      if (item.size && response.status !== 206) {
        item.chunks = []; item.size = 0;
        this.notify("The server does not support resuming this file. Download restarted.");
      }
      const range = response.headers.get("content-range");
      if (range && item.size && !range.startsWith(`bytes ${item.size}-`)) throw new Error("The server returned an inconsistent download range.");
      item.total = range ? Number(range.split("/").pop()) : Number(response.headers.get("content-length") || 0);
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        item.chunks.push(value);
        item.size += value.byteLength;
        item.speed = (item.size - initialSize) / Math.max((performance.now() - begin) / 1000, .01);
        this.changed();
      }
      item.blob = URL.createObjectURL(new Blob(item.chunks, { type: response.headers.get("content-type") || "application/octet-stream" }));
      item.chunks = [];
      item.status = "saved";
      this.save(item);
    } catch (error) {
      if (!["paused", "cancelled"].includes(item.status)) { item.status = "failed"; item.error = error.message; item.chunks = []; item.size = 0; }
    }
  }

  save(item) {
    const link = document.createElement("a");
    link.href = item.blob; link.download = item.name; link.click();
  }

  action(item, action) {
    if (action === "pause") { item.status = "paused"; item.controller.abort(); }
    if (action === "resume") { item.status = "queued"; this.pump(); }
    if (action === "retry") { item.size = 0; item.chunks = []; item.error = ""; item.status = "queued"; this.pump(); }
    if (action === "cancel") { item.status = "cancelled"; item.controller?.abort(); item.chunks = []; }
    if (action === "save") this.save(item);
    if (action === "remove") {
      item.controller?.abort();
      if (item.blob) URL.revokeObjectURL(item.blob);
      this.items = this.items.filter((row) => row !== item);
    }
    this.changed();
  }

  snapshot() {
    return this.items.slice(0, 50).map(({ url, name, route, status, size, time }) => ({ url: redactUrl(url), name, route, status, size, time }));
  }
}
