import ipaddr from "ipaddr.js";

export class BareError extends Error {
  constructor(status, code, message, id) {
    super(message);
    this.status = status;
    this.code = code;
    this.id = id;
  }
}

export function entries(value = "") {
  return value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function blockedHost(host, env) {
  return entries(env.BARE_BLOCKED_HOSTS).some((blocked) =>
    host === blocked || blocked.startsWith("*.") && host.endsWith(blocked.slice(1)));
}

function publicAddress(host) {
  if (!ipaddr.isValid(host)) return false;
  return ipaddr.process(host).range() === "unicast";
}

function internalHost(host) {
  return !host.includes(".") || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(host);
}

export function targetUrl(value, env, websocket = false) {
  let url;
  try { url = new URL(value); }
  catch { throw new BareError(400, "INVALID_BARE_HEADER", "Invalid destination URL."); }
  if (!(websocket ? ["ws:", "wss:"] : ["http:", "https:"]).includes(url.protocol) ||
      url.username || url.password || url.hash || url.port) {
    throw new BareError(403, "FORBIDDEN", "Only public default-port HTTP(S) or WebSocket destinations without credentials are allowed.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (ipaddr.isValid(host) ? !publicAddress(host) : internalHost(host)) {
    throw new BareError(403, "FORBIDDEN", "Private, reserved and internal destinations are blocked.");
  }
  if (blockedHost(host, env)) throw new BareError(403, "FORBIDDEN", "This destination is blocked.");
  return url;
}

export async function resolvePublic(host, fetcher = fetch, env = {}) {
  if (ipaddr.isValid(host)) return;
  const answers = await Promise.all(["A", "AAAA"].map(async (type) => {
    const response = await fetcher(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new BareError(502, "DNS_FAILED", "Destination DNS lookup failed.");
    const data = await response.json();
    if (data.Status !== 0) throw new BareError(502, "DNS_FAILED", "Destination DNS lookup failed.");
    const records = data.Answer || [];
    for (const record of records) {
      if (record.type === 5) {
        const alias = record.data.toLowerCase().replace(/\.$/, "");
        if (internalHost(alias)) throw new BareError(403, "FORBIDDEN", "The destination aliases an internal host.");
        if (blockedHost(alias, env)) throw new BareError(403, "FORBIDDEN", "The destination aliases a blocked host.");
      }
    }
    return records.filter((record) => record.type === 1 || record.type === 28).map((record) => record.data);
  }));
  const addresses = answers.flat();
  if (!addresses.length) throw new BareError(502, "DNS_FAILED", "The destination has no public DNS addresses.");
  if (addresses.some((address) => !publicAddress(address))) {
    throw new BareError(403, "FORBIDDEN", "The destination resolves to a private or reserved address.");
  }
}
