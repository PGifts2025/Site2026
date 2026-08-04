-- 20260804_bag_8oz_canvas.sql
-- Fourth bag: 8oz Canvas Bag (/bags/8oz-canvas).
--
-- Follows the 12oz pattern: five quantity bands, two genuinely different cost
-- tables, and the default 40/35 margin break (bag_flat_margin stays NULL). MOQ
-- 100, quote ceiling 2500. Screen only (no DTF).
--
-- TWO new mechanisms (code shipped alongside this migration):
--   1. Colour groups are 'natural' and 'coloured'. Natural + White take the
--      cheaper 'natural' table; Black, Grey, Navy, Red, Royal take 'coloured'.
--      bagColourGroup() is now context-aware (resolves against the groups a
--      product seeds), so White -> natural here while White -> white on the 5oz
--      bags. No per-colour data needed.
--   2. Second-side cost varies by colour group: natural £0.20, coloured £0.24
--      ("Inc Base" -- the underbase on the second side). Stored in the new
--      bag_group_second_side table; absent (product, group) defaults to £0.20,
--      so the three earlier bags are untouched with no rows.
--
-- Idempotent. No BEGIN/COMMIT. Ends with verifying SELECTs. colour_group CHECK
-- was dropped in #94, so 'coloured' needs no constraint work.

-- 1. Per-(product, colour_group) second-side cost. Absent => £0.20 default in
--    src/utils/bagPricing.js (bagUnitPrice secondSideCost). RLS mirrors
--    bag_print_pricing (public read; service-role writes bypass RLS).
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
COMMENT ON TABLE public.bag_group_second_side IS 'Per-(product, colour_group) second-side print cost. Absent row => £0.20 default (bagPricing.js). Do not add rows for the £0.20 default groups.';

-- 2. Clear any prior 8oz bag rows so re-runs are clean.
DELETE FROM bag_print_pricing WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '8oz-canvas');
DELETE FROM bag_shipping WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '8oz-canvas');
DELETE FROM bag_group_second_side WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '8oz-canvas');

-- 3. Screen cost rows: natural + coloured, 5 bands, colours 1-10 (100 rows).
--    Coloured includes the under base colour. No DTF.
INSERT INTO bag_print_pricing
  (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, dtf_size, dtf_sides, unit_cost)
VALUES
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 100, 249, 1, NULL, NULL, 1.50),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 100, 249, 2, NULL, NULL, 1.54),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 100, 249, 3, NULL, NULL, 1.58),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 100, 249, 4, NULL, NULL, 1.62),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 100, 249, 5, NULL, NULL, 1.66),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 100, 249, 6, NULL, NULL, 1.70),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 100, 249, 7, NULL, NULL, 1.74),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 100, 249, 8, NULL, NULL, 1.78),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 100, 249, 9, NULL, NULL, 1.82),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 100, 249, 10, NULL, NULL, 1.86),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 250, 499, 1, NULL, NULL, 1.20),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 250, 499, 2, NULL, NULL, 1.24),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 250, 499, 3, NULL, NULL, 1.28),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 250, 499, 4, NULL, NULL, 1.32),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 250, 499, 5, NULL, NULL, 1.36),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 250, 499, 6, NULL, NULL, 1.40),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 250, 499, 7, NULL, NULL, 1.44),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 250, 499, 8, NULL, NULL, 1.48),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 250, 499, 9, NULL, NULL, 1.52),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 250, 499, 10, NULL, NULL, 1.56),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 500, 999, 1, NULL, NULL, 1.19),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 500, 999, 2, NULL, NULL, 1.23),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 500, 999, 3, NULL, NULL, 1.27),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 500, 999, 4, NULL, NULL, 1.31),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 500, 999, 5, NULL, NULL, 1.35),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 500, 999, 6, NULL, NULL, 1.39),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 500, 999, 7, NULL, NULL, 1.43),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 500, 999, 8, NULL, NULL, 1.47),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 500, 999, 9, NULL, NULL, 1.51),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 500, 999, 10, NULL, NULL, 1.55),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 1000, 2499, 1, NULL, NULL, 1.18),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 1000, 2499, 2, NULL, NULL, 1.22),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 1000, 2499, 3, NULL, NULL, 1.26),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 1000, 2499, 4, NULL, NULL, 1.30),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 1000, 2499, 5, NULL, NULL, 1.34),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 1000, 2499, 6, NULL, NULL, 1.38),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 1000, 2499, 7, NULL, NULL, 1.42),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 1000, 2499, 8, NULL, NULL, 1.46),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 1000, 2499, 9, NULL, NULL, 1.50),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 1000, 2499, 10, NULL, NULL, 1.54),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 2500, 2500, 1, NULL, NULL, 1.15),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 2500, 2500, 2, NULL, NULL, 1.19),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 2500, 2500, 3, NULL, NULL, 1.23),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 2500, 2500, 4, NULL, NULL, 1.27),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 2500, 2500, 5, NULL, NULL, 1.31),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 2500, 2500, 6, NULL, NULL, 1.35),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 2500, 2500, 7, NULL, NULL, 1.39),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 2500, 2500, 8, NULL, NULL, 1.43),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 2500, 2500, 9, NULL, NULL, 1.47),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'natural', 2500, 2500, 10, NULL, NULL, 1.51),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 100, 249, 1, NULL, NULL, 1.85),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 100, 249, 2, NULL, NULL, 1.89),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 100, 249, 3, NULL, NULL, 1.93),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 100, 249, 4, NULL, NULL, 1.97),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 100, 249, 5, NULL, NULL, 2.01),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 100, 249, 6, NULL, NULL, 2.05),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 100, 249, 7, NULL, NULL, 2.09),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 100, 249, 8, NULL, NULL, 2.13),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 100, 249, 9, NULL, NULL, 2.17),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 100, 249, 10, NULL, NULL, 2.21),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 250, 499, 1, NULL, NULL, 1.54),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 250, 499, 2, NULL, NULL, 1.58),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 250, 499, 3, NULL, NULL, 1.62),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 250, 499, 4, NULL, NULL, 1.66),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 250, 499, 5, NULL, NULL, 1.70),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 250, 499, 6, NULL, NULL, 1.74),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 250, 499, 7, NULL, NULL, 1.78),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 250, 499, 8, NULL, NULL, 1.82),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 250, 499, 9, NULL, NULL, 1.86),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 250, 499, 10, NULL, NULL, 1.90),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 500, 999, 1, NULL, NULL, 1.52),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 500, 999, 2, NULL, NULL, 1.56),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 500, 999, 3, NULL, NULL, 1.60),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 500, 999, 4, NULL, NULL, 1.64),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 500, 999, 5, NULL, NULL, 1.68),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 500, 999, 6, NULL, NULL, 1.72),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 500, 999, 7, NULL, NULL, 1.76),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 500, 999, 8, NULL, NULL, 1.80),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 500, 999, 9, NULL, NULL, 1.84),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 500, 999, 10, NULL, NULL, 1.88),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 1000, 2499, 1, NULL, NULL, 1.50),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 1000, 2499, 2, NULL, NULL, 1.54),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 1000, 2499, 3, NULL, NULL, 1.58),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 1000, 2499, 4, NULL, NULL, 1.62),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 1000, 2499, 5, NULL, NULL, 1.66),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 1000, 2499, 6, NULL, NULL, 1.70),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 1000, 2499, 7, NULL, NULL, 1.74),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 1000, 2499, 8, NULL, NULL, 1.78),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 1000, 2499, 9, NULL, NULL, 1.82),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 1000, 2499, 10, NULL, NULL, 1.86),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 2500, 2500, 1, NULL, NULL, 1.48),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 2500, 2500, 2, NULL, NULL, 1.52),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 2500, 2500, 3, NULL, NULL, 1.56),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 2500, 2500, 4, NULL, NULL, 1.60),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 2500, 2500, 5, NULL, NULL, 1.64),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 2500, 2500, 6, NULL, NULL, 1.68),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 2500, 2500, 7, NULL, NULL, 1.72),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 2500, 2500, 8, NULL, NULL, 1.76),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 2500, 2500, 9, NULL, NULL, 1.80),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'screen', 'coloured', 2500, 2500, 10, NULL, NULL, 1.84);

-- 4. Shipping: flat per order. Note the FIRST band is a SINGLE quantity
--    (exactly 100 = GBP 12); 101 upwards is GBP 18. The GBP 55/85 (@2000/4000)
--    higher bands are unreachable under the 2500 ceiling and are OMITTED.
INSERT INTO bag_shipping (catalog_product_id, min_quantity, max_quantity, charge)
VALUES
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 100, 100, 12.00),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 101, 249, 18.00),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 250, 499, 28.00),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 500, 999, 55.00),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 1000, 2499, 85.00),
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 2500, 2500, 170.00);

-- 5. Per-group second side: coloured = GBP 0.24 (underbase on the 2nd side).
--    Natural takes the GBP 0.20 default, so NO natural row (keeps intent clear).
INSERT INTO bag_group_second_side (catalog_product_id, colour_group, second_side_cost)
VALUES
((SELECT id FROM catalog_products WHERE slug = '8oz-canvas'), 'coloured', 0.2400);

-- 6. Product policy: MOQ 100, quote ceiling 2500, DEFAULT 40/35 margin
--    (bag_flat_margin stays NULL). 2500+ cost band max_quantity = 2500 = ceiling.
UPDATE catalog_products
   SET min_order_quantity = 100,
       bag_quote_ceiling = 2500,
       bag_flat_margin = NULL
 WHERE slug = '8oz-canvas';

-- 7. Verify.
SELECT print_method, count(*) AS rows
  FROM bag_print_pricing WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '8oz-canvas')
 GROUP BY print_method;                              -- expect: screen | 100

SELECT colour_group, count(*) AS rows, min(unit_cost) AS min_cost, max(unit_cost) AS max_cost
  FROM bag_print_pricing WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '8oz-canvas')
 GROUP BY colour_group ORDER BY colour_group;        -- natural 50 (1.15-1.86), coloured 50 (1.48-2.21)

SELECT count(*) AS shipping_rows FROM bag_shipping WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '8oz-canvas');   -- expect 6

SELECT colour_group, second_side_cost FROM bag_group_second_side WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = '8oz-canvas');  -- coloured | 0.2400

SELECT slug, min_order_quantity, bag_quote_ceiling, bag_flat_margin
  FROM catalog_products WHERE slug = '8oz-canvas';   -- expect: 100 | 2500 | NULL
