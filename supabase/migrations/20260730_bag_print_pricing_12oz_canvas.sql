-- ============================================================================
-- PGifts Direct BAG print pricing - build-up-from-supplier-cost model.
-- First bag: 12oz Recycled Canvas Exhibition Bag. Structured so the NEXT bag
-- is a pure data seed (same shape), not a code change.
--
-- Two new tables, both keyed by catalog_product_id:
--   bag_print_pricing - supplier UNIT COST by (method, colour_group, qty band,
--                       colour_count[screen] | dtf_size+dtf_sides[dtf]).
--   bag_shipping      - flat shipping charge per order by qty band.
-- The build-up formula, margins (40/35), 15/colour screen charge and 0.20
-- second-side are SHARED POLICY in code (src/utils/bagPricing.js), not data.
--
-- Routing is data-driven: a product with bag_print_pricing rows uses the bag
-- model; every other flat product is unchanged. Black unit costs already carry
-- the underbase (no separate underbase charge). MOQ raised 25 -> 100.
--
-- APPLY (CLAUDE.md Sec 52): Supabase SQL Editor, paste, Run. No BEGIN/COMMIT.
-- Idempotent. Final SELECT must return 2 rows (screen 100, dtf 40) + shipping 6.
-- ============================================================================

-- 1. Tables -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bag_print_pricing (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_product_id uuid NOT NULL REFERENCES public.catalog_products(id) ON DELETE CASCADE,
  print_method       text NOT NULL CHECK (print_method IN ('screen','dtf')),
  colour_group       text NOT NULL CHECK (colour_group IN ('natural','black')),
  min_quantity       integer NOT NULL,
  max_quantity       integer,
  colour_count       integer CHECK (colour_count IS NULL OR (colour_count BETWEEN 1 AND 10)),
  dtf_size           text CHECK (dtf_size IS NULL OR dtf_size IN ('A4','A3')),
  dtf_sides          integer CHECK (dtf_sides IS NULL OR dtf_sides IN (1,2)),
  unit_cost          numeric(10,2) NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- screen rows carry colour_count; dtf rows carry size+sides. Never both.
  CONSTRAINT bag_print_pricing_shape CHECK (
    (print_method = 'screen' AND colour_count IS NOT NULL AND dtf_size IS NULL AND dtf_sides IS NULL)
    OR
    (print_method = 'dtf' AND colour_count IS NULL AND dtf_size IS NOT NULL AND dtf_sides IS NOT NULL)
  )
);
CREATE TABLE IF NOT EXISTS public.bag_shipping (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_product_id uuid NOT NULL REFERENCES public.catalog_products(id) ON DELETE CASCADE,
  min_quantity       integer NOT NULL,
  max_quantity       integer,
  charge             numeric(10,2) NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bag_print_pricing_product ON public.bag_print_pricing (catalog_product_id, print_method, colour_group);
CREATE INDEX IF NOT EXISTS idx_bag_shipping_product ON public.bag_shipping (catalog_product_id);

-- 2. RLS: public read (anon+authenticated), writes service-role only ---------
ALTER TABLE public.bag_print_pricing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bag_print_pricing_public_read" ON public.bag_print_pricing;
CREATE POLICY "bag_print_pricing_public_read" ON public.bag_print_pricing FOR SELECT TO anon, authenticated USING (true);
ALTER TABLE public.bag_shipping ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bag_shipping_public_read" ON public.bag_shipping;
CREATE POLICY "bag_shipping_public_read" ON public.bag_shipping FOR SELECT TO anon, authenticated USING (true);

-- 3. MOQ 25 -> 100 (cannot fulfil below 100 at the quoted price) --------------
UPDATE public.catalog_products SET min_order_quantity = 100 WHERE slug = '12oz-recycled-canvas';

-- 4. Seed 12oz Recycled Canvas cost rows (idempotent: clear this bag first) ---
DELETE FROM public.bag_print_pricing WHERE catalog_product_id = '820ff91a-7a5d-424a-99cf-13122967b6c2';
DELETE FROM public.bag_shipping WHERE catalog_product_id = '820ff91a-7a5d-424a-99cf-13122967b6c2';

-- natural screen (10 colours x 5 bands)
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',100,249,1,2.60);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',100,249,2,2.64);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',100,249,3,2.68);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',100,249,4,2.72);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',100,249,5,2.76);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',100,249,6,2.80);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',100,249,7,2.84);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',100,249,8,2.88);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',100,249,9,2.92);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',100,249,10,2.96);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',250,499,1,2.30);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',250,499,2,2.34);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',250,499,3,2.38);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',250,499,4,2.42);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',250,499,5,2.46);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',250,499,6,2.50);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',250,499,7,2.54);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',250,499,8,2.58);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',250,499,9,2.62);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',250,499,10,2.66);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',500,999,1,2.25);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',500,999,2,2.29);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',500,999,3,2.33);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',500,999,4,2.37);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',500,999,5,2.41);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',500,999,6,2.45);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',500,999,7,2.49);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',500,999,8,2.53);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',500,999,9,2.57);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',500,999,10,2.61);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',1000,2499,1,2.20);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',1000,2499,2,2.24);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',1000,2499,3,2.28);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',1000,2499,4,2.32);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',1000,2499,5,2.36);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',1000,2499,6,2.40);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',1000,2499,7,2.44);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',1000,2499,8,2.48);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',1000,2499,9,2.52);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',1000,2499,10,2.56);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',2500,NULL,1,2.15);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',2500,NULL,2,2.19);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',2500,NULL,3,2.23);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',2500,NULL,4,2.27);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',2500,NULL,5,2.31);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',2500,NULL,6,2.35);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',2500,NULL,7,2.39);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',2500,NULL,8,2.43);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',2500,NULL,9,2.47);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','natural',2500,NULL,10,2.51);
-- black screen (10 colours x 5 bands)
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',100,249,1,2.90);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',100,249,2,2.94);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',100,249,3,2.98);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',100,249,4,3.02);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',100,249,5,3.06);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',100,249,6,3.10);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',100,249,7,3.14);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',100,249,8,3.18);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',100,249,9,3.22);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',100,249,10,3.26);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',250,499,1,2.60);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',250,499,2,2.64);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',250,499,3,2.68);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',250,499,4,2.72);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',250,499,5,2.76);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',250,499,6,2.80);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',250,499,7,2.84);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',250,499,8,2.88);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',250,499,9,2.92);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',250,499,10,2.96);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',500,999,1,2.55);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',500,999,2,2.59);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',500,999,3,2.63);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',500,999,4,2.67);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',500,999,5,2.71);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',500,999,6,2.75);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',500,999,7,2.79);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',500,999,8,2.83);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',500,999,9,2.87);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',500,999,10,2.91);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',1000,2499,1,2.50);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',1000,2499,2,2.54);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',1000,2499,3,2.58);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',1000,2499,4,2.62);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',1000,2499,5,2.66);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',1000,2499,6,2.70);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',1000,2499,7,2.74);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',1000,2499,8,2.78);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',1000,2499,9,2.82);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',1000,2499,10,2.86);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',2500,NULL,1,2.45);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',2500,NULL,2,2.49);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',2500,NULL,3,2.53);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',2500,NULL,4,2.57);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',2500,NULL,5,2.61);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',2500,NULL,6,2.65);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',2500,NULL,7,2.69);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',2500,NULL,8,2.73);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',2500,NULL,9,2.77);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, colour_count, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','screen','black',2500,NULL,10,2.81);
-- natural dtf (A4/A3 x 1/2 sides x 5 bands)
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',100,249,'A4',1,3.23);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',100,249,'A4',2,4.36);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',100,249,'A3',1,4.36);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',100,249,'A3',2,6.62);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',250,499,'A4',1,3.07);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',250,499,'A4',2,4.04);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',250,499,'A3',1,4.04);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',250,499,'A3',2,5.98);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',500,999,'A4',1,3.01);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',500,999,'A4',2,3.92);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',500,999,'A3',1,3.92);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',500,999,'A3',2,5.74);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',1000,2499,'A4',1,2.93);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',1000,2499,'A4',2,3.76);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',1000,2499,'A3',1,3.78);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',1000,2499,'A3',2,5.46);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',2500,NULL,'A4',1,2.89);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',2500,NULL,'A4',2,3.68);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',2500,NULL,'A3',1,3.71);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','natural',2500,NULL,'A3',2,5.32);
-- black dtf (A4/A3 x 1/2 sides x 5 bands)
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',100,249,'A4',1,3.96);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',100,249,'A4',2,5.52);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',100,249,'A3',1,4.86);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',100,249,'A3',2,7.32);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',250,499,'A4',1,3.56);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',250,499,'A4',2,4.72);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',250,499,'A3',1,4.56);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',250,499,'A3',2,6.72);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',500,999,'A4',1,3.51);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',500,999,'A4',2,4.62);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',500,999,'A3',1,4.51);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',500,999,'A3',2,6.62);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',1000,2499,'A4',1,3.46);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',1000,2499,'A4',2,4.52);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',1000,2499,'A3',1,4.46);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',1000,2499,'A3',2,6.52);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',2500,NULL,'A4',1,3.41);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',2500,NULL,'A4',2,4.42);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',2500,NULL,'A3',1,4.41);
INSERT INTO public.bag_print_pricing (catalog_product_id, print_method, colour_group, min_quantity, max_quantity, dtf_size, dtf_sides, unit_cost) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2','dtf','black',2500,NULL,'A3',2,6.42);

-- shipping (flat per order). NB the supplier 12.00 @ 50 band is OMITTED:
-- MOQ is 100 so it is unreachable; seeding it could only confuse.
INSERT INTO public.bag_shipping (catalog_product_id, min_quantity, max_quantity, charge) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2',1,100,18.00);
INSERT INTO public.bag_shipping (catalog_product_id, min_quantity, max_quantity, charge) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2',101,200,28.00);
INSERT INTO public.bag_shipping (catalog_product_id, min_quantity, max_quantity, charge) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2',201,600,55.00);
INSERT INTO public.bag_shipping (catalog_product_id, min_quantity, max_quantity, charge) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2',601,1200,85.00);
INSERT INTO public.bag_shipping (catalog_product_id, min_quantity, max_quantity, charge) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2',1201,3600,170.00);
INSERT INTO public.bag_shipping (catalog_product_id, min_quantity, max_quantity, charge) VALUES ('820ff91a-7a5d-424a-99cf-13122967b6c2',3601,5000,170.00);

-- Seeded: 100 screen + 40 dtf = 140 price rows + 6 shipping.
-- Verification: expect (screen,100) (dtf,40) then shipping count 6.
SELECT print_method, COUNT(*) AS rows FROM public.bag_print_pricing WHERE catalog_product_id = '820ff91a-7a5d-424a-99cf-13122967b6c2' GROUP BY print_method ORDER BY print_method;
SELECT COUNT(*) AS shipping_rows FROM public.bag_shipping WHERE catalog_product_id = '820ff91a-7a5d-424a-99cf-13122967b6c2';
