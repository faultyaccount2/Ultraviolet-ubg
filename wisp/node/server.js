// Standalone Wisp server for Render (or any Node host).
// HTTP:      GET /healthz -> 200 "ok"; everything else -> 404
// WebSocket: wss://<host>/wisp/  (path configurable with WISP_PATH)
import http from "node:http";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import { loadConfig } from "./config.js";

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`[wisp] Configuration error: ${error.message}`);
  process.exit(1);
}

Object.assign(wisp.options, config.wisp);
const levels = { debug: logging.DEBUG, info: logging.INFO, warn: logging.WARN, error: logging.ERROR, none: logging.NONE };
logging.set_level(levels[config.logLevel] ?? logging.INFO);

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket.remoteAddress || "unknown";
}

const perIp = new Map();

const server = http.createServer((req, res) => {
  if (req.url === "/healthz" || req.url === "/") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    return res.end(req.url === "/" ? `Wisp server running. Connect to ${config.path}\n` : "ok\n");
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found\n");
});

function reject(socket, status, message) {
  socket.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${message}\n`);
}

server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname !== config.path) return reject(socket, "404 Not Found", "Unknown WebSocket path.");

  // Origin is a browser courtesy check, not authentication: non-browser clients can send any value.
  if (config.allowedOrigins.size && !config.allowedOrigins.has(req.headers.origin || "")) {
    return reject(socket, "403 Forbidden", "Origin not allowed.");
  }

  const ip = clientIp(req);
  const open = perIp.get(ip) || 0;
  if (open >= config.maxConnectionsPerIp) return reject(socket, "429 Too Many Requests", "Too many connections.");
  perIp.set(ip, open + 1);
  socket.once("close", () => {
    const n = (perIp.get(ip) || 1) - 1;
    if (n <= 0) perIp.delete(ip); else perIp.set(ip, n);
  });

  wisp.routeRequest(req, socket, head);
});

// Render sends SIGTERM on deploys; close cleanly so clients reconnect to the new instance.
process.on("SIGTERM", () => {
  console.log("[wisp] SIGTERM received, shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`[wisp] Listening on 0.0.0.0:${config.port}, Wisp path ${config.path}`);
  console.log(`[wisp] Hosts: ${config.wisp.hostname_whitelist ? "allowlist" : config.wisp.hostname_blacklist ? "blocklist" : "any public host"}; ports: ${JSON.stringify(config.wisp.port_whitelist)}; UDP: ${config.wisp.allow_udp_streams}; origins: ${config.allowedOrigins.size ? [...config.allowedOrigins].join(", ") : "any"}`);
});
