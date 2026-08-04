-- 20260804_bag_5oz_recycled_cotton.sql
-- Third bag: 5oz Recycled Cotton Bag (/bags/5oz-recycled-cotton-bag).
--
-- Follows the 5oz Mini Cotton Bag pattern (screen-only, flat 40% margin, MOQ 100,
-- quote ceiling 1000) with NO code changes -- all machinery shipped in #92.
--
-- ONE structural difference vs the 5oz Mini: natural and white share ONE cost
-- table. The supplier sheet has a single (natural) table with no separate
-- underbase pricing; Dave confirms this recycled cotton is clean and needs NO
-- white base on either colour. So both colour groups are seeded with IDENTICAL
-- costs. (The colour_group CHECK was dropped in #94; even pre-#94 the #92
-- widening already admitted 'white', so no constraint handling is needed here.)
--
-- Shipping differs from BOTH prior bags: 100-250 GBP 12, 251-500 GBP 18,
-- 501-1000 GBP 28. Do NOT copy the 5oz Mini's shipping (12/18 at different
-- boundaries).
--
-- Idempotent: re-running deletes this product's bag rows and re-applies policy.
-- Apply via Supabase SQL Editor (no BEGIN/COMMIT). The three final SELECTs must
-- show screen=40, shipping_rows=3, and (100, 1000, 0.400).

-- 1. Clear any prior rows for this product so re-runs are clean.
DELETE FROM bag_print_pricing WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag');
DELETE FROM bag_shipping WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag');

-- 2. Screen cost rows: natural + white with IDENTICAL costs, bands 100-249 and
--    250-1000, colours 1-10 (40 rows). No underbase, no DTF.
INSERT INTO bag_print_pricing
  (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, dtf_size, dtf_sides, unit_cost)
VALUES
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 100, 249, 1, NULL, NULL, 1.08),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 100, 249, 2, NULL, NULL, 1.12),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 100, 249, 3, NULL, NULL, 1.16),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 100, 249, 4, NULL, NULL, 1.20),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 100, 249, 5, NULL, NULL, 1.24),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 100, 249, 6, NULL, NULL, 1.28),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 100, 249, 7, NULL, NULL, 1.32),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 100, 249, 8, NULL, NULL, 1.36),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 100, 249, 9, NULL, NULL, 1.40),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 100, 249, 10, NULL, NULL, 1.44),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 250, 1000, 1, NULL, NULL, 0.78),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 250, 1000, 2, NULL, NULL, 0.82),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 250, 1000, 3, NULL, NULL, 0.86),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 250, 1000, 4, NULL, NULL, 0.90),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 250, 1000, 5, NULL, NULL, 0.94),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 250, 1000, 6, NULL, NULL, 0.98),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 250, 1000, 7, NULL, NULL, 1.02),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 250, 1000, 8, NULL, NULL, 1.06),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 250, 1000, 9, NULL, NULL, 1.10),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'natural', 250, 1000, 10, NULL, NULL, 1.14),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 100, 249, 1, NULL, NULL, 1.08),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 100, 249, 2, NULL, NULL, 1.12),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 100, 249, 3, NULL, NULL, 1.16),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 100, 249, 4, NULL, NULL, 1.20),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 100, 249, 5, NULL, NULL, 1.24),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 100, 249, 6, NULL, NULL, 1.28),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 100, 249, 7, NULL, NULL, 1.32),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 100, 249, 8, NULL, NULL, 1.36),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 100, 249, 9, NULL, NULL, 1.40),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 100, 249, 10, NULL, NULL, 1.44),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 250, 1000, 1, NULL, NULL, 0.78),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 250, 1000, 2, NULL, NULL, 0.82),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 250, 1000, 3, NULL, NULL, 0.86),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 250, 1000, 4, NULL, NULL, 0.90),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 250, 1000, 5, NULL, NULL, 0.94),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 250, 1000, 6, NULL, NULL, 0.98),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 250, 1000, 7, NULL, NULL, 1.02),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 250, 1000, 8, NULL, NULL, 1.06),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 250, 1000, 9, NULL, NULL, 1.10),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 'screen', 'white', 250, 1000, 10, NULL, NULL, 1.14);

-- 3. Shipping: flat per order. 100-250 GBP 12.00, 251-500 GBP 18.00,
--    501-1000 GBP 28.00. The sheet's higher bands (GBP 55 @ ~2000, GBP 85 above
--    ~2500) are unreachable under the 1000 quote ceiling and are OMITTED.
INSERT INTO bag_shipping (catalog_product_id, min_quantity, max_quantity, charge)
VALUES
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 100, 250, 12.00),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 251, 500, 18.00),
((SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag'), 501, 1000, 28.00);

-- 4. Product policy: MOQ 100, quote ceiling 1000, flat 40% margin. The 250+ cost
--    band's max_quantity is 1000 to match the ceiling (nothing quotes above).
UPDATE catalog_products
   SET min_order_quantity = 100,
       bag_quote_ceiling = 1000,
       bag_flat_margin = 0.400
 WHERE slug = '5oz-recycled-cotton-bag';

-- 5. Verify.
SELECT print_method, count(*) AS rows
  FROM bag_print_pricing
 WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag')
 GROUP BY print_method;                              -- expect: screen | 40

SELECT count(*) AS shipping_rows
  FROM bag_shipping
 WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag');                  -- expect: 3

SELECT slug, min_order_quantity, bag_quote_ceiling, bag_flat_margin
  FROM catalog_products
 WHERE slug = '5oz-recycled-cotton-bag';             -- expect: 100 | 1000 | 0.400

-- Natural and white must carry identical costs (20 rows each, same unit_cost set):
SELECT colour_group, count(*) AS rows, min(unit_cost) AS min_cost, max(unit_cost) AS max_cost
  FROM bag_print_pricing
 WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '5oz-recycled-cotton-bag')
 GROUP BY colour_group ORDER BY colour_group;        -- expect: natural & white, both 20 | 0.78 | 1.44
