-- Migration 010: Add print pricing model support
--
-- Adds pricing_model and max_print_positions to catalog_products,
-- and creates catalog_print_pricing table for position/colour/coverage pricing.

-- =====================================================
-- 1. Add columns to catalog_products
-- =====================================================

ALTER TABLE catalog_products
  ADD COLUMN IF NOT EXISTS pricing_model VARCHAR(20) DEFAULT 'flat'
    CHECK (pricing_model IN ('clothing', 'flat', 'coverage')),
  ADD COLUMN IF NOT EXISTS max_print_positions INTEGER DEFAULT 1;

COMMENT ON COLUMN catalog_products.pricing_model IS
  'Determines the print pricing UI: clothing (position + colour count), flat (optional second position), coverage (front/back/wrap)';

COMMENT ON COLUMN catalog_products.max_print_positions IS
  'For clothing model: number of print positions available (3=polo, 4=standard, 5=hi-vis). For flat model: 1=no extra UI, 2=second position toggle.';

-- =====================================================
-- 2. Create catalog_print_pricing table
-- =====================================================

CREATE TABLE IF NOT EXISTS catalog_print_pricing (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalog_product_id UUID NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,

  -- CLOTHING MODEL: one row per colour_count (× optional quantity tier)
  -- Each active print position adds print_cost_per_position to the garment base price.
  colour_count       INTEGER       CHECK (colour_count BETWEEN 1 AND 6),
  min_quantity       INTEGER,
  max_quantity       INTEGER,
  print_cost_per_position DECIMAL(10,2),

  -- FLAT MODEL: flat extra cost when second position is toggled on
  extra_position_price DECIMAL(10,2),

  -- COVERAGE MODEL: full price per unit for each coverage type
  coverage_type      VARCHAR(20)   CHECK (coverage_type IN ('front_only', 'front_back', 'full_wrap')),
  coverage_price_per_unit DECIMAL(10,2),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE catalog_print_pricing IS
  'Stores print pricing data for product detail page. Each row applies to one pricing model scenario.';

-- =====================================================
-- 3. Row Level Security
-- =====================================================

ALTER TABLE catalog_print_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access for print pricing"
  ON catalog_print_pricing
  FOR SELECT
  USING (true);

CREATE POLICY "Admin write access for print pricing"
  ON catalog_print_pricing
  FOR ALL
  USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'is_admin' = 'true'
    )
  );

-- =====================================================
-- 4. Index for fast product lookups
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_print_pricing_product_id
  ON catalog_print_pricing (catalog_product_id);
