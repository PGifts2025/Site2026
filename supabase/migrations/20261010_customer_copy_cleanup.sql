-- =============================================================================
-- 20261010_customer_copy_cleanup.sql — customer-visible copy audit (9 Oct 2026)
--
-- edge-white description claimed it "sits between Edge Classic and Edge Silver
-- on price"; its tiers are identical to Edge Classic at every quantity, so the
-- clause is removed. Catalogue copy only. Rollback: .down.sql.
-- After applying: re-run the mirror + embed scripts (or wait for the crons).
-- =============================================================================

BEGIN;

UPDATE public.catalog_products
   SET description = replace(description,
         '; sits between Edge Classic and Edge Silver on price.', '.')
 WHERE slug = 'edge-white'
   AND description LIKE '%; sits between Edge Classic and Edge Silver on price.';

COMMIT;

-- Verify: expect claim_left = 0, ends_ok = true.
SELECT
  (SELECT count(*) FROM public.catalog_products WHERE description ILIKE '%on price%') AS claim_left,
  (SELECT description LIKE '%maximum logo contrast.' FROM public.catalog_products WHERE slug = 'edge-white') AS ends_ok;
