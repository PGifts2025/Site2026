-- 20260804_bag_5oz_cotton.sql
-- Fifth and FINAL bag: 5oz Cotton Bag (/bags/5oz-cotton-bag).
--
-- Combines shipped mechanisms, NO code changes: two colour groups with per-group
-- second-side rates (as the 8oz, #96) + flat 40% margin and a 1000 ceiling (as
-- the 5oz Recycled, #95).
--
--   * Groups natural + coloured. This bag has NO white option (Dave confirmed);
--     Natural -> natural (cheaper), every other of the 17 colours -> coloured
--     (underbase) via the context-aware bagColourGroup() from #96. No per-colour
--     data needed.
--   * Second side: natural £0.20 (default), coloured £0.24 (Inc Base) via the
--     bag_group_second_side table from #96.
--   * Flat 40% margin (bag_flat_margin = 0.40); MOQ 100; quote ceiling 1000.
--   * Shipping 100-250 £12 / 251-500 £18 / 501-1000 £28 (matches 5oz Recycled;
--     verified against the sheet, not copied). Higher bands (£55/£85) omitted as
--     unreachable under the ceiling.
--
-- Self-contained: (re)creates bag_group_second_side IF NOT EXISTS so this
-- migration is order-independent (the table normally already exists from #96).
-- Idempotent. No BEGIN/COMMIT. Ends with verifying SELECTs.

-- 0. Ensure the per-group second-side table exists (created in #96; IF NOT
--    EXISTS keeps this migration self-sufficient on a fresh replay).
CREATE TABLE IF NOT EXISTS public.bag_group_second_side (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_product_id uuid NOT NULL REFERENCES public.catalog_products(id) ON DELETE CASCADE,
  colour_group       text NOT NULL,
  second_side_cost   numeric(10,4) NOT NULL,
  created_at         timestamptz DEFAULT now(),
  UNIQUE (catalog_product_id, colour_group)
);
ALTER TABLE public.bag_group_second_side ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bag_group_second_side_public_read" ON public.bag_group_second_side;
CREATE POLICY "bag_group_second_side_public_read" ON public.bag_group_second_side FOR SELECT TO anon, authenticated USING (true);

-- 1. Clear any prior rows for this product so re-runs are clean.
DELETE FROM bag_print_pricing WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag');
DELETE FROM bag_shipping WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag');
DELETE FROM bag_group_second_side WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag');

-- 2. Screen cost rows: natural + coloured, bands 100-249 and 250-1000, colours
--    1-10 (40 rows). Coloured includes the underbase. No DTF.
INSERT INTO bag_print_pricing
  (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, dtf_size, dtf_sides, unit_cost)
VALUES
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 100, 249, 1, NULL, NULL, 0.88),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 100, 249, 2, NULL, NULL, 0.92),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 100, 249, 3, NULL, NULL, 0.96),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 100, 249, 4, NULL, NULL, 1.00),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 100, 249, 5, NULL, NULL, 1.04),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 100, 249, 6, NULL, NULL, 1.08),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 100, 249, 7, NULL, NULL, 1.12),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 100, 249, 8, NULL, NULL, 1.16),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 100, 249, 9, NULL, NULL, 1.20),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 100, 249, 10, NULL, NULL, 1.24),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 250, 1000, 1, NULL, NULL, 0.58),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 250, 1000, 2, NULL, NULL, 0.62),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 250, 1000, 3, NULL, NULL, 0.66),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 250, 1000, 4, NULL, NULL, 0.70),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 250, 1000, 5, NULL, NULL, 0.74),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 250, 1000, 6, NULL, NULL, 0.78),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 250, 1000, 7, NULL, NULL, 0.82),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 250, 1000, 8, NULL, NULL, 0.86),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 250, 1000, 9, NULL, NULL, 0.90),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'natural', 250, 1000, 10, NULL, NULL, 0.94),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 100, 249, 1, NULL, NULL, 1.28),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 100, 249, 2, NULL, NULL, 1.32),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 100, 249, 3, NULL, NULL, 1.36),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 100, 249, 4, NULL, NULL, 1.40),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 100, 249, 5, NULL, NULL, 1.44),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 100, 249, 6, NULL, NULL, 1.48),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 100, 249, 7, NULL, NULL, 1.52),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 100, 249, 8, NULL, NULL, 1.56),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 100, 249, 9, NULL, NULL, 1.60),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 100, 249, 10, NULL, NULL, 1.64),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 250, 1000, 1, NULL, NULL, 0.95),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 250, 1000, 2, NULL, NULL, 0.99),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 250, 1000, 3, NULL, NULL, 1.03),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 250, 1000, 4, NULL, NULL, 1.07),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 250, 1000, 5, NULL, NULL, 1.11),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 250, 1000, 6, NULL, NULL, 1.15),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 250, 1000, 7, NULL, NULL, 1.19),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 250, 1000, 8, NULL, NULL, 1.23),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 250, 1000, 9, NULL, NULL, 1.27),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'screen', 'coloured', 250, 1000, 10, NULL, NULL, 1.31);

-- 3. Shipping: 100-250 GBP 12, 251-500 GBP 18, 501-1000 GBP 28.
INSERT INTO bag_shipping (catalog_product_id, min_quantity, max_quantity, charge)
VALUES
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 100, 250, 12.00),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 251, 500, 18.00),
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 501, 1000, 28.00);

-- 4. Per-group second side: coloured = GBP 0.24. Natural takes the GBP 0.20
--    default (no row), so the mechanism stays consistent with the 8oz.
INSERT INTO bag_group_second_side (catalog_product_id, colour_group, second_side_cost)
VALUES
((SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag'), 'coloured', 0.2400);

-- 5. Product policy: MOQ 100, quote ceiling 1000, flat 40% margin.
UPDATE catalog_products
   SET min_order_quantity = 100,
       bag_quote_ceiling = 1000,
       bag_flat_margin = 0.400
 WHERE slug = '5oz-cotton-bag';

-- 6. Verify.
SELECT print_method, count(*) AS rows FROM bag_print_pricing
 WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag') GROUP BY print_method;              -- screen | 40

SELECT colour_group, count(*) AS rows, min(unit_cost) AS min_cost, max(unit_cost) AS max_cost
  FROM bag_print_pricing WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag')
 GROUP BY colour_group ORDER BY colour_group;   -- coloured 20 (0.95-1.64), natural 20 (0.58-1.24)

SELECT count(*) AS shipping_rows FROM bag_shipping WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag');   -- 3

SELECT colour_group, second_side_cost FROM bag_group_second_side WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '5oz-cotton-bag');  -- coloured | 0.2400

SELECT slug, min_order_quantity, bag_quote_ceiling, bag_flat_margin
  FROM catalog_products WHERE slug = '5oz-cotton-bag';   -- 100 | 1000 | 0.400
