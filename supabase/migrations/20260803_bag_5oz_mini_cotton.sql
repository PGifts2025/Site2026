-- 20260803_bag_5oz_mini_cotton.sql
-- Second bag: 5oz Mini Cotton Bag (/bags/5oz-mini-cotton-bag).
--
-- Differs from the 12oz Recycled Canvas:
--   * Screen print only (NO DTF rows -> the Print Method toggle is hidden).
--   * Colour groups Natural + White (not Natural + Black).
--   * NATURAL is the DEARER group: natural cotton has visible flecks and needs
--     the opaque underbase, white does not. This is the reverse of the supplier
--     sheet's labelling and is DELIBERATE (Dave confirmed). Do NOT "correct" it.
--   * Flat 40% margin at every quantity (bag_flat_margin = 0.400), no 35% break.
--   * Two quantity bands only: 100-249 and 250-1000.
--   * MOQ 100; quote ceiling 1000 (above it the site shows contact-us, no price).
--
-- Idempotent: re-running deletes this product's bag rows and re-applies policy.
-- Apply via Supabase SQL Editor (no BEGIN/COMMIT). The final SELECTs must show
-- screen=40, shipping_rows=2, and (100, 1000, 0.400).

-- 1. Per-product bag policy columns (nullable; NULL = current 12oz behaviour).
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS bag_quote_ceiling INTEGER;
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS bag_flat_margin NUMERIC(4,3);
COMMENT ON COLUMN catalog_products.bag_quote_ceiling IS 'Bag pricing: max quotable qty; above it the product page shows a contact-us message instead of a price and disables Add to Quote. NULL = no ceiling.';
COMMENT ON COLUMN catalog_products.bag_flat_margin IS 'Bag pricing: flat margin applied at every quantity (e.g. 0.400 = 40%). NULL = default 40%/35% schedule in src/utils/bagPricing.js.';

-- 2. Clear any prior 5oz bag rows so re-runs are clean.
DELETE FROM bag_print_pricing WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag');
DELETE FROM bag_shipping WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag');

-- 3. Screen cost rows: natural + white, bands 100-249 and 250-1000, colours 1-10
--    (40 rows). Natural is the dearer (underbase) group. No DTF.
INSERT INTO bag_print_pricing
  (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, dtf_size, dtf_sides, unit_cost)
VALUES
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 100, 249, 1, NULL, NULL, 0.95),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 100, 249, 2, NULL, NULL, 0.99),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 100, 249, 3, NULL, NULL, 1.03),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 100, 249, 4, NULL, NULL, 1.07),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 100, 249, 5, NULL, NULL, 1.11),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 100, 249, 6, NULL, NULL, 1.15),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 100, 249, 7, NULL, NULL, 1.19),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 100, 249, 8, NULL, NULL, 1.23),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 100, 249, 9, NULL, NULL, 1.27),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 100, 249, 10, NULL, NULL, 1.31),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 250, 1000, 1, NULL, NULL, 0.75),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 250, 1000, 2, NULL, NULL, 0.79),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 250, 1000, 3, NULL, NULL, 0.83),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 250, 1000, 4, NULL, NULL, 0.87),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 250, 1000, 5, NULL, NULL, 0.91),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 250, 1000, 6, NULL, NULL, 0.95),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 250, 1000, 7, NULL, NULL, 0.99),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 250, 1000, 8, NULL, NULL, 1.03),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 250, 1000, 9, NULL, NULL, 1.07),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'natural', 250, 1000, 10, NULL, NULL, 1.11),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 100, 249, 1, NULL, NULL, 0.85),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 100, 249, 2, NULL, NULL, 0.89),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 100, 249, 3, NULL, NULL, 0.93),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 100, 249, 4, NULL, NULL, 0.97),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 100, 249, 5, NULL, NULL, 1.01),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 100, 249, 6, NULL, NULL, 1.05),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 100, 249, 7, NULL, NULL, 1.09),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 100, 249, 8, NULL, NULL, 1.13),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 100, 249, 9, NULL, NULL, 1.17),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 100, 249, 10, NULL, NULL, 1.21),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 250, 1000, 1, NULL, NULL, 0.55),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 250, 1000, 2, NULL, NULL, 0.59),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 250, 1000, 3, NULL, NULL, 0.63),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 250, 1000, 4, NULL, NULL, 0.67),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 250, 1000, 5, NULL, NULL, 0.71),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 250, 1000, 6, NULL, NULL, 0.75),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 250, 1000, 7, NULL, NULL, 0.79),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 250, 1000, 8, NULL, NULL, 0.83),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 250, 1000, 9, NULL, NULL, 0.87),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 'screen', 'white', 250, 1000, 10, NULL, NULL, 0.91);

-- 4. Shipping: flat per order. 100-500 GBP 12.00, 501-1000 GBP 18.00. The sheet's
--    higher bands (1001-2000 GBP 28, 2001-4000 GBP 55, 4000+ GBP 85) are
--    unreachable under the 1000 quote ceiling and are DELIBERATELY OMITTED.
INSERT INTO bag_shipping (catalog_product_id, min_quantity, max_quantity, charge)
VALUES
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 100, 500, 12.00),
((SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag'), 501, 1000, 18.00);

-- 5. Product policy: MOQ 100, quote ceiling 1000, flat 40% margin. The 250+ cost
--    band's max_quantity is set to 1000 to match the ceiling (nothing quotes above).
UPDATE catalog_products
   SET min_order_quantity = 100,
       bag_quote_ceiling = 1000,
       bag_flat_margin = 0.400
 WHERE slug = '5oz-mini-cotton-bag';

-- 6. Verify.
SELECT print_method, count(*) AS rows
  FROM bag_print_pricing
 WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag')
 GROUP BY print_method;                              -- expect: screen | 40

SELECT count(*) AS shipping_rows
  FROM bag_shipping
 WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '5oz-mini-cotton-bag');                  -- expect: 2

SELECT slug, min_order_quantity, bag_quote_ceiling, bag_flat_margin
  FROM catalog_products
 WHERE slug = '5oz-mini-cotton-bag';                 -- expect: 100 | 1000 | 0.400
