# Bug Fix: Chi Cup Images Not Displaying

## Problem
The Chi Cup product detail page at `/cups/chi-cup` showed no images, displaying only a placeholder emoji, despite having valid image records in the `catalog_product_images` table.

## Root Causes

### Issue 1: Image Type Filter Excluded 'main' Type Images

**Location:** `src/components/ProductDetailPage.jsx` line 251

**Problem:**
```javascript
// BEFORE (broken)
const productImgs = (data.images || [])
  .filter(img => img.image_type === 'product' || !img.image_type);
```

The filter only included images with `image_type = 'product'` or NULL, but the Chi Cup seed script creates images with `image_type = 'main'`. These images were excluded from both the `galleryImages` and `productImages` arrays.

**Fix:**
```javascript
// AFTER (fixed)
const productImgs = (data.images || [])
  .filter(img => img.image_type === 'main' || img.image_type === 'product' || !img.image_type);
```

Now includes 'main' type images in the product images array.

### Issue 2: Condition Required medium_url to Display Image

**Location:** `src/components/ProductDetailPage.jsx` line 811

**Problem:**
```javascript
// BEFORE (broken)
: filteredImages.length > 0 && filteredImages[selectedImage]?.medium_url ? (
  <img
    src={filteredImages[selectedImage].medium_url || filteredImages[selectedImage].image_url}
    ...
  />
```

The condition checked if `medium_url` existed before displaying the image. Since the Chi Cup seed script only sets `image_url` and `thumbnail_url` (leaving `medium_url` as NULL), this condition failed even though a valid `image_url` existed.

**Fix:**
```javascript
// AFTER (fixed)
: filteredImages.length > 0 && filteredImages[selectedImage]?.image_url ? (
  <img
    src={filteredImages[selectedImage].medium_url || filteredImages[selectedImage].image_url}
    ...
  />
```

Now checks if `image_url` exists (which is always set), then uses `medium_url` if available, falling back to `image_url`.

## Image Size Variants

The catalog system supports multiple image sizes for optimization:
- **image_url** - Original/full size (REQUIRED)
- **thumbnail_url** - 200x200 for product cards/grids (optional)
- **medium_url** - 600x600 for product detail pages (optional)
- **large_url** - 1200x1200 for zoom views (optional)

The display logic now correctly:
1. Checks if `image_url` exists (required field)
2. Uses `medium_url` if available (better quality for detail page)
3. Falls back to `image_url` if `medium_url` is not set

## Image Type Categories

The catalog supports these image types:
- **'main'** - Primary product image (used by Chi Cup)
- **'product'** - Additional product shots
- **'gallery'** - Lifestyle/context images
- **'lifestyle'** - Product in use
- **'detail'** - Close-up details

Products now correctly display images of types: `'main'`, `'product'`, or NULL.

## Testing

After the fix, verify:

1. **Chi Cup Detail Page** - http://localhost:5173/cups/chi-cup
   - ✅ Should display the product image (not placeholder emoji)
   - ✅ Console should show: `[ProductDetail] Product images: 1` (or more)

2. **Console Output:**
   ```
   [ProductDetail] Gallery images: 0
   [ProductDetail] Product images: 1
   [ProductDetail] All images: [{...}]
   ```

3. **Other Products:**
   - Verify other products still display correctly
   - Test products with 'gallery' type images
   - Test products with multiple image types

## Files Modified

1. `src/components/ProductDetailPage.jsx`
   - Line 251: Added 'main' to image type filter
   - Line 258: Added debug log for all images
   - Line 811: Changed condition from `medium_url` to `image_url`

## Prevention

To prevent similar issues in the future:

1. **Seed Scripts:** When creating products, always set `image_url` (required field)
2. **Image Types:** Document which image types are valid: 'main', 'product', 'gallery', 'lifestyle', 'detail'
3. **Display Logic:** Always check `image_url` exists, not optional size variants
4. **Filters:** Include all valid image types in filters

## Related Files

- `src/services/productCatalogService.js` - Queries catalog_product_images (no changes needed)
- `src/scripts/seedChiCup.js` - Creates images with type 'main'
- `database/migrations/seed_chi_cup.sql` - SQL version of seed script
- `database/migrations/004_create_product_catalog.sql` - Table schema definition
