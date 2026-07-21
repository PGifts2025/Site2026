-- ============================================================================
-- VAT schema — FORWARD FIX for 20260719_vat_flat20_with_kids_exception.sql
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS:
--   The 20260719 migration reported "success" in the Supabase SQL Editor but
--   only its DELETE (test-data wipe) took effect. The column additions and the
--   two function replacements were discarded. Verified live 2026-07-20:
--     * orders / quote_items / order_items = 0 rows (wipe committed), BUT
--     * taxable_net_unit / line_vat exist NOWHERE, and
--     * recompute_quote_total / confirm_payment_atomic are still their OLD
--       bodies (no tax_amount / no taxable_net_unit).
--   That is impossible for a single atomic BEGIN..COMMIT, so the editor did not
--   honor the explicit transaction end-to-end. The SQL was correct (the exact
--   ALTER + generated column applies cleanly on a clone); the wrapper was the
--   problem: a DELETE block + DDL + $$-quoted function bodies inside one
--   explicit transaction.
--
-- WHAT CHANGED HERE (so it can't happen again):
--   * NO explicit BEGIN/COMMIT. Each statement autocommits on its own.
--   * Every statement is IDEMPOTENT (ADD COLUMN IF NOT EXISTS / CREATE OR
--     REPLACE), so re-running is always safe.
--   * NO destructive DELETE. The wipe already happened; this only adds schema
--     and replaces functions.
--   * Ends with a SELECT that RETURNS the 6 columns, so a green run visibly
--     shows the columns rather than "Success. No rows returned."
--
-- DEPLOY (CLAUDE.md §52): Dave pastes this whole file into Supabase Dashboard
--   -> SQL Editor -> Run. The final SELECT must return 6 rows. THEN redeploy
--   main on Vercel (the merged frontend needs these columns).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. quotes: net + VAT snapshot columns (total_amount already exists).
-- ---------------------------------------------------------------------------
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS subtotal   numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS tax_amount numeric(10,2) NOT NULL DEFAULT 0;

-- orders.subtotal / tax_amount / total_amount already exist.

-- ---------------------------------------------------------------------------
-- 2. quote_items: taxable_net_unit first, THEN the generated line_vat that
--    references it. Separate statements (not one multi-ADD ALTER) so the
--    reference is unambiguous.
-- ---------------------------------------------------------------------------
ALTER TABLE public.quote_items ADD COLUMN IF NOT EXISTS taxable_net_unit numeric(10,4);
ALTER TABLE public.quote_items ADD COLUMN IF NOT EXISTS line_vat numeric(10,2)
  GENERATED ALWAYS AS (round(round(quantity * COALESCE(taxable_net_unit, unit_price), 2) * 0.20, 2)) STORED;

-- ---------------------------------------------------------------------------
-- 3. order_items: same pair.
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS taxable_net_unit numeric(10,4);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS line_vat numeric(10,2)
  GENERATED ALWAYS AS (round(round(quantity * COALESCE(taxable_net_unit, unit_price), 2) * 0.20, 2)) STORED;

-- ---------------------------------------------------------------------------
-- 4. recompute_quote_total — VAT-aware. Rolls net + generated line_vat into
--    subtotal / tax_amount / total_amount(gross). line_vat regenerates on a
--    quantity edit BEFORE this AFTER trigger reads it, so VAT survives the
--    recompute. status != 'converted' guard preserved (payment locked).
--    Tagged dollar-quote ($fn$) for unambiguous parsing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_quote_total()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
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
$fn$;

-- Triggers already attached to quote_items (INSERT/UPDATE/DELETE); CREATE OR
-- REPLACE keeps them pointed at the new body.

-- ---------------------------------------------------------------------------
-- 5. confirm_payment_atomic — snapshot VAT onto the order. Identical
--    signature/grants/idempotency to 20260520 (CLAUDE.md §17.7). Additions:
--    capture quote.subtotal/tax_amount, write them onto the order, copy
--    taxable_net_unit into order_items (order_items.line_vat is generated, so
--    it is NOT listed). orders.total_amount stays the charged amount.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_payment_atomic(
  p_quote_id           uuid,
  p_stripe_session_id  text,
  p_payment_intent_id  text,
  p_payment_amount     numeric
) RETURNS uuid
  LANGUAGE plpgsql
AS $fn$
DECLARE
  v_customer_id      uuid;
  v_order_id         uuid;
  v_shipping_address jsonb;
  v_po_number        text;
  v_subtotal         numeric;
  v_tax_amount       numeric;
BEGIN
  SELECT customer_id, shipping_address, po_number, subtotal, tax_amount
    INTO v_customer_id, v_shipping_address, v_po_number, v_subtotal, v_tax_amount
    FROM public.quotes
   WHERE id = p_quote_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found: %', p_quote_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_order_id
    FROM public.orders
   WHERE stripe_session_id = p_stripe_session_id
   LIMIT 1;

  IF v_order_id IS NOT NULL THEN
    RETURN v_order_id;
  END IF;

  UPDATE public.quotes
     SET status            = 'converted',
         stripe_session_id = p_stripe_session_id,
         paid_at           = COALESCE(paid_at, now()),
         payment_amount    = p_payment_amount
   WHERE id = p_quote_id;

  INSERT INTO public.orders (
    quote_id,
    customer_id,
    status,
    payment_status,
    artwork_status,
    stripe_session_id,
    payment_intent_id,
    total_amount,
    subtotal,
    tax_amount,
    shipping_address,
    po_number
  ) VALUES (
    p_quote_id,
    v_customer_id,
    'confirmed',
    'paid',
    'pending_artwork',
    p_stripe_session_id,
    p_payment_intent_id,
    p_payment_amount,
    COALESCE(v_subtotal, 0),
    COALESCE(v_tax_amount, 0),
    v_shipping_address,
    v_po_number
  )
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id,
    product_id,
    product_name,
    quantity,
    unit_price,
    line_total,
    taxable_net_unit,
    color,
    design_data,
    design_thumbnail,
    print_areas,
    notes
  )
  SELECT
    v_order_id,
    qi.product_id,
    qi.product_name,
    qi.quantity,
    qi.unit_price,
    ROUND(qi.quantity * qi.unit_price, 2),
    qi.taxable_net_unit,
    qi.color,
    qi.design_data,
    qi.design_thumbnail,
    qi.print_areas,
    qi.notes
  FROM public.quote_items qi
  WHERE qi.quote_id = p_quote_id;

  RETURN v_order_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.confirm_payment_atomic(uuid, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_payment_atomic(uuid, text, text, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_atomic(uuid, text, text, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Optional cleanup: the broken deploy created orphan draft quotes with no
--    items (the quote row inserted, then the quote_items insert errored on the
--    missing column). All test data. Uncomment to remove them:
-- DELETE FROM public.quotes q
--  WHERE q.status = 'draft'
--    AND NOT EXISTS (SELECT 1 FROM public.quote_items qi WHERE qi.quote_id = q.id);

-- ---------------------------------------------------------------------------
-- 7. PROOF — this SELECT must return exactly 6 rows. If your run shows
--    "Success. No rows returned", the columns did NOT land and something is
--    wrong; do not redeploy.
-- ---------------------------------------------------------------------------
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ( (table_name = 'quotes'      AND column_name IN ('subtotal', 'tax_amount'))
     OR (table_name IN ('quote_items', 'order_items')
         AND column_name IN ('taxable_net_unit', 'line_vat')) )
ORDER BY table_name, column_name;
