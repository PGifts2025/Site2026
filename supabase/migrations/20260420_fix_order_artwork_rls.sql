-- order_artwork: enable RLS and install correct policies.
-- Migration 011 defined policies but none of them survive in production
-- (pg_class.relrowsecurity = false, pg_policies returns 0 rows). Also, the
-- original admin policy used raw_user_meta_data->>'is_admin' which never
-- matches in this project — admin detection uses the team_members table
-- via the is_admin(uuid) helper.

-- 1. Enable row-level security.
ALTER TABLE public.order_artwork ENABLE ROW LEVEL SECURITY;

-- 2. Drop any leftover policies from earlier attempts (idempotent).
DROP POLICY IF EXISTS "Customers can view own artwork"    ON public.order_artwork;
DROP POLICY IF EXISTS "Customers can upload artwork"      ON public.order_artwork;
DROP POLICY IF EXISTS "Customers can delete own artwork"  ON public.order_artwork;
DROP POLICY IF EXISTS "Admins full access to artwork"     ON public.order_artwork;

-- 3. Customer policies — scoped to their own rows via user_id = auth.uid().
CREATE POLICY "Customers can insert own artwork"
  ON public.order_artwork
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Customers can read own artwork"
  ON public.order_artwork
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Customers can delete own artwork"
  ON public.order_artwork
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 4. Admin policies — use the is_admin(uuid) helper (team_members-backed).
CREATE POLICY "Admins can read all artwork"
  ON public.order_artwork
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update artwork"
  ON public.order_artwork
  FOR UPDATE
  TO authenticated
  USING      (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete any artwork"
  ON public.order_artwork
  FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));
