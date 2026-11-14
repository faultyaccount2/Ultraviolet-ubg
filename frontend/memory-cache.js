const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 200;

function matches(stored, request, options = {}) {
  if (request.method !== "GET" && !options.ignoreMethod) return false;
  const left = new URL(stored.request.url);
  const right = new URL(request.url);
  left.hash = right.hash = "";
  if (options.ignoreSearch) left.search = right.search = "";
  if (left.href !== right.href) return false;
  if (options.ignoreVary) return true;
  const vary = stored.response.headers.get("vary");
  return !vary || vary.split(",").every((name) => stored.request.headers.get(name.trim()) === request.headers.get(name.trim()));
}

// Each document owns this storage; it never uses the app's native CacheStorage.
export class MemoryCacheStorage {
  constructor() {
    this.stores = new Map();
    this.bytes = 0;
    this.entries = 0;
  }
  async open(name) {
    name = String(name);
    if (!this.stores.has(name)) {
      if (this.stores.size >= MAX_ENTRIES) throw new DOMException("The document cache limit was reached.", "QuotaExceededError");
      this.stores.set(name, new MemoryCache(this));
    }
    return this.stores.get(name);
  }
  async has(name) { return this.stores.has(String(name)); }
  async keys() { return [...this.stores.keys()]; }
  async delete(name) {
    const cache = this.stores.get(String(name));
    if (!cache) return false;
    // Open Cache objects remain usable after their name is removed.
    return this.stores.delete(String(name));
  }
  async match(input, options = {}) {
    for (const [name, cache] of this.stores) {
      if (options.cacheName !== undefined && name !== String(options.cacheName)) continue;
      const response = await cache.match(input, options);
      if (response) return response;
    }
  }
}

export class MemoryCache {
  constructor(storage) {
    this.storage = storage;
    this.records = [];
  }
  async match(input, options) { return (await this.matchAll(input, options))[0]; }
  async matchAll(input, options) {
    const request = input === undefined ? undefined : new Request(input);
    return this.records.filter((record) => !request || matches(record, request, options)).map((record) => record.response.clone());
  }
  async keys(input, options) {
    const request = input === undefined ? undefined : new Request(input);
    return this.records.filter((record) => !request || matches(record, request, options)).map((record) => record.request.clone());
  }
  async put(input, response) {
    const request = new Request(input);
    if (request.method !== "GET" || !/^https?:$/.test(new URL(request.url).protocol) ||
        response.status === 206 || response.headers.get("vary")?.split(",").some((name) => name.trim() === "*")) {
      throw new TypeError("This request or response cannot be cached.");
    }
    const snapshot = response.clone();
    const copy = snapshot.clone();
    const reader = copy.body?.getReader();
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          reader.cancel().catch((error) => console.error("Document cache stream cancellation failed:", error));
          throw new DOMException("The document cache byte limit was reached.", "QuotaExceededError");
        }
      }
    }
    const previous = this.records.filter((record) => matches(record, request));
    const bytes = this.storage.bytes + size - previous.reduce((total, record) => total + record.size, 0);
    const entries = this.storage.entries + 1 - previous.length;
    if (bytes > MAX_BYTES || entries > MAX_ENTRIES) throw new DOMException("The document cache limit was reached.", "QuotaExceededError");
    this.records = this.records.filter((record) => !previous.includes(record));
    this.records.push({ request, response: snapshot, size });
    this.storage.bytes = bytes;
    this.storage.entries = entries;
  }
  async delete(input, options) {
    const request = new Request(input);
    const previous = this.records.filter((record) => matches(record, request, options));
    this.records = this.records.filter((record) => !previous.includes(record));
    this.storage.bytes -= previous.reduce((total, record) => total + record.size, 0);
    this.storage.entries -= previous.length;
    return previous.length > 0;
  }
  async add(input) {
    const response = await fetch(input);
    if (!response.ok) throw new TypeError("The cache fetch did not succeed.");
    await this.put(input, response);
  }
}
