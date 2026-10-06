-- Down migration for 20261006_rls_core_tables.sql.
-- No BEGIN/COMMIT. Idempotent. Ends with a verifying SELECT.
--
-- Reverts sections 1-6 only, back to the post-containment state of
-- 2026-10-06. Section 0 (containment 1a-1d) is deliberately NOT reverted:
-- rolling back this PR must never re-open the anon read/write exposure or the
-- self-grantable admin flag. Containment reversals, if ever needed, are in
-- CLAUDE.md §62.4.
--
-- Pair with redeploying the previous frontend (sign-up profile INSERT and no
-- x-design-session header) — anon INSERT on customer_profiles is restored
-- below for that path.

-- 6. user_designs
DROP FUNCTION IF EXISTS public.claim_guest_designs();
DROP POLICY IF EXISTS "Owners and guest sessions read designs"   ON public.user_designs;
DROP POLICY IF EXISTS "Owners and guest sessions create designs" ON public.user_designs;
DROP POLICY IF EXISTS "Owners and guest sessions update designs" ON public.user_designs;
DROP POLICY IF EXISTS "Owners and guest sessions delete designs" ON public.user_designs;
DROP POLICY IF EXISTS "Admins read all designs"                  ON public.user_designs;
ALTER TABLE public.user_designs DISABLE ROW LEVEL SECURITY;
DROP FUNCTION IF EXISTS public.guest_session_id();

-- 5. catalog_print_pricing
DROP POLICY IF EXISTS "Public read print pricing" ON public.catalog_print_pricing;
ALTER TABLE public.catalog_print_pricing DISABLE ROW LEVEL SECURITY;

-- 4. customer_profiles (original policies, role public)
DROP TRIGGER IF EXISTS on_auth_user_created_customer_profile ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_customer_profile();
DROP POLICY IF EXISTS "Users view own profile"   ON public.customer_profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.customer_profiles;
DROP POLICY IF EXISTS "Users insert own profile" ON public.customer_profiles;
CREATE POLICY "Users view own profile" ON public.customer_profiles
  FOR SELECT USING ((auth.uid() = id) OR is_admin(auth.uid()));
CREATE POLICY "Users update own profile" ON public.customer_profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.customer_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);
ALTER TABLE public.customer_profiles DISABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.customer_profiles TO anon;  -- old frontend sign-up path

-- 3. profiles / uploads / visual_proofs (post-containment grants)
ALTER TABLE public.profiles      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploads       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.visual_proofs DISABLE ROW LEVEL SECURITY;
GRANT SELECT, REFERENCES, TRIGGER ON public.profiles, public.uploads, public.visual_proofs TO authenticated;

-- 2. order_items (original ALL policy, role public)
DROP POLICY IF EXISTS "Order items readable by order owner or admin" ON public.order_items;
DROP POLICY IF EXISTS "Order items follow order access" ON public.order_items;
CREATE POLICY "Order items follow order access" ON public.order_items
  FOR ALL USING (EXISTS (
    SELECT 1 FROM orders
    WHERE orders.id = order_items.order_id
      AND (orders.customer_id = auth.uid() OR is_admin(auth.uid()))
  ));
ALTER TABLE public.order_items DISABLE ROW LEVEL SECURITY;

-- 1. orders (original policies, role public)
DROP TRIGGER IF EXISTS orders_customer_update_guard ON public.orders;
DROP FUNCTION IF EXISTS public.orders_customer_update_guard();
DROP POLICY IF EXISTS "Customers update own orders" ON public.orders;
DROP POLICY IF EXISTS "Users view own orders" ON public.orders;
DROP POLICY IF EXISTS "Admins manage orders" ON public.orders;
CREATE POLICY "Users view own orders" ON public.orders
  FOR SELECT USING (((auth.uid() = customer_id) AND (deleted_at IS NULL)) OR is_admin(auth.uid()));
CREATE POLICY "Admins manage orders" ON public.orders
  FOR ALL USING (is_admin(auth.uid()));
ALTER TABLE public.orders DISABLE ROW LEVEL SECURITY;

-- TRUNCATE grants from section 0 are intentionally left revoked.

-- Verify: expect all 8 rls = false, and no claim_guest_designs / guest_session_id.
SELECT c.relname, c.relrowsecurity AS rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('orders','order_items','customer_profiles','profiles','uploads',
                     'visual_proofs','catalog_print_pricing','user_designs')
UNION ALL
SELECT 'fn:' || proname, true FROM pg_proc
 WHERE proname IN ('claim_guest_designs', 'guest_session_id', 'handle_new_customer_profile', 'orders_customer_update_guard')
ORDER BY 1;
