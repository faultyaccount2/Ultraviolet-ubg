import { validateScramjetOrigin, validateWispUrl } from "../scramjet-host/config.js";

const bridges = new Set();
let control;

export function scramjetConfig(settings, { network = true } = {}) {
  const runtime = window.BROMINE_CONFIG || {};
  return {
    origin: validateScramjetOrigin(settings.scramjetOrigin || runtime.scramjetOrigin, location.origin),
    wispUrl: network ? validateWispUrl(settings.wispUrl || runtime.wispUrl) : settings.wispUrl || runtime.wispUrl || "",
    limitMB: settings.cacheLimit,
    adblock: settings.adblock,
    logging: settings.logging,
  };
}

export function connectScramjet(frame, config, onEvent = () => {}) {
  const origin = validateScramjetOrigin(config.origin, location.origin);
  const pending = new Map();
  let port;
  let nextId = 0;
  let closed = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const timer = setTimeout(() => rejectReady(new Error("The isolated Scramjet frontend did not respond. Check its URL and BROMINE_APP_ORIGINS configuration.")), 15000);
  const load = () => {
    if (closed) return;
    port?.close();
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = ({ data }) => {
      if (!data || typeof data !== "object") return;
      if (data.event === "ready") { clearTimeout(timer); resolveReady(); }
      else if (Number.isSafeInteger(data.id) && pending.has(data.id)) {
        const request = pending.get(data.id);
        request.finish(typeof data.error === "string" ? new Error(data.error) : null, data.result);
      } else onEvent(data);
    };
    port.start();
    frame.contentWindow.postMessage({ type: "bromine:scramjet-connect" }, origin, [channel.port2]);
  };
  frame.addEventListener("load", load);
  const bridge = {
    config,
    async command(action, payload = {}, { signal } = {}) {
      if (signal?.aborted) throw new DOMException("The request was cancelled.", "AbortError");
      if (signal) await new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException("The request was cancelled.", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
        ready.then(() => { signal.removeEventListener("abort", abort); resolve(); },
          (error) => { signal.removeEventListener("abort", abort); reject(error); });
      });
      else await ready;
      if (closed) throw new Error("This Scramjet tab has closed.");
      if (signal?.aborted) throw new DOMException("The request was cancelled.", "AbortError");
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const finish = (error, result) => {
          if (!pending.delete(id)) return;
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve(result);
        };
        const abort = () => {
          port?.postMessage({ action: "cancel", id });
          finish(new DOMException("The request was cancelled.", "AbortError"));
        };
        const timer = setTimeout(() => {
          port.postMessage({ action: "cancel", id });
          finish(new Error("Scramjet did not finish the request. Check the Wisp server and try again."));
        }, 45000);
        pending.set(id, { finish });
        signal?.addEventListener("abort", abort, { once: true });
        port.postMessage({ id, action, ...payload });
      });
    },
    close() {
      closed = true;
      clearTimeout(timer);
      frame.removeEventListener("load", load);
      port?.close();
      rejectReady(new Error("This Scramjet tab has closed."));
      for (const request of pending.values()) {
        request.finish(new Error("This Scramjet tab has closed."));
      }
      pending.clear();
      bridges.delete(bridge);
    },
  };
  // Closing an unused control frame must not create an unhandled rejection.
  ready.catch(() => {});
  bridges.add(bridge);
  frame.src = `${origin}/`;
  return bridge;
}

export function scramjetControl(config, onEvent) {
  if (control?.bridge.config.origin === config.origin &&
      control.bridge.config.wispUrl === config.wispUrl &&
      control.bridge.config.adblock === config.adblock) return control.bridge;
  if (control) { control.bridge.close(); control.frame.remove(); }
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.title = "Scramjet cache and downloads";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-downloads");
  frame.referrerPolicy = "no-referrer";
  const bridge = connectScramjet(frame, config, onEvent);
  document.body.append(frame);
  control = { frame, bridge };
  return bridge;
}

export async function scramjetDownload(config, url, options) {
  const active = [...bridges].find((bridge) => bridge !== control?.bridge && bridge.config.origin === config.origin &&
    bridge.config.wispUrl === config.wispUrl && bridge.config.adblock === config.adblock);
  const bridge = active || scramjetControl(config);
  const result = await bridge.command("download", { config, url, headers: [...options.headers] }, { signal: options.signal });
  const reader = result.body?.getReader();
  let finished = false;
  let abort;
  const finish = () => { finished = true; options.signal.removeEventListener("abort", abort); };
  const body = reader ? new ReadableStream({
    start(controller) {
      abort = () => {
        if (finished) return;
        finish();
        reader.cancel().catch((error) => console.error("Scramjet download cancellation failed:", error.name));
        controller.error(new DOMException("The download was cancelled.", "AbortError"));
      };
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (finished) return;
        if (done) { finish(); controller.close(); }
        else controller.enqueue(value);
      } catch (error) { if (!finished) { finish(); controller.error(error); } }
    },
    cancel(reason) { finish(); return reader.cancel(reason); },
  }) : null;
  return new Response(body, { status: result.status, statusText: result.statusText, headers: result.headers });
}
