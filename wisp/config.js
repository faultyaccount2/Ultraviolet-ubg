// Reads and validates the Wisp server's settings from environment variables.
// Every value is optional; unsafe or malformed values fail at startup.

function list(value) {
  return String(value || "").split(",").map((v) => v.trim()).filter(Boolean);
}

function int(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be a whole number between ${min} and ${max} (got "${raw}").`);
  }
  return n;
}

function bool(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (/^(1|true|yes)$/i.test(raw)) return true;
  if (/^(0|false|no)$/i.test(raw)) return false;
  throw new Error(`${name} must be true or false (got "${raw}").`);
}

function hostPattern(entry) {
  const host = entry.toLowerCase().replace(/\.$/, "");
  if (!/^(\*\.)?([a-z\d]([a-z\d-]{0,61}[a-z\d])?\.)+[a-z\d-]{2,63}$/.test(host)) {
    throw new Error(`WISP_ALLOWED_HOSTS / WISP_BLOCKED_HOSTS entry "${entry}" is not a hostname (use example.com or *.example.com).`);
  }
  const escaped = host.replace(/\./g, "\\.");
  return host.startsWith("*.")
    ? new RegExp(`^([a-z\\d-]+\\.)+${escaped.slice(3)}$`, "i")
    : new RegExp(`^${escaped}$`, "i");
}

function portEntry(entry) {
  const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(entry);
  if (!m) throw new Error(`WISP_ALLOWED_PORTS entry "${entry}" must be a port or range like 443 or 8000-8100.`);
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  if (a < 1 || b > 65535 || a > b) throw new Error(`WISP_ALLOWED_PORTS entry "${entry}" is out of range.`);
  return a === b ? a : [a, b];
}

function origin(entry) {
  let u;
  try { u = new URL(entry); } catch { throw new Error(`WISP_ALLOWED_ORIGINS entry "${entry}" is not a URL.`); }
  if (!["https:", "http:"].includes(u.protocol) || u.pathname !== "/" || u.search || u.hash || entry.endsWith("/")) {
    throw new Error(`WISP_ALLOWED_ORIGINS entry "${entry}" must be an exact origin like https://app.example.com (no path or trailing slash).`);
  }
  return u.origin;
}

export function loadConfig(env = process.env) {
  const allowedHosts = list(env.WISP_ALLOWED_HOSTS);
  const blockedHosts = list(env.WISP_BLOCKED_HOSTS);
  if (allowedHosts.length && blockedHosts.length) {
    throw new Error("Set WISP_ALLOWED_HOSTS or WISP_BLOCKED_HOSTS, not both.");
  }
  const path = env.WISP_PATH || "/wisp/";
  if (!/^\/[\w\-/]*\/$/.test(path)) throw new Error(`WISP_PATH must start and end with "/" (got "${path}").`);

  return {
    port: int(env, "PORT", 10000, 1, 65535),
    path,
    allowedOrigins: new Set(list(env.WISP_ALLOWED_ORIGINS).map(origin)),
    wisp: {
      hostname_whitelist: allowedHosts.length ? allowedHosts.map(hostPattern) : null,
      hostname_blacklist: blockedHosts.length ? blockedHosts.map(hostPattern) : null,
      port_whitelist: list(env.WISP_ALLOWED_PORTS || "80,443").map(portEntry),
      allow_direct_ip: false,
      allow_private_ips: false,
      allow_loopback_ips: false,
      allow_udp_streams: bool(env, "WISP_ALLOW_UDP", false),
      allow_tcp_streams: true,
      stream_limit_per_host: int(env, "WISP_STREAM_LIMIT_PER_HOST", 32, 1, 1000),
      stream_limit_total: int(env, "WISP_STREAM_LIMIT_TOTAL", 128, 1, 10000),
      // Render's proxy sits in front of the app, so trust its X-Forwarded-For for logging only.
      parse_real_ip: true,
      parse_real_ip_from: list(env.WISP_TRUSTED_PROXIES || "127.0.0.1,::1,::ffff:127.0.0.1,10.0.0.0/8").filter((v) => !v.includes("/")),
      dns_method: "lookup",
      wisp_motd: env.WISP_MOTD || null,
    },
    maxConnectionsPerIp: int(env, "WISP_MAX_CONNECTIONS_PER_IP", 8, 1, 1000),
    logLevel: (env.WISP_LOG_LEVEL || "info").toLowerCase(),
  };
}
