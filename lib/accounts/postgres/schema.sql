-- Orari accounts. Not applied anywhere yet: no database has been chosen or connected.
-- Timestamps are fixed-width UTC ISO-8601 text (2026-10-14T10:00:00.000Z), so string comparison is time order
-- and values round-trip exactly as the in-memory repository holds them.

CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    data          JSONB NOT NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    last_seen_at TEXT NOT NULL,
    data         JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS tokens (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at    TEXT,
    UNIQUE (purpose, token_hash)
);

CREATE TABLE IF NOT EXISTS outbox (
    id              TEXT PRIMARY KEY,
    user_id         TEXT,
    created_at      TEXT NOT NULL,
    next_attempt_at TEXT NOT NULL,
    lease_until     TEXT,
    failed_at       TEXT,
    data            JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox(next_attempt_at) WHERE failed_at IS NULL;

CREATE TABLE IF NOT EXISTS plans (
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id       TEXT NOT NULL,
    revision INTEGER NOT NULL,
    data     JSONB NOT NULL,
    PRIMARY KEY (user_id, id)
);

-- A deleted plan id is retired for good: a plan recreated under it would restart its revisions
-- and let an old operation apply again.
CREATE TABLE IF NOT EXISTS retired_plans (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL,
    PRIMARY KEY (user_id, plan_id)
);
