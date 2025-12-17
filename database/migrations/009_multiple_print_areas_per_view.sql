-- Migration: Multiple Print Areas Per View
-- Purpose: Allow multiple print areas (e.g., center chest + breast pockets) per view
-- Date: 2025-11-12

-- Drop the variant_id dependency and make print areas view-based instead
ALTER TABLE print_areas
  DROP CONSTRAINT IF EXISTS print_areas_variant_id_fkey,
  ADD COLUMN IF NOT EXISTS product_template_id UUID REFERENCES product_templates(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS view_name VARCHAR(50) NOT NULL DEFAULT 'front';

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_print_areas_product_view
  ON print_areas(product_template_id, view_name);

-- Migrate existing data from variant-based to view-based
-- Copy variant_id data to product_template_id and view_name
UPDATE print_areas pa
SET
  product_template_id = v.product_template_id,
  view_name = v.view_name
FROM product_template_variants v
WHERE pa.variant_id = v.id
  AND pa.product_template_id IS NULL;

-- Now we can drop variant_id (after data migration)
ALTER TABLE print_areas
  DROP COLUMN IF EXISTS variant_id;

-- Update area_key to be unique per product+view+name combination
-- This allows multiple print areas per view
DROP INDEX IF EXISTS idx_print_areas_area_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_print_areas_unique_key
  ON print_areas(product_template_id, view_name, area_key);

-- Add display_order column for controlling order of print areas
ALTER TABLE print_areas
  ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;

-- Add is_required flag for mandatory print areas
ALTER TABLE print_areas
  ADD COLUMN IF NOT EXISTS is_required BOOLEAN DEFAULT false;

-- Comments
COMMENT ON COLUMN print_areas.product_template_id IS 'Product this print area belongs to (view-independent)';
COMMENT ON COLUMN print_areas.view_name IS 'View this print area appears on (front, back, etc.)';
COMMENT ON COLUMN print_areas.display_order IS 'Order in which print areas are displayed (0 = first)';
COMMENT ON COLUMN print_areas.is_required IS 'Whether this print area must have a design (for validation)';

-- Example: Insert preset print areas for apparel products
-- These are common industry-standard print locations

-- Function to add standard apparel print areas
CREATE OR REPLACE FUNCTION add_standard_apparel_print_areas(
  p_product_id UUID,
  p_product_type VARCHAR -- 't-shirt', 'hoodie', 'polo'
) RETURNS void AS $$
BEGIN
  -- Front Center Chest (main print area)
  INSERT INTO print_areas (
    product_template_id,
    view_name,
    name,
    area_key,
    x, y, width, height,
    width_mm, height_mm,
    max_width, max_height,
    shape,
    display_order,
    is_required
  ) VALUES (
    p_product_id,
    'front',
    'Center Chest',
    'center_chest',
    250, 250, 300, 300,  -- canvas position
    300, 300,             -- physical dimensions (mm)
    300, 300,
    'rectangle',
    0,
    true
  ) ON CONFLICT (product_template_id, view_name, area_key) DO NOTHING;

  -- Left Breast Pocket
  INSERT INTO print_areas (
    product_template_id,
    view_name,
    name,
    area_key,
    x, y, width, height,
    width_mm, height_mm,
    max_width, max_height,
    shape,
    display_order,
    is_required
  ) VALUES (
    p_product_id,
    'front',
    'Left Breast Pocket',
    'left_breast_pocket',
    150, 100, 80, 80,   -- canvas position
    80, 80,              -- physical dimensions (mm)
    80, 80,
    'rectangle',
    1,
    false
  ) ON CONFLICT (product_template_id, view_name, area_key) DO NOTHING;

  -- Right Breast Pocket
  INSERT INTO print_areas (
    product_template_id,
    view_name,
    name,
    area_key,
    x, y, width, height,
    width_mm, height_mm,
    max_width, max_height,
    shape,
    display_order,
    is_required
  ) VALUES (
    p_product_id,
    'front',
    'Right Breast Pocket',
    'right_breast_pocket',
    570, 100, 80, 80,   -- canvas position
    80, 80,              -- physical dimensions (mm)
    80, 80,
    'rectangle',
    2,
    false
  ) ON CONFLICT (product_template_id, view_name, area_key) DO NOTHING;

  -- Back Center (main back print)
  INSERT INTO print_areas (
    product_template_id,
    view_name,
    name,
    area_key,
    x, y, width, height,
    width_mm, height_mm,
    max_width, max_height,
    shape,
    display_order,
    is_required
  ) VALUES (
    p_product_id,
    'back',
    'Center Back',
    'center_back',
    250, 250, 300, 300,  -- canvas position
    300, 300,             -- physical dimensions (mm)
    300, 300,
    'rectangle',
    0,
    false
  ) ON CONFLICT (product_template_id, view_name, area_key) DO NOTHING;

  -- Left Sleeve (optional)
  IF p_product_type IN ('t-shirt', 'hoodie') THEN
    INSERT INTO print_areas (
      product_template_id,
      view_name,
      name,
      area_key,
      x, y, width, height,
      width_mm, height_mm,
      max_width, max_height,
      shape,
      display_order,
      is_required
    ) VALUES (
      p_product_id,
      'front',  -- Sleeves appear on front view
      'Left Sleeve',
      'left_sleeve',
      50, 300, 100, 100,   -- canvas position (left side)
      100, 100,             -- physical dimensions (mm)
      100, 100,
      'rectangle',
      3,
      false
    ) ON CONFLICT (product_template_id, view_name, area_key) DO NOTHING;

    -- Right Sleeve
    INSERT INTO print_areas (
      product_template_id,
      view_name,
      name,
      area_key,
      x, y, width, height,
      width_mm, height_mm,
      max_width, max_height,
      shape,
      display_order,
      is_required
    ) VALUES (
      p_product_id,
      'front',  -- Sleeves appear on front view
      'Right Sleeve',
      'right_sleeve',
      650, 300, 100, 100,  -- canvas position (right side)
      100, 100,             -- physical dimensions (mm)
      100, 100,
      'rectangle',
      4,
      false
    ) ON CONFLICT (product_template_id, view_name, area_key) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Update RLS policies if they exist
DROP POLICY IF EXISTS "Public read access" ON print_areas;
CREATE POLICY "Public read access"
  ON print_areas FOR SELECT
  TO PUBLIC
  USING (true);

DROP POLICY IF EXISTS "Admin full access" ON print_areas;
CREATE POLICY "Admin full access"
  ON print_areas FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Enable RLS if not already enabled
ALTER TABLE print_areas ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE print_areas IS 'Print areas are now view-based and support multiple areas per view (e.g., center chest + breast pockets on front)';
