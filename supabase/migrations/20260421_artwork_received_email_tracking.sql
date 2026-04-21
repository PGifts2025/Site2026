-- Track when the artwork-received email has been sent, for idempotency
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS artwork_received_email_sent_at timestamptz;

COMMENT ON COLUMN orders.artwork_received_email_sent_at IS
  'Timestamp when the automated artwork-received email was sent. Null = not sent. Used as idempotency guard by send-artwork-received-email Edge Function.';
