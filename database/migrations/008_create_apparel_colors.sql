-- ============================================================
-- Migration 008: Create Apparel Color Management System
-- ============================================================
-- Purpose: Comprehensive color library for Gildan 5000 products
-- Integrates with existing product_templates table
-- ============================================================

-- ============================================================
-- TABLE 1: apparel_colors
-- Master color library for all apparel products
-- ============================================================

CREATE TABLE IF NOT EXISTS public.apparel_colors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    color_name VARCHAR(100) NOT NULL UNIQUE,
    hex_code VARCHAR(7) NOT NULL,
    pantone_code VARCHAR(20),
    rgb_values VARCHAR(20) NOT NULL,
    color_family VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

COMMENT ON TABLE public.apparel_colors IS 'Master color library for all apparel products';
COMMENT ON COLUMN public.apparel_colors.color_name IS 'Official color name (e.g., Cardinal Red)';
COMMENT ON COLUMN public.apparel_colors.hex_code IS 'Hexadecimal color code for web display';
COMMENT ON COLUMN public.apparel_colors.pantone_code IS 'Industry standard Pantone reference';
COMMENT ON COLUMN public.apparel_colors.rgb_values IS 'RGB values as comma-separated string';
COMMENT ON COLUMN public.apparel_colors.color_family IS 'Color category for organization';
COMMENT ON COLUMN public.apparel_colors.sort_order IS 'Display order in color pickers';

-- ============================================================
-- TABLE 2: product_template_colors
-- Junction table linking products to available colors
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_template_colors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_template_id UUID NOT NULL REFERENCES public.product_templates(id) ON DELETE CASCADE,
    apparel_color_id UUID NOT NULL REFERENCES public.apparel_colors(id) ON DELETE CASCADE,
    has_front_photo BOOLEAN DEFAULT false,
    has_back_photo BOOLEAN DEFAULT false,
    front_photo_url TEXT,
    back_photo_url TEXT,
    is_available BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(product_template_id, apparel_color_id)
);

COMMENT ON TABLE public.product_template_colors IS 'Links products to their available colors';
COMMENT ON COLUMN public.product_template_colors.has_front_photo IS 'True if actual product photo exists for front view';
COMMENT ON COLUMN public.product_template_colors.has_back_photo IS 'True if actual product photo exists for back view';
COMMENT ON COLUMN public.product_template_colors.front_photo_url IS 'Supabase storage URL for front view photo';
COMMENT ON COLUMN public.product_template_colors.back_photo_url IS 'Supabase storage URL for back view photo';
COMMENT ON COLUMN public.product_template_colors.is_available IS 'Can temporarily disable colors without deleting';

-- ============================================================
-- INDEXES
-- Performance optimization for common queries
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_product_colors_product
    ON public.product_template_colors(product_template_id);

CREATE INDEX IF NOT EXISTS idx_product_colors_color
    ON public.product_template_colors(apparel_color_id);

CREATE INDEX IF NOT EXISTS idx_apparel_colors_family
    ON public.apparel_colors(color_family);

CREATE INDEX IF NOT EXISTS idx_apparel_colors_active
    ON public.apparel_colors(is_active) WHERE is_active = true;

-- ============================================================
-- RLS POLICIES
-- Security: Public read, admin-only write
-- ============================================================

-- Enable RLS
ALTER TABLE public.apparel_colors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_template_colors ENABLE ROW LEVEL SECURITY;

-- apparel_colors: Public read access
DROP POLICY IF EXISTS "Public read access to apparel colors" ON public.apparel_colors;
CREATE POLICY "Public read access to apparel colors"
    ON public.apparel_colors
    FOR SELECT
    USING (true);

-- apparel_colors: Admin write access
DROP POLICY IF EXISTS "Admin write access to apparel colors" ON public.apparel_colors;
CREATE POLICY "Admin write access to apparel colors"
    ON public.apparel_colors
    FOR ALL
    USING (
        auth.jwt() ->> 'role' = 'admin'
        OR auth.jwt() -> 'user_metadata' ->> 'role' = 'admin'
    );

-- product_template_colors: Public read access
DROP POLICY IF EXISTS "Public read access to product colors" ON public.product_template_colors;
CREATE POLICY "Public read access to product colors"
    ON public.product_template_colors
    FOR SELECT
    USING (true);

-- product_template_colors: Admin write access
DROP POLICY IF EXISTS "Admin write access to product colors" ON public.product_template_colors;
CREATE POLICY "Admin write access to product colors"
    ON public.product_template_colors
    FOR ALL
    USING (
        auth.jwt() ->> 'role' = 'admin'
        OR auth.jwt() -> 'user_metadata' ->> 'role' = 'admin'
    );

-- ============================================================
-- SEED DATA: Complete Gildan 5000 Color Palette (65 Colors)
-- ============================================================
-- Organized by color family with accurate hex/Pantone values
-- Based on official Gildan color references
-- ============================================================

INSERT INTO public.apparel_colors (color_name, hex_code, pantone_code, rgb_values, color_family, sort_order) VALUES

-- ============================================================
-- BASICS (White, Black, Greys) - Sort 1-12
-- ============================================================
('White', '#FFFFFF', 'White', '255,255,255', 'Basics', 1),
('Natural', '#F5F1E8', 'Antique White', '245,241,232', 'Basics', 2),
('Black', '#25282A', 'Black 6 C', '37,40,42', 'Basics', 3),
('Ash Grey', '#C8C9C7', 'Cool Grey 3', '200,201,199', 'Basics', 4),
('Sport Grey', '#8B8C8E', 'Cool Grey 9', '139,140,142', 'Basics', 5),
('Dark Heather', '#616161', '425 C', '97,97,97', 'Basics', 6),
('Charcoal', '#464646', '419 C', '70,70,70', 'Basics', 7),
('Graphite Heather', '#575757', '426 C', '87,87,87', 'Basics', 8),
('Gravel', '#807F80', 'Cool Grey 10', '128,127,128', 'Basics', 9),
('Sand', '#D7C9B0', '468 C', '215,201,176', 'Basics', 10),
('Tan', '#C9B18A', '4545 C', '201,177,138', 'Basics', 11),
('Light Blue', '#9FC2E1', '277 C', '159,194,225', 'Basics', 12),

-- ============================================================
-- BLUES - Sort 13-22
-- ============================================================
('Navy', '#263147', '532 C', '38,49,71', 'Blues', 13),
('Dark Navy', '#1A1F2E', '532 C', '26,31,46', 'Blues', 14),
('Indigo Blue', '#29487D', '2747 C', '41,72,125', 'Blues', 15),
('Royal Blue', '#1F4788', '286 C', '31,71,136', 'Blues', 16),
('Sapphire', '#0F5F9A', '3015 C', '15,95,154', 'Blues', 17),
('Cobalt', '#3F5FA0', '7455 C', '63,95,160', 'Blues', 18),
('Iris', '#5E6FA5', '2108 C', '94,111,165', 'Blues', 19),
('Stone Blue', '#788995', '5415 C', '120,137,149', 'Blues', 20),
('Carolina Blue', '#8FBCDC', '2905 C', '143,188,220', 'Blues', 21),
('Cornflower Blue', '#8CADD3', '7453 C', '140,173,211', 'Blues', 22),

-- ============================================================
-- REDS & PINKS - Sort 23-32
-- ============================================================
('Cardinal Red', '#8D2838', '202 C', '141,40,56', 'Reds', 23),
('Cherry Red', '#971B2F', '7427 C', '151,27,47', 'Reds', 24),
('Red', '#BA1B2D', '186 C', '186,27,45', 'Reds', 25),
('Scarlet', '#C8102E', '186 C', '200,16,46', 'Reds', 26),
('Antique Cherry Red', '#971B2F', '7427 C', '151,27,47', 'Reds', 27),
('Maroon', '#5C2E3E', '7638 C', '92,46,62', 'Reds', 28),
('Garnet', '#70193D', '7644 C', '112,25,61', 'Reds', 29),
('Heliconia', '#DB3E79', '213 C', '219,62,121', 'Pinks', 30),
('Azalea', '#F47BA4', '210 C', '244,123,164', 'Pinks', 31),
('Light Pink', '#F9BDD2', '182 C', '249,189,210', 'Pinks', 32),

-- ============================================================
-- GREENS - Sort 33-40
-- ============================================================
('Forest Green', '#1D3C2E', '553 C', '29,60,46', 'Greens', 33),
('Military Green', '#4B5842', '5743 C', '75,88,66', 'Greens', 34),
('Irish Green', '#00843D', '348 C', '0,132,61', 'Greens', 35),
('Kelly Green', '#1D8348', '348 C', '29,131,72', 'Greens', 36),
('Kiwi', '#73B84E', '368 C', '115,184,78', 'Greens', 37),
('Lime', '#92BF55', '7488 C', '146,191,85', 'Greens', 38),
('Mint Green', '#9CD7C8', '338 C', '156,215,200', 'Greens', 39),
('Jade Dome', '#6BA68C', '556 C', '107,166,140', 'Greens', 40),

-- ============================================================
-- YELLOWS & GOLDS - Sort 41-45
-- ============================================================
('Daisy', '#F8E08E', '1205 C', '248,224,142', 'Yellows', 41),
('Cornsilk', '#FFF5CC', '7499 C', '255,245,204', 'Yellows', 42),
('Gold', '#E8A735', '7549 C', '232,167,53', 'Yellows', 43),
('Yellow Haze', '#F4D199', '148 C', '244,209,153', 'Yellows', 44),
('Vegas Gold', '#C5A05B', '7502 C', '197,160,91', 'Yellows', 45),

-- ============================================================
-- ORANGES - Sort 46-49
-- ============================================================
('Orange', '#ED7424', '158 C', '237,116,36', 'Oranges', 46),
('Sunset', '#ED6A43', '171 C', '237,106,67', 'Oranges', 47),
('Texas Orange', '#ED6A2D', '166 C', '237,106,45', 'Oranges', 48),
('Coral Silk', '#F5A199', '170 C', '245,161,153', 'Oranges', 49),

-- ============================================================
-- PURPLES - Sort 50-55
-- ============================================================
('Purple', '#622F87', '259 C', '98,47,135', 'Purples', 50),
('Blackberry', '#4B2D56', '5255 C', '75,45,86', 'Purples', 51),
('Heather Purple', '#9378AC', '2577 C', '147,120,172', 'Purples', 52),
('Orchid', '#CF8FC7', '514 C', '207,143,199', 'Purples', 53),
('Lilac', '#C8A2D0', '2573 C', '200,162,208', 'Purples', 54),
('Violet', '#7F3E98', '258 C', '127,62,152', 'Purples', 55),

-- ============================================================
-- BROWNS - Sort 56-58
-- ============================================================
('Dark Chocolate', '#3D2817', '440 C', '61,40,23', 'Browns', 56),
('Chestnut', '#6F4C3E', '7582 C', '111,76,62', 'Browns', 57),
('Russet', '#8B5A3C', '7525 C', '139,90,60', 'Browns', 58),

-- ============================================================
-- SPECIALTY & HEATHERS - Sort 59-65
-- ============================================================
('Heather Navy', '#3D4C62', '2377 C', '61,76,98', 'Heathers', 59),
('Heather Royal', '#4A5E8F', '2111 C', '74,94,143', 'Heathers', 60),
('Heather Cardinal', '#8E3A4F', '7637 C', '142,58,79', 'Heathers', 61),
('Heather Red', '#9F4751', '7426 C', '159,71,81', 'Heathers', 62),
('Heather Military Green', '#5B6550', '5743 C', '91,101,80', 'Heathers', 63),
('Heather Forest', '#3E5345', '5535 C', '62,83,69', 'Heathers', 64),
('Heather Orange', '#E8834F', '7578 C', '232,131,79', 'Heathers', 65);

-- ============================================================
-- VERIFICATION QUERY
-- ============================================================
-- Run this to verify the color data loaded correctly:
-- SELECT color_family, COUNT(*) as color_count
-- FROM apparel_colors
-- GROUP BY color_family
-- ORDER BY MIN(sort_order);
-- Expected: Basics(12), Blues(10), Reds(7), Pinks(3), Greens(8),
--          Yellows(5), Oranges(4), Purples(6), Browns(3), Heathers(7)
-- ============================================================
