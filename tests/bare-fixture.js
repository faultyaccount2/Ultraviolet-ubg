import { createServer } from "node:http";

export function startBareFixture(port = 4176) {
  const server = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "http://127.0.0.1:4174");
    response.setHeader("access-control-allow-headers", "*");
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
    if (request.url === "/bare/") { response.end(JSON.stringify({ versions: ["v3"] })); return; }
    if (!request.url.startsWith("/bare/v3/") || !request.headers["x-bare-url"]) { response.writeHead(404).end(); return; }
    const url = new URL(request.headers["x-bare-url"]);
    const headers = { "content-type": "text/html", "cache-control": "no-store" };
    let body;
    if (url.pathname === "/") {
      body = '<title>Bare fixture</title><h1>Bare fixture</h1><p id="module">Waiting</p><p id="api">Waiting</p><script type="module" src="/module.js"></script><a href="/next">Next Bare page</a>';
    } else if (url.pathname === "/module.js") {
      headers["content-type"] = "text/javascript";
      body = 'document.querySelector("#module").textContent = "Bare module executed"; fetch("/cookie").then(() => fetch("/api")).then(r => r.text()).then(t => document.querySelector("#api").textContent = t);';
    } else if (url.pathname === "/cookie") {
      headers["content-type"] = "text/plain";
      headers["set-cookie"] = ["bareA=first; Path=/; HttpOnly; Secure", "bareB=second; Path=/; Expires=Thu, 01 Jan 2037 00:00:00 GMT; Secure"];
      body = "Cookies saved";
    } else if (url.pathname === "/api") {
      headers["content-type"] = "text/plain";
      const raw = JSON.parse(request.headers["x-bare-headers"]);
      const cookie = Object.entries(raw).find(([name]) => name.toLowerCase() === "cookie")?.[1] || "";
      body = cookie.includes("bareA=first") && cookie.includes("bareB=second") ? "Bare API loaded: cookies received" : "Bare API missing cookies";
    }
    else if (url.pathname === "/next") body = "<h1>Next Bare page</h1>";
    else { response.writeHead(404).end(); return; }
    response.setHeader("x-bare-status", "200");
    response.setHeader("x-bare-status-text", "OK");
    response.setHeader("x-bare-headers", JSON.stringify(headers));
    response.setHeader("access-control-expose-headers", "x-bare-status,x-bare-status-text,x-bare-headers");
    response.end(body);
  });
  server.listen(port, "127.0.0.1");
  return server;
}
