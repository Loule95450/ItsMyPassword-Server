# Keyfount Server

> Self-hostable, zero-knowledge sync server for the Keyfount browser
> extension (and future mobile clients).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Status](https://img.shields.io/badge/status-WIP-orange.svg)](#status)
[![ghcr.io](https://img.shields.io/badge/ghcr.io-keyfount%2Fserver-blue)](https://github.com/Keyfount/server/pkgs/container/server)

## What it is

The extension is a **deterministic** password manager: passwords are derived
on demand from `master + domain + email` and never stored. The only data
worth syncing is the user's *account index* — which `(domain, username)`
pairs they have registered, and the per-site generation profile attached to
each one.

This server is that sync layer, with two strong properties:

1. **Zero-knowledge.** The server never sees the master password, an email
   address, a domain, or a username. It only stores opaque ciphertexts and
   ordering metadata.
2. **No offline brute-force after a server compromise.** Authentication
   uses [OPAQUE](https://datatracker.ietf.org/doc/rfc9807/) (an asymmetric
   PAKE). Even a complete database dump leaks nothing that an attacker
   can use to crack the master offline.

## Status

🚧 **Work in progress.** M1 (scaffold + `/health` + CI + container
publishing) is in place; auth, sync, and snapshots land in subsequent
milestones.

## Container image

Multi-arch images (`linux/amd64`, `linux/arm64`) are published to GHCR on
every push to `main` and on every `v*.*.*` tag:

```
ghcr.io/keyfount/server:latest         # rolling main
ghcr.io/keyfount/server:v0.1.0         # pinned semver
ghcr.io/keyfount/server:sha-abcdef0    # exact commit
```

## Deploy

A 32-byte HMAC key is required. Generate it once and keep it stable —
rotating it invalidates all stored email/IP hashes:

```bash
openssl rand -base64 32
```

### Option A — Portainer

1. Stacks → **Add stack** → name it `keyfount`.
2. Paste the contents of [`docker-compose.yml`](./docker-compose.yml) into
   the editor.
3. Under **Environment variables**, set at minimum:
   - `SERVER_HMAC_KEY` (the base64 string above)
   - `HOST_PORT` (e.g. `8080`, change if taken)
4. Click **Deploy the stack**. Expose `HOST_PORT` behind your existing
   reverse proxy (Cloudflare Tunnel, Traefik, nginx…).

### Option B — Synology Container Manager / Docker

1. **Container Manager** → Project → **Create**.
2. Source: *Create docker-compose.yml*. Paste
   [`docker-compose.yml`](./docker-compose.yml).
3. Add a sibling `.env` file with `SERVER_HMAC_KEY=…` and
   `HOST_PORT=8080`.
4. Build & start. Wire it through DSM **Control Panel → Login Portal →
   Advanced → Reverse Proxy** to expose it on HTTPS via your DSM cert.

### Option C — Standalone with automatic TLS (VPS)

If ports 80/443 are free and you want Caddy to handle Let's Encrypt:

```bash
git clone https://github.com/Keyfount/server.git
cd server
cp .env.example .env
# set SERVER_HMAC_KEY, DOMAIN=sync.example.com, ACME_EMAIL=you@example.com
docker compose -f docker-compose.standalone.yml up -d
```

Caddy is configured inline in that compose file (no extra Caddyfile to
manage).

### Option D — Bare `docker compose`

```bash
git clone https://github.com/Keyfount/server.git
cd server
cp .env.example .env
echo "SERVER_HMAC_KEY=$(openssl rand -base64 32)" >> .env
docker compose up -d
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `SERVER_HMAC_KEY` | *required* | Base64-encoded 32+ bytes. Hashes email/IP at rest. Never rotate. |
| `HOST_PORT` | `8080` | Host port for the bare compose. |
| `LOG_LEVEL` | `info` | `fatal\|error\|warn\|info\|debug\|trace` |
| `TRUST_PROXY` | `true` | Read `X-Forwarded-*` (set `false` if exposed directly). |
| `CORS_ORIGINS` | *(empty)* | Comma-separated. E.g. `chrome-extension://abc…` |
| `DOMAIN` | *(standalone only)* | Public hostname for Caddy / Let's Encrypt. |
| `ACME_EMAIL` | *(standalone only)* | Contact for Let's Encrypt. |

## Health check

```
curl http://localhost:8080/health
# {"status":"ok"}
```

## Backups, upgrades, troubleshooting

See the self-hosting runbook: [docs/self-host.md](./docs/self-host.md).
TL;DR for backups: stop the stack, tar the `data` volume, restart. Keep
`SERVER_HMAC_KEY` backed up *separately* — without it the database is
unusable.

## Security

If you discover a security issue, please **do not** open a public issue;
see [SECURITY.md](./SECURITY.md). The full threat model is in
[docs/threat-model.md](./docs/threat-model.md) and the wire protocol is
fully documented in [docs/protocol.md](./docs/protocol.md).

## Development

```bash
npm install
cp .env.example .env  # then set SERVER_HMAC_KEY
npm run dev
npm test
npm run typecheck
```

## License

[MIT](./LICENSE)
