export const proxyParameters = new Set(["url", "adblock", "origin", "type", "logging", "cache"]);

export function proxyUrl(value, options = {}) {
  const url = new URL(value);
  const fragment = url.hash;
  url.hash = "";
  const query = new URLSearchParams({ url: url.href });
  if (options.adblock !== undefined) query.set("adblock", options.adblock ? "1" : "0");
  if (options.origin) query.set("origin", options.origin);
  if (options.type) query.set("type", options.type);
  if (options.logging !== undefined) query.set("logging", options.logging ? "1" : "0");
  if (options.cache !== undefined) query.set("cache", options.cache ? "1" : "0");
  return `/api/proxy?${query}${fragment}`;
}

export function unproxyUrl(value, base) {
  const url = new URL(value, base);
  if (url.pathname === "/api/proxy" && url.searchParams.has("url")) {
    const target = new URL(url.searchParams.get("url"));
    for (const [name, value] of url.searchParams) {
      if (!proxyParameters.has(name)) target.searchParams.append(name, value);
    }
    target.hash = url.hash;
    return target.href;
  }
  return url.href;
}
