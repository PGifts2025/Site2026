-- ============================================================================
-- Seed: Speakers category curation (6 Laltex products).
--
-- Source: Dave-curated order (6 codes).
-- Sort: Dave's curated order preserved as-is.
--
-- Inserts into category_product_curation (CLAUDE.md §56). Positions start
-- at 1, increment by 1. No FK to supplier_products (graceful drop at fetch
-- time if a curated row references a retired/missing product, per §51 +
-- §56.3 invariants).
--
-- Apply via Supabase SQL Editor BEFORE merging the PR per CLAUDE.md §52.
-- Verify post-apply:
--   SELECT COUNT(*) FROM category_product_curation WHERE category_slug = 'speakers';
--   -- expect: 6
-- ============================================================================

BEGIN;

INSERT INTO public.category_product_curation (category_slug, supplier_product_code, position) VALUES
  ('speakers', 'ZA0172', 1),
  ('speakers', 'ZA0175', 2),
  ('speakers', 'ZA0176', 3),
  ('speakers', 'ZA0177', 4),
  ('speakers', 'ZA0178', 5),
  ('speakers', 'ZA0182', 6);

COMMIT;
