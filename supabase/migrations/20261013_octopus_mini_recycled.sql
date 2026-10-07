-- =============================================================================
-- 20261013_octopus_mini_recycled.sql — owner confirmed (9 Oct 2026): Octopus Mini
-- is made from recycled material reclaimed from the sea.
-- Badge "Compact" -> "Recycled"; sentence added to the description; feature
-- bullet added. Catalogue copy only. Rollback: .down.sql.
-- After applying: re-run the mirror + embed scripts (or wait for the crons).
-- =============================================================================

BEGIN;

UPDATE public.catalog_products
   SET badge = 'Recycled',
       description = replace(description,
         'for on-the-go charging. ',
         'for on-the-go charging. Made from recycled ocean-reclaimed material. ')
 WHERE slug = 'octopus-mini'
   AND description NOT LIKE '%ocean-reclaimed%';

INSERT INTO public.catalog_product_features (catalog_product_id, feature_text, sort_order)
SELECT p.id, 'Made from recycled ocean-reclaimed material', 1
  FROM public.catalog_products p
 WHERE p.slug = 'octopus-mini'
   AND NOT EXISTS (SELECT 1 FROM public.catalog_product_features f
                    WHERE f.catalog_product_id = p.id
                      AND f.feature_text = 'Made from recycled ocean-reclaimed material');

COMMIT;

-- Verify: expect badge = Recycled, in_description = true, feature_rows = 1.
SELECT p.badge,
       p.description LIKE '%Made from recycled ocean-reclaimed material.%' AS in_description,
       (SELECT count(*) FROM public.catalog_product_features f
         WHERE f.catalog_product_id = p.id
           AND f.feature_text = 'Made from recycled ocean-reclaimed material') AS feature_rows
  FROM public.catalog_products p WHERE p.slug = 'octopus-mini';
