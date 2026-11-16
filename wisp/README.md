# Bromine Wisp (Cloudflare Worker)

A Wisp v1 server that runs on Cloudflare Workers, for Ultraviolet / Scramjet via
bare-mux (epoxy or libcurl transport). Free, no credit card.

Written in plain JavaScript (no Rust build), inspired by
[MercuryWorkshop/wisp-server-workers](https://github.com/mercuryworkshop/wisp-server-workers).

Your Wisp URL once deployed:

```
wss://bromine-wisp.<your-subdomain>.workers.dev/wisp/
```

## Deploy from the Cloudflare dashboard (no CLI)

1. Sign up / log in at dash.cloudflare.com (free, no card).
2. **Workers & Pages** → **Create** → **Import a repository** → pick `faultyaccount2/Ultraviolet-ubg`.
3. **Project name:** `bromine-wisp`
4. **Advanced → Root directory:** `wisp`
5. **Build command:** leave empty. **Deploy command:** `npx wrangler deploy`
6. Deploy. The workers.dev address appears on the Worker's page.

## Deploy from a terminal (e.g. your Codespace)

```bash
cd wisp
npm install
npx wrangler login
npx wrangler deploy
```

## Point the frontend at it

Set the Wisp URL in the proxy's transport config, e.g.

```js
await connection.setTransport("/epoxy/index.mjs", [{ wisp: "wss://bromine-wisp.<you>.workers.dev/wisp/" }]);
```

## Settings (Worker → Settings → Variables, or `[vars]` in wrangler.toml)

| Variable | Default | What it does |
| --- | --- | --- |
| `WISP_PATH` | `/wisp/` | Endpoint path |
| `WISP_ALLOWED_ORIGINS` | (any) | Comma list of exact origins allowed to connect, e.g. `https://your-site.vercel.app` |
| `WISP_ALLOWED_PORTS` | `80,443` | Destination ports or ranges |
| `WISP_ALLOWED_HOSTS` / `WISP_BLOCKED_HOSTS` | none | Destination allow or block list (`example.com`, `*.example.com`); set one, not both |
| `WISP_ALLOW_DIRECT_IP` | `false` | Allow raw IP destinations |
| `WISP_STREAM_LIMIT_TOTAL` | `32` | Max open streams per connection |
| `WISP_STREAM_LIMIT_PER_HOST` | `6` | Max open streams to one host per connection |
| `WISP_BUFFER_SIZE` | `128` | Wisp flow-control buffer, in packets |
| `WISP_CONNECT_TIMEOUT_MS` | `10000` | TCP connect timeout |
| `WISP_DEBUG` | `false` | Log blocked/failed streams |

`GET /healthz` returns `ok`.

## Cloudflare limits to know

- **Sites hosted on Cloudflare can't be reached.** Workers block outbound TCP to
  Cloudflare IP ranges, so those streams close with "unreachable".
- **Free plan CPU is 10 ms per request**, and a whole Wisp session counts as one
  request. Relaying is light, but long heavy sessions can hit error 1102 and
  disconnect; the client reconnects.
- **No UDP.** TCP only.
- 100,000 requests a day on the free plan (each Wisp connection is one).
- Only 6 TCP connects can be *in progress* at once per session; extra ones queue.

## Other ways to run it

`wisp/node/` keeps the Node.js server (`node server.js`) for a VPS, Codespace, or
Render (`render.yaml` points at it).

## Tests

```bash
cd wisp && node --test test/*.test.js
```

License: GPL-3.0-or-later.
