// Cloudflare Worker entry: serves a Wisp v1 endpoint for Ultraviolet / Scramjet.
import { connect } from "cloudflare:sockets";
import { loadConfig, WispSession } from "./wisp.js";

let cached;
function config(env) {
  // env is the same object for every request in an isolate, so parse once.
  if (!cached || cached.env !== env) cached = { env, cfg: loadConfig(env) };
  return cached.cfg;
}

export default {
  async fetch(request, env) {
    let cfg;
    try {
      cfg = config(env);
    } catch (e) {
      return new Response(`Wisp config error: ${e.message}\n`, { status: 500 });
    }

    const url = new URL(request.url);
    if (url.pathname === "/healthz") return new Response("ok\n");

    const onPath = url.pathname === cfg.path || url.pathname === cfg.path.slice(0, -1);
    if (!onPath) return new Response("Not found\n", { status: 404 });

    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("This is a Wisp endpoint. Connect with a WebSocket (wss://).\n", {
        status: 426,
        headers: { Upgrade: "websocket" },
      });
    }

    if (cfg.allowedOrigins.size) {
      const o = request.headers.get("Origin");
      if (!o || !cfg.allowedOrigins.has(o)) return new Response("Origin not allowed\n", { status: 403 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    // Newer compatibility dates deliver binary frames as Blob; ask for ArrayBuffer.
    try { server.binaryType = "arraybuffer"; } catch {}
    server.accept();

    const session = new WispSession(server, connect, cfg, env.WISP_DEBUG === "true" ? console.log : () => {});
    // Keep packet order even if a frame ever arrives as a Blob.
    let queue = Promise.resolve();
    server.addEventListener("message", (ev) => {
      const d = ev.data;
      if (typeof d === "string" || d instanceof ArrayBuffer || ArrayBuffer.isView(d)) {
        queue = queue.then(() => session.onMessage(d));
      } else if (d && typeof d.arrayBuffer === "function") {
        const ab = d.arrayBuffer();
        queue = queue.then(() => ab).then((b) => session.onMessage(b));
      }
    });
    server.addEventListener("close", () => session.shutdown());
    server.addEventListener("error", () => session.shutdown());
    session.start();

    return new Response(null, { status: 101, webSocket: client });
  },
};
