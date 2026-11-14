import { test } from "node:test";
import assert from "node:assert/strict";
import { domainMatches, parseDomainRules, routeRequest } from "../shared/routing.js";
import { redactUrl } from "../shared/address.js";

test("routing defaults to native Direct and remains independent of filter exceptions", () => {
  assert.equal(routeRequest("https://google.com/").mode, "direct");
  assert.equal(routeRequest("https://packsmc.com/").mode, "direct");
  assert.equal(routeRequest("https://example.com/", { rules: { block: ["example.com"] } }).mode, "proxy");
  assert.equal(routeRequest("https://example.com/", { mode: "proxy" }).reason, "USER_FORCE_PROXY");
  assert.equal(routeRequest("https://example.com/", { mode: "proxy", sites: { "example.com": { mode: "direct" } } }).mode, "direct");
});

test("exact, subdomain, inherited and temporary rules have clear precedence", () => {
  assert.equal(domainMatches("badexample.com", "example.com"), false);
  assert.equal(domainMatches("cdn.example.com", "example.com"), true);
  assert.equal(domainMatches("cdn.example.com", "=example.com"), false);
  assert.equal(domainMatches("example.com", "*.example.com"), false);
  assert.deepEqual(parseDomainRules("=example.com\n*.example.org, example.net"), ["=example.com", "*.example.org", "example.net"]);
  assert.throws(() => parseDomainRules("https://example.com/"), /Invalid domain/);
  const inherited = routeRequest("https://cdn.example.com/", { parentRoute: { mode: "proxy" } });
  assert.equal(inherited.inheritedFrom, "proxy");
  assert.equal(routeRequest("https://example.com/", { temporary: [{ domain: "example.com", mode: "proxy", expires: Date.now() + 10000 }] }).mode, "proxy");
  assert.equal(routeRequest("https://example.com/", { temporary: [{ domain: "example.com", mode: "proxy", expires: 0 }] }).mode, "direct");
  assert.throws(() => routeRequest("http://127.0.0.1/"), /Private/);
});

test("persisted metadata redacts credentials and sensitive query/fragment values", () => {
  assert.equal(redactUrl("https://user:secret@example.com/path?q=normal&access_token=secret&api_key=secret#access_token=hidden"), "https://example.com/path?q=normal");
});
