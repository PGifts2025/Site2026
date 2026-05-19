-- ============================================================================
-- Seed: Cups category curation (63 Laltex products).
--
-- Source: Dave-curated order (63 codes). MS0024-01 dropped per Dave: does not exist in supplier_products.
-- Sort: Dave's curated order preserved as-is.
--
-- Inserts into category_product_curation (CLAUDE.md §56). Positions start
-- at 1, increment by 1. No FK to supplier_products (graceful drop at fetch
-- time if a curated row references a retired/missing product, per §51 +
-- §56.3 invariants).
--
-- Apply via Supabase SQL Editor BEFORE merging the PR per CLAUDE.md §52.
-- Verify post-apply:
--   SELECT COUNT(*) FROM category_product_curation WHERE category_slug = 'cups';
--   -- expect: 63
-- ============================================================================

BEGIN;

INSERT INTO public.category_product_curation (category_slug, supplier_product_code, position) VALUES
  ('cups', 'MG2124', 1),
  ('cups', 'MG2024', 2),
  ('cups', 'MG0661', 3),
  ('cups', 'MG0828', 4),
  ('cups', 'MG2924', 5),
  ('cups', 'MG0848', 6),
  ('cups', 'MG0812', 7),
  ('cups', 'MG2624', 8),
  ('cups', 'MG0660', 9),
  ('cups', 'MG1010', 10),
  ('cups', 'MG0044', 11),
  ('cups', 'MG0813', 12),
  ('cups', 'MG0116', 13),
  ('cups', 'MG1024', 14),
  ('cups', 'MG0912', 15),
  ('cups', 'MG0139', 16),
  ('cups', 'MG2016', 17),
  ('cups', 'MG0041', 18),
  ('cups', 'MG0114', 19),
  ('cups', 'MG2026', 20),
  ('cups', 'MG1035', 21),
  ('cups', 'MG0811', 22),
  ('cups', 'MG0046', 23),
  ('cups', 'MG0045', 24),
  ('cups', 'MG0006', 25),
  ('cups', 'MG0818', 26),
  ('cups', 'MG0121', 27),
  ('cups', 'MG0131', 28),
  ('cups', 'MG0039', 29),
  ('cups', 'MG0193', 30),
  ('cups', 'MG0132', 31),
  ('cups', 'MG0003', 32),
  ('cups', 'MG0003Cols', 33),
  ('cups', 'MG0101', 34),
  ('cups', 'MG1192', 35),
  ('cups', 'MG0052', 36),
  ('cups', 'MG0061', 37),
  ('cups', 'MG0111', 38),
  ('cups', 'MG0806', 39),
  ('cups', 'MG0190', 40),
  ('cups', 'MG0192', 41),
  ('cups', 'MG0110', 42),
  ('cups', 'MG4017', 43),
  ('cups', 'MG0239', 44),
  ('cups', 'MG1818', 45),
  ('cups', 'MG3018', 46),
  ('cups', 'MG9105', 47),
  ('cups', 'MG9166', 48),
  ('cups', 'MG9146', 49),
  ('cups', 'MG9115', 50),
  ('cups', 'MG9120', 51),
  ('cups', 'MG9141', 52),
  ('cups', 'MG9160', 53),
  ('cups', 'MG9180', 54),
  ('cups', 'MG2017', 55),
  ('cups', 'MG3017', 56),
  ('cups', 'MG9121', 57),
  ('cups', 'MG9161', 58),
  ('cups', 'MG9100', 59),
  ('cups', 'MG9106', 60),
  ('cups', 'MG9181', 61),
  ('cups', 'MG9101', 62),
  ('cups', 'MG0051', 63);

COMMIT;
