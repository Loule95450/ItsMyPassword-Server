/**
 * Sync endpoints. Everything is bytes-in, bytes-out from the server's
 * perspective. Authorization is mandatory; ownership scoping is enforced
 * by always filtering by `req.auth.userId`.
 */
import type { FastifyInstance } from "fastify";

import { bearerAuth } from "../middleware/auth.js";
import type { SessionService } from "../auth/sessions.js";
import { PayloadTooLargeError, SYNC_LIMITS, type SyncRepo } from "../store/sync.js";

export interface SyncDeps {
  sync: SyncRepo;
  sessions: SessionService;
}

const BYTES = {
  type: "array",
  items: { type: "integer", minimum: 0, maximum: 255 },
} as const;

// JSON Schemas are passed as untyped objects to Fastify.
const cast = (s: object): object => s;

const MAX_EVENT_LIST = 200;

export async function syncRoutes(app: FastifyInstance, deps: SyncDeps): Promise<void> {
  const auth = bearerAuth(deps.sessions);
  // Run auth before body/query validation so unauthenticated callers
  // can't probe schema details.
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/events") || req.url.startsWith("/snapshots")) {
      await auth(req, reply);
    }
  });

  // --- GET /events?since=<seq>&limit=<n> -----------------------------------
  app.get<{
    Querystring: { since?: string; limit?: string };
  }>(
    "/events",
    {
      schema: {
        querystring: cast({
          type: "object",
          properties: {
            since: { type: "string", pattern: "^[0-9]+$" },
            limit: { type: "string", pattern: "^[0-9]+$" },
          },
          additionalProperties: false,
        }),
      },
    },
    async (req, reply) => {
      const userId = req.auth!.userId;
      const since = req.query.since ? Number.parseInt(req.query.since, 10) : 0;
      const limit = Math.min(
        MAX_EVENT_LIST,
        req.query.limit ? Number.parseInt(req.query.limit, 10) : 100,
      );
      const rows = deps.sync.listEvents(userId, since, limit);
      const events = rows.map((e) => ({
        serverSeq: e.serverSeq,
        deviceId: e.deviceId.toString("hex"),
        lamport: e.lamport,
        ciphertext: Array.from(e.ciphertext),
        nonce: Array.from(e.nonce),
        signature: e.signature ? Array.from(e.signature) : null,
        createdAt: e.createdAt,
      }));
      const nextCursor = events.length > 0 ? events[events.length - 1]!.serverSeq : since;
      const hasMore = events.length === limit;
      return reply.send({ events, nextCursor, hasMore });
    },
  );

  // --- POST /events --------------------------------------------------------
  app.post<{
    Body: {
      lamport: number;
      ciphertext: number[];
      nonce: number[];
      signature?: number[];
    };
  }>(
    "/events",
    {
      schema: {
        body: cast({
          type: "object",
          required: ["lamport", "ciphertext", "nonce"],
          properties: {
            lamport: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
            ciphertext: { ...BYTES, maxItems: SYNC_LIMITS.maxEventBytes },
            nonce: { ...BYTES, minItems: 12, maxItems: 24 },
            signature: { ...BYTES, minItems: 64, maxItems: 64 },
          },
          additionalProperties: false,
        }),
      },
    },
    async (req, reply) => {
      try {
        const row = deps.sync.appendEvent({
          userId: req.auth!.userId,
          deviceId: req.auth!.deviceId,
          lamport: req.body.lamport,
          ciphertext: Buffer.from(req.body.ciphertext),
          nonce: Buffer.from(req.body.nonce),
          signature: req.body.signature ? Buffer.from(req.body.signature) : null,
        });
        return reply.send({
          serverSeq: row.serverSeq,
          acceptedAt: row.createdAt,
        });
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          return reply.code(413).send({ error: "payload_too_large", limit: err.limit });
        }
        throw err;
      }
    },
  );

  // --- GET /snapshots/latest -----------------------------------------------
  app.get("/snapshots/latest", async (req, reply) => {
    const snap = deps.sync.latestSnapshot(req.auth!.userId);
    if (!snap) {
      return reply.code(204).send();
    }
    return reply.send({
      id: snap.id.toString("hex"),
      upToSeq: snap.upToSeq,
      ciphertext: Array.from(snap.ciphertext),
      nonce: Array.from(snap.nonce),
      signature: snap.signature ? Array.from(snap.signature) : null,
      createdAt: snap.createdAt,
    });
  });

  // --- POST /snapshots -----------------------------------------------------
  // A successful snapshot also compacts the event log up to `upToSeq` —
  // single-device mode, simplest correct behavior. Multi-device compaction
  // (waiting for ACK from all devices) lands later.
  app.post<{
    Body: {
      upToSeq: number;
      ciphertext: number[];
      nonce: number[];
      signature?: number[];
    };
  }>(
    "/snapshots",
    {
      schema: {
        body: cast({
          type: "object",
          required: ["upToSeq", "ciphertext", "nonce"],
          properties: {
            upToSeq: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
            ciphertext: { ...BYTES, maxItems: SYNC_LIMITS.maxSnapshotBytes },
            nonce: { ...BYTES, minItems: 12, maxItems: 24 },
            signature: { ...BYTES, minItems: 64, maxItems: 64 },
          },
          additionalProperties: false,
        }),
      },
    },
    async (req, reply) => {
      const userId = req.auth!.userId;
      const latest = deps.sync.latestSeq(userId);
      if (req.body.upToSeq > latest) {
        return reply.code(400).send({
          error: "snapshot_ahead_of_log",
          latestSeq: latest,
        });
      }
      try {
        const snap = deps.sync.putSnapshot({
          userId,
          deviceId: req.auth!.deviceId,
          upToSeq: req.body.upToSeq,
          ciphertext: Buffer.from(req.body.ciphertext),
          nonce: Buffer.from(req.body.nonce),
          signature: req.body.signature ? Buffer.from(req.body.signature) : null,
        });
        const compacted = deps.sync.compactEvents(userId, req.body.upToSeq);
        return reply.send({
          snapshotId: snap.id.toString("hex"),
          compactedEvents: compacted,
        });
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          return reply.code(413).send({ error: "payload_too_large", limit: err.limit });
        }
        throw err;
      }
    },
  );
}
