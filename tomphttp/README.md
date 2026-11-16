# Bromine Bare Worker

Independent JavaScript implementation of the
[TompHTTP Bare v3 protocol](https://github.com/tomphttp/specifications/blob/master/BareServerV3.md).
Discovery: `/bare/`; HTTP and WebSocket endpoint: `/bare/v3/`;
health check: `/healthz` returns `ok`.

Uses Workers `fetch()`, not raw TCP. This can reach Cloudflare-hosted sites,
but does not solve or bypass Cloudflare verification, CAPTCHA, login, or site
restrictions. Worker HTTP header normalization, platform-added headers and TLS
fingerprints still apply; this is not a byte-for-byte raw HTTP transport.
For example, Discord currently rejects Worker asset requests with HTTP 400
`Bad Worker Origin`, leaving its login page blank. Reaching a site's HTML does
not mean its scripts or sign-in will work. Scramjet reports failed script and
stylesheet responses in its status and loading console. Use direct browsing
for rejected sites; a Wisp Worker on Cloudflare cannot reach Cloudflare IPs
either.

## Deploy using the dashboard

1. Cloudflare **Workers & Pages → Create application → Import a repository**
   (or **Continue with GitHub**).
2. Select `faultyaccount2/Ultraviolet-ubg`, branch `main`.
   Repository URL: `https://github.com/faultyaccount2/Ultraviolet-ubg`.
   The code is at
   `https://github.com/faultyaccount2/Ultraviolet-ubg/tree/main/tomphttp`;
   a GitHub tree URL is not the Git repository URL.
3. If missing, use **GitHub → Settings → Applications → Installed GitHub Apps
   → Cloudflare Workers and Pages → Configure**, choose `faultyaccount2`, and
   grant this repository access.
4. Worker name: `bromine-bare`. Root directory: `tomphttp`.
   Build command: leave empty. Deploy command: `npm run deploy`.
   The build service installs dependencies from this folder's package lock.
   If it offers an install-command field, use `npm ci`.
5. Deploy on **Workers Free**. No KV, Durable Objects, paid bindings, or card
   are required. The v3 WebSocket handshake lives in its connection, not in
   shared storage.
6. By default, only the known Scramjet origin
   `https://scramjet-ubg.vercel.app` is accepted. If your frontend uses another
   origin, set `BARE_ALLOWED_ORIGINS` under **Settings → Variables and Secrets**
   to comma-separated exact origins, such as
   `https://scramjet-ubg.vercel.app,https://ultraviolet-ubg.vercel.app`.
   Include the Scramjet origin: requests originate there. Origin filtering
   restricts browser callers, not authenticated access; non-browser clients
   can spoof Origin.
   - `BARE_BLOCKED_HOSTS`: comma-separated hosts, e.g.
     `blocked.example.org,*.blocked.example.net`.
     A wildcard blocks subdomains, not the apex.
   Save and deploy variable changes. No secrets are needed.

## Connect Vercel

After `/healthz` works, add this **Production build variable on both** the
Bromine UI project and the isolated `scramjet-ubg` project:

```text
BROMINE_BARE_URL=https://bromine-bare.e42xec.workers.dev/bare/
```

Keep the existing `BROMINE_WISP_URL` for the Wisp option, and keep the existing
`BROMINE_SCRAMJET_ORIGIN` (Bromine project) and `BROMINE_APP_ORIGINS` (Scramjet
project). Use your actual Worker domain if different. Redeploy **both** Vercel
projects, then reload Bromine.

**Settings → Scramjet transport → Bare (default)** selects Bare for all sites;
choose **Wisp (libcurl)** to switch. There is no silent fallback. The build
includes the deployed Worker URL by default; `BROMINE_BARE_URL` (shown above)
overrides it and is public configuration, not a secret. Clear old
browser-local URL overrides to use build configuration. The standalone
Scramjet page also has a transport selector.
Its standalone tab bar supports new/switch/close, site-requested new tabs and
per-tab titles/favicons. Inactive pages remain loaded; closing the last tab
creates an empty tab. Alt+T, Alt+W and Alt+L work from the frontend toolbar.

Bare terminates upstream TLS on Cloudflare. Its operator/platform can see
website URLs, headers, cookies and bodies. Unlike Wisp/libcurl, upstream
HTTPS is not encrypted end-to-end from the user's browser.

## Limits and safety

The Free plan has 100,000 incoming requests/day and a 10 ms CPU budget per
request. HTTP uploads/downloads are streamed without JS body buffering.
DNS validation adds two parallel DoH subrequests per hostname request; it
does not consume another incoming Worker request, but subrequest limits still
apply. No server-side response cache or cookie store is used.
Actual CPU usage must be checked in Cloudflare metrics after deployment;
local success is not a guarantee of CPU usage or site compatibility.

Only standard-port public HTTP(S)/WS(S) destinations are supported.
Literal private/reserved IPs, alternate IP spellings, internal names, mixed
public/private DNS responses and internal CNAMEs are rejected. Redirects are
returned to the client without following them, so each subsequent request is
validated again. Cookies appear only in Bare metadata, never as Worker-origin
Set-Cookie response headers. Ambient frontend credentials are not forwarded.

Workers `fetch()` cannot pin its connection to the separately checked DNS
answers. These DoH checks are defense in depth, not the same DNS-pinning
guarantee as Classic; the platform's own private-network restrictions remain
essential. Do not bind this public proxy to private-network resources.
Preflight and split metadata headers are supported. Hop-by-hop,
Worker-control and unsafe pass-through headers are filtered. Streaming
compression is handled by the Workers runtime rather than JS.

## Local checks

```sh
cd tomphttp
npm ci
npm test
npm run dev -- --ip 127.0.0.1 --port 8787
```

With the root development dependencies installed, in another terminal from
the repository root:

```sh
node tomphttp/test/smoke.js
# After deployment:
BARE_TEST_URL=https://bromine-bare.e42xec.workers.dev/bare/ node tomphttp/test/smoke.js
```

The live smoke checks health/discovery, Cloudflare HTTPS, CERN HTTP and
WebSocket text/binary echo. They require Internet access; upstream refusals
are failures, not silently skipped tests.

## License and references

This implementation is original code under the repository's AGPL-3.0
license. References checked before implementation:
`tomphttp/bare-server-worker` is GPL-3.0; `bomberfish/Infrared` is AGPL-3.0.
No reference implementation code was copied. The frontend dependency
`@mercuryworkshop/bare-transport` is LGPL-3.0; it uses the proxy-transports
interface required by this pinned Scramjet 2.x controller, not bare-as-module3.
