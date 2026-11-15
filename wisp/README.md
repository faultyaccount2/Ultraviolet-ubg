# Wisp server (Render)

Standalone Wisp server for Ultraviolet / Scramjet / bare-mux transports.
Endpoint: `wss://<your-service>.onrender.com/wisp/` · Health: `/healthz`

## Deploy on Render
1. New > Web Service > connect this repo.
2. Root Directory: `wisp` · Runtime: Node
3. Build: `npm ci --omit=dev` · Start: `node server.js`
4. Health Check Path: `/healthz`
5. Optional env: `WISP_ALLOWED_ORIGINS=https://your-frontend.example`
(Or use the `render.yaml` Blueprint at the repo root.)

## Settings (all optional)
| Variable | Default | Meaning |
|---|---|---|
| `WISP_ALLOWED_ORIGINS` | any | Comma list of exact origins allowed to open the socket (browser check only, not auth) |
| `WISP_ALLOWED_HOSTS` | any public host | Destination allowlist, e.g. `example.com,*.discord.gg` |
| `WISP_BLOCKED_HOSTS` | none | Destination blocklist (can't combine with allowlist) |
| `WISP_ALLOWED_PORTS` | `80,443` | Destination ports or ranges |
| `WISP_ALLOW_UDP` | `false` | Allow UDP streams |
| `WISP_STREAM_LIMIT_TOTAL` | `128` | Streams per connection |
| `WISP_STREAM_LIMIT_PER_HOST` | `32` | Streams per destination per connection |
| `WISP_MAX_CONNECTIONS_PER_IP` | `8` | Concurrent sockets per client IP |
| `WISP_PATH` | `/wisp/` | WebSocket path |
| `WISP_LOG_LEVEL` | `info` | debug, info, warn, error, none |

Always blocked: loopback, private/LAN, link-local, and direct-IP destinations.
Free Render instances sleep after idle time, so the first connection can take up to a minute.

## Test
`npm install && npm test`
