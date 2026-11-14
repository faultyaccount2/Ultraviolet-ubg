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

export function fixtureResponse(url, options) {
  const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" };
  let body;
  let status = 200;
  if (["duckduckgo.com", "www.bing.com"].includes(url.hostname) && url.pathname === "/search") body = `<title>Search fixture</title><h1>Results for ${url.searchParams.get("q")}</h1>`;
  else if (url.pathname === "/") body = html;
  else if (url.pathname === "/redirect") { status = 302; headers.location = "/next?redirected=1"; body = ""; }
  else if (url.pathname === "/private-redirect") { status = 302; headers.location = "http://127.0.0.1/"; body = ""; }
  else if (url.pathname === "/loop") { status = 302; headers.location = "/loop"; body = ""; }
  else if (url.pathname === "/next") body = `<title>Next page</title><h1>Next page</h1><p>${url.search}</p>`;
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
    body = 'self.addEventListener("message",async()=>{const cache=await caches.open("worker-fixture");const response=await fetch(new Request("/post",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:"name=worker"}));const text=await response.text();await cache.put("/data?value=worker",new Response(text));self.postMessage({text:await(await cache.match("/data?value=worker")).text(),isCache:cache instanceof Cache});});';
  } else if (url.pathname === "/data") { headers["content-type"] = "text/plain"; body = "Fetch loaded: " + url.searchParams.get("value"); }
  else if (["/assets/image.svg", "/assets/icon.svg"].includes(url.pathname)) {
    headers["content-type"] = "image/svg+xml";
    body = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>';
  } else { status = 404; body = "<h1>Missing fixture</h1>"; }
  return { status, headers, body: Buffer.from(body) };
}
