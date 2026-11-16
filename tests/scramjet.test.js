import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MemoryCacheStorage } from "../frontend/memory-cache.js";
import { scramjetControl } from "../frontend/scramjet.js";
import { validateBareUrl, validateScramjetOrigin, validateTransport, validateWispUrl } from "../scramjet-host/config.js";
import { PublicAssetCache, publicAssetRequest, publicAssetTtl } from "../scramjet-host/cache.js";
import { isBlocked as browserBlocked, loadFiltering } from "../scramjet-host/filtering.js";
import { isBlocked as backendBlocked } from "../proxy/filtering.js";

test("Scramjet requires a separate secure frontend and a valid public Wisp URL", () => {
  assert.equal(validateScramjetOrigin("https://scramjet.example", "https://bromine.example"), "https://scramjet.example");
  assert.equal(validateWispUrl("wss://server.onrender.com/wisp/"), "wss://server.onrender.com/wisp/");
  assert.throws(() => validateScramjetOrigin("https://bromine.example", "https://bromine.example"), /separate origin/);
  assert.throws(() => validateScramjetOrigin("http://scramjet.example", "https://bromine.example"), /HTTPS/);
  for (const value of ["https://server.example/wisp/", "ws://server.example/wisp/", "wss://server.example/wisp/?token=secret", "wss://user:pass@server.example/wisp/", "wss://server.example/wisp"]) {
    assert.throws(() => validateWispUrl(value));
  }
});

test("Bare is always the default and explicit Wisp selection remains independent", () => {
  const config = { bareUrl: "https://bare.example.org/bare/", wispUrl: "wss://wisp.example.org/wisp/" };
  assert.equal(validateTransport(config), "bare");
  assert.equal(validateTransport({ ...config, transport: "wisp", bareUrl: "invalid" }), "wisp");
  assert.equal(validateTransport({ wispUrl: config.wispUrl }), "bare");
  assert.equal(validateTransport({ wispUrl: config.wispUrl, transport: "wisp" }), "wisp");
  assert.equal(validateTransport({ transport: "bare", wispUrl: config.wispUrl }), "bare");
  assert.throws(() => validateTransport({ ...config, transport: "unknown" }), /Choose/);
  assert.equal(validateBareUrl("http://127.0.0.1:8787/bare/"), "http://127.0.0.1:8787/bare/");
  for (const value of ["http://bare.example.org/bare/", "https://user:pass@bare.example.org/bare/", "https://bare.example.org/bare", "https://bare.example.org/bare/?token=secret"]) {
    assert.throws(() => validateBareUrl(value));
  }
});

test("Scramjet control frame is recreated when its Wisp endpoint or filtering mode changes", (t) => {
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const frames = [];
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { origin: "http://127.0.0.1:3000" },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement() {
        const frame = {
          addEventListener() {},
          removeEventListener() {},
          setAttribute() {},
          remove() { this.removed = true; },
        };
        frames.push(frame);
        return frame;
      },
      body: { append() {} },
    },
  });
  t.after(() => {
    frames.at(-1)?.bridge?.close();
    if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
    else delete globalThis.location;
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else delete globalThis.document;
  });

  const config = {
    origin: "http://127.0.0.1:4174",
    wispUrl: "ws://127.0.0.1:4175/wisp/",
    adblock: false,
  };
  const first = scramjetControl(config);
  frames[0].bridge = first;
  assert.equal(scramjetControl({ ...config }), first);

  const changedEndpoint = scramjetControl({ ...config, wispUrl: "ws://127.0.0.1:4176/wisp/" });
  frames[1].bridge = changedEndpoint;
  assert.notEqual(changedEndpoint, first);
  assert.equal(frames[0].removed, true);

  const changedFiltering = scramjetControl({ ...config, wispUrl: "ws://127.0.0.1:4176/wisp/", adblock: true });
  frames[2].bridge = changedFiltering;
  assert.notEqual(changedFiltering, changedEndpoint);
  assert.equal(frames[1].removed, true);

  const changedTransport = scramjetControl({ ...config, transport: "bare", bareUrl: "http://127.0.0.1:8787/bare/" });
  frames[3].bridge = changedTransport;
  assert.notEqual(changedTransport, changedFiltering);
  const changedBare = scramjetControl({ ...config, transport: "bare", bareUrl: "http://127.0.0.1:8788/bare/" });
  frames[4].bridge = changedBare;
  assert.notEqual(changedBare, changedTransport);
});

test("Scramjet cache excludes private, credentialed and API requests and accounts for upstream age", () => {
  const options = { url: "https://fixture.example/app.js", method: "GET", headers: new Headers(), destination: "script", cacheMode: "default" };
  assert.equal(publicAssetRequest(options), true);
  for (const name of ["authorization", "cookie", "range"]) assert.equal(publicAssetRequest({ ...options, headers: new Headers({ [name]: "private" }) }), false);
  assert.equal(publicAssetRequest({ ...options, destination: "" }), false);
  assert.equal(publicAssetRequest({ ...options, url: `${options.url}?token=private` }), false);
  assert.equal(publicAssetTtl(new Headers({ "cache-control": "max-age=60", age: "55" }), 200), 5);
  for (const headers of [
    { "cache-control": "private, max-age=60" },
    { "cache-control": "no-store, max-age=60" },
    { "cache-control": "max-age=60", "set-cookie": "private=value" },
    { "cache-control": "max-age=60", vary: "Cookie" },
    { "cache-control": "max-age=60", age: "61" },
  ]) assert.equal(publicAssetTtl(new Headers(headers), 200), 0);
});

test("Scramjet cache snapshots assets, honors Vary and clears only the selected site", async () => {
  const errors = [];
  const cache = new PublicAssetCache(new MemoryCacheStorage(), (error) => errors.push(error.message));
  const first = { url: "https://cdn.example/asset.js", site: "first.example", version: "0", method: "GET", headers: new Headers({ "accept-language": "en" }), destination: "script", cacheMode: "default" };
  const headers = new Headers({ "cache-control": "public, max-age=60", vary: "Accept-Language" });
  cache.put(first, new Response("first", { headers }), [...headers]);
  cache.put({ ...first, site: "other.example" }, new Response("other", { headers }), [...headers]);
  assert.equal(await (await cache.match(first)).text(), "first");
  assert.equal(await cache.match({ ...first, headers: new Headers({ "accept-language": "fr" }) }), null);
  assert.equal((await cache.stats()).entries, 2);
  await cache.clear({ site: "first.example" });
  assert.equal(await cache.match(first), null);
  assert.equal(await (await cache.match({ ...first, site: "other.example" })).text(), "other");
  assert.deepEqual(errors, []);
});

test("slow asset bodies cannot extend upstream freshness and oversized assets are not copied", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const errors = [];
  const cache = new PublicAssetCache(new MemoryCacheStorage(), (error) => errors.push(error.message));
  const options = { url: "https://fixture.example/slow.js", site: "fixture.example", method: "GET", headers: new Headers(), destination: "script" };
  let controller;
  const body = new ReadableStream({ start(value) { controller = value; } });
  cache.put(options, new Response(body), [["cache-control", "public, max-age=5"]]);
  now += 6000;
  controller.enqueue(new TextEncoder().encode("expired before its body arrived"));
  controller.close();
  assert.equal((await cache.stats()).entries, 0);
  const oversized = new Response("declared oversized");
  oversized.clone = () => { throw new Error("Oversized assets must be rejected before cloning."); };
  cache.put(options, oversized, [["cache-control", "public, max-age=60"], ["content-length", String(20 * 1024 * 1024)]]);
  assert.equal((await cache.stats()).entries, 0);
  assert.deepEqual(errors, []);
});

test("the browser filter adapter matches the backend's official compiled filter decisions", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => new Response(await readFile(
    url === "/filters.json" ? new URL("../filters/compiled.json", import.meta.url) :
      new URL("../scramjet-host/public/publicsuffixlist.json", import.meta.url),
  )));
  await loadFiltering();
  for (const [url, type] of [
    ["https://securepubads.g.doubleclick.net/tag/js/gpt.js", "script"],
    ["https://google-analytics.com/analytics.js", "script"],
    ["https://discord.com/api/", "xmlhttprequest"],
    ["https://fixture.example/style.css", "stylesheet"],
    ["https://fixture.example/", "document"],
  ]) assert.equal(browserBlocked(url, "https://example.com/", type), await backendBlocked(url, "https://example.com/", type), url);
});
