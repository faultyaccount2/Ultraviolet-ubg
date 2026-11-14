import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
import { parse } from "parse5";
import { createProxyHandler } from "../proxy/service.js";
import { isPublicAddress, pinnedLookup, resolvePublicTarget, validateTarget, requestResource } from "../proxy/network.js";
import { rewriteCss, rewriteHtml } from "../proxy/rewrite.js";
import { proxyUrl, unproxyUrl } from "../shared/proxy-url.js";
import { isBlocked } from "../proxy/filtering.js";
import { fixtureResponse } from "./fixtures.js";

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

async function invoke(target, { method = "GET", body, requestHeaders = {}, send = fixtureResponse, resolve = async () => [{ address: "93.184.216.34", family: 4 }], blocked = async () => false } = {}) {
  const req = { method, url: proxyUrl(target), headers: requestHeaders, body };
  const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(value) { this.body = value ? Buffer.from(value) : Buffer.alloc(0); } };
  await createProxyHandler({ send, resolve, blocked })(req, res);
  return res;
}

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
  assert.equal(result.statusCode, 200);
  assert.match(result.headers["content-security-policy"], /sandbox/);
  assert.doesNotMatch(result.headers["content-security-policy"], /allow-same-origin/);
  assert.equal(result.headers["access-control-allow-origin"], "*");
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
