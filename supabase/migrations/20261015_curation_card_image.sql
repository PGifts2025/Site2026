-- =============================================================================
-- 20261015_curation_card_image.sql — category grid image check (9 Oct 2026)
--
-- Laltex's image host answers missing images slowly (~20 s, then fails), so a
-- browser-side fallback through broken URLs is too slow. A server-side check
-- (scripts/check-curated-images.mjs) stores each curated product's first
-- WORKING image; CategoryPage uses it directly and hides products with none.
--   card_image_url        — first candidate that returned 200 (NULL = none worked)
--   card_image_checked_at — when it was checked (NULL = never: page falls back
--                           to its own candidate list)
-- Columns inherit the table's existing grants/RLS (public read).
-- Rollback: .down.sql.
-- =============================================================================

BEGIN;

ALTER TABLE public.category_product_curation
  ADD COLUMN IF NOT EXISTS card_image_url text,
  ADD COLUMN IF NOT EXISTS card_image_checked_at timestamptz;

COMMENT ON COLUMN public.category_product_curation.card_image_url IS
  'First working image URL for the category card (scripts/check-curated-images.mjs). NULL with card_image_checked_at set = no working image: hidden from the grid.';

COMMIT;

-- Verify: expect cols = 2.
SELECT count(*) AS cols FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'category_product_curation'
   AND column_name IN ('card_image_url', 'card_image_checked_at');
