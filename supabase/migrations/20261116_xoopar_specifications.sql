-- 20261116_xoopar_specifications.sql — CLAUDE.md §66.4
--
-- Owner decisions (16 Nov 2026):
--  * Keep our own product descriptions (they came from Xoopar's info to us).
--  * Fill the empty Specifications tab with facts from Xoopar's OFFICIAL
--    product pages (xoopar.fr/gb, xoopar.com), each checked against the
--    page on 16 Nov 2026. Where Xoopar's pages conflict with our
--    description, the line is left out or uses the owner's figure:
--      - Mr Bio PD Long recycled content = owner's "53% GRS-certified"
--        (Xoopar shows 47% R-ABS / 53% R-TPE, 20% of total volume).
--      - Octopus Mini dimensions omitted (Xoopar's two sites disagree).
--      - Luggie recycled % omitted from specs (description keeps 65%).
--  * Mr Bio PD Long is 1.2 m, 60W, 53% GRS-certified recycled plastic:
--    description + Ava context said "2-metre" — corrected.
--  * Remaining old product names inside descriptions / Ava context get
--    the Xoopar prefix (rename everywhere).
--
-- Spec keys: sentence case with no capitals after the first letter —
-- ProductDetailPage splits keys on capitals ("CarPlay" -> "Car Play").
-- Sources per product:
--   octopus-mini   xoopar.fr/gb/1251-2471-octomini.html, xoopar.com/r/xp61174/w187
--   ocean-octopus  xoopar.fr/gb/1206-1752-octopus-obp.html, xoopar.com/r/xp61040/w187
--   mr-bio         xoopar.fr/gb/1153-859-mr-bio-short.html
--   mr-bio-pd-long xoopar.fr/gb/1208-1757-mr-bio-long-fast-60w.html (+ owner)
--   ice-p          xoopar.fr/gb/1278-3983-ice-p.html
--   luggie         xoopar.fr/gb/1253-2687-luggie.html, xoopar.com/r/xp71042/w189
--   gamma-lite     xoopar.fr/gb/1194-1697-gamma-lite.html
-- Rollback: 20261116_xoopar_specifications.down.sql

BEGIN;

INSERT INTO public.catalog_product_specifications (catalog_product_id, specifications)
SELECT p.id, v.specs::jsonb
  FROM public.catalog_products p
  JOIN (VALUES
    ('octopus-mini', $j${
      "Brand": "Xoopar",
      "Connectors": "Dual adapter: USB and USB-C in, USB-C and Lightning out",
      "Data transfer": "No (charging only)",
      "Cable length": "50 mm",
      "Material": "GRS-certified recycled plastic, matt finish",
      "Weight": "20 g",
      "Print area": "18 × 18 mm",
      "Made in": "China"
    }$j$),
    ('ocean-octopus', $j${
      "Brand": "Xoopar",
      "Material": "Ocean Bound Plastic: recycled plastic collected 50 km off the coast",
      "Connectors": "USB, Micro USB, Lightning and USB-C",
      "Maximum output": "5V / 2.4A",
      "Data transfer": "No (charging only)",
      "Cable length": "77 mm",
      "Dimensions": "114 × 35 × 12 mm",
      "Weight": "20 g",
      "Print area": "24 × 23 mm",
      "Made in": "China"
    }$j$),
    ('mr-bio', $j${
      "Brand": "Xoopar",
      "Inputs": "USB-C and USB",
      "Outputs": "Lightning, USB-C and Micro USB",
      "Compatibility": "Any device: smartphones, wireless headsets, GoPro and more",
      "Recycled content": "23% recycled ABS and 38% recycled TPE",
      "Carbon footprint": "88 g CO2 over the whole product life cycle (Xoopar life-cycle audit)",
      "Packaging": "FSC-certified paper",
      "Dimensions": "150 × 32 × 12 mm",
      "Print area": "25 × 25 mm",
      "Warranty": "2 years",
      "Made in": "China"
    }$j$),
    ('mr-bio-pd-long', $j${
      "Brand": "Xoopar",
      "Fast charging": "Up to 60W",
      "Cable length": "1.2 m",
      "Inputs": "USB-C and USB",
      "Outputs": "Lightning and USB-C",
      "Data transfer": "Yes",
      "In-car use": "Apple CarPlay compatible",
      "Fast-charge indicator": "Green LED lights up when fast charging",
      "Recycled content": "53% GRS-certified recycled plastic",
      "Packaging": "FSC-certified paper",
      "Print area": "27 × 27 mm",
      "Warranty": "2 years",
      "Made in": "China"
    }$j$),
    ('ice-p', $j${
      "Brand": "Xoopar",
      "Battery": "5,000mAh",
      "Charges": "Up to 2 phone charges",
      "Input": "USB-C",
      "Outputs": "USB-C and Lightning, on a 10 cm dual adapter cable",
      "Light": "Touch LED light",
      "Recycled content": "28% GRS-certified recycled plastic (26% recycled ABS, 2% recycled PC)",
      "Packaging": "FSC-certified paper",
      "Dimensions": "76 × 65 × 14 mm",
      "Print area": "40 × 35 mm",
      "Made in": "China"
    }$j$),
    ('luggie', $j${
      "Brand": "Xoopar",
      "Countries": "Over 150",
      "Plugs": "Built-in EU, UK, US and AUS plugs with push-button change",
      "Charging ports": "2 × USB-C at 25W (fast charging) and 1 × USB-A at 15W",
      "Charging technology": "GaN",
      "Safety": "Built-in 10A fuse, safety shutters and patented plug lock",
      "Material": "Anti-fire recycled plastic",
      "Dimensions": "55.2 × 70 × 54.3 mm",
      "Print area": "15 × 40 mm",
      "Made in": "China"
    }$j$),
    ('gamma-lite', $j${
      "Brand": "Xoopar",
      "Battery": "3,000mAh",
      "Inputs": "USB-C and USB",
      "Outputs": "Lightning and USB-C",
      "Pass-through charging": "Recharges itself while charging your phone when plugged into the mains",
      "Compatibility": "Any device: smartphones, wireless headsets, GoPro and more",
      "Recycled content": "30% GRS-certified recycled plastic (22% recycled ABS, 7% recycled TPE)",
      "Packaging": "FSC-certified paper",
      "Dimensions": "153 × 51 × 16.6 mm",
      "Print area": "30 × 30 mm",
      "Warranty": "2 years",
      "Made in": "China"
    }$j$)
  ) AS v(slug, specs) ON v.slug = p.slug
ON CONFLICT (catalog_product_id) DO UPDATE
  SET specifications = EXCLUDED.specifications,
      updated_at = now();

-- Mr Bio PD Long is 1.2 m (owner, 16 Nov 2026), not 2 m.
UPDATE public.catalog_products
   SET description = replace(description, '2-metre multi-charging cable', '1.2-metre multi-charging cable')
 WHERE slug = 'mr-bio-pd-long';

UPDATE public.ava_direct_product_context
   SET differentiators = replace(differentiators, '2-metre', '1.2-metre'),
       upsell_framing_example = replace(upsell_framing_example, '2-metre', '1.2-metre')
 WHERE slug = 'mr-bio-pd-long';

-- Old product names inside copy -> "Xoopar <name>" (skips text already prefixed).
UPDATE public.catalog_products
   SET description = regexp_replace(description,
         '(?<!Xoopar )\m(Octopus Mini|Ocean Octopus|Mr Bio PD Long|Mr Bio|Ice P|Luggie|Gamma Lite)\M',
         'Xoopar \1', 'g')
 WHERE brand = 'Xoopar'
   AND description ~ '(?<!Xoopar )\m(Octopus Mini|Ocean Octopus|Mr Bio PD Long|Mr Bio|Ice P|Luggie|Gamma Lite)\M';

UPDATE public.ava_direct_product_context
   SET differentiators = regexp_replace(differentiators,
         '(?<!Xoopar )\m(Octopus Mini|Ocean Octopus|Mr Bio PD Long|Mr Bio|Ice P|Luggie|Gamma Lite)\M',
         'Xoopar \1', 'g'),
       upsell_framing_example = regexp_replace(upsell_framing_example,
         '(?<!Xoopar )\m(Octopus Mini|Ocean Octopus|Mr Bio PD Long|Mr Bio|Ice P|Luggie|Gamma Lite)\M',
         'Xoopar \1', 'g')
 WHERE slug IN ('octopus-mini','ocean-octopus','mr-bio','mr-bio-pd-long','ice-p','luggie','gamma-lite');

COMMIT;

-- Verify:
-- SELECT p.slug, jsonb_object_keys(s.specifications) FROM catalog_products p
--   JOIN catalog_product_specifications s ON s.catalog_product_id = p.id WHERE p.brand = 'Xoopar';
-- SELECT slug, description FROM catalog_products WHERE brand = 'Xoopar';      -- no bare old names, PD Long 1.2-metre
-- SELECT slug, differentiators, upsell_framing_example FROM ava_direct_product_context
--  WHERE product_name LIKE 'Xoopar %';
