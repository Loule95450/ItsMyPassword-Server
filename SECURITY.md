# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security-sensitive reports.

Email the maintainers at `security@keyfount.invalid` (replace with the
real address once published) with:

- a description of the issue,
- steps to reproduce or a proof-of-concept,
- the affected version / commit,
- any suggested remediation.

We aim to acknowledge within 72 hours and to ship a fix or mitigation
within 30 days for high-severity issues. We will credit you in the
release notes unless you ask us not to.

## Scope

In scope:

- the server in this repository,
- the Docker image and `docker-compose.yml`,
- the protocol surface (auth, sync, snapshots, sessions).

Out of scope:

- the browser extension (see its own SECURITY policy),
- third-party dependencies' upstream issues (please report to them; we
  track CVEs via `npm audit` and Trivy in CI).

## Threat model

The full threat model is in [docs/threat-model.md](./docs/threat-model.md).
In short, we assume:

- The network is hostile (TLS via Caddy + Let's Encrypt is mandatory).
- The server operator may be honest-but-curious, or fully compromised.
- The user's client (extension, mobile) is trusted.

The goal: in **every** server-compromise scenario, the master password and
the plaintext account index must remain unrecoverable. This is enforced
by:

- OPAQUE (RFC 9807) for authentication — no offline brute-force material
  is ever stored.
- AES-GCM ciphertexts derived client-side from an Argon2id-stretched key
  the server never sees.
- HMAC of emails and IPs at rest, with a server-only key.

### At-rest encryption boundary

Payloads are end-to-end encrypted; metadata is not. For a column-by-column
inventory of what an operator with disk access can and cannot see — and
recommendations for backup, key management, and FDE — see the
[at-rest encryption boundary](./docs/threat-model.md#at-rest-encryption-boundary)
section of the threat model.
