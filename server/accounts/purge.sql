-- Rollback purge for accounts and sync (design 2.4). Run only after ACCOUNTS_ENABLED was removed and the routes were
-- observed answering 404, and 60 s later. Keep this order: sessions first so nobody stays signed in, then pending rows so
-- no sign-in can complete, then everything else. S1b tables (google_pending, google_credentials) are never touched.
-- Afterwards delete SYNC_KEY (DEPLOYMENT.md): D1 Time Travel keeps restorable ciphertexts up to 30 days.
DELETE FROM sessions;
DELETE FROM auth_pending;
DELETE FROM plans;
DELETE FROM beta_access;
DELETE FROM identities;
DELETE FROM accounts;
DELETE FROM deleted_accounts;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS auth_pending;
DROP TABLE IF EXISTS plans;
DROP TRIGGER IF EXISTS beta_access_cap;
DROP TABLE IF EXISTS beta_access;
DROP TABLE IF EXISTS identities;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS deleted_accounts;
DROP TABLE IF EXISTS schema_migrations;
