# Add MM Columns to Print Areas Table

## Problem
The `width_mm` and `height_mm` columns don't exist in the `print_areas` table yet.

## Solution
Add the columns to the database, then update existing records with MM values.

---

## STEP 1: Add Columns to Database

Go to **Supabase Dashboard** → **SQL Editor** and run this migration:

```sql
-- Add width_mm and height_mm columns to print_areas table
ALTER TABLE print_areas 
ADD COLUMN IF NOT EXISTS width_mm DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS height_mm DECIMAL(10, 2);

-- Add helpful comment
COMMENT ON COLUMN print_areas.width_mm IS 'Physical width in millimeters for customer display';
COMMENT ON COLUMN print_areas.height_mm IS 'Physical height in millimeters for customer display';
```

---

## STEP 2: Update Existing Print Areas with MM Values

After adding the columns, update your existing print areas with 360mm values:

```sql
-- Update all existing print areas with 360mm × 360mm dimensions
UPDATE print_areas 
SET 
  width_mm = 360,
  height_mm = 360
WHERE width_mm IS NULL OR height_mm IS NULL;

-- Verify the update
SELECT 
  id,
  name,
  width,
  height,
  width_mm,
  height_mm,
  variant_id
FROM print_areas
ORDER BY created_at DESC;
```

**Expected Result:**
All print areas should now show:
- width_mm: 360.00
- height_mm: 360.00

---

## STEP 3: Update Product Manager to Support MM Fields

The Product Manager (admin tool) also needs updating to properly save MM values when creating/editing print areas.

**Location:** `site/src/pages/ProductManager.jsx` around line 450-500 (in the print area save function)

**FIND the section where print areas are saved:**
```javascript
const printAreaData = {
  x: Math.round(rectLeft / imageScale),
  y: Math.round(rectTop / imageScale),
  width: Math.round((fabricRect.width * fabricRect.scaleX) / imageScale),
  height: Math.round((fabricRect.height * fabricRect.scaleY) / imageScale),
  width_mm: physicalWidth || null,
  height_mm: physicalHeight || null,
  // ...
};
```

**VERIFY this code exists and includes width_mm/height_mm fields.**

If the Product Manager code is already saving MM values (as shown in the handover doc), then you're good! The issue was just that the database columns didn't exist yet.

---

## STEP 4: Apply the Designer.jsx Changes

Now that the database has the columns, apply the code changes from `FIX_MM_DISPLAY.md`:

```bash
cd C:\Users\Admin\pgifts

claude-code "Read FIX_MM_DISPLAY.md and apply CHANGE 1 to site/src/pages/Designer.jsx to display MM measurements in the Print Area Guide sidebar box."
```

---

## STEP 5: Test Everything

1. **Refresh Designer page**
2. **Check Print Area Guide box** (sidebar) - should show "360mm × 360mm"
3. **Check canvas label** - should show "Back print\nMax size: 360mm × 360mm"
4. **Test in Product Manager:**
   - Edit a product
   - Draw a new print area
   - Enter MM values (e.g., 300mm × 300mm)
   - Save
   - View in Designer - should show MM values

---

## Complete SQL Script (Run This First)

Copy and paste this entire script into Supabase SQL Editor:

```sql
-- ============================================
-- Add MM columns to print_areas table
-- ============================================

-- Step 1: Add the columns
ALTER TABLE print_areas 
ADD COLUMN IF NOT EXISTS width_mm DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS height_mm DECIMAL(10, 2);

-- Step 2: Add comments for documentation
COMMENT ON COLUMN print_areas.width_mm IS 'Physical width in millimeters for customer display';
COMMENT ON COLUMN print_areas.height_mm IS 'Physical height in millimeters for customer display';

-- Step 3: Update existing records with 360mm values
UPDATE print_areas 
SET 
  width_mm = 360,
  height_mm = 360
WHERE width_mm IS NULL OR height_mm IS NULL;

-- Step 4: Verify the changes
SELECT 
  id,
  name,
  width,
  height,
  width_mm,
  height_mm,
  variant_id,
  created_at
FROM print_areas
ORDER BY created_at DESC;
```

**Expected Output:**
```
id | name        | width | height | width_mm | height_mm | variant_id | created_at
---+-------------+-------+--------+----------+-----------+------------+------------------
1  | Back print  | 548   | 548    | 360.00   | 360.00    | 1          | 2025-10-23...
2  | Front print | 548   | 548    | 360.00   | 360.00    | 2          | 2025-10-23...
```

---

## Summary of Changes

| Step | What | Where |
|------|------|-------|
| 1 | Add `width_mm` and `height_mm` columns | Supabase SQL Editor |
| 2 | Update existing records with 360mm | Supabase SQL Editor |
| 3 | Verify Product Manager saves MM | `site/src/pages/ProductManager.jsx` |
| 4 | Update Designer to display MM | `site/src/pages/Designer.jsx` |
| 5 | Test in Designer | Browser |

---

## Notes

- The columns use `DECIMAL(10, 2)` to support values like 360.50mm
- The `IF NOT EXISTS` clause prevents errors if you run the script multiple times
- Existing print areas are updated to 360mm × 360mm (your current setup)
- Future print areas will be saved with MM values from Product Manager