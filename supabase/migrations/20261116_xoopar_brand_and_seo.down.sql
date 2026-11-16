-- Rollback for 20261116_xoopar_brand_and_seo.sql
-- Restores the pre-Xoopar names and clears the meta fields. Draft quote
-- lines are only un-renamed while still draft (a paid line keeps the
-- name it was bought under). Drops the brand column last.

BEGIN;

UPDATE public.catalog_products
   SET name = substring(name FROM 8),
       meta_title = NULL,
       meta_description = NULL
 WHERE slug IN ('octopus-mini','ocean-octopus','mr-bio','mr-bio-pd-long','ice-p','luggie','gamma-lite')
   AND name LIKE 'Xoopar %';

UPDATE public.ava_direct_product_context
   SET product_name = substring(product_name FROM 8)
 WHERE slug IN ('octopus-mini','ocean-octopus','mr-bio','mr-bio-pd-long','ice-p','luggie','gamma-lite')
   AND product_name LIKE 'Xoopar %';

UPDATE public.quote_items AS qi
   SET product_name = substring(qi.product_name FROM 8)
  FROM public.quotes AS q, public.catalog_products AS p
 WHERE q.id = qi.quote_id
   AND q.status = 'draft'
   AND p.id = qi.product_id
   AND p.slug IN ('octopus-mini','ocean-octopus','mr-bio','mr-bio-pd-long','ice-p','luggie','gamma-lite')
   AND qi.product_name LIKE 'Xoopar %';

ALTER TABLE public.catalog_products DROP COLUMN IF EXISTS brand;

COMMIT;
