-- Down migration for 20261007_security_guardrails.sql.
-- No BEGIN/COMMIT. Idempotent. Ends with a verifying SELECT.
--
-- Removes the event trigger and the security_check role. The TRUNCATE revokes
-- are deliberately NOT restored: TRUNCATE bypasses RLS and no client needs it
-- (CLAUDE.md §62.2). Remove the SECURITY_CHECK_DATABASE_URL GitHub secret too.

DROP EVENT TRIGGER IF EXISTS rls_auto_enable;
DROP FUNCTION IF EXISTS public.rls_auto_enable();
DROP FUNCTION IF EXISTS public.security_check_buckets();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'security_check') THEN
    REVOKE CONNECT ON DATABASE postgres FROM security_check;
    DROP ROLE security_check;
  END IF;
END $$;

-- Verify: expect 0 and 0.
SELECT (SELECT count(*) FROM pg_event_trigger WHERE evtname = 'rls_auto_enable') AS event_triggers,
       (SELECT count(*) FROM pg_roles WHERE rolname = 'security_check')        AS security_check_roles;
