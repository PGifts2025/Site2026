-- 20261116_print_areas_and_category_seo.sql — CLAUDE.md §66.4, §66.5
--
-- 1. Print areas on the Specifications tab: owner's figures (16 Nov 2026)
--    replace the Xoopar-site figures from 20261116_xoopar_specifications.
--    Mr Bio PD Long was sent as "22m x 22m" — read as 22 × 22 mm.
-- 2. Search titles / descriptions for the 11 category pages
--    (catalog_categories.meta_title / meta_description, previously NULL),
--    used by the prerendered category pages and the tab title.
--    "Under £10" only where it is true for the category's products at
--    volume pricing (checked 16 Nov 2026; not used for Speakers, 2 of 6).
-- Rollback: 20261116_print_areas_and_category_seo.down.sql

BEGIN;

UPDATE public.catalog_product_specifications AS s
   SET specifications = jsonb_set(s.specifications, '{Print area}', to_jsonb(v.area)),
       updated_at = now()
  FROM public.catalog_products AS p,
       (VALUES
         ('ocean-octopus',  '22 × 22 mm'),
         ('mr-bio',         '22 × 22 mm'),
         ('octopus-mini',   '25 × 25 mm'),
         ('mr-bio-pd-long', '22 × 22 mm'),
         ('ice-p',          '40 × 35 mm'),
         ('gamma-lite',     '35 × 35 mm'),
         ('luggie',         'Front 15 × 35 mm; top 12 × 30 mm')
       ) AS v(slug, area)
 WHERE p.id = s.catalog_product_id
   AND p.slug = v.slug;

UPDATE public.catalog_categories AS c
   SET meta_title = v.t,
       meta_description = v.d
  FROM (VALUES
    ('bags', 'Promotional Bags & Branded Tote Bags | Promo Gifts',
     'Promotional bags printed with your logo: cotton tote bags, rucksacks, drawstring bags, cooler bags and paper gift bags. Corporate gifts, many under £10.'),
    ('cups', 'Promotional Mugs & Branded Cups | Promo Gifts',
     'Promotional mugs and cups printed with your logo: ceramic mugs, insulated travel mugs, tumblers and reusable coffee cups. Corporate gifts, many under £10.'),
    ('water-bottles', 'Promotional Water Bottles & Branded Flasks | Promo Gifts',
     'Promotional water bottles printed with your logo: stainless steel and insulated bottles, flasks, recycled plastic and glass bottles. Many under £10.'),
    ('clothing', 'Branded Clothing & Promotional Workwear | Promo Gifts',
     'Branded clothing printed with your logo: T-shirts, polo shirts, hoodies, sweatshirts, jackets, caps, beanies and aprons. Staff uniform and corporate gifts.'),
    ('hi-vis', 'Branded Hi Vis Vests & Safety Wear | Promo Gifts',
     'Hi vis vests printed with your logo, including an EN ISO 20471 vest, plus a reflective hi vis drawstring bag. Branded safety wear under £10.'),
    ('cables', 'Promotional Charging Cables & Branded Tech | Promo Gifts',
     'Promotional charging cables printed with your logo: multi-tip cables for Apple, Android and USB-C, keyring and reel chargers, including Xoopar. Under £10.'),
    ('power', 'Promotional Power Banks & Branded Chargers | Promo Gifts',
     'Promotional power banks and chargers printed with your logo: power banks, wireless chargers and a world travel adapter, including Xoopar. Corporate tech gifts.'),
    ('speakers', 'Promotional Speakers & Branded Earbuds | Promo Gifts',
     'Promotional Bluetooth speakers, wireless earbuds and headphones printed with your logo. Corporate tech gifts for clients and staff.'),
    ('pens', 'Promotional Pens & Branded Pencils | Promo Gifts',
     'Promotional pens printed with your logo: plastic, metal, premium, recycled and bamboo pens, pencils and colouring sets. Corporate gifts, many under £10.'),
    ('notebooks', 'Promotional Notebooks & Branded Stationery | Promo Gifts',
     'Promotional notebooks printed with your logo: A4, A5 and A6 notebooks, recycled and cork covers, and notebook and pen sets. Corporate gifts under £10.'),
    ('tea-towels', 'Promotional Printed Tea Towels | Promo Gifts',
     'Cotton tea towels printed with your design, for gift shops, charity fundraisers, heritage retail and hospitality. Promotional gifts under £10.')
  ) AS v(slug, t, d)
 WHERE c.slug = v.slug;

COMMIT;

-- Verify:
-- SELECT p.slug, s.specifications->>'Print area' FROM catalog_products p
--   JOIN catalog_product_specifications s ON s.catalog_product_id = p.id WHERE p.brand = 'Xoopar';
-- SELECT slug, length(meta_title), length(meta_description) FROM catalog_categories;  -- <=60 / <=160
