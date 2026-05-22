/**
 * OPAQUE authentication endpoints (RFC 9807) plus session management.
 *
 * Wire formats: every byte array is encoded as a JSON array of numbers
 * 0..255 (matching @cloudflare/opaque-ts's native serialization). The
 * email is sent in clear (or pre-hashed) to the server only to be HMAC'd
 * at the edge — see `hmacEmail`. The server never logs or stores it.
 */
import type { FastifyInstance } from "fastify";

import type { OpaqueService } from "../auth/opaque.js";
import type { ChallengeService } from "../auth/challenges.js";
import type { SessionService } from "../auth/sessions.js";
import { UNKNOWN_ACCOUNT_KEY, type LoginRateLimiter } from "../auth/ratelimit.js";
import { hmacEmail, hmacIp } from "../crypto/hmac.js";
import { bearerAuth } from "../middleware/auth.js";
import type { AuditLogger } from "../store/audit.js";
import type { UserRepo } from "../store/users.js";

export interface AuthDeps {
  opaque: OpaqueService;
  users: UserRepo;
  sessions: SessionService;
  challenges: ChallengeService;
  rateLimit: LoginRateLimiter;
  audit: AuditLogger;
  hmacKey: Buffer;
}

const BYTES_ARRAY_SCHEMA = {
  type: "array",
  items: { type: "integer", minimum: 0, maximum: 255 },
  maxItems: 4096,
} as const;

const EMAIL_SCHEMA = { type: "string", minLength: 3, maxLength: 320 } as const;
const LABEL_SCHEMA = { type: "string", maxLength: 64 } as const;
const TOKEN_SCHEMA = { type: "string", minLength: 16, maxLength: 256 } as const;

// JSON Schemas are passed to Fastify as untyped objects. We cast them at
// the use site to satisfy the FastifySchema shape without pulling in a
// dedicated JSON Schema type library.

export async function authRoutes(app: FastifyInstance, deps: AuthDeps): Promise<void> {
  const auth = bearerAuth(deps.sessions);

  // --- POST /auth/opaque/register/start ------------------------------------
  // Stateless. Returns the OPAQUE RegistrationResponse. No user is persisted
  // yet. If the email is already taken we still respond normally so an
  // attacker cannot enumerate accounts here either.
  app.post<{
    Body: { email: string; request: number[] };
  }>(
    "/auth/opaque/register/start",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "request"],
          properties: { email: EMAIL_SCHEMA, request: BYTES_ARRAY_SCHEMA },
          additionalProperties: false,
        } as any,
      },
    },
    async (req, reply) => {
      const emailHash = hmacEmail(req.body.email, deps.hmacKey);
      try {
        const response = await deps.opaque.registerInit(
          req.body.request,
          emailHash.toString("hex"),
        );
        return reply.send({ response });
      } catch {
        return reply.code(400).send({ error: "invalid_request" });
      }
    },
  );

  // --- POST /auth/opaque/register/finish -----------------------------------
  app.post<{
    Body: {
      email: string;
      record: number[];
      kdfParams: string;
      devicePubkey: number[];
      deviceLabel?: string;
    };
  }>(
    "/auth/opaque/register/finish",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "record", "kdfParams", "devicePubkey"],
          properties: {
            email: EMAIL_SCHEMA,
            record: BYTES_ARRAY_SCHEMA,
            kdfParams: { type: "string", minLength: 2, maxLength: 1024 },
            devicePubkey: {
              type: "array",
              items: { type: "integer", minimum: 0, maximum: 255 },
              minItems: 32,
              maxItems: 32,
            },
            deviceLabel: LABEL_SCHEMA,
          },
          additionalProperties: false,
        } as any,
      },
    },
    async (req, reply) => {
      const emailHash = hmacEmail(req.body.email, deps.hmacKey);
      if (deps.users.findByEmailHash(emailHash)) {
        return reply.code(409).send({ error: "already_registered" });
      }
      // Validate kdfParams is JSON
      try {
        const parsed = JSON.parse(req.body.kdfParams) as unknown;
        if (typeof parsed !== "object" || parsed === null) throw new Error();
      } catch {
        return reply.code(400).send({ error: "invalid_kdf_params" });
      }
      // Validate the record is structurally well-formed
      try {
        deps.opaque.deserializeRecord(Buffer.from(req.body.record));
      } catch {
        return reply.code(400).send({ error: "invalid_record" });
      }

      const { user, device } = deps.users.createUserAndDevice({
        emailHash,
        opaqueRecord: Buffer.from(req.body.record),
        kdfParams: req.body.kdfParams,
        devicePubkey: Buffer.from(req.body.devicePubkey),
        deviceLabel: req.body.deviceLabel ?? null,
        approvalStatus: "pending",
      });
      deps.audit.log({
        userId: user.id,
        deviceId: device.id,
        action: "register",
        ipHash: hmacIp(req.ip, deps.hmacKey),
        metadata: { approval_status: "pending" },
      });
      // We do NOT issue a session token here — the user is pending. They
      // poll /auth/approval-status to know when the admin approves.
      return reply.send({
        userId: user.id.toString("hex"),
        deviceId: device.id.toString("hex"),
        approvalStatus: "pending" as const,
      });
    },
  );

  // --- GET /auth/approval-status/:userId -----------------------------------
  // Poll target for the wizard after register/finish. Returns one of:
  //   { status: 'pending' }
  //   { status: 'approved', sessionToken, expiresAt }
  //   { status: 'rejected', reason?: string }
  // The endpoint is unauthenticated by design — the user does not yet
  // hold a session token. It does NOT leak whether a userId exists: we
  // respond 'pending' for any unknown id with a small randomised delay.
  app.get<{ Params: { userId: string } }>(
    "/auth/approval-status/:userId",
    {
      schema: {
        params: {
          type: "object",
          required: ["userId"],
          properties: { userId: { type: "string", pattern: "^[0-9a-f]{32}$" } },
          additionalProperties: false,
        } as any,
      },
    },
    async (req, reply) => {
      const userId = Buffer.from(req.params.userId, "hex");
      const user = deps.users.findById(userId);
      if (!user) {
        // Slight delay so a probe cannot distinguish unknown id from
        // pending in tight timing.
        await new Promise((r) => setTimeout(r, 25 + Math.random() * 25));
        return reply.send({ status: "pending" });
      }
      if (user.approvalStatus === "pending") {
        return reply.send({ status: "pending" });
      }
      if (user.approvalStatus === "rejected") {
        return reply.send({
          status: "rejected",
          ...(user.rejectionReason !== null ? { reason: user.rejectionReason } : {}),
        });
      }
      // approved → issue a session token bound to the device we created
      // at register/finish.
      const devices = deps.users.listDevices(user.id);
      const device = devices[0];
      if (!device) {
        return reply.code(500).send({ error: "no_device_for_user" });
      }
      const session = deps.sessions.create(user.id, device.id);
      return reply.send({
        status: "approved",
        sessionToken: session.token,
        expiresAt: session.expiresAt,
      });
    },
  );

  // --- POST /auth/opaque/login/start ---------------------------------------
  // Anti-enumeration: if the user is unknown we still run authInit against
  // a freshly-built fake record. The dummy challenge is stored so the
  // /finish call cannot tell the difference.
  app.post<{
    Body: { email: string; ke1: number[] };
  }>(
    "/auth/opaque/login/start",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "ke1"],
          properties: { email: EMAIL_SCHEMA, ke1: BYTES_ARRAY_SCHEMA },
          additionalProperties: false,
        } as any,
      },
    },
    async (req, reply) => {
      const emailHash = hmacEmail(req.body.email, deps.hmacKey);
      const ipHash = hmacIp(req.ip, deps.hmacKey);
      const user = deps.users.findByEmailHash(emailHash);

      const accountKey = user ? user.id : UNKNOWN_ACCOUNT_KEY;
      const rate = deps.rateLimit.check(accountKey, ipHash);
      if (!rate.allowed) {
        return reply
          .code(429)
          .header("Retry-After", Math.ceil(rate.retryAfterMs / 1000))
          .send({ error: "too_many_attempts" });
      }

      let record;
      let isDummy = false;
      if (user) {
        record = deps.opaque.deserializeRecord(user.opaqueRecord);
      } else {
        record = await deps.opaque.buildFakeRecord();
        isDummy = true;
      }

      try {
        const { ke2, expected } = await deps.opaque.authInit(
          req.body.ke1,
          record,
          emailHash.toString("hex"),
        );
        const challenge = deps.challenges.create(
          user ? user.id : null,
          deps.opaque.serializeExpected(expected),
          isDummy,
        );
        return reply.send({
          ke2,
          challengeToken: challenge.token,
          kdfParams: user?.kdfParams ?? defaultKdfParamsHint(),
        });
      } catch {
        return reply.code(400).send({ error: "invalid_request" });
      }
    },
  );

  // --- POST /auth/opaque/login/finish --------------------------------------
  app.post<{
    Body: {
      challengeToken: string;
      ke3: number[];
      devicePubkey: number[];
      deviceLabel?: string;
    };
  }>(
    "/auth/opaque/login/finish",
    {
      schema: {
        body: {
          type: "object",
          required: ["challengeToken", "ke3", "devicePubkey"],
          properties: {
            challengeToken: TOKEN_SCHEMA,
            ke3: BYTES_ARRAY_SCHEMA,
            devicePubkey: {
              type: "array",
              items: { type: "integer", minimum: 0, maximum: 255 },
              minItems: 32,
              maxItems: 32,
            },
            deviceLabel: LABEL_SCHEMA,
          },
          additionalProperties: false,
        } as any,
      },
    },
    async (req, reply) => {
      const ipHash = hmacIp(req.ip, deps.hmacKey);
      const challenge = deps.challenges.consume(req.body.challengeToken);
      if (!challenge) {
        // No leak: same error as a wrong password
        return reply.code(401).send({ error: "invalid_login" });
      }

      const accountKey = challenge.userId ?? UNKNOWN_ACCOUNT_KEY;

      // Even if the challenge was dummy, we MUST go through authFinish so
      // the response time matches the real case.
      let success = false;
      try {
        const expected = deps.opaque.deserializeExpected(challenge.expectedBlob);
        deps.opaque.authFinish(req.body.ke3, expected);
        success = !challenge.isDummy;
      } catch {
        success = false;
      }

      deps.rateLimit.record(accountKey, ipHash, success);

      if (!success || !challenge.userId) {
        deps.audit.log({
          userId: challenge.userId ?? null,
          action: "login_failure",
          ipHash,
        });
        return reply.code(401).send({ error: "invalid_login" });
      }

      // Approval gate: an existing user whose status is not 'approved'
      // cannot get a session, regardless of OPAQUE success.
      const userRow = deps.users.findById(challenge.userId);
      if (!userRow) return reply.code(401).send({ error: "invalid_login" });
      if (userRow.approvalStatus === "pending") {
        return reply.code(403).send({
          error: "pending_approval",
          userId: userRow.id.toString("hex"),
        });
      }
      if (userRow.approvalStatus === "rejected") {
        return reply.code(403).send({
          error: "rejected",
          ...(userRow.rejectionReason !== null ? { reason: userRow.rejectionReason } : {}),
        });
      }

      // Find-or-create the device by pubkey for this user.
      const pubkey = Buffer.from(req.body.devicePubkey);
      const devices = deps.users.listDevices(challenge.userId);
      let device = devices.find((d) => d.pubkey.equals(pubkey)) ?? null;
      if (!device) {
        device = deps.users.createDevice({
          userId: challenge.userId,
          pubkey,
          label: req.body.deviceLabel ?? null,
        });
      } else {
        deps.users.touchDevice(device.id);
      }

      const session = deps.sessions.create(challenge.userId, device.id);
      deps.audit.log({
        userId: challenge.userId,
        deviceId: device.id,
        action: "login_success",
        ipHash,
      });
      return reply.send({
        userId: challenge.userId.toString("hex"),
        deviceId: device.id.toString("hex"),
        sessionToken: session.token,
        expiresAt: session.expiresAt,
      });
    },
  );

  // --- POST /auth/logout ---------------------------------------------------
  app.post(
    "/auth/logout",
    { preHandler: auth },
    async (req, reply) => {
      const header = req.headers["authorization"];
      if (typeof header === "string" && header.startsWith("Bearer ")) {
        const token = header.slice("Bearer ".length).trim();
        deps.sessions.revoke(token);
      }
      deps.audit.log({
        userId: req.auth!.userId,
        deviceId: req.auth!.deviceId,
        action: "logout",
        ipHash: hmacIp(req.ip, deps.hmacKey),
      });
      return reply.send({ ok: true });
    },
  );

  // --- DELETE /account -----------------------------------------------------
  app.delete(
    "/account",
    { preHandler: auth },
    async (req, reply) => {
      const userId = req.auth!.userId;
      deps.audit.log({
        userId,
        action: "account_delete",
        ipHash: hmacIp(req.ip, deps.hmacKey),
      });
      deps.users.deleteUser(userId);
      // Sessions/devices cascade via FK.
      return reply.send({ ok: true });
    },
  );

  // --- GET /devices --------------------------------------------------------
  app.get(
    "/devices",
    { preHandler: auth },
    async (req, reply) => {
      const list = deps.users.listDevices(req.auth!.userId).map((d) => ({
        id: d.id.toString("hex"),
        label: d.label,
        createdAt: d.createdAt,
        lastSeenAt: d.lastSeenAt,
        current: d.id.equals(req.auth!.deviceId),
      }));
      return reply.send({ devices: list });
    },
  );

  // --- DELETE /devices/:id -------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    "/devices/:id",
    { preHandler: auth },
    async (req, reply) => {
      const id = req.params.id;
      if (!/^[0-9a-f]{32}$/.test(id)) {
        return reply.code(400).send({ error: "invalid_device_id" });
      }
      const deviceId = Buffer.from(id, "hex");
      const ok = deps.users.deleteDevice(req.auth!.userId, deviceId);
      if (ok) {
        deps.sessions.revokeAllForDevice(deviceId);
        deps.audit.log({
          userId: req.auth!.userId,
          deviceId,
          action: "device_revoke",
          ipHash: hmacIp(req.ip, deps.hmacKey),
        });
      }
      return reply.send({ ok });
    },
  );
}

/** Default KDF hint sent when no user matches — must look like a real one
 * but with stable params so we don't leak which emails exist. */
function defaultKdfParamsHint(): string {
  return JSON.stringify({
    algo: "argon2id",
    m: 65536,
    t: 3,
    p: 1,
    saltLen: 16,
  });
}

