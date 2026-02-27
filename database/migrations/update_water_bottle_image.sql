-- ============================================
-- UPDATE WATER BOTTLE PRIMARY IMAGE
-- ============================================
-- This script updates the water bottle product's primary image
-- to use the white-front.png image from Supabase storage
--
-- Run this in Supabase SQL Editor
-- ============================================

DO $$
DECLARE
  v_product_id UUID;
  v_image_url TEXT := 'https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/water-bottle/white-front.png';
BEGIN
  -- Find the water bottle product ID
  SELECT id INTO v_product_id
  FROM catalog_products
  WHERE slug = 'water-bottle'
  LIMIT 1;

  IF v_product_id IS NULL THEN
    RAISE NOTICE 'Water bottle product not found';
    RETURN;
  END IF;

  RAISE NOTICE 'Found water bottle product: %', v_product_id;

  -- First, set all existing images for this product to non-primary
  UPDATE catalog_product_images
  SET is_primary = false
  WHERE product_id = v_product_id;

  RAISE NOTICE 'Reset all images to non-primary';

  -- Check if the white-front.png image already exists
  IF EXISTS (
    SELECT 1 FROM catalog_product_images
    WHERE product_id = v_product_id
    AND image_url = v_image_url
  ) THEN
    -- Image exists, just set it as primary
    UPDATE catalog_product_images
    SET
      is_primary = true,
      display_order = 0
    WHERE product_id = v_product_id
    AND image_url = v_image_url;

    RAISE NOTICE 'Updated existing white-front.png image to primary';
  ELSE
    -- Image doesn't exist, insert it as primary
    INSERT INTO catalog_product_images (
      product_id,
      image_url,
      thumbnail_url,
      alt_text,
      image_type,
      is_primary,
      display_order
    ) VALUES (
      v_product_id,
      v_image_url,
      v_image_url,
      'Water Bottle - White Front View',
      'main',
      true,
      0
    );

    RAISE NOTICE 'Inserted new white-front.png image as primary';
  END IF;

  RAISE NOTICE 'Water bottle primary image updated successfully!';

END $$;

-- Verify the update
SELECT
  p.name,
  p.slug,
  pi.image_url,
  pi.is_primary,
  pi.display_order
FROM catalog_products p
LEFT JOIN catalog_product_images pi ON p.id = pi.product_id
WHERE p.slug = 'water-bottle'
ORDER BY pi.is_primary DESC, pi.display_order ASC;
