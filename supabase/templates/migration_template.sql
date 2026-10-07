-- =============================================================================
-- MIGRATION TEMPLATE — copy to supabase/migrations/YYYYMMDD_<what>.sql
-- (and migration_template.down.sql to YYYYMMDD_<what>.down.sql).
-- Rules: CLAUDE.md §64. Delete these instructions from your copy.
--
--  * Every new table enables RLS and defines its policies IN THIS FILE.
--    (The rls_auto_enable event trigger turns RLS on anyway, but a table with
--    no policies is deny-all and fails `npm run security:check` check 2.)
--  * Policies that call is_admin() are scoped TO authenticated (anon cannot
--    execute it). Admin = is_admin(auth.uid()) — never user metadata.
--  * Grants are explicit: revoke what clients don't need. No client TRUNCATE.
--  * SECURITY DEFINER functions: SET search_path, REVOKE EXECUTE FROM PUBLIC,
--    anon, then GRANT only to the role that needs it; take identity from
--    auth.uid(), never from a parameter.
--  * Money: prices/totals are computed or verified server-side.
--  * Apply via SQL Editor BEFORE merging (§52); run security:check; paste both
--    the verify output and the security:check table into the PR body.
-- =============================================================================

BEGIN;

-- 1. Table ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.example_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.example_items ENABLE ROW LEVEL SECURITY;

-- 2. Grants (least privilege) -------------------------------------------------
REVOKE ALL ON public.example_items FROM anon;                 -- no anonymous access
REVOKE TRUNCATE ON public.example_items FROM authenticated;   -- TRUNCATE bypasses RLS
-- GRANT SELECT ON public.example_items TO anon;              -- only for genuinely public data

-- 3. Policies ------------------------------------------------------------------
CREATE POLICY "Owners read own example_items" ON public.example_items
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Owners create own example_items" ON public.example_items
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owners update own example_items" ON public.example_items
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Admins manage example_items" ON public.example_items
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 4. Functions (if any) ---------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.example_rpc(p_id uuid)
-- RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- BEGIN
--   IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in.' USING ERRCODE = 'P0001'; END IF;
--   ...
-- END $$;
-- REVOKE EXECUTE ON FUNCTION public.example_rpc(uuid) FROM PUBLIC, anon;
-- GRANT EXECUTE ON FUNCTION public.example_rpc(uuid) TO authenticated;

COMMIT;

-- 5. Verify (paste into the PR body) -------------------------------------------
SELECT c.relname, c.relrowsecurity AS rls,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select
  FROM pg_class c
 WHERE c.oid = 'public.example_items'::regclass;
-- expect: rls = true, policies >= 1, anon_select = false (unless public by design)
