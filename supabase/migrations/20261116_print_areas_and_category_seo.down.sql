-- Rollback for 20261116_print_areas_and_category_seo.sql
-- Restores the print areas from 20261116_xoopar_specifications.sql and
-- clears the category meta fields (they were NULL before).

BEGIN;

UPDATE public.catalog_product_specifications AS s
   SET specifications = jsonb_set(s.specifications, '{Print area}', to_jsonb(v.area)),
       updated_at = now()
  FROM public.catalog_products AS p,
       (VALUES
         ('ocean-octopus',  '24 × 23 mm'),
         ('mr-bio',         '25 × 25 mm'),
         ('octopus-mini',   '18 × 18 mm'),
         ('mr-bio-pd-long', '27 × 27 mm'),
         ('ice-p',          '40 × 35 mm'),
         ('gamma-lite',     '30 × 30 mm'),
         ('luggie',         '15 × 40 mm')
       ) AS v(slug, area)
 WHERE p.id = s.catalog_product_id
   AND p.slug = v.slug;

UPDATE public.catalog_categories
   SET meta_title = NULL, meta_description = NULL
 WHERE slug IN ('bags','cups','water-bottles','clothing','hi-vis','cables','power','speakers','pens','notebooks','tea-towels');

COMMIT;
