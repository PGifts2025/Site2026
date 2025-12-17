-- Migration: Create Product Catalog System
-- This migration creates a comprehensive public-facing product catalog
-- that integrates with the existing Designer template system.
--
-- Key Features:
-- 1. Draft/Active/Archived workflow for products
-- 2. Multiple image size variants (thumbnail/medium/large)
-- 3. Volume-based pricing tiers
-- 4. Optional Designer integration for customizable products
-- 5. Comprehensive RLS policies

-- ============================================================================
-- 1. CATALOG CATEGORIES TABLE
-- ============================================================================
-- Purpose: Product categories for navigation (Bags, Cups, Clothing, etc.)

CREATE TABLE IF NOT EXISTS catalog_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Basic Info
  name VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,

  -- Display
  icon VARCHAR(50),                     -- Icon name or emoji
  image_url TEXT,                       -- Category banner image
  sort_order INTEGER DEFAULT 0,

  -- Hierarchy Support (for future subcategories)
  parent_id UUID REFERENCES catalog_categories(id) ON DELETE SET NULL,

  -- SEO
  meta_title VARCHAR(255),
  meta_description TEXT,

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_catalog_categories_slug
  ON catalog_categories(slug);
CREATE INDEX IF NOT EXISTS idx_catalog_categories_parent
  ON catalog_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_catalog_categories_active_sort
  ON catalog_categories(is_active, sort_order);

-- Comments
COMMENT ON TABLE catalog_categories IS 'Product categories for catalog organization and navigation';
COMMENT ON COLUMN catalog_categories.parent_id IS 'Optional parent category for hierarchical structure';
COMMENT ON COLUMN catalog_categories.sort_order IS 'Display order in navigation (lower numbers first)';

-- ============================================================================
-- 2. CATALOG PRODUCTS TABLE (Main Product Catalog)
-- ============================================================================
-- Purpose: Customer-facing products with optional Designer integration
-- Status Workflow: draft → active → archived

CREATE TABLE IF NOT EXISTS catalog_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Category
  category_id UUID REFERENCES catalog_categories(id) ON DELETE SET NULL,

  -- Basic Info
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  subtitle TEXT,
  description TEXT,

  -- Ratings & Social Proof
  rating DECIMAL(2,1) CHECK (rating >= 0 AND rating <= 5) DEFAULT 0.0,
  review_count INTEGER DEFAULT 0 CHECK (review_count >= 0),

  -- Badges & Features
  badge VARCHAR(50),                    -- "Best Seller", "Eco Option", "NEW"
  is_featured BOOLEAN DEFAULT false,
  is_customizable BOOLEAN DEFAULT false,  -- Can user add logo/design?

  -- Status Workflow (replaces is_active)
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  published_at TIMESTAMP WITH TIME ZONE,  -- Set when status first becomes 'active'

  -- Minimum Order
  min_order_quantity INTEGER DEFAULT 25 CHECK (min_order_quantity > 0),

  -- 🔗 INTEGRATION POINT: Link to Designer System
  designer_product_id UUID REFERENCES product_templates(id) ON DELETE SET NULL,
  -- NULL = not customizable (regular product)
  -- NOT NULL = links to designer template, enables "Customize" button

  -- SEO
  meta_title VARCHAR(255),
  meta_description TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_catalog_products_category
  ON catalog_products(category_id);
CREATE INDEX IF NOT EXISTS idx_catalog_products_slug
  ON catalog_products(slug);
CREATE INDEX IF NOT EXISTS idx_catalog_products_status
  ON catalog_products(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_catalog_products_featured
  ON catalog_products(is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_catalog_products_customizable
  ON catalog_products(is_customizable) WHERE is_customizable = true;
CREATE INDEX IF NOT EXISTS idx_catalog_products_designer_product
  ON catalog_products(designer_product_id);

-- Comments
COMMENT ON TABLE catalog_products IS 'Customer-facing product catalog with optional Designer integration';
COMMENT ON COLUMN catalog_products.status IS 'Product status: draft (hidden), active (live), archived (hidden but preserved)';
COMMENT ON COLUMN catalog_products.published_at IS 'Timestamp when product was first published (status changed to active)';
COMMENT ON COLUMN catalog_products.is_customizable IS 'Whether product can be customized in Designer';
COMMENT ON COLUMN catalog_products.designer_product_id IS 'Optional FK to product_templates for customizable products';

-- ============================================================================
-- 3. CATALOG PRODUCT COLORS TABLE
-- ============================================================================
-- Purpose: Color options available for each product

CREATE TABLE IF NOT EXISTS catalog_product_colors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalog_product_id UUID NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,

  -- Color Info
  color_code VARCHAR(50) NOT NULL,      -- Internal ID (e.g., 'midnight', 'navy')
  color_name VARCHAR(100) NOT NULL,     -- Display name (e.g., 'Midnight Black')
  hex_value CHAR(7),                    -- Hex color code (#1a1a1a)

  -- Display
  swatch_image_url TEXT,                -- Optional color swatch image
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

  UNIQUE(catalog_product_id, color_code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_catalog_colors_product
  ON catalog_product_colors(catalog_product_id);
CREATE INDEX IF NOT EXISTS idx_catalog_colors_active
  ON catalog_product_colors(catalog_product_id, is_active) WHERE is_active = true;

-- Comments
COMMENT ON TABLE catalog_product_colors IS 'Color variants available for catalog products';
COMMENT ON COLUMN catalog_product_colors.color_code IS 'Internal identifier for color (e.g., midnight, navy)';
COMMENT ON COLUMN catalog_product_colors.hex_value IS 'Hex color code for display (#1a1a1a)';

-- ============================================================================
-- 4. CATALOG PRODUCT IMAGES TABLE (with size variants)
-- ============================================================================
-- Purpose: Product photos with multiple size options for optimization

CREATE TABLE IF NOT EXISTS catalog_product_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalog_product_id UUID NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  color_id UUID REFERENCES catalog_product_colors(id) ON DELETE SET NULL,

  -- Image URLs (multiple sizes for optimization)
  image_url TEXT NOT NULL,              -- Original/full size image
  thumbnail_url TEXT,                   -- 200x200 for product cards/grids
  medium_url TEXT,                      -- 600x600 for product detail pages
  large_url TEXT,                       -- 1200x1200 for zoom views

  alt_text TEXT,
  image_type VARCHAR(50),               -- 'main', 'gallery', 'lifestyle', 'detail'

  -- Display
  sort_order INTEGER DEFAULT 0,
  is_primary BOOLEAN DEFAULT false,     -- Main product image

  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_catalog_images_product
  ON catalog_product_images(catalog_product_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_catalog_images_color
  ON catalog_product_images(color_id);
CREATE INDEX IF NOT EXISTS idx_catalog_images_primary
  ON catalog_product_images(catalog_product_id, is_primary) WHERE is_primary = true;

-- Comments
COMMENT ON TABLE catalog_product_images IS 'Product gallery images with multiple size variants for optimization';
COMMENT ON COLUMN catalog_product_images.image_url IS 'Original/full size image URL (required)';
COMMENT ON COLUMN catalog_product_images.thumbnail_url IS '200x200 thumbnail for product cards/grids';
COMMENT ON COLUMN catalog_product_images.medium_url IS '600x600 for product detail pages';
COMMENT ON COLUMN catalog_product_images.large_url IS '1200x1200 for zoom/lightbox views';
COMMENT ON COLUMN catalog_product_images.color_id IS 'Optional link to specific color variant';

-- ============================================================================
-- 5. CATALOG PRICING TIERS TABLE
-- ============================================================================
-- Purpose: Volume-based pricing with historical tracking

CREATE TABLE IF NOT EXISTS catalog_pricing_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalog_product_id UUID NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,

  -- Tier Definition
  min_quantity INTEGER NOT NULL CHECK (min_quantity > 0),
  max_quantity INTEGER CHECK (max_quantity IS NULL OR max_quantity > min_quantity),
  price_per_unit DECIMAL(10,2) NOT NULL CHECK (price_per_unit > 0),

  -- Display
  is_popular BOOLEAN DEFAULT false,     -- Highlight this tier in UI

  -- Historical Tracking (for price changes)
  effective_from TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  effective_to TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_catalog_pricing_product
  ON catalog_pricing_tiers(catalog_product_id);
CREATE INDEX IF NOT EXISTS idx_catalog_pricing_quantity
  ON catalog_pricing_tiers(catalog_product_id, min_quantity, max_quantity);
CREATE INDEX IF NOT EXISTS idx_catalog_pricing_effective
  ON catalog_pricing_tiers(effective_from, effective_to);

-- Comments
COMMENT ON TABLE catalog_pricing_tiers IS 'Volume-based pricing tiers with historical tracking';
COMMENT ON COLUMN catalog_pricing_tiers.max_quantity IS 'NULL means unlimited (1000+)';
COMMENT ON COLUMN catalog_pricing_tiers.is_popular IS 'Highlight as most popular tier in UI';
COMMENT ON COLUMN catalog_pricing_tiers.effective_from IS 'When this pricing becomes active';
COMMENT ON COLUMN catalog_pricing_tiers.effective_to IS 'When this pricing expires (NULL = current)';

-- ============================================================================
-- 6. CATALOG PRODUCT FEATURES TABLE
-- ============================================================================
-- Purpose: Feature bullet points for product pages

CREATE TABLE IF NOT EXISTS catalog_product_features (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalog_product_id UUID NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,

  feature_text TEXT NOT NULL,
  icon VARCHAR(50),                     -- Optional icon name/emoji
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_catalog_features_product
  ON catalog_product_features(catalog_product_id, sort_order);

-- Comments
COMMENT ON TABLE catalog_product_features IS 'Feature bullet points displayed on product pages';

-- ============================================================================
-- 7. CATALOG PRODUCT SPECIFICATIONS TABLE
-- ============================================================================
-- Purpose: Technical specifications (flexible JSONB schema)

CREATE TABLE IF NOT EXISTS catalog_product_specifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalog_product_id UUID NOT NULL UNIQUE REFERENCES catalog_products(id) ON DELETE CASCADE,

  -- Flexible JSON schema for different product types
  specifications JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_catalog_specs_product
  ON catalog_product_specifications(catalog_product_id);
CREATE INDEX IF NOT EXISTS idx_catalog_specs_jsonb
  ON catalog_product_specifications USING GIN (specifications);

-- Comments
COMMENT ON TABLE catalog_product_specifications IS 'Technical specifications stored as flexible JSONB';
COMMENT ON COLUMN catalog_product_specifications.specifications IS 'JSONB object with specs (capacity, material, dimensions, weight, etc.)';

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT TIMESTAMPS
-- ============================================================================
-- Use existing update_updated_at_column() function from previous migrations

DROP TRIGGER IF EXISTS update_catalog_categories_updated_at ON catalog_categories;
CREATE TRIGGER update_catalog_categories_updated_at
  BEFORE UPDATE ON catalog_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_catalog_products_updated_at ON catalog_products;
CREATE TRIGGER update_catalog_products_updated_at
  BEFORE UPDATE ON catalog_products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_catalog_specs_updated_at ON catalog_product_specifications;
CREATE TRIGGER update_catalog_specs_updated_at
  BEFORE UPDATE ON catalog_product_specifications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- TRIGGER FOR PUBLISHED_AT TIMESTAMP
-- ============================================================================
-- Automatically set published_at when status changes to 'active' for first time

CREATE OR REPLACE FUNCTION set_published_at_on_active()
RETURNS TRIGGER AS $$
BEGIN
  -- If status is changing to 'active' and published_at is NULL
  IF NEW.status = 'active' AND OLD.status != 'active' AND NEW.published_at IS NULL THEN
    NEW.published_at = timezone('utc'::text, now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_catalog_product_published_at ON catalog_products;
CREATE TRIGGER set_catalog_product_published_at
  BEFORE UPDATE ON catalog_products
  FOR EACH ROW
  WHEN (NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active')
  EXECUTE FUNCTION set_published_at_on_active();

COMMENT ON FUNCTION set_published_at_on_active() IS 'Sets published_at timestamp when product status changes to active for the first time';

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all catalog tables
ALTER TABLE catalog_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_product_colors ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_pricing_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_product_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_product_specifications ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- CATALOG_CATEGORIES POLICIES
-- ----------------------------------------------------------------------------

CREATE POLICY "Anyone can view active categories"
  ON catalog_categories FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can view all categories"
  ON catalog_categories FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Admins can manage categories"
  ON catalog_categories FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- CATALOG_PRODUCTS POLICIES (Status-based access)
-- ----------------------------------------------------------------------------

-- Public users can only see ACTIVE products
CREATE POLICY "Anyone can view active products"
  ON catalog_products FOR SELECT
  USING (status = 'active');

-- Admins can see ALL products (draft, active, archived)
CREATE POLICY "Admins can view all products"
  ON catalog_products FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- Admins can insert new products
CREATE POLICY "Admins can insert products"
  ON catalog_products FOR INSERT
  TO authenticated
  WITH CHECK (is_admin(auth.uid()));

-- Admins can update products (including status changes)
CREATE POLICY "Admins can update products"
  ON catalog_products FOR UPDATE
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Admins can delete products
CREATE POLICY "Admins can delete products"
  ON catalog_products FOR DELETE
  TO authenticated
  USING (is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- CATALOG_PRODUCT_COLORS POLICIES
-- ----------------------------------------------------------------------------

-- Public can view active colors of active products only
CREATE POLICY "Anyone can view active colors"
  ON catalog_product_colors FOR SELECT
  USING (
    is_active = true AND
    EXISTS (
      SELECT 1 FROM catalog_products
      WHERE id = catalog_product_colors.catalog_product_id
      AND status = 'active'
    )
  );

-- Admins can view all colors
CREATE POLICY "Admins can view all colors"
  ON catalog_product_colors FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- Admins can manage colors
CREATE POLICY "Admins can manage colors"
  ON catalog_product_colors FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- CATALOG_PRODUCT_IMAGES POLICIES
-- ----------------------------------------------------------------------------

-- Public can view images of active products only
CREATE POLICY "Anyone can view images of active products"
  ON catalog_product_images FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM catalog_products
      WHERE id = catalog_product_images.catalog_product_id
      AND status = 'active'
    )
  );

-- Admins can view all images
CREATE POLICY "Admins can view all images"
  ON catalog_product_images FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- Admins can manage images
CREATE POLICY "Admins can manage images"
  ON catalog_product_images FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- CATALOG_PRICING_TIERS POLICIES
-- ----------------------------------------------------------------------------

-- Public can view current pricing of active products only
CREATE POLICY "Anyone can view current pricing of active products"
  ON catalog_pricing_tiers FOR SELECT
  USING (
    effective_from <= timezone('utc'::text, now()) AND
    (effective_to IS NULL OR effective_to > timezone('utc'::text, now())) AND
    EXISTS (
      SELECT 1 FROM catalog_products
      WHERE id = catalog_pricing_tiers.catalog_product_id
      AND status = 'active'
    )
  );

-- Admins can view all pricing (including historical)
CREATE POLICY "Admins can view all pricing"
  ON catalog_pricing_tiers FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- Admins can manage pricing
CREATE POLICY "Admins can manage pricing"
  ON catalog_pricing_tiers FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- CATALOG_PRODUCT_FEATURES POLICIES
-- ----------------------------------------------------------------------------

-- Public can view features of active products only
CREATE POLICY "Anyone can view features of active products"
  ON catalog_product_features FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM catalog_products
      WHERE id = catalog_product_features.catalog_product_id
      AND status = 'active'
    )
  );

-- Admins can view all features
CREATE POLICY "Admins can view all features"
  ON catalog_product_features FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- Admins can manage features
CREATE POLICY "Admins can manage features"
  ON catalog_product_features FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- CATALOG_PRODUCT_SPECIFICATIONS POLICIES
-- ----------------------------------------------------------------------------

-- Public can view specs of active products only
CREATE POLICY "Anyone can view specs of active products"
  ON catalog_product_specifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM catalog_products
      WHERE id = catalog_product_specifications.catalog_product_id
      AND status = 'active'
    )
  );

-- Admins can view all specs
CREATE POLICY "Admins can view all specs"
  ON catalog_product_specifications FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- Admins can manage specs
CREATE POLICY "Admins can manage specs"
  ON catalog_product_specifications FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- ============================================================================
-- SAMPLE DATA (Optional - for development/testing)
-- ============================================================================

-- Insert sample categories
INSERT INTO catalog_categories (name, slug, icon, sort_order) VALUES
  ('Cups', 'cups', '☕', 1),
  ('Water Bottles', 'water-bottles', '🍼', 2),
  ('Bags', 'bags', '👜', 3),
  ('Clothing', 'clothing', '👕', 4),
  ('Hi Vis', 'hi-vis', '🦺', 5),
  ('Cables', 'cables', '🔌', 6),
  ('Power', 'power', '🔋', 7),
  ('Speakers', 'speakers', '🔊', 8),
  ('Pens & Writing', 'pens', '✒️', 9),
  ('Notebooks', 'notebooks', '📓', 10),
  ('Tea Towels', 'tea-towels', '🍽️', 11)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Summary of created objects:
-- ✅ 7 Tables: catalog_categories, catalog_products, catalog_product_colors,
--              catalog_product_images, catalog_pricing_tiers,
--              catalog_product_features, catalog_product_specifications
-- ✅ 23 Indexes for query optimization
-- ✅ 4 Triggers for automatic timestamp updates and published_at
-- ✅ 1 New function: set_published_at_on_active()
-- ✅ 22 RLS Policies (status-based access control)
-- ✅ 11 Sample categories inserted

COMMENT ON SCHEMA public IS 'Product catalog system with draft/active/archived workflow and Designer integration';
