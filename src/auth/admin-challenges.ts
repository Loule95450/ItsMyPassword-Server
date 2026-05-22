/**
 * Admin login challenges. Same shape as auth/challenges.ts but stored
 * in the admin_login_challenges table.
 */
import type { Database } from "better-sqlite3";

import { generateToken, hashToken } from "../crypto/tokens.js";

const CHALLENGE_TTL_MS = 2 * 60 * 1000;

export interface AdminChallengeRecord {
  adminId: Buffer | null;
  isDummy: boolean;
  expectedBlob: Buffer;
}

export interface AdminChallengeService {
  create(
    adminId: Buffer | null,
    expectedBlob: Buffer,
    isDummy: boolean,
  ): { token: string; expiresAt: number };
  consume(token: string): AdminChallengeRecord | null;
  purgeExpired(now?: number): number;
}

export function createAdminChallengeService(db: Database): AdminChallengeService {
  const stmtInsert = db.prepare(
    "INSERT INTO admin_login_challenges (token_hash, admin_id, is_dummy, expected_blob, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const stmtLookup = db.prepare(
    "SELECT admin_id, is_dummy, expected_blob, expires_at FROM admin_login_challenges WHERE token_hash = ?",
  );
  const stmtDelete = db.prepare("DELETE FROM admin_login_challenges WHERE token_hash = ?");
  const stmtPurge = db.prepare("DELETE FROM admin_login_challenges WHERE expires_at <= ?");

  return {
    create(adminId, expectedBlob, isDummy) {
      const token = generateToken();
      const now = Date.now();
      const expiresAt = now + CHALLENGE_TTL_MS;
      stmtInsert.run(
        hashToken(token),
        adminId,
        isDummy ? 1 : 0,
        expectedBlob,
        now,
        expiresAt,
      );
      return { token, expiresAt };
    },
    consume(token) {
      const tokenHash = hashToken(token);
      const row = stmtLookup.get(tokenHash) as
        | {
            admin_id: Buffer | null;
            is_dummy: number;
            expected_blob: Buffer;
            expires_at: number;
          }
        | undefined;
      stmtDelete.run(tokenHash);
      if (!row) return null;
      if (row.expires_at <= Date.now()) return null;
      return {
        adminId: row.admin_id,
        isDummy: row.is_dummy === 1,
        expectedBlob: row.expected_blob,
      };
    },
    purgeExpired(now = Date.now()) {
      return stmtPurge.run(now).changes;
    },
  };
}
