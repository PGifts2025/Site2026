-- Rollback for 20261013_octopus_mini_recycled.sql.
BEGIN;

DELETE FROM public.catalog_product_features f
 USING public.catalog_products p
 WHERE p.id = f.catalog_product_id AND p.slug = 'octopus-mini'
   AND f.feature_text = 'Made from recycled ocean-reclaimed material';

UPDATE public.catalog_products
   SET badge = 'Compact',
       description = replace(description, ' Made from recycled ocean-reclaimed material.', '')
 WHERE slug = 'octopus-mini';

COMMIT;

-- Verify: expect badge = Compact, in_description = false.
SELECT badge, description LIKE '%ocean-reclaimed%' AS in_description
  FROM public.catalog_products WHERE slug = 'octopus-mini';
