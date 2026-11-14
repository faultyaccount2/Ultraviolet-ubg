function normalizedHostname(value) {
  const candidate = value.trim().toLowerCase().replace(/\.$/, "");
  if (!candidate || candidate.includes("*") || candidate.includes("/") || candidate.includes(":")) {
    throw new Error("Relay allowlist entries must be exact DNS hostnames.");
  }
  let hostname;
  try { hostname = new URL(`https://${candidate}`).hostname.toLowerCase().replace(/\.$/, ""); }
  catch { throw new Error("Relay allowlist contains an invalid hostname."); }
  if (hostname !== candidate || !/^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(hostname) ||
      /^\d+(?:\.\d+){3}$/.test(hostname) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(hostname)) {
    throw new Error("Relay allowlist entries must be public DNS hostnames, not IP or local addresses.");
  }
  return hostname;
}

export function parseWebSocketAllowlist(value) {
  if (String(value || "").length > 4096) throw new Error("The WebSocket host allowlist is too long.");
  const hosts = String(value || "").split(",").map((host) => host.trim()).filter(Boolean);
  if (!hosts.length || hosts.length > 100) throw new Error("The WebSocket relay needs between 1 and 100 approved destination hosts.");
  return new Set(hosts.map(normalizedHostname));
}

export function validateWebSocketTarget(value, allowedHosts) {
  if (typeof value !== "string" || value.length > 4096) throw new Error("The WebSocket target is invalid or too long.");
  let target;
  try { target = new URL(value); }
  catch { throw new Error("The WebSocket target must be a valid secure address."); }
  const hostname = target.hostname.toLowerCase().replace(/\.$/, "");
  if (target.protocol !== "wss:" || target.username || target.password || target.port ||
      !allowedHosts.has(hostname) || !/^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(hostname) ||
      /^\d+(?:\.\d+){3}$/.test(hostname) || hostname.includes(":") ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(hostname)) {
    throw new Error("This secure WebSocket destination is not on the approved host list.");
  }
  target.hash = "";
  return target;
}

export function validateWebSocketProtocols(value) {
  if (!Array.isArray(value) || value.length > 20 ||
      value.some((protocol) => typeof protocol !== "string" || protocol.length > 128 ||
        !/^[!#$%&'*+\-.^_`|~\da-z]+$/i.test(protocol)) ||
      new Set(value).size !== value.length) {
    throw new Error("The requested WebSocket protocols are invalid.");
  }
  return value;
}
