# Threat model

This document enumerates the adversaries we worry about, what they can
do, and which mitigations apply. It is the contract by which to
evaluate any proposed change to the protocol or the implementation.

## Assets

| # | Asset | Sensitivity |
|---|---|---|
| 1 | Master password | Catastrophic if leaked — derives every site password |
| 2 | Generated site password (in transit / clipboard) | High |
| 3 | `SyncableState` plaintext (account index + per-site profiles) | High |
| 4 | Session token | High (impersonation until expiry) |
| 5 | `email_hash` | Low — opaque to anyone but the server operator |
| 6 | OPAQUE `RegistrationRecord` | Low — proven resistant to offline brute-force (RFC 9807) |
| 7 | Server's HMAC key (`SERVER_HMAC_KEY`) | Medium — fuels email/IP HMACs |
| 8 | Server's OPAQUE OPRF seed + AKE keypair | Medium — compromise breaks anti-enumeration |

## At-rest encryption boundary

Keyfount splits its data into two layers with very different protections.
**Payloads** — your account list, per-site profiles, every event the
client emits — are AES-GCM ciphertexts produced client-side from a key
the server never sees. **Metadata** — who has an account on this
instance, when each device last connected, which IPs touched the API —
is stored on disk in plaintext or one-way-hashed form. The headline
claim is "the server can never read your passwords or your account
list". It is **not** "an operator with disk access learns nothing
about who uses the instance".

The SQLite file itself is **not** encrypted at rest — the only
PRAGMA we set is `journal_mode = WAL` (see [src/store/db.ts](../src/store/db.ts)).
An operator (or anyone with a snapshot of the volume) can open the
file with the `sqlite3` CLI and read every column below.

### At-rest data inventory

This table walks every column the server writes to disk, what protects
it (if anything), and whether an operator with raw disk access can
read it. "HMAC" means HMAC-SHA-256 keyed with `SERVER_HMAC_KEY`
(see [src/crypto/hmac.ts](../src/crypto/hmac.ts)) — irreversible without
the key, but trivially linkable to a known candidate value once the
key is in hand.

| Table | Column | At-rest protection | Visible to operator? |
|---|---|---|---|
| `users` | `id` | None (random UUIDv7) | Yes |
| `users` | `email_hash` | HMAC(`SERVER_HMAC_KEY`) | Yes — linkable to a known email, not reversible |
| `users` | `opaque_record` | None (safe by OPAQUE design — no offline guessing of the master) | Yes (but useless) |
| `users` | `kdf_params` | None | Yes — JSON Argon2id hint |
| `users` | `created_at`, `updated_at` | None | Yes |
| `users` | `approval_status`, `approval_decided_at`, `approval_decided_by`, `rejection_reason` | None | Yes — admin workflow audit trail |
| `devices` | `id`, `user_id`, `created_at`, `last_seen_at` | None | Yes |
| `devices` | `pubkey` | None (ed25519 32 bytes) | Yes |
| `devices` | `label` | **None — free text** the user chose ("Mary's MacBook Air") | **Yes — verbatim** |
| `sessions` | `token_hash` | SHA-256 of the session token | Yes (hashed; cannot impersonate) |
| `sessions` | `user_id`, `device_id`, `created_at`, `last_used_at`, `expires_at` | None | Yes |
| `login_challenges` | `token_hash` | SHA-256 of the challenge token | Yes (hashed) |
| `login_challenges` | `user_id`, `is_dummy`, `expected_blob`, `created_at`, `expires_at` | None | Yes — `is_dummy` reveals anti-enumeration state |
| `login_attempts` | `account_key` | `user_id` if known, otherwise a 16-byte zero pad | Yes |
| `login_attempts` | `ip_hash` | HMAC(`SERVER_HMAC_KEY`) | Yes — linkable to a known IP |
| `login_attempts` | `attempted_at`, `succeeded` | None | Yes |
| `events` | `ciphertext`, `nonce` | **AES-GCM by client EK** | **No** — ciphertext only |
| `events` | `server_seq`, `user_id`, `device_id`, `lamport`, `signature`, `size_bytes`, `created_at` | None | Yes — sync activity envelope |
| `snapshots` | `ciphertext`, `nonce` | **AES-GCM by client EK** | **No** — ciphertext only |
| `snapshots` | `id`, `user_id`, `device_id`, `up_to_seq`, `signature`, `size_bytes`, `created_at` | None | Yes |
| `audit_log` | `id`, `user_id`, `device_id`, `action`, `created_at` | None | Yes — action verb + actor |
| `audit_log` | `ip_hash` | HMAC(`SERVER_HMAC_KEY`) | Yes — linkable to a known IP |
| `audit_log` | `metadata` | None (JSON; the app pre-redacts to HMACs where applicable — see [src/store/audit.ts](../src/store/audit.ts)) | Yes |
| `admins` | `id`, `created_at`, `updated_at` | None | Yes |
| `admins` | `username` | **None — plaintext** | **Yes — verbatim** |
| `admins` | `opaque_record` | None (safe by OPAQUE design) | Yes (but useless) |
| `admin_sessions` | `token_hash` | SHA-256 | Yes (hashed) |
| `admin_sessions` | `admin_id`, `created_at`, `last_used_at`, `expires_at` | None | Yes |
| `admin_login_challenges` | same shape as `login_challenges` | same as above | same as above |
| `server_secrets` | `k`, `v`, `created_at` | None — these are the OPAQUE OPRF seed and AKE keypair | Yes (the server reads them at boot) |
| `schema_migrations` | `version`, `applied_at` | None | Yes — informational only |

### What an operator can observe

With raw disk access to the SQLite file (a stolen backup, a leaked
volume snapshot, a malicious host, a misconfigured `docker cp`) — and
assuming the `SERVER_HMAC_KEY` is in the same blast radius (typically
sitting in the same Docker volume's env file or systemd unit):

- **Whether a given email has an account on this instance**, by
  re-HMAC'ing a candidate email list and looking up `users.email_hash`.
  This is a *targeted* check against a guess, not an enumeration of
  the full membership.
- **Device labels verbatim** — "Mary's MacBook Air", "Work laptop",
  whatever the user typed. Cross-referenced with the email check
  above, an attacker can confirm a specific person uses this server
  and place their devices.
- **The admin's chosen username** in cleartext.
- **IP history per user**, by re-HMAC'ing a candidate IP and joining
  `login_attempts.ip_hash` / `audit_log.ip_hash` against the user. With
  a coarse IP list (e.g. a known home prefix or VPN endpoint) this
  rounds to "location and access pattern over time".
- **Device counts per user, login frequency, approximate event sizes,
  approval status, and the full action timeline of the audit log.**
- **The OPAQUE OPRF seed + AKE keypair** in `server_secrets`, which
  would let the attacker impersonate the server in a future MITM
  scenario — though *not* recover any past master.

### What an operator cannot observe

Even with the entire SQLite file and the HMAC key in hand:

- **The master password.** OPAQUE (RFC 9807) is provably resistant to
  offline brute-force of `opaque_record`.
- **The account list, per-site profiles, generated passwords, or
  anything else inside an event or snapshot payload.** Those are
  AES-GCM ciphertexts with a fresh 12-byte nonce; the key is derived
  client-side from the master via Argon2id + HKDF and is never sent.
- **Session tokens.** Only SHA-256 hashes hit disk; impersonating a
  user requires the original token, which lives in client storage.
- **The plaintext of any email or IP** that the attacker hasn't
  already guessed. HMAC without the key is one-way; HMAC *with* the
  key is still one-way without a candidate to test.

### Recommendations for operators

- **Back up `SERVER_HMAC_KEY` separately from the database.** If your
  off-site backup contains both the SQLite file and the env file, you
  have lost the only thing that makes `email_hash` and `ip_hash`
  non-reversible to a backup thief. Keep the key in a secrets manager
  (1Password, Vault, SOPS-encrypted file with a separate recipient)
  rather than next to the volume.
- **Enable OS-level full-disk encryption on the host** — FileVault on
  macOS, LUKS on Linux, BitLocker on Windows. The Keyfount file
  inherits whatever the underlying volume gives it; if the volume is
  plaintext, so is Keyfount.
- **Restrict filesystem access to the SQLite file.** The container
  runs as a non-root user (see `Dockerfile`); make sure the host
  bind-mount or named volume isn't readable by other users or other
  containers.
- **Treat the audit log as PII.** It contains action timing, IP HMACs,
  and the admin's decisions on every user. Apply the same retention
  and access controls you would for application logs (issue #21
  tracks formalising retention).

### Optional future hardening

These are tracked as separate follow-ups in [#31](https://github.com/Keyfount/server/issues/31)
and are deliberately not implemented in this PR:

- **Env-flagged SQLCipher.** An opt-in `KEYFOUNT_DB_ENCRYPTION_KEY`
  could open the SQLite file via SQLCipher's `PRAGMA key`, encrypting
  the whole file at rest. This raises the bar for stolen-backup or
  volume-snapshot threats. It is *not* zero-knowledge — the operator
  still holds the key — and it adds a sharp footgun (lose the key,
  lose the DB), so it has to be opt-in with very loud docs.
- **Device label minimisation.** The `devices.label` column is the
  only column whose plaintext is both unconstrained free text and
  directly chosen by the user. Either HMAC'ing it client-side before
  sending or dropping the column entirely (the pubkey already
  uniquely identifies the device) would close the most obvious leak
  identified above.

These would also need cross-linking from the client-side `PRIVACY.md`
in the desktop and extension repos so the user-facing "what the server
sees about you" story stays consistent.

## Adversaries

### A. Honest-but-curious server operator

**Capabilities**: reads logs, reads the SQLite file, can inspect
network traffic at any of their hops.

**Mitigations**:
- All payloads are AES-GCM(EK) ciphertexts produced client-side. EK is
  derived from the master via Argon2id+HKDF and never sent.
- Emails and IPs are HMAC'd at the edge before storage.
- Logs redact bodies, cookies, and Authorization headers (`pino`
  redaction in `src/app.ts`).
- The OPAQUE protocol guarantees the operator never sees the master,
  even in transit (the password is run through an OPRF first).

**Residual**: the operator learns the metadata they cannot help but
see — the number of registered users, the timing and approximate sizes
of events, and per-user activity patterns. We document this as known.

### B. Server compromise / database dump

**Capabilities**: full read on every table.

**Mitigations**:
- OPAQUE (RFC 9807) makes `RegistrationRecord` **provably resistant
  to offline brute-force** of the master. This is the headline
  property and the reason we picked OPAQUE over SRP-6a or a naïve
  Argon2id-double scheme.
- Session and login-challenge tokens are stored only as SHA-256
  hashes. A dump cannot impersonate anyone post-leak.
- Account index, profiles, and recorded usernames are all inside
  AES-GCM ciphertexts; the dump exposes only ciphertext and 12-byte
  IVs.
- The server's HMAC key is in the `SERVER_HMAC_KEY` env var (not in
  the SQLite file). A dump alone does not unmask emails or IPs.

**Residual**: the attacker still learns who has an account (via
`email_hash` collisions if they already have a candidate list of
emails to test against the leak — that's a *targeted* check, not
enumeration), and the device counts per user.

**Operator obligation**: rotate `SERVER_HMAC_KEY` ⇒ lock everyone out
(by design — the hash chain breaks). Never commit the env var to the
volume or to a backup that lives next to the database.

### C. Network adversary (TLS-MITM, captive portal, hostile ISP)

**Capabilities**: arbitrary bidirectional MITM with a valid TLS cert
they should not have, or downgrade attempts on plaintext channels.

**Mitigations**:
- Caddy issues Let's Encrypt certs and serves HSTS with
  `max-age=63072000; includeSubDomains; preload`.
- OPAQUE produces a session key on both sides that an active MITM
  *cannot* compute even when sitting between client and server. So if
  TLS is broken, the protocol still resists impersonation — though
  the attacker can drop, delay, or replay messages.
- All events are AES-GCM with a fresh 12-byte nonce; replay of a
  recorded event will be visible to the server (the event's lamport
  is monotonically tracked per-device once we sign events in M6).

**Residual**: a MITM can deny service (drop packets). They cannot
exfiltrate the master.

### D. Client compromise (malicious extension, malware on the device)

**Capabilities**: read the entire `chrome.storage.local`, observe
keypresses, read the clipboard.

**Mitigations** (we can only do so much here):
- Per-device PIN encrypts the master at rest.
- Clipboard auto-wipe after `clipboardClearSeconds` (default 30 s).
- The deterministic generator means a leaked master is the worst case
  — there's no separate vault to lose. The user can recover by
  rotating to a fresh master.

**Residual**: full client compromise is fatal, as it is for every
password manager. Out of scope for the server.

### E. Account-enumeration probe

**Capabilities**: arbitrary `POST /auth/opaque/login/start` calls
with chosen email + KE1.

**Mitigations**:
- `/login/start` against an unknown email runs against
  `RegistrationRecord.createFake()` and stores a dummy
  `ExpectedAuthResult` so `/login/finish` returns the exact same `401
  { "error": "invalid_login" }`.
- Identical response time on the unknown-email path (the OPAQUE
  handshake cost dominates the SQLite lookup).
- IP rate limit: 20 login failures / 15 min / IP, on top of the
  global 100 req/min/IP.
- Account rate limit: 5 failures / 15 min / account (real or
  zero-padded for unknown accounts).

**Residual**: a global pool of dummy accounts (IPs from a wide
botnet, each below the per-IP cap) could in theory observe small
timing differences (db lookup hit vs. miss). We treat this as low
risk; the OPAQUE cost is the long tail.

### F. Brute-force of the master via the API

**Capabilities**: knows the server URL, has a candidate list of
master passwords.

**Mitigations**:
- The login rate limit caps online attempts to 5 / 15 min / account.
- Even when not rate-limited, each attempt costs the attacker a full
  Argon2id 64 MiB (≈ a few seconds on a single core) on top of the
  OPAQUE round-trip.
- OPAQUE means a *successful* /login/start does not give the
  attacker anything offline either — they have to actually complete
  the handshake against the real server, and the rate limit applies.

**Residual**: a master with very low entropy (under ~30 bits) is
brute-forceable online over weeks. We rely on the user picking a
strong master; the rest is defense in depth.

## Mitigations summary

| Mitigation | Threats addressed | Implementation |
|---|---|---|
| OPAQUE (RFC 9807) | A, B, C, F | `src/auth/opaque.ts` |
| Argon2id 64 MiB / t=3 / p=1 client-side | A, B, F | client `keys.ts` |
| HKDF domain-separation EK / LK | A, B | client `keys.ts` |
| AES-GCM payloads (fresh nonce) | A, B, C | client `sync/crypto.ts` |
| Email + IP HMAC at the edge | A, B | `src/crypto/hmac.ts` |
| SHA-256-hashed tokens at rest | B | `src/crypto/tokens.ts`, `sessions.ts`, `challenges.ts` |
| Anti-enumeration dummy record + timing | E | `src/routes/auth.ts` |
| Login rate limit (5/15 min/account, 20/15 min/IP) | E, F | `src/auth/ratelimit.ts` |
| Global rate limit (100/min/IP) | E, F | `@fastify/rate-limit` |
| HSTS + CSP + COOP/CORP | C | `@fastify/helmet` |
| Body limit 2 MiB | A (DoS) | Fastify `bodyLimit` |
| Distroless non-root container | B | `Dockerfile` |
| Trivy scan in CI | B | `.github/workflows/ci.yml` |

## Out of scope

- Phishing of the master via a fake extension or fake login page.
- Compromise of the user's clipboard manager.
- Side-channel attacks on the client (Spectre-class).
- Quantum adversaries (will require a PQ-PAKE handshake; tracked).
