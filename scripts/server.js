import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const root = resolve("public");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".png": "image/png" };

export function startServer(proxy, port = 3000) {
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      if (pathname === "/api/proxy") return await proxy(req, res);
      if (!["GET", "HEAD"].includes(req.method)) { res.statusCode = 405; return res.end("Method not allowed"); }
      const legal = ["/terms", "/privacy", "/legal", "/copyright", "/dmca", "/acceptable-use", "/abuse", "/contact", "/transparency"].includes(pathname);
      const file = resolve(root, "." + decodeURIComponent(pathname === "/" ? "/index.html" : legal ? "/legal.html" : pathname));
      if (!file.startsWith(root + sep)) { res.statusCode = 403; return res.end("Forbidden"); }
      let body;
      try { body = await readFile(file); }
      catch (error) {
        if (error.code !== "ENOENT" && error.code !== "EISDIR") throw error;
        res.statusCode = 404;
        return res.end("Not found");
      }
      res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (error) {
      console.error("Local server failed:", error);
      res.statusCode = 500;
      res.end("Local server error");
    }
  });
  server.listen(port, "127.0.0.1", () => console.log(`Bromine ready at http://127.0.0.1:${port}`));
  return server;
}
