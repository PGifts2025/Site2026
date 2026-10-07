-- =============================================================================
-- 20261016_category_followups.sql — owner's approvals (9 Oct 2026)
--   1. Twister 8GB USB (a memory stick) removed from the Power page too.
--   2. Mr Bio PD Long: badge "Eco-Friendly" -> "Recycled" (its own data: 53%
--      GRS-certified recycled plastic) + that fact as a feature bullet.
-- Rollback: .down.sql.
-- After applying: re-run the mirror + embed scripts (or wait for the crons).
-- =============================================================================

BEGIN;

DELETE FROM public.category_product_curation
 WHERE id = 715 AND category_slug = 'power' AND supplier_product_code = 'ZU0501BK';

UPDATE public.catalog_products SET badge = 'Recycled' WHERE slug = 'mr-bio-pd-long';

INSERT INTO public.catalog_product_features (catalog_product_id, feature_text, sort_order)
SELECT p.id, '53% GRS-certified recycled plastic', 3
  FROM public.catalog_products p
 WHERE p.slug = 'mr-bio-pd-long'
   AND NOT EXISTS (SELECT 1 FROM public.catalog_product_features f
                    WHERE f.catalog_product_id = p.id
                      AND f.feature_text = '53% GRS-certified recycled plastic');

COMMIT;

-- Verify: expect usb_on_power = 0, badge = Recycled, feature_rows = 1.
SELECT
  (SELECT count(*) FROM public.category_product_curation
    WHERE category_slug = 'power' AND supplier_product_code = 'ZU0501BK') AS usb_on_power,
  (SELECT badge FROM public.catalog_products WHERE slug = 'mr-bio-pd-long') AS badge,
  (SELECT count(*) FROM public.catalog_product_features f JOIN public.catalog_products p ON p.id = f.catalog_product_id
    WHERE p.slug = 'mr-bio-pd-long' AND f.feature_text = '53% GRS-certified recycled plastic') AS feature_rows;
