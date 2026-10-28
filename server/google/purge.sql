-- Rollback purge (design §7.2). Run only after `disabled` has been observed, and 60 s later. Keep this order:
-- a credential is only ever inserted from a pending row, so once pending rows are gone nothing can recreate one.
DELETE FROM google_pending;
DELETE FROM google_credentials;
SELECT (SELECT count(*) FROM google_pending) AS pending, (SELECT count(*) FROM google_credentials) AS credentials;
