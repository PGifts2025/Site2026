-- Down migration for 20260901_orders_refund_tracking.sql.
--
-- Reverts the refund-tracking additions. Restores the payment_status CHECK to
-- its pre-migration allowed set (WITHOUT 'partially_refunded'). NOTE: if any
-- row is 'partially_refunded' at down-migration time the ADD CONSTRAINT will
-- fail — resolve those rows first (e.g. set them to 'refunded' or 'paid') as a
-- deliberate operator decision, since silently rewriting payment state on a
-- rollback would be worse.
--
-- No BEGIN/COMMIT. Idempotent. Ends with a verifying SELECT.

DROP FUNCTION IF EXISTS public.apply_refund_atomic(text, numeric, numeric);

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status = ANY (ARRAY[
    'pending'::text,
    'processing'::text,
    'paid'::text,
    'failed'::text,
    'refunded'::text
  ]));

ALTER TABLE public.orders DROP COLUMN IF EXISTS refunded_amount;
ALTER TABLE public.orders DROP COLUMN IF EXISTS refunded_at;

-- Verifying SELECT — expect: new_cols = 0, rpc_exists = 0, and payment_check
-- no longer contains 'partially_refunded'.
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'orders'
       AND column_name IN ('refunded_amount', 'refunded_at'))              AS new_cols,
  (SELECT count(*) FROM pg_proc WHERE proname = 'apply_refund_atomic')     AS rpc_exists,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conname = 'orders_payment_status_check')                        AS payment_check;
