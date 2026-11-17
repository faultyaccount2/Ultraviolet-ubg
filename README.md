# Bromine · Glass Workspace

![Glass workspace](https://img.shields.io/badge/Bromine-Glass%20Workspace-303746?style=flat-square)
![Primary engine](https://img.shields.io/badge/primary%20engine-Scramjet-796c61?style=flat-square)
![Transports](https://img.shields.io/badge/transports-Bare%20%7C%20Wisp-536d78?style=flat-square)
![Licenses](https://img.shields.io/badge/licenses-multiple-68727e?style=flat-square)

Bromine is an experimental, self-hostable browsing desktop with two independent
proxy windows, a Windows-style taskbar and a movable Settings app. Scramjet is the
standard proxy engine. Website traffic uses either the public Bare HTTP endpoint
or a Wisp server that each user configures in their own browser profile. The
desktop and both proxy windows run from one site and one origin. Proxy windows
open inside the desktop instead of navigating to a separate frontend.

This is a browser proxy, not a VPN or a general purpose anonymity service.
Websites can block proxy traffic, require first-party verification, or fail for
other compatibility reasons. No CAPTCHA, authentication or access control is
automatically bypassed.

**Project:** [Source and issues](https://github.com/faultyaccount2/Ultraviolet-ubg) ·
[Terms](/terms) · [Privacy](/privacy) · [Copyright](/copyright) ·
[DMCA / copyright reports](/dmca) · [Abuse reports](/abuse)

> Before operating this project for the public, complete the owner and contact
> details in the legal policies and review the DMCA and privacy checklist below.
> This repository does not supply a legal entity, jurisdiction, support address,
> or registered DMCA agent.

## Contents

- [Features](#features)
- [Run locally](#run-and-test)
- [Deploy the apps](#scramjet-transport-setup)
- [Copyright, DMCA and legal readiness](#copyright-dmca-and-legal-readiness)
- [Security and privacy notes](#cache-privacy-and-presentation)
- [Licenses](#third-party-licenses)

## Features

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
mobile Chromium against deterministic Classic upstream fixtures and the real
Scramjet/libcurl runtime connected to a loopback-only Wisp protocol fixture.
The isolated test frontend uses port 4174; the fixture Wisp endpoint uses 4175.
These fixtures are **not** production servers and must not be deployed.

The desktop shows one app window at a time. Proxy and Proxy 2 each keep their
own tabs, history and site storage while sharing appearance and connection
preferences. Switch between them or Settings with the taskbar; the previous
window stays loaded in the background so its state is preserved. The active
window can be dragged, resized, minimized, maximized or closed. Clicking its
taskbar icon minimizes or restores it. A translucent Start menu and taskbar
provide app search, window switching and a local clock. The desktop
glass sits over a locally rendered rain ambience that can be changed or turned
off in Settings; it does not load remote wallpaper or tracking assets. Customize
the desktop with ten palettes, a custom accent, per-surface colors, glass opacity,
blur, saturation, corner radius, density, text size, three wallpaper treatments,
and rain motion. Settings also groups proxy, window, performance and storage
options with plain-English explanations.
Open tabs restore on startup by default. Disable **Restore tabs on startup** to
remove the saved tab session and opt out.
DuckDuckGo is the default search engine; Google is also available in Settings.
Obsidian and Ember provide detailed miniature system previews. Mocha, Charcoal,
Ocean, Forest, Rose, High Contrast, Light and System remain available as compact
palette choices. Selecting a theme applies its accent; custom
background/frame colors remain until Reset colors is used.
Saved selections of the removed search provider migrate to DuckDuckGo without
resetting other preferences.
Settings also provides saved color pickers and #RRGGBB inputs for the background,
surfaces, hover, accent, text, page frame, toolbar, tab bar, status bar and borders.
Reset colors restores the selected theme. Frame color does not recolor upstream
website content.
Scramjet is the default proxy engine for new browser profiles; the legacy
Classic HTTP(S) engine is hidden under **Settings → Connection & routing →
Legacy engine options** for compatibility. Optional DIRECT mode is an iframe,
not a native tab.
Direct embedding can be refused by the destination. Cross-origin failures
cannot be reliably classified, so no insecure timer-based fallback is used.
Use Site Routing to select Proxy explicitly.
For manual verification, use **Open directly** in quick actions or Site Routing.
It opens an ordinary first-party browser tab without changing the saved route.
Bromine cannot copy that native session into either proxy engine, and its
proxy cache controls do not clear native site cookies. Each engine has separate
website cookies and storage.
CAPTCHA and Cloudflare checks can still refuse iframe embedding or require
top-level access. DIRECT respects the destination's `X-Frame-Options` and CSP
`frame-ancestors`; the app cannot override those headers on a native site.
Neither challenge loading nor a fixture test proves successful
live verification. No remote browser or automatic challenge solver is provided.
Use **Open directly** in the quick actions (or Site Routing) to visit the
current address as an ordinary first-party page. This is a separate native
browser session, not a way to transfer login cookies or solved challenges into
Proxy. It can help with YouTube/Google sign-in or manual CAPTCHA verification,
but does not guarantee that the provider will accept the session.
If the provider still rejects or repeatedly challenges that direct visit, only
the site's support can resolve the provider-side restriction.
Searches use the selected engine without silently substituting another provider.
Search providers may require human verification or refuse proxied traffic.
Shortcuts use Alt+T/W/L/R and Alt+Left/Right to avoid taking over browser
Ctrl/Cmd shortcuts. Icons and favicons are local SVGs; typography deliberately
uses system fonts instead of the missing, obfuscated Switzer font.

## Scramjet transport setup

There are three separate deployment roles:

1. **Bromine UI:** this repository's root Vercel project.
2. **Scramjet frontend:** the static `scramjet-host/` workspace, deployed on
   a different HTTPS origin. It contains Scramjet, Bare/libcurl transports, its service worker,
   network filtering, and a browser-local public asset cache. It is not a Wisp
   server. Separate subdomains of your own domain are preferable when available,
   because browser third-party storage restrictions can affect unrelated sites.
3. **Transport backend:** the Bare HTTP-fetch Worker in
   [`tomphttp/`](./tomphttp/README.md), or the Wisp Worker in `wisp/`, currently
   available at `wss://bromine-wisp.iknowikea.workers.dev/wisp/`.
   The Node alternative in `wisp/node/` can run on a TCP-capable host.

Deploy `scramjet-host/` as a second Vercel project from this repository:

- Import `faultyaccount2/Ultraviolet-ubg` again, using branch `main`.
- Project name: `scramjet-ubg`; Framework Preset: **Other**.
- Root Directory: `scramjet-host`.
- Enable **Include source files outside of the Root Directory**. Its build
  reuses this repository's shared URL validation, filter lists, favicon and
  license. Do not copy only that folder into an unrelated empty repository.
- Install Command: `pnpm install --frozen-lockfile`;
  Build Command: `pnpm run build`; Output Directory: `public`.
- Make the deployment publicly accessible: disable Vercel Authentication
  for its production deployment, if enabled.
- Set `BROMINE_APP_ORIGINS` to the exact Bromine origin, for example
  `https://ultraviolet-ubg.vercel.app`. Multiple allowed origins are
  comma-separated; include only origins you control, without trailing slashes.
  Add explicit preview origins when needed and rebuild the isolated frontend.
  An empty list deliberately accepts no app connections.

For the Scramjet project, set these **public** build variables for Production:

```text
BROMINE_APP_ORIGINS=https://ultraviolet-ubg.vercel.app
BROMINE_BARE_URL=https://bromine-bare.e42xec.workers.dev/bare/
```

Deploy it first. On the existing Bromine UI project, keep Root Directory at
the repository root, Framework Preset **Other**, Build Command `pnpm run build`
and Output Directory `public`. Set these **public** build variables for
Production and redeploy:

```text
BROMINE_SCRAMJET_ORIGIN=https://scramjet-ubg.vercel.app
BROMINE_BARE_URL=https://bromine-bare.e42xec.workers.dev/bare/
```

Use the actual production domain Vercel assigns to the new Scramjet project
if it differs from `scramjet-ubg.vercel.app`. If Bromine uses another domain,
put that exact origin in `BROMINE_APP_ORIGINS` and redeploy Scramjet too.
Opening `https://scramjet-ubg.vercel.app` directly shows a standalone proxy
with an address bar, reload, transport selector, tabs and website downloads, using its own
build endpoints. The deployed Bare URL is the build default; `BROMINE_BARE_URL`
can override it.
When embedded, Bromine still sends its endpoint over the
validated app connection and the standalone toolbar stays hidden.
The Worker origin allowlist, if configured,
must include the **Scramjet frontend origin**, where its WebSocket originates.

The Scramjet origin and Bare endpoint are public build configuration, not
credentials. The build deliberately does not publish a Wisp endpoint: each
person must enter a Wisp URL they control or have permission to use in their
own Settings. The URL is stored in that browser's local settings. Existing
saved Wisp URLs remain in place across updates; a fresh profile receives no
shared Oracle VM endpoint. Never put tokens or passwords in endpoint URLs.
HTTPS/WSS is required, except HTTP/WS loopback URLs for local development.
The separate Scramjet origin is validated before enabling normal-origin
iframes. Never host Scramjet's executable website frames on Bromine's UI origin
or add `allow-same-origin` to Classic's opaque frames.

Scramjet uses the selected Bare or Wisp transport for HTTP(S), fetch/XHR, downloads and WebSocket
traffic; it does not depend on the Classic gateway or Supabase relay. An invalid,
missing or unreachable connection produces an explicit error, never a silent
Classic fallback. The Classic engine is in **Settings → Connection & routing →
Legacy engine options**; reload open pages after changing engines or endpoints. Changing
engines does not migrate website login state. Bare is the default transport
for every Scramjet page. Settings can explicitly select Wisp instead;
unreachable Bare is reported, not silently replaced by Wisp.
The existing Wisp implementation uses libcurl, not epoxy.
Standalone tabs keep their pages loaded when switched, show titles/favicons,
and handle website new-tab links inside the frontend. New/switch/close controls
are keyboard accessible; Alt+T/W/L from its toolbar creates/closes/focuses a tab.

The Wisp operator must independently restrict allowed app origins, public DNS
destinations, ports and resource usage. Frontend validation cannot secure a
publicly reachable backend. Wisp availability, hosting limits, IP reputation,
site restrictions, third-party storage policies, CAPTCHA, OAuth and DRM can
still prevent websites from working. Neither engine bypasses verification.
Browser fixtures do not establish Google, chess.com, YouTube or demongacha
production compatibility.
Cloudflare Wisp Workers cannot open TCP connections to Cloudflare IP ranges, so
sites behind Cloudflare will not load through the Wisp Worker. The Bare Worker
uses HTTP fetch instead and can reach those hosts, but verification can still
refuse proxy traffic. Use a non-Cloudflare
destination such as `http://neverssl.com/` for a live smoke test; occasional
timeouts or upstream refusals still need to be reported, not treated as success.
NeverSSL intentionally redirects its homepage to a random `neverssl.com`
subdomain. `http://neverssl.com/online/` serves its content without that
JavaScript redirect; `http://info.cern.ch/` is another non-Cloudflare test site.

The pinned Scramjet core/controller pair is intentional: controller `0.0.14`
requires core `2.0.67-alpha.2`. Do not replace it with npm's unrelated `latest`
tag or an incompatible controller. Scramjet and libcurl transport are
AGPL-3.0-only; the browser filtering adapter uses GPL-3.0-or-later uBlock code.
The isolated build includes the [AGPL license](./LICENSE). Corresponding source
and dependency versions are available in this repository and its lockfile:
[Scramjet](https://github.com/MercuryWorkshop/scramjet),
[controller](https://github.com/MercuryWorkshop/scramjet-controller),
[libcurl transport](https://github.com/MercuryWorkshop/libcurl-transport),
[Bare transport (LGPL-3.0)](https://github.com/MercuryWorkshop/bare-transport), and
[uBlock core](https://github.com/gorhill/ubo-core).

## Legacy Classic HTTP(S) compatibility boundary

The following describes the manual **Classic HTTP proxy**, not Scramjet.

This is a **web proxy, not a VPN**. Public HTTP/HTTPS destinations on their
standard ports are accepted. It handles GET, HEAD, POST, PUT, PATCH and DELETE,
validated redirects, HTML/CSS URLs, images, fonts, classic scripts, relative
and absolute resources, query strings, fragments and ordinary forms.
Programmatic `form.submit()` calls use the same original-target routing as
user submissions. CSS parsing recovers browser-tolerated syntax errors while
still rewriting resource URLs.
Syntax-aware JavaScript processing routes global `location` references and
ordinary `.location` accesses through the upstream page URL, including aliased
windows and common destructuring patterns. Locally bound `location` variables
and unrelated objects retain their normal behavior. Assignments, replacement
navigation, same-page hashes and the History API stay inside the app.
Static module imports/exports, dynamic `import()` and `import.meta.url` use
proxied module graphs; inline modules honor the document's resource base.
Script responses with module syntax are also recognized when a preload or
generated resource URL omits its module marker.
Ordinary strings are not treated as JavaScript or rewritten as URLs.
A frame bridge also routes `fetch` and XHR requests and reports navigation to
the browser UI. This is not complete browser-origin virtualization: generated
code, import maps, computed location property names and optional-chain location
aliases can still require unsupported behavior.
Empty POSTs need no content type. `Request`-object fetch bodies are preserved;
gzip/deflate/Brotli request encodings, XML API payloads and JSON bodies labeled
`application/json+protobuf` are forwarded unchanged within the same 1 MB
request limit. Proxied resources use credentialed CORS to support the
browser-local site cookie jar; application credentials are never forwarded to
upstream sites.
Site-supplied Authorization headers from fetch/XHR (including classic workers)
travel in a separate header, only for API requests to the page's exact origin.
They are never sent on cross-origin redirects or stored in the public cache;
ambient application Authorization headers remain stripped.
Raw request streams are read without invoking the deployment platform's lazy
JSON parser, preserving compressed JSON API requests such as YouTube search.
Upstream compression reduces transfer sizes; rewritten text is decoded first,
while byte-range requests use identity encoding.
Same-site History API state changes keep the proxy URL and app address bar in
sync without reloading the document. Blank sandboxed iframe history probes
receive only the current document's History API; other frame access restrictions
remain in force. Classic dedicated workers use a local Blob bootstrap with
proxied imports/fetch/XHR. Module workers and WebSockets inside workers are
explicitly unsupported.

Authenticated sessions, multipart uploads, complex client routing,
origin isolation requirements, DRM, anti-bot
systems and complex streaming applications are not guaranteed. Optional
WebSocket relay support is separately authenticated and limited to explicitly
approved exact hostnames. WebRTC networking, TCP/UDP, QUIC and system-wide
tunnels are not provided. Naming a site in an exception list does not approve
its WebSocket host or make its protocols compatible.

Binary responses, downloads and media stream with backpressure: there is no
arbitrary 4 MB file limit. Streamed Vercel responses are exempt from its
buffered-response limit. The function has a 300-second execution budget
(the upstream signal expires at 290 seconds), a 1 MB POST limit and at most
five redirects. HTML, CSS and JavaScript have a separate 64 MB processing budget because they
must be parsed and rewritten. Large downloads still depend on upstream
restrictions, execution time and the client's browser memory.
Incoming application cookies and authorization headers are never forwarded.
Proxy site cookies are stored in the browser as HttpOnly application cookies,
scoped by site, and sent only to that same host on document navigations and
credentialed same-host fetch/XHR. HttpOnly values are never exposed to page
scripts. Cookie updates are processed transiently by the proxy and are not
stored on its server. DNS answers are checked for non-public addresses
at every redirect, then pinned to the actual socket while TLS verifies the
original hostname. Private, loopback, link-local and reserved addresses are
blocked, including alternate IPv4 representations and mapped IPv6.
The API endpoint reads bounded request bytes without JSON body-parser
normalization, preserving compressed JSON/protobuf payloads. The proxy preserves
only a small explicit set of public site API headers
(including YouTube/Google client identifiers, Discord client metadata and
Microsoft search client identifiers); application cookies, authorization and
unknown custom headers are not forwarded. The upstream `Origin` is set to the
proxied page's origin for normal cross-origin API semantics.

Remote proxy documents have an opaque sandboxed origin. Their scripts get a
cookie shim backed by the browser-local, per-site jar; it exposes only
script-visible cookies for the current host and path. HttpOnly cookies remain
unavailable to page scripts and are sent only on credentialed, same-host
requests.
Proxy LocalStorage persists in this browser under separate per-origin keys;
SessionStorage lasts for the current in-app tab and resets when the app reloads
or closes. Each has a 1 MB/1024-key per-origin limit with explicit quota errors.
Only that origin's snapshots enter its opaque frame, synchronously before page
scripts through a window-name seed that the bootstrap immediately consumes and
clears. Writes use an origin- and per-frame-capability-bound parent bridge;
snapshots never enter proxy URLs, upstream requests or diagnostic logs. Native
same-frame reloads and form posts carry the same origin-scoped seed, and
cross-origin redirects are re-opened with the destination's own storage.
Named property deletion is supported so logging out removes saved tokens.
Site routing can clear the current origin's Proxy LocalStorage/SessionStorage
without deleting other sites, cookies, or public cached assets.
Sites cannot read the app's storage, access its document or navigate the top
window. Existing open tabs do not receive live cross-tab storage events; reload
to pick up another tab's changes. Nested frames remain memory-only.
IndexedDB and origin-sensitive APIs remain conditional; retaining login state
does not guarantee that a provider will stop requesting CAPTCHA verification.
Document and classic-worker CacheStorage is an isolated, in-memory implementation
of open/match/put/delete/keys and single-resource add, not persistent native
storage or offline/service-worker support. Each context has a 200-entry/64 MB
budget; quota errors are explicit. It never reads or modifies the app's separate
public-resource cache, and cached site data disappears with the context.
Nested proxy frames retain the opaque
sandbox but omit the ancestor restriction that would reject an opaque parent.
Dynamic DOM URLs, inserted HTML, styles, fetch, XHR and Request objects are
rewritten at runtime. Site-visible document and resource URL getters report
upstream URLs while the actual requests remain proxied. Unavailable sandbox
service workers are not advertised to site feature detection; the app's own
service worker remains separate. JavaScript URL handling uses parsed syntax
and lexical scope analysis, not regex replacement of arbitrary source text.
The API is not an authentication or challenge bypass and cannot promise every
site works. Cookie support does not solve CAPTCHA or Cloudflare challenges.

## Cache, privacy and presentation

Classic reuses bounded upstream HTTP/TLS connections for public GET/HEAD
requests, avoiding repeated connection setup for same-host assets. DNS is still
validated on every request and redirect; a different validated address set uses
a separate connection pool. Cookie/Authorization requests and mutations do not
use the public pool. Idle connections expire after at most five seconds
(or sooner when requested by the upstream server); active streams retain the
existing execution deadline. Browser cache metadata is read in bounded parallel
batches rather than one resource at a time.

Each engine has an always-enabled, browser-local public asset cache with its own
selected size limit and maximum of 200 entries. Scramjet caches original assets
before rewriting, keyed by top-level site, URL, destination, cache version and
response Vary. Its per-resource limit is 16 MB; larger resources still stream.
It excludes Cookie/Authorization/Range requests, Set-Cookie/private responses,
HTML, APIs, sensitive URL queries and downloads. Upstream Age and elapsed body
read time cannot restart freshness. Cache inspection and selected category/site
clearing reach both configured engines over the isolated channel. Clearing
public assets never silently clears login storage.

The Classic service-worker cache is browser-local, split into proxy HTTP,
image, font and media categories. Fresh public static assets are reused without
another upstream download, including versioned asset URLs. Old disabled settings
no longer disable caching. It is LRU-bounded by the selected size and 200 entries.
Freshness honors upstream max-age/Age with a 15-minute cap. Pages, API responses,
authenticated/private responses, sensitive query strings, and downloads are
excluded. Set-Cookie headers on static assets are ignored and do not by
themselves prevent caching a fresh public response. Individual resources over
4 MB are streamed normally but not duplicated into this cache. Clear
all/categories or the current site's cache without clearing unrelated
authenticated storage.
Opaque proxy frames cannot rely on an app service worker controlling their
subresources. Eligible public assets also use Vercel's edge cache with the same
freshness cap and credential exclusions. Pages, API calls and downloads remain
`no-store`. Asset responses vary by origin, accepted content/language, user agent
and upstream Vary headers. Clearing cache advances a browser-local asset version,
so reloading requests fresh URLs, including CDN assets used by that page.
The size setting applies to browser CacheStorage, not native HTTP caching or Vercel's edge storage;
old public edge versions expire naturally rather than being globally purged.
Large eligible rewritten public assets are gzip-compressed before leaving the
function when the client accepts gzip. This also lets compressible bundles
larger than Vercel's 10 MB edge-cache response limit fit into that cache; the
CDN's later automatic compression alone does not solve the size limit.
Eligible public assets also carry a private browser HTTP-cache lifetime, so
opaque frames can reuse fresh files without another edge request. Other
downstream shared caches cannot store them. Service-worker CacheStorage fetches
bypass the browser HTTP cache to avoid restarting freshness from an older copy.
Clearing a site's cache changes its asset version for both native and edge
caching; old entries expire naturally.

Request logging defaults on for new settings, remains optional, is transient and limited to 200
metadata records per tab. Sensitive URL parameters are redacted from
persisted history/bookmarks/session/download metadata. Neither request
bodies, cookie values, credentials nor page contents are logged.
The Loading console shows bounded timestamped navigation stages, slow-load
warnings, API starts, resource status/timings and errors. It does not collect
arbitrary website console messages or claim to see DIRECT internals.
Document parsing and frame-load events do not prove a site works. Upstream
HTTP failures and explicit Cloudflare verification responses remain visible
after load; script errors include redacted source URLs, and sandbox security
errors are identified separately without exposing error messages or stacks.
CSS URL rewriting decodes CSS escapes before resolving addresses, including
escaped parentheses in CDN image filenames.
Quick actions expose the console, URL copying, site-cache clearing, tab
duplication and fullscreen on desktop/mobile. Download links inside Proxy pages
use the proxy download manager rather than opening an upstream connection.
Proxy site cookies are kept in browser storage and sent through the proxy only
to their matching upstream host; they are not persisted by the proxy server.

User-triggered about:blank wrapping and custom tab title/favicon affect
presentation only. They do not conceal network traffic, server logs or
browser activity. Website links open in app tabs, not external windows;
the explicit about:blank and Open directly actions open native windows.
Browser-owned policy pages describe unconfigured operator contact details
honestly and do not claim an established private copyright complaint channel.

## uBlock Origin network filtering

Both engines use the **official `@gorhill/ubo-core` static network filtering
engine**, not a rebranded homemade blocker. EasyList/EasyPrivacy snapshots
and the supplied custom domain exceptions are compiled at build time.
Filtering is enabled by default and can be toggled in Settings; reload open
pages after changing it.

This is **not the full uBlock Origin extension**: cosmetic filtering,
scriptlets, dynamic filtering and extension APIs are not ported. It applies
to requests routed through the selected engine, not native DIRECT browsing.
Your `@@` exceptions take priority under uBO's filter
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
under their GPL option. The deployment includes its [AGPL license](./LICENSE). Legacy Ultraviolet sources are retained for reference and
are not part of the deployed browser; `pnpm run build:uv` is the old library
build, not the application build.

## Supabase WebSocket relay setup

This optional setup is for **Classic only**. Scramjet uses Bare or Wisp instead.
The Classic HTTP(S) proxy remains on Vercel. The optional `ws-relay` Edge Function
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

## Copyright, DMCA and legal readiness

Bromine does not provide user upload or public publishing features. It opens
remote pages selected by a user and may temporarily cache eligible public
assets. The project operator does not control the source website or decide who
owns its material. A copyright concern about a destination page should normally
also be sent to that destination's hosting provider.

This source tree does **not** identify the service's legal operator, business
entity, jurisdiction, postal address, support contact, or a registered DMCA
agent. The `/dmca` page must not be treated as a live notice channel until the
operator supplies and publishes a real contact. Posting a policy or README does
not register an agent or guarantee a statutory safe harbor. Whether a specific
proxy, cache, or deployment qualifies is a legal question for qualified counsel.

Before a public operator relies on 17 U.S.C. § 512:

1. Identify the legal service provider and the applicable service categories
   with counsel. For categories that require an agent, register a designated
   agent through the [Copyright Office DMCA Directory](https://www.copyright.gov/dmca-directory/).
2. Publish the agent's real name, service-provider name, postal address,
   telephone number and email on a public policy page, and keep that information
   consistent with the Office directory. Renew or confirm the designation at
   least every three years, and promptly update changed information.
3. Provide a monitored, private intake channel and a written process for
   reviewing notices, disabling access to material under the operator's
   control when appropriate, notifying affected users, and securely retaining
   case records. Do not ask people to post private legal notices, addresses,
   or evidence in public issue trackers.
4. Adopt and reasonably implement a repeat-infringer policy if required for
   the safe harbor being claimed. Have counsel review the policy, notices,
   counter-notice workflow, retention schedule, and any cross-border issues.

A notice under § 512(c)(3) generally needs a physical or electronic signature;
identification of the copyrighted work; identification and location of the
claimed infringing material; the complainant's contact information; a good-faith
belief statement; and a statement of accuracy and authority under penalty of
perjury. See the [Copyright Office Section 512 guide](https://www.copyright.gov/512/)
for the current statutory process and sample notices. A counter-notice has its
own signature, identification, contact, good-faith, penalty-of-perjury,
jurisdiction and service-of-process requirements. The statute provides a
10–14 business-day restoration window in specified circumstances; do not
promise restoration or removal without checking the actual notice and legal
requirements. A policy page alone cannot make the service “DMCA-proof.”

The public legal pages intentionally say that no designated agent or private
operator contact is configured. Replace that text only after the real operator
has established and verified the contact process. See [Terms](/terms),
[Privacy](/privacy), [Copyright](/copyright), [DMCA reports](/dmca),
[Abuse reports](/abuse), and [Contact](/contact).

## Third-party licenses

The repository combines components with different licenses. Review the
included license files and pinned dependency notices before distributing a
modified or hosted version. Scramjet and libcurl transport are AGPL-3.0-only;
uBlock Origin core is GPL-3.0-or-later; other components retain their own
licenses. The root package's `MIT` declaration does not replace the terms for
bundled dependencies. See [`LICENSE`](./LICENSE), [`LICENSES/`](./LICENSES/),
and the [license and source links above](#scramjet-transport-setup).

## Vercel deployment

Vercel runs `pnpm run build`, serves `public/`, and deploys `api/proxy.js`.
Git builds use `VERCEL_GIT_COMMIT_SHA` for the version endpoint. For a CLI
deployment without a Git checkout on the builder, run
`npx vercel --prod --build-env BROMINE_BUILD_COMMIT="$(git rev-parse HEAD)"`.
The function bundle explicitly includes the compiled filters and uBlock
Origin's public-suffix data, which its runtime loads from disk.
Dependency assets must be included from pnpm's real package directory, not
from beneath its `node_modules` symlink, or Vercel rejects the function bundle.
The isolated Scramjet frontend and Wisp backend are separate deployments,
as described above. Classic alone needs neither Wisp nor the isolated frontend;
its optional Supabase relay is another independent deployment.
Deploy through the connected GitHub integration **only after local tests
pass**, then verify the actual production URL:

```sh
TEST_BASE_URL=https://ultraviolet-ubg.vercel.app pnpm run test:browser
```

`/version.json` exposes the built commit hash so an old cached deployment
cannot be mistaken for the new one. Production search/media compatibility
must be checked individually; local fixtures do not prove those sites work.
