import ipaddr from "ipaddr.js";

export function isPublicAddress(address) {
  if (!ipaddr.isValid(address)) return false;
  const ip = ipaddr.process(address);
  return ip.range() === "unicast" && (ip.kind() === "ipv4" || ip.match(ipaddr.parse("2000::"), 3));
}

export function validateNavigation(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Enter a valid HTTP(S) address."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP(S) websites are supported.");
  if (url.username || url.password) throw new Error("Addresses containing credentials are not supported.");
  if (url.port) throw new Error("Only standard HTTP(S) ports are supported.");
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const literal = ipaddr.isValid(host);
  if (!host || (!host.includes(".") && !literal) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) ||
      literal && !isPublicAddress(host)) throw new Error("Private or internal destinations are blocked.");
  return url;
}

export function redactUrl(value) {
  const url = new URL(value);
  for (const name of [...url.searchParams.keys()]) {
    if (/password|passwd|token|api.?key|secret|authorization|session|^code$/i.test(name)) url.searchParams.delete(name);
  }
  if (/token|password|secret|authorization/i.test(url.hash)) url.hash = "";
  url.username = "";
  url.password = "";
  return url.href;
}
