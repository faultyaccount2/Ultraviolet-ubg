const html = `<!doctype html><html><head><title>Fixture page</title>
<base href="/assets/"><link rel="icon" href="icon.svg"><link rel="stylesheet" href="style.css">
<style>.inline{background-image:url('image.svg?inline=1')}</style>
<script src="//fixture.example/assets/app.js"></script></head><body>
<h1>Fixture page</h1><p id="script-status">Waiting for script</p><p id="fetch-status">Waiting for fetch</p>
<img id="image" src="image.svg?size=1" srcset="image.svg 1x, https://fixture.example/assets/image.svg?size=2 2x" alt="Fixture">
<iframe id="nested-frame" src="../nested" title="Nested fixture"></iframe>
<a href="../next?hello=world#section">Relative next</a>
<a href="https://fixture.example/redirect">Redirect</a>
<form action="../get" method="get"><label>Query<input name="q" value="hello world"></label><button>GET form</button></form>
<form action="../post" method="post"><input name="name" value="Bromine"><button>POST form</button></form>
<div class="inline">Styled</div><div id="section">Fragment target</div></body></html>`;
let assetGeneration = 0;

export function fixtureResponse(url, options) {
  const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" };
  let body;
  let status = 200;
  if (["duckduckgo.com", "www.google.com"].includes(url.hostname) && url.searchParams.has("q")) body = `<title>Search fixture</title><h1>Results for ${url.searchParams.get("q")}</h1>`;
  else if (url.pathname === "/") body = html;
  else if (url.pathname === "/redirect") { status = 302; headers.location = "/next?redirected=1"; body = ""; }
  else if (url.pathname === "/storage-redirect") { status = 302; headers.location = "https://www.google.com/storage-page"; body = ""; }
  else if (url.pathname === "/private-redirect") { status = 302; headers.location = "http://127.0.0.1/"; body = ""; }
  else if (url.pathname === "/loop") { status = 302; headers.location = "/loop"; body = ""; }
  else if (url.pathname === "/next") body = `<title>Next page</title><h1>Next page</h1><p>${url.search}</p>`;
  else if (url.pathname === "/module-page") body = `<title>Module fixture</title><base href="/modules/"><link rel="modulepreload" href="/modules/entry.js">
    <h1>Module fixture</h1><p id="module-static">Waiting</p><p id="module-dynamic">Waiting</p><p id="module-inline-url"></p>
    <p id="module-added">Waiting</p><img id="module-image" alt="Module asset">
    <script type="module">import { message, asset } from "./entry.js";
      document.querySelector("#module-static").textContent = message;
      document.querySelector("#module-image").src = asset;
      document.querySelector("#module-inline-url").textContent = import.meta.url;
      const file = "lazy"; const lazy = await import("./" + file + ".js");
      document.querySelector("#module-dynamic").textContent = lazy.message;
      const script = document.createElement("script"); script.src = "./added.js"; script.type = "module"; document.body.append(script);
    </script>`;
  else if (url.pathname === "/route-page") body = `<title>Route fixture</title><h1>Route fixture</h1>
    <p id="inline-route"></p><p id="script-route"></p><p id="hash-route"></p>
    <button id="push-route">Push route</button><button id="hash-button">Change hash</button>
    <button id="replace-route">Replace route</button><button id="assign-route">Assign route</button>
    <button onclick="location.href='/next?inline=1'">Inline navigation</button>
    <script>document.querySelector("#inline-route").textContent = location.href;</script>
    <script src="/route.js"></script>`;
  else if (url.pathname === "/cookie-check") {
    headers["set-cookie"] = "fixture_http=secret; Path=/; HttpOnly; Secure";
    body = `<title>Cookie check</title><h1>Cookie check</h1><p id="stored-cookie">${options.headers.cookie || "(none)"}</p>`;
  }
  else if (url.pathname === "/cookie-echo") { headers["content-type"] = "text/plain"; body = options.headers.cookie || "(none)"; }
  else if (url.pathname === "/authenticated-api") {
    headers["content-type"] = "application/json";
    if (options.headers.authorization !== "Bearer fixture-user") status = 401;
    body = JSON.stringify({ authenticated: status === 200, method: options.method, body: options.body?.toString() || "" });
  }
  else if (url.pathname === "/assets/cached.svg") {
    headers["content-type"] = "image/svg+xml";
    body = `<svg xmlns="http://www.w3.org/2000/svg"><text>${++assetGeneration}</text></svg>`;
  }
  else if (url.pathname === "/failed-api") { status = 503; headers["content-type"] = "text/plain"; body = "private response body"; }
  else if (url.pathname === "/verification-page") {
    status = 403;
    headers["cf-mitigated"] = "challenge";
    body = "<title>Verification required</title><h1>Verification required</h1>";
  }
  else if (url.pathname === "/cloudflare-challenge") {
    status = 403;
    headers.server = "cloudflare";
    body = "<title>Just a moment...</title><script>window._cf_chl_opt = {};</script>";
  }
  else if (url.pathname === "/unavailable-page") { status = 503; body = "<title>Unavailable</title><h1>Unavailable</h1>"; }
  else if (url.pathname === "/storage-page") body = `<title>Storage fixture</title><h1>Storage fixture</h1>
    <p id="stored-login"></p><p id="stored-session"></p><p id="stored-auth"></p>
    <script>
      document.querySelector("#stored-login").textContent = localStorage.getItem("token") || "signed out";
      document.querySelector("#stored-session").textContent = sessionStorage.getItem("session") || "new session";
      const token = localStorage.getItem("token");
      if (token) fetch("/authenticated-api", { headers: { Authorization: token } })
        .then(response => response.json()).then(data => { document.querySelector("#stored-auth").textContent = String(data.authenticated); });
    </script>`;
  else if (url.pathname === "/nested") body = "<title>Nested fixture</title><h1>Nested fixture</h1>";
  else if (url.pathname === "/get") body = `<title>GET result</title><h1>GET result</h1><p>${url.searchParams.get("q")}</p>`;
  else if (url.pathname === "/file.txt") {
    headers["content-type"] = "text/plain"; headers["accept-ranges"] = "bytes";
    body = "Bromine download fixture\n";
    if (options.headers.range) {
      const offset = Number(options.headers.range.match(/\d+/)[0]);
      headers["content-range"] = `bytes ${offset}-${body.length - 1}/${body.length}`;
      body = body.slice(offset); status = 206;
    }
    headers["content-length"] = String(Buffer.byteLength(body));
  }
  else if (url.pathname === "/large.bin") {
    headers["content-type"] = "application/octet-stream"; headers["accept-ranges"] = "bytes";
    const total = 6 * 1024 * 1024;
    let start = 0;
    if (options.headers.range) {
      start = Number(options.headers.range.match(/\d+/)[0]);
      headers["content-range"] = `bytes ${start}-${total - 1}/${total}`;
      status = 206;
    }
    body = Buffer.alloc(total - start, 7);
    headers["content-length"] = String(body.length);
  }
  else if (url.pathname === "/post") body = `<title>POST result</title><h1>POST result</h1><p>${options.body?.toString()}</p>`;
  else if (url.pathname === "/assets/style.css") { headers["content-type"] = "text/css"; body = '@import "import.css"; h1{color:rgb(18,52,86)} .inline{background:url("image.svg?css=1")}'; }
  else if (url.pathname === "/assets/import.css") { headers["content-type"] = "text/css"; body = "body{font-family:Arial,sans-serif}"; }
  else if (url.pathname === "/assets/app.js") {
    headers["content-type"] = "application/javascript";
    body = 'document.addEventListener("DOMContentLoaded",()=>{document.cookie="fixture=1";localStorage.setItem("fixture","isolated");document.getElementById("script-status").dataset.cache=("caches" in window&&window.caches)?"available":"unavailable";document.getElementById("script-status").textContent="Script loaded";fetch(new Request("/data?value=hello",{mode:"same-origin",credentials:"include",headers:{"X-SG-E":"fixture"}})).then(r=>r.text()).then(text=>document.getElementById("fetch-status").textContent=text);const xhr=new XMLHttpRequest();xhr.open("GET","/data?value=xhr");xhr.withCredentials=true;xhr.setRequestHeader("X-Fixture","1");xhr.onload=()=>{document.getElementById("script-status").dataset.xhr=xhr.responseText};xhr.send();const image=document.createElement("img");image.id="dynamic-image";image.src="/assets/image.svg?dynamic=1";document.body.append(image);const block=document.createElement("div");block.id="dynamic-html";block.innerHTML=\'<img src="/assets/image.svg?html=1" alt="Dynamic HTML">\';document.body.append(block);});';
  } else if (url.pathname === "/assets/worker.js") {
    headers["content-type"] = "application/javascript";
    body = 'self.addEventListener("message",async()=>{const cache=await caches.open("worker-fixture");const response=await fetch(new Request("/post",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:"name=worker"}));const text=await response.text();await cache.put("/data?value=worker",new Response(text));const authenticated=await(await fetch("/authenticated-api",{method:"PATCH",headers:{Authorization:"Bearer fixture-user","Content-Type":"application/json"},body:JSON.stringify({content:"worker"})})).json();self.postMessage({text:await(await cache.match("/data?value=worker")).text(),isCache:cache instanceof Cache,url:location.href,workerUrl:self.location.href,authenticated});});';
  } else if (url.pathname === "/route.js") {
    headers["content-type"] = "application/javascript";
    body = `const alias = document.defaultView;
      function showRoute() {
        const { location: picked } = alias;
        document.querySelector("#script-route").textContent = [location.href, alias.location.href, document.location.href, picked.href].join("\\n");
      }
      showRoute();
      document.querySelector("#push-route").onclick = () => { history.pushState({}, "", "/route-page?state=1"); showRoute(); };
      document.querySelector("#hash-button").onclick = () => { location.hash = "changed"; showRoute(); };
      document.querySelector("#assign-route").onclick = () => { alias.location = "/next?assigned=1"; };
      document.querySelector("#replace-route").onclick = () => { alias.location.replace("/next?replaced=1"); };
      addEventListener("hashchange", (event) => { document.querySelector("#hash-route").textContent = event.newURL; });`;
  } else if (url.pathname === "/modules/entry.js") {
    headers["content-type"] = "text/javascript";
    body = 'export { message } from "./nested/value.js"; export const asset = new URL("../assets/image.svg?module=1", import.meta.url).href;';
  } else if (url.pathname === "/modules/nested/value.js") {
    headers["content-type"] = "text/javascript"; body = 'export const message = "Module graph loaded";';
  } else if (url.pathname === "/modules/lazy.js") {
    headers["content-type"] = "text/javascript"; body = 'export const message = "Dynamic module loaded";';
  } else if (url.pathname === "/modules/added.js") {
    headers["content-type"] = "text/javascript"; body = 'export const added = true; document.querySelector("#module-added").textContent = "Added module loaded";';
  } else if (url.pathname === "/data") { headers["content-type"] = "text/plain"; body = "Fetch loaded: " + url.searchParams.get("value"); }
  else if (["/assets/image.svg", "/assets/icon.svg"].includes(url.pathname)) {
    headers["content-type"] = "image/svg+xml";
    body = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>';
  } else { status = 404; body = "<h1>Missing fixture</h1>"; }
  return { status, headers, body: Buffer.from(body) };
}
