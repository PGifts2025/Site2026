-- Seed Designer Products
-- Adds basic products for the Designer component

-- Insert T-Shirt product
INSERT INTO product_templates (
  id,
  product_key,
  name,
  description,
  template_url,
  base_price,
  colors,
  min_order_qty,
  created_at
)
VALUES (
  'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
  'tshirt',
  'Custom T-Shirt',
  'Premium cotton t-shirt with custom design printing',
  '/templates/tshirt-white.png',
  15.99,
  ARRAY['#FFFFFF', '#000000', '#FF0000', '#0000FF', '#00FF00']::text[],
  10,
  NOW()
);

-- Insert T-Shirt Variants (Front/Back views, multiple colors)
INSERT INTO product_template_variants (
  product_template_id,
  color_code,
  color_name,
  view_name,
  template_url
)
VALUES
  ('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', '#FFFFFF', 'White', 'front', '/templates/tshirt-white-front.png'),
  ('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', '#FFFFFF', 'White', 'back', '/templates/tshirt-white-back.png'),
  ('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', '#000000', 'Black', 'front', '/templates/tshirt-black-front.png'),
  ('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', '#000000', 'Black', 'back', '/templates/tshirt-black-back.png');

-- Insert Mug product
INSERT INTO product_templates (
  id,
  product_key,
  name,
  description,
  template_url,
  base_price,
  colors,
  min_order_qty,
  created_at
)
VALUES (
  'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e',
  'mug',
  'Ceramic Mug',
  '11oz ceramic mug with custom logo printing',
  '/templates/mug-white.png',
  8.99,
  ARRAY['#FFFFFF', '#FF0000', '#0000FF']::text[],
  25,
  NOW()
);

-- Insert Mug Variants
INSERT INTO product_template_variants (
  product_template_id,
  color_code,
  color_name,
  view_name,
  template_url
)
VALUES
  ('b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', '#FFFFFF', 'White', 'front', '/templates/mug-white.png'),
  ('b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', '#FF0000', 'Red', 'front', '/templates/mug-red.png'),
  ('b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', '#0000FF', 'Blue', 'front', '/templates/mug-blue.png');

-- Insert Tote Bag product
INSERT INTO product_templates (
  id,
  product_key,
  name,
  description,
  template_url,
  base_price,
  colors,
  min_order_qty,
  created_at
)
VALUES (
  'c3d4e5f6-a7b8-4c5d-0e1f-2a3b4c5d6e7f',
  'bag',
  'Canvas Tote Bag',
  '100% cotton canvas bag with custom printing',
  '/templates/bag-natural.png',
  12.99,
  ARRAY['#F5F5DC', '#000000']::text[],
  50,
  NOW()
);

-- Insert Bag Variants
INSERT INTO product_template_variants (
  product_template_id,
  color_code,
  color_name,
  view_name,
  template_url
)
VALUES
  ('c3d4e5f6-a7b8-4c5d-0e1f-2a3b4c5d6e7f', '#F5F5DC', 'Natural', 'front', '/templates/bag-natural-front.png'),
  ('c3d4e5f6-a7b8-4c5d-0e1f-2a3b4c5d6e7f', '#F5F5DC', 'Natural', 'back', '/templates/bag-natural-back.png'),
  ('c3d4e5f6-a7b8-4c5d-0e1f-2a3b4c5d6e7f', '#000000', 'Black', 'front', '/templates/bag-black-front.png'),
  ('c3d4e5f6-a7b8-4c5d-0e1f-2a3b4c5d6e7f', '#000000', 'Black', 'back', '/templates/bag-black-back.png');

-- Add print areas for T-Shirt (Front)
INSERT INTO print_areas (
  variant_id,
  name,
  area_key,
  x,
  y,
  width,
  height,
  width_mm,
  height_mm,
  max_width,
  max_height,
  shape
)
SELECT
  v.id,
  'Front Chest',
  'front_chest',
  300,
  250,
  200,
  250,
  200,
  250,
  200,
  250,
  'rectangle'
FROM product_template_variants v
WHERE v.product_template_id = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d'
  AND v.view_name = 'front';

-- Add print areas for T-Shirt (Back)
INSERT INTO print_areas (
  variant_id,
  name,
  area_key,
  x,
  y,
  width,
  height,
  width_mm,
  height_mm,
  max_width,
  max_height,
  shape
)
SELECT
  v.id,
  'Back Center',
  'back_center',
  300,
  200,
  200,
  300,
  200,
  300,
  200,
  300,
  'rectangle'
FROM product_template_variants v
WHERE v.product_template_id = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d'
  AND v.view_name = 'back';

-- Add print areas for Mug
INSERT INTO print_areas (
  variant_id,
  name,
  area_key,
  x,
  y,
  width,
  height,
  width_mm,
  height_mm,
  max_width,
  max_height,
  shape
)
SELECT
  v.id,
  'Wrap Around',
  'wrap',
  150,
  200,
  300,
  150,
  90,
  80,
  300,
  150,
  'rectangle'
FROM product_template_variants v
WHERE v.product_template_id = 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e';

-- Add print areas for Bag (Front)
INSERT INTO print_areas (
  variant_id,
  name,
  area_key,
  x,
  y,
  width,
  height,
  width_mm,
  height_mm,
  max_width,
  max_height,
  shape
)
SELECT
  v.id,
  'Front Panel',
  'front_panel',
  250,
  300,
  300,
  200,
  250,
  200,
  300,
  200,
  'rectangle'
FROM product_template_variants v
WHERE v.product_template_id = 'c3d4e5f6-a7b8-4c5d-0e1f-2a3b4c5d6e7f'
  AND v.view_name = 'front';

-- Add print areas for Bag (Back)
INSERT INTO print_areas (
  variant_id,
  name,
  area_key,
  x,
  y,
  width,
  height,
  width_mm,
  height_mm,
  max_width,
  max_height,
  shape
)
SELECT
  v.id,
  'Back Panel',
  'back_panel',
  250,
  300,
  300,
  200,
  250,
  200,
  300,
  200,
  'rectangle'
FROM product_template_variants v
WHERE v.product_template_id = 'c3d4e5f6-a7b8-4c5d-0e1f-2a3b4c5d6e7f'
  AND v.view_name = 'back';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '✅ Designer products seeded successfully!';
  RAISE NOTICE '   - T-Shirt (4 variants: White/Black, Front/Back)';
  RAISE NOTICE '   - Mug (3 variants: White/Red/Blue)';
  RAISE NOTICE '   - Bag (4 variants: Natural/Black, Front/Back)';
END $$;
