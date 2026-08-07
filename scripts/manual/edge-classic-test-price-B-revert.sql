-- edge-classic-test-price-B-revert.sql  — REVERT to the original price (run after testing)
--
-- Product: /pens/edge-classic
--   catalog_products.id = 4599d846-9541-4bc8-8e9f-8748a228dfe7
--
-- ORIGINAL VALUES restored below (literal, standalone — this script does NOT
-- depend on any saved variable or backup; it works days later on its own):
--   catalog_pricing_tiers row id 2b0f9691-7029-4610-8caa-2bd624363985
--   (min_quantity = 100)  price_per_unit = 0.90   <-- restored here
--   catalog_products.status = 'active'             <-- restored here
--
-- The other tiers were never changed by script A, so nothing else needs
-- restoring. (Full original tier set, for the record:
--   min_qty 100 -> 0.90, 250 -> 0.52, 500 -> 0.38, 1000 -> 0.30,
--   2000 -> 0.24, 5000 -> 0.18.)
--
-- Idempotent. No BEGIN/COMMIT. Ends with a verifying SELECT.

UPDATE public.catalog_pricing_tiers
   SET price_per_unit = 0.90
 WHERE id = '2b0f9691-7029-4610-8caa-2bd624363985';

-- Restore visibility (harmless if it was never hidden — sets it to the original).
UPDATE public.catalog_products
   SET status = 'active'
 WHERE slug = 'edge-classic';

-- Verify the product is back to normal:
SELECT id, min_quantity, price_per_unit
  FROM public.catalog_pricing_tiers
 WHERE catalog_product_id = '4599d846-9541-4bc8-8e9f-8748a228dfe7'
 ORDER BY min_quantity;
--   expect: 100->0.90, 250->0.52, 500->0.38, 1000->0.30, 2000->0.24, 5000->0.18
SELECT slug, status FROM public.catalog_products WHERE slug = 'edge-classic';
--   expect: edge-classic | active
