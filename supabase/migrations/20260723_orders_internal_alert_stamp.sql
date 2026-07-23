-- ============================================================================
-- Internal new-order alert: idempotency stamp on orders.
-- ----------------------------------------------------------------------------
-- WHY: confirm_payment_atomic is invoked by BOTH the confirm-payment redirect
-- and the stripe-webhook, so the internal orders@ alert could fire twice for
-- one order. sendInternalOrderAlert claims this column atomically
-- (UPDATE ... WHERE internal_alert_sent_at IS NULL RETURNING id) so exactly one
-- path sends. It doubles as a miss-detector: any paid order with
-- internal_alert_sent_at IS NULL is a failed/unsent alert.
--
-- APPLY (CLAUDE.md §52 + PR #76 lesson): open Supabase SQL Editor, paste, Run.
-- NO explicit BEGIN/COMMIT. Idempotent. The final SELECT must return ONE row
-- showing the column, not "Success. No rows returned". Then merge.
-- ============================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS internal_alert_sent_at timestamptz;

COMMENT ON COLUMN public.orders.internal_alert_sent_at IS
  'Timestamp the internal orders@ new-order alert was sent. NULL = not sent (a paid order with NULL here is a failed alert; see sendInternalOrderAlert.ts). Claimed atomically to dedupe the confirm-payment / stripe-webhook two-path race; reset to NULL on send failure so a retry re-sends.';

-- ---------------------------------------------------------------------------
-- Verification: must return ONE row (table_name=orders, column_name=
-- internal_alert_sent_at, data_type=timestamp with time zone).
-- ---------------------------------------------------------------------------
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'orders'
  AND column_name = 'internal_alert_sent_at';
