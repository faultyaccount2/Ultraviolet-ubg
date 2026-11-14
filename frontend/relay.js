import { createClient } from "@supabase/supabase-js";

const config = window.BROMINE_CONFIG || {};
const supabase = config.supabaseUrl && config.supabasePublishableKey
  ? createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

function portMessage(port, message, transfer = []) {
  try { port.postMessage(message, transfer); }
  catch { /* The owning page may have navigated or closed the message port. */ }
}

export function connectWebSocket(tab, url, protocols, port, notify) {
  let socket;
  let targetOpen = false;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Page closed");
    port.close();
    tab.relayCleanups?.delete(cleanup);
  };
  tab.relayCleanups ??= new Set();
  tab.relayCleanups.add(cleanup);
  port.onmessage = ({ data }) => {
    if (data?.type === "send" && targetOpen && socket?.readyState === WebSocket.OPEN) socket.send(data.data);
    else if (data?.type === "close" && socket && socket.readyState < WebSocket.CLOSING) socket.close(data.code, data.reason);
  };
  port.onmessageerror = cleanup;
  port.start();

  (async () => {
    try {
      if (!supabase) throw new Error("WebSocket relay needs the Supabase project URL and publishable key configured in Vercel.");
      const current = await supabase.auth.getSession();
      if (current.error) throw current.error;
      let session = current.data.session;
      if (!session) {
        const signedIn = await supabase.auth.signInAnonymously();
        if (signedIn.error) throw new Error(`Enable anonymous sign-ins in Supabase Auth to use the WebSocket relay. ${signedIn.error.message}`);
        session = signedIn.data.session;
      }
      if (!session?.access_token || closed) return;
      const relayUrl = new URL("/functions/v1/ws-relay", config.supabaseUrl);
      relayUrl.protocol = relayUrl.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(relayUrl, [`jwt-${session.access_token}`]);
      socket.binaryType = "arraybuffer";
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "connect", url, protocols }));
      });
      socket.addEventListener("message", (event) => {
        if (!targetOpen) {
          let control;
          try { control = JSON.parse(event.data); }
          catch { control = null; }
          if (control?.type === "relay:open") {
            targetOpen = true;
            portMessage(port, { type: "open", protocol: control.protocol || "" });
            return;
          }
          if (control?.type === "relay:error") {
            portMessage(port, { type: "error", message: String(control.message || "The WebSocket destination was rejected.") });
            return;
          }
          portMessage(port, { type: "error", message: "The WebSocket relay returned an invalid response." });
          return;
        }
        const transfer = event.data instanceof ArrayBuffer ? [event.data] : [];
        portMessage(port, { type: "message", data: event.data }, transfer);
      });
      socket.addEventListener("error", () => {
        if (!targetOpen) {
          const message = "Could not connect to the authenticated WebSocket relay. Check its deployment and host allowlist.";
          portMessage(port, { type: "error", message });
          notify(message);
        }
      });
      socket.addEventListener("close", (event) => {
        if (!targetOpen && !closed) {
          const message = "The WebSocket relay closed before the destination connected. Check anonymous sign-in and the approved host list.";
          portMessage(port, { type: "error", message });
          notify(message);
        }
        targetOpen = false;
        portMessage(port, { type: "close", code: event.code, reason: event.reason });
        if (event.code === 1013) notify("Supabase closed this WebSocket at its connection time limit. Reconnect if the site supports it.");
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The WebSocket relay could not start.";
      portMessage(port, { type: "error", message });
      notify(message);
      setTimeout(cleanup, 0);
    }
  })();

  return cleanup;
}
