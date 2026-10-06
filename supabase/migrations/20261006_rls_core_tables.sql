-- =============================================================================
-- Enable RLS on 8 core tables (PR fix/rls-core-tables)
--
-- These tables were created with RLS DISABLED, so their policies were inert and
-- the anon/authenticated roles (i.e. anyone holding the public anon key, or any
-- self-registered account) could read and write every row. See CLAUDE.md §62.
--
-- Section 0 re-states the emergency containment applied directly to production
-- on 2026-10-06 (steps 1a-1d) so the repo matches the live database. It is
-- idempotent; re-running it on production is a no-op.
--
-- quotes / quote_items are NOT in this migration — they get RLS in
-- 20261007_quote_payment_security.sql (PR fix/quote-payment-security).
--
-- Apply via Supabase Dashboard -> SQL Editor BEFORE merging (CLAUDE.md §52).
-- Rollback: 20261006_rls_core_tables.down.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Containment 1a-1d, codified (already live; idempotent)
-- -----------------------------------------------------------------------------

-- 1a: no client writes to tables the browser never writes
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.catalog_print_pricing, public.profiles, public.uploads,
     public.visual_proofs, public.order_items
  FROM anon, authenticated;

-- 1b: no anonymous access to private tables (customer_profiles INSERT is
-- revoked in section 4 now that the sign-up trigger creates the row)
REVOKE ALL ON public.orders, public.order_items, public.quotes, public.quote_items,
              public.profiles, public.uploads, public.visual_proofs
  FROM anon;
REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.customer_profiles FROM anon;

-- 1c: admin check sourced from team_members, never from user-editable metadata
CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.user_id = $1
      AND tm.is_active
      AND tm.role IN ('super_admin', 'staff')
  );
$fn$;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;
REVOKE ALL ON public.team_members FROM anon;

DROP POLICY IF EXISTS "Admin write access to apparel colors" ON public.apparel_colors;
DROP POLICY IF EXISTS "Admins write apparel colors" ON public.apparel_colors;
CREATE POLICY "Admins write apparel colors" ON public.apparel_colors
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admin write access to product colors" ON public.product_template_colors;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.product_template_variants FROM anon;
DROP POLICY IF EXISTS "Allow public insert on product_template_variants" ON public.product_template_variants;
DROP POLICY IF EXISTS "Allow public update on product_template_variants" ON public.product_template_variants;
DROP POLICY IF EXISTS "Authenticated users can insert variants" ON public.product_template_variants;
DROP POLICY IF EXISTS "Authenticated users can update variants" ON public.product_template_variants;
DROP POLICY IF EXISTS "Authenticated users can delete variants" ON public.product_template_variants;
DROP POLICY IF EXISTS "Admins insert variants" ON public.product_template_variants;
DROP POLICY IF EXISTS "Admins update variants" ON public.product_template_variants;
DROP POLICY IF EXISTS "Admins delete variants" ON public.product_template_variants;
CREATE POLICY "Admins insert variants" ON public.product_template_variants
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins update variants" ON public.product_template_variants
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete variants" ON public.product_template_variants
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- 1d: design-thumbnail uploads are anonymous; cap size and type
UPDATE storage.buckets
   SET file_size_limit = 2097152,
       allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
 WHERE id = 'catalog-images';

-- TRUNCATE ignores RLS; clients never need it on any of these tables.
REVOKE TRUNCATE ON public.orders, public.order_items, public.customer_profiles,
                   public.profiles, public.uploads, public.visual_proofs,
                   public.catalog_print_pricing, public.user_designs
  FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. orders — customers read and lightly edit their own; admins manage all
-- -----------------------------------------------------------------------------
--  Reads : CustomerDashboard / CustomerOrders / CustomerOrderDetail (own),
--          ArtworkUploadModal via supabaseService (own), Admin* pages (all)
--  Writes: CustomerOrderDetail -> shipping_address, po_number (own)
--          supabaseService upload/delete artwork -> artwork_status (own)
--          AdminOrders -> deleted_at; AdminOrderDetail -> artwork_status, admin_notes
--          confirm_payment_atomic (INSERT) runs as service_role -> bypasses RLS

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own orders" ON public.orders;
CREATE POLICY "Users view own orders" ON public.orders
  FOR SELECT TO authenticated
  USING ((customer_id = auth.uid() AND deleted_at IS NULL) OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins manage orders" ON public.orders;
CREATE POLICY "Admins manage orders" ON public.orders
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Customers update own orders" ON public.orders;
CREATE POLICY "Customers update own orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (customer_id = auth.uid() AND deleted_at IS NULL)
  WITH CHECK (customer_id = auth.uid() AND deleted_at IS NULL);

-- Non-admin customers may only change delivery details and flip artwork_status
-- between the two customer-driven states. Everything else (amounts, status,
-- payment fields, admin_notes, customer_id ...) is admin/service-role only.
CREATE OR REPLACE FUNCTION public.orders_customer_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  allowed CONSTANT text[] := ARRAY['shipping_address', 'po_number', 'artwork_status', 'updated_at'];
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'You can only change the delivery address, PO number or artwork on an order.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.artwork_status IS DISTINCT FROM OLD.artwork_status
     AND NEW.artwork_status NOT IN ('pending_artwork', 'artwork_uploaded') THEN
    RAISE EXCEPTION 'Artwork status can only be set to pending or uploaded.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.orders_customer_update_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_customer_update_guard ON public.orders;
CREATE TRIGGER orders_customer_update_guard
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_customer_update_guard();

-- -----------------------------------------------------------------------------
-- 2. order_items — read-only for clients (written by confirm_payment_atomic)
-- -----------------------------------------------------------------------------
--  Reads : CustomerOrderDetail (own), AdminOrderDetail (all)

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Order items follow order access" ON public.order_items;
DROP POLICY IF EXISTS "Order items readable by order owner or admin" ON public.order_items;
CREATE POLICY "Order items readable by order owner or admin" ON public.order_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND ((o.customer_id = auth.uid() AND o.deleted_at IS NULL) OR public.is_admin(auth.uid()))
  ));

-- -----------------------------------------------------------------------------
-- 3. Unused by clients: profiles, uploads, visual_proofs — service_role only
-- -----------------------------------------------------------------------------

ALTER TABLE public.profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visual_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles, public.uploads, public.visual_proofs FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. customer_profiles — created by a trigger at sign-up, not by the browser
-- -----------------------------------------------------------------------------
--  Reads : CustomerQuotes / CustomerOrderDetail (own), Admin* pages (all)
--  Writes: previously AuthContext.signUp INSERT as anon (no session yet while
--          email confirmation is pending). Replaced by handle_new_customer_profile.

CREATE OR REPLACE FUNCTION public.handle_new_customer_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.customer_profiles (id, email, first_name, last_name, company_name, phone, created_at)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'first_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'last_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'company_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    now()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_customer_profile() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_customer_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_customer_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_customer_profile();

ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_profiles FROM anon;

DROP POLICY IF EXISTS "Users view own profile" ON public.customer_profiles;
CREATE POLICY "Users view own profile" ON public.customer_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Users update own profile" ON public.customer_profiles;
CREATE POLICY "Users update own profile" ON public.customer_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Kept for signed-in recovery of a missing profile; anon can no longer insert.
DROP POLICY IF EXISTS "Users insert own profile" ON public.customer_profiles;
CREATE POLICY "Users insert own profile" ON public.customer_profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- -----------------------------------------------------------------------------
-- 5. catalog_print_pricing — public price list, read-only
-- -----------------------------------------------------------------------------

ALTER TABLE public.catalog_print_pricing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read print pricing" ON public.catalog_print_pricing;
CREATE POLICY "Public read print pricing" ON public.catalog_print_pricing
  FOR SELECT TO anon, authenticated
  USING (true);

-- -----------------------------------------------------------------------------
-- 6. user_designs — owners by auth.uid(); guests by the x-design-session header
-- -----------------------------------------------------------------------------
--  Reads : CustomerDashboard / CustomerDesigns (own), supabaseService get/list
--          (own or guest session), quoteService via getUserDesign (own/guest)
--  Writes: Designer / DesignerV2 / supabaseService save+update+delete,
--          CustomerDesigns rename + duplicate (own or guest session)
--  Guest identity: localStorage design_session_id (crypto.randomUUID), sent by
--  supabaseService's client as `x-design-session` on /rest/v1 requests only.

-- The calling guest's design session, from the PostgREST request headers.
CREATE OR REPLACE FUNCTION public.guest_session_id()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT NULLIF(current_setting('request.headers', true)::json ->> 'x-design-session', '');
$$;
GRANT EXECUTE ON FUNCTION public.guest_session_id() TO anon, authenticated, service_role;

ALTER TABLE public.user_designs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners and guest sessions read designs" ON public.user_designs;
CREATE POLICY "Owners and guest sessions read designs" ON public.user_designs
  FOR SELECT TO anon, authenticated
  USING (
    (user_id IS NOT NULL AND user_id = auth.uid())
    OR (user_id IS NULL AND session_id IS NOT NULL AND session_id = public.guest_session_id())
  );

DROP POLICY IF EXISTS "Owners and guest sessions create designs" ON public.user_designs;
CREATE POLICY "Owners and guest sessions create designs" ON public.user_designs
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    (user_id IS NOT NULL AND user_id = auth.uid())
    OR (user_id IS NULL AND session_id IS NOT NULL AND session_id = public.guest_session_id())
  );

DROP POLICY IF EXISTS "Owners and guest sessions update designs" ON public.user_designs;
CREATE POLICY "Owners and guest sessions update designs" ON public.user_designs
  FOR UPDATE TO anon, authenticated
  USING (
    (user_id IS NOT NULL AND user_id = auth.uid())
    OR (user_id IS NULL AND session_id IS NOT NULL AND session_id = public.guest_session_id())
  )
  WITH CHECK (
    (user_id IS NOT NULL AND user_id = auth.uid())
    OR (user_id IS NULL AND session_id IS NOT NULL AND session_id = public.guest_session_id())
  );

DROP POLICY IF EXISTS "Owners and guest sessions delete designs" ON public.user_designs;
CREATE POLICY "Owners and guest sessions delete designs" ON public.user_designs
  FOR DELETE TO anon, authenticated
  USING (
    (user_id IS NOT NULL AND user_id = auth.uid())
    OR (user_id IS NULL AND session_id IS NOT NULL AND session_id = public.guest_session_id())
  );

DROP POLICY IF EXISTS "Admins read all designs" ON public.user_designs;
CREATE POLICY "Admins read all designs" ON public.user_designs
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- Claim the caller's guest designs on sign-in. The session comes from the
-- request header (same secret the guest already proves), never a parameter.
CREATE OR REPLACE FUNCTION public.claim_guest_designs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sid text := public.guest_session_id();
  v_n   integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in to save designs to your account.' USING ERRCODE = 'P0001';
  END IF;
  IF v_sid IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE user_designs
     SET user_id = v_uid, session_id = NULL, updated_at = now()
   WHERE user_id IS NULL
     AND session_id = v_sid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_guest_designs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_guest_designs() TO authenticated;

COMMIT;

-- Verify (paste results into the PR body, CLAUDE.md §52):
SELECT c.relname, c.relrowsecurity AS rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('orders','order_items','customer_profiles','profiles','uploads',
                     'visual_proofs','catalog_print_pricing','user_designs')
 ORDER BY 1;
-- expect: all 8 rows rls = true
