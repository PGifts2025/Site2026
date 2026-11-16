-- 20261116_xoopar_brand_and_seo.sql — CLAUDE.md §66
--
-- Owner request (16 Nov 2026): the seven Xoopar products carry the brand
-- in their name everywhere ("Xoopar Octopus Mini"), with search-ready
-- page titles and descriptions.
--
-- 1. catalog_products.brand (new, nullable text). Feeds schema.org
--    Product.brand in the prerendered product pages
--    (scripts/prerender-products.mjs). NULL = our own / unbranded.
-- 2. Rename the seven products, set brand = 'Xoopar', and fill the
--    existing (previously unused) meta_title / meta_description columns.
--    Meta descriptions use only facts that our records AND Xoopar's own
--    product pages agree on (no disputed recycled %, cable length or
--    wattage — see the PR).
-- 3. Ava's upsell context (ava_direct_product_context.product_name).
-- 4. Unpaid DRAFT quote lines for these products, so the customer's
--    quote, Stripe line and order show the new name. Paid orders keep
--    the name they were bought under (none exist for these products
--    today). quote_items_server_price only fires on quantity /
--    unit_price / product_id / taxable_net_unit, so prices are untouched.
--
-- Slugs (URLs) do NOT change. The PGifts Direct mirror (03:30 UTC cron)
-- and the embed cron (04:00) carry the new names into Ava's search.
-- Idempotent: every rename is guarded with NOT LIKE 'Xoopar %'.
-- Rollback: 20261116_xoopar_brand_and_seo.down.sql

BEGIN;

ALTER TABLE public.catalog_products ADD COLUMN IF NOT EXISTS brand text;
COMMENT ON COLUMN public.catalog_products.brand IS
  'Manufacturer brand (e.g. Xoopar). Part of the product name and published as schema.org Product.brand on the prerendered page (CLAUDE.md §66). NULL = own / unbranded.';

UPDATE public.catalog_products
   SET name = 'Xoopar ' || name
 WHERE slug IN ('octopus-mini','ocean-octopus','mr-bio','mr-bio-pd-long','ice-p','luggie','gamma-lite')
   AND name NOT LIKE 'Xoopar %';

UPDATE public.catalog_products AS p
   SET brand = 'Xoopar',
       meta_title = v.meta_title,
       meta_description = v.meta_description
  FROM (VALUES
    ('octopus-mini',
     'Xoopar Octopus Mini Branded Charging Cable | Promo Gifts',
     'Xoopar Octopus Mini: a compact multi-tip charging cable printed with your logo. USB and USB-C in, USB-C and Lightning out. Minimum order 25 units.'),
    ('ocean-octopus',
     'Xoopar Ocean Octopus Branded Charging Cable | Promo Gifts',
     'Xoopar Ocean Octopus: a multi-tip charging cable made with recycled plastic and printed with your logo. Charges USB-C, Lightning and Micro USB devices.'),
    ('mr-bio',
     'Xoopar Mr Bio Branded 3-in-1 Charging Cable | Promo Gifts',
     'Xoopar Mr Bio: a 3-in-1 charging cable printed with your logo. USB and USB-C in; Lightning, USB-C and Micro USB out. Minimum order 25 units.'),
    ('mr-bio-pd-long',
     'Xoopar Mr Bio PD Long 60W Charging Cable | Promo Gifts',
     'Xoopar Mr Bio PD Long: a fast charging cable, up to 60W over USB-C, printed with your logo. USB-C and Lightning outputs with data transfer. Minimum order 25.'),
    ('ice-p',
     'Xoopar Ice P Branded 5,000mAh Power Bank | Promo Gifts',
     'Xoopar Ice P: a 5,000mAh power bank with up to 15W fast charging and a touch LED light, printed with your logo. Minimum order 25 units.'),
    ('luggie',
     'Xoopar Luggie Branded World Travel Adapter | Promo Gifts',
     'Xoopar Luggie: a world travel adapter for 150+ countries with UK, EU, US and AUS plugs and two 25W USB-C ports, printed with your logo. Minimum order 25.'),
    ('gamma-lite',
     'Xoopar Gamma Lite Branded Power Bank | Promo Gifts',
     'Xoopar Gamma Lite: a 3,000mAh pocket power bank with a built-in USB-C and Lightning cable, printed with your logo. Minimum order 25 units.')
  ) AS v(slug, meta_title, meta_description)
 WHERE p.slug = v.slug;

UPDATE public.ava_direct_product_context
   SET product_name = 'Xoopar ' || product_name
 WHERE slug IN ('octopus-mini','ocean-octopus','mr-bio','mr-bio-pd-long','ice-p','luggie','gamma-lite')
   AND product_name NOT LIKE 'Xoopar %';

UPDATE public.quote_items AS qi
   SET product_name = 'Xoopar ' || qi.product_name
  FROM public.quotes AS q, public.catalog_products AS p
 WHERE q.id = qi.quote_id
   AND q.status = 'draft'
   AND p.id = qi.product_id
   AND p.slug IN ('octopus-mini','ocean-octopus','mr-bio','mr-bio-pd-long','ice-p','luggie','gamma-lite')
   AND qi.product_name NOT LIKE 'Xoopar %';

COMMIT;

-- Verify:
-- SELECT slug, name, brand, meta_title, length(meta_title) tl, length(meta_description) dl
--   FROM catalog_products WHERE brand = 'Xoopar' ORDER BY slug;            -- 7 rows, tl <= 60, dl <= 160
-- SELECT slug, product_name FROM ava_direct_product_context WHERE product_name LIKE 'Xoopar %';  -- 7 rows
-- SELECT count(*) FROM quote_items qi JOIN quotes q ON q.id = qi.quote_id
--  WHERE q.status = 'draft' AND qi.product_name LIKE 'Xoopar %';          -- 1
