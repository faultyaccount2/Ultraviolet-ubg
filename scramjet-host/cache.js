const cacheName = "bromine-scramjet-public-v1";
const assetTypes = new Set(["script", "style", "image", "font", "audio", "video", "track"]);
const maxEntryBytes = 16 * 1024 * 1024;
const sensitiveParameter = /auth|password|passwd|token|key|secret|session|signature|^code$/i;

export function publicAssetRequest({ url, method, headers, destination, cacheMode }) {
  return method === "GET" && assetTypes.has(destination) && cacheMode !== "no-store" &&
    !["authorization", "cookie", "range"].some((name) => headers.has(name)) &&
    ![...new URL(url).searchParams.keys()].some((key) => sensitiveParameter.test(key));
}

export function publicAssetTtl(headers, status, now = Date.now()) {
  if (status !== 200 || headers.has("set-cookie") || /private|no-store|no-cache/i.test(headers.get("cache-control") || "") ||
      /(?:^|,)\s*(?:\*|cookie|authorization)\s*(?:,|$)/i.test(headers.get("vary") || "")) return 0;
  const control = headers.get("cache-control") || "";
  const maxAge = Number(control.match(/(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i)?.[1]);
  const age = Number(headers.get("age") || 0);
  const date = Date.parse(headers.get("date") || "");
  const lifetime = Number.isFinite(maxAge) ? maxAge : (Date.parse(headers.get("expires") || "") - (Number.isFinite(date) ? date : now)) / 1000;
  if (!Number.isFinite(age) || age < 0 || !Number.isFinite(lifetime)) return 0;
  return Math.max(0, Math.min(900, lifetime - Math.max(age, Number.isFinite(date) ? Math.max(0, (now - date) / 1000) : 0)));
}

function keyFor({ url, site, version, destination, headers }) {
  const key = new URL("https://bromine-cache.invalid/");
  key.search = new URLSearchParams({ url, site, version, destination });
  return new Request(key, { headers });
}

export class PublicAssetCache {
  constructor(storage, onError) {
    this.storage = storage;
    this.onError = onError;
    this.limitMB = 256;
    this.pending = Promise.resolve();
  }

  async records() {
    const cache = await this.storage.open(cacheName);
    return (await Promise.all((await cache.keys()).map(async (request) => {
      const response = await cache.match(request);
      if (!response) return null;
      return { request, bytes: Number(response.headers.get("X-Bromine-Size") || 0), used: Number(response.headers.get("X-Bromine-Used") || 0) };
    }))).filter(Boolean);
  }

  async stats() {
    await this.pending;
    const rows = await this.records();
    return { bytes: rows.reduce((total, row) => total + row.bytes, 0), entries: rows.length, limitMB: this.limitMB };
  }

  async evict() {
    const rows = (await this.records()).sort((left, right) => left.used - right.used);
    let bytes = rows.reduce((total, row) => total + row.bytes, 0);
    let count = rows.length;
    const cache = await this.storage.open(cacheName);
    for (const row of rows) {
      if (count <= 200 && bytes <= this.limitMB * 1024 * 1024) break;
      await cache.delete(row.request);
      bytes -= row.bytes;
      count--;
    }
  }

  async match(options) {
    if (["reload", "no-cache", "no-store"].includes(options.cacheMode) || !publicAssetRequest(options)) return null;
    await this.pending;
    const cache = await this.storage.open(cacheName);
    const key = keyFor(options);
    const cached = await cache.match(key);
    if (!cached) return null;
    if (Date.now() >= Number(cached.headers.get("X-Bromine-Expires") || 0)) {
      await cache.delete(key);
      return null;
    }
    const headers = new Headers(cached.headers);
    headers.set("X-Bromine-Used", String(Date.now()));
    headers.set("Age", String(Math.max(0, Math.floor((Date.now() - Number(headers.get("X-Bromine-Stored"))) / 1000)) + Number(headers.get("X-Bromine-Upstream-Age") || 0)));
    const response = new Response(cached.body, { status: cached.status, headers });
    await cache.put(key, response.clone());
    return response;
  }

  put(options, response, rawHeaders) {
    const received = Date.now();
    const headers = new Headers(rawHeaders);
    const ttl = publicAssetTtl(headers, response.status, received);
    if (!publicAssetRequest(options) || !ttl || Number(headers.get("content-length")) > Math.min(maxEntryBytes, this.limitMB * 1024 * 1024)) return;
    const key = keyFor(options);
    if ((headers.get("vary") || "").split(",").some((name) => name.trim() && key.headers.get(name.trim()) !== options.headers.get(name.trim()))) return;
    const copy = response.clone();
    this.pending = this.pending.then(async () => {
      const reader = copy.body?.getReader();
      if (!reader) return;
      const chunks = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxEntryBytes || bytes > this.limitMB * 1024 * 1024) {
          reader.cancel().catch((error) => this.onError(error));
          return;
        }
        chunks.push(value);
      }
      if (Date.now() >= received + ttl * 1000) return;
      headers.set("X-Bromine-Size", String(bytes));
      headers.set("X-Bromine-Used", String(Date.now()));
      headers.set("X-Bromine-Stored", String(received));
      headers.set("X-Bromine-Upstream-Age", headers.get("age") || "0");
      headers.set("X-Bromine-Expires", String(received + ttl * 1000));
      await (await this.storage.open(cacheName)).put(key, new Response(new Blob(chunks), { status: response.status, headers }));
      await this.evict();
    }).catch((error) => this.onError(error));
  }

  async clear({ site, category } = {}) {
    await this.pending;
    const cache = await this.storage.open(cacheName);
    for (const row of await this.records()) {
      const query = new URL(row.request.url).searchParams;
      const destination = query.get("destination");
      const kind = destination === "image" || destination === "font" ? destination : ["audio", "video", "track"].includes(destination) ? "media" : "http";
      if (site && query.get("site") !== site && new URL(query.get("url")).hostname !== site || category && kind !== category) continue;
      await cache.delete(row.request);
    }
    return this.stats();
  }
}
