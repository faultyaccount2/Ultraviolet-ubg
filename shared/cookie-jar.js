import setCookieParser from "set-cookie-parser";

export const MAX_SITE_COOKIES = 120;
export const MAX_SITE_COOKIE_VALUE_BYTES = 2000;
export const MAX_SITE_COOKIE_HEADER_BYTES = 8192;
export const MAX_COOKIE_STATE_BYTES = 16 * 1024;
const cookieNamePattern = /^[!#$%&'*+\-.^_`|~\da-z]+$/i;

function hasForbiddenCookieCharacters(value) {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code <= 0x1f || code === 0x7f || character === ";") return true;
  }
  return false;
}

export function cookieHostKey(host) {
  return String(host).toLowerCase().replace(/[^a-z\d-]/g, (character) => `_${character.codePointAt(0).toString(16)}_`);
}

export function siteCookiePrefix(host) {
  return `bromine_site_${cookieHostKey(host)}_`;
}

function cookieIdentity(cookie) {
  return `${cookie.name}\n${cookie.domain}\n${cookie.path}\n${cookie.hostOnly ? "1" : "0"}`;
}

export function siteCookieName(host, cookie) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(cookieIdentity(cookie))) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return `${siteCookiePrefix(host)}${hash.toString(16).padStart(16, "0")}`;
}

function defaultPath(pathname) {
  if (!pathname.startsWith("/") || pathname === "/") return "/";
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}

export function cookieDomainMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function cookiePathMatches(cookie, requestUrl) {
  const pathname = new URL(requestUrl).pathname;
  return pathname === cookie.path || pathname.startsWith(cookie.path.endsWith("/") ? cookie.path : `${cookie.path}/`);
}

export function normalizeSiteCookie(value, requestUrl, { now = Date.now(), allowHttpOnly = true } = {}) {
  const url = new URL(requestUrl);
  let parsed;
  try { parsed = setCookieParser.parseString(value); }
  catch { return null; }
  if (!parsed || !cookieNamePattern.test(parsed.name) || hasForbiddenCookieCharacters(parsed.value)) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const requestedDomain = typeof parsed.domain === "string" ? parsed.domain.replace(/^\./, "").toLowerCase() : "";
  if (requestedDomain && (!cookieDomainMatches(host, requestedDomain) || requestedDomain.includes(":") ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(requestedDomain))) return null;
  const cookie = {
    name: parsed.name,
    value: parsed.value,
    domain: requestedDomain || host,
    hostOnly: !requestedDomain,
    path: typeof parsed.path === "string" && parsed.path.startsWith("/") ? parsed.path : defaultPath(url.pathname),
    secure: Boolean(parsed.secure),
    httpOnly: allowHttpOnly && Boolean(parsed.httpOnly),
    sameSite: ["strict", "lax", "none"].includes(String(parsed.sameSite || "").toLowerCase()) ?
      String(parsed.sameSite).toLowerCase() : null,
    expiresAt: null,
  };
  if (Number.isFinite(parsed.maxAge)) cookie.expiresAt = now + parsed.maxAge * 1000;
  else if (parsed.expires instanceof Date && Number.isFinite(parsed.expires.getTime())) cookie.expiresAt = parsed.expires.getTime();
  if (cookie.secure && url.protocol !== "https:") return null;
  if (cookie.sameSite === "none" && !cookie.secure ||
      cookie.name.startsWith("__Secure-") && !cookie.secure ||
      cookie.name.startsWith("__Host-") && (!cookie.secure || requestedDomain || cookie.path !== "/")) return null;
  if (new TextEncoder().encode(`${cookie.name}=${cookie.value}`).byteLength > MAX_SITE_COOKIE_VALUE_BYTES) return null;
  if (new TextEncoder().encode(JSON.stringify(cookie)).byteLength > 2800) return null;
  return cookie;
}

export function cookieMatches(cookie, requestUrl, originHost = new URL(requestUrl).hostname) {
  const url = new URL(requestUrl);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const origin = String(originHost).toLowerCase().replace(/\.$/, "");
  if (cookie.expiresAt !== null && cookie.expiresAt <= Date.now()) return false;
  if (cookie.secure && url.protocol !== "https:") return false;
  if (cookie.hostOnly ? cookie.domain !== host || cookie.domain !== origin :
    !cookieDomainMatches(host, cookie.domain) || !cookieDomainMatches(origin, cookie.domain)) return false;
  return cookiePathMatches(cookie, url.href);
}

export function applySiteCookie(cookies, cookie) {
  const next = new Map(cookies.map((item) => [cookieIdentity(item), item]));
  const identity = cookieIdentity(cookie);
  if (cookie.expiresAt !== null && cookie.expiresAt <= Date.now()) next.delete(identity);
  else next.set(identity, cookie);
  return [...next.values()].filter((item) => item.expiresAt === null || item.expiresAt > Date.now()).slice(-MAX_SITE_COOKIES);
}

export function cookieHeader(cookies, requestUrl, originHost = new URL(requestUrl).hostname) {
  const matching = cookies.filter((cookie) => cookieMatches(cookie, requestUrl, originHost))
    .sort((left, right) => right.path.length - left.path.length);
  const value = matching.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  if (new TextEncoder().encode(value).byteLength > MAX_SITE_COOKIE_HEADER_BYTES) {
    throw new TypeError("Proxied site cookies exceed the 8 KB request limit.");
  }
  return value;
}

export function documentCookie(cookies, requestUrl) {
  return cookies.filter((cookie) => !cookie.httpOnly && cookieMatches(cookie, requestUrl))
    .sort((left, right) => right.path.length - left.path.length)
    .map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

export function parseCookieHeader(value) {
  const cookies = new Map();
  for (const part of String(value || "").split(";")) {
    const split = part.indexOf("=");
    if (split <= 0) continue;
    const name = part.slice(0, split).trim();
    const cookieValue = part.slice(split + 1).trim();
    if (cookieNamePattern.test(name) && !hasForbiddenCookieCharacters(cookieValue)) cookies.set(name, cookieValue);
  }
  return cookies;
}

export function encodeCookieState(cookies) {
  const bytes = new TextEncoder().encode(JSON.stringify(cookies));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function encodeSiteCookie(cookie) {
  return encodeCookieState(cookie);
}

function decodeBase64Json(value) {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function validCookieRecord(cookie) {
  return cookie && typeof cookie.name === "string" && cookieNamePattern.test(cookie.name) &&
    typeof cookie.value === "string" && !hasForbiddenCookieCharacters(cookie.value) &&
    new TextEncoder().encode(`${cookie.name}=${cookie.value}`).byteLength <= MAX_SITE_COOKIE_VALUE_BYTES &&
    typeof cookie.domain === "string" && typeof cookie.path === "string" && cookie.path.startsWith("/") &&
    typeof cookie.hostOnly === "boolean" && typeof cookie.secure === "boolean" &&
    typeof cookie.httpOnly === "boolean" &&
    (cookie.sameSite === null || ["strict", "lax", "none"].includes(cookie.sameSite)) &&
    (cookie.sameSite !== "none" || cookie.secure) &&
    (!cookie.name.startsWith("__Secure-") || cookie.secure) &&
    (!cookie.name.startsWith("__Host-") || cookie.secure && cookie.hostOnly && cookie.path === "/") &&
    (cookie.expiresAt === null || Number.isFinite(cookie.expiresAt)) &&
    new TextEncoder().encode(JSON.stringify(cookie)).byteLength <= 2800;
}

export function decodeSiteCookie(value) {
  const cookie = decodeBase64Json(value);
  return validCookieRecord(cookie) ? cookie : null;
}

export function decodeCookieState(value) {
  return decodeCookieStateStrict(value) || [];
}

export function decodeCookieStateStrict(value) {
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > MAX_COOKIE_STATE_BYTES) return null;
  const parsed = decodeBase64Json(value);
  if (!Array.isArray(parsed) || parsed.length > MAX_SITE_COOKIES || !parsed.every(validCookieRecord)) return null;
  return parsed;
}
