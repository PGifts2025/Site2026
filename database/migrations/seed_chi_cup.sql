-- ============================================================================
-- SEED CHI CUP PRODUCT TO CATALOG
-- ============================================================================
-- This script adds the Chi Cup product to the catalog database with full
-- product details, pricing tiers, colors, features, specifications, and images.
--
-- Run this in Supabase SQL Editor (bypasses RLS automatically)
-- ============================================================================

-- Begin transaction
BEGIN;

-- ============================================================================
-- STEP 1: Get required IDs
-- ============================================================================

-- Get Cups category ID
DO $$
DECLARE
  v_category_id UUID;
  v_template_id UUID;
  v_product_id UUID;
BEGIN

  -- Ensure Cups category exists
  INSERT INTO catalog_categories (name, slug, description, icon, sort_order, is_active)
  VALUES ('Cups', 'cups', 'Custom branded cups and drinkware', '☕', 1, true)
  ON CONFLICT (slug) DO NOTHING;

  -- Get category ID
  SELECT id INTO v_category_id
  FROM catalog_categories
  WHERE slug = 'cups';

  RAISE NOTICE 'Cups category ID: %', v_category_id;

  -- Get Chi Cup template ID
  SELECT id INTO v_template_id
  FROM product_templates
  WHERE product_key = 'chi-cup';

  IF v_template_id IS NULL THEN
    RAISE EXCEPTION 'Chi Cup template not found in product_templates. Please ensure product_key = ''chi-cup'' exists.';
  END IF;

  RAISE NOTICE 'Chi Cup template ID: %', v_template_id;

  -- ============================================================================
  -- STEP 2: Create/Update Chi Cup Catalog Product
  -- ============================================================================

  INSERT INTO catalog_products (
    category_id,
    name,
    slug,
    subtitle,
    description,
    badge,
    rating,
    review_count,
    is_featured,
    is_customizable,
    status,
    published_at,
    min_order_quantity,
    designer_product_id
  ) VALUES (
    v_category_id,
    'Chi Cup',
    'chi-cup',
    'Premium insulated travel cup with full-wrap branding',
    'The Chi Cup is a premium double-walled insulated travel cup featuring a sleek tapered design perfect for full-wrap custom branding. Its cone-shaped body provides a large, continuous print area ideal for detailed logos, patterns, and promotional designs. Features a secure leak-proof lid with silicone seal, keeping drinks hot for up to 4 hours or cold for up to 8 hours.',
    'Best Seller',
    4.8,
    342,
    true,
    true,
    'active',
    NOW(),
    25,
    v_template_id
  )
  ON CONFLICT (slug) DO UPDATE SET
    category_id = EXCLUDED.category_id,
    name = EXCLUDED.name,
    subtitle = EXCLUDED.subtitle,
    description = EXCLUDED.description,
    badge = EXCLUDED.badge,
    rating = EXCLUDED.rating,
    review_count = EXCLUDED.review_count,
    is_featured = EXCLUDED.is_featured,
    is_customizable = EXCLUDED.is_customizable,
    status = EXCLUDED.status,
    min_order_quantity = EXCLUDED.min_order_quantity,
    designer_product_id = EXCLUDED.designer_product_id,
    updated_at = NOW()
  RETURNING id INTO v_product_id;

  RAISE NOTICE 'Chi Cup product ID: %', v_product_id;

  -- ============================================================================
  -- STEP 3: Insert Pricing Tiers
  -- ============================================================================

  INSERT INTO catalog_pricing_tiers (catalog_product_id, min_quantity, max_quantity, price_per_unit, is_popular)
  VALUES
    (v_product_id, 25, 49, 8.99, false),
    (v_product_id, 50, 99, 7.49, false),
    (v_product_id, 100, 249, 6.49, true),   -- Most popular tier
    (v_product_id, 250, 499, 5.49, false),
    (v_product_id, 500, 999, 4.99, false),
    (v_product_id, 1000, NULL, 4.49, false)
  ON CONFLICT (catalog_product_id, min_quantity) DO UPDATE SET
    max_quantity = EXCLUDED.max_quantity,
    price_per_unit = EXCLUDED.price_per_unit,
    is_popular = EXCLUDED.is_popular;

  RAISE NOTICE 'Inserted pricing tiers';

  -- ============================================================================
  -- STEP 4: Insert Product Features
  -- ============================================================================

  INSERT INTO catalog_product_features (catalog_product_id, feature_text, sort_order)
  VALUES
    (v_product_id, 'Double-walled insulation', 0),
    (v_product_id, 'Full-wrap print area', 1),
    (v_product_id, 'Leak-proof lid with silicone seal', 2),
    (v_product_id, 'BPA & PVC free', 3),
    (v_product_id, 'Food-grade materials', 4),
    (v_product_id, 'Dishwasher safe', 5),
    (v_product_id, '450ml capacity', 6),
    (v_product_id, 'Gift box packaging available', 7)
  ON CONFLICT (catalog_product_id, feature_text) DO UPDATE SET
    sort_order = EXCLUDED.sort_order;

  RAISE NOTICE 'Inserted product features';

  -- ============================================================================
  -- STEP 5: Insert Product Specifications
  -- ============================================================================

  INSERT INTO catalog_product_specifications (catalog_product_id, specifications)
  VALUES (
    v_product_id,
    jsonb_build_object(
      'Capacity', '450ml',
      'Material', 'Double-walled stainless steel',
      'Height', '180mm',
      'Diameter (top)', '85mm',
      'Diameter (bottom)', '65mm',
      'Weight', '280g',
      'Insulation', 'Hot 4hrs / Cold 8hrs',
      'Print Method', 'Full-wrap sublimation',
      'Print Area', '360° wrap around cup body',
      'Lid Material', 'BPA-free plastic with silicone seal'
    )
  )
  ON CONFLICT (catalog_product_id) DO UPDATE SET
    specifications = EXCLUDED.specifications,
    updated_at = NOW();

  RAISE NOTICE 'Inserted product specifications';

  -- ============================================================================
  -- STEP 6: Insert Product Colors (from variants)
  -- ============================================================================

  -- Insert colors from product_template_variants
  INSERT INTO catalog_product_colors (catalog_product_id, color_name, color_code, hex_value, is_active, sort_order)
  SELECT DISTINCT ON (v.color_name, v.color_code)
    v_product_id,
    v.color_name,
    lower(replace(v.color_code, '#', '')),  -- Store without # as code
    v.color_code,                           -- Store with # as hex_value
    true,
    ROW_NUMBER() OVER (ORDER BY v.color_name) - 1
  FROM product_template_variants v
  WHERE v.product_template_id = v_template_id
    AND v.color_name IS NOT NULL
    AND v.color_code IS NOT NULL
  ON CONFLICT (catalog_product_id, color_code) DO UPDATE SET
    color_name = EXCLUDED.color_name,
    hex_value = EXCLUDED.hex_value,
    is_active = EXCLUDED.is_active;

  -- If no colors found, add default colors
  IF NOT EXISTS (SELECT 1 FROM catalog_product_colors WHERE catalog_product_id = v_product_id) THEN
    INSERT INTO catalog_product_colors (catalog_product_id, color_name, color_code, hex_value, is_active, sort_order)
    VALUES
      (v_product_id, 'White', 'ffffff', '#FFFFFF', true, 0),
      (v_product_id, 'Black', '000000', '#000000', true, 1);
  END IF;

  RAISE NOTICE 'Inserted product colors';

  -- ============================================================================
  -- STEP 7: Insert Product Images (from variants)
  -- ============================================================================

  -- Insert images from product_template_variants
  INSERT INTO catalog_product_images (
    catalog_product_id,
    image_url,
    thumbnail_url,
    alt_text,
    is_primary,
    image_type,
    sort_order
  )
  SELECT
    v_product_id,
    v.template_url,
    v.template_url,
    'Chi Cup - ' || v.color_name || ' ' || v.view_name,
    (ROW_NUMBER() OVER (ORDER BY v.color_name, v.view_name) = 1),  -- First image is primary
    CASE WHEN v.view_name = 'front' THEN 'main' ELSE 'gallery' END,
    ROW_NUMBER() OVER (ORDER BY v.color_name, v.view_name) - 1
  FROM product_template_variants v
  WHERE v.product_template_id = v_template_id
    AND v.template_url IS NOT NULL
  ON CONFLICT (catalog_product_id, image_url) DO UPDATE SET
    alt_text = EXCLUDED.alt_text,
    is_primary = EXCLUDED.is_primary,
    image_type = EXCLUDED.image_type;

  -- If no images found, add a default placeholder
  IF NOT EXISTS (SELECT 1 FROM catalog_product_images WHERE catalog_product_id = v_product_id) THEN
    INSERT INTO catalog_product_images (
      catalog_product_id,
      image_url,
      thumbnail_url,
      alt_text,
      is_primary,
      image_type,
      sort_order
    )
    VALUES (
      v_product_id,
      'https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/chi-cup/white-front.png',
      'https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/chi-cup/white-front.png',
      'Chi Cup - White',
      true,
      'main',
      0
    );
  END IF;

  RAISE NOTICE 'Inserted product images';

  -- ============================================================================
  -- SUMMARY
  -- ============================================================================

  RAISE NOTICE '==================================================';
  RAISE NOTICE '✅ CHI CUP SEEDING COMPLETE!';
  RAISE NOTICE '==================================================';
  RAISE NOTICE 'Product ID: %', v_product_id;
  RAISE NOTICE 'Category: Cups (%)' , v_category_id;
  RAISE NOTICE 'Template: % (%)', 'Chi Cup', v_template_id;
  RAISE NOTICE '';
  RAISE NOTICE 'Product URLs:';
  RAISE NOTICE '  - Category page: /cups';
  RAISE NOTICE '  - Product page: /cups/chi-cup';
  RAISE NOTICE '  - Designer: /designer (select Chi Cup)';
  RAISE NOTICE '==================================================';

END $$;

-- Commit transaction
COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES (Optional - uncomment to run)
-- ============================================================================

-- Check the inserted product
-- SELECT * FROM catalog_products WHERE slug = 'chi-cup';

-- Check pricing tiers
-- SELECT * FROM catalog_pricing_tiers WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = 'chi-cup');

-- Check colors
-- SELECT * FROM catalog_product_colors WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = 'chi-cup');

-- Check images
-- SELECT * FROM catalog_product_images WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = 'chi-cup');

-- Check features
-- SELECT * FROM catalog_product_features WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = 'chi-cup') ORDER BY sort_order;

-- Check specifications
-- SELECT * FROM catalog_product_specifications WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = 'chi-cup');
