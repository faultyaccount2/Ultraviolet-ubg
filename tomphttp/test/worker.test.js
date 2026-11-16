import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler, websocketSession } from "../src/index.js";
import { targetUrl, resolvePublic } from "../src/policy.js";
import { joinHeaders, splitHeaders } from "../src/protocol.js";

function request(remote = "https://www.cloudflare.com/", headers = {}, options = {}) {
  return new Request("https://bare.example.org/bare/v3/", {
    ...options,
    headers: { origin: "https://scramjet-ubg.vercel.app", "x-bare-url": remote, "x-bare-headers": "{}", ...headers },
  });
}
const resolve = async () => {};

test("discovery, health, CORS preflight and origin restrictions", async () => {
  const handle = createHandler({ fetcher: () => assert.fail("Unexpected upstream fetch") });
  assert.equal(await (await handle(new Request("https://bare.example.org/healthz"))).text(), "ok\n");
  const info = await handle(new Request("https://bare.example.org/bare/", {
    headers: { origin: "https://scramjet-ubg.vercel.app" },
  }));
  assert.deepEqual((await info.json()).versions, ["v3"]);
  const preflight = await handle(request(undefined, {
    origin: "https://scramjet.example.org",
    "access-control-request-headers": "x-bare-url, x-bare-headers-0",
  }, { method: "OPTIONS" }), { BARE_ALLOWED_ORIGINS: "https://scramjet.example.org" });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://scramjet.example.org");
  assert.match(preflight.headers.get("access-control-allow-headers"), /x-bare-headers-0/);
  assert.equal((await handle(request(), { BARE_ALLOWED_ORIGINS: "https://scramjet.example.org" })).status, 403);
  const withoutOrigin = new Request("https://bare.example.org/bare/v3/", {
    headers: { "x-bare-url": "https://www.cloudflare.com/", "x-bare-headers": "{}" },
  });
  assert.equal((await handle(withoutOrigin)).status, 403);
  assert.equal((await handle(new Request("https://bare.example.org/nope", {
    headers: { origin: "https://scramjet-ubg.vercel.app" },
  }))).status, 404);
});

test("private, internal, encoded IP and blocked destinations fail closed", () => {
  for (const host of ["localhost", "local", "foo.local", "metadata.google.internal", "127.1", "2130706433", "0x7f000001",
    "10.0.0.1", "169.254.169.254", "192.168.1.1", "100.64.0.1", "[::1]", "[::ffff:127.0.0.1]", "[fc00::1]", "[2001:db8::1]"]) {
    assert.throws(() => targetUrl(`https://${host}/`, {}), { status: 403 }, host);
  }
  for (const value of ["file:///etc/passwd", "https://user:pass@public.org/", "https://public.org:8443/", "https://public.org/#hash"]) {
    assert.throws(() => targetUrl(value, {}), { status: 403 });
  }
  assert.throws(() => targetUrl("https://a.blocked.org/", { BARE_BLOCKED_HOSTS: "*.blocked.org" }), { status: 403 });
  assert.throws(() => targetUrl("https://blocked.org/", { BARE_BLOCKED_HOSTS: "blocked.org" }), { status: 403 });
  assert.equal(targetUrl("https://1.1.1.1/", {}).hostname, "1.1.1.1");
});

test("DNS checks reject mixed private answers, internal aliases and lookup errors", async () => {
  const lookup = (answers, Status = 0) => async () => Response.json({ Status, Answer: answers });
  await resolvePublic("public.org", lookup([{ type: 1, data: "1.1.1.1" }]));
  await assert.rejects(resolvePublic("public.org", lookup([{ type: 1, data: "1.1.1.1" }, { type: 28, data: "::1" }])), { status: 403 });
  await assert.rejects(resolvePublic("public.org", lookup([{ type: 5, data: "private.internal." }, { type: 1, data: "1.1.1.1" }])), { status: 403 });
  await assert.rejects(resolvePublic("public.org", lookup([{ type: 5, data: "blocked.org." }, { type: 1, data: "1.1.1.1" }]), {
    BARE_BLOCKED_HOSTS: "blocked.org",
  }), { status: 403 });
  await assert.rejects(resolvePublic("public.org", lookup([])), { status: 502 });
  await assert.rejects(resolvePublic("public.org", lookup([], 3)), { status: 502 });
});

test("HTTP bodies stream, redirects stay manual and remote cookies stay inside metadata", async () => {
  let upstream;
  let bodyRead = false;
  const body = new ReadableStream({ pull(controller) {
    bodyRead = true;
    controller.enqueue(new TextEncoder().encode("streamed"));
    controller.close();
  } }, { highWaterMark: 0 });
  const handle = createHandler({ resolve, fetcher: (url, options) => {
    upstream = { url, options };
    return new Response(body, {
      status: 302, statusText: "Found",
      headers: { location: "http://127.0.0.1/", "set-cookie": "site=private; HttpOnly", "cache-control": "private", "content-type": "text/html" },
    });
  } });
  const result = await handle(request("https://public.org/", {
    cookie: "app=never-forward", authorization: "Bearer app-secret",
    "x-bare-headers": JSON.stringify({ Cookie: "site=private", Origin: "https://public.org", Connection: "keep-alive", Host: "spoof.org" }),
    "x-bare-forward-headers": '"origin", "referer"',
    "x-bare-pass-headers": "set-cookie, access-control-allow-origin, location",
  }));
  assert.equal(bodyRead, false);
  assert.equal(upstream.options.redirect, "manual");
  assert.equal(upstream.options.headers.get("cookie"), "site=private");
  assert.equal(upstream.options.headers.get("authorization"), null);
  assert.equal(upstream.options.headers.get("host"), null);
  assert.equal(upstream.options.headers.get("origin"), "https://public.org");
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("x-bare-status"), "302");
  assert.equal(result.headers.get("set-cookie"), null);
  assert.equal(result.headers.get("location"), null);
  assert.equal(result.headers.get("access-control-allow-origin"), "https://scramjet-ubg.vercel.app");
  assert.deepEqual(JSON.parse(joinHeaders(result.headers))["set-cookie"], ["site=private; HttpOnly"]);
  assert.equal(await result.text(), "streamed");
});

test("split headers round trip and invalid metadata is rejected before fetching", async () => {
  const headers = new Headers();
  const value = JSON.stringify({ Cookie: `${"x".repeat(8000)}😀`.repeat(2) });
  splitHeaders(headers, value);
  assert.deepEqual(JSON.parse(joinHeaders(headers)), JSON.parse(value));
  for (const [, part] of headers) assert.ok(new TextEncoder().encode(part).length <= 3072);
  const handle = createHandler({ resolve, fetcher: () => assert.fail("Invalid metadata reached upstream") });
  for (const extra of [
    { "x-bare-headers": "{" },
    { "x-bare-headers": "[]" },
    { "x-bare-headers": '{"header":12}' },
    { "x-bare-headers": '{"header":"bad\\r\\nvalue"}' },
    { "x-bare-headers": "{}", "x-bare-headers-0": ";{}" },
    { "x-bare-pass-status": "999" },
  ]) assert.equal((await handle(request(undefined, extra))).status, 400);
  assert.throws(() => joinHeaders(new Headers({ "x-bare-headers-1": ";{}" })));
});

test("HEAD, streamed POST, pass statuses and compressed body headers are preserved", async () => {
  const handle = createHandler({ resolve, fetcher: async (_url, options) => {
    if (options.method === "POST") assert.equal(await new Response(options.body).text(), "payload");
    return new Response(options.method === "HEAD" ? null : "encoded", {
      status: 201, statusText: "Created",
      headers: { "content-encoding": "gzip", "content-length": "7", "last-modified": "Mon, 16 Nov 2026 00:00:00 GMT" },
    });
  } });
  const posted = await handle(request(undefined, { "x-bare-pass-status": "201" }, { method: "POST", body: "payload" }));
  assert.equal(posted.status, 201);
  assert.equal(posted.headers.get("content-encoding"), "gzip");
  assert.equal(await posted.text(), "encoded");
  const head = await handle(request(undefined, {}, { method: "HEAD" }));
  assert.equal(head.body, null);
});

class Socket extends EventTarget {
  readyState = 1;
  sent = [];
  send(value) { this.sent.push(value); }
  accept() { this.accepted = true; }
  close(code, reason) { this.readyState = 3; this.code = code; this.reason = reason; this.dispatchEvent(new Event("close")); }
  message(data) { this.dispatchEvent(new MessageEvent("message", { data })); }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test("v3 WebSocket handshake relays text/binary, protocol, cookies and close without storage", async () => {
  const client = new Socket();
  const remote = new Socket();
  await websocketSession(client, request(), {}, { resolve, fetcher: async (url, options) => {
    assert.equal(url, "https://echo.websocket.org/");
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers.get("sec-websocket-protocol"), "echo");
    return { status: 101, webSocket: remote, headers: new Headers({ "sec-websocket-protocol": "echo", "set-cookie": "session=test" }) };
  } });
  client.message(JSON.stringify({ type: "connect", remote: "wss://echo.websocket.org/", protocols: ["echo"], headers: {}, forwardHeaders: [] }));
  await tick();
  assert.deepEqual(JSON.parse(client.sent[0]), { type: "open", protocol: "echo", setCookies: ["session=test"] });
  assert.equal(remote.accepted, true);
  client.message("hello");
  const binary = new Uint8Array([0, 1, 255]).buffer;
  remote.message(binary);
  assert.equal(remote.sent[0], "hello");
  assert.equal(client.sent[1], binary);
  client.close(1000);
  assert.equal(remote.readyState, 3);
});

test("invalid or private WebSocket handshakes close with a policy error", async () => {
  for (const data of ["invalid", new ArrayBuffer(1), JSON.stringify({ type: "connect", remote: "ws://127.0.0.1/", protocols: [], headers: {}, forwardHeaders: [] })]) {
    const client = new Socket();
    await websocketSession(client, request(), {}, { resolve, fetcher: () => assert.fail("Invalid handshake fetched") });
    client.message(data);
    await tick();
    assert.equal(client.code, 1008);
  }
});
