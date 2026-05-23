# Protocol — wire format and flows

This document is the canonical reference for what passes between the
Keyfount extension (and future mobile clients) and a self-hosted
sync server. Anything that disagrees with this file is a bug in the
implementation, not in the doc.

## 0. Threat model in one sentence

The server is treated as **honest-but-curious**: it runs the code in
this repository as published, but its operator might be malicious, the
host might be compromised, and the database might be exfiltrated. None
of those events must leak the master password or the account index in
plaintext.

The full threat model lives in [threat-model.md](./threat-model.md).

## 1. Key derivation (client-side only)

The master password never leaves the client. Two independent keys are
derived from it:

```
master  ─┐
         ├─► Argon2id(salt = salt_sync, m=64 MiB, t=3, p=1)  →  MK   (32 bytes)
email   ─┘
                                                              │
                                                              ├─► HKDF-SHA256(MK, info="impw.enc.v1",  salt=user_id)  →  EK  (AES-GCM key)
                                                              └─► HKDF-SHA256(MK, info="impw.auth.v1", salt=user_id)  →  LK  (OPAQUE input)
```

- `salt_sync` is 16 cryptographically-random bytes generated client-side
  on first registration and persisted in `chrome.storage.local`. The
  server never sees it in cleartext (the OPAQUE registration record
  binds it indirectly).
- The HKDF salt is `user_id` (the server-assigned UUIDv7 bytes) at
  steady state. During registration the client doesn't know its
  `user_id` yet, so the HKDF salt is a 16-byte zero buffer; the
  resulting EK is then re-derived once the user_id is known.
- Argon2id parameters are pinned and announced by the server in the
  `kdfParams` field on every `/auth/opaque/login/start` response.

## 2. SyncableState — what gets synced

```ts
interface SyncableState {
  v: 1;
  defaultProfile: Profile;
  sites: Record<string, Profile>;
  fingerprint?: string;
  historyEnabled: boolean;
  faviconFallbackEnabled: boolean;
  accounts: AccountEntry[];
}
```

Explicitly **not synced** (device-local UX):
- `pin` blob
- `autoLockMinutes`
- `clipboardClearSeconds`
- `schemaVersion`

## 3. Event log

The client modifies `SyncableState` by emitting `SyncOp` events. Each
event is AES-GCM(EK)-encrypted client-side and uploaded with a Lamport
clock + device id.

```ts
type SyncOp =
  | { t: "set_default_profile"; profile: Profile }
  | { t: "set_site_profile"; domain: string; profile: Profile }
  | { t: "delete_site_profile"; domain: string }
  | { t: "set_fingerprint"; fingerprint: string }
  | { t: "set_pref"; key: "historyEnabled" | "faviconFallbackEnabled"; value: boolean }
  | { t: "upsert_account"; entry: AccountEntry }
  | { t: "delete_account"; domain: string; username: string }
  | { t: "rename_account"; domain: string; oldUsername: string; newUsername: string };
```

Conflict resolution: **LWW with tiebreaker `(lamport, deviceId)`** on
the scalar fields. Two concurrent `upsert_account` on different
`(domain, username)` keys never conflict; on the same key, the later
Lamport wins, with the higher `deviceId` as tiebreaker.

## 4. Endpoints

All bodies are JSON. Byte arrays travel as `number[]` (each element
0..255) to match `@cloudflare/opaque-ts`'s native encoding.

### Unauthenticated

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness probe |
| POST | `/auth/opaque/register/start` | OPAQUE registration round 1 |
| POST | `/auth/opaque/register/finish` | OPAQUE registration round 2 (creates user + device + session) |
| POST | `/auth/opaque/login/start` | OPAQUE login round 1 (also returns server-advertised `kdfParams`) |
| POST | `/auth/opaque/login/finish` | OPAQUE login round 2 |

### Authenticated (`Authorization: Bearer <sessionToken>`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/logout` | Revoke the current session |
| DELETE | `/account` | Purge user + all devices + sessions + events + snapshots |
| GET | `/devices` | List enrolled devices (`current: true` flag on the caller) |
| DELETE | `/devices/:id` | Revoke a device and all its sessions |
| GET | `/events?since=<seq>&limit=<n>` | Incremental pull |
| POST | `/events` | Append a single encrypted op |
| GET | `/snapshots/latest` | Bootstrap pull (or 204 if none) |
| POST | `/snapshots` | Upload a snapshot and compact events ≤ `upToSeq` |

### Limits

| | Limit |
|---|---|
| Per-event ciphertext | 64 KiB |
| Per-snapshot ciphertext | 1 MiB |
| Global rate-limit | 100 req/min/IP |
| Login rate-limit | 5 failures / 15 min / account, 20 / 15 min / IP, then 429 with `Retry-After` |
| Session TTL | 30 days |
| Login challenge TTL | 2 min |

## 5. Registration flow

```
client                                 server
  │  Argon2id + HKDF                      │
  │  OPAQUE.registerInit(LK) → req        │
  ├──── POST /register/start ────────────►│  state-less: derive RegistrationResponse
  │                                       │
  │◄────── 200 { response } ──────────────┤
  │                                       │
  │  OPAQUE.registerFinish(response)       │
  │    → record + export_key                │
  │  generate device keypair                │
  ├──── POST /register/finish ────────────►│  INSERT user, INSERT device,
  │      { email, record, kdfParams,       │  audit("register"), create session
  │        devicePubkey, deviceLabel? }    │
  │◄── 200 { userId, deviceId,             │
  │           sessionToken, expiresAt } ───┤
```

If the `email_hash` is already taken, **`/start` still returns 200**
(no enumeration); the collision surfaces only at `/finish` with `409
{ "error": "already_registered" }`.

## 6. Login flow

```
client                                 server
  │  OPAQUE.authInit(LK) → ke1            │
  ├──── POST /login/start ───────────────►│  IF user unknown:
  │                                       │    record ← RegistrationRecord.createFake()
  │                                       │    isDummy ← true
  │                                       │  ELSE:
  │                                       │    record ← users.opaque_record
  │                                       │  authInit(ke1, record, email_hash)
  │                                       │    → ke2 + ExpectedAuthResult
  │                                       │  persist ExpectedAuthResult as a
  │                                       │  single-use challenge keyed by a fresh token
  │◄── 200 { ke2, challengeToken, kdfParams }
  │                                       │
  │  OPAQUE.authFinish(ke2) → ke3         │
  │                                       │
  ├──── POST /login/finish ──────────────►│  consume challenge (single-use, expires in 2 min)
  │      { challengeToken, ke3,            │  IF dummy OR authFinish fails:
  │        devicePubkey, deviceLabel? }   │    rate-limit.record(failure)
  │                                       │    audit("login_failure")
  │                                       │    return 401 { error: "invalid_login" }
  │                                       │  ELSE:
  │                                       │    upsert device by pubkey
  │                                       │    create session
  │                                       │    audit("login_success")
  │◄── 200 { userId, deviceId,             │
  │           sessionToken, expiresAt } ───┤
```

Anti-enumeration guarantees:
- `/login/start` returns 200 in both cases (real user and unknown), with
  the same JSON shape and an OPAQUE-shaped `ke2` (real or fake).
- `/login/finish` returns the identical `401 { "error": "invalid_login" }`
  for any of: missing challenge, expired challenge, wrong password,
  dummy challenge.

## 7. Sync — incremental pull

```
GET /events?since=<server_seq>&limit=200    Authorization: Bearer …
↓
{
  events: [
    {
      serverSeq: 42,
      deviceId: "<hex32>",
      lamport: 17,
      ciphertext: [...],
      nonce: [...],
      signature: null,    // ed25519 signature when M6 lands
      createdAt: 1747840000000
    },
    …
  ],
  nextCursor: 42,
  hasMore: false
}
```

The client decrypts each `ciphertext` with EK and replays the resulting
`SyncOp` against the local `SyncableState`, then persists
`nextCursor` so the next pull is incremental.

## 8. Sync — push

```
POST /events     Authorization: Bearer …
{
  lamport: 18,
  ciphertext: [...],   // AES-GCM(EK, JSON.stringify(SyncOp))
  nonce: [...],        // 12 fresh bytes per call
  signature: [...]?    // ed25519 sig, optional during bootstrap
}
↓
200 { serverSeq: 43, acceptedAt: 1747840001234 }
```

The server only enforces: ownership (user_id ← session), payload
ceiling (`413 payload_too_large` above 64 KiB), and assigning a fresh
`server_seq`. It never inspects or persists anything else about the
event body.

## 9. Sync — snapshot + compaction

```
POST /snapshots
{ upToSeq, ciphertext, nonce, signature? }
↓
200 { snapshotId, compactedEvents }
```

Atomically: persist the snapshot, then `DELETE FROM events WHERE
user_id = ? AND server_seq <= upToSeq`. Rejection cases:

- `upToSeq > MAX(server_seq)` for the user → `400 snapshot_ahead_of_log`
- ciphertext > 1 MiB → `413 payload_too_large`

Currently single-device mode. Multi-device ACK-gated GC lands in a
follow-up.
