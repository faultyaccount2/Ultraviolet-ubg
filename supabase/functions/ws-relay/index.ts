import ipaddr from "npm:ipaddr.js@2.5.0";
import {
  parseWebSocketAllowlist,
  validateWebSocketProtocols,
  validateWebSocketTarget,
} from "../_shared/websocket-relay.js";

const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const MAX_CONNECTION_MS = 120_000;
const CONNECT_TIMEOUT_MS = 10_000;
const MAX_CONNECTIONS_PER_USER_PER_WORKER = 4;
const activeConnections = new Map<string, number>();

function failure(status: number, message: string): Response {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

function publicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const ip = ipaddr.process(address);
  return ip.range() === "unicast" && (ip.kind() === "ipv4" || ip.match(ipaddr.parse("2000::"), 3));
}

async function validateDns(hostname: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DNS lookup timed out.")), 5000); });
  let records: string[][];
  try {
    records = await Promise.race([
      Promise.all(["A", "AAAA"].map(async (type) => {
        try { return await Deno.resolveDns(hostname, type as "A" | "AAAA"); }
        catch (error) {
          if (error instanceof Deno.errors.NotFound) return [];
          throw error;
        }
      })),
      timeout,
    ]);
  } finally { clearTimeout(timer!); }
  const addresses = records.flat();
  if (!addresses.length || addresses.some((address) => !publicAddress(address))) {
    throw new Error("The approved WebSocket host did not resolve exclusively to public addresses.");
  }
}

function messageSize(data: string | ArrayBuffer | Blob): number {
  if (typeof data === "string") return new TextEncoder().encode(data).byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return data.size;
}

function safeCloseCode(code: number): number {
  return [1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014].includes(code) ? code : 1011;
}

Deno.serve(async (request) => {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return failure(426, "A WebSocket connection is required.");
  }

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("BROMINE_SUPABASE_PUBLISHABLE_KEY");
  const allowedHostsValue = Deno.env.get("WS_ALLOWED_HOSTS");
  const allowedOrigins = new Set((Deno.env.get("WS_ALLOWED_ORIGINS") || "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!projectUrl || !publishableKey || !allowedHostsValue || !allowedOrigins.size) {
    return failure(503, "The authenticated WebSocket relay is not configured.");
  }
  if (!allowedOrigins.has(request.headers.get("origin") || "")) {
    return failure(403, "This application origin is not approved to use the WebSocket relay.");
  }

  const offered = (request.headers.get("sec-websocket-protocol") || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (offered.length !== 1 || offered.some((value) => value.length > 8192)) {
    return failure(400, "The WebSocket protocol header is invalid.");
  }
  const accessToken = offered[0]?.startsWith("jwt-") ? offered[0].slice(4) : "";
  if (!accessToken || accessToken.length > 8192 || !/^[\w.-]+$/.test(accessToken)) {
    return failure(401, "A valid Supabase session is required.");
  }
  let userResponse: Response;
  try {
    userResponse = await fetch(`${projectUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: publishableKey, authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch { return failure(503, "Supabase Auth could not validate the session."); }
  if (!userResponse.ok) return failure(401, "The Supabase session is invalid or expired.");
  let user: { id?: unknown };
  try { user = await userResponse.json(); }
  catch { return failure(503, "Supabase Auth returned an invalid session response."); }
  if (typeof user.id !== "string") return failure(401, "The Supabase session is invalid.");
  const activeForUser = activeConnections.get(user.id) || 0;
  if (activeForUser >= MAX_CONNECTIONS_PER_USER_PER_WORKER) {
    return failure(429, "Too many active WebSocket connections for this session.");
  }

  let allowedHosts: Set<string>;
  try { allowedHosts = parseWebSocketAllowlist(allowedHostsValue); }
  catch { return failure(503, "The WebSocket host allowlist is invalid or empty."); }

  let client: WebSocket;
  let handshake: Response;
  try {
    const upgraded = Deno.upgradeWebSocket(request, { protocol: offered[0] });
    client = upgraded.socket;
    handshake = upgraded.response;
  }
  catch { return failure(400, "The WebSocket handshake could not be completed."); }
  client.binaryType = "arraybuffer";
  activeConnections.set(user.id, activeForUser + 1);

  const lifetime = new Promise<void>((resolve) => {
    let upstream: WebSocket | undefined;
    let connected = false;
    let connecting = false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const count = activeConnections.get(user.id) || 0;
      if (count <= 1) activeConnections.delete(user.id);
      else activeConnections.set(user.id, count - 1);
    };
    const timer = setTimeout(() => {
      try { client.close(1013, "Relay connection time limit reached."); } catch { /* The socket may already be closed. */ }
    }, MAX_CONNECTION_MS);

    const closeBoth = (code = 1000, reason = "") => {
      clearTimeout(timer);
      if (upstream && upstream.readyState < WebSocket.CLOSING) {
        try { upstream.close(safeCloseCode(code), reason.slice(0, 120)); } catch { /* The upstream may already be closed. */ }
      }
      if (client.readyState < WebSocket.CLOSING) {
        try { client.close(safeCloseCode(code), reason.slice(0, 120)); } catch { /* The client may already be closed. */ }
      }
      release();
      resolve();
    };

    client.addEventListener("close", () => closeBoth());
    client.addEventListener("error", () => closeBoth(1011, "The relay connection failed."));
    client.addEventListener("message", async (event) => {
      if (!connected) {
        if (connecting || typeof event.data !== "string" || event.data.length > 8192) {
          closeBoth(1008, "Invalid relay connection request.");
          return;
        }
        connecting = true;
        try {
          const init = JSON.parse(event.data);
          if (init?.type !== "connect") throw new Error("Invalid relay request.");
          const target = validateWebSocketTarget(init.url, allowedHosts);
          const protocols = validateWebSocketProtocols(init.protocols);
          await validateDns(target.hostname);
          upstream = new WebSocket(target.href, protocols);
          upstream.binaryType = "arraybuffer";
          await new Promise<void>((opened, rejected) => {
            const timeout = setTimeout(() => rejected(new Error("The destination did not accept the connection in time.")), CONNECT_TIMEOUT_MS);
            upstream!.addEventListener("open", () => { clearTimeout(timeout); opened(); }, { once: true });
            upstream!.addEventListener("error", () => { clearTimeout(timeout); rejected(new Error("The destination refused the connection.")); }, { once: true });
          });
          connected = true;
          client.send(JSON.stringify({ type: "relay:open", protocol: upstream.protocol }));
          upstream.addEventListener("message", (upstreamEvent) => {
            if (client.readyState !== WebSocket.OPEN) return;
            const data = upstreamEvent.data as string | ArrayBuffer | Blob;
            if (messageSize(data) > MAX_MESSAGE_BYTES || client.bufferedAmount > MAX_BUFFERED_BYTES) {
              closeBoth(1009, "WebSocket message or buffer limit reached.");
              return;
            }
            client.send(data);
          });
          upstream.addEventListener("close", (closeEvent) => closeBoth(closeEvent.code, closeEvent.reason));
          upstream.addEventListener("error", () => closeBoth(1011, "The destination connection failed."));
        } catch (error) {
          const message = error instanceof Error ? error.message : "The destination connection failed.";
          try { client.send(JSON.stringify({ type: "relay:error", message: message.slice(0, 240) })); } catch { /* The client may have disconnected. */ }
          closeBoth(1008, "The WebSocket relay rejected this destination.");
        }
        return;
      }

      const data = event.data as string | ArrayBuffer | Blob;
      if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
      if (messageSize(data) > MAX_MESSAGE_BYTES || upstream.bufferedAmount > MAX_BUFFERED_BYTES) {
        closeBoth(1009, "WebSocket message or buffer limit reached.");
        return;
      }
      upstream.send(data);
    });
  });

  const runtime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } };
  runtime.EdgeRuntime?.waitUntil(lifetime);
  return handshake;
});
