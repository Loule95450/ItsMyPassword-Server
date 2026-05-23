# Self-hosting runbook

How to deploy, operate, back up, upgrade, and troubleshoot the
Keyfount sync server. The audience is someone who runs a home
NAS or a small VPS, not a fleet of Kubernetes nodes.

## 1. Prerequisites

- A host with **Docker 24+** and `docker compose` v2 (any modern NAS,
  Portainer, a VPS, etc.).
- For Option C (standalone with auto-TLS): ports 80 and 443 free, and
  a public DNS A record for your chosen domain.
- A 32-byte random key. Generate once and keep it forever:

  ```
  openssl rand -base64 32
  ```

  Lose this key and you lock every user of *this* server out. It is
  used to HMAC emails and IPs at rest. Rotating it is equivalent to
  resetting the server.

## 2. Initial deploy

See [the project README](../README.md#deploy) for the four supported
deployment paths (Portainer, Synology Container Manager, standalone
Caddy, bare compose). This document is the long-form version.

### 2.1 Portainer / Container Manager (reverse-proxy in front)

1. **Stacks → Add stack → Web editor**.
2. Paste the contents of `docker-compose.yml`.
3. In the *Environment variables* panel:
   - `SERVER_HMAC_KEY` = your base64 key
   - `HOST_PORT` = an available host port (default `8080`)
4. Deploy. Wire the host port into your reverse proxy. The server
   itself listens HTTP — TLS is *expected* to be terminated upstream.
5. Verify: `curl http://NAS:8080/health` → `{"status":"ok"}`.

### 2.2 Standalone (the server stack also owns TLS)

```bash
git clone https://github.com/Keyfount/server.git
cd server
cp .env.example .env

# Replace the key
sed -i.bak "s|SERVER_HMAC_KEY=.*|SERVER_HMAC_KEY=$(openssl rand -base64 32)|" .env && rm .env.bak
echo "DOMAIN=sync.example.com"   >> .env
echo "ACME_EMAIL=you@example.com" >> .env

docker compose -f docker-compose.standalone.yml up -d
```

DNS first, then `up -d`. Caddy will reach out to Let's Encrypt and
issue a cert within ~30 s. Watch `docker compose logs caddy`.

## 3. Backup and restore

The entire server state lives in **one SQLite file**: `/data/keyfount.db`.

### 3.1 Cold backup (simplest)

```bash
docker compose down
docker run --rm \
  -v keyfount_data:/data \
  -v "$PWD/backups:/backup" alpine \
  tar czf "/backup/keyfount-$(date +%F).tar.gz" -C /data .
docker compose up -d
```

Restore by stopping the stack, extracting the tarball into the
volume, and starting again.

### 3.2 Hot backup (WAL-friendly)

SQLite runs in WAL mode, so a raw `cp` would race against in-flight
writes. Use the SQLite `.backup` command from inside the container or
the `litestream` integration that will land in M7 (replicates to
S3-compatible storage).

For now, the cold backup with a 1-minute downtime is the
recommended path.

### 3.3 What to back up *next to* the database

`SERVER_HMAC_KEY`. Without it, any restored database is useless
because the email/IP hashes can no longer be reproduced. Store it
**separately** from the database backup (different drive, different
location, a password manager… you have one, after all).

## 4. Upgrades

Images are tagged `latest`, `<semver>`, and `sha-<short>`. The
recommended workflow:

```bash
docker compose pull
docker compose up -d
docker image prune -f
```

Pinned tags (`docker compose -f docker-compose.yml ... v0.2.0`) give
you reproducible rollbacks. Tag your `latest` deploy by digest if you
care about supply-chain pinning:

```yaml
image: ghcr.io/keyfount/server@sha256:<digest>
```

Migrations run automatically at boot (`src/store/db.ts`). They are
forward-only — you cannot downgrade past a migration without
restoring from a backup.

## 5. Monitoring

The container exposes only `GET /health`. Wire it into Uptime Kuma,
Statping, Healthchecks.io, or whatever you use. Expected response:
`200 {"status":"ok"}` in under 50 ms.

Audit events are in the `audit_log` table — query directly with
`sqlite3 /data/keyfount.db "SELECT * FROM audit_log ORDER BY id
DESC LIMIT 20"`. Actions logged: `register`, `login_success`,
`login_failure`, `logout`, `device_revoke`, `account_delete`.

## 6. Common issues

### "I see a 401 even with a fresh master"

Most likely the `kdfParams` advertised by the server differs from
what the client used to register. Check that the client's Argon2id
parameters match `keys.ts → SYNC_KDF_PARAMS`. The login challenge has
a 2-minute TTL — wait, retry.

### "Caddy can't get a cert"

- DNS A/AAAA record correct? `dig +short DOMAIN` should return the
  host's public IP.
- Port 80 reachable from the internet? Let's Encrypt's HTTP-01
  challenge needs it.
- Inspect: `docker compose logs caddy --since 5m | grep -i acme`.

### "Account locked out"

Login rate limiter: 5 failures / 15 min / account. Either wait, or
reset the limiter manually:

```bash
docker compose exec app /nodejs/bin/node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/data/keyfount.db');
  db.exec('DELETE FROM login_attempts');
  console.log('cleared');
"
```

### "I forgot my master password"

The deterministic design has no recovery. The master is the only
input that can reproduce your passwords. If you genuinely lost it,
the only path is to rotate every site password manually starting from
a new master. This is the trade-off you signed up for when you chose
a no-vault, no-cloud-of-secrets manager.

## 7. Decommissioning

```bash
docker compose down -v
docker volume rm keyfount_data caddy_data caddy_config
```

If you served on a public domain, also revoke the Let's Encrypt cert
via Caddy or just let it expire.
