/**
 * Repository for the encrypted event log and snapshots.
 *
 * Per-user, events are strictly ordered by `server_seq` (a global
 * AUTOINCREMENT). The server never inspects ciphertexts; it only enforces
 * size limits, ownership, and ordering.
 */
import type { Database } from "better-sqlite3";

import { newUuidV7 } from "../crypto/ids.js";

const MAX_EVENT_BYTES = 64 * 1024;       // 64 KB per event
const MAX_SNAPSHOT_BYTES = 1024 * 1024;  // 1 MB per snapshot

export class PayloadTooLargeError extends Error {
  constructor(public limit: number) {
    super(`payload exceeds ${limit} bytes`);
  }
}

export interface EventRow {
  serverSeq: number;
  userId: Buffer;
  deviceId: Buffer;
  lamport: number;
  ciphertext: Buffer;
  nonce: Buffer;
  signature: Buffer | null;
  sizeBytes: number;
  createdAt: number;
}

export interface SnapshotRow {
  id: Buffer;
  userId: Buffer;
  deviceId: Buffer;
  upToSeq: number;
  ciphertext: Buffer;
  nonce: Buffer;
  signature: Buffer | null;
  sizeBytes: number;
  createdAt: number;
}

export interface SyncRepo {
  appendEvent(args: {
    userId: Buffer;
    deviceId: Buffer;
    lamport: number;
    ciphertext: Buffer;
    nonce: Buffer;
    signature: Buffer | null;
  }): EventRow;

  listEvents(userId: Buffer, sinceSeq: number, limit: number): EventRow[];

  latestSeq(userId: Buffer): number;

  putSnapshot(args: {
    userId: Buffer;
    deviceId: Buffer;
    upToSeq: number;
    ciphertext: Buffer;
    nonce: Buffer;
    signature: Buffer | null;
  }): SnapshotRow;

  latestSnapshot(userId: Buffer): SnapshotRow | null;

  /** Delete events with server_seq <= upToSeq for the user. Returns count. */
  compactEvents(userId: Buffer, upToSeq: number): number;
}

export function createSyncRepo(db: Database): SyncRepo {
  const stmtInsertEvent = db.prepare(
    "INSERT INTO events (user_id, device_id, lamport, ciphertext, nonce, signature, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const stmtListEvents = db.prepare(
    "SELECT server_seq, user_id, device_id, lamport, ciphertext, nonce, signature, size_bytes, created_at FROM events WHERE user_id = ? AND server_seq > ? ORDER BY server_seq ASC LIMIT ?",
  );
  const stmtLatestSeq = db.prepare(
    "SELECT COALESCE(MAX(server_seq), 0) AS s FROM events WHERE user_id = ?",
  );
  const stmtInsertSnap = db.prepare(
    "INSERT INTO snapshots (id, user_id, device_id, up_to_seq, ciphertext, nonce, signature, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const stmtLatestSnap = db.prepare(
    "SELECT id, user_id, device_id, up_to_seq, ciphertext, nonce, signature, size_bytes, created_at FROM snapshots WHERE user_id = ? ORDER BY up_to_seq DESC LIMIT 1",
  );
  const stmtCompactEvents = db.prepare(
    "DELETE FROM events WHERE user_id = ? AND server_seq <= ?",
  );

  const mapEvent = (r: Record<string, unknown>): EventRow => ({
    serverSeq: r["server_seq"] as number,
    userId: r["user_id"] as Buffer,
    deviceId: r["device_id"] as Buffer,
    lamport: r["lamport"] as number,
    ciphertext: r["ciphertext"] as Buffer,
    nonce: r["nonce"] as Buffer,
    signature: (r["signature"] as Buffer | null) ?? null,
    sizeBytes: r["size_bytes"] as number,
    createdAt: r["created_at"] as number,
  });
  const mapSnap = (r: Record<string, unknown>): SnapshotRow => ({
    id: r["id"] as Buffer,
    userId: r["user_id"] as Buffer,
    deviceId: r["device_id"] as Buffer,
    upToSeq: r["up_to_seq"] as number,
    ciphertext: r["ciphertext"] as Buffer,
    nonce: r["nonce"] as Buffer,
    signature: (r["signature"] as Buffer | null) ?? null,
    sizeBytes: r["size_bytes"] as number,
    createdAt: r["created_at"] as number,
  });

  return {
    appendEvent({ userId, deviceId, lamport, ciphertext, nonce, signature }) {
      if (ciphertext.byteLength > MAX_EVENT_BYTES) {
        throw new PayloadTooLargeError(MAX_EVENT_BYTES);
      }
      const now = Date.now();
      const info = stmtInsertEvent.run(
        userId,
        deviceId,
        lamport,
        ciphertext,
        nonce,
        signature,
        ciphertext.byteLength,
        now,
      );
      return {
        serverSeq: Number(info.lastInsertRowid),
        userId,
        deviceId,
        lamport,
        ciphertext,
        nonce,
        signature,
        sizeBytes: ciphertext.byteLength,
        createdAt: now,
      };
    },

    listEvents(userId, sinceSeq, limit) {
      const rows = stmtListEvents.all(userId, sinceSeq, limit) as Record<string, unknown>[];
      return rows.map(mapEvent);
    },

    latestSeq(userId) {
      const r = stmtLatestSeq.get(userId) as { s: number };
      return r.s;
    },

    putSnapshot({ userId, deviceId, upToSeq, ciphertext, nonce, signature }) {
      if (ciphertext.byteLength > MAX_SNAPSHOT_BYTES) {
        throw new PayloadTooLargeError(MAX_SNAPSHOT_BYTES);
      }
      const id = newUuidV7();
      const now = Date.now();
      stmtInsertSnap.run(
        id,
        userId,
        deviceId,
        upToSeq,
        ciphertext,
        nonce,
        signature,
        ciphertext.byteLength,
        now,
      );
      return {
        id,
        userId,
        deviceId,
        upToSeq,
        ciphertext,
        nonce,
        signature,
        sizeBytes: ciphertext.byteLength,
        createdAt: now,
      };
    },

    latestSnapshot(userId) {
      const row = stmtLatestSnap.get(userId) as Record<string, unknown> | undefined;
      return row ? mapSnap(row) : null;
    },

    compactEvents(userId, upToSeq) {
      return stmtCompactEvents.run(userId, upToSeq).changes;
    },
  };
}

export const SYNC_LIMITS = {
  maxEventBytes: MAX_EVENT_BYTES,
  maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
};
