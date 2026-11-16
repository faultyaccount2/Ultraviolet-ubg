import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { Duplex } from "node:stream";
import {
  loadConfig, checkDestination, WispSession, parsePacket, connectPacket, packet, closePacket,
  PACKET, STREAM, REASON,
} from "../src/wisp.js";

// Node stand-in for cloudflare:sockets connect(); ignores the hostname and dials a local port.
function fakeConnect(localPort) {
  return () => {
    const sock = net.connect(localPort, "127.0.0.1");
    const { readable, writable } = Duplex.toWeb(sock);
    const opened = new Promise((res, rej) => { sock.once("connect", res); sock.once("error", rej); });
    return { readable, writable, opened, close: () => sock.destroy() };
  };
}

function fakeWs() {
  const out = [];
  const waiters = [];
  return {
    out,
    send(u8) { out.push(parsePacket(u8.slice())); waiters.splice(0).forEach((w) => w()); },
    close() {},
    async next(pred, ms = 3000) {
      const start = Date.now();
      for (;;) {
        const i = out.findIndex(pred);
        if (i >= 0) return out.splice(i, 1)[0];
        if (Date.now() - start > ms) throw new Error("timed out waiting for packet");
        await new Promise((r) => { waiters.push(r); setTimeout(r, 50); });
      }
    },
  };
}

test("config defaults and validation", () => {
  const c = loadConfig({});
  assert.equal(c.path, "/wisp/");
  assert.deepEqual(c.allowedPorts, [[80, 80], [443, 443]]);
  assert.throws(() => loadConfig({ WISP_ALLOWED_HOSTS: "a.com", WISP_BLOCKED_HOSTS: "b.com" }));
  assert.throws(() => loadConfig({ WISP_ALLOWED_ORIGINS: "https://x.com/" }));
  assert.throws(() => loadConfig({ WISP_ALLOWED_PORTS: "99999" }));
});

test("destination checks", () => {
  const c = loadConfig({ WISP_BLOCKED_HOSTS: "*.bad.com" });
  assert.equal(checkDestination(c, STREAM.TCP, "example.com", 443), 0);
  assert.equal(checkDestination(c, STREAM.UDP, "example.com", 443), REASON.INVALID_INFO);
  assert.equal(checkDestination(c, STREAM.TCP, "example.com", 22), REASON.BLOCKED);
  assert.equal(checkDestination(c, STREAM.TCP, "1.1.1.1", 443), REASON.BLOCKED);
  assert.equal(checkDestination(c, STREAM.TCP, "localhost", 80), REASON.BLOCKED);
  assert.equal(checkDestination(c, STREAM.TCP, "x.bad.com", 443), REASON.BLOCKED);
  const a = loadConfig({ WISP_ALLOWED_HOSTS: "ok.com" });
  assert.equal(checkDestination(a, STREAM.TCP, "ok.com", 443), 0);
  assert.equal(checkDestination(a, STREAM.TCP, "no.com", 443), REASON.BLOCKED);
});

test("relays data both ways, sends CONTINUE and CLOSE", async () => {
  const echo = net.createServer((s) => s.pipe(s)).listen(0);
  await new Promise((r) => echo.once("listening", r));
  const ws = fakeWs();
  const cfg = loadConfig({ WISP_BUFFER_SIZE: "4" });
  const session = new WispSession(ws, fakeConnect(echo.address().port), cfg);
  session.start();
  const first = await ws.next((p) => p.type === PACKET.CONTINUE && p.streamId === 0);
  assert.equal(new DataView(first.payload.buffer, first.payload.byteOffset).getUint32(0, true), 4);

  session.onMessage(connectPacket(7, STREAM.TCP, 80, "example.com"));
  const msg = new TextEncoder().encode("hello wisp");
  session.onMessage(packet(PACKET.DATA, 7, msg));
  session.onMessage(packet(PACKET.DATA, 7, msg));
  const d = await ws.next((p) => p.type === PACKET.DATA && p.streamId === 7);
  assert.match(new TextDecoder().decode(d.payload), /hello wisp/);
  await ws.next((p) => p.type === PACKET.CONTINUE && p.streamId === 7);

  session.onMessage(closePacket(7, REASON.VOLUNTARY));
  assert.equal(session.streams.size, 0);
  session.shutdown();
  echo.close();
});

test("blocked and throttled streams get CLOSE", async () => {
  const echo = net.createServer((s) => s.pipe(s)).listen(0);
  await new Promise((r) => echo.once("listening", r));
  const ws = fakeWs();
  const session = new WispSession(ws, fakeConnect(echo.address().port), loadConfig({ WISP_STREAM_LIMIT_PER_HOST: "1" }));
  session.onMessage(connectPacket(1, STREAM.TCP, 25, "example.com"));
  const c1 = await ws.next((p) => p.type === PACKET.CLOSE && p.streamId === 1);
  assert.equal(c1.payload[0], REASON.BLOCKED);
  session.onMessage(connectPacket(2, STREAM.TCP, 80, "example.com"));
  session.onMessage(connectPacket(3, STREAM.TCP, 80, "example.com"));
  const c3 = await ws.next((p) => p.type === PACKET.CLOSE && p.streamId === 3);
  assert.equal(c3.payload[0], REASON.THROTTLED);
  session.shutdown();
  echo.close();
});

test("upstream close sends VOLUNTARY close", async () => {
  const srv = net.createServer((s) => s.end("bye")).listen(0);
  await new Promise((r) => srv.once("listening", r));
  const ws = fakeWs();
  const session = new WispSession(ws, fakeConnect(srv.address().port), loadConfig({}));
  session.onMessage(connectPacket(5, STREAM.TCP, 80, "example.com"));
  const d = await ws.next((p) => p.type === PACKET.DATA && p.streamId === 5);
  assert.equal(new TextDecoder().decode(d.payload), "bye");
  const c = await ws.next((p) => p.type === PACKET.CLOSE && p.streamId === 5);
  assert.equal(c.payload[0], REASON.VOLUNTARY);
  srv.close();
});
