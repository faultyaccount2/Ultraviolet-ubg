import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
import { parse } from "parse5";
import { createProxyHandler } from "../proxy/service.js";
import { isPublicAddress, pinnedLookup, resolvePublicTarget, validateTarget, requestResource } from "../proxy/network.js";
import { rewriteCss, rewriteHtml } from "../proxy/rewrite.js";
import { proxyUrl, unproxyUrl } from "../shared/proxy-url.js";
import {
  decodeCookieState, encodeCookieState, normalizeSiteCookie, siteCookieName,
} from "../shared/cookie-jar.js";
import { isBlocked } from "../proxy/filtering.js";
import { fixtureResponse } from "./fixtures.js";
import { MemoryCacheStorage } from "../frontend/memory-cache.js";
import { gzipSync, gunzipSync } from "node:zlib";

test("document caches snapshot consumed responses and honor Vary and query matching", async () => {
  const storage = new MemoryCacheStorage();
  const cache = await storage.open("test");
  const request = new Request("https://fixture.example/data?q=1", { headers: { "accept-language": "en" } });
  const response = new Response("snapshot", { headers: { vary: "accept-language" } });
  const storing = cache.put(request, response);
  await response.text();
  await storing;
  assert.equal(await (await cache.match(request)).text(), "snapshot");
  assert.equal(await cache.match("https://fixture.example/data?q=1"), undefined);
  assert.equal(await cache.match(new Request("https://fixture.example/data?q=2", { headers: { "accept-language": "en" } })), undefined);
  assert.equal(await (await cache.match("https://fixture.example/data?q=2", { ignoreVary: true, ignoreSearch: true })).text(), "snapshot");
  await assert.rejects(cache.put(request, new Response("partial", { status: 206 })), TypeError);
  await assert.rejects(cache.put(request, new Response("wildcard", { headers: { vary: "*" } })), TypeError);
});

test("document caches enforce byte and entry quotas and release deleted entries", async () => {
  const cache = await new MemoryCacheStorage().open("bytes");
  await cache.put("https://fixture.example/full", new Response(new Uint8Array(64 * 1024 * 1024)));
  await assert.rejects(cache.put("https://fixture.example/extra", new Response("x")), { name: "QuotaExceededError" });
  await cache.delete("https://fixture.example/full");
  await cache.put("https://fixture.example/extra", new Response("x"));
  assert.equal(await (await cache.match("https://fixture.example/extra")).text(), "x");
  const entries = await new MemoryCacheStorage().open("entries");
  for (let index = 0; index < 200; index++) await entries.put(`https://fixture.example/${index}`, new Response(null));
  await assert.rejects(entries.put("https://fixture.example/extra", new Response(null)), { name: "QuotaExceededError" });
  await entries.delete("https://fixture.example/0");
  await entries.put("https://fixture.example/extra", new Response(null));
});

function elements(source) {
  const all = [];
  function walk(node) { if (node.tagName) all.push(node); node.childNodes?.forEach(walk); }
  walk(parse(source));
  return all;
}
const attribute = (node, name) => node.attrs.find((attr) => attr.name === name)?.value;

test("public-address validation rejects alternate IPs, internal hosts and reserved IPv6", () => {
  for (const value of ["http://localhost/", "http://2130706433", "http://0x7f000001", "http://127.1", "http://169.254.169.254", "http://10.0.0.1", "http://[::1]", "http://[::ffff:127.0.0.1]", "http://[fc00::1]", "http://[fe80::1]", "http://192.168.0.1", "http://100.64.0.1", "http://192.0.2.1", "https://example.com:8080", "https://user:pass@example.com", "ftp://example.com"]) {
    assert.throws(() => validateTarget(value), undefined, value);
  }
  assert.equal(validateTarget("https://example.com:443/").href, "https://example.com/");
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  assert.equal(isPublicAddress("2001:db8::1"), false);
  assert.equal(isPublicAddress("8.8.8.8"), true);
});

test("mixed DNS answers are rejected and the socket lookup stays pinned", async () => {
  const url = validateTarget("https://example.com/");
  const signal = AbortSignal.timeout(1000);
  await assert.rejects(resolvePublicTarget(url, signal, async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]), /private/);
  const records = await resolvePublicTarget(url, signal, async () => [{ address: "8.8.8.8", family: 4 }]);
  pinnedLookup(records)("changed-dns.example", {}, (error, address, family) => {
    assert.equal(error, null); assert.equal(address, "8.8.8.8"); assert.equal(family, 4);
  });

  test("transport accepts large upstream headers and streams files larger than 4 MB", async (t) => {
    const bytes = Buffer.alloc(6 * 1024 * 1024, 65);
    const server = createServer((_req, res) => {
      res.setHeader("Content-Security-Policy", "x".repeat(24000));
      res.end(bytes);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    const response = await requestResource(new URL(`http://fixture.example:${server.address().port}/`), {
      records: [{ address: "127.0.0.1", family: 4 }], method: "GET", headers: {}, signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    const chunks = [];
    for await (const chunk of response.stream) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), bytes);
  });
  pinnedLookup(records)("changed-dns.example", { all: true }, (error, addresses) => {
    assert.equal(error, null); assert.deepEqual(addresses, records);
  });
});

async function invoke(target, { method = "GET", body, lazyBody = false, type, origin, requestHeaders = {}, send = fixtureResponse, resolve = async () => [{ address: "93.184.216.34", family: 4 }], blocked = async () => false } = {}) {
  const req = { method, url: proxyUrl(target, { type, origin }), headers: requestHeaders, body };
  if (lazyBody) {
    Object.defineProperty(req, "body", { get() { throw new Error("Invalid JSON"); } });
    req[Symbol.asyncIterator] = async function* () { yield body; };
  }
  const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(value) { this.body = value ? Buffer.from(value) : Buffer.alloc(0); } };
  await createProxyHandler({ send, resolve, blocked })(req, res);
  return res;
}

test("the proxy persists site cookies locally and scopes forwarding by request type and host", async () => {
  const target = "https://fixture.example/";
  const host = new URL(target).hostname;
  const privateCookie = normalizeSiteCookie("private=secret; Path=/; Secure; HttpOnly", target);
  const visibleCookie = normalizeSiteCookie("visible=browser; Path=/", target);
  const forgedHttpOnly = normalizeSiteCookie("private=forged; Path=/; Secure", target);
  const appCookie = `${siteCookieName(host, privateCookie)}=${encodeCookieState(privateCookie)}`;
  let navigationHeaders;
  const navigation = await invoke(target, {
    type: "document",
    requestHeaders: {
      cookie: `${appCookie}; app-secret=must-not-forward`,
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "iframe",
    },
    send: (url, options) => {
      navigationHeaders = options.headers;
      const response = fixtureResponse(url, options);
      response.headers["set-cookie"] = "visible=from-site; Path=/; Secure";
      return response;
    },
  });
  assert.equal(navigationHeaders.cookie, "private=secret");
  assert.equal(navigationHeaders.authorization, undefined);
  assert.match(navigation.headers["set-cookie"][0], /HttpOnly; SameSite=None; Secure/);
  const bridge = elements(navigation.body.toString()).find((node) => node.tagName === "script" && attribute(node, "data-cookie-state") !== undefined);
  const visibleState = decodeCookieState(attribute(bridge, "data-cookie-state"));
  assert.deepEqual(visibleState.map((cookie) => cookie.name), ["visible"]);
  assert.equal(visibleState[0].value, "from-site");

  let apiHeaders;
  const api = await invoke("https://fixture.example/data?value=api", {
    type: "xmlhttprequest",
    origin: "https://fixture.example/",
    requestHeaders: { cookie: appCookie, origin: "null", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" },
    send: (url, options) => {
      apiHeaders = options.headers;
      const response = fixtureResponse(url, options);
      response.headers["set-cookie"] = "ignored=credentials-omitted; Path=/; Secure";
      return response;
    },
  });
  assert.equal(apiHeaders.cookie, undefined);
  assert.equal(api.headers["set-cookie"], undefined);
  assert.equal(api.headers["x-bromine-cookie-changes"], undefined);
  assert.equal(api.headers["access-control-allow-origin"], "null");
  assert.equal(api.headers["access-control-allow-credentials"], "true");

  let explicitApiHeaders;
  const explicitApi = await invoke("https://fixture.example/data?value=api", {
    type: "xmlhttprequest",
    origin: "https://fixture.example/",
    requestHeaders: {
      cookie: appCookie,
      origin: "null",
      "x-bromine-site-cookies": encodeCookieState([visibleCookie, forgedHttpOnly]),
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    },
    send: (url, options) => {
      explicitApiHeaders = options.headers;
      const response = fixtureResponse(url, options);
      response.headers["set-cookie"] = "fresh=2; Path=/; Secure";
      return response;
    },
  });
  assert.equal(explicitApiHeaders.cookie, "private=secret; visible=browser");
  assert.doesNotMatch(explicitApiHeaders.cookie, /app-secret|forged/);
  assert.deepEqual(decodeCookieState(explicitApi.headers["x-bromine-cookie-changes"]).map((cookie) => cookie.name), ["fresh"]);

  const pathRestricted = await invoke("https://fixture.example/data?value=path", {
    type: "xmlhttprequest",
    origin: "https://fixture.example/",
    requestHeaders: { origin: "null", "x-bromine-site-cookies": encodeCookieState([visibleCookie]) },
    send: (url, options) => {
      const response = fixtureResponse(url, options);
      response.headers["set-cookie"] = "path_only=hidden; Path=/private; Secure";
      return response;
    },
  });
  assert.equal(pathRestricted.headers["x-bromine-cookie-changes"], undefined);
  assert.equal(pathRestricted.headers["set-cookie"].length, 1);
});

test("cookie sync is limited to the browser application's same-origin request", async () => {
  const target = "https://fixture.example/";
  const cookie = normalizeSiteCookie("from-script=saved; Path=/", target);
  const requestHeaders = {
    origin: "https://app.example",
    host: "app.example",
    "x-forwarded-proto": "https",
    "x-bromine-site-cookies": encodeCookieState([cookie]),
  };
  const saved = await invoke(target, { method: "POST", type: "cookie-sync", origin: "https://fixture.example", requestHeaders });
  assert.equal(saved.statusCode, 204);
  assert.match(saved.headers["set-cookie"][0], /HttpOnly; SameSite=None; Secure/);
  const rejected = await invoke(target, {
    method: "POST", type: "cookie-sync", origin: "https://fixture.example",
    requestHeaders: { ...requestHeaders, origin: "null" },
  });
  assert.equal(rejected.statusCode, 403);
});

test("cookie domains on the public suffix list are rejected before reaching the site", async () => {
  const target = "https://www.com/";
  const cookie = normalizeSiteCookie("shared=value; Domain=com; Path=/", target);
  let reachedSite = false;
  const result = await invoke(target, {
    type: "xmlhttprequest",
    origin: "https://www.com/",
    requestHeaders: { origin: "null", "x-bromine-site-cookies": encodeCookieState([cookie]) },
    send: () => { reachedSite = true; return fixtureResponse(new URL(target), { headers: {} }); },
  });
  assert.equal(result.statusCode, 400);
  assert.equal(reachedSite, false);
});

test("redirect cookie updates are forwarded only to the same host", async () => {
  const target = "https://fixture.example/redirect";
  let nextCookie;
  const result = await invoke(target, {
    type: "document",
    requestHeaders: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" },
    send: (url, options) => {
      if (url.pathname === "/redirect") return {
        status: 302, headers: { location: "/next", "set-cookie": "redirected=yes; Path=/; Secure" }, body: Buffer.alloc(0),
      };
      nextCookie = options.headers.cookie;
      return fixtureResponse(url, options);
    },
  });
  assert.equal(nextCookie, "redirected=yes");
  const redirected = normalizeSiteCookie("redirected=yes; Path=/; Secure", target);
  assert.ok(result.headers["set-cookie"][0].startsWith(`${siteCookieName("fixture.example", redirected)}=`));
});

test("the gateway sends the target path/query, strips application credentials and isolates documents", async () => {
  let outgoing;
  const result = await invoke("https://fixture.example/next?hello=world", {
    requestHeaders: { cookie: "app-secret=1", authorization: "secret" },
    send: async (url, options) => { outgoing = { url, options }; return fixtureResponse(url, options); },
  });

  test("preflight permits validated custom resource headers without forwarding application credentials", async () => {
    const result = await invoke("https://fixture.example/", {
      method: "OPTIONS", requestHeaders: { "access-control-request-headers": "x-sg-e, x-fixture" },
    });
    assert.equal(result.statusCode, 204);
    assert.match(result.headers["access-control-allow-headers"], /x-sg-e/);
    const invalid = await invoke("https://fixture.example/", {
      method: "OPTIONS", requestHeaders: { "access-control-request-headers": "x-invalid\nheader" },
    });
    assert.equal(invalid.statusCode, 400);
  });
  assert.equal(outgoing.url.pathname, "/next");
  assert.equal(outgoing.url.search, "?hello=world");
  assert.equal(outgoing.options.headers.cookie, undefined);
  assert.equal(outgoing.options.headers.authorization, undefined);
  assert.equal(outgoing.options.headers.origin, undefined);
  assert.equal(result.statusCode, 200);
  assert.match(result.headers["content-security-policy"], /sandbox/);
  assert.match(result.headers["content-security-policy"], /frame-ancestors 'self'/);
  assert.doesNotMatch(result.headers["content-security-policy"], /allow-same-origin/);
  assert.equal(result.headers["access-control-allow-origin"], "*");
  const nested = await invoke("https://fixture.example/nested", { type: "subdocument" });
  assert.equal(nested.statusCode, 200);
  assert.match(nested.headers["content-security-policy"], /sandbox allow-scripts allow-forms allow-downloads/);
  assert.doesNotMatch(nested.headers["content-security-policy"], /allow-same-origin|frame-ancestors/);
});

test("the gateway forwards only bounded site API headers and supplies the proxied site origin", async () => {
  let outgoing;
  const result = await invoke("https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT", {
    method: "POST",
    body: '{"client":"web"}',
    origin: "https://www.youtube.com/",
    requestHeaders: {
      "content-type": "application/json+protobuf",
      "x-goog-api-key": "public-site-api-key",
      "x-goog-visitor-id": "visitor",
      "x-youtube-client-name": "1",
      "x-youtube-client-version": "2",
      "x-unknown-custom": "discard",
      origin: "null",
      cookie: "app-session=private",
      authorization: "Bearer app-token",
    },
    send: (url, options) => {
      outgoing = { url, options };
      return { status: 200, headers: { "content-type": "text/plain" }, body: Buffer.from("ok") };
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(outgoing.options.headers.origin, "https://www.youtube.com");
  assert.equal(outgoing.options.headers["x-goog-api-key"], "public-site-api-key");
  assert.equal(outgoing.options.headers["x-goog-visitor-id"], "visitor");
  assert.equal(outgoing.options.headers["x-youtube-client-name"], "1");
  assert.equal(outgoing.options.headers["x-unknown-custom"], undefined);
  assert.equal(outgoing.options.headers.cookie, undefined);
  assert.equal(outgoing.options.headers.authorization, undefined);
  assert.equal(outgoing.options.headers["content-type"], "application/json+protobuf");
});

test("compressed JSON POST bodies retain their content encoding and raw bytes", async () => {
  const body = gzipSync(Buffer.from('{"search":"cats"}'));
  let outgoing;
  const result = await invoke("https://www.youtube.com/youtubei/v1/search", {
    method: "POST",
    body,
    origin: "https://www.youtube.com/",
    requestHeaders: { "content-type": "application/json", "content-encoding": "gzip" },
    send: (_url, options) => {
      outgoing = options;
      return { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{}") };
    },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(outgoing.headers["content-encoding"], "gzip");
  assert.deepEqual(outgoing.body, body);
  assert.equal(gunzipSync(outgoing.body).toString(), '{"search":"cats"}');
});

test("lazy platform JSON parsers are not invoked when forwarding raw request bytes", async () => {
  for (const encoding of ["identity", "gzip"]) {
    const raw = Buffer.from(' { "search": "piano music" } ');
    const body = encoding === "gzip" ? gzipSync(raw) : raw;
    let outgoing;
    const result = await invoke("https://www.youtube.com/youtubei/v1/search", {
      method: "POST", body, lazyBody: true,
      requestHeaders: { "content-type": "application/json", "content-encoding": encoding },
      send: (_url, options) => {
        outgoing = options;
        return { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{}") };
      },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(outgoing.headers["content-encoding"], encoding);
    assert.deepEqual(outgoing.body, body);
  }
});

test("XML POST bodies are forwarded unchanged for search APIs", async () => {
  const body = Buffer.from("<SearchRequest><Query>cats</Query></SearchRequest>");
  let outgoing;
  const result = await invoke("https://www.bing.com/web/xlsc.aspx", {
    method: "POST",
    body,
    requestHeaders: { "content-type": "text/xml" },
    send: (_url, options) => {
      outgoing = options;
      return { status: 200, headers: { "content-type": "application/xml" }, body: Buffer.from("<SearchResponse/>") };
    },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(outgoing.headers["content-type"], "text/xml");
  assert.deepEqual(outgoing.body, body);
});

test("redirects are validated per hop, including private IP and changed DNS destinations", async () => {
  const redirects = await invoke("https://fixture.example/redirect");
  assert.equal(redirects.statusCode, 200);
  assert.match(redirects.body.toString(), /data-target="https:\/\/fixture.example\/next\?redirected=1"/);
  const privateRedirect = await invoke("https://fixture.example/private-redirect");
  assert.equal(privateRedirect.statusCode, 403);
  const loop = await invoke("https://fixture.example/loop");
  assert.equal(loop.statusCode, 502);
  const rebound = await invoke("https://fixture.example/redirect", {
    resolve: (() => { let calls = 0; return async () => [{ address: ++calls === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }]; })(),
  });
  assert.equal(rebound.statusCode, 403);
});

test("HTML uses base href for resources, srcset, forms and fragments without rewriting script source", () => {
  const source = '<html><head><base href="/assets/"><meta http-equiv="Content-Security-Policy" content="default-src none"><link rel="stylesheet" href="style.css"></head><body><a href="../next?q=1#part">Next</a><img srcset="data:image/png;base64,AAAA 1x, image.png 2x"><form action="../post"></form><script>const text="/not-a-url-to-change";</script></body></html>';
  const output = rewriteHtml(source, "https://example.com/start", "https://example.com/start");
  const nodes = elements(output);
  assert.equal(nodes.some((node) => node.tagName === "base"), false);
  assert.equal(nodes.some((node) => attribute(node, "http-equiv") === "Content-Security-Policy"), false);
  const stylesheet = attribute(nodes.find((node) => node.tagName === "link"), "href");
  assert.equal(new URL(stylesheet, "https://proxy.example").searchParams.get("url"), "https://example.com/assets/style.css");
  const link = attribute(nodes.find((node) => node.tagName === "a"), "href");
  assert.equal(unproxyUrl(link, "https://proxy.example"), "https://example.com/next?q=1#part");
  assert.match(attribute(nodes.find((node) => node.tagName === "img"), "srcset"), /data:image\/png;base64,AAAA 1x/);
  assert.equal(attribute(nodes.find((node) => node.tagName === "form"), "data-proxy-action"), "https://example.com/post");
  assert.match(output, /const text="\/not-a-url-to-change";/);
});

test("CSS rewrites quoted URLs, imports, data URLs and external resources", () => {
  const output = rewriteCss('@import "../theme.css"; .a{background:url("image(a).png?x=1");mask:url(//cdn.example/icon.svg)}.b{background:url(data:image/png;base64,AAAA)}', "https://example.com/assets/style.css");
  assert.match(output, /url=https%3A%2F%2Fexample.com%2Ftheme.css/);
  assert.match(output, /url=https%3A%2F%2Fexample.com%2Fassets%2Fimage%28a%29.png%3Fx%3D1/);
  assert.match(output, /cdn.example/);
  assert.match(output, /data:image\/png;base64,AAAA/);
  const recovered = rewriteCss('.a{background:url(one.png)}} .b{background:url(two.png)}', "https://example.com/assets/style.css");
  assert.match(recovered, /url=https%3A%2F%2Fexample.com%2Fassets%2Fone.png/);
  assert.match(recovered, /url=https%3A%2F%2Fexample.com%2Fassets%2Ftwo.png/);
  const inline = rewriteHtml('<style>.a{background:url(/image.svg)}}</style><h1>Recoverable CSS</h1>', "https://example.com/", "https://example.com/");
  assert.match(inline, /url=https%3A%2F%2Fexample.com%2Fimage.svg/);
  assert.match(inline, /Recoverable CSS/);
});

test("POST bodies and HEAD are preserved, with unsupported methods and compression/size limits surfaced", async () => {
  const post = await invoke("https://fixture.example/post", { method: "POST", body: { name: "Bromine" }, requestHeaders: { "content-type": "application/x-www-form-urlencoded" } });
  assert.equal(post.statusCode, 200);
  assert.match(post.body.toString(), /name=Bromine/);
  const head = await invoke("https://fixture.example/", { method: "HEAD" });
  assert.equal(head.statusCode, 200); assert.equal(head.body.length, 0);
  const rejected = await invoke("https://fixture.example/", { method: "DELETE" });
  assert.equal(rejected.statusCode, 405);
  const multipart = await invoke("https://fixture.example/post", { method: "POST", body: "a", requestHeaders: { "content-type": "multipart/form-data" } });
  assert.equal(multipart.statusCode, 415);
  let outgoing;
  const empty = await invoke("https://fixture.example/post", {
    method: "POST", body: "", send: (url, options) => { outgoing = options; return fixtureResponse(url, options); },
  });
  assert.equal(empty.statusCode, 200);
  assert.equal(outgoing.headers["content-type"], undefined);
  assert.equal(outgoing.headers["content-length"], "0");
  const protobufJson = await invoke("https://fixture.example/post", {
    method: "POST", body: "[1,2]", requestHeaders: { "content-type": "application/json+protobuf" },
    send: (url, options) => { outgoing = options; return fixtureResponse(url, options); },
  });
  assert.equal(protobufJson.statusCode, 200);
  assert.equal(outgoing.body.toString(), "[1,2]");
  assert.equal(outgoing.headers["content-type"], "application/json+protobuf");
});

test("official uBlock core blocks an ad request and honors supplied domain exceptions", async () => {
  assert.equal(await isBlocked("https://securepubads.g.doubleclick.net/tag/js/gpt.js", "https://example.com/", "script"), true);
  assert.equal(await isBlocked("https://google-analytics.com/analytics.js", "https://example.com/", "script"), false);
  assert.equal(await isBlocked("https://discord.com/api/", "https://example.com/", "xmlhttprequest"), false);
  let sent = false;
  const blocked = await invoke("https://securepubads.g.doubleclick.net/tag/js/gpt.js", { blocked: isBlocked, send: async () => { sent = true; } });
  assert.equal(blocked.statusCode, 204);
  assert.equal(blocked.headers["x-bromine-adblock"], "blocked");
  assert.equal(sent, false);
});
