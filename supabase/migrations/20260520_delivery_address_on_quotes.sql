-- Delivery address capture (PR B).
--
-- B2B customers ship to their client's address, not their own. Delivery is
-- captured ON THE QUOTE and copied to the order atomically by
-- confirm_payment_atomic, so the order is never created without the address
-- the customer entered. Never write the address in the confirm-payment Edge
-- Function after the RPC returns — that re-splits the atomic transaction the
-- RPC exists to prevent (CLAUDE.md §17.7).
--
-- This migration:
--   1. Adds quotes.shipping_address (jsonb) + quotes.po_number (text).
--   2. Recreates confirm_payment_atomic with the EXACT existing signature,
--      body, and grants (see supabase/migrations/20260417_confirm_payment_atomic.sql),
--      adding ONLY two new copies (shipping_address, po_number) into the
--      orders INSERT. No other behaviour changes.
--
-- orders.shipping_address (jsonb) and orders.po_number (text) already exist.

BEGIN;

-- 1. Delivery columns on quotes (snapshot target; see CLAUDE.md snapshot semantics)
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS shipping_address jsonb,
  ADD COLUMN IF NOT EXISTS po_number        text;

-- 2. Recreate the RPC. CREATE OR REPLACE keeps the existing grants; we keep
--    the identical signature (uuid, text, text, numeric) RETURNS uuid and the
--    identical (non-SECURITY DEFINER) body. The ONLY additions are
--    v_shipping_address / v_po_number, captured in the FOR UPDATE select and
--    written into the orders INSERT.
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
  v_shipping_address jsonb;   -- NEW: copied from quote → order
  v_po_number        text;    -- NEW: copied from quote → order
BEGIN
  -- Lock the quote row for this transaction. (NEW: also capture the
  -- delivery fields the customer set on the quote.)
  SELECT customer_id, shipping_address, po_number
    INTO v_customer_id, v_shipping_address, v_po_number
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
    shipping_address,   -- NEW
    po_number           -- NEW
  ) VALUES (
    p_quote_id,
    v_customer_id,
    'confirmed',
    'paid',
    'pending_artwork',
    p_stripe_session_id,
    p_payment_intent_id,
    p_payment_amount,
    v_shipping_address, -- NEW
    v_po_number         -- NEW
  )
  RETURNING id INTO v_order_id;

  -- Copy every quote_item to order_items. line_total is NOT NULL, so
  -- compute it here from quantity * unit_price.
  INSERT INTO public.order_items (
    order_id,
    product_id,
    product_name,
    quantity,
    unit_price,
    line_total,
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
-- anon + authenticated are revoked; the confirm-payment Edge Function calls
-- this with the service-role key.
REVOKE ALL ON FUNCTION public.confirm_payment_atomic(uuid, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_payment_atomic(uuid, text, text, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_atomic(uuid, text, text, numeric) TO service_role;

COMMIT;
