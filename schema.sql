-- 10 Pax — D1 schema.
-- Apply locally:  npm run db:local
-- Apply remotely: npm run db:remote

CREATE TABLE IF NOT EXISTS groups (
  id         TEXT PRIMARY KEY,
  name       TEXT    NOT NULL DEFAULT '',
  start      TEXT    NOT NULL,                                -- Monday, YYYY-MM-DD
  weeks      INTEGER NOT NULL CHECK (weeks BETWEEN 1 AND 8),
  pick_day   INTEGER,                                          -- day offset from start, or NULL
  pick_hour  INTEGER,                                          -- 10..21, or NULL
  owner_hash TEXT    NOT NULL,                                 -- SHA-256 of the organiser's token
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  group_id   TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  ord        INTEGER NOT NULL,
  claim_hash TEXT,                                             -- SHA-256 of this person's token, NULL until claimed
  PRIMARY KEY (group_id, id)
);

CREATE INDEX IF NOT EXISTS members_by_group ON members (group_id, ord);

CREATE TABLE IF NOT EXISTS answers (
  group_id   TEXT    NOT NULL,
  member_id  TEXT    NOT NULL,
  mask       TEXT    NOT NULL,                                 -- blocked-hours bitmask, decimal string
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, member_id)
);
