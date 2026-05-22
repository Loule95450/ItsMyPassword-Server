/**
 * User / device repository. Email is never stored in clear; we key by
 * `email_hash` (HMAC under the server-side key, computed at the edge).
 */
import type { Database } from "better-sqlite3";

import { newUuidV7 } from "../crypto/ids.js";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface UserRow {
  id: Buffer;
  emailHash: Buffer;
  opaqueRecord: Buffer;
  kdfParams: string;
  createdAt: number;
  updatedAt: number;
  approvalStatus: ApprovalStatus;
  approvalDecidedAt: number | null;
  approvalDecidedBy: Buffer | null;
  rejectionReason: string | null;
}

export interface PendingUserRow {
  id: Buffer;
  emailHash: Buffer;
  createdAt: number;
}

export interface UserListEntry {
  id: Buffer;
  emailHash: Buffer;
  createdAt: number;
  approvalStatus: ApprovalStatus;
  approvalDecidedAt: number | null;
  rejectionReason: string | null;
  lastSeenAt: number | null;
}

export type UserListFilter = "all" | ApprovalStatus;

export interface DeviceRow {
  id: Buffer;
  userId: Buffer;
  pubkey: Buffer;
  label: string | null;
  createdAt: number;
  lastSeenAt: number;
}

export interface UserRepo {
  findByEmailHash(emailHash: Buffer): UserRow | null;
  findById(id: Buffer): UserRow | null;
  createUserAndDevice(args: {
    emailHash: Buffer;
    opaqueRecord: Buffer;
    kdfParams: string;
    devicePubkey: Buffer;
    deviceLabel: string | null;
    approvalStatus?: ApprovalStatus;
  }): { user: UserRow; device: DeviceRow };
  listPending(limit?: number): PendingUserRow[];
  listUsers(filter: UserListFilter, limit?: number, offset?: number): UserListEntry[];
  countUsers(filter: UserListFilter): number;
  setApprovalStatus(args: {
    userId: Buffer;
    status: ApprovalStatus;
    decidedBy: Buffer;
    reason?: string;
  }): UserRow | null;
  createDevice(args: {
    userId: Buffer;
    pubkey: Buffer;
    label: string | null;
  }): DeviceRow;
  listDevices(userId: Buffer): DeviceRow[];
  deleteDevice(userId: Buffer, deviceId: Buffer): boolean;
  deleteUser(userId: Buffer): boolean;
  touchDevice(deviceId: Buffer): void;
}

export function createUserRepo(db: Database): UserRepo {
  const userCols =
    "id, email_hash, opaque_record, kdf_params, created_at, updated_at, approval_status, approval_decided_at, approval_decided_by, rejection_reason";
  const stmtFindByEmail = db.prepare(
    `SELECT ${userCols} FROM users WHERE email_hash = ?`,
  );
  const stmtFindById = db.prepare(`SELECT ${userCols} FROM users WHERE id = ?`);
  const stmtInsertUser = db.prepare(
    "INSERT INTO users (id, email_hash, opaque_record, kdf_params, created_at, updated_at, approval_status) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const stmtListPending = db.prepare(
    "SELECT id, email_hash, created_at FROM users WHERE approval_status = 'pending' ORDER BY created_at ASC LIMIT ?",
  );
  // listUsers joins on devices to get the last activity per user. The
  // GROUP BY keeps one row per user; MAX(...) collapses the multi-device
  // case to the most recent.
  const userListCols =
    "u.id, u.email_hash, u.created_at, u.approval_status, u.approval_decided_at, u.rejection_reason, MAX(d.last_seen_at) AS last_seen_at";
  const stmtListAll = db.prepare(
    `SELECT ${userListCols} FROM users u LEFT JOIN devices d ON d.user_id = u.id GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
  );
  const stmtListFiltered = db.prepare(
    `SELECT ${userListCols} FROM users u LEFT JOIN devices d ON d.user_id = u.id WHERE u.approval_status = ? GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
  );
  const stmtCountAll = db.prepare("SELECT COUNT(*) AS n FROM users");
  const stmtCountFiltered = db.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE approval_status = ?",
  );
  const stmtSetApproval = db.prepare(
    "UPDATE users SET approval_status = ?, approval_decided_at = ?, approval_decided_by = ?, rejection_reason = ?, updated_at = ? WHERE id = ?",
  );
  const stmtInsertDevice = db.prepare(
    "INSERT INTO devices (id, user_id, pubkey, label, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const stmtListDevices = db.prepare(
    "SELECT id, user_id, pubkey, label, created_at, last_seen_at FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC",
  );
  const stmtDeleteDevice = db.prepare(
    "DELETE FROM devices WHERE id = ? AND user_id = ?",
  );
  const stmtDeleteUser = db.prepare("DELETE FROM users WHERE id = ?");
  const stmtTouchDevice = db.prepare(
    "UPDATE devices SET last_seen_at = ? WHERE id = ?",
  );

  const mapUser = (r: Record<string, unknown>): UserRow => ({
    id: r["id"] as Buffer,
    emailHash: r["email_hash"] as Buffer,
    opaqueRecord: r["opaque_record"] as Buffer,
    kdfParams: r["kdf_params"] as string,
    createdAt: r["created_at"] as number,
    updatedAt: r["updated_at"] as number,
    approvalStatus: (r["approval_status"] as ApprovalStatus) ?? "approved",
    approvalDecidedAt: (r["approval_decided_at"] as number | null) ?? null,
    approvalDecidedBy: (r["approval_decided_by"] as Buffer | null) ?? null,
    rejectionReason: (r["rejection_reason"] as string | null) ?? null,
  });
  const mapDevice = (r: Record<string, unknown>): DeviceRow => ({
    id: r["id"] as Buffer,
    userId: r["user_id"] as Buffer,
    pubkey: r["pubkey"] as Buffer,
    label: (r["label"] as string | null) ?? null,
    createdAt: r["created_at"] as number,
    lastSeenAt: r["last_seen_at"] as number,
  });

  return {
    findByEmailHash(emailHash) {
      const row = stmtFindByEmail.get(emailHash) as Record<string, unknown> | undefined;
      return row ? mapUser(row) : null;
    },
    findById(id) {
      const row = stmtFindById.get(id) as Record<string, unknown> | undefined;
      return row ? mapUser(row) : null;
    },
    createUserAndDevice({
      emailHash,
      opaqueRecord,
      kdfParams,
      devicePubkey,
      deviceLabel,
      approvalStatus,
    }) {
      const userId = newUuidV7();
      const deviceId = newUuidV7();
      const now = Date.now();
      const status: ApprovalStatus = approvalStatus ?? "pending";
      const tx = db.transaction(() => {
        stmtInsertUser.run(userId, emailHash, opaqueRecord, kdfParams, now, now, status);
        stmtInsertDevice.run(deviceId, userId, devicePubkey, deviceLabel, now, now);
      });
      tx();
      return {
        user: {
          id: userId,
          emailHash,
          opaqueRecord,
          kdfParams,
          createdAt: now,
          updatedAt: now,
          approvalStatus: status,
          approvalDecidedAt: null,
          approvalDecidedBy: null,
          rejectionReason: null,
        },
        device: {
          id: deviceId,
          userId,
          pubkey: devicePubkey,
          label: deviceLabel,
          createdAt: now,
          lastSeenAt: now,
        },
      };
    },
    listPending(limit = 100) {
      const rows = stmtListPending.all(limit) as Record<string, unknown>[];
      return rows.map((r) => ({
        id: r["id"] as Buffer,
        emailHash: r["email_hash"] as Buffer,
        createdAt: r["created_at"] as number,
      }));
    },
    listUsers(filter, limit = 100, offset = 0) {
      const rows =
        filter === "all"
          ? (stmtListAll.all(limit, offset) as Record<string, unknown>[])
          : (stmtListFiltered.all(filter, limit, offset) as Record<string, unknown>[]);
      return rows.map(
        (r): UserListEntry => ({
          id: r["id"] as Buffer,
          emailHash: r["email_hash"] as Buffer,
          createdAt: r["created_at"] as number,
          approvalStatus: r["approval_status"] as ApprovalStatus,
          approvalDecidedAt: (r["approval_decided_at"] as number | null) ?? null,
          rejectionReason: (r["rejection_reason"] as string | null) ?? null,
          lastSeenAt: (r["last_seen_at"] as number | null) ?? null,
        }),
      );
    },
    countUsers(filter) {
      const row =
        filter === "all"
          ? (stmtCountAll.get() as { n: number })
          : (stmtCountFiltered.get(filter) as { n: number });
      return row.n;
    },
    setApprovalStatus({ userId, status, decidedBy, reason }) {
      const now = Date.now();
      const res = stmtSetApproval.run(
        status,
        now,
        decidedBy,
        reason ?? null,
        now,
        userId,
      );
      if (res.changes === 0) return null;
      const row = stmtFindById.get(userId) as Record<string, unknown> | undefined;
      return row ? mapUser(row) : null;
    },
    createDevice({ userId, pubkey, label }) {
      const id = newUuidV7();
      const now = Date.now();
      stmtInsertDevice.run(id, userId, pubkey, label, now, now);
      return { id, userId, pubkey, label, createdAt: now, lastSeenAt: now };
    },
    listDevices(userId) {
      const rows = stmtListDevices.all(userId) as Record<string, unknown>[];
      return rows.map(mapDevice);
    },
    deleteDevice(userId, deviceId) {
      return stmtDeleteDevice.run(deviceId, userId).changes > 0;
    },
    deleteUser(userId) {
      return stmtDeleteUser.run(userId).changes > 0;
    },
    touchDevice(deviceId) {
      stmtTouchDevice.run(Date.now(), deviceId);
    },
  };
}
