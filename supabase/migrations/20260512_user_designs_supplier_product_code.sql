-- Session 7: Designer-v2 for Laltex products
--
-- Adds a nullable supplier_product_code column to user_designs so Designer-v2
-- can persist Laltex-product designs alongside the existing v1 designs that
-- key off product_template_id.
--
-- Strictly additive:
--   - existing rows untouched (column defaults NULL)
--   - product_template_id / variant_id columns left in place; v1 keeps using
--     them for the 25 PGifts Direct products
--   - no FK to supplier_products (supplier_products.supplier_product_code is
--     not globally unique; uniqueness is on the pair (supplier_id, code))
--   - btree index for lookup by code (Designer-v2 fetches designs by
--     supplier_product_code + user/session)
--
-- After this migration, a design row is keyed by ONE of:
--   product_template_id (v1, PGifts Direct, with optional variant_id)
--   supplier_product_code (v2, Laltex)
-- The two paths are mutually exclusive in practice but the schema does not
-- enforce it; either column being non-null is valid.

ALTER TABLE user_designs
  ADD COLUMN IF NOT EXISTS supplier_product_code TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_user_designs_supplier_product_code
  ON user_designs(supplier_product_code)
  WHERE supplier_product_code IS NOT NULL;

COMMENT ON COLUMN user_designs.supplier_product_code IS
  'Designer-v2: links the design to a supplier_products row by code (Laltex SKU like MG0192). NULL for legacy v1 designs which use product_template_id instead.';
