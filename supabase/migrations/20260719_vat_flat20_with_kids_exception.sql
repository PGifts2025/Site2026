-- ============================================================================
-- VAT: flat 20% with a children's-clothing carve-out  (PR A — backend only)
-- ----------------------------------------------------------------------------
-- WHAT (see audit-vat-implementation-gap.md):
--   Prices are stored/displayed NET. This adds 20% VAT at the quote/order
--   rollup so customers are charged gross and Dave stops absorbing 20% out of
--   margin. ONE exception: three children's products are zero-rated on the
--   PRODUCT cost; their print/setup/delivery services stay standard-rated.
--
-- HOW (minimal, code-agnostic):
--   * quote_items / order_items get `taxable_net_unit` (nullable). NULL means
--     "the whole unit_price is taxable" (standard products). For a zero-rated
--     line the frontend writes the SERVICES net-per-unit, so only that portion
--     is taxed. The 3-code list lives ONLY in src/utils/vat.js; this SQL never
--     names a product code.
--   * `line_vat` is a GENERATED column, so it auto-recomputes when a quantity
--     is edited (survives recompute_quote_total — the flagged trap).
--   * recompute_quote_total rolls per-line net + line_vat into
--     quotes.subtotal / tax_amount / total_amount(gross).
--   * confirm_payment_atomic snapshots those onto orders + copies
--     taxable_net_unit to order_items (line_vat regenerates there).
--
-- DEPLOY (CLAUDE.md §52): Dave pastes this whole file into Supabase Dashboard
--   -> SQL Editor -> Run -> confirm success, then run the verification queries
--   in the PR body, THEN merge the PR. Code alone does nothing.
--
-- DESTRUCTIVE: section 1 deletes ALL orders/quotes/etc. Dave has confirmed
--   these are test data. Customer ACCOUNTS are NOT touched here — see the PR
--   body for the account list and the commented options.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Test-data wipe (transactional rows only; child tables first)
-- ---------------------------------------------------------------------------
DELETE FROM public.order_artwork;
DELETE FROM public.order_status_history;
DELETE FROM public.order_items;
DELETE FROM public.orders;
DELETE FROM public.quote_items;
DELETE FROM public.quotes;

-- Customer accounts are intentionally NOT deleted in this migration. Deleting
-- them requires Dave to confirm which to keep (DO NOT auto-delete). After
-- reviewing the profile list in the PR body, Dave runs ONE of these separately:
--
--   -- OPTION A — keep only Dave's own accounts, delete the rest:
--   -- DELETE FROM public.customer_profiles
--   --  WHERE email NOT IN ('accounts@alpha-omegaltd.com','dave@sport-of-kings.com');
--
--   -- OPTION B — delete specific test accounts by email:
--   -- DELETE FROM public.customer_profiles WHERE email IN ('<test emails>');
--
-- Note: customer_profiles is the app profile row. The underlying auth.users
-- login is deleted separately via the Supabase Dashboard (Authentication ->
-- Users) or the admin API; a profile delete does not remove the login.

-- ---------------------------------------------------------------------------
-- 2. Schema
-- ---------------------------------------------------------------------------
-- 2a. quotes: net + VAT snapshot columns (total_amount already exists).
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS subtotal   numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount numeric(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.quotes.subtotal   IS 'Net (ex-VAT) total. Maintained by recompute_quote_total.';
COMMENT ON COLUMN public.quotes.tax_amount IS 'VAT total. Maintained by recompute_quote_total. total_amount = subtotal + tax_amount (gross).';

-- orders.subtotal / tax_amount / total_amount already exist (all currently 0).
-- confirm_payment_atomic populates them from the quote snapshot below.

-- 2b. quote_items: taxable_net_unit + generated line_vat.
--     taxable_net_unit is added first because line_vat references it.
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS taxable_net_unit numeric(10,4);
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS line_vat numeric(10,2)
    GENERATED ALWAYS AS (round(round(quantity * COALESCE(taxable_net_unit, unit_price), 2) * 0.20, 2)) STORED;

COMMENT ON COLUMN public.quote_items.taxable_net_unit IS
  'Per-unit NET that VAT (20%) applies to. NULL = the whole unit_price is taxable (standard products). For a zero-rated product the frontend writes the services-only net per unit (print + delivery), so the product/garment portion is untaxed. Only src/utils/vat.js ZERO_RATED_PRODUCT_CODES decides when this is set.';
COMMENT ON COLUMN public.quote_items.line_vat IS
  'Generated: round(round(quantity * COALESCE(taxable_net_unit, unit_price), 2) * 0.20, 2). Auto-recomputes on quantity edits.';

-- 2c. order_items: same pair (line_vat snapshots the VAT at conversion).
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS taxable_net_unit numeric(10,4);
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS line_vat numeric(10,2)
    GENERATED ALWAYS AS (round(round(quantity * COALESCE(taxable_net_unit, unit_price), 2) * 0.20, 2)) STORED;

COMMENT ON COLUMN public.order_items.taxable_net_unit IS 'Copied from quote_items at conversion. See quote_items.taxable_net_unit.';
COMMENT ON COLUMN public.order_items.line_vat IS 'Generated (same expression as quote_items.line_vat).';

-- ---------------------------------------------------------------------------
-- 3. recompute_quote_total — now VAT-aware (the flagged trap).
--    Rolls per-line net + generated line_vat into subtotal / tax_amount /
--    total_amount. line_vat regenerates on quantity edits BEFORE this AFTER
--    trigger reads it, so VAT survives a quantity change. The status guard is
--    preserved: converted quotes are never mutated (payment is locked).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_quote_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
$$;

-- Triggers already attached to quote_items (INSERT/UPDATE/DELETE) from
-- 20260422_quote_total_sync_trigger.sql — CREATE OR REPLACE keeps them.

-- ---------------------------------------------------------------------------
-- 4. confirm_payment_atomic — snapshot VAT onto the order.
--    Identical signature / grants / idempotency to
--    20260520_delivery_address_on_quotes.sql (CLAUDE.md §17.7). The ONLY
--    additions: capture quote.subtotal / tax_amount, write them onto the
--    order, and copy taxable_net_unit into order_items (line_vat regenerates).
--    orders.total_amount stays p_payment_amount (the amount actually charged).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_payment_atomic(
  p_quote_id           uuid,
  p_stripe_session_id  text,
  p_payment_intent_id  text,
  p_payment_amount     numeric
) RETURNS uuid
  LANGUAGE plpgsql
AS $$
DECLARE
  v_customer_id      uuid;
  v_order_id         uuid;
  v_shipping_address jsonb;
  v_po_number        text;
  v_subtotal         numeric;   -- NEW: net snapshot from the quote
  v_tax_amount       numeric;   -- NEW: VAT snapshot from the quote
BEGIN
  -- Lock the quote row for this transaction and capture its snapshot fields.
  SELECT customer_id, shipping_address, po_number, subtotal, tax_amount
    INTO v_customer_id, v_shipping_address, v_po_number, v_subtotal, v_tax_amount
    FROM public.quotes
   WHERE id = p_quote_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found: %', p_quote_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency: if an order already exists for this stripe_session_id,
  -- return it. Covers normal retries (refresh, double-click, etc.).
  SELECT id INTO v_order_id
    FROM public.orders
   WHERE stripe_session_id = p_stripe_session_id
   LIMIT 1;

  IF v_order_id IS NOT NULL THEN
    RETURN v_order_id;
  END IF;

  -- The quote update is safe to re-run: status may already be 'converted'
  -- from a prior interrupted invocation (the ghost-recovery case), and
  -- paid_at is preserved via COALESCE.
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
    subtotal,           -- NEW
    tax_amount,         -- NEW
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
    p_payment_amount,       -- gross: the amount actually charged
    COALESCE(v_subtotal, 0),   -- NEW: net
    COALESCE(v_tax_amount, 0), -- NEW: VAT
    v_shipping_address,
    v_po_number
  )
  RETURNING id INTO v_order_id;

  -- Copy every quote_item to order_items. line_total (net) is NOT NULL, so
  -- compute it from quantity * unit_price. taxable_net_unit carries the
  -- zero-rated split forward; order_items.line_vat is GENERATED, so it is not
  -- listed here (it regenerates from the copied columns).
  INSERT INTO public.order_items (
    order_id,
    product_id,
    product_name,
    quantity,
    unit_price,
    line_total,
    taxable_net_unit,   -- NEW
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
    qi.taxable_net_unit,   -- NEW
    qi.color,
    qi.design_data,
    qi.design_thumbnail,
    qi.print_areas,
    qi.notes
  FROM public.quote_items qi
  WHERE qi.quote_id = p_quote_id;

  RETURN v_order_id;
END;
$$;

-- Preserve the original grant model: service_role only (CLAUDE.md §17.7 #6).
REVOKE ALL ON FUNCTION public.confirm_payment_atomic(uuid, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_payment_atomic(uuid, text, text, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_atomic(uuid, text, text, numeric) TO service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification (run after COMMIT):
--
--   -- Q1. Schema landed:
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE table_schema='public'
--      AND ((table_name='quotes'      AND column_name IN ('subtotal','tax_amount'))
--        OR (table_name IN ('quote_items','order_items')
--            AND column_name IN ('taxable_net_unit','line_vat')))
--    ORDER BY table_name, column_name;   -- expect 6 rows
--
--   -- Q2. Test data cleaned:
--   SELECT (SELECT count(*) FROM orders) AS orders,
--          (SELECT count(*) FROM quotes) AS quotes;   -- expect 0, 0
--
--   -- Q3. Generated VAT is correct (uses a throwaway rolled-back tx):
--   --   standard line: 100 x £1.00 net -> line_vat £20.00
--   --   zero-rated:    100 units, taxable_net_unit £0.30 -> line_vat £6.00
--   BEGIN;
--     INSERT INTO quotes (quote_number, status) VALUES ('VAT-TEST', 'draft');
--     INSERT INTO quote_items (quote_id, product_name, quantity, unit_price)
--       SELECT id, 'std', 100, 1.00 FROM quotes WHERE quote_number='VAT-TEST';
--     INSERT INTO quote_items (quote_id, product_name, quantity, unit_price, taxable_net_unit)
--       SELECT id, 'kids', 100, 1.00, 0.30 FROM quotes WHERE quote_number='VAT-TEST';
--     SELECT product_name, line_vat FROM quote_items
--       WHERE quote_id=(SELECT id FROM quotes WHERE quote_number='VAT-TEST');
--     SELECT subtotal, tax_amount, total_amount FROM quotes WHERE quote_number='VAT-TEST';
--     -- expect line_vat 20.00 & 6.00; quote subtotal 200.00, tax 26.00, total 226.00
--   ROLLBACK;
-- ---------------------------------------------------------------------------
