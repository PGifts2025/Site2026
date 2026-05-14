-- Confirmation-email idempotency + Stripe session uniqueness hardening.
--
-- Context. Order creation now runs via two paths:
--   1. Redirect path: browser hits /confirm-payment after Stripe's success_url
--   2. Webhook path: Stripe calls /stripe-webhook server-to-server on
--      checkout.session.completed
-- Both call confirm_payment_atomic with the same (quote_id, stripe_session_id).
-- The RPC is already concurrency-safe (FOR UPDATE on quotes + idempotency
-- SELECT on orders.stripe_session_id), so duplicate order rows are prevented
-- at the application layer.
--
-- This migration adds two complementary guards:
--
--   a) orders.confirmation_email_sent_at — a CAS timestamp consumed by the
--      shared sendOrderConfirmation helper. Without it, both paths would
--      attempt to send the Resend confirmation email, producing duplicates
--      (the RPC dedupes the order row but not the email).
--
--   b) UNIQUE INDEX orders_stripe_session_id_uniq — DB-level enforcement of
--      what the RPC already maintains. Belt-and-braces: if a future change
--      to the RPC ever drops the FOR UPDATE or the idempotency SELECT, the
--      index ensures double-insertion still fails fast at the DB instead of
--      producing two paid-but-uncoupled order rows.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS confirmation_email_sent_at timestamptz;

COMMENT ON COLUMN public.orders.confirmation_email_sent_at IS
  'Timestamp when the order-confirmation email was sent. Null = not sent. '
  'Used as a compare-and-swap idempotency guard by '
  'supabase/functions/_shared/sendOrderConfirmation.ts so the redirect '
  'and webhook paths cannot both send the same email.';

CREATE UNIQUE INDEX IF NOT EXISTS orders_stripe_session_id_uniq
  ON public.orders(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
