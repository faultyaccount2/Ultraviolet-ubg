import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { client } from "@mercuryworkshop/wisp-js/client";

const { ClientConnection } = client;
const OPEN_PORT = 18080;      // no origin restriction
const LOCKED_PORT = 18082;    // WISP_ALLOWED_ORIGINS set
const procs = [];

function start(port, extra = {}) {
  const p = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(port), WISP_LOG_LEVEL: "none", ...extra },
    stdio: ["ignore", "pipe", "inherit"],
  });
  procs.push(p);
  return new Promise((resolve) => p.stdout.on("data", (d) => String(d).includes("Listening") && resolve()));
}

before(() => Promise.all([
  start(OPEN_PORT),
  start(LOCKED_PORT, { WISP_ALLOWED_ORIGINS: "https://app.example.com" }),
]));
after(() => procs.forEach((p) => p.kill("SIGTERM")));

function rawUpgrade(port, origin, path = "/wisp/") {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { origin } });
    ws.on("open", () => { ws.close(); resolve("open"); });
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode));
    ws.on("error", () => resolve("error"));
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new ClientConnection(`ws://127.0.0.1:${OPEN_PORT}/wisp/`);
    conn.onopen = () => resolve(conn);
    conn.onerror = () => reject(new Error("wisp connection failed"));
  });
}

function tryStream(conn, host, port) {
  return new Promise((resolve) => {
    const s = conn.create_stream(host, port);
    let data = "";
    s.onmessage = (d) => {
      data += Buffer.from(d).toString();
      if (data.includes("\r\n\r\n")) { s.close(); resolve({ ok: true, data }); }
    };
    s.onclose = (reason) => resolve({ ok: data.length > 0, data, reason });
    s.send(new TextEncoder().encode(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
  });
}

test("health check", async () => {
  assert.equal((await fetch(`http://127.0.0.1:${OPEN_PORT}/healthz`)).status, 200);
});

test("origin allowlist: exact origin passes, others get 403", async () => {
  assert.equal(await rawUpgrade(LOCKED_PORT, "https://app.example.com"), "open");
  assert.equal(await rawUpgrade(LOCKED_PORT, "https://evil.example"), 403);
  assert.equal(await rawUpgrade(LOCKED_PORT, ""), 403);
});

test("unknown WebSocket path gets 404", async () => {
  assert.equal(await rawUpgrade(OPEN_PORT, "x", "/other/"), 404);
});

test("blocks loopback, private, direct-IP and non-allowed ports", async () => {
  const conn = await connect();
  for (const [h, p] of [["127.0.0.1", 80], ["localhost", OPEN_PORT], ["10.0.0.1", 80], ["1.1.1.1", 80], ["example.com", 22]]) {
    const r = await tryStream(conn, h, p);
    assert.equal(r.ok, false, `${h}:${p} should be blocked`);
  }
});

test("relays TCP to a public host on port 80", { skip: process.env.OFFLINE ? "offline" : false }, async () => {
  const conn = await connect();
  const r = await tryStream(conn, "example.com", 80);
  assert.match(r.data, /^HTTP\/1\.[01] \d{3}/);
});
