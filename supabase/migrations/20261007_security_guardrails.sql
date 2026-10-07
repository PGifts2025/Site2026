-- =============================================================================
-- Security guardrails (PR fix/security-guardrails) — CLAUDE.md §64
--
-- 1. rls_auto_enable event trigger: any table created in `public` — by
--    CREATE TABLE, CREATE TABLE AS or SELECT INTO, from a migration, the SQL
--    Editor or the dashboard Table Editor — gets ROW LEVEL SECURITY enabled
--    and loses client TRUNCATE in the same statement. With RLS on and no
--    policy, a forgotten table is locked (deny-all), never open (§62.1).
-- 2. Client TRUNCATE revoked on every existing public table (it bypasses RLS)
--    and from postgres's default privileges for future tables.
-- 3. security_check: a read-only LOGIN role for `npm run security:check` in
--    GitHub Actions. NO PASSWORD here — it is set out of band
--    (ALTER ROLE security_check PASSWORD '...') and stored only as the
--    SECURITY_CHECK_DATABASE_URL GitHub secret. It can read the system
--    catalogues and storage.buckets, nothing else; sessions are read-only.
--
-- Apply via Supabase Dashboard -> SQL Editor BEFORE merging (§52).
-- Rollback: 20261007_security_guardrails.down.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. RLS on by default for new public tables
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type = 'table'
      AND schema_name = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', cmd.object_identity);
    EXECUTE format('REVOKE TRUNCATE ON %s FROM anon, authenticated', cmd.object_identity);
    RAISE NOTICE 'rls_auto_enable: RLS enabled on % — add policies in the same migration (CLAUDE.md §64)', cmd.object_identity;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

DROP EVENT TRIGGER IF EXISTS rls_auto_enable;
CREATE EVENT TRIGGER rls_auto_enable
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();

-- -----------------------------------------------------------------------------
-- 2. No client TRUNCATE anywhere in public
-- -----------------------------------------------------------------------------

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS rel
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON %s FROM anon, authenticated', t.rel);
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Read-only role for the CI security check
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'security_check') THEN
    CREATE ROLE security_check WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

ALTER ROLE security_check SET default_transaction_read_only = on;
ALTER ROLE security_check SET statement_timeout = '30s';
GRANT CONNECT ON DATABASE postgres TO security_check;
-- pg_catalog (pg_class, pg_policy/pg_policies, pg_proc, pg_event_trigger,
-- has_*_privilege()) is readable by every role; nothing else is granted.
-- storage.buckets has its own RLS (no policy for this role), so bucket limits
-- are exposed through a narrow definer function instead: ids + limits only,
-- executable by security_check alone.
CREATE OR REPLACE FUNCTION public.security_check_buckets()
RETURNS TABLE (id text, public boolean, file_size_limit bigint, allowed_mime_types text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT b.id, b.public, b.file_size_limit, b.allowed_mime_types FROM storage.buckets b;
$$;
REVOKE EXECUTE ON FUNCTION public.security_check_buckets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_check_buckets() TO security_check;

COMMIT;

-- Verify (paste into the PR body, §52):
SELECT 'event_trigger' AS item, evtname || ' enabled=' || evtenabled::text AS state FROM pg_event_trigger WHERE evtname = 'rls_auto_enable'
UNION ALL
SELECT 'truncate_grants', count(*)::text FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
   AND (has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('authenticated', c.oid, 'TRUNCATE'))
UNION ALL
SELECT 'security_check_role', rolname || ' login=' || rolcanlogin || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls
  FROM pg_roles WHERE rolname = 'security_check';
-- expect: rls_auto_enable enabled=O · truncate_grants 0 · security_check login=true super=false bypassrls=false
