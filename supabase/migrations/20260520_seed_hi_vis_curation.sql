-- ============================================================================
-- Seed: Hi-Vis category curation (2 Laltex products).
--
-- Source: Dave-curated order (2 codes). QB1519 cross-listed in Bags per Dave (hi-vis drawstring bag).
-- Sort: Dave's curated order preserved as-is.
--
-- Inserts into category_product_curation (CLAUDE.md §56). Positions start
-- at 1, increment by 1. No FK to supplier_products (graceful drop at fetch
-- time if a curated row references a retired/missing product, per §51 +
-- §56.3 invariants).
--
-- Apply via Supabase SQL Editor BEFORE merging the PR per CLAUDE.md §52.
-- Verify post-apply:
--   SELECT COUNT(*) FROM category_product_curation WHERE category_slug = 'hi-vis';
--   -- expect: 2
-- ============================================================================

BEGIN;

INSERT INTO public.category_product_curation (category_slug, supplier_product_code, position) VALUES
  ('hi-vis', 'AF0010', 1),
  ('hi-vis', 'QB1519', 2);

COMMIT;
