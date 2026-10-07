-- Rollback for 20261010_customer_copy_cleanup.sql: restores the edge-white clause.
BEGIN;

UPDATE public.catalog_products
   SET description = regexp_replace(description, 'maximum logo contrast\.$',
         'maximum logo contrast; sits between Edge Classic and Edge Silver on price.')
 WHERE slug = 'edge-white'
   AND description LIKE '%maximum logo contrast.';

COMMIT;

-- Verify: expect claim_left = 1.
SELECT count(*) AS claim_left FROM public.catalog_products WHERE description ILIKE '%on price%';
