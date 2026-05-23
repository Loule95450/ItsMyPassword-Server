/**
 * Full end-to-end OPAQUE flow: we drive the protocol with the real
 * @cloudflare/opaque-ts client against the Fastify app injected with an
 * in-memory SQLite store.
 *
 * The point of these tests is not to re-validate OPAQUE — Cloudflare did
 * that — but to lock in the HTTP contract: anti-enumeration, rate-limit,
 * device handling, session lifecycle.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { OpaqueClient, OpaqueID, getOpaqueConfig } from "@cloudflare/opaque-ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import { buildApp } from "../src/app.js";
import type { Config } from "../src/config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");

const testConfig = (): Config => ({
  port: 0,
  host: "127.0.0.1",
  databasePath: ":memory:",
  logLevel: "fatal",
  trustProxy: false,
  adminPort: null,
  adminHost: "127.0.0.1",
  corsOrigins: [],
  serverHmacKey: Buffer.alloc(32, 1),
});

const opaqueConfig = getOpaqueConfig(OpaqueID.OPAQUE_P256);

async function registerHelper(
  app: FastifyInstance,
  email: string,
  master: string,
  deviceLabel = "test-device",
): Promise<{ sessionToken: string; userId: string; deviceId: string; devicePubkey: Buffer }> {
  const client = new OpaqueClient(opaqueConfig);
  const req = await client.registerInit(master);
  if (req instanceof Error) throw req;

  const startRes = await app.inject({
    method: "POST",
    url: "/auth/opaque/register/start",
    payload: { email, request: req.serialize() },
  });
  expect(startRes.statusCode).toBe(200);
  const startBody = startRes.json() as { response: number[] };

  const fin = await client.registerFinish(
    deserializeRegistrationResponse(startBody.response),
    "keyfount-server",
  );
  if (fin instanceof Error) throw fin;

  const devicePubkey = randomBytes(32);
  const finRes = await app.inject({
    method: "POST",
    url: "/auth/opaque/register/finish",
    payload: {
      email,
      record: fin.record.serialize(),
      kdfParams: JSON.stringify({ algo: "argon2id", m: 65536, t: 3, p: 1 }),
      devicePubkey: Array.from(devicePubkey),
      deviceLabel,
    },
  });
  expect(finRes.statusCode).toBe(200);
  const finBody = finRes.json() as {
    userId: string;
    deviceId: string;
    approvalStatus: string;
  };
  expect(finBody.approvalStatus).toBe("pending");

  // Force-approve via direct DB write so the helper returns a usable
  // session token for the rest of the test suite. Production-flow tests
  // exercising the real approval workflow live in admin.test.ts.
  forceApprove(app, finBody.userId);

  const statusRes = await app.inject({
    method: "GET",
    url: `/auth/approval-status/${finBody.userId}`,
  });
  expect(statusRes.statusCode).toBe(200);
  const statusBody = statusRes.json() as { status: string; sessionToken?: string };
  expect(statusBody.status).toBe("approved");
  if (!statusBody.sessionToken) throw new Error("expected sessionToken");
  return {
    userId: finBody.userId,
    deviceId: finBody.deviceId,
    sessionToken: statusBody.sessionToken,
    devicePubkey,
  };
}

/** Bypass the admin approval flow by writing the status row directly.
 * Used only in tests that want to exercise post-approval behavior. */
function forceApprove(app: FastifyInstance, userIdHex: string): void {
  // The store is exposed on the Fastify instance via the closure-captured
  // build call; we access it through the dependency injection used by
  // app.ts. As a fallback, open a tiny side channel.
   
  const db = (app as any).__store_db as
    | import("better-sqlite3").Database
    | undefined;
  if (!db) throw new Error("test DB handle not exposed on app");
  db.prepare(
    "UPDATE users SET approval_status = 'approved' WHERE id = ?",
  ).run(Buffer.from(userIdHex, "hex"));
}

async function loginHelper(
  app: FastifyInstance,
  email: string,
  master: string,
  devicePubkey: Buffer,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const client = new OpaqueClient(opaqueConfig);
  const ke1 = await client.authInit(master);
  if (ke1 instanceof Error) throw ke1;

  const startRes = await app.inject({
    method: "POST",
    url: "/auth/opaque/login/start",
    payload: { email, ke1: ke1.serialize() },
  });
  if (startRes.statusCode !== 200) {
    return { ok: false, status: startRes.statusCode, body: startRes.json() as Record<string, unknown> };
  }
  const startBody = startRes.json() as { ke2: number[]; challengeToken: string };
  const ke2 = deserializeKE2(startBody.ke2);

  const finResult = await client.authFinish(ke2, "keyfount-server");
  let ke3Bytes: number[];
  if (finResult instanceof Error) {
    // Client refused — to test the server we still send an arbitrary KE3.
    ke3Bytes = new Array(opaqueConfig.mac.Nm).fill(0);
  } else {
    ke3Bytes = finResult.ke3.serialize();
  }

  const finRes = await app.inject({
    method: "POST",
    url: "/auth/opaque/login/finish",
    payload: {
      challengeToken: startBody.challengeToken,
      ke3: ke3Bytes,
      devicePubkey: Array.from(devicePubkey),
    },
  });
  return {
    ok: finRes.statusCode === 200,
    status: finRes.statusCode,
    body: finRes.json() as Record<string, unknown>,
  };
}

// Direct re-imports to avoid going through the package public index for
// internal-only message types — but in practice the public index exports
// what we need.
import { RegistrationResponse, KE2 } from "@cloudflare/opaque-ts";

function deserializeRegistrationResponse(bytes: number[]): RegistrationResponse {
  return RegistrationResponse.deserialize(opaqueConfig, bytes);
}
function deserializeKE2(bytes: number[]): KE2 {
  return KE2.deserialize(opaqueConfig, bytes);
}

describe("OPAQUE auth flow", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(testConfig(), { migrationsDir: MIGRATIONS_DIR });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("registration", () => {
    it("registers a new user end-to-end", async () => {
      const out = await registerHelper(app, "alice@example.com", "correct-horse-battery-staple");
      expect(out.sessionToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(out.userId).toMatch(/^[0-9a-f]{32}$/);
    });

    it("rejects a second register with the same email", async () => {
      await registerHelper(app, "dup@example.com", "pw1");
      const client = new OpaqueClient(opaqueConfig);
      const req = await client.registerInit("pw2");
      if (req instanceof Error) throw req;
      // register/start always responds normally (anti-enumeration).
      const startRes = await app.inject({
        method: "POST",
        url: "/auth/opaque/register/start",
        payload: { email: "dup@example.com", request: req.serialize() },
      });
      expect(startRes.statusCode).toBe(200);
      // /finish is where the collision shows up.
      const fin = await client.registerFinish(
        deserializeRegistrationResponse((startRes.json() as { response: number[] }).response),
      );
      if (fin instanceof Error) throw fin;
      const finRes = await app.inject({
        method: "POST",
        url: "/auth/opaque/register/finish",
        payload: {
          email: "dup@example.com",
          record: fin.record.serialize(),
          kdfParams: JSON.stringify({ algo: "argon2id", m: 65536, t: 3, p: 1 }),
          devicePubkey: Array.from(randomBytes(32)),
        },
      });
      expect(finRes.statusCode).toBe(409);
    });

    it("rejects malformed bodies", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/opaque/register/start",
        payload: { email: "x", request: [-1] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("login", () => {
    beforeEach(async () => {
      // fresh app per scenario to reset rate-limit + DB
      await app.close();
      app = await buildApp(testConfig(), { migrationsDir: MIGRATIONS_DIR });
    });

    it("happy path: register then login returns a fresh session token", async () => {
      const reg = await registerHelper(app, "bob@example.com", "hunter2");
      const login = await loginHelper(app, "bob@example.com", "hunter2", reg.devicePubkey);
      expect(login.ok).toBe(true);
      expect(login.body["sessionToken"]).not.toBe(reg.sessionToken);
      expect(login.body["deviceId"]).toBe(reg.deviceId);
    });

    it("wrong password returns 401 with generic body", async () => {
      await registerHelper(app, "carol@example.com", "right-pw");
      const fake = randomBytes(32);
      const login = await loginHelper(app, "carol@example.com", "wrong-pw", fake);
      expect(login.ok).toBe(false);
      expect(login.status).toBe(401);
      expect(login.body).toEqual({ error: "invalid_login" });
    });

    it("unknown email returns the same 401 shape (no enumeration)", async () => {
      const fake = randomBytes(32);
      const login = await loginHelper(app, "ghost@example.com", "anything", fake);
      expect(login.status).toBe(401);
      expect(login.body).toEqual({ error: "invalid_login" });
    });

    it("locks out an account after 5 failed attempts", async () => {
      await registerHelper(app, "dave@example.com", "good-pw");
      const fake = randomBytes(32);
      for (let i = 0; i < 5; i++) {
        const r = await loginHelper(app, "dave@example.com", "bad", fake);
        expect(r.status).toBe(401);
      }
      const blocked = await loginHelper(app, "dave@example.com", "good-pw", fake);
      expect(blocked.status).toBe(429);
    });
  });

  describe("session-protected routes", () => {
    beforeEach(async () => {
      await app.close();
      app = await buildApp(testConfig(), { migrationsDir: MIGRATIONS_DIR });
    });

    it("rejects /devices without a Bearer token", async () => {
      const r = await app.inject({ method: "GET", url: "/devices" });
      expect(r.statusCode).toBe(401);
    });

    it("returns the current device flag on /devices", async () => {
      const reg = await registerHelper(app, "eve@example.com", "pw");
      const r = await app.inject({
        method: "GET",
        url: "/devices",
        headers: { authorization: `Bearer ${reg.sessionToken}` },
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { devices: { id: string; current: boolean }[] };
      expect(body.devices).toHaveLength(1);
      expect(body.devices[0]!.current).toBe(true);
    });

    it("logout invalidates the session", async () => {
      const reg = await registerHelper(app, "frank@example.com", "pw");
      const auth = { authorization: `Bearer ${reg.sessionToken}` };
      const r1 = await app.inject({ method: "POST", url: "/auth/logout", headers: auth });
      expect(r1.statusCode).toBe(200);
      const r2 = await app.inject({ method: "GET", url: "/devices", headers: auth });
      expect(r2.statusCode).toBe(401);
    });

    it("DELETE /account cascades to devices + sessions", async () => {
      const reg = await registerHelper(app, "gina@example.com", "pw");
      const auth = { authorization: `Bearer ${reg.sessionToken}` };
      const del = await app.inject({ method: "DELETE", url: "/account", headers: auth });
      expect(del.statusCode).toBe(200);
      const after = await app.inject({ method: "GET", url: "/devices", headers: auth });
      expect(after.statusCode).toBe(401);
    });
  });
});
