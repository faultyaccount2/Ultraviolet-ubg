import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { WebSocketServer } from "ws";

const page = `<!doctype html><title>Scramjet fixture</title><link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/style.css">
<h1>Scramjet fixture</h1><p id="script">Waiting</p><p id="api">Waiting</p><p id="module">Waiting</p><p id="url"></p><p id="storage"></p><p id="socket">Waiting</p><p id="cookie"></p>
<img src="/cached.svg" alt="Cached fixture"><a href="/next">Next fixture</a>
<button id="save">Save fixture login</button><button id="connect">Connect fixture socket</button>
<button id="push">Push fixture route</button><button id="replace">Replace fixture route</button><button id="cookie-button">Set fixture cookie</button><a href="/file.txt" download>Download fixture file</a>
<form action="/post" method="post"><input name="name" value="Bromine"><button>POST fixture</button></form>
<script src="/app.js"></script><script type="module">import { value } from "/module.js"; document.querySelector("#module").textContent = value;</script>`;
const script = `document.querySelector("#script").textContent = "Script executed";
document.querySelector("#url").textContent = location.href;
document.querySelector("#storage").textContent = localStorage.getItem("login") || "signed out";
fetch("/api").then(response => response.text()).then(text => document.querySelector("#api").textContent = text);
document.querySelector("#save").onclick = () => { localStorage.setItem("login", "fixture-saved"); document.querySelector("#storage").textContent = "fixture-saved"; };
document.querySelector("#push").onclick = () => { history.pushState({}, "", "/?route=changed"); document.querySelector("#url").textContent = location.href; };
document.querySelector("#replace").onclick = () => { history.replaceState({}, "", "/?route=replaced"); document.querySelector("#url").textContent = location.href; };
document.querySelector("#connect").onclick = () => { const socket = new WebSocket("ws://fixture.example/socket"); socket.onopen = () => socket.send("hello"); socket.onmessage = event => { document.querySelector("#socket").textContent = event.data; socket.close(); }; socket.onerror = () => { document.querySelector("#socket").textContent = "Socket failed"; }; };
document.querySelector("#cookie-button").onclick = () => fetch("/cookie").then(response => response.text()).then(text => { document.querySelector("#cookie").textContent = text; });`;

function packet(type, id, body = Buffer.alloc(0)) {
  const result = Buffer.alloc(5 + body.length);
  result[0] = type;
  result.writeUInt32LE(id, 1);
  body.copy(result, 5);
  return result;
}

export function startWispFixture(port = 4175) {
  const counts = {};
  const server = createServer((request, response) => {
    if (request.url !== "/stats") { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(counts));
  });
  const websocket = new WebSocketServer({ noServer: true, handleProtocols: () => false });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/wisp/" || request.headers.origin !== "http://127.0.0.1:4174") { socket.destroy(); return; }
    websocket.handleUpgrade(request, socket, head, (connection) => websocket.emit("connection", connection));
  });
  websocket.on("connection", (connection) => {
    const streams = new Map();
    const allowance = Buffer.alloc(4);
    allowance.writeUInt32LE(128);
    connection.send(packet(3, 0, allowance));
    connection.on("message", (data) => {
      const message = Buffer.from(data);
      if (message.length < 5) { connection.close(); return; }
      const type = message[0];
      const id = message.readUInt32LE(1);
      const payload = message.subarray(5);
      if (type === 1) {
        if (payload.length < 4 || payload[0] !== 1 || payload.readUInt16LE(1) !== 80 || !["fixture.example", "other.example"].includes(payload.subarray(3).toString())) {
          connection.send(packet(4, id, Buffer.from([2]))); return;
        }
        streams.set(id, { buffer: Buffer.alloc(0), websocket: false });
        return;
      }
      if (type === 4) { streams.delete(id); return; }
      if (type !== 2 || !streams.has(id)) return;
      const stream = streams.get(id);
      stream.buffer = Buffer.concat([stream.buffer, payload]);
      connection.send(packet(3, id, allowance));
      if (stream.websocket) {
        while (stream.buffer.length >= 6) {
          const opcode = stream.buffer[0] & 15;
          let length = stream.buffer[1] & 127;
          let offset = 2;
          if (length === 126) { if (stream.buffer.length < 8) return; length = stream.buffer.readUInt16BE(2); offset = 4; }
          if (length > 4096 || !(stream.buffer[1] & 128)) { connection.close(); return; }
          if (stream.buffer.length < offset + 4 + length) return;
          const mask = stream.buffer.subarray(offset, offset + 4);
          const body = Buffer.from(stream.buffer.subarray(offset + 4, offset + 4 + length));
          for (let index = 0; index < body.length; index++) body[index] ^= mask[index % 4];
          stream.buffer = stream.buffer.subarray(offset + 4 + length);
          const text = opcode === 1 ? Buffer.from(`echo:${body.toString()}`) : body;
          connection.send(packet(2, id, Buffer.concat([Buffer.from([128 | (opcode === 9 ? 10 : opcode), text.length]), text])));
          if (opcode === 8) { connection.send(packet(4, id, Buffer.from([2]))); streams.delete(id); return; }
        }
        return;
      }
      const end = stream.buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const headerText = stream.buffer.subarray(0, end).toString();
      const [line, ...rawHeaders] = headerText.split("\r\n");
      const [method, path] = line.split(" ");
      const headers = new Headers(rawHeaders.map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()]));
      const length = Number(headers.get("content-length") || 0);
      if (stream.buffer.length < end + 4 + length) return;
      const url = new URL(path, "http://fixture.example");
      counts[url.pathname] = (counts[url.pathname] || 0) + 1;
      if (url.pathname === "/socket" && headers.get("upgrade")?.toLowerCase() === "websocket") {
        const accept = createHash("sha1").update(headers.get("sec-websocket-key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
        connection.send(packet(2, id, Buffer.from(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)));
        stream.websocket = true;
        stream.buffer = stream.buffer.subarray(end + 4);
        return;
      }
      let body;
      let contentType = "text/html";
      let extra = "";
      let cacheControl = "no-store";
      let status = "200 OK";
      if (url.pathname === "/") body = page;
      else if (url.pathname === "/not-found") { body = page; status = "404 Not Found"; }
      else if (url.pathname === "/challenge") { body = page; extra = "cf-mitigated: challenge\r\n"; }
      else if (url.pathname === "/next") body = "<title>Next Scramjet fixture</title><h1>Next Scramjet fixture</h1><a href='/'>Previous fixture</a>";
      else if (url.pathname === "/app.js") { body = script; contentType = "text/javascript"; cacheControl = "public, max-age=60"; }
      else if (url.pathname === "/module.js") { body = 'export const value = "Module executed";'; contentType = "text/javascript"; cacheControl = "public, max-age=60"; }
      else if (url.pathname === "/style.css") { body = "h1{color:rgb(40,60,80)}"; contentType = "text/css"; cacheControl = "public, max-age=60"; }
      else if (["/cached.svg", "/icon.svg"].includes(url.pathname)) { body = `<svg xmlns="http://www.w3.org/2000/svg"><text>${counts[url.pathname]}</text></svg>`; contentType = "image/svg+xml"; cacheControl = "public, max-age=60"; }
      else if (url.pathname === "/api") { body = `API loaded${headers.has("cookie") ? ": cookie received" : ""}`; contentType = "text/plain"; }
      else if (url.pathname === "/cookie") { body = "Cookie saved"; contentType = "text/plain"; extra = "Set-Cookie: fixture=saved; Path=/; HttpOnly; SameSite=Lax\r\n"; }
      else if (url.pathname === "/post") body = `<h1>Posted Scramjet fixture</h1><p>${stream.buffer.subarray(end + 4, end + 4 + length).toString()}</p>`;
      else if (url.pathname === "/file.txt") { body = "Scramjet download through Wisp\n"; contentType = "text/plain"; extra = 'Content-Disposition: attachment; filename="file.txt"\r\n'; }
      else body = "<h1>Fixture resource</h1>";
      const buffer = Buffer.from(body);
      connection.send(packet(2, id, Buffer.concat([
        Buffer.from(`HTTP/1.1 ${status}\r\nContent-Type: ${contentType}; charset=utf-8\r\nContent-Length: ${buffer.length}\r\nCache-Control: ${cacheControl}\r\nDate: ${new Date().toUTCString()}\r\nConnection: close\r\n${extra}\r\n`),
        method === "HEAD" ? Buffer.alloc(0) : buffer,
      ])));
      connection.send(packet(4, id, Buffer.from([2])));
      streams.delete(id);
    });
  });
  server.listen(port, "127.0.0.1");
  return server;
}
