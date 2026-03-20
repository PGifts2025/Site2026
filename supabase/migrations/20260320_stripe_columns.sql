-- Add Stripe-related columns to quotes table
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS payment_amount NUMERIC;

-- Add stripe_session_id to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
