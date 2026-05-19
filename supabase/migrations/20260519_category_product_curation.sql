-- ============================================================================
-- Category-page Laltex curation table + Water Bottles seed.
--
-- Background: category pages today render only PGifts Direct products. Laltex
-- has ~1,160 active products that aren't surfaced on category pages because
-- Laltex's `category` / `sub_category` fields are too messy to auto-derive
-- against (e.g. "Misc Drinkware" containing mugs and bottles indiscriminately).
--
-- This migration introduces an editorial curation table — Dave (and any future
-- admin UI) decides which Laltex products appear on which category page, and
-- in what order. The shared CategoryPage component reads this table and
-- auto-gates the new sections (Ava widget + curated grid + Load more) on
-- the curation set being non-empty. Categories without rows render exactly
-- as they do today.
--
-- The shared CategoryPage component fetches by joining curation -> supplier_products
-- through the existing getSupplierProductByCode helper, which inherits the
-- `is_retired = false` filter (CLAUDE.md §51). A retired curated row silently
-- drops from rendering — the page still loads without crashing.
--
-- Migration-first deploy rule (CLAUDE.md §52) applies. Apply this migration
-- to production via Supabase SQL Editor BEFORE merging the PR. The shared
-- CategoryPage component is hardened against the table being empty (graceful
-- degrade in the catch branch of the fetch), so even an unapplied migration
-- wouldn't crash production — but the new Water Bottles surface wouldn't
-- render until the table exists and is seeded.
--
-- See CLAUDE.md §56.
-- ============================================================================

BEGIN;

CREATE TABLE public.category_product_curation (
  id BIGSERIAL PRIMARY KEY,
  category_slug TEXT NOT NULL,
  supplier_product_code TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category_slug, supplier_product_code),
  CHECK (position >= 0)
);

CREATE INDEX idx_category_product_curation_lookup
  ON public.category_product_curation (category_slug, position);

COMMENT ON TABLE public.category_product_curation IS
  'Curated Laltex products to display on each category page. '
  'Editorial control by Dave / future admin UI. category_slug matches '
  'the URL slug (e.g. water-bottles, cables). position controls the '
  'render order. The shared CategoryPage component data-gates the new '
  'sections on this table being non-empty for the given slug. See '
  'CLAUDE.md §56.';

COMMENT ON COLUMN public.category_product_curation.supplier_product_code IS
  'References supplier_products.supplier_product_code (case-sensitive). '
  'No FK because retired products may be deleted upstream — graceful drop '
  'is handled at fetch time. See CLAUDE.md §33.';

COMMENT ON COLUMN public.category_product_curation.position IS
  'Render order for the curated list. Position 1 renders first. Gaps and '
  'duplicates are tolerated at fetch time (ORDER BY position) but the '
  'unique constraint on (category_slug, supplier_product_code) prevents '
  'the same product appearing twice on the same page.';

-- ----------------------------------------------------------------------------
-- RLS — open SELECT for anon/authenticated (the page is public-facing).
-- Writes are service-role only; admins use the admin UI (future) or direct
-- SQL access. Same shape as supplier_products' access pattern.
-- ----------------------------------------------------------------------------

ALTER TABLE public.category_product_curation ENABLE ROW LEVEL SECURITY;

CREATE POLICY category_product_curation_read
  ON public.category_product_curation
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ----------------------------------------------------------------------------
-- Seed: Water Bottles category — 63 Laltex products in Dave's curation order.
-- Positions 1-63 ascending. Single multi-row INSERT for atomicity.
-- ----------------------------------------------------------------------------

INSERT INTO public.category_product_curation (category_slug, supplier_product_code, position) VALUES
  ('water-bottles', 'MG0838',  1),
  ('water-bottles', 'MG0450',  2),
  ('water-bottles', 'MG0634',  3),
  ('water-bottles', 'MG0640',  4),
  ('water-bottles', 'MG9333',  5),
  ('water-bottles', 'MG0134',  6),
  ('water-bottles', 'MG0445',  7),
  ('water-bottles', 'MG0088',  8),
  ('water-bottles', 'MG0636',  9),
  ('water-bottles', 'MG1337', 10),
  ('water-bottles', 'MG0633', 11),
  ('water-bottles', 'MG3001', 12),
  ('water-bottles', 'MG0446', 13),
  ('water-bottles', 'MG0635', 14),
  ('water-bottles', 'MG0336', 15),
  ('water-bottles', 'MG2020', 16),
  ('water-bottles', 'MG0337', 17),
  ('water-bottles', 'MG0332', 18),
  ('water-bottles', 'MG0443', 19),
  ('water-bottles', 'MG7277', 20),
  ('water-bottles', 'MG0334', 21),
  ('water-bottles', 'MG0119', 22),
  ('water-bottles', 'MG0333', 23),
  ('water-bottles', 'MG0335', 24),
  ('water-bottles', 'MG0118', 25),
  ('water-bottles', 'MG2022', 26),
  ('water-bottles', 'MG2025', 27),
  ('water-bottles', 'MG0234', 28),
  ('water-bottles', 'MG0233', 29),
  ('water-bottles', 'MG0014', 30),
  ('water-bottles', 'MG0034', 31),
  ('water-bottles', 'MG9133', 32),
  ('water-bottles', 'MG7272', 33),
  ('water-bottles', 'MG0833', 34),
  ('water-bottles', 'MG9134', 35),
  ('water-bottles', 'MG0113', 36),
  ('water-bottles', 'MG0212', 37),
  ('water-bottles', 'MG8606', 38),
  ('water-bottles', 'MG8605', 39),
  ('water-bottles', 'MG9608', 40),
  ('water-bottles', 'MG0037', 41),
  ('water-bottles', 'MG1012', 42),
  ('water-bottles', 'MG9300', 43),
  ('water-bottles', 'MG0512', 44),
  ('water-bottles', 'MG9506', 45),
  ('water-bottles', 'MG9605', 46),
  ('water-bottles', 'MG9606', 47),
  ('water-bottles', 'MG9706', 48),
  ('water-bottles', 'MG0112', 49),
  ('water-bottles', 'MG9705', 50),
  ('water-bottles', 'MG9707', 51),
  ('water-bottles', 'MG0012', 52),
  ('water-bottles', 'MG0013', 53),
  ('water-bottles', 'MG4012', 54),
  ('water-bottles', 'MG9406', 55),
  ('water-bottles', 'MG7606', 56),
  ('water-bottles', 'MG2111', 57),
  ('water-bottles', 'MG9511', 58),
  ('water-bottles', 'MG2606', 59),
  ('water-bottles', 'MG3606', 60),
  ('water-bottles', 'MG0503', 61),
  ('water-bottles', 'MG0603', 62),
  ('water-bottles', 'MG3605', 63);

COMMIT;
