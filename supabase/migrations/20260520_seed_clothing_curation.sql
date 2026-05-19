-- ============================================================================
-- Seed: Clothing category curation (75 Laltex products).
--
-- Source: Dave-curated order (75 codes). TF0002 duplicated in source list; de-duped to its first occurrence (position 8).
-- Sort: Dave's curated order, TF0002 appears once at original first occurrence.
--
-- Inserts into category_product_curation (CLAUDE.md §56). Positions start
-- at 1, increment by 1. No FK to supplier_products (graceful drop at fetch
-- time if a curated row references a retired/missing product, per §51 +
-- §56.3 invariants).
--
-- Apply via Supabase SQL Editor BEFORE merging the PR per CLAUDE.md §52.
-- Verify post-apply:
--   SELECT COUNT(*) FROM category_product_curation WHERE category_slug = 'clothing';
--   -- expect: 75
-- ============================================================================

BEGIN;

INSERT INTO public.category_product_curation (category_slug, supplier_product_code, position) VALUES
  ('clothing', 'TF0442', 1),
  ('clothing', 'TF1000', 2),
  ('clothing', 'TF0006', 3),
  ('clothing', 'TF0013', 4),
  ('clothing', 'TF011K', 5),
  ('clothing', 'TF0012', 6),
  ('clothing', 'TF0102', 7),
  ('clothing', 'TF0002', 8),
  ('clothing', 'TF0010', 9),
  ('clothing', 'TF0004', 10),
  ('clothing', 'TF0104', 11),
  ('clothing', 'TF0009', 12),
  ('clothing', 'TF0001', 13),
  ('clothing', 'TF0101', 14),
  ('clothing', 'TF004K', 15),
  ('clothing', 'TF0011', 16),
  ('clothing', 'TF0111', 17),
  ('clothing', 'TF0008', 18),
  ('clothing', 'TF001K', 19),
  ('clothing', 'JF0002', 20),
  ('clothing', 'JF0001', 21),
  ('clothing', 'JF0023', 22),
  ('clothing', 'JF0003', 23),
  ('clothing', 'JF0013', 24),
  ('clothing', 'JF0014', 25),
  ('clothing', 'JF0113', 26),
  ('clothing', 'JF0022', 27),
  ('clothing', 'JF0012', 28),
  ('clothing', 'JF0112', 29),
  ('clothing', 'JF0021', 30),
  ('clothing', 'JF0024', 31),
  ('clothing', 'AF0124', 32),
  ('clothing', 'PF0005', 33),
  ('clothing', 'AF0002', 34),
  ('clothing', 'AF0001', 35),
  ('clothing', 'HF0101', 36),
  ('clothing', 'HF0102', 37),
  ('clothing', 'JF0011', 38),
  ('clothing', 'JF0032', 39),
  ('clothing', 'PF0006', 40),
  ('clothing', 'PF0007', 41),
  ('clothing', 'PF0008', 42),
  ('clothing', 'PF0009', 43),
  ('clothing', 'PF0101', 44),
  ('clothing', 'PF0102', 45),
  ('clothing', 'PF0104', 46),
  ('clothing', 'PF0105', 47),
  ('clothing', 'PF0106', 48),
  ('clothing', 'SF0001', 49),
  ('clothing', 'PF0108', 50),
  ('clothing', 'SF0002', 51),
  ('clothing', 'SF0003', 52),
  ('clothing', 'SF0102', 53),
  ('clothing', 'CF1004', 54),
  ('clothing', 'CF1006', 55),
  ('clothing', 'CF1016', 56),
  ('clothing', 'CF1021', 57),
  ('clothing', 'CF1019', 58),
  ('clothing', 'BF9001', 59),
  ('clothing', 'BF9002', 60),
  ('clothing', 'BF9003', 61),
  ('clothing', 'BF9004', 62),
  ('clothing', 'BF9005', 63),
  ('clothing', 'CF1005', 64),
  ('clothing', 'CF1007', 65),
  ('clothing', 'CF1008', 66),
  ('clothing', 'CF1009', 67),
  ('clothing', 'CF1010', 68),
  ('clothing', 'CF1013', 69),
  ('clothing', 'CF1012', 70),
  ('clothing', 'CF1014', 71),
  ('clothing', 'CF1015', 72),
  ('clothing', 'CF1017', 73),
  ('clothing', 'CF2002', 74),
  ('clothing', 'CF2019', 75);

COMMIT;
