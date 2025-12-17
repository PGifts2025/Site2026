-- Migration: Add Color Variation and Multiple View Support
-- This migration adds support for:
-- 1. Color variations per product
-- 2. Multiple views per product (front, back, side, etc.)
-- 3. View-specific print areas

-- Create enum type for views if not exists
DO $$ BEGIN
    CREATE TYPE product_view AS ENUM ('front', 'back', 'left', 'right', 'top', 'bottom', 'inside', 'custom');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add new columns to product_templates table
ALTER TABLE product_templates
  ADD COLUMN IF NOT EXISTS default_view VARCHAR(50) DEFAULT 'front',
  ADD COLUMN IF NOT EXISTS available_views TEXT[] DEFAULT ARRAY['front'];

-- Create product_template_variants table
-- This table stores specific templates for each color and view combination
CREATE TABLE IF NOT EXISTS product_template_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_template_id UUID NOT NULL REFERENCES product_templates(id) ON DELETE CASCADE,
  color_name VARCHAR(100) NOT NULL, -- e.g., "Black", "Navy", "Red"
  color_code VARCHAR(20) NOT NULL, -- e.g., "#000000", "#001f3f", "#ff0000"
  view_name VARCHAR(50) NOT NULL, -- e.g., "front", "back", "side"
  template_url TEXT NOT NULL, -- URL to the template image for this specific color+view
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(product_template_id, color_code, view_name)
);

-- Add indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_variants_product_template 
  ON product_template_variants(product_template_id);
CREATE INDEX IF NOT EXISTS idx_variants_color 
  ON product_template_variants(color_code);
CREATE INDEX IF NOT EXISTS idx_variants_view 
  ON product_template_variants(view_name);
CREATE INDEX IF NOT EXISTS idx_variants_composite 
  ON product_template_variants(product_template_id, color_code, view_name);

-- Add variant_id to print_areas table to make print areas view-specific
ALTER TABLE print_areas
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_template_variants(id) ON DELETE CASCADE;

-- Create index for print areas by variant
CREATE INDEX IF NOT EXISTS idx_print_areas_variant 
  ON print_areas(variant_id);

-- Add updated_at trigger for product_template_variants
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_product_template_variants_updated_at ON product_template_variants;
CREATE TRIGGER update_product_template_variants_updated_at 
  BEFORE UPDATE ON product_template_variants 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS (Row Level Security) for new table
ALTER TABLE product_template_variants ENABLE ROW LEVEL SECURITY;

-- Create policies for product_template_variants
CREATE POLICY "Public read access to variants"
  ON product_template_variants FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert variants"
  ON product_template_variants FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update variants"
  ON product_template_variants FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete variants"
  ON product_template_variants FOR DELETE
  USING (auth.role() = 'authenticated');

-- Migrate existing data
-- For each existing product_template, create a variant for each color with the default view
DO $$
DECLARE
  template_record RECORD;
  color_value TEXT;
BEGIN
  FOR template_record IN SELECT * FROM product_templates LOOP
    -- Handle products with colors array
    IF template_record.colors IS NOT NULL AND jsonb_array_length(template_record.colors) > 0 THEN
      FOR color_value IN SELECT jsonb_array_elements_text(template_record.colors) LOOP
        -- Create variant for this color with front view
        INSERT INTO product_template_variants (
          product_template_id,
          color_name,
          color_code,
          view_name,
          template_url
        ) VALUES (
          template_record.id,
          color_value, -- Use color code as name for now
          color_value,
          'front',
          template_record.template_url
        )
        ON CONFLICT (product_template_id, color_code, view_name) DO NOTHING;
      END LOOP;
    ELSE
      -- Product has no colors, create a default variant
      INSERT INTO product_template_variants (
        product_template_id,
        color_name,
        color_code,
        view_name,
        template_url
      ) VALUES (
        template_record.id,
        'Default',
        '#FFFFFF',
        'front',
        template_record.template_url
      )
      ON CONFLICT (product_template_id, color_code, view_name) DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- Link existing print areas to their variants
-- This assumes all existing print areas should be for the front view of the first color
DO $$
DECLARE
  area_record RECORD;
  variant_id_value UUID;
BEGIN
  FOR area_record IN SELECT * FROM print_areas WHERE variant_id IS NULL LOOP
    -- Get the first variant for this product template (front view, first color)
    SELECT id INTO variant_id_value
    FROM product_template_variants
    WHERE product_template_id = area_record.product_template_id
    ORDER BY created_at ASC
    LIMIT 1;
    
    -- Update the print area to link to this variant
    IF variant_id_value IS NOT NULL THEN
      UPDATE print_areas
      SET variant_id = variant_id_value
      WHERE id = area_record.id;
    END IF;
  END LOOP;
END $$;

-- Add comments for documentation
COMMENT ON TABLE product_template_variants IS 'Stores template images for specific color and view combinations of products';
COMMENT ON COLUMN product_template_variants.color_name IS 'Human-readable color name (e.g., "Navy Blue")';
COMMENT ON COLUMN product_template_variants.color_code IS 'Hex color code (e.g., "#001f3f")';
COMMENT ON COLUMN product_template_variants.view_name IS 'View identifier (e.g., "front", "back", "side")';
COMMENT ON COLUMN product_template_variants.template_url IS 'URL to template image for this specific color+view';
COMMENT ON COLUMN print_areas.variant_id IS 'Links print area to a specific product variant (color+view combination)';
