-- Refund tracking on orders + atomic refund-apply RPC for the Stripe webhook.
--
-- Problem this fixes: when an order is refunded in Stripe, the database never
-- learned about it. The stripe-webhook function only subscribed to
-- checkout.session.completed, so a refund left orders.payment_status = 'paid'
-- forever. The admin dashboard then showed refunded orders as paid, disagreeing
-- with the payment processor — a reconciliation and fulfilment hazard once real
-- customers are refunded.
--
-- What this migration adds:
--   1. orders.refunded_amount (numeric, pounds) — cumulative amount refunded.
--      NULL = never refunded. This lets a PARTIAL refund be represented
--      honestly, distinct from a full one.
--   2. orders.refunded_at (timestamptz) — time of the most recent refund.
--   3. Extends orders_payment_status_check to allow 'partially_refunded'
--      ('refunded' was already permitted).
--   4. apply_refund_atomic(payment_intent_id, refunded_amount, charge_amount)
--      RPC — the single writer for refund state, called by stripe-webhook on
--      charge.refunded. Locks the order row, is idempotent + monotonic, and
--      does NOT filter deleted_at (a refund on a soft-deleted order must still
--      be recorded for accounting — see orders.deleted_at comment / §17).
--
-- Matching: charge.refunded carries the charge + payment_intent, NOT the
-- checkout session id, so we match on orders.payment_intent_id (already stored
-- by confirm_payment_atomic on both payment paths). No new correlation column
-- is needed.
--
-- Idempotency: Stripe retries events, and the charge object always carries the
-- CUMULATIVE amount_refunded. The RPC only applies when the incoming cumulative
-- exceeds what we've already recorded, so replaying the same event is a no-op
-- and an out-of-order (older, smaller) event is ignored.
--
-- No BEGIN/COMMIT (project migration convention). Idempotent. Ends with a
-- verifying SELECT.

-- 1 + 2. New columns (idempotent).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refunded_amount numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refunded_at     timestamptz;

COMMENT ON COLUMN public.orders.refunded_amount IS
  'Cumulative amount refunded via Stripe, in pounds. NULL = never refunded. When set and equal to total_amount the order is fully refunded (payment_status=refunded); when set and less than total_amount it is partially refunded (payment_status=partially_refunded). Written only by apply_refund_atomic. Added 2026-09-01.';
COMMENT ON COLUMN public.orders.refunded_at IS
  'Timestamp of the most recent refund applied by apply_refund_atomic. NULL = never refunded. Added 2026-09-01.';

-- 3. Extend the payment_status CHECK to allow 'partially_refunded'.
--    'refunded' was already in the allowed set; all existing rows are valid
--    under the new set, so the ADD validates cleanly.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status = ANY (ARRAY[
    'pending'::text,
    'processing'::text,
    'paid'::text,
    'failed'::text,
    'refunded'::text,
    'partially_refunded'::text
  ]));

-- 4. Atomic refund-apply RPC. Single writer for refund state.
CREATE OR REPLACE FUNCTION public.apply_refund_atomic(
  p_payment_intent_id text,
  p_refunded_amount    numeric,  -- cumulative refunded, pounds
  p_charge_amount      numeric   -- total charge amount, pounds
) RETURNS TABLE (order_id uuid, applied boolean, new_status text)
  LANGUAGE plpgsql
AS $$
DECLARE
  v_order      public.orders%ROWTYPE;
  v_new_status text;
BEGIN
  -- Match on payment_intent_id. Deliberately NOT filtered on deleted_at: a
  -- refund on a soft-deleted order must still be recorded (accounting).
  -- FOR UPDATE serialises two concurrent refund events for the same order.
  SELECT * INTO v_order
    FROM public.orders
   WHERE payment_intent_id = p_payment_intent_id
   ORDER BY created_at ASC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    -- No order for this charge (e.g. a payment not originating from PGifts).
    -- Caller acknowledges with 200 and does nothing.
    order_id := NULL; applied := false; new_status := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Full when cumulative refunded reaches the charge total (epsilon guards
  -- rounding). Otherwise partial.
  IF p_charge_amount IS NOT NULL AND p_refunded_amount >= p_charge_amount - 0.005 THEN
    v_new_status := 'refunded';
  ELSE
    v_new_status := 'partially_refunded';
  END IF;

  -- Monotonic idempotency guard. Only apply when this event reflects MORE
  -- refunded than already recorded. Same-event replay writes nothing; an
  -- out-of-order older event (smaller cumulative) is ignored.
  IF COALESCE(v_order.refunded_amount, 0) >= p_refunded_amount THEN
    order_id := v_order.id; applied := false; new_status := v_order.payment_status;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.orders
     SET payment_status  = v_new_status,
         refunded_amount = p_refunded_amount,
         refunded_at     = now()
   WHERE id = v_order.id;

  order_id := v_order.id; applied := true; new_status := v_new_status;
  RETURN NEXT;
END;
$$;

-- Only the stripe-webhook Edge Function (service_role) should call this.
REVOKE ALL ON FUNCTION public.apply_refund_atomic(text, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_refund_atomic(text, numeric, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_refund_atomic(text, numeric, numeric) TO service_role;

-- Verifying SELECT — expect: new_cols = 2, payment_check contains
-- 'partially_refunded', rpc_exists = 1.
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'orders'
       AND column_name IN ('refunded_amount', 'refunded_at'))                       AS new_cols,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conname = 'orders_payment_status_check')                                 AS payment_check,
  (SELECT count(*) FROM pg_proc WHERE proname = 'apply_refund_atomic')              AS rpc_exists;
