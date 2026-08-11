-- edge-classic-test-price-A-apply.sql  — APPLY the temporary live-Stripe test price
--
-- Product: /pens/edge-classic
--   catalog_products.id       = 4599d846-9541-4bc8-8e9f-8748a228dfe7
--   pricing_model             = flat  (price is per-product per-quantity-tier;
--                                      NOT per colour — this affects all 8 colours)
--   min_order_quantity        = 100   (and the lowest tier's min_quantity = 100)
--
-- ORIGINAL VALUE BEING CHANGED (record of truth — restore with script B):
--   catalog_pricing_tiers row id 2b0f9691-7029-4610-8caa-2bd624363985
--   (min_quantity = 100)  price_per_unit = 0.90   <-- ORIGINAL
--
-- This sets ONLY that 100-unit tier to 0.01. An order at the MOQ of 100 then
-- totals £1.00 net + £0.20 VAT = £1.20 incl VAT (clears Stripe's 30p minimum).
-- The other tiers (250/500/1000/2000/5000) are left at their real prices, so a
-- larger order still charges the real amount — the exposure is one tier only.
--
-- Idempotent. No BEGIN/COMMIT. Ends with a verifying SELECT.

UPDATE public.catalog_pricing_tiers
   SET price_per_unit = 0.01
 WHERE id = '2b0f9691-7029-4610-8caa-2bd624363985';

-- OPTIONAL — smallest public exposure: hide the product from the /pens listing
-- and 404 the public direct URL, while you (admin) can still reach and buy it.
-- ORIGINAL status = 'active'. Uncomment to apply; script B reverts it.
-- UPDATE public.catalog_products SET status = 'draft' WHERE slug = 'edge-classic';

-- Verify which state you are in:
SELECT id, min_quantity, price_per_unit
  FROM public.catalog_pricing_tiers
 WHERE catalog_product_id = '4599d846-9541-4bc8-8e9f-8748a228dfe7'
 ORDER BY min_quantity;
--   expect the min_quantity = 100 row to show price_per_unit = 0.0100
SELECT slug, status FROM public.catalog_products WHERE slug = 'edge-classic';
--   'active' normally, or 'draft' if you uncommented the hide line
