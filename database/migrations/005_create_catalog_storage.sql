-- Migration: Create Catalog Images Storage Bucket
-- This migration creates a storage bucket for product catalog images
-- with multiple size variants (original, thumbnail, medium, large)
--
-- Storage Structure:
-- catalog-images/
--   ├── products/
--   │   ├── {product-slug}/
--   │   │   ├── original/    (full resolution images)
--   │   │   ├── thumbnail/   (200x200 for product cards)
--   │   │   ├── medium/      (600x600 for product pages)
--   │   │   └── large/       (1200x1200 for zoom views)
--   ├── categories/
--   │   └── {category-slug}/ (category banner images)
--   └── colors/
--       └── swatches/        (color swatch images)

-- ============================================================================
-- CREATE STORAGE BUCKET
-- ============================================================================

-- Create catalog-images bucket (public access for product photos)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'catalog-images',
  'catalog-images',
  true,  -- Public bucket for product images
  10485760,  -- 10MB file size limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

-- ============================================================================
-- STORAGE POLICIES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PUBLIC READ ACCESS (Anyone can view product images)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Public read access to catalog images" ON storage.objects;
CREATE POLICY "Public read access to catalog images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'catalog-images');

COMMENT ON POLICY "Public read access to catalog images" ON storage.objects
  IS 'Allow anyone to view product catalog images';

-- ----------------------------------------------------------------------------
-- ADMIN UPLOAD ACCESS (Only admins can upload new images)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admins can upload catalog images" ON storage.objects;
CREATE POLICY "Admins can upload catalog images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'catalog-images' AND
    is_admin(auth.uid())
  );

COMMENT ON POLICY "Admins can upload catalog images" ON storage.objects
  IS 'Only admins can upload new product catalog images';

-- ----------------------------------------------------------------------------
-- ADMIN UPDATE ACCESS (Only admins can update existing images)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admins can update catalog images" ON storage.objects;
CREATE POLICY "Admins can update catalog images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'catalog-images' AND
    is_admin(auth.uid())
  )
  WITH CHECK (
    bucket_id = 'catalog-images' AND
    is_admin(auth.uid())
  );

COMMENT ON POLICY "Admins can update catalog images" ON storage.objects
  IS 'Only admins can update existing product catalog images';

-- ----------------------------------------------------------------------------
-- ADMIN DELETE ACCESS (Only admins can delete images)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admins can delete catalog images" ON storage.objects;
CREATE POLICY "Admins can delete catalog images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'catalog-images' AND
    is_admin(auth.uid())
  );

COMMENT ON POLICY "Admins can delete catalog images" ON storage.objects
  IS 'Only admins can delete product catalog images';

-- ============================================================================
-- HELPER FUNCTIONS FOR IMAGE MANAGEMENT
-- ============================================================================

-- Function to generate storage paths for different image sizes
CREATE OR REPLACE FUNCTION get_catalog_image_path(
  product_slug TEXT,
  image_filename TEXT,
  image_size TEXT DEFAULT 'original'
)
RETURNS TEXT AS $$
BEGIN
  -- Validate size parameter
  IF image_size NOT IN ('original', 'thumbnail', 'medium', 'large') THEN
    RAISE EXCEPTION 'Invalid image size. Must be: original, thumbnail, medium, or large';
  END IF;

  -- Return formatted path
  RETURN format('products/%s/%s/%s', product_slug, image_size, image_filename);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION get_catalog_image_path IS 'Generate storage path for catalog images with size variants';

-- Function to get full public URL for catalog images
CREATE OR REPLACE FUNCTION get_catalog_image_url(
  image_path TEXT
)
RETURNS TEXT AS $$
DECLARE
  supabase_url TEXT;
BEGIN
  -- Get Supabase project URL from environment
  -- Note: In production, replace with actual Supabase URL
  supabase_url := current_setting('app.settings.supabase_url', true);

  IF supabase_url IS NULL THEN
    -- Fallback to relative path if URL not configured
    RETURN format('/storage/v1/object/public/catalog-images/%s', image_path);
  END IF;

  RETURN format('%s/storage/v1/object/public/catalog-images/%s', supabase_url, image_path);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_catalog_image_url IS 'Generate full public URL for catalog images';

-- ============================================================================
-- USAGE EXAMPLES
-- ============================================================================

-- Example 1: Upload product image paths
-- Original:  products/5oz-cotton-bag/original/main-view.jpg
-- Thumbnail: products/5oz-cotton-bag/thumbnail/main-view.jpg
-- Medium:    products/5oz-cotton-bag/medium/main-view.jpg
-- Large:     products/5oz-cotton-bag/large/main-view.jpg

-- Example 2: Insert image with all size variants
/*
INSERT INTO catalog_product_images (
  catalog_product_id,
  image_url,
  thumbnail_url,
  medium_url,
  large_url,
  alt_text,
  image_type,
  sort_order,
  is_primary
) VALUES (
  '123e4567-e89b-12d3-a456-426614174000',  -- product UUID
  get_catalog_image_url(get_catalog_image_path('5oz-cotton-bag', 'main-view.jpg', 'original')),
  get_catalog_image_url(get_catalog_image_path('5oz-cotton-bag', 'main-view.jpg', 'thumbnail')),
  get_catalog_image_url(get_catalog_image_path('5oz-cotton-bag', 'main-view.jpg', 'medium')),
  get_catalog_image_url(get_catalog_image_path('5oz-cotton-bag', 'main-view.jpg', 'large')),
  '5oz Cotton Bag - Main View',
  'main',
  0,
  true
);
*/

-- Example 3: Query to get product with optimized image URLs
/*
SELECT
  p.name,
  pi.image_type,
  pi.thumbnail_url,  -- Use for product cards
  pi.medium_url,     -- Use for product detail page
  pi.large_url       -- Use for zoom/lightbox
FROM catalog_products p
JOIN catalog_product_images pi ON p.id = pi.catalog_product_id
WHERE p.slug = '5oz-cotton-bag'
ORDER BY pi.sort_order;
*/

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Summary of created objects:
-- ✅ 1 Storage bucket: catalog-images (public, 10MB limit)
-- ✅ 4 Storage policies: public read, admin insert/update/delete
-- ✅ 2 Helper functions: get_catalog_image_path(), get_catalog_image_url()
-- ✅ File type restrictions: JPEG, PNG, WebP, GIF only

-- Recommended folder structure created:
-- catalog-images/
--   ├── products/{slug}/{size}/{filename}
--   ├── categories/{slug}/{filename}
--   └── colors/swatches/{filename}

COMMENT ON FUNCTION get_catalog_image_path IS 'Helper to generate consistent paths for product images with size variants';
COMMENT ON FUNCTION get_catalog_image_url IS 'Helper to generate full public URLs for catalog images';
