export const storageSeedPrefix = "bromine:site-storage:";
const maximumBytes = 1024 * 1024;

export function validStorageEntries(entries) {
  return Array.isArray(entries) && entries.length <= 1024 &&
    entries.every((entry) => Array.isArray(entry) && entry.length === 2 && entry.every((value) => typeof value === "string")) &&
    new Set(entries.map(([key]) => key)).size === entries.length && JSON.stringify(entries).length * 2 <= maximumBytes;
}

export function siteStorage(entries = [], changed = () => {}) {
  const values = new Map(entries);
  const methods = Object.create(null);
  const snapshot = () => [...values];
  const update = (key, value) => {
    key = String(key);
    value = String(value);
    if (values.get(key) === value) return;
    const next = new Map(values).set(key, value);
    if (!validStorageEntries([...next])) throw new DOMException("Site storage is limited to 1 MB and 1024 keys per origin.", "QuotaExceededError");
    values.set(key, value);
    changed(snapshot());
  };
  const remove = (key) => { if (values.delete(String(key))) changed(snapshot()); };
  Object.defineProperties(methods, {
    getItem: { value: (key) => values.get(String(key)) ?? null, configurable: true },
    setItem: { value: update, configurable: true },
    removeItem: { value: remove, configurable: true },
    clear: { value: () => { if (values.size) { values.clear(); changed([]); } }, configurable: true },
    key: { value: (index) => [...values.keys()][index] ?? null, configurable: true },
    length: { get: () => values.size, configurable: true },
  });
  const storage = new Proxy(methods, {
    get: (object, name) => name in object ? Reflect.get(object, name) : values.get(String(name)),
    set: (_object, name, value) => { update(name, value); return true; },
    deleteProperty: (_object, name) => { remove(name); return true; },
    ownKeys: () => [...values.keys()],
    has: (object, name) => name in object || values.has(String(name)),
    getOwnPropertyDescriptor: (object, name) => Reflect.getOwnPropertyDescriptor(object, name) ||
      (values.has(String(name)) ? { configurable: true, enumerable: true, writable: true, value: values.get(String(name)) } : undefined),
  });
  return { storage, snapshot };
}
