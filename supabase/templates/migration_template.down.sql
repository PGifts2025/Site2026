-- DOWN TEMPLATE — copy to supabase/migrations/YYYYMMDD_<what>.down.sql.
-- No BEGIN/COMMIT. Idempotent (IF EXISTS everywhere). Ends with a verifying SELECT.
-- A rollback must never re-open access that a security fix closed (CLAUDE.md §62).

DROP POLICY IF EXISTS "Admins manage example_items"     ON public.example_items;
DROP POLICY IF EXISTS "Owners update own example_items" ON public.example_items;
DROP POLICY IF EXISTS "Owners create own example_items" ON public.example_items;
DROP POLICY IF EXISTS "Owners read own example_items"   ON public.example_items;
DROP TABLE IF EXISTS public.example_items;
-- DROP FUNCTION IF EXISTS public.example_rpc(uuid);

-- Verify: expect 0.
SELECT count(*) AS remaining FROM pg_class WHERE oid = to_regclass('public.example_items');
