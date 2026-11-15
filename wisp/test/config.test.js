import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../config.js";

test("safe defaults", () => {
  const c = loadConfig({});
  assert.equal(c.port, 10000);
  assert.equal(c.path, "/wisp/");
  assert.equal(c.wisp.allow_direct_ip, false);
  assert.equal(c.wisp.allow_private_ips, false);
  assert.equal(c.wisp.allow_loopback_ips, false);
  assert.equal(c.wisp.allow_udp_streams, false);
  assert.deepEqual(c.wisp.port_whitelist, [80, 443]);
  assert.equal(c.wisp.hostname_whitelist, null);
  assert.equal(c.allowedOrigins.size, 0);
});

test("host allowlist supports exact and wildcard", () => {
  const c = loadConfig({ WISP_ALLOWED_HOSTS: "example.com, *.discord.gg" });
  const [exact, wild] = c.wisp.hostname_whitelist;
  assert.ok(exact.test("example.com"));
  assert.ok(!exact.test("evil-example.com"));
  assert.ok(wild.test("gateway.discord.gg"));
  assert.ok(!wild.test("discord.gg.evil.com"));
});

test("rejects bad values", () => {
  assert.throws(() => loadConfig({ PORT: "abc" }), /PORT/);
  assert.throws(() => loadConfig({ WISP_ALLOWED_ORIGINS: "https://a.com/" }), /exact origin/);
  assert.throws(() => loadConfig({ WISP_ALLOWED_PORTS: "99999" }), /out of range|port/);
  assert.throws(() => loadConfig({ WISP_ALLOWED_HOSTS: "a.com", WISP_BLOCKED_HOSTS: "b.com" }), /not both/);
  assert.throws(() => loadConfig({ WISP_ALLOWED_HOSTS: "http://a.com" }), /hostname/);
  assert.throws(() => loadConfig({ WISP_PATH: "wisp" }), /WISP_PATH/);
});
