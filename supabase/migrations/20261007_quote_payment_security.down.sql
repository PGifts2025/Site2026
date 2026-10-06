-- Down migration for 20261007_quote_payment_security.sql.
-- No BEGIN/COMMIT. Idempotent. Ends with a verifying SELECT.
--
-- Restores the pre-migration state: RLS off on quotes / quote_items, the
-- original role-`public` policies (incl. the single "Quote items follow quote
-- access" ALL policy), no DELETE policy on quotes, authenticated UPDATE grants,
-- and the SECURITY INVOKER recompute_quote_total. Containment 1b (no anon
-- access) and the TRUNCATE revokes are deliberately kept (CLAUDE.md §62).
--
-- NOTE: dropping quote_items.supplier_product_id discards the Laltex product
-- keys written since the up migration (the same code is still in `notes`).
-- Redeploy the previous frontend and create-checkout-session alongside this
-- (see CLAUDE.md §16.10 rollback).

-- 9. RLS off again on quotes / quote_items; original quotes policies (role
--    public). Anon grants stay revoked (containment 1b, CLAUDE.md §62).
ALTER TABLE public.quotes      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own quotes" ON public.quotes;
DROP POLICY IF EXISTS "Users create quotes" ON public.quotes;
DROP POLICY IF EXISTS "Users update own quotes" ON public.quotes;
CREATE POLICY "Users view own quotes" ON public.quotes
  FOR SELECT USING ((auth.uid() = customer_id) OR is_admin(auth.uid()));
CREATE POLICY "Users create quotes" ON public.quotes
  FOR INSERT WITH CHECK (auth.uid() = customer_id);
CREATE POLICY "Users update own quotes" ON public.quotes
  FOR UPDATE USING ((auth.uid() = customer_id) OR is_admin(auth.uid()));

-- RPCs
DROP FUNCTION IF EXISTS public.combine_quotes(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.set_quote_item_quantity(uuid, integer);

-- quote_items policies + grants
DROP POLICY IF EXISTS "Quote items readable by quote owner or admin" ON public.quote_items;
DROP POLICY IF EXISTS "Quote items insertable into own draft quote" ON public.quote_items;
DROP POLICY IF EXISTS "Quote items deletable from own draft quote" ON public.quote_items;
DROP POLICY IF EXISTS "Quote items follow quote access" ON public.quote_items;
CREATE POLICY "Quote items follow quote access" ON public.quote_items
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.quotes
    WHERE quotes.id = quote_items.quote_id
      AND (quotes.customer_id = auth.uid() OR is_admin(auth.uid()))
  ));
GRANT UPDATE ON public.quote_items TO authenticated;  -- anon stays revoked (§62)

-- quotes policies + grants
DROP POLICY IF EXISTS "Users delete own draft quotes" ON public.quotes;
DROP TRIGGER IF EXISTS quotes_client_insert_defaults ON public.quotes;
DROP FUNCTION IF EXISTS public.quotes_client_insert_defaults();
REVOKE UPDATE (shipping_address, po_number, notes) ON public.quotes FROM authenticated;
GRANT UPDATE ON public.quotes TO authenticated;  -- anon stays revoked (§62)

-- Server-side pricing trigger
DROP TRIGGER IF EXISTS quote_items_server_price ON public.quote_items;
DROP FUNCTION IF EXISTS public.quote_items_server_price();

-- Original recompute_quote_total (SECURITY INVOKER, NEW-or-OLD quote only)
CREATE OR REPLACE FUNCTION public.recompute_quote_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  v_quote_id uuid;
BEGIN
  v_quote_id := COALESCE(NEW.quote_id, OLD.quote_id);

  UPDATE public.quotes q
  SET subtotal     = COALESCE(agg.net, 0),
      tax_amount   = COALESCE(agg.vat, 0),
      total_amount = COALESCE(agg.net, 0) + COALESCE(agg.vat, 0),
      updated_at   = now()
  FROM (
    SELECT
      SUM(quantity * unit_price) AS net,
      SUM(line_vat)              AS vat
    FROM public.quote_items
    WHERE quote_id = v_quote_id
  ) agg
  WHERE q.id = v_quote_id
    AND q.status != 'converted';

  RETURN NULL;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.recompute_quote_total() TO PUBLIC;

-- Laltex product key column + helper
ALTER TABLE public.quote_items DROP COLUMN IF EXISTS supplier_product_id;
DROP FUNCTION IF EXISTS public.is_tier_priced_product(uuid);

-- Verify: expect 1 quote_items policy (ALL), 0 DELETE policies on quotes,
-- recompute_quote_total not SECURITY DEFINER, no supplier_product_id column,
-- and RLS off on quotes / quote_items.
SELECT
  (SELECT count(*) FROM pg_policies WHERE tablename = 'quote_items')                          AS quote_items_policies,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'quotes' AND cmd = 'DELETE')            AS quotes_delete_policies,
  (SELECT prosecdef FROM pg_proc WHERE proname = 'recompute_quote_total')                     AS recompute_is_definer,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'quote_items' AND column_name = 'supplier_product_id')                AS supplier_product_id_cols,
  (SELECT bool_or(relrowsecurity) FROM pg_class WHERE relname IN ('quotes', 'quote_items'))   AS any_rls_on;
