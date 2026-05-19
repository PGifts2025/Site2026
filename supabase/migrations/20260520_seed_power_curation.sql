-- ============================================================================
-- Seed: Power category curation (26 Laltex products).
--
-- Source: Dave-curated order (26 codes). ZU0501BK cross-listed in Cables per Dave.
-- Sort: Dave's curated order preserved as-is.
--
-- Inserts into category_product_curation (CLAUDE.md §56). Positions start
-- at 1, increment by 1. No FK to supplier_products (graceful drop at fetch
-- time if a curated row references a retired/missing product, per §51 +
-- §56.3 invariants).
--
-- Apply via Supabase SQL Editor BEFORE merging the PR per CLAUDE.md §52.
-- Verify post-apply:
--   SELECT COUNT(*) FROM category_product_curation WHERE category_slug = 'power';
--   -- expect: 26
-- ============================================================================

BEGIN;

INSERT INTO public.category_product_curation (category_slug, supplier_product_code, position) VALUES
  ('power', 'ZC1002', 1),
  ('power', 'ZC2030', 2),
  ('power', 'ZC2050', 3),
  ('power', 'ZA0113', 4),
  ('power', 'ZA0114', 5),
  ('power', 'ZA0116', 6),
  ('power', 'ZA0118', 7),
  ('power', 'ZA0127', 8),
  ('power', 'ZC1011', 9),
  ('power', 'ZC1005', 10),
  ('power', 'ZC1012', 11),
  ('power', 'ZC1015', 12),
  ('power', 'ZC1029-E', 13),
  ('power', 'ZC1050', 14),
  ('power', 'ZC1030', 15),
  ('power', 'ZC2058', 16),
  ('power', 'ZC2130', 17),
  ('power', 'ZC2150', 18),
  ('power', 'ZP0076', 19),
  ('power', 'ZP0079', 20),
  ('power', 'ZP0078', 21),
  ('power', 'ZP0110', 22),
  ('power', 'ZP0111', 23),
  ('power', 'ZP0107', 24),
  ('power', 'ZP2084', 25),
  ('power', 'ZU0501BK', 26);

COMMIT;
