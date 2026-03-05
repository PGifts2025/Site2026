-- Migration 011: Artwork uploads per order
--
-- 1. Creates order_artwork table to store uploaded artwork files
-- 2. Adds artwork_status column to orders table

-- =====================================================
-- 1. order_artwork table
-- =====================================================

CREATE TABLE IF NOT EXISTS order_artwork (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id     UUID        REFERENCES orders(id) ON DELETE CASCADE,
  user_id      UUID        REFERENCES auth.users(id),
  file_name    TEXT        NOT NULL,
  file_url     TEXT        NOT NULL,
  file_type    TEXT        NOT NULL,
  file_size    INTEGER     NOT NULL,
  status       TEXT        DEFAULT 'uploaded'
                           CHECK (status IN ('uploaded', 'approved', 'rejected', 'needs_changes')),
  notes        TEXT,
  uploaded_at  TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. Add artwork_status to orders
-- =====================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS artwork_status TEXT
    DEFAULT 'pending_artwork'
    CHECK (artwork_status IN (
      'pending_artwork',
      'artwork_uploaded',
      'in_review',
      'proof_sent',
      'approved',
      'in_production'
    ));

-- =====================================================
-- 3. Row Level Security on order_artwork
-- =====================================================

ALTER TABLE order_artwork ENABLE ROW LEVEL SECURITY;

-- Customers can read/insert their own artwork rows
CREATE POLICY "Customers can view own artwork"
  ON order_artwork FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Customers can upload artwork"
  ON order_artwork FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Customers can delete own artwork"
  ON order_artwork FOR DELETE
  USING (auth.uid() = user_id);

-- Admins have full access
CREATE POLICY "Admins full access to artwork"
  ON order_artwork FOR ALL
  USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'is_admin' = 'true'
    )
  );

-- =====================================================
-- 4. Index for fast order lookups
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_order_artwork_order_id
  ON order_artwork (order_id);

CREATE INDEX IF NOT EXISTS idx_order_artwork_user_id
  ON order_artwork (user_id);
