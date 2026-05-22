-- 002_sync: append-only event log + snapshots for end-to-end-encrypted sync
--
-- All payloads are opaque (AES-GCM ciphertexts produced client-side).
-- `server_seq` is a global monotonic cursor per user, used for incremental
-- pulls. `lamport` + `device_id` provide the LWW tiebreaker the client
-- needs when replaying.

CREATE TABLE events (
  -- AUTOINCREMENT gives strictly-monotonic IDs even across deletes, which
  -- we rely on for cursor semantics.
  server_seq   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      BLOB NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id    BLOB NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  lamport      INTEGER NOT NULL,
  ciphertext   BLOB NOT NULL,        -- AES-GCM(EK, op)
  nonce        BLOB NOT NULL,        -- 12 bytes
  signature    BLOB,                 -- optional ed25519(device_priv, payload). NULL during M3 bootstrap.
  size_bytes   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_events_user_seq ON events(user_id, server_seq);

CREATE TABLE snapshots (
  id           BLOB PRIMARY KEY,     -- UUIDv7
  user_id      BLOB NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id    BLOB NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  up_to_seq    INTEGER NOT NULL,     -- includes all events with server_seq <= this
  ciphertext   BLOB NOT NULL,
  nonce        BLOB NOT NULL,
  signature    BLOB,
  size_bytes   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_snapshots_user_seq ON snapshots(user_id, up_to_seq DESC);
