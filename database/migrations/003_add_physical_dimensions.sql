-- Migration: Add Physical Dimensions to Print Areas
-- This migration adds support for:
-- 1. Physical dimensions in millimeters (width_mm, height_mm)
-- 2. Customer-facing description for print areas
-- 3. Better user experience by showing real-world dimensions

-- Add physical dimension columns to print_areas table
ALTER TABLE print_areas
  ADD COLUMN IF NOT EXISTS width_mm NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS height_mm NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_print_areas_dimensions
  ON print_areas(width_mm, height_mm);

-- Add comments for documentation
COMMENT ON COLUMN print_areas.width_mm IS 'Physical width of print area in millimeters';
COMMENT ON COLUMN print_areas.height_mm IS 'Physical height of print area in millimeters';
COMMENT ON COLUMN print_areas.description IS 'Customer-facing description of the print area (e.g., "Perfect for logos", "Full-size design area")';

-- Example: If you want to populate existing print areas with estimated MM dimensions
-- based on a standard conversion (e.g., 96 DPI = 0.2646 mm per pixel), uncomment below:
--
-- UPDATE print_areas
-- SET
--   width_mm = ROUND((width * 0.2646)::numeric, 2),
--   height_mm = ROUND((height * 0.2646)::numeric, 2)
-- WHERE width_mm IS NULL AND height_mm IS NULL;
