-- =====================================================
-- Print Area Configuration Database Schema
-- =====================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- Tables
-- =====================================================

-- Product Templates Table
-- Stores the main product configurations
CREATE TABLE IF NOT EXISTS product_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  template_url TEXT,
  colors JSONB DEFAULT '[]'::jsonb,
  base_price DECIMAL(10, 2) DEFAULT 0.00,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Print Areas Table
-- Stores print area configurations for each product
CREATE TABLE IF NOT EXISTS print_areas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_template_id UUID REFERENCES product_templates(id) ON DELETE CASCADE,
  area_key TEXT NOT NULL,
  name TEXT NOT NULL,
  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 100,
  height INTEGER NOT NULL DEFAULT 100,
  max_width INTEGER NOT NULL DEFAULT 100,
  max_height INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(product_template_id, area_key)
);

-- =====================================================
-- Indexes for Performance
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_product_templates_key ON product_templates(product_key);
CREATE INDEX IF NOT EXISTS idx_product_templates_created_by ON product_templates(created_by);
CREATE INDEX IF NOT EXISTS idx_print_areas_product_id ON print_areas(product_template_id);
CREATE INDEX IF NOT EXISTS idx_print_areas_area_key ON print_areas(area_key);

-- =====================================================
-- Functions
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = user_id
    AND (raw_user_meta_data->>'is_admin')::boolean = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- Triggers
-- =====================================================

-- Trigger for product_templates updated_at
DROP TRIGGER IF EXISTS update_product_templates_updated_at ON product_templates;
CREATE TRIGGER update_product_templates_updated_at
  BEFORE UPDATE ON product_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for print_areas updated_at
DROP TRIGGER IF EXISTS update_print_areas_updated_at ON print_areas;
CREATE TRIGGER update_print_areas_updated_at
  BEFORE UPDATE ON print_areas
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Row Level Security (RLS)
-- =====================================================

-- Enable RLS
ALTER TABLE product_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_areas ENABLE ROW LEVEL SECURITY;

-- Product Templates Policies

-- Everyone can read product templates
DROP POLICY IF EXISTS "Anyone can view product templates" ON product_templates;
CREATE POLICY "Anyone can view product templates"
  ON product_templates FOR SELECT
  TO authenticated, anon
  USING (true);

-- Only admins can insert product templates
DROP POLICY IF EXISTS "Admins can insert product templates" ON product_templates;
CREATE POLICY "Admins can insert product templates"
  ON product_templates FOR INSERT
  TO authenticated
  WITH CHECK (is_admin(auth.uid()));

-- Only admins can update product templates
DROP POLICY IF EXISTS "Admins can update product templates" ON product_templates;
CREATE POLICY "Admins can update product templates"
  ON product_templates FOR UPDATE
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Only admins can delete product templates
DROP POLICY IF EXISTS "Admins can delete product templates" ON product_templates;
CREATE POLICY "Admins can delete product templates"
  ON product_templates FOR DELETE
  TO authenticated
  USING (is_admin(auth.uid()));

-- Print Areas Policies

-- Everyone can read print areas
DROP POLICY IF EXISTS "Anyone can view print areas" ON print_areas;
CREATE POLICY "Anyone can view print areas"
  ON print_areas FOR SELECT
  TO authenticated, anon
  USING (true);

-- Only admins can insert print areas
DROP POLICY IF EXISTS "Admins can insert print areas" ON print_areas;
CREATE POLICY "Admins can insert print areas"
  ON print_areas FOR INSERT
  TO authenticated
  WITH CHECK (is_admin(auth.uid()));

-- Only admins can update print areas
DROP POLICY IF EXISTS "Admins can update print areas" ON print_areas;
CREATE POLICY "Admins can update print areas"
  ON print_areas FOR UPDATE
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Only admins can delete print areas
DROP POLICY IF EXISTS "Admins can delete print areas" ON print_areas;
CREATE POLICY "Admins can delete print areas"
  ON print_areas FOR DELETE
  TO authenticated
  USING (is_admin(auth.uid()));

-- =====================================================
-- Initial Data Migration (Optional)
-- =====================================================
-- This section can be used to migrate existing products.json data
-- Run this after creating the tables if you want to import existing data

/*
-- Example: Insert tshirt product
INSERT INTO product_templates (product_key, name, template_url, colors, base_price)
VALUES (
  'tshirt',
  'T-Shirt',
  '/templates/tshirt/template.png',
  '["#ffffff", "#000000", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff"]'::jsonb,
  15.99
) ON CONFLICT (product_key) DO NOTHING;

-- Insert tshirt print areas
WITH tshirt_id AS (
  SELECT id FROM product_templates WHERE product_key = 'tshirt'
)
INSERT INTO print_areas (product_template_id, area_key, name, x, y, width, height, max_width, max_height)
SELECT 
  tshirt_id.id,
  area_key,
  area_data->>'name',
  (area_data->>'x')::integer,
  (area_data->>'y')::integer,
  (area_data->>'width')::integer,
  (area_data->>'height')::integer,
  (area_data->>'maxWidth')::integer,
  (area_data->>'maxHeight')::integer
FROM tshirt_id,
jsonb_each('{
  "front": {"name": "Front", "x": 250, "y": 200, "width": 300, "height": 350, "maxWidth": 300, "maxHeight": 350},
  "back": {"name": "Back", "x": 250, "y": 200, "width": 300, "height": 350, "maxWidth": 300, "maxHeight": 350}
}'::jsonb) AS area(area_key, area_data)
ON CONFLICT (product_template_id, area_key) DO NOTHING;
*/

-- =====================================================
-- Storage Setup
-- =====================================================
-- Run these commands in Supabase Dashboard > Storage

/*
1. Create a storage bucket:
   - Name: product-templates
   - Public: Yes
   - Allowed MIME types: image/png, image/jpeg, image/webp
   - Max file size: 5MB

2. Set up storage policies in SQL Editor:
*/

-- Storage policies for product-templates bucket
-- Enable public read access
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-templates', 'product-templates', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Allow anyone to view files
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "Public Access"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'product-templates');

-- Only admins can upload files
DROP POLICY IF EXISTS "Admins can upload" ON storage.objects;
CREATE POLICY "Admins can upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'product-templates' 
    AND is_admin(auth.uid())
  );

-- Only admins can update files
DROP POLICY IF EXISTS "Admins can update" ON storage.objects;
CREATE POLICY "Admins can update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'product-templates' 
    AND is_admin(auth.uid())
  );

-- Only admins can delete files
DROP POLICY IF EXISTS "Admins can delete" ON storage.objects;
CREATE POLICY "Admins can delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'product-templates' 
    AND is_admin(auth.uid())
  );

-- =====================================================
-- Helper Views
-- =====================================================

-- View to get complete product configuration with print areas
CREATE OR REPLACE VIEW product_configurations AS
SELECT 
  pt.id,
  pt.product_key,
  pt.name,
  pt.template_url,
  pt.colors,
  pt.base_price,
  pt.created_at,
  pt.updated_at,
  jsonb_object_agg(
    pa.area_key,
    jsonb_build_object(
      'name', pa.name,
      'x', pa.x,
      'y', pa.y,
      'width', pa.width,
      'height', pa.height,
      'maxWidth', pa.max_width,
      'maxHeight', pa.max_height
    )
  ) FILTER (WHERE pa.id IS NOT NULL) AS print_areas
FROM product_templates pt
LEFT JOIN print_areas pa ON pt.id = pa.product_template_id
GROUP BY pt.id, pt.product_key, pt.name, pt.template_url, pt.colors, pt.base_price, pt.created_at, pt.updated_at;

-- =====================================================
-- Grant Permissions
-- =====================================================

-- Grant access to authenticated users
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON product_configurations TO authenticated;

-- Grant full access to service role (for admin operations)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON product_configurations TO service_role;

-- =====================================================
-- Complete!
-- =====================================================
-- The database schema is now set up and ready to use.
-- Remember to:
-- 1. Create the product-templates storage bucket in Supabase Dashboard
-- 2. Mark users as admin by setting is_admin = true in raw_user_meta_data
-- 3. Test the connection from your application
