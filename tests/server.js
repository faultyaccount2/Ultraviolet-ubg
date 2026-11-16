import { execFileSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { createProxyHandler } from "../proxy/service.js";
import { requestResource } from "../proxy/network.js";
import { startServer } from "../scripts/server.js";
import { fixtureResponse } from "./fixtures.js";
import { startWispFixture } from "./wisp-fixture.js";
import { startBareFixture } from "./bare-fixture.js";

execFileSync(process.execPath, ["scripts/build.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    BROMINE_SCRAMJET_ORIGIN: "http://127.0.0.1:4174",
    BROMINE_APP_ORIGINS: "http://127.0.0.1:4173",
    BROMINE_WISP_URL: "ws://127.0.0.1:4175/wisp/",
    BROMINE_BARE_URL: "http://127.0.0.1:4176/bare/",
  },
});
const fixtures = new Set(["fixture.example", "duckduckgo.com", "www.google.com"]);
const proxy = createProxyHandler({
  resolve: (host, options) => fixtures.has(host) ? Promise.resolve([{ address: "93.184.216.34", family: 4 }]) : lookup(host, options),
  send: (url, options) => fixtures.has(url.hostname) ? Promise.resolve(fixtureResponse(url, options)) : requestResource(url, options),
});
startServer(proxy, 4173);
startServer(proxy, 4174, "scramjet-host/public");
startWispFixture();
startBareFixture();
