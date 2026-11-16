import assert from "node:assert/strict";
import WebSocket from "ws";

const base = new URL(process.env.BARE_TEST_URL || "http://127.0.0.1:8787/bare/");
assert.equal(await (await fetch(new URL("/healthz", base))).text(), "ok\n");
assert.deepEqual((await (await fetch(base, { headers: { origin: "https://scramjet-ubg.vercel.app" } })).json()).versions, ["v3"]);
for (const target of ["https://www.cloudflare.com/cdn-cgi/trace", "http://info.cern.ch/"]) {
  const response = await fetch(new URL("v3/", base), {
    headers: { origin: "https://scramjet-ubg.vercel.app", "x-bare-url": target, "x-bare-headers": "{}" },
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("x-bare-status"), "200");
  const body = await response.text();
  assert.match(body, target.includes("cloudflare") ? /h=www\.cloudflare\.com/ : /http:\/\/info\.cern\.ch/);
  console.log("HTTP OK", target);
}
const endpoint = new URL("v3/", base);
endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
await new Promise((resolve, reject) => {
  const ws = new WebSocket(endpoint, { headers: { origin: "https://scramjet-ubg.vercel.app" } });
  let opened = false;
  const timer = setTimeout(() => { ws.terminate(); reject(new Error("Echo timed out")); }, 30000);
  ws.on("error", reject);
  ws.on("close", () => { if (!opened) reject(new Error("Bare WebSocket closed before open")); });
  ws.on("open", () => ws.send(JSON.stringify({
    type: "connect", remote: "wss://echo.websocket.org/", protocols: [], headers: {}, forwardHeaders: [],
  })));
  ws.on("message", (data, binary) => {
    if (!opened) {
      assert.equal(JSON.parse(data.toString()).type, "open");
      opened = true;
      ws.send("bromine-bare-echo");
    } else if (!binary && data.toString() === "bromine-bare-echo") {
      ws.send(Buffer.from([0, 1, 255]));
    } else if (binary) {
      assert.deepEqual([...data], [0, 1, 255]);
      clearTimeout(timer);
      ws.close();
      resolve();
    }
  });
});
console.log("WebSocket text/binary echo OK");
