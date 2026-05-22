-- 003: introduce a single admin (OPAQUE-authenticated) and gate user
-- registration behind admin approval.
--
-- - `admins` mirrors `users` but with a separate credential namespace
--   prefix ("admin:") in the OPAQUE credential_identifier so a user and
--   an admin with the same username can never collide.
-- - `admin_sessions` mirrors `sessions` for the admin web UI.
-- - `users.approval_status` is one of 'pending' | 'approved' | 'rejected'.
--   New registrations start in 'pending' and cannot login until
--   approved. Approved users stay approved across new-device logins
--   (those are not "registrations" per OPAQUE).
-- - `users.rejection_reason` is shown to the user on login when the
--   admin actively rejects them. Optional.

CREATE TABLE admins (
  id            BLOB PRIMARY KEY,            -- UUIDv7
  username      TEXT NOT NULL UNIQUE,        -- the admin picked it at setup
  opaque_record BLOB NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
) STRICT;

CREATE TABLE admin_sessions (
  token_hash   BLOB PRIMARY KEY,            -- SHA-256(session_token)
  admin_id     BLOB NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE admin_login_challenges (
  token_hash    BLOB PRIMARY KEY,
  admin_id      BLOB,                       -- NULL for dummy (anti-enum)
  is_dummy      INTEGER NOT NULL,
  expected_blob BLOB NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
) STRICT;
CREATE INDEX idx_admin_login_challenges_expiry ON admin_login_challenges(expires_at);

-- Approval-status migration on the existing `users` table.
-- SQLite ALTER TABLE only supports ADD COLUMN; we set the default to
-- 'approved' on backfill so existing accounts are not retroactively
-- locked out, and switch the default for new rows to 'pending' at the
-- application layer (the schema cannot conditionally default by age).
ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE users ADD COLUMN approval_decided_at INTEGER;
ALTER TABLE users ADD COLUMN approval_decided_by BLOB REFERENCES admins(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN rejection_reason TEXT;

CREATE INDEX idx_users_approval ON users(approval_status, created_at DESC);
