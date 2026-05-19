-- ============================================================================
-- Seed: Cables category curation (12 Laltex products).
--
-- Source: Dave-curated order (12 codes). ZU0501BK cross-listed in Power per Dave.
-- Sort: Dave's curated order preserved as-is.
--
-- Inserts into category_product_curation (CLAUDE.md §56). Positions start
-- at 1, increment by 1. No FK to supplier_products (graceful drop at fetch
-- time if a curated row references a retired/missing product, per §51 +
-- §56.3 invariants).
--
-- Apply via Supabase SQL Editor BEFORE merging the PR per CLAUDE.md §52.
-- Verify post-apply:
--   SELECT COUNT(*) FROM category_product_curation WHERE category_slug = 'cables';
--   -- expect: 12
-- ============================================================================

BEGIN;

INSERT INTO public.category_product_curation (category_slug, supplier_product_code, position) VALUES
  ('cables', 'P0200', 1),
  ('cables', 'ZP0210', 2),
  ('cables', 'ZP1059', 3),
  ('cables', 'ZP1049', 4),
  ('cables', 'ZP1060', 5),
  ('cables', 'ZP1067', 6),
  ('cables', 'ZP1084', 7),
  ('cables', 'ZP1102', 8),
  ('cables', 'ZP1101', 9),
  ('cables', 'ZP1103', 10),
  ('cables', 'ZP1104', 11),
  ('cables', 'ZU0501BK', 12);

COMMIT;
