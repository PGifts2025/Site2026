-- =============================================================================
-- Quote payment security (PR fix/quote-payment-security)
--
-- Before this migration a signed-in customer could write quotes.total_amount,
-- quotes.status and quote_items.unit_price directly via PostgREST, and
-- create-checkout-session charged quotes.total_amount as stored. This:
--
--   1. Prices tier-priced catalog lines server-side (BEFORE INSERT/UPDATE
--      trigger) — the client's unit_price is ignored for those products.
--   2. Removes customer UPDATE on quote_items entirely and narrows customer
--      UPDATE on quotes to shipping_address / po_number / notes.
--   3. Moves the two legitimate client edit paths (quantity edit, combine
--      quotes) into SECURITY DEFINER RPCs that check ownership via auth.uid().
--   4. Makes recompute_quote_total SECURITY DEFINER so it can still maintain
--      the (now customer-read-only) total columns.
--   5. Adds the missing owner/draft DELETE policy on quotes.
--   6. Adds quote_items.supplier_product_id so Laltex lines carry a real
--      product key (price floor check in create-checkout-session).
--
-- Clothing, bag and Laltex unit prices are still client-computed at insert;
-- see CLAUDE.md §16.10 for what is and isn't verified server-side.
--
-- Also ENABLES RLS on quotes / quote_items (they were left off by
-- 20261006_rls_core_tables.sql pending this PR; CLAUDE.md §62.5).
-- Rollback: 20261007_quote_payment_security.down.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Helpers
-- -----------------------------------------------------------------------------

-- A product is "tier-priced" when its sell price is exactly a
-- catalog_pricing_tiers row: it has tiers and no print-matrix / bag-model rows.
CREATE OR REPLACE FUNCTION public.is_tier_priced_product(p_product_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM catalog_pricing_tiers t WHERE t.catalog_product_id = p_product_id)
     AND NOT EXISTS (SELECT 1 FROM catalog_print_pricing x WHERE x.catalog_product_id = p_product_id)
     AND NOT EXISTS (SELECT 1 FROM bag_print_pricing b WHERE b.catalog_product_id = p_product_id);
$$;

REVOKE EXECUTE ON FUNCTION public.is_tier_priced_product(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tier_priced_product(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Laltex product key on quote lines
-- -----------------------------------------------------------------------------

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS supplier_product_id uuid
  REFERENCES public.supplier_products(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.quote_items.supplier_product_id IS
  'supplier_products.id for Laltex lines (product_id is NULL for those). Used by create-checkout-session for the price-floor check.';

-- -----------------------------------------------------------------------------
-- 3. Server-side pricing for tier-priced catalog lines
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.quote_items_server_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_moq   integer;
  v_price numeric;
  v_name  text;
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW; -- Laltex line: priced client-side, floor-checked at checkout
  END IF;

  -- Catalog products are never zero-rated; VAT applies to the whole line.
  NEW.taxable_net_unit := NULL;

  IF NOT is_tier_priced_product(NEW.product_id) THEN
    RETURN NEW; -- clothing / bags: priced client-side, floor-checked at checkout
  END IF;

  SELECT min(t.min_quantity) INTO v_moq
  FROM catalog_pricing_tiers t
  WHERE t.catalog_product_id = NEW.product_id;

  IF NEW.quantity IS NULL OR NEW.quantity < v_moq THEN
    SELECT p.name INTO v_name FROM catalog_products p WHERE p.id = NEW.product_id;
    RAISE EXCEPTION 'Minimum order for % is % units.', v_name, to_char(v_moq, 'FM999,999,999')
      USING ERRCODE = 'P0001';
  END IF;

  -- Highest tier whose band contains the quantity.
  SELECT t.price_per_unit INTO v_price
  FROM catalog_pricing_tiers t
  WHERE t.catalog_product_id = NEW.product_id
    AND NEW.quantity >= t.min_quantity
    AND (t.max_quantity IS NULL OR NEW.quantity <= t.max_quantity)
  ORDER BY t.min_quantity DESC
  LIMIT 1;

  IF v_price IS NULL THEN
    SELECT p.name INTO v_name FROM catalog_products p WHERE p.id = NEW.product_id;
    RAISE EXCEPTION 'No price is available for % at % units. Please call us.', v_name, NEW.quantity
      USING ERRCODE = 'P0001';
  END IF;

  NEW.unit_price := v_price; -- the client's value is never trusted
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.quote_items_server_price() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS quote_items_server_price ON public.quote_items;
CREATE TRIGGER quote_items_server_price
  BEFORE INSERT OR UPDATE OF quantity, unit_price, product_id, taxable_net_unit
  ON public.quote_items
  FOR EACH ROW EXECUTE FUNCTION public.quote_items_server_price();

-- -----------------------------------------------------------------------------
-- 4. Total sync trigger: SECURITY DEFINER (customers can no longer write the
--    total columns), and recompute BOTH quotes when a line moves between them.
--    Keeps the §23 `status != 'converted'` guard.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recompute_quote_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote_id uuid;
BEGIN
  FOREACH v_quote_id IN ARRAY ARRAY(
    SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.quote_id END,
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.quote_id END
    ]) AS x WHERE x IS NOT NULL
  )
  LOOP
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
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_quote_total() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. quotes: customer writes limited to delivery details
-- -----------------------------------------------------------------------------

REVOKE UPDATE ON public.quotes FROM anon, authenticated;
GRANT UPDATE (shipping_address, po_number, notes) ON public.quotes TO authenticated;

-- Client-created quotes always start as an unpaid draft. total_amount is still
-- accepted at insert (§23 pre-insert pattern); the item trigger overwrites it
-- with the true value and create-checkout-session re-verifies it.
CREATE OR REPLACE FUNCTION public.quotes_client_insert_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.status            := 'draft';
    NEW.stripe_session_id := NULL;
    NEW.paid_at           := NULL;
    NEW.payment_amount    := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.quotes_client_insert_defaults() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS quotes_client_insert_defaults ON public.quotes;
CREATE TRIGGER quotes_client_insert_defaults
  BEFORE INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.quotes_client_insert_defaults();

DROP POLICY IF EXISTS "Users delete own draft quotes" ON public.quotes;
CREATE POLICY "Users delete own draft quotes" ON public.quotes
  FOR DELETE TO authenticated
  USING (customer_id = auth.uid() AND status = 'draft');

-- -----------------------------------------------------------------------------
-- 6. quote_items: replace the catch-all policy; no customer UPDATE at all
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Quote items follow quote access" ON public.quote_items;

CREATE POLICY "Quote items readable by quote owner or admin" ON public.quote_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_items.quote_id
      AND (q.customer_id = auth.uid() OR is_admin(auth.uid()))
  ));

CREATE POLICY "Quote items insertable into own draft quote" ON public.quote_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_items.quote_id
      AND q.customer_id = auth.uid()
      AND q.status = 'draft'
  ));

CREATE POLICY "Quote items deletable from own draft quote" ON public.quote_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_items.quote_id
      AND q.customer_id = auth.uid()
      AND q.status = 'draft'
  ));

REVOKE UPDATE ON public.quote_items FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. RPC: change a line's quantity (tier-priced products only)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_quote_item_quantity(p_item_id uuid, p_quantity integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_product_id uuid;
  v_owner      uuid;
  v_status     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in to change this quote.' USING ERRCODE = 'P0001';
  END IF;

  SELECT qi.product_id, q.customer_id, q.status
    INTO v_product_id, v_owner, v_status
  FROM quote_items qi
  JOIN quotes q ON q.id = qi.quote_id
  WHERE qi.id = p_item_id
  FOR UPDATE OF q;

  IF NOT FOUND OR v_owner IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Quote item not found.' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'This quote can no longer be changed.' USING ERRCODE = 'P0001';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'Enter a quantity of at least 1.' USING ERRCODE = 'P0001';
  END IF;
  IF v_product_id IS NULL OR NOT is_tier_priced_product(v_product_id) THEN
    RAISE EXCEPTION 'Change quantity on the product page.' USING ERRCODE = 'P0001';
  END IF;

  -- quote_items_server_price enforces the MOQ and sets unit_price;
  -- recompute_quote_total then refreshes the quote totals.
  UPDATE quote_items SET quantity = p_quantity WHERE id = p_item_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_quote_item_quantity(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_quote_item_quantity(uuid, integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. RPC: combine draft quotes into one
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.combine_quotes(p_target_id uuid, p_other_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_ids    uuid[];
  v_ok     integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in to combine quotes.' USING ERRCODE = 'P0001';
  END IF;

  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(p_other_ids) AS x WHERE x IS NOT NULL AND x <> p_target_id);
  IF p_target_id IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'Choose at least two quotes to combine.' USING ERRCODE = 'P0001';
  END IF;

  -- Lock every involved quote and require all to be the caller's drafts.
  SELECT count(*) INTO v_ok
  FROM (
    SELECT 1 FROM quotes q
    WHERE q.id = ANY (v_ids || p_target_id)
      AND q.customer_id = v_uid
      AND q.status = 'draft'
    FOR UPDATE
  ) locked;

  IF v_ok <> cardinality(v_ids) + 1 THEN
    RAISE EXCEPTION 'Only your own unpaid quotes can be combined.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE quote_items SET quote_id = p_target_id WHERE quote_id = ANY (v_ids);
  DELETE FROM quotes WHERE id = ANY (v_ids);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.combine_quotes(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.combine_quotes(uuid, uuid[]) TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. Enable RLS on quotes / quote_items (CLAUDE.md §62)
-- -----------------------------------------------------------------------------
--  quotes reads : HeaderBar count, CustomerDashboard, CustomerQuotes (own); no
--                 admin page reads quotes directly (orders carry the data).
--  quotes writes: INSERT own (3 add-to-quote paths), UPDATE own delivery
--                 fields (column grants above), DELETE own drafts, and the
--                 SECURITY DEFINER trigger / RPCs. Payment fields are written
--                 by confirm_payment_atomic as service_role.
--  Existing policies were role `public` and call is_admin(), which anon can't
--  execute — re-scope them to authenticated (§62.2).

DROP POLICY IF EXISTS "Users view own quotes" ON public.quotes;
CREATE POLICY "Users view own quotes" ON public.quotes
  FOR SELECT TO authenticated
  USING (customer_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Users create quotes" ON public.quotes;
CREATE POLICY "Users create quotes" ON public.quotes
  FOR INSERT TO authenticated
  WITH CHECK (customer_id = auth.uid());

DROP POLICY IF EXISTS "Users update own quotes" ON public.quotes;
CREATE POLICY "Users update own quotes" ON public.quotes
  FOR UPDATE TO authenticated
  USING (customer_id = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (customer_id = auth.uid() OR public.is_admin(auth.uid()));

REVOKE ALL ON public.quotes, public.quote_items FROM anon;
REVOKE TRUNCATE ON public.quotes, public.quote_items FROM authenticated;

ALTER TABLE public.quotes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Verify (paste results into the PR body, CLAUDE.md §52):
SELECT c.relname, c.relrowsecurity AS rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname IN ('quotes', 'quote_items')
UNION ALL
SELECT 'fn:' || proname, prosecdef FROM pg_proc
 WHERE proname IN ('set_quote_item_quantity', 'combine_quotes', 'quote_items_server_price',
                   'recompute_quote_total', 'is_tier_priced_product')
ORDER BY 1;
-- expect: quotes / quote_items rls = true; all five functions present
--         (quote_items_server_price, recompute_quote_total, the RPCs and the helper are SECURITY DEFINER = true)
