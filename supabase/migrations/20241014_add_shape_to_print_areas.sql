-- Migration: Add shape column to print_areas table
-- Date: 2025-10-14
-- Description: Add support for circle/ellipse print areas in addition to rectangles

-- Add shape column with default value 'rectangle' for existing rows
ALTER TABLE print_areas 
ADD COLUMN IF NOT EXISTS shape VARCHAR(20) DEFAULT 'rectangle';

-- Add constraint to ensure only valid shapes are used
ALTER TABLE print_areas 
ADD CONSTRAINT valid_shape 
CHECK (shape IN ('rectangle', 'circle', 'ellipse'));

-- Comment on the new column
COMMENT ON COLUMN print_areas.shape IS 'Shape type of the print area: rectangle, circle, or ellipse';

-- For existing print areas, explicitly set shape to 'rectangle' to be clear
UPDATE print_areas SET shape = 'rectangle' WHERE shape IS NULL;
