import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySiteCookie, cookieHeader, cookieMatches, decodeCookieState, decodeSiteCookie,
  documentCookie, encodeCookieState, encodeSiteCookie, normalizeSiteCookie,
} from "../shared/cookie-jar.js";

test("site cookies honor host, path, secure and HttpOnly visibility", () => {
  const url = "https://www.example.com/account/view";
  const cookies = [
    normalizeSiteCookie("root=1; Path=/; Secure", url),
    normalizeSiteCookie("account=2; Path=/account; Secure; HttpOnly", url),
    normalizeSiteCookie("other=3; Path=/other; Secure", url),
    normalizeSiteCookie("insecure=4; Path=/", url),
  ];

  assert.equal(cookieHeader(cookies, url, "www.example.com"), "account=2; root=1; insecure=4");
  assert.equal(documentCookie(cookies, url), "root=1; insecure=4");
  assert.equal(cookieMatches(cookies[1], "https://www.example.com/account/api", "www.example.com"), true);
  assert.equal(cookieMatches(cookies[1], "https://www.example.com/accounting", "www.example.com"), false);
  assert.equal(cookieMatches(cookies[0], "http://www.example.com/", "www.example.com"), false);
  assert.equal(cookieMatches(cookies[0], "https://other.example.com/", "other.example.com"), false);
});

test("cookie state round-trips safely and applies replacement and deletion by identity", () => {
  const url = "https://www.example.com/";
  const original = normalizeSiteCookie("state=first; Path=/", url);
  const replacement = normalizeSiteCookie("state=second; Path=/", url);
  const decoded = decodeCookieState(encodeCookieState([original]));

  assert.deepEqual(decoded, [original]);
  assert.deepEqual(decodeSiteCookie(encodeSiteCookie(original)), original);
  assert.deepEqual(applySiteCookie(decoded, replacement), [replacement]);
  const deletion = normalizeSiteCookie("state=; Path=/; Max-Age=0", url);
  assert.deepEqual(applySiteCookie([replacement], deletion), []);
  assert.deepEqual(decodeCookieState("invalid"), []);
  assert.equal(decodeSiteCookie("invalid"), null);
});

test("cookie parsing rejects unsafe domains, values and oversized state", () => {
  assert.equal(normalizeSiteCookie("invalid=x; Domain=other.example", "https://www.example.com/"), null);
  assert.equal(normalizeSiteCookie("invalid=x; Domain=8.8.8.8", "https://8.8.8.8/"), null);
  assert.equal(normalizeSiteCookie(`large=${"x".repeat(2200)}`, "https://www.example.com/"), null);
  assert.equal(decodeCookieState(encodeCookieState([{}])).length, 0);
  assert.equal(decodeCookieState("a".repeat(17 * 1024)).length, 0);
});
