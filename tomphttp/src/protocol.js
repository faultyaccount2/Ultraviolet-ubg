import { BareError } from "./policy.js";

const token = /^[!#$%&'*+.^_`|~0-9a-z-]+$/i;
const forbiddenForward = new Set(["connection", "transfer-encoding", "host", "origin", "referer"]);
const forbiddenPass = new Set(["vary", "connection", "transfer-encoding", "set-cookie", "set-cookie2", "content-type", "content-disposition", "location"]);
const hopByHop = new Set(["connection", "transfer-encoding", "keep-alive", "proxy-connection", "proxy-authorization", "proxy-authenticate", "te", "trailer", "upgrade", "host", "content-length"]);

export function list(value = "") {
  if (!value) return [];
  return value.split(",").map((part) => {
    const item = part.trim().replace(/^"([^"\\]*)"$/, "$1").toLowerCase();
    if (!token.test(item)) throw new BareError(400, "INVALID_BARE_HEADER", "Invalid header list.");
    return item;
  });
}

export function joinHeaders(headers) {
  const single = headers.get("x-bare-headers");
  const parts = [...headers].filter(([key]) => key.startsWith("x-bare-headers-"));
  if (single !== null && parts.length) throw new BareError(400, "INVALID_BARE_HEADER", "Ambiguous split headers.");
  if (single !== null) {
    if (new TextEncoder().encode(single).length > 3072) throw new BareError(400, "INVALID_BARE_HEADER", "Split large Bare headers.");
    return single;
  }
  if (!parts.length) throw new BareError(400, "MISSING_BARE_HEADER", "X-Bare-Headers is required.", "request.headers.x-bare-headers");
  parts.sort(([a], [b]) => Number(a.slice("x-bare-headers-".length)) - Number(b.slice("x-bare-headers-".length)));
  const value = parts.map(([name, part], index) => {
    if (name !== `x-bare-headers-${index}` || !part.startsWith(";") ||
        new TextEncoder().encode(part).length > 3072) {
      throw new BareError(400, "INVALID_BARE_HEADER", "Invalid split Bare headers.");
    }
    return part.slice(1);
  }).join("");
  if (new TextEncoder().encode(value).length > 65536) throw new BareError(400, "INVALID_BARE_HEADER", "Bare headers exceed the size limit.");
  return value;
}

export function splitHeaders(headers, value) {
  const encoder = new TextEncoder();
  value = [...value].map((character) => {
    const point = character.codePointAt(0);
    if (point <= 255) return character;
    if (point <= 0xffff) return `\\u${point.toString(16).padStart(4, "0")}`;
    const adjusted = point - 0x10000;
    const high = 0xd800 + (adjusted >> 10);
    const low = 0xdc00 + (adjusted & 0x3ff);
    return `\\u${high.toString(16)}\\u${low.toString(16)}`;
  }).join("");
  if (encoder.encode(value).length <= 3072) { headers.set("x-bare-headers", value); return; }
  let chunk = "";
  let size = 0;
  let index = 0;
  for (const character of value) {
    const bytes = encoder.encode(character).length;
    if (size + bytes > 3071) {
      headers.set(`x-bare-headers-${index++}`, `;${chunk}`);
      chunk = "";
      size = 0;
    }
    chunk += character;
    size += bytes;
  }
  if (chunk) headers.set(`x-bare-headers-${index}`, `;${chunk}`);
}

export function objectHeaders(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new BareError(400, "INVALID_BARE_HEADER", "Headers must be an object.");
  const headers = new Headers();
  for (const [name, values] of Object.entries(value)) {
    if (!token.test(name) || !(typeof values === "string" || Array.isArray(values) && values.every((item) => typeof item === "string"))) {
      throw new BareError(400, "INVALID_BARE_HEADER", "Invalid remote headers.");
    }
    for (const item of Array.isArray(values) ? values : [values]) {
      if (/[^\t\x20-\x7e\x80-\xff]/.test(item)) throw new BareError(400, "INVALID_BARE_HEADER", "Invalid remote header value.");
      if (!hopByHop.has(name.toLowerCase()) && !name.toLowerCase().startsWith("cf-")) headers.append(name, item);
    }
  }
  return headers;
}

export function forwardHeaders(request, headers, names) {
  for (const name of names) {
    if (!token.test(name)) throw new BareError(400, "INVALID_BARE_HEADER", "Invalid forwarded header.");
    if (!forbiddenForward.has(name) && !hopByHop.has(name) && !name.startsWith("cf-") && request.headers.has(name)) {
      headers.set(name, request.headers.get(name));
    }
  }
}

export function passHeader(name) {
  return !forbiddenPass.has(name) && !name.startsWith("access-control-") && !name.startsWith("x-bare-") && !name.startsWith("cf-");
}

export function remoteHeaders(response) {
  const headers = Object.fromEntries(response.headers);
  if (response.headers.has("set-cookie")) headers["set-cookie"] = response.headers.getSetCookie();
  return headers;
}
