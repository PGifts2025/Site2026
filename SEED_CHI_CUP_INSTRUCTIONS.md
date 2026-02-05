# Seed Chi Cup to Catalog - Instructions

## Quick Start: SQL Editor Method (Recommended)

1. **Open Supabase SQL Editor**
   - Go to: https://app.supabase.com/project/cbcevjhvgmxrxeeyldza/sql
   - Or navigate: Dashboard → SQL Editor

2. **Run the Seed Script**
   - Open file: `database/migrations/seed_chi_cup.sql`
   - Copy entire contents
   - Paste into SQL Editor
   - Click **"Run"** or press **Ctrl+Enter**

3. **Verify Success**
   - Look for green success messages in console
   - Check output for "✅ CHI CUP SEEDING COMPLETE!"

## Alternative: Node.js Script Method

If you prefer to use Node.js (requires service role key):

### Setup

Add your Supabase Service Role key to `.env`:

```bash
# Get this from: https://app.supabase.com/project/_/settings/api
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...your_key_here
```

### Run

```bash
node src/scripts/seedChiCup.js
```

## What Gets Created

### 1. Product Details
- **Name:** Chi Cup
- **Slug:** `chi-cup`
- **Category:** Cups
- **Status:** Active
- **Rating:** 4.8 ⭐ (342 reviews)
- **Badge:** Best Seller 🏆
- **Customizable:** Yes (links to Designer)

### 2. Pricing Tiers
| Quantity | Price per Unit |
|----------|---------------|
| 25-49    | £8.99         |
| 50-99    | £7.49         |
| 100-249  | £6.49 ⭐      |
| 250-499  | £5.49         |
| 500-999  | £4.99         |
| 1000+    | £4.49         |

⭐ = Most popular tier

### 3. Features
- Double-walled insulation
- Full-wrap print area
- Leak-proof lid with silicone seal
- BPA & PVC free
- Food-grade materials
- Dishwasher safe
- 450ml capacity
- Gift box packaging available

### 4. Specifications
- **Capacity:** 450ml
- **Material:** Double-walled stainless steel
- **Height:** 180mm
- **Diameter (top):** 85mm
- **Diameter (bottom):** 65mm
- **Weight:** 280g
- **Insulation:** Hot 4hrs / Cold 8hrs
- **Print Method:** Full-wrap sublimation
- **Print Area:** 360° wrap around cup body
- **Lid Material:** BPA-free plastic with silicone seal

### 5. Colors & Images
Automatically imported from `product_template_variants` table:
- All available colors
- All available views (front, back, etc.)
- Primary image set automatically

## Verification

After seeding, verify the product appears correctly:

### 1. Check Database
Run these queries in SQL Editor:

```sql
-- View product
SELECT * FROM catalog_products WHERE slug = 'chi-cup';

-- View pricing
SELECT * FROM catalog_pricing_tiers
WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = 'chi-cup')
ORDER BY min_quantity;

-- View colors
SELECT * FROM catalog_product_colors
WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = 'chi-cup');

-- View images
SELECT * FROM catalog_product_images
WHERE catalog_product_id = (SELECT id FROM catalog_products WHERE slug = 'chi-cup')
ORDER BY sort_order;
```

### 2. Check Frontend

Visit these URLs to confirm the product appears:

- **Category Page:** http://localhost:5173/cups
- **Product Detail:** http://localhost:5173/cups/chi-cup
- **Designer:** http://localhost:5173/designer (select Chi Cup from dropdown)

## Troubleshooting

### "Chi Cup template not found"
**Problem:** The `product_templates` table doesn't have a `chi-cup` entry.

**Solution:** Check the template exists:
```sql
SELECT * FROM product_templates WHERE product_key = 'chi-cup';
```

If missing, you need to seed the product templates first.

### "RLS policy violation" (Node.js script only)
**Problem:** Using anon key without service role key.

**Solutions:**
1. Use the SQL Editor method instead (bypasses RLS automatically)
2. Add `SUPABASE_SERVICE_ROLE_KEY` to `.env`
3. Run script as authenticated admin user

### "No colors/images inserted"
**Problem:** No variants in `product_template_variants` for chi-cup.

**Solution:** The script will insert default white/black colors and a placeholder image. You can add more colors/images manually or seed the variants table.

## Safe to Run Multiple Times

Both scripts use **UPSERT** operations (ON CONFLICT DO UPDATE), so they're safe to run multiple times without creating duplicates. Later runs will update existing records.

## Next Steps

After seeding:
1. ✅ Visit `/cups` to see Chi Cup in the category
2. ✅ Visit `/cups/chi-cup` to see the product detail page
3. ✅ Click "Customize" to open the Designer
4. ✅ Test the panoramic 2D canvas with zone guides
5. ✅ Test the 3D preview functionality

## Files Created

- `database/migrations/seed_chi_cup.sql` - SQL version (run in Supabase SQL Editor)
- `src/scripts/seedChiCup.js` - Node.js version (requires service role key)
- This file: `SEED_CHI_CUP_INSTRUCTIONS.md` - Instructions

---

**Need help?** Check the Supabase logs in Dashboard → Logs → Postgres Logs for detailed error messages.
