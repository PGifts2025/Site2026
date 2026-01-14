-- =====================================================
-- CATALOG DATA SEEDING SCRIPT (SQL Version)
-- =====================================================
-- Run this directly in Supabase SQL Editor
-- This populates catalog tables from existing product_templates
-- =====================================================

-- STEP 1: Insert Categories
-- =====================================================

INSERT INTO catalog_categories (name, slug, description, created_at, updated_at)
VALUES
  ('Bags', 'bags', 'Premium branded bags for your promotional needs', NOW(), NOW()),
  ('Cups', 'cups', 'Custom branded cups and drinkware', NOW(), NOW()),
  ('Water Bottles', 'water-bottles', 'Promotional water bottles and flasks', NOW(), NOW()),
  ('Clothing', 'clothing', 'Branded apparel and workwear', NOW(), NOW()),
  ('Cables', 'cables', 'Premium branded charging cables and accessories', NOW(), NOW()),
  ('Power', 'power', 'Portable power banks and chargers', NOW(), NOW()),
  ('Hi Vis', 'hi-vis', 'High visibility safety wear', NOW(), NOW()),
  ('Notebooks', 'notebooks', 'Custom branded notebooks and stationery', NOW(), NOW()),
  ('Tea Towels', 'tea-towels', 'Promotional tea towels and textiles', NOW(), NOW()),
  ('Pens & Writing', 'pens-writing', 'Branded pens and writing instruments', NOW(), NOW()),
  ('Speakers', 'speakers', 'Promotional speakers and audio', NOW(), NOW())
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = NOW();

-- STEP 2: Create helper function to map categories
-- =====================================================

CREATE OR REPLACE FUNCTION map_category_slug(template_category TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN CASE template_category
    WHEN 'Bags' THEN 'bags'
    WHEN 'Cups' THEN 'cups'
    WHEN 'Water Bottles' THEN 'water-bottles'
    WHEN 'Clothing' THEN 'clothing'
    WHEN 'Cables' THEN 'cables'
    WHEN 'Power' THEN 'power'
    WHEN 'Hi-Vis' THEN 'hi-vis'
    WHEN 'Notebooks' THEN 'notebooks'
    WHEN 'Tea Towels' THEN 'tea-towels'
    WHEN 'Pens' THEN 'pens-writing'
    WHEN 'Speakers' THEN 'speakers'
    ELSE 'bags'
  END;
END;
$$ LANGUAGE plpgsql;

-- STEP 3: Insert Products from product_templates
-- =====================================================

INSERT INTO catalog_products (
  category_id,
  name,
  slug,
  subtitle,
  description,
  badge,
  rating,
  review_count,
  status,
  min_order_quantity,
  designer_product_id,
  created_at,
  updated_at
)
SELECT
  cc.id as category_id,
  pt.name,
  pt.product_key as slug,
  CASE map_category_slug(pt.category)
    WHEN 'bags' THEN 'Premium branded promotional bag'
    WHEN 'cups' THEN 'Custom branded drinkware'
    WHEN 'water-bottles' THEN 'Promotional water bottle'
    WHEN 'clothing' THEN 'Professional branded apparel'
    WHEN 'cables' THEN 'Premium charging solution'
    WHEN 'power' THEN 'Portable power bank'
    WHEN 'hi-vis' THEN 'High visibility safety wear'
    WHEN 'notebooks' THEN 'Custom branded notebook'
    WHEN 'tea-towels' THEN 'Promotional tea towel'
    WHEN 'pens-writing' THEN 'Quality writing instrument'
    WHEN 'speakers' THEN 'Bluetooth speaker'
    ELSE 'Premium promotional product'
  END as subtitle,
  'Premium ' || LOWER(pt.name) || ' perfect for promotional campaigns, corporate gifts, and brand awareness. Features high-quality materials and excellent print quality for your logo.' as description,
  CASE
    WHEN LOWER(pt.name) LIKE '%eco%' OR LOWER(pt.name) LIKE '%recycled%' OR LOWER(pt.name) LIKE '%bio%' THEN 'Eco-Friendly'
    WHEN LOWER(pt.name) LIKE '%premium%' THEN 'Premium'
    WHEN LOWER(pt.name) LIKE '%fast%' THEN 'Fast Charge'
    ELSE NULL
  END as badge,
  4.5 + (RANDOM() * 0.4) as rating,
  50 + FLOOR(RANDOM() * 450)::integer as review_count,
  'active' as status,
  25 as min_order_quantity,
  pt.id as designer_product_id,
  NOW() as created_at,
  NOW() as updated_at
FROM product_templates pt
JOIN catalog_categories cc ON cc.slug = map_category_slug(pt.category)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  category_id = EXCLUDED.category_id,
  subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description,
  badge = EXCLUDED.badge,
  designer_product_id = EXCLUDED.designer_product_id,
  updated_at = NOW();

-- STEP 4: Insert Pricing Tiers for all products
-- =====================================================

INSERT INTO catalog_pricing_tiers (
  product_id,
  min_quantity,
  max_quantity,
  price_per_unit,
  created_at,
  updated_at
)
SELECT
  cp.id as product_id,
  tier.min_qty,
  tier.max_qty,
  tier.price,
  NOW(),
  NOW()
FROM catalog_products cp
CROSS JOIN (
  VALUES
    (25, 49, 4.50),
    (50, 99, 4.05),
    (100, 249, 3.60),
    (250, 499, 3.15),
    (500, NULL, 2.70)
) AS tier(min_qty, max_qty, price)
ON CONFLICT (product_id, min_quantity) DO UPDATE
SET
  max_quantity = EXCLUDED.max_quantity,
  price_per_unit = EXCLUDED.price_per_unit,
  updated_at = NOW();

-- STEP 5: Insert Product Images from variants
-- =====================================================

INSERT INTO catalog_product_images (
  product_id,
  image_url,
  thumbnail_url,
  alt_text,
  is_primary,
  display_order,
  created_at,
  updated_at
)
SELECT DISTINCT ON (cp.id, ptv.template_url)
  cp.id as product_id,
  ptv.template_url as image_url,
  ptv.template_url as thumbnail_url,
  cp.name || ' - Product Image' as alt_text,
  ROW_NUMBER() OVER (PARTITION BY cp.id ORDER BY ptv.created_at) = 1 as is_primary,
  ROW_NUMBER() OVER (PARTITION BY cp.id ORDER BY ptv.created_at) - 1 as display_order,
  NOW() as created_at,
  NOW() as updated_at
FROM catalog_products cp
JOIN product_templates pt ON pt.id = cp.designer_product_id
JOIN product_template_variants ptv ON ptv.product_template_id = pt.id
WHERE ptv.template_url IS NOT NULL
ON CONFLICT (product_id, image_url) DO UPDATE
SET
  alt_text = EXCLUDED.alt_text,
  is_primary = EXCLUDED.is_primary,
  display_order = EXCLUDED.display_order,
  updated_at = NOW();

-- STEP 6: Insert Product Colors from variants
-- =====================================================

INSERT INTO catalog_product_colors (
  product_id,
  color_name,
  color_code,
  hex_code,
  is_available,
  display_order,
  created_at,
  updated_at
)
SELECT DISTINCT ON (cp.id, ptv.color_code)
  cp.id as product_id,
  ptv.color_name,
  ptv.color_code,
  CASE ptv.color_name
    WHEN 'Black' THEN '#000000'
    WHEN 'White' THEN '#FFFFFF'
    WHEN 'Red' THEN '#FF0000'
    WHEN 'Blue' THEN '#0000FF'
    WHEN 'Green' THEN '#00FF00'
    WHEN 'Yellow' THEN '#FFFF00'
    WHEN 'Orange' THEN '#FFA500'
    WHEN 'Purple' THEN '#800080'
    WHEN 'Pink' THEN '#FFC0CB'
    WHEN 'Grey' THEN '#808080'
    WHEN 'Gray' THEN '#808080'
    WHEN 'Brown' THEN '#A52A2A'
    WHEN 'Navy' THEN '#000080'
    ELSE '#CCCCCC'
  END as hex_code,
  true as is_available,
  ROW_NUMBER() OVER (PARTITION BY cp.id ORDER BY ptv.color_name) - 1 as display_order,
  NOW() as created_at,
  NOW() as updated_at
FROM catalog_products cp
JOIN product_templates pt ON pt.id = cp.designer_product_id
JOIN product_template_variants ptv ON ptv.product_template_id = pt.id
WHERE ptv.color_name IS NOT NULL AND ptv.color_code IS NOT NULL
ON CONFLICT (product_id, color_code) DO UPDATE
SET
  color_name = EXCLUDED.color_name,
  hex_code = EXCLUDED.hex_code,
  is_available = EXCLUDED.is_available,
  display_order = EXCLUDED.display_order,
  updated_at = NOW();

-- STEP 7: Insert Product Features (category-specific)
-- =====================================================

-- Bags features
INSERT INTO catalog_product_features (product_id, feature_text, display_order, created_at, updated_at)
SELECT cp.id, feature, row_number() OVER (PARTITION BY cp.id) - 1, NOW(), NOW()
FROM catalog_products cp
JOIN catalog_categories cc ON cc.id = cp.category_id
CROSS JOIN (
  SELECT unnest(ARRAY[
    'Durable cotton material',
    'Large print area',
    'Reinforced handles',
    'Multiple colors available',
    'Eco-friendly materials',
    'Machine washable'
  ]) as feature
) features
WHERE cc.slug = 'bags'
ON CONFLICT (product_id, feature_text) DO NOTHING;

-- Cups features
INSERT INTO catalog_product_features (product_id, feature_text, display_order, created_at, updated_at)
SELECT cp.id, feature, row_number() OVER (PARTITION BY cp.id) - 1, NOW(), NOW()
FROM catalog_products cp
JOIN catalog_categories cc ON cc.id = cp.category_id
CROSS JOIN (
  SELECT unnest(ARRAY[
    'Food-safe materials',
    'Dishwasher safe',
    'Insulated design',
    'Leak-proof lid',
    'Multiple sizes available',
    'BPA-free'
  ]) as feature
) features
WHERE cc.slug = 'cups'
ON CONFLICT (product_id, feature_text) DO NOTHING;

-- Water Bottles features
INSERT INTO catalog_product_features (product_id, feature_text, display_order, created_at, updated_at)
SELECT cp.id, feature, row_number() OVER (PARTITION BY cp.id) - 1, NOW(), NOW()
FROM catalog_products cp
JOIN catalog_categories cc ON cc.id = cp.category_id
CROSS JOIN (
  SELECT unnest(ARRAY[
    'BPA-free materials',
    'Leak-proof design',
    'Easy to clean',
    'Multiple capacities',
    'Temperature retention',
    'Durable construction'
  ]) as feature
) features
WHERE cc.slug = 'water-bottles'
ON CONFLICT (product_id, feature_text) DO NOTHING;

-- Clothing features
INSERT INTO catalog_product_features (product_id, feature_text, display_order, created_at, updated_at)
SELECT cp.id, feature, row_number() OVER (PARTITION BY cp.id) - 1, NOW(), NOW()
FROM catalog_products cp
JOIN catalog_categories cc ON cc.id = cp.category_id
CROSS JOIN (
  SELECT unnest(ARRAY[
    'Premium quality fabric',
    'Multiple sizes available',
    'Professional finish',
    'Machine washable',
    'Color-fast dyes',
    'Comfortable fit'
  ]) as feature
) features
WHERE cc.slug = 'clothing'
ON CONFLICT (product_id, feature_text) DO NOTHING;

-- Cables features
INSERT INTO catalog_product_features (product_id, feature_text, display_order, created_at, updated_at)
SELECT cp.id, feature, row_number() OVER (PARTITION BY cp.id) - 1, NOW(), NOW()
FROM catalog_products cp
JOIN catalog_categories cc ON cc.id = cp.category_id
CROSS JOIN (
  SELECT unnest(ARRAY[
    'Fast charging support',
    'Premium materials',
    'Compact design',
    'Universal compatibility',
    'Durable construction',
    'Multiple connectors'
  ]) as feature
) features
WHERE cc.slug = 'cables'
ON CONFLICT (product_id, feature_text) DO NOTHING;

-- STEP 8: Insert Product Specifications (category-specific)
-- =====================================================

-- Bags specifications
INSERT INTO catalog_product_specifications (product_id, spec_key, spec_value, display_order, created_at, updated_at)
SELECT cp.id, spec.key, spec.value, spec.ord, NOW(), NOW()
FROM catalog_products cp
JOIN catalog_categories cc ON cc.id = cp.category_id
CROSS JOIN (
  VALUES
    ('dimensions', '38cm x 42cm', 0),
    ('material', 'Cotton', 1),
    ('weight', '140g', 2),
    ('print_area', '20cm x 25cm', 3)
) AS spec(key, value, ord)
WHERE cc.slug = 'bags'
ON CONFLICT (product_id, spec_key) DO UPDATE
SET
  spec_value = EXCLUDED.spec_value,
  updated_at = NOW();

-- Cups specifications
INSERT INTO catalog_product_specifications (product_id, spec_key, spec_value, display_order, created_at, updated_at)
SELECT cp.id, spec.key, spec.value, spec.ord, NOW(), NOW()
FROM catalog_products cp
JOIN catalog_categories cc ON cc.id = cp.category_id
CROSS JOIN (
  VALUES
    ('capacity', '350ml', 0),
    ('material', 'Ceramic', 1),
    ('dimensions', '9cm diameter x 10cm height', 2),
    ('dishwasher_safe', 'Yes', 3)
) AS spec(key, value, ord)
WHERE cc.slug = 'cups'
ON CONFLICT (product_id, spec_key) DO UPDATE
SET
  spec_value = EXCLUDED.spec_value,
  updated_at = NOW();

-- Water Bottles specifications
INSERT INTO catalog_product_specifications (product_id, spec_key, spec_value, display_order, created_at, updated_at)
SELECT cp.id, spec.key, spec.value, spec.ord, NOW(), NOW()
FROM catalog_products cp
JOIN catalog_categories cc ON cc.id = cp.category_id
CROSS JOIN (
  VALUES
    ('capacity', '500ml', 0),
    ('material', 'BPA-free plastic', 1),
    ('dimensions', '21cm x 7cm diameter', 2),
    ('weight', '120g', 3)
) AS spec(key, value, ord)
WHERE cc.slug = 'water-bottles'
ON CONFLICT (product_id, spec_key) DO UPDATE
SET
  spec_value = EXCLUDED.spec_value,
  updated_at = NOW();

-- Clothing specifications
INSERT INTO catalog_product_specifications (product_id, spec_key, spec_value, display_order, created_at, updated_at)
SELECT cp.id, spec.key, spec.value, spec.ord, NOW(), NOW()
FROM catalog_products cp
JOIN catalog_categories cc ON cc.id = cp.category_id
CROSS JOIN (
  VALUES
    ('material', '100% Cotton', 0),
    ('sizes', 'S, M, L, XL, XXL', 1),
    ('weight', '180gsm', 2),
    ('fit', 'Regular', 3)
) AS spec(key, value, ord)
WHERE cc.slug = 'clothing'
ON CONFLICT (product_id, spec_key) DO UPDATE
SET
  spec_value = EXCLUDED.spec_value,
  updated_at = NOW();

-- Cables specifications
INSERT INTO catalog_product_specifications (product_id, spec_key, spec_value, display_order, created_at, updated_at)
SELECT cp.id, spec.key, spec.value, spec.ord, NOW(), NOW()
FROM catalog_products cp
JOIN catalog_categories cc ON cc.id = cp.category_id
CROSS JOIN (
  VALUES
    ('length', '13cm', 0),
    ('connectors', 'USB-A, USB-C, Lightning', 1),
    ('material', 'Recycled plastic', 2),
    ('weight', '12g', 3)
) AS spec(key, value, ord)
WHERE cc.slug = 'cables'
ON CONFLICT (product_id, spec_key) DO UPDATE
SET
  spec_value = EXCLUDED.spec_value,
  updated_at = NOW();

-- =====================================================
-- CLEANUP: Drop helper function
-- =====================================================

DROP FUNCTION IF EXISTS map_category_slug(TEXT);

-- =====================================================
-- DONE! Check results:
-- =====================================================

SELECT 'Categories' as table_name, COUNT(*) as count FROM catalog_categories
UNION ALL
SELECT 'Products', COUNT(*) FROM catalog_products
UNION ALL
SELECT 'Pricing Tiers', COUNT(*) FROM catalog_pricing_tiers
UNION ALL
SELECT 'Images', COUNT(*) FROM catalog_product_images
UNION ALL
SELECT 'Colors', COUNT(*) FROM catalog_product_colors
UNION ALL
SELECT 'Features', COUNT(*) FROM catalog_product_features
UNION ALL
SELECT 'Specifications', COUNT(*) FROM catalog_product_specifications;
