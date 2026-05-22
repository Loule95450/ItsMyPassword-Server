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
