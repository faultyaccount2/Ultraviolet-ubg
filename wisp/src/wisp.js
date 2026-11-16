// Wisp v1 server core for Cloudflare Workers.
// Spec: https://github.com/MercuryWorkshop/wisp-protocol (v1).
// This file has no Cloudflare imports so it can be unit-tested in Node:
// the Worker passes in `connect` (from "cloudflare:sockets") and the WebSocket.

export const PACKET = { CONNECT: 0x01, DATA: 0x02, CONTINUE: 0x03, CLOSE: 0x04 };
export const STREAM = { TCP: 0x01, UDP: 0x02 };
export const REASON = {
  VOLUNTARY: 0x02,
  NETWORK_ERROR: 0x03,
  INVALID_INFO: 0x41,
  UNREACHABLE: 0x42,
  TIMEOUT: 0x43,
  REFUSED: 0x44,
  BLOCKED: 0x48,
  THROTTLED: 0x49,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------- config ----------

function list(value) {
  return String(value ?? "").split(",").map((v) => v.trim()).filter(Boolean);
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
    throw new Error(`Host entry "${entry}" is not a hostname (use example.com or *.example.com).`);
  }
  return host.startsWith("*.")
    ? (h) => h.endsWith(host.slice(1))
    : (h) => h === host;
}

function portEntry(entry) {
  const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(entry);
  if (!m) throw new Error(`WISP_ALLOWED_PORTS entry "${entry}" must be a port or range like 443 or 8000-8100.`);
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  if (a < 1 || b > 65535 || a > b) throw new Error(`WISP_ALLOWED_PORTS entry "${entry}" is out of range.`);
  return [a, b];
}

function origin(entry) {
  let u;
  try { u = new URL(entry); } catch { throw new Error(`WISP_ALLOWED_ORIGINS entry "${entry}" is not a URL.`); }
  if (!["https:", "http:"].includes(u.protocol) || u.pathname !== "/" || u.search || u.hash || entry.endsWith("/")) {
    throw new Error(`WISP_ALLOWED_ORIGINS entry "${entry}" must be an exact origin like https://app.example.com (no path or trailing slash).`);
  }
  return u.origin;
}

export function loadConfig(env = {}) {
  const allowed = list(env.WISP_ALLOWED_HOSTS);
  const blocked = list(env.WISP_BLOCKED_HOSTS);
  if (allowed.length && blocked.length) throw new Error("Set WISP_ALLOWED_HOSTS or WISP_BLOCKED_HOSTS, not both.");
  const path = env.WISP_PATH || "/wisp/";
  if (!/^\/[\w\-/]*\/$/.test(path)) throw new Error(`WISP_PATH must start and end with "/" (got "${path}").`);
  return {
    path,
    allowedOrigins: new Set(list(env.WISP_ALLOWED_ORIGINS).map(origin)),
    allowedHosts: allowed.length ? allowed.map(hostPattern) : null,
    blockedHosts: blocked.length ? blocked.map(hostPattern) : null,
    allowedPorts: list(env.WISP_ALLOWED_PORTS || "80,443").map(portEntry),
    allowDirectIp: bool(env, "WISP_ALLOW_DIRECT_IP", false),
    streamLimitTotal: int(env, "WISP_STREAM_LIMIT_TOTAL", 32, 1, 1000),
    streamLimitPerHost: int(env, "WISP_STREAM_LIMIT_PER_HOST", 6, 1, 1000),
    bufferSize: int(env, "WISP_BUFFER_SIZE", 128, 4, 4096),
    connectTimeoutMs: int(env, "WISP_CONNECT_TIMEOUT_MS", 10000, 1000, 60000),
  };
}

// ---------- validation ----------

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function checkDestination(cfg, type, host, port) {
  if (type !== STREAM.TCP) return REASON.INVALID_INFO; // Workers have no UDP.
  if (!host || host.length > 253 || !Number.isInteger(port) || port < 1 || port > 65535) return REASON.INVALID_INFO;
  const h = host.toLowerCase().replace(/\.$/, "");
  const isIp = IPV4.test(h) || h.includes(":") || h.startsWith("[");
  if (isIp && !cfg.allowDirectIp) return REASON.BLOCKED;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return REASON.BLOCKED;
  if (!cfg.allowedPorts.some(([a, b]) => port >= a && port <= b)) return REASON.BLOCKED;
  if (cfg.allowedHosts && !cfg.allowedHosts.some((m) => m(h))) return REASON.BLOCKED;
  if (cfg.blockedHosts && cfg.blockedHosts.some((m) => m(h))) return REASON.BLOCKED;
  return 0;
}

// ---------- packets ----------

export function packet(type, streamId, payload) {
  const len = payload ? payload.byteLength : 0;
  const out = new Uint8Array(5 + len);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, streamId, true);
  if (len) out.set(payload, 5);
  return out;
}

export function continuePacket(streamId, remaining) {
  const p = new Uint8Array(4);
  new DataView(p.buffer).setUint32(0, remaining, true);
  return packet(PACKET.CONTINUE, streamId, p);
}

export function closePacket(streamId, reason) {
  return packet(PACKET.CLOSE, streamId, new Uint8Array([reason]));
}

export function connectPacket(streamId, type, port, host) {
  const h = encoder.encode(host);
  const p = new Uint8Array(3 + h.length);
  p[0] = type;
  new DataView(p.buffer).setUint16(1, port, true);
  p.set(h, 3);
  return packet(PACKET.CONNECT, streamId, p);
}

export function parsePacket(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.byteLength < 5) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return { type: u8[0], streamId: dv.getUint32(1, true), payload: u8.subarray(5) };
}

// ---------- session ----------

/**
 * One Wisp session over one WebSocket.
 * ws: { send(Uint8Array), close(code, reason) }
 * connect: (address: {hostname, port}) => { readable, writable, opened, closed, close() }
 */
export class WispSession {
  constructor(ws, connect, cfg, log = () => {}) {
    this.ws = ws;
    this.connect = connect;
    this.cfg = cfg;
    this.log = log;
    this.streams = new Map();
    this.perHost = new Map();
    this.closed = false;
  }

  start() {
    this.send(continuePacket(0, this.cfg.bufferSize));
  }

  send(u8) {
    if (this.closed) return;
    try { this.ws.send(u8); } catch { this.shutdown(); }
  }

  onMessage(data) {
    if (typeof data === "string") return this.fail("text frames are not allowed");
    const p = parsePacket(data);
    if (!p) return this.fail("short packet");
    switch (p.type) {
      case PACKET.CONNECT: return this.onConnect(p);
      case PACKET.DATA: return this.onData(p);
      case PACKET.CLOSE: return this.closeStream(p.streamId, null);
      case PACKET.CONTINUE: return; // client never needs to send this to a server
      default: return; // unknown packet types are ignored per spec
    }
  }

  onConnect({ streamId, payload }) {
    if (streamId === 0 || this.streams.has(streamId)) return this.send(closePacket(streamId, REASON.INVALID_INFO));
    if (payload.byteLength < 4) return this.send(closePacket(streamId, REASON.INVALID_INFO));
    const type = payload[0];
    const port = payload[1] | (payload[2] << 8);
    const host = decoder.decode(payload.subarray(3));
    const bad = checkDestination(this.cfg, type, host, port);
    if (bad) {
      this.log("blocked", host, port);
      return this.send(closePacket(streamId, bad));
    }
    const key = host.toLowerCase();
    if (this.streams.size >= this.cfg.streamLimitTotal || (this.perHost.get(key) || 0) >= this.cfg.streamLimitPerHost) {
      return this.send(closePacket(streamId, REASON.THROTTLED));
    }

    let socket;
    try {
      socket = this.connect({ hostname: host, port });
    } catch (e) {
      this.log("connect threw", host, port, e?.message);
      return this.send(closePacket(streamId, REASON.UNREACHABLE));
    }

    const stream = {
      key,
      socket,
      writer: socket.writable.getWriter(),
      chain: Promise.resolve(),
      pending: 0,
      sinceContinue: 0,
      done: false,
      timer: null,
    };
    this.streams.set(streamId, stream);
    this.perHost.set(key, (this.perHost.get(key) || 0) + 1);

    const timeout = new Promise((_, rej) => {
      stream.timer = setTimeout(() => rej(new Error("timeout")), this.cfg.connectTimeoutMs);
    });
    Promise.race([socket.opened, timeout]).then(
      () => { clearTimeout(stream.timer); if (!stream.done) this.pump(streamId, stream); },
      (e) => {
        clearTimeout(stream.timer);
        this.log("connect failed", host, port, e?.message);
        this.closeStream(streamId, e?.message === "timeout" ? REASON.TIMEOUT : REASON.UNREACHABLE);
      },
    );
  }

  async pump(streamId, stream) {
    const reader = stream.socket.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || stream.done) break;
        if (value && value.byteLength) this.send(packet(PACKET.DATA, streamId, value));
      }
      this.closeStream(streamId, REASON.VOLUNTARY);
    } catch {
      this.closeStream(streamId, REASON.NETWORK_ERROR);
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  onData({ streamId, payload }) {
    const stream = this.streams.get(streamId);
    if (!stream || stream.done) return;
    // Copy: the WebSocket may reuse the underlying buffer.
    const chunk = payload.slice();
    stream.pending++;
    stream.chain = stream.chain.then(async () => {
      if (stream.done) return;
      await stream.writer.write(chunk);
      stream.pending--;
      stream.sinceContinue++;
      if (stream.sinceContinue >= this.cfg.bufferSize / 2) {
        stream.sinceContinue = 0;
        this.send(continuePacket(streamId, this.cfg.bufferSize - stream.pending));
      }
    }).catch(() => this.closeStream(streamId, REASON.NETWORK_ERROR));
  }

  closeStream(streamId, reason) {
    const stream = this.streams.get(streamId);
    if (!stream) return;
    stream.done = true;
    clearTimeout(stream.timer);
    this.streams.delete(streamId);
    const n = (this.perHost.get(stream.key) || 1) - 1;
    if (n) this.perHost.set(stream.key, n); else this.perHost.delete(stream.key);
    try { stream.writer.releaseLock(); } catch {}
    try { stream.socket.close(); } catch {}
    if (reason) this.send(closePacket(streamId, reason));
  }

  fail(why) {
    this.log("closing session:", why);
    try { this.ws.close(1003, why); } catch {}
    this.shutdown();
  }

  shutdown() {
    if (this.closed) return;
    for (const id of [...this.streams.keys()]) this.closeStream(id, null);
    this.closed = true;
  }
}
