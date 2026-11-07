-- Accounts and sync, migration 1 (design docs/design/accounts-and-sync.md section 2.4).
-- Additive only: it creates new tables and never touches google_pending or google_credentials.
-- The owner applies it before setting ACCOUNTS_ENABLED=1; the routes answer 503 notConfigured while version 1 is missing.
-- Every statement is idempotent, so a second run is a no-op.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS accounts (
  account_id      TEXT PRIMARY KEY,
  account_key     TEXT NOT NULL UNIQUE,
  created_at      INTEGER NOT NULL,
  consent_version INTEGER NOT NULL,
  consent_at      INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS identities (
  sub        TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  email      TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS sessions_by_account ON sessions (account_id);

CREATE TABLE IF NOT EXISTS auth_pending (
  state_hash      TEXT PRIMARY KEY,
  flow_hash       TEXT NOT NULL,
  verifier        TEXT NOT NULL,
  nonce           TEXT NOT NULL,
  consent_version INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
) STRICT;

-- One sealed row per account. The CHECK keeps a row under D1's 2 MB limit whatever the application does (S0).
CREATE TABLE IF NOT EXISTS plans (
  account_id TEXT PRIMARY KEY,
  epoch      INTEGER NOT NULL,
  revision   INTEGER NOT NULL,
  format     INTEGER NOT NULL,
  key_id     TEXT NOT NULL,
  payload    BLOB NOT NULL CHECK (length(payload) <= 1900000),
  updated_at INTEGER NOT NULL
) STRICT;

-- The invite-only beta (OD-1): the owner inserts a lowercase email; the first sign-in binds it to the account.
CREATE TABLE IF NOT EXISTS beta_access (
  email      TEXT PRIMARY KEY CHECK (email = lower(email)),
  account_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER IF NOT EXISTS beta_access_cap BEFORE INSERT ON beta_access
WHEN (SELECT count(*) FROM beta_access) >= 100
BEGIN
  SELECT RAISE(ABORT, 'beta is full: at most 100 people');
END;

-- OD-9: only the hash of a deleted Google identity, no personal data and no date.
CREATE TABLE IF NOT EXISTS deleted_accounts (
  account_key TEXT PRIMARY KEY
) STRICT;

INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, CAST(strftime('%s', 'now') AS INTEGER));
