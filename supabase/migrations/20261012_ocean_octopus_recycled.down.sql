-- Rollback for 20261012_ocean_octopus_recycled.sql.
BEGIN;

DELETE FROM public.catalog_product_features f
 USING public.catalog_products p
 WHERE p.id = f.catalog_product_id AND p.slug = 'ocean-octopus'
   AND f.feature_text = 'Made from recycled ocean-reclaimed material';

UPDATE public.catalog_products
   SET badge = 'Our Pick',
       description = replace(description, ' Made from recycled ocean-reclaimed material.', '')
 WHERE slug = 'ocean-octopus';

COMMIT;

-- Verify: expect badge = Our Pick, in_description = false.
SELECT badge, description LIKE '%ocean-reclaimed%' AS in_description
  FROM public.catalog_products WHERE slug = 'ocean-octopus';
