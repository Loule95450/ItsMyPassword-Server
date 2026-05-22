/**
 * Admin repository. Mirrors `users.ts` but for the single-admin model:
 * there is at most one row, created via the setup endpoint when the
 * table is empty.
 */
import type { Database } from "better-sqlite3";

import { newUuidV7 } from "../crypto/ids.js";

export interface AdminRow {
  id: Buffer;
  username: string;
  opaqueRecord: Buffer;
  createdAt: number;
  updatedAt: number;
}

export interface AdminRepo {
  count(): number;
  findByUsername(username: string): AdminRow | null;
  findById(id: Buffer): AdminRow | null;
  createAdmin(args: { username: string; opaqueRecord: Buffer }): AdminRow;
}

export function createAdminRepo(db: Database): AdminRepo {
  const stmtCount = db.prepare("SELECT COUNT(*) AS n FROM admins");
  const stmtFindByUsername = db.prepare(
    "SELECT id, username, opaque_record, created_at, updated_at FROM admins WHERE username = ?",
  );
  const stmtFindById = db.prepare(
    "SELECT id, username, opaque_record, created_at, updated_at FROM admins WHERE id = ?",
  );
  const stmtInsert = db.prepare(
    "INSERT INTO admins (id, username, opaque_record, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );

  const map = (r: Record<string, unknown>): AdminRow => ({
    id: r["id"] as Buffer,
    username: r["username"] as string,
    opaqueRecord: r["opaque_record"] as Buffer,
    createdAt: r["created_at"] as number,
    updatedAt: r["updated_at"] as number,
  });

  return {
    count() {
      return (stmtCount.get() as { n: number }).n;
    },
    findByUsername(username) {
      const row = stmtFindByUsername.get(username.trim().toLowerCase()) as
        | Record<string, unknown>
        | undefined;
      return row ? map(row) : null;
    },
    findById(id) {
      const row = stmtFindById.get(id) as Record<string, unknown> | undefined;
      return row ? map(row) : null;
    },
    createAdmin({ username, opaqueRecord }) {
      const id = newUuidV7();
      const now = Date.now();
      stmtInsert.run(id, username.trim().toLowerCase(), opaqueRecord, now, now);
      return {
        id,
        username: username.trim().toLowerCase(),
        opaqueRecord,
        createdAt: now,
        updatedAt: now,
      };
    },
  };
}
