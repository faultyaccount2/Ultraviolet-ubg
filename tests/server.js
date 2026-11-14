import { execFileSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { createProxyHandler } from "../proxy/service.js";
import { requestResource } from "../proxy/network.js";
import { startServer } from "../scripts/server.js";
import { fixtureResponse } from "./fixtures.js";

execFileSync(process.execPath, ["scripts/build.js"], { stdio: "inherit" });
const fixtures = new Set(["fixture.example", "duckduckgo.com"]);
const proxy = createProxyHandler({
  resolve: (host, options) => fixtures.has(host) ? Promise.resolve([{ address: "93.184.216.34", family: 4 }]) : lookup(host, options),
  send: (url, options) => fixtures.has(url.hostname) ? Promise.resolve(fixtureResponse(url, options)) : requestResource(url, options),
});
startServer(proxy, 4173);
