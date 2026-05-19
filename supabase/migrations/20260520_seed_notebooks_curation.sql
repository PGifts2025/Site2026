-- ============================================================================
-- Seed: Notebooks category curation (75 Laltex products).
--
-- Source: CC discovery probe — 79 raw candidates, 4 drops (NATURE SET, QS0022 Bookmark, QS0142 Bellybands, QS0370 Whiteboard Notepad). Final: 75 codes.
-- Sort: QS numeric suffix DESC with DUO variant surfaced first via lexicographic suffix tiebreaker.
--
-- Inserts into category_product_curation (CLAUDE.md §56). Positions start
-- at 1, increment by 1. No FK to supplier_products (graceful drop at fetch
-- time if a curated row references a retired/missing product, per §51 +
-- §56.3 invariants).
--
-- Apply via Supabase SQL Editor BEFORE merging the PR per CLAUDE.md §52.
-- Verify post-apply:
--   SELECT COUNT(*) FROM category_product_curation WHERE category_slug = 'notebooks';
--   -- expect: 75
-- ============================================================================

BEGIN;

INSERT INTO public.category_product_curation (category_slug, supplier_product_code, position) VALUES
  ('notebooks', 'QS3545', 1),
  ('notebooks', 'QS3345 DUO', 2),
  ('notebooks', 'QS3345', 3),
  ('notebooks', 'QS3000', 4),
  ('notebooks', 'QS2865 DUO', 5),
  ('notebooks', 'QS2865', 6),
  ('notebooks', 'QS2864 DUO', 7),
  ('notebooks', 'QS2864', 8),
  ('notebooks', 'QS2445', 9),
  ('notebooks', 'QS2345 DUO', 10),
  ('notebooks', 'QS2345', 11),
  ('notebooks', 'QS1690', 12),
  ('notebooks', 'QS1685', 13),
  ('notebooks', 'QS1681', 14),
  ('notebooks', 'QS1680', 15),
  ('notebooks', 'QS1545', 16),
  ('notebooks', 'QS1253', 17),
  ('notebooks', 'QS1201', 18),
  ('notebooks', 'QS1080', 19),
  ('notebooks', 'QS1055', 20),
  ('notebooks', 'QS1021', 21),
  ('notebooks', 'QS1020', 22),
  ('notebooks', 'QS1018', 23),
  ('notebooks', 'QS1012', 24),
  ('notebooks', 'QS1010', 25),
  ('notebooks', 'QS1000', 26),
  ('notebooks', 'QS0866 DUO', 27),
  ('notebooks', 'QS0866', 28),
  ('notebooks', 'QS0865 DUO', 29),
  ('notebooks', 'QS0865', 30),
  ('notebooks', 'QS0766 DUO', 31),
  ('notebooks', 'QS0766', 32),
  ('notebooks', 'QS0765 DUO', 33),
  ('notebooks', 'QS0765', 34),
  ('notebooks', 'QS0745', 35),
  ('notebooks', 'QS0669', 36),
  ('notebooks', 'QS0645', 37),
  ('notebooks', 'QS0555 DUO', 38),
  ('notebooks', 'QS0555', 39),
  ('notebooks', 'QS0545', 40),
  ('notebooks', 'QS0543', 41),
  ('notebooks', 'QS0459', 42),
  ('notebooks', 'QS0363', 43),
  ('notebooks', 'QS0362', 44),
  ('notebooks', 'QS0361', 45),
  ('notebooks', 'QS0355', 46),
  ('notebooks', 'QS0347', 47),
  ('notebooks', 'QS0346 DUO', 48),
  ('notebooks', 'QS0346', 49),
  ('notebooks', 'QS0345 DUO', 50),
  ('notebooks', 'QS0345', 51),
  ('notebooks', 'QS0344 DUO', 52),
  ('notebooks', 'QS0344', 53),
  ('notebooks', 'QS0325', 54),
  ('notebooks', 'QS0320', 55),
  ('notebooks', 'QS0318', 56),
  ('notebooks', 'QS0279', 57),
  ('notebooks', 'QS0258', 58),
  ('notebooks', 'QS0254', 59),
  ('notebooks', 'QS0253', 60),
  ('notebooks', 'QS0252', 61),
  ('notebooks', 'QS0245', 62),
  ('notebooks', 'QS0237', 63),
  ('notebooks', 'QS0225', 64),
  ('notebooks', 'QS0215', 65),
  ('notebooks', 'QS0145', 66),
  ('notebooks', 'QS0117', 67),
  ('notebooks', 'QS0102', 68),
  ('notebooks', 'QS0069', 69),
  ('notebooks', 'QS0042', 70),
  ('notebooks', 'QS0016 DUO', 71),
  ('notebooks', 'QS0016', 72),
  ('notebooks', 'QS0015 DUO', 73),
  ('notebooks', 'QS0015', 74),
  ('notebooks', 'QS0014', 75);

COMMIT;
