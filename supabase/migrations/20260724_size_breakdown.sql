-- ============================================================================
-- Clothing size breakdown on quote_items / order_items.
-- ----------------------------------------------------------------------------
-- WHY: Laltex clothing is a colour x size variant matrix. A line's per-size
-- split (e.g. {"Small":5,"Medium":10,"Large":10}) is stored as JSONB on the
-- line, mirroring the existing print_areas precedent (pricing is size-uniform
-- in the feed, so one row per line is correct; no per-size row split). NULL for
-- single-size / non-clothing lines.
--
-- confirm_payment_atomic is replaced to copy size_breakdown from quote to order
-- exactly as it already copies print_areas / taxable_net_unit. Identical
-- signature / grants / idempotency (CLAUDE.md §17.7) — only the one field added.
--
-- APPLY (CLAUDE.md §52 + PR #76 lesson): open Supabase SQL Editor, paste, Run.
-- NO explicit BEGIN/COMMIT. Idempotent. The final SELECT must return TWO rows
-- (quote_items + order_items), not "Success. No rows returned". Then merge.
-- ============================================================================

ALTER TABLE public.quote_items ADD COLUMN IF NOT EXISTS size_breakdown jsonb;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS size_breakdown jsonb;

COMMENT ON COLUMN public.quote_items.size_breakdown IS
  'Per-size quantity split for multi-size clothing, keyed by the exact Laltex feed size name in garment order (e.g. {"Small":5,"Medium":10}). Sum equals quantity. NULL for single-size / non-clothing lines.';
COMMENT ON COLUMN public.order_items.size_breakdown IS
  'Copied from quote_items at conversion. See quote_items.size_breakdown.';

-- ---------------------------------------------------------------------------
-- Replace confirm_payment_atomic to carry size_breakdown forward. Faithful
-- reproduction of the current function (20260720_vat_schema_forward_fix.sql)
-- plus the one added copy in the order_items INSERT ... SELECT.
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
    size_breakdown,
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
    qi.size_breakdown,
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
-- Verification: must return TWO rows (quote_items + order_items, size_breakdown, jsonb).
-- ---------------------------------------------------------------------------
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('quote_items', 'order_items')
  AND column_name = 'size_breakdown'
ORDER BY table_name;
