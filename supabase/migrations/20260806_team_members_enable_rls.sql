-- 20260806_team_members_enable_rls.sql
-- Enable RLS on team_members. It was left DISABLED, so its two policies were
-- inert (audit-admin-roles-and-access.md §1.4).
--
-- SAFETY: AdminGuard reads this table on EVERY admin page load, filtering to the
-- caller's own row (user_id = auth.uid()). If enabling RLS blocked that read, ALL
-- admins lock out at once. To make that impossible, this migration DROPs and
-- re-CREATEs the two policies to their exact known-good definitions BEFORE relying
-- on them, then enables RLS:
--   * "Users read own record"  SELECT  auth.uid() = user_id
--       -> lets each admin read their OWN row (the AdminGuard lookup). Always works
--          for a signed-in admin whose team_members.user_id is set.
--   * "Admins full access"     ALL     is_admin(auth.uid())
--       -> lets an admin (is_admin metadata flag) read ALL rows (the Team page) and
--          manage the table.
-- Dave's row + metadata already satisfy both, so his access is unaffected.
--
-- ROLLBACK if anything goes wrong (run in SQL Editor):
--     ALTER TABLE public.team_members DISABLE ROW LEVEL SECURITY;
--
-- Idempotent. No BEGIN/COMMIT. Verifying SELECTs at the end.

-- 1. Guarantee the read policies exist and are correct (DROP IF EXISTS + CREATE).
DROP POLICY IF EXISTS "Users read own record" ON public.team_members;
CREATE POLICY "Users read own record"
  ON public.team_members
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins full access" ON public.team_members;
CREATE POLICY "Admins full access"
  ON public.team_members
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 2. Now enable RLS (the policies above are in place, so no admin loses their read).
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

-- 3. Verify.
SELECT relname, relrowsecurity AS rls_enabled
  FROM pg_class WHERE relname = 'team_members';
  -- expect: team_members | t

SELECT policyname, cmd, roles, qual, with_check
  FROM pg_policies WHERE tablename = 'team_members'
 ORDER BY policyname;
  -- expect: "Admins full access" ALL is_admin(auth.uid()); "Users read own record" SELECT auth.uid() = user_id

-- 4. Proof the AdminGuard read still resolves for each admin's OWN row: every
--    active admin row has a non-null user_id, so "Users read own record" matches.
SELECT email, role, is_active, (user_id IS NOT NULL) AS user_id_set
  FROM public.team_members
 WHERE is_active = true
 ORDER BY email;
  -- expect: every row user_id_set = true (else that admin cannot read their row post-RLS)
