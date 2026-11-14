# Bromine

A working, Farmers-inspired browser UI deployed as a static frontend and a
Vercel Node HTTP(S) function. The old rendered snapshot, obfuscated contact
page, incomplete SvelteKit assets and Scramjet/Wisp runtime are no longer
deployed.

## Run and test

```sh
pnpm install
pnpm run build
pnpm test
pnpm exec playwright install chromium
pnpm run test:browser
pnpm run dev
```

The development server binds to `127.0.0.1:3000`. Browser tests run desktop and
mobile Chromium against a separate loopback server with deterministic upstream
fixtures. Those fixtures are **not** available in production.

The UI provides independent draggable/pinnable tabs, duplicate/reopen/session
controls, navigation stacks, reload/stop/home, search, bookmarks with
import/export, history filtering/clearing, downloads, a request inspector,
glass appearance settings and fullscreen. Web pages stay inside the app.
Proxy is the default; optional DIRECT mode is an iframe, not a native tab.
Direct embedding can be refused by the destination. Cross-origin failures
cannot be reliably classified, so no insecure timer-based fallback is used.
Use Site Routing to select Proxy explicitly.
For manual verification, open **Site Routing → Use DIRECT for manual
verification**. This saves a DIRECT override for the entire hostname; it does
not return to Proxy automatically. The browser retains native site sessions
where its cookie/storage policies permit. Bromine cannot copy those sessions
into Proxy, and its proxy cache controls do not clear native site cookies.
CAPTCHA and Cloudflare checks can still refuse iframe embedding or require
top-level access. DIRECT respects the destination's `X-Frame-Options` and CSP
`frame-ancestors`; the app cannot override those headers on a native site.
Neither challenge loading nor a fixture test proves successful
live verification. No remote browser or automatic challenge solver is provided.
Shortcuts use Alt+T/W/L/R and Alt+Left/Right to avoid taking over browser
Ctrl/Cmd shortcuts. Icons and favicons are local SVGs; typography deliberately
uses system fonts instead of the missing, obfuscated Switzer font.

## HTTP(S) compatibility boundary

This is a **web proxy, not a VPN**. Public HTTP/HTTPS destinations on their
standard ports are accepted. It handles GET, HEAD, basic POST bodies,
validated redirects, HTML/CSS URLs, images, fonts, classic scripts, relative
and absolute resources, query strings, fragments and ordinary forms.
Programmatic `form.submit()` calls use the same original-target routing as
user submissions. CSS parsing recovers browser-tolerated syntax errors while
still rewriting resource URLs.
JavaScript source is not blindly rewritten; a frame bridge routes `fetch`
and XHR requests and reports navigation to the browser UI.
Empty POSTs need no content type. JSON bodies labeled `application/json+protobuf`
are forwarded unchanged within the same 1 MB request limit. Proxied images use
anonymous CORS so canvas drawing does not expose app credentials or fail solely
because the document has an opaque origin.
Same-site History API state changes keep the proxy URL and app address bar in
sync without reloading the document. Blank sandboxed iframe history probes
receive only the current document's History API; other frame access restrictions
remain in force. Classic dedicated workers use a local Blob bootstrap with
proxied imports/fetch/XHR. Module workers and WebSockets inside workers are
explicitly unsupported.

Authenticated sessions, multipart uploads, relative JavaScript module
imports, complex client routing, origin isolation requirements, DRM, anti-bot
systems and complex streaming applications are not guaranteed. Optional
WebSocket relay support is separately authenticated and limited to explicitly
approved exact hostnames. WebRTC networking, TCP/UDP, QUIC and system-wide
tunnels are not provided. Naming a site in an exception list does not approve
its WebSocket host or make its protocols compatible.

Binary responses, downloads and media stream with backpressure: there is no
arbitrary 4 MB file limit. Streamed Vercel responses are exempt from its
buffered-response limit. The function has a 300-second execution budget
(the upstream signal expires at 290 seconds), a 1 MB POST limit and at most
five redirects. HTML/CSS has a separate 64 MB processing budget because it
must be parsed and rewritten. Large downloads still depend on upstream
restrictions, execution time and the client's browser memory.
Incoming application cookies and authorization
headers are never forwarded. DNS answers are checked for non-public addresses
at every redirect, then pinned to the actual socket while TLS verifies the
original hostname. Private, loopback, link-local and reserved addresses are
blocked, including alternate IPv4 representations and mapped IPv6.

Remote proxy documents have an opaque sandboxed origin. Their scripts get
isolated in-memory cookie, localStorage and sessionStorage implementations;
these neither reveal app storage nor propagate authenticated server sessions.
They cannot read the app's localStorage, access its document or navigate the
top window. IndexedDB and origin-sensitive APIs remain conditional.
Document and classic-worker CacheStorage is an isolated, in-memory implementation
of open/match/put/delete/keys and single-resource add, not persistent native
storage or offline/service-worker support. Each context has a 200-entry/64 MB
budget; quota errors are explicit. It never reads or modifies the app's separate
public-resource cache, and cached site data disappears with the context.
Nested proxy frames retain the opaque
sandbox but omit the ancestor restriction that would reject an opaque parent.
Dynamic DOM URLs, inserted HTML, styles, fetch, XHR and Request objects are
rewritten at runtime; arbitrary JavaScript source is not regex-rewritten.
The API is not an authentication bypass and cannot promise every site works.

## Cache, privacy and presentation

The optional service-worker cache is browser-local, split into proxy HTTP,
image, font and media categories. It is LRU-bounded by the selected size and
200 entries, expires after 15 minutes, and excludes authenticated/private
responses and target query strings. Individual resources over 4 MB are
streamed normally but not duplicated into this cache. Clear all/categories
or the current site's cache without clearing unrelated authenticated storage.

Request logging is disabled by default, transient and limited to 200
metadata records per tab. Sensitive URL parameters are redacted from
persisted history/bookmarks/session/download metadata. Neither request
bodies, cookie values, credentials nor page contents are logged.

User-triggered about:blank wrapping and custom tab title/favicon affect
presentation only. They do not conceal network traffic, server logs or
browser activity. Website links open in app tabs, not external windows;
the explicit about:blank action is the only intentional new native window.
Browser-owned policy pages describe unconfigured operator contact details
honestly and do not claim an established private copyright complaint channel.

## uBlock Origin network filtering

The backend uses the **official `@gorhill/ubo-core` static network filtering
engine**, not a rebranded homemade blocker. EasyList/EasyPrivacy snapshots
and the supplied custom domain exceptions are compiled at build time.
Filtering is enabled by default and can be toggled in Settings; reload open
pages after changing it.

This is **not the full uBlock Origin extension**: cosmetic filtering,
scriptlets, dynamic filtering and extension APIs are not ported. It applies
to requests that go through the HTTP proxy, not direct connections made by
unsupported site code. Your `@@` exceptions take priority under uBO's filter
semantics and deliberately allow many media/social/development services,
including explicitly exempted advertising/tracking domains.

Filter snapshots are checked in for reproducible builds. To update them:

```sh
curl -fL https://easylist.to/easylist/easylist.txt -o filters/easylist.txt
curl -fL https://easylist.to/easylist/easyprivacy.txt -o filters/easyprivacy.txt
pnpm run build
pnpm test
```

uBlock Origin core is GPL-3.0-or-later, by Raymond Hill and contributors.
The proxy backend and filter compilation code use that license; see
[GPL-3.0](./LICENSES/GPL-3.0.txt). EasyList/EasyPrivacy retain their authors,
headers and [licensing](https://easylist.to/pages/licence.html); they are used
under their GPL option. The original Ultraviolet code retains its
[MIT license](./LICENSE). Its legacy sources are retained for reference and
are not part of the deployed browser; `pnpm run build:uv` is the old library
build, not the application build.

## Supabase WebSocket relay setup

The HTTP(S) proxy remains on Vercel. The optional `ws-relay` Edge Function
provides a separate WSS relay for sites requiring WebSockets. It verifies
Supabase Auth sessions, checks the browser app's exact origin, restricts
destinations to `WS_ALLOWED_HOSTS`, rejects non-public DNS answers, allows at
most four concurrent sockets per user per function worker, limits each frame
to 1 MiB and closes connections after 120 seconds. Supabase worker limits,
network policy, and upstream site restrictions still apply. This is not a
general-purpose open relay.

1. In Supabase **Authentication settings**, enable anonymous sign-ins. Keep
   the default sign-in rate limit. The current app does not collect an
   anonymous-sign-in CAPTCHA challenge, so do not require one for this provider.
2. In **Project Settings → API Keys**, copy the public **Publishable key**
   (`sb_publishable_...`). It is intended for browser use; never use a
   `service_role` or secret key here.
3. Configure the Vercel project's Production and Preview environment variables:
   `BROMINE_SUPABASE_URL=https://<project-ref>.supabase.co` and
   `BROMINE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>`. Set the same values
   locally before `pnpm run dev` if you want to test the relay locally. The
   build emits these two public values in `public/runtime-config.js`; never put
   a service-role key in the frontend.
4. Set Supabase Function secrets/configuration using exact hostnames and the
   actual app origins. For example:

   ```sh
   pnpm exec supabase secrets set --remote=kbnufghpqcvetpjbcszu \
     BROMINE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME \
     WS_ALLOWED_HOSTS=gateway.discord.gg,example-approved-host.com \
     WS_ALLOWED_ORIGINS=https://ultraviolet-ubg.vercel.app,http://127.0.0.1:3000,http://127.0.0.1:4173
   ```

   Replace the example hosts with the exact WebSocket hostnames you approve.
   Wildcards, insecure `ws://`, non-standard ports, private IPs and unlisted
   hosts are rejected. The WebSocket target is sent after the relay handshake
   rather than in its URL to reduce leakage into request logs.
5. After setting the values, deploy the function. Gateway JWT verification is
   disabled because browser WebSockets cannot set an Authorization header; the
   function validates the Supabase access token from the WebSocket subprotocol
   and negotiates that offered subprotocol, as required by browser clients:

   ```sh
   pnpm exec supabase functions deploy --no-verify-jwt --remote=kbnufghpqcvetpjbcszu ws-relay
   ```

6. Redeploy Vercel so its build includes the runtime project URL and publishable
   key. Test a WSS destination listed in the allowlist. The relay is fail-closed
   if any required setting is missing.

Do not run a placeholder function name or deploy before setting real values.
Never paste passwords, access tokens, or service-role keys into chat or source
control. Supabase Free has a short function wall-clock budget, so this relay
closes sockets after 120 seconds and some real-time apps may reconnect or fail.

## Vercel deployment

Vercel runs `pnpm run build`, serves `public/`, and deploys `api/proxy.js`.
The function bundle explicitly includes the compiled filters and uBlock
Origin's public-suffix data, which its runtime loads from disk.
Dependency assets must be included from pnpm's real package directory, not
from beneath its `node_modules` symlink, or Vercel rejects the function bundle.
The optional Supabase relay is a separate deployment. No Wisp server, BareMux,
Epoxy or VPS is required.
Deploy through the connected GitHub integration **only after local tests
pass**, then verify the actual production URL:

```sh
TEST_BASE_URL=https://ultraviolet-ubg.vercel.app pnpm run test:browser
```

`/version.json` exposes the built commit hash so an old cached deployment
cannot be mistaken for the new one. Production search/media compatibility
must be checked individually; local fixtures do not prove those sites work.
