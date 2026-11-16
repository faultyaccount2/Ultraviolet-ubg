function loopback(hostname) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

export const DEFAULT_BARE_URL = "https://bromine-bare.e42xec.workers.dev/bare/";

export function validateBareUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error("Set a valid Bare HTTPS URL in Settings before using Bare."); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback(url.hostname)) ||
      url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/")) {
    throw new Error("Bare requires an https:// URL ending in /, without credentials or parameters (HTTP only on localhost).");
  }
  return url.href;
}

export function validateTransport(config) {
  const transport = config.transport || "bare";
  if (!["bare", "wisp"].includes(transport)) throw new Error("Choose Bare or Wisp as the Scramjet transport.");
  if (transport === "bare") validateBareUrl(config.bareUrl || DEFAULT_BARE_URL);
  else validateWispUrl(config.wispUrl);
  return transport;
}

export function validateWispUrl(value) {
  if (!value) throw new Error("Set the Wisp WebSocket URL in Settings before using Scramjet.");
  let url;
  try { url = new URL(value); }
  catch { throw new Error("Enter a valid Wisp WebSocket URL."); }
  if (url.protocol !== "wss:" && !(url.protocol === "ws:" && loopback(url.hostname)) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("Wisp requires wss:// (ws:// is allowed only on localhost), without credentials, query parameters or fragments.");
  }
  if (!url.pathname.endsWith("/")) throw new Error("The Wisp endpoint must end with a slash, for example wss://your-server.onrender.com/wisp/.");
  return url.href;
}

export function validateScramjetOrigin(value, appOrigin) {
  if (!value) throw new Error("Set the separate Scramjet frontend origin in Settings before using Scramjet.");
  let url;
  try { url = new URL(value); }
  catch { throw new Error("Enter a valid Scramjet frontend origin."); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback(url.hostname)) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("The Scramjet frontend must be an HTTPS origin without a path, credentials or parameters.");
  }
  if (url.origin === appOrigin) throw new Error("Use a separate origin for Scramjet to keep website content away from Bromine's saved data.");
  return url.origin;
}
