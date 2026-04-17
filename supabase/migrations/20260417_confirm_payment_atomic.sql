-- Atomic RPC for confirming a Stripe payment.
--
-- The previous flow did: update quote, then insert order, then insert
-- order_items, as three separate DB calls. If anything failed between the
-- quote update and the order insert, the quote was left marked 'converted'
-- with no corresponding order, and the Edge Function's quote.status guard
-- then made every retry short-circuit to success with order_id=null. Result:
-- paid quotes with no orders and no way to recover (QT-MMZ5OZ4N is one).
--
-- This RPC performs all three steps inside a single transaction, locks the
-- quote row for the duration, and is idempotent on stripe_session_id so
-- retries are safe.

CREATE OR REPLACE FUNCTION public.confirm_payment_atomic(
  p_quote_id           uuid,
  p_stripe_session_id  text,
  p_payment_intent_id  text,
  p_payment_amount     numeric
) RETURNS uuid
  LANGUAGE plpgsql
AS $$
DECLARE
  v_customer_id  uuid;
  v_order_id     uuid;
BEGIN
  -- Lock the quote row for this transaction.
  SELECT customer_id
    INTO v_customer_id
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
    total_amount
  ) VALUES (
    p_quote_id,
    v_customer_id,
    'confirmed',
    'paid',
    'pending_artwork',
    p_stripe_session_id,
    p_payment_intent_id,
    p_payment_amount
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

-- Only the confirm-payment Edge Function (service_role) should call this.
REVOKE ALL ON FUNCTION public.confirm_payment_atomic(uuid, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_payment_atomic(uuid, text, text, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_atomic(uuid, text, text, numeric) TO service_role;
