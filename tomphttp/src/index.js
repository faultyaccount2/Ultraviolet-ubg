import { BareError, entries, targetUrl, resolvePublic } from "./policy.js";
import { list, joinHeaders, splitHeaders, objectHeaders, forwardHeaders, passHeader, remoteHeaders } from "./protocol.js";

const defaultAllowedOrigins = ["https://scramjet-ubg.vercel.app"];

function cors(request, env) {
  const origin = request.headers.get("origin");
  const allowed = entries(env.BARE_ALLOWED_ORIGINS || defaultAllowedOrigins.join(","));
  if (!origin || !allowed.includes(origin.toLowerCase())) throw new BareError(403, "FORBIDDEN", "Origin not allowed.");
  return new Headers({
    "access-control-allow-origin": allowed.length ? origin : "*",
    "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": request.headers.get("access-control-request-headers") || "*",
    "access-control-max-age": "86400",
    "cache-control": "no-store",
    "content-type": "application/octet-stream",
    "x-content-type-options": "nosniff",
    vary: "Origin, Access-Control-Request-Headers",
  });
}

function expose(headers) {
  headers.set("access-control-expose-headers", [...headers.keys()].join(", "));
}

export async function websocketSession(socket, request, env, { fetcher = fetch, resolve = resolvePublic } = {}) {
  let remote;
  let state = "handshake";
  const abort = new AbortController();
  const close = (code = 1000, reason = "") => {
    if (state === "closed") return;
    state = "closed";
    clearTimeout(timer);
    abort.abort();
    if (remote && remote.readyState < 2) remote.close(code, reason);
    if (socket.readyState < 2) socket.close(code, reason);
  };
  const fail = (error) => {
    console.error("Bare WebSocket failed:", error.code || error.name);
    close(error instanceof BareError && error.status < 500 ? 1008 : 1011, error instanceof BareError ? error.message.slice(0, 100) : "Upstream WebSocket connection failed.");
  };
  const timer = setTimeout(() => close(1008, "Bare handshake timed out."), 15000);
  socket.addEventListener("close", () => close());
  socket.addEventListener("error", () => close(1011, "Bare WebSocket error."));
  socket.addEventListener("message", async ({ data }) => {
    try {
      if (state === "open") { remote.send(data); return; }
      if (state !== "handshake") throw new BareError(400, "INVALID_BARE_HEADER", "Wait for the Bare open message.");
      state = "connecting";
      if (typeof data !== "string" || data.length > 65536) throw new BareError(400, "INVALID_BARE_HEADER", "Invalid Bare handshake.");
      let message;
      try { message = JSON.parse(data); }
      catch { throw new BareError(400, "INVALID_BARE_HEADER", "Invalid Bare handshake JSON."); }
      if (message?.type !== "connect" || !Array.isArray(message.protocols) || !Array.isArray(message.forwardHeaders) ||
          !message.protocols.every((value) => typeof value === "string" && /^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(value)) ||
          new Set(message.protocols).size !== message.protocols.length ||
          !message.forwardHeaders.every((value) => typeof value === "string")) {
        throw new BareError(400, "INVALID_BARE_HEADER", "Invalid Bare handshake fields.");
      }
      const url = targetUrl(message.remote, env, true);
      if (url.host === new URL(request.url).host) throw new BareError(403, "FORBIDDEN", "Recursive proxying is blocked.");
      await resolve(url.hostname.replace(/^\[|\]$/g, ""), fetcher, env);
      const headers = objectHeaders(message.headers);
      forwardHeaders(request, headers, message.forwardHeaders.map((value) => value.toLowerCase()));
      for (const name of ["sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "sec-websocket-protocol"]) headers.delete(name);
      headers.set("upgrade", "websocket");
      if (message.protocols.length) headers.set("sec-websocket-protocol", message.protocols.join(", "));
      url.protocol = url.protocol === "wss:" ? "https:" : "http:";
      const response = await fetcher(url.href, { headers, redirect: "manual", signal: abort.signal });
      remote = response.webSocket;
      if (state === "closed") { remote?.close(); return; }
      if (response.status !== 101 || !remote) throw new BareError(502, "CONNECTION_FAILED", "The remote did not accept the WebSocket.");
      const protocol = response.headers.get("sec-websocket-protocol") || "";
      if (protocol && !message.protocols.includes(protocol)) throw new BareError(502, "CONNECTION_FAILED", "The remote selected an invalid protocol.");
      remote.binaryType = "arraybuffer";
      remote.addEventListener("message", ({ data }) => {
        try { socket.send(data); } catch (error) { fail(error); }
      });
      remote.addEventListener("close", () => close());
      remote.addEventListener("error", () => close(1011, "Upstream WebSocket error."));
      clearTimeout(timer);
      socket.send(JSON.stringify({ type: "open", protocol, setCookies: response.headers.getSetCookie() }));
      state = "open";
      remote.accept();
    } catch (error) { fail(error); }
  });
}

export function createHandler({ fetcher = fetch, resolve = resolvePublic } = {}) {
  return async (request, env = {}) => {
    let headers = new Headers({ "cache-control": "no-store" });
    try {
      const url = new URL(request.url);
      if (url.pathname === "/healthz") return new Response("ok\n");
      headers = cors(request, env);
      if (!["/bare/", "/bare/v3/"].includes(url.pathname)) throw new BareError(404, "NOT_FOUND", "Not found.");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (url.pathname === "/bare/") {
        headers.set("content-type", "application/json");
        return Response.json({ versions: ["v3"], language: "ServiceWorker", project: {
          name: "Bromine Bare", version: "1.0.0", repository: "https://github.com/faultyaccount2/Ultraviolet-ubg",
        } }, { headers });
      }
      if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const { 0: client, 1: server } = new globalThis.WebSocketPair();
        server.binaryType = "arraybuffer";
        server.accept();
        await websocketSession(server, request, env, { fetcher, resolve });
        return new Response(null, { status: 101, webSocket: client });
      }
      if (["CONNECT", "TRACE", "TRACK"].includes(request.method)) throw new BareError(405, "FORBIDDEN", "Method not supported by Workers fetch.");
      if (!request.headers.has("x-bare-url")) throw new BareError(400, "MISSING_BARE_HEADER", "X-Bare-URL is required.", "request.headers.x-bare-url");
      const remote = targetUrl(request.headers.get("x-bare-url"), env);
      if (remote.host === url.host) throw new BareError(403, "FORBIDDEN", "Recursive proxying is blocked.");
      let raw;
      try { raw = JSON.parse(joinHeaders(request.headers)); }
      catch (error) {
        if (error instanceof BareError) throw error;
        throw new BareError(400, "INVALID_BARE_HEADER", "X-Bare-Headers must contain valid JSON.");
      }
      const outgoing = objectHeaders(raw);
      const cached = url.searchParams.has("cache");
      const cacheHeaders = cached ? ["if-modified-since", "if-none-match", "cache-control"] : [];
      forwardHeaders(request, outgoing, ["accept-encoding", "accept-language", ...cacheHeaders, ...list(request.headers.get("x-bare-forward-headers") || "")]);
      const passes = ["content-encoding", "content-length", "last-modified", ...cacheHeaders, ...list(request.headers.get("x-bare-pass-headers") || "")];
      const statuses = list(request.headers.get("x-bare-pass-status") || "");
      if (statuses.some((status) => !/^[2-5]\d\d$/.test(status))) throw new BareError(400, "INVALID_BARE_HEADER", "Invalid pass status.");
      if (cached) statuses.push("304");
      await resolve(remote.hostname.replace(/^\[|\]$/g, ""), fetcher, env);
      const upstream = await fetcher(remote.href, {
        method: request.method, headers: outgoing, redirect: "manual",
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        signal: request.signal, duplex: "half",
      });
      for (const name of passes) if (passHeader(name) && upstream.headers.has(name)) headers.set(name, upstream.headers.get(name));
      headers.set("x-bare-status", String(upstream.status));
      headers.set("x-bare-status-text", upstream.statusText);
      splitHeaders(headers, JSON.stringify(remoteHeaders(upstream)));
      expose(headers);
      const status = statuses.includes(String(upstream.status)) ? upstream.status : 200;
      return new Response(request.method === "HEAD" || [204, 205, 304].includes(status) ? null : upstream.body, {
        status, headers,
      });
    } catch (error) {
      const known = error instanceof BareError;
      console.error("Bare request failed:", known ? error.code : error.message);
      headers.set("content-type", "application/json");
      expose(headers);
      return Response.json({
        code: known ? error.code : "UNKNOWN",
        message: known ? error.message : "The upstream request failed.",
        ...(known && error.id ? { id: error.id } : {}),
      }, { status: known ? error.status : 502, headers });
    }
  };
}

export default { fetch: createHandler() };
