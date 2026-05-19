-- ============================================================================
-- DOWN migration — reverses 20260519_category_product_curation.sql.
--
-- Drops the seeded rows (the table DROP handles them) and the table itself.
-- The RLS policy is implicitly removed by the table drop; no separate DROP
-- POLICY needed. The index is implicitly removed by the table drop too.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS public.category_product_curation;

COMMIT;
