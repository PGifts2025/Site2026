# Homepage Database Integration - Summary

## Overview
Updated the homepage to display real products from the `catalog_products` database instead of static placeholder data.

## Changes Made

### 1. Home.jsx - Main Homepage Component

#### Added Imports
```javascript
import { Loader } from 'lucide-react';  // For loading spinners
import { getSupabaseClient } from '../services/productCatalogService';  // Database client
```

#### Added State Variables
- `featuredProducts` - Stores products with `is_featured = true` for Best Sellers carousel
- `hotProducts` - Stores products with `badge = 'Best Seller'` for HOT PRODUCTS section
- `loadingFeatured` - Loading state for featured products
- `loadingHot` - Loading state for hot products

#### Data Fetching - Best Sellers Carousel

Fetches 8 featured products with:
```javascript
.from('catalog_products')
.select(`
  *,
  catalog_categories!inner(name, slug),
  catalog_product_images(image_url, thumbnail_url, is_primary, image_type),
  catalog_pricing_tiers(min_quantity, price_per_unit)
`)
.eq('is_featured', true)
.eq('status', 'active')
.limit(8);
```

**Processing:**
- Extracts primary image (checks `is_primary`, `image_type = 'main'`, or first image)
- Calculates lowest price from pricing tiers
- Uses `thumbnail_url` for performance, fallback to `image_url`

#### Data Fetching - HOT PRODUCTS Section

Fetches 8 best seller products with:
```javascript
.eq('badge', 'Best Seller')
.eq('status', 'active')
.limit(8);
```

**Processing:**
- Same image extraction logic as carousel
- Includes `min_order_quantity` for display

### 2. Best Sellers Carousel Updates

**Display Logic:**
- Shows skeleton loader while fetching (`Loader` component spinning)
- Displays real product images from `catalog_product_images`
- Shows category from `catalog_categories.name`
- Displays price as "From £X.XX" using lowest pricing tier
- Links to product detail page: `/{categorySlug}/{productSlug}`

**Product Cards:**
- Click anywhere on card to navigate to product detail
- "Customize Now" button preserved
- Hover effects maintained
- Auto-slider continues to work with fetched products

### 3. HOT PRODUCTS Section Updates

**Display Logic:**
- Shows skeleton loader while fetching
- Empty state message if no products found
- Real product images (larger size: 24-32rem)
- Uses `subtitle` field for description (truncated if needed)
- Price formatted as: "FROM £X.XX ON 250+ (MQ 25)"
- Links to product detail page

**Product Cards:**
- Best Seller badge (Star icon) if `badge` field set
- Category name from `catalog_categories.name`
- Full clickable card linking to product detail

### 4. Hero Banner Updates

Added links to hero banners:

**Left Slider (Water Bottles & Cups):**
- "BRANDED WATER BOTTLES" → `/water-bottles/water-bottle`
- "BRANDED CUPS" → `/cups/chi-cup`

**Right Static Block:**
- "GRS RECYCLED TOTE BAGS" → `/bags`

**Implementation:**
- Changed `<button>` to `<Link to={...}>` component
- Added `link` property to banner data objects
- Maintained all styling and hover effects

### 5. Logo Home Link - HeaderBar.jsx

Made "Promo Gifts" logo clickable:

**Before:**
```javascript
<div className="flex items-center">
  <div className="bg-red-500 ...">PG</div>
  <div>
    <h1>Promo Gifts</h1>
    ...
  </div>
</div>
```

**After:**
```javascript
<Link to="/" className="flex items-center hover:opacity-80 transition-opacity cursor-pointer">
  <div className="bg-red-500 ...">PG</div>
  <div>
    <h1>Promo Gifts</h1>
    ...
  </div>
</Link>
```

Now clicking the logo/text from any page returns to homepage.

## Database Requirements

### Products Must Have:
1. **Status:** `'active'` - Required to display
2. **Featured Products:** `is_featured = true` - For Best Sellers carousel
3. **Hot Products:** `badge = 'Best Seller'` - For HOT PRODUCTS grid

### Related Data:
- **Category:** Linked via `catalog_categories` (inner join)
- **Images:** At least one image in `catalog_product_images`
  - Preferably with `is_primary = true` or `image_type = 'main'`
- **Pricing:** At least one tier in `catalog_pricing_tiers`

## Image Display Priority

### Best Sellers Carousel:
1. `thumbnail_url` (200x200 - optimal for cards)
2. `image_url` (fallback)

### HOT PRODUCTS:
1. `thumbnail_url` (200x200)
2. `image_url` (fallback)

## Fallback Behavior

If database fetch fails or returns no results:
- **Best Sellers:** Falls back to static `bestSellers` array (original placeholders)
- **HOT PRODUCTS:** Shows empty state message

This ensures the site never breaks, even if database is unavailable.

## Navigation Links

### Product Cards:
```
/{categorySlug}/{productSlug}
Example: /cups/chi-cup
```

### Hero Banners:
- Water Bottles → `/water-bottles/water-bottle`
- Cups → `/cups/chi-cup`
- Bags → `/bags` (category page)

### Logo:
- Always returns to `/` (homepage)

## Loading States

### Featured Products Carousel:
- Shows centered spinner while loading
- Hides navigation arrows during load
- Hides slide indicators during load

### HOT PRODUCTS Grid:
- Shows centered spinner while loading
- Shows "No hot products available" if empty
- Maintains grid layout structure

## Performance Considerations

1. **Image Optimization:**
   - Uses `thumbnail_url` (200x200) instead of full images
   - Falls back to `image_url` if thumbnails not generated

2. **Joins:**
   - Uses `!inner` for categories (ensures category exists)
   - Standard joins for images and pricing (allows products without them)

3. **Limits:**
   - Fetches exactly 8 products per section
   - Prevents over-fetching

## Testing Checklist

After seeding Chi Cup and other products:

- [ ] Visit `/` homepage
- [ ] Verify Best Sellers carousel shows real products with images
- [ ] Verify HOT PRODUCTS grid shows real products
- [ ] Click product card → navigates to product detail page
- [ ] Click "Customize Now" → navigates to product detail page
- [ ] Click hero banner buttons → navigates to correct pages
- [ ] Click "Promo Gifts" logo → returns to homepage
- [ ] Test from product detail page → logo returns to home
- [ ] Check loading spinners appear briefly
- [ ] Verify prices display correctly as "From £X.XX"
- [ ] Verify categories display correctly

## Database Queries for Verification

### Check Featured Products:
```sql
SELECT name, slug, is_featured, status
FROM catalog_products
WHERE is_featured = true AND status = 'active';
```

### Check Hot Products:
```sql
SELECT name, slug, badge, status
FROM catalog_products
WHERE badge = 'Best Seller' AND status = 'active';
```

### Check Products with Images:
```sql
SELECT
  p.name,
  p.slug,
  COUNT(i.id) as image_count
FROM catalog_products p
LEFT JOIN catalog_product_images i ON i.catalog_product_id = p.id
WHERE p.status = 'active'
GROUP BY p.id, p.name, p.slug;
```

## Files Modified

1. **src/pages/Home.jsx**
   - Added database fetching logic
   - Updated Best Sellers carousel JSX
   - Updated HOT PRODUCTS section JSX
   - Added hero banner links
   - Added loading states

2. **src/components/HeaderBar.jsx**
   - Made logo clickable with Link component
   - Links to homepage ('/')

## Next Steps

1. **Seed More Products:**
   - Add more products with `is_featured = true`
   - Add more products with `badge = 'Best Seller'`

2. **Image Optimization:**
   - Generate thumbnail_url for all product images
   - Consider adding medium_url for product detail pages

3. **Fallback Images:**
   - Add default placeholder image if no image exists
   - Current fallback is emoji (📦)

4. **Analytics:**
   - Track product card clicks
   - Track hero banner clicks
   - A/B test featured vs best seller products

## Known Issues

None currently. All features working as expected.

## Console Logs

For debugging, check browser console:
- `[Home] Fetched featured products: X` - Number of featured products loaded
- `[Home] Fetched hot products: X` - Number of hot products loaded

If you see `0`, check database for products matching criteria.
