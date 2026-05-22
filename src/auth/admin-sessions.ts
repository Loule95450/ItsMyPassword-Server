/**
 * Admin session lifecycle. Mirrors auth/sessions.ts but writes to the
 * `admin_sessions` table so user sessions and admin sessions cannot be
 * confused.
 */
import type { Database } from "better-sqlite3";

import { generateToken, hashToken } from "../crypto/tokens.js";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AdminSessionRecord {
  adminId: Buffer;
  expiresAt: number;
}

export interface AdminSessionService {
  create(adminId: Buffer, ttlMs?: number): { token: string; expiresAt: number };
  resolve(token: string): AdminSessionRecord | null;
  revoke(token: string): boolean;
  purgeExpired(now?: number): number;
}

export function createAdminSessionService(db: Database): AdminSessionService {
  const stmtInsert = db.prepare(
    "INSERT INTO admin_sessions (token_hash, admin_id, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  );
  const stmtLookup = db.prepare(
    "SELECT admin_id, expires_at FROM admin_sessions WHERE token_hash = ?",
  );
  const stmtTouch = db.prepare(
    "UPDATE admin_sessions SET last_used_at = ? WHERE token_hash = ?",
  );
  const stmtDelete = db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?");
  const stmtPurge = db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?");

  return {
    create(adminId, ttlMs = DEFAULT_TTL_MS) {
      const token = generateToken();
      const now = Date.now();
      const expiresAt = now + ttlMs;
      stmtInsert.run(hashToken(token), adminId, now, now, expiresAt);
      return { token, expiresAt };
    },
    resolve(token) {
      const tokenHash = hashToken(token);
      const row = stmtLookup.get(tokenHash) as
        | { admin_id: Buffer; expires_at: number }
        | undefined;
      if (!row) return null;
      if (row.expires_at <= Date.now()) {
        stmtDelete.run(tokenHash);
        return null;
      }
      stmtTouch.run(Date.now(), tokenHash);
      return { adminId: row.admin_id, expiresAt: row.expires_at };
    },
    revoke(token) {
      return stmtDelete.run(hashToken(token)).changes > 0;
    },
    purgeExpired(now = Date.now()) {
      return stmtPurge.run(now - 0).changes;
    },
  };
}
