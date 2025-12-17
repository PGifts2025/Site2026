# Product Manager Admin Panel - Usage Guide

## Access

**URL:** `http://localhost:5173/admin/products`

**Requirements:**
- Admin authentication (automatic in mock mode)
- Supabase database configured
- Storage bucket: `product-templates` created

---

## Features Overview

### 1. Product List View
- Grid display of all products
- Shows thumbnail, name, category, price
- Quick actions: Edit, Clone, Delete

### 2. Multi-Step Product Creation

#### Step 1: Product Information
**Required Fields:**
- Product Name (e.g., "5oz Cotton Tote Bag")
- Product Key (auto-generated URL slug: "5oz-cotton-tote-bag")
- Category (dropdown selection)
- Base Price ($)

**Optional Fields:**
- Minimum Order Quantity (default: 50)
- Description (textarea)

#### Step 2: Color Variants
**For Each Color:**
- Color Name (e.g., "Black", "Navy", "Red")
- Color Code (hex picker + text input: "#000000")
- Template Image Upload (PNG/JPG, max 5MB)
  - Uploads to Supabase Storage
  - Returns public URL
- Available Views (checkboxes)
  - Front, Back, Left, Right, Top, Bottom
  - Select which views this color supports

**Actions:**
- Add Color: Creates new color variant
- Remove Color: Deletes variant (minimum 1 required)
- Expand/Collapse: Toggle variant details

#### Step 3: Print Areas
**Visual Editor:**
- Canvas with template image loaded
- Drag & drop print area rectangles
- Resize using corner handles
- Grid overlay with adjustable size

**Per Variant & View:**
- Select Color Variant (dropdown)
- Select View (dropdown based on variant's available views)
- Template image displays on canvas
- Configure print areas specific to this color+view combo

**Print Area Management:**
- Add Print Area: Click + button, enter name
- Delete Print Area: Click trash icon
- Modify: Drag to reposition, resize handles
- Real-time coordinate display

---

## Workflow Example

### Creating "Custom T-Shirt" Product

**Step 1: Product Info**
```
Name: Premium Cotton T-Shirt
Key: premium-cotton-tshirt
Category: Clothing
Price: $12.99
Min Order: 50
Description: High-quality 100% cotton tee...
```

**Step 2: Add Colors**

**Color 1: Black**
- Name: Black
- Code: #000000
- Upload: black-tshirt-front.png
- Views: ✅ Front, ✅ Back

**Color 2: White**
- Name: White
- Code: #FFFFFF
- Upload: white-tshirt-front.png
- Views: ✅ Front, ✅ Back

**Color 3: Navy**
- Name: Navy
- Code: #001f3f
- Upload: navy-tshirt-front.png
- Views: ✅ Front, ✅ Back

**Step 3: Configure Print Areas**

**Black - Front View:**
1. Select: Black variant
2. Select: Front view
3. Add print area: "Front Center"
   - Position: (250, 200)
   - Size: 300 × 350
4. Add print area: "Left Chest"
   - Position: (150, 120)
   - Size: 80 × 80

**Black - Back View:**
1. Select: Black variant
2. Select: Back view
3. Add print area: "Full Back"
   - Position: (200, 150)
   - Size: 400 × 500

**Repeat for White and Navy variants...**

**Save:** Click "Save Product" button

---

## Database Structure Created

### product_templates table
```sql
{
  id: UUID,
  product_key: "premium-cotton-tshirt",
  name: "Premium Cotton T-Shirt",
  template_url: "https://...black-tshirt-front.png",
  colors: ["#000000", "#FFFFFF", "#001f3f"],
  base_price: 12.99,
  category: "Clothing",
  description: "High-quality 100% cotton tee...",
  min_order_qty: 50
}
```

### product_template_variants table
```sql
// 6 variants total (3 colors × 2 views)
{
  id: UUID,
  product_template_id: <product_id>,
  color_name: "Black",
  color_code: "#000000",
  view_name: "front",
  template_url: "https://...black-tshirt-front.png"
},
{
  id: UUID,
  product_template_id: <product_id>,
  color_name: "Black",
  color_code: "#000000",
  view_name: "back",
  template_url: "https://...black-tshirt-front.png"  // Same image for back
},
// ... 4 more variants for white and navy
```

### print_areas table
```sql
// Multiple print areas per variant
{
  id: UUID,
  variant_id: <black_front_variant_id>,
  area_key: "front_center",
  name: "Front Center",
  x: 250,
  y: 200,
  width: 300,
  height: 350,
  max_width: 300,
  max_height: 350,
  shape: "rectangle"
},
{
  id: UUID,
  variant_id: <black_front_variant_id>,
  area_key: "left_chest",
  name: "Left Chest",
  x: 150,
  y: 120,
  width: 80,
  height: 80,
  max_width: 80,
  max_height: 80,
  shape: "rectangle"
},
// ... more print areas for other variants
```

---

## Tips & Best Practices

### Image Guidelines
- **Resolution:** 1000-2000px width recommended
- **Format:** PNG with transparency preferred
- **Background:** White or transparent
- **File Size:** Under 2MB for fast loading
- **Naming:** descriptive names (black-tshirt-front.png)

### Product Keys
- Auto-generated from product name
- Must be unique
- URL-friendly (lowercase, hyphens, no spaces)
- Cannot be changed after creation (used as identifier)
- Examples: "5oz-cotton-bag", "ceramic-mug-11oz"

### Color Variants
- At least one color required
- Each color can have different available views
- Template image uploads immediately to Supabase
- Can reuse same image for different views (common for single-angle products)

### Print Areas
- Stored per variant AND per view
- Black-Front has different areas than Black-Back
- Position coordinates relative to canvas (800×800)
- Grid helps with precise positioning
- Use descriptive names: "Front Center", "Left Chest", "Back Full"

### Views Strategy
**Simple Products (mugs, bags):**
- Use only "front" view
- Upload one image per color

**Complex Products (clothing, bottles):**
- Use multiple views (front, back, left, right)
- Upload different images for each view if available
- Or reuse same image and differentiate via print areas

---

## Keyboard Shortcuts

**Step Navigation:**
- Step numbers are clickable
- "Previous" / "Next" buttons
- Can't skip ahead without completing current step

**Canvas Controls:**
- Click: Select print area
- Drag: Move print area
- Corner Handles: Resize
- Delete key: Remove selected area (not implemented, use trash icon)

---

## Troubleshooting

### "Access Denied"
- Ensure you're logged in as admin
- Check `isCurrentUserAdmin()` returns true
- In mock mode, this is automatic

### Image Upload Fails
- Check file size (max 5MB)
- Verify Supabase Storage bucket exists: `product-templates`
- Check bucket is set to public read access
- Ensure internet connection for upload

### Template Not Showing on Canvas
- Check template_url is valid
- Verify image file uploaded successfully
- Check browser console for CORS errors
- Try refreshing page

### Print Areas Not Saving
- Ensure you're on Step 3
- Select correct variant and view
- Add at least one print area
- Click "Save Product" to persist

### Product Not Appearing in List
- Refresh the page
- Check Supabase database for entry
- Verify no database errors in console
- Check RLS policies allow reading

---

## Integration with Enhanced Designer

Once products are created via Product Manager, they become available in:

**Enhanced Designer** (`/enhanced-designer`)
- Product dropdown will show all products
- Color selector will show all color variants
- View selector will show available views per color
- Print areas will load automatically
- Users can design on the configured print areas

**Product Catalog Pages** (`/bags`, `/cups`, etc.)
- Products can be displayed by category
- "Customize Now" buttons link to designer with product pre-selected

---

## Future Enhancements

### Planned Features
- [ ] Bulk import products from CSV
- [ ] Template library (reuse templates across products)
- [ ] Print area templates (save/load common configs)
- [ ] Product preview generator
- [ ] Category management UI
- [ ] Product search and filtering
- [ ] Product duplication across categories
- [ ] Version history for products
- [ ] Product activation/deactivation

### Advanced Print Areas
- [ ] Circular print areas
- [ ] Elliptical print areas
- [ ] Polygonal print areas
- [ ] Rotation constraints
- [ ] Minimum size constraints
- [ ] Multiple print area groups

---

## Support

For issues or questions:
1. Check browser console for errors
2. Verify Supabase connection
3. Check network tab for failed requests
4. Review database tables directly in Supabase dashboard

---

**Last Updated:** October 16, 2025
**Version:** 1.0.0
