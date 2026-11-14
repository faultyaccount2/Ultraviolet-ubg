import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWebSocketAllowlist, validateWebSocketProtocols, validateWebSocketTarget } from "../supabase/functions/_shared/websocket-relay.js";

test("the WebSocket relay fails closed without an explicit exact-host allowlist", () => {
  assert.throws(() => parseWebSocketAllowlist(""), /approved destination hosts/);
  assert.throws(() => parseWebSocketAllowlist("*.example.com"), /exact DNS/);
  assert.throws(() => parseWebSocketAllowlist("bad..example.com"), /public DNS/);
  assert.throws(() => parseWebSocketAllowlist("127.0.0.1"), /public DNS/);
  assert.deepEqual([...parseWebSocketAllowlist("Gateway.Discord.GG, discord.com.")], ["gateway.discord.gg", "discord.com"]);
});

test("the WebSocket relay accepts only secure default-port targets on the exact allowlist", () => {
  const allowed = parseWebSocketAllowlist("gateway.discord.gg, discord.com");
  assert.equal(validateWebSocketTarget("wss://gateway.discord.gg/?v=10", allowed).href, "wss://gateway.discord.gg/?v=10");
  for (const value of [
    "ws://gateway.discord.gg/",
    "wss://evil.example/",
    "wss://discord.com.attacker.example/",
    "wss://user:pass@discord.com/",
    "wss://discord.com:8443/",
    "wss://127.0.0.1/",
    "wss://localhost/",
  ]) assert.throws(() => validateWebSocketTarget(value, allowed), undefined, value);
});

test("WebSocket protocols reject invalid, duplicate, and oversized offers", () => {
  assert.deepEqual(validateWebSocketProtocols(["json", "v10"]), ["json", "v10"]);
  for (const value of [["json", "json"], ["has space"], ["x".repeat(129)], Array.from({ length: 21 }, () => "v")]) {
    assert.throws(() => validateWebSocketProtocols(value));
  }
});
