/**
 * Thin wrapper around @cloudflare/opaque-ts that implements RFC 9807
 * (OPAQUE-3DH with OPRF over P-256).
 *
 * Two long-lived server secrets:
 *   - oprf_seed       — 32 random bytes used to derive per-user OPRF keys
 *   - ake_keypair     — server's AKE identity (P-256 EC keypair)
 *
 * Both are generated at first boot and persisted in `server_secrets`.
 *
 * Anti-enumeration: when login/start receives an unknown email, we still
 * complete the protocol against a freshly-fabricated RegistrationRecord
 * (RegistrationRecord.createFake). The client sees a normal KE2 and the
 * login only fails at /finish, with the same generic error as a bad
 * password — and the same timing.
 */
import {
  KE1,
  KE3,
  OpaqueID,
  OpaqueServer,
  RegistrationRecord,
  RegistrationRequest,
  RegistrationResponse,
  ExpectedAuthResult,
  getOpaqueConfig,
  type AKEExportKeyPair,
  type Config,
} from "@cloudflare/opaque-ts";
import type { Database } from "better-sqlite3";

/** ASCII server identity, baked into the protocol transcript. */
const SERVER_IDENTITY = "keyfount-server";

export interface OpaqueService {
  readonly config: Config;
  registerInit(requestBytes: number[], credentialId: string): Promise<number[]>;
  authInit(
    ke1Bytes: number[],
    record: RegistrationRecord,
    credentialId: string,
  ): Promise<{ ke2: number[]; expected: ExpectedAuthResult }>;
  authFinish(ke3Bytes: number[], expected: ExpectedAuthResult): { sessionKey: Buffer };
  buildFakeRecord(): Promise<RegistrationRecord>;
  deserializeRecord(bytes: Buffer): RegistrationRecord;
  serializeRecord(record: RegistrationRecord): Buffer;
  serializeExpected(expected: ExpectedAuthResult): Buffer;
  deserializeExpected(bytes: Buffer): ExpectedAuthResult;
}

export async function createOpaqueService(db: Database): Promise<OpaqueService> {
  const config = getOpaqueConfig(OpaqueID.OPAQUE_P256);

  // Lazy-init: generate seed + AKE keypair on first boot, then persist.
  const oprfSeed = await loadOrCreateSecret(db, "opaque.oprf_seed", () =>
    Buffer.from(config.prng.random(32)),
  );

  const akeKeypair = await loadOrCreateAkeKeypair(db, config);

  const server = new OpaqueServer(
    config,
    Array.from(oprfSeed),
    akeKeypair,
    SERVER_IDENTITY,
  );

  return {
    config,

    async registerInit(requestBytes: number[], credentialId: string): Promise<number[]> {
      const request = RegistrationRequest.deserialize(config, requestBytes);
      const result = await server.registerInit(request, credentialId);
      if (result instanceof Error) throw result;
      return (result as RegistrationResponse).serialize();
    },

    async authInit(
      ke1Bytes: number[],
      record: RegistrationRecord,
      credentialId: string,
    ): Promise<{ ke2: number[]; expected: ExpectedAuthResult }> {
      const ke1 = KE1.deserialize(config, ke1Bytes);
      const result = await server.authInit(ke1, record, credentialId);
      if (result instanceof Error) throw result;
      return { ke2: result.ke2.serialize(), expected: result.expected };
    },

    authFinish(ke3Bytes: number[], expected: ExpectedAuthResult): { sessionKey: Buffer } {
      const ke3 = KE3.deserialize(config, ke3Bytes);
      const result = server.authFinish(ke3, expected);
      if (result instanceof Error) throw result;
      return { sessionKey: Buffer.from(result.session_key) };
    },

    async buildFakeRecord(): Promise<RegistrationRecord> {
      return RegistrationRecord.createFake(config);
    },

    deserializeRecord(bytes: Buffer): RegistrationRecord {
      return RegistrationRecord.deserialize(config, Array.from(bytes));
    },

    serializeRecord(record: RegistrationRecord): Buffer {
      return Buffer.from(record.serialize());
    },

    serializeExpected(expected: ExpectedAuthResult): Buffer {
      return Buffer.from(expected.serialize());
    },

    deserializeExpected(bytes: Buffer): ExpectedAuthResult {
      return ExpectedAuthResult.deserialize(config, Array.from(bytes));
    },
  };
}

// --- internal helpers -------------------------------------------------------

async function loadOrCreateSecret(
  db: Database,
  key: string,
  generate: () => Buffer,
): Promise<Buffer> {
  const row = db
    .prepare("SELECT v FROM server_secrets WHERE k = ?")
    .get(key) as { v: Buffer } | undefined;
  if (row) return row.v;
  const value = generate();
  db.prepare(
    "INSERT INTO server_secrets (k, v, created_at) VALUES (?, ?, ?)",
  ).run(key, value, Date.now());
  return value;
}

async function loadOrCreateAkeKeypair(
  db: Database,
  config: Config,
): Promise<AKEExportKeyPair> {
  const priv = db
    .prepare("SELECT v FROM server_secrets WHERE k = ?")
    .get("opaque.ake_private") as { v: Buffer } | undefined;
  const pub = db
    .prepare("SELECT v FROM server_secrets WHERE k = ?")
    .get("opaque.ake_public") as { v: Buffer } | undefined;
  if (priv && pub) {
    return { private_key: Array.from(priv.v), public_key: Array.from(pub.v) };
  }
  const kp = await config.ake.generateAuthKeyPair();
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO server_secrets (k, v, created_at) VALUES (?, ?, ?)",
    ).run("opaque.ake_private", Buffer.from(kp.private_key), now);
    db.prepare(
      "INSERT INTO server_secrets (k, v, created_at) VALUES (?, ?, ?)",
    ).run("opaque.ake_public", Buffer.from(kp.public_key), now);
  });
  tx();
  return kp;
}
