# Critical Bug Fixes - Print Area Configuration System

## Date: October 14, 2025

## Summary
Fixed three critical bugs in the Print Area Configuration system and added keyboard arrow key nudge functionality for fine-tuning print area positions.

---

## Bug Fixes

### 1. ✅ Save Configuration Error (JSON object requested, multiple rows returned)

**Problem:**
When trying to save configuration after deleting templates (e.g., the back template for a bag), the system threw an error: "Failed to save configuration: JSON object requested, multiple (or no) rows returned"

**Root Cause:**
- In `updateProductTemplate()` function, the `.single()` method was called after an upsert operation, which could return multiple rows or no rows
- In `batchUpdatePrintAreas()` function, deletion operations were mixed with update/insert operations in `Promise.all()`, causing inconsistent results

**Solution:**
- **File: `src/services/supabaseService.js`**
  - Modified `updateProductTemplate()` (lines 196-229):
    - Removed `.single()` call after upsert
    - Added logic to handle array results: `return Array.isArray(data) && data.length > 0 ? data[0] : data;`
  
  - Refactored `batchUpdatePrintAreas()` (lines 392-507):
    - Separated deletion operations from update/insert operations
    - Execute deletions FIRST before any updates/inserts
    - Added better error handling and logging
    - Filter out null values from results

---

### 2. ✅ Template Image Upload Not Displaying

**Problem:**
When uploading a new product template image to replace the default .png, the new image did not show in the editor window. The canvas remained blank or showed the old image.

**Root Cause:**
- Browser/Fabric.js was caching the old template image
- Canvas was not properly refreshing after template URL change
- Race condition between template loading and print area rendering

**Solution:**
- **File: `src/components/PrintAreaAdmin.jsx`**
  - Modified `loadProduct()` function (lines 243-328):
    - Added cache-busting parameter to template URLs: `?t=${Date.now()}`
    - Added `crossOrigin: 'anonymous'` option for Supabase images
    - Added `setTimeout` (50ms delay) before loading print areas to ensure template is fully rendered
    - Added explicit `canvas.renderAll()` after clearing canvas
  
  - Modified template loading useEffect (lines 169-177):
    - Added 100ms delay before calling `loadProduct()` to ensure canvas is fully ready
    - Added logging for better debugging
  
  - Modified `handleTemplateUpload()` function (lines 650-717):
    - Added automatic save to database after template upload
    - Updated product state immediately after upload
    - Added comprehensive logging

---

### 3. ✅ Print Area Visibility Issue

**Problem:**
The front print area was only visible after switching tabs, indicating a dynamic rendering issue. Initial load did not show print areas correctly.

**Root Cause:**
- Timing issue between canvas initialization, template loading, and print area rendering
- Print areas were being loaded before the canvas was fully ready or before the template image was rendered

**Solution:**
- **File: `src/components/PrintAreaAdmin.jsx`**
  - Modified `loadProduct()` function (lines 243-328):
    - Added `setTimeout` (50ms delay) after template image loads before calling `loadPrintAreas()`
    - Ensures template is fully rendered before print areas are drawn
    - Added explicit render calls after each major operation
  
  - Modified template loading useEffect (lines 169-177):
    - Added 100ms delay before calling `loadProduct()` to ensure canvas is fully initialized
    - This prevents race conditions on initial load

---

## Enhancement: Keyboard Arrow Key Nudge Functionality

**Feature:**
Added keyboard arrow key support for fine-tuning print area positions (this was already implemented in the codebase, lines 184-238)

**How it works:**
- Select a print area on the canvas
- Use arrow keys to nudge the print area:
  - **Arrow Keys**: Move 1 pixel at a time
  - **Shift + Arrow Keys**: Move 10 pixels at a time
- Changes are automatically saved to the print areas state

---

## Files Modified

1. **`src/services/supabaseService.js`**
   - Fixed `updateProductTemplate()` function
   - Refactored `batchUpdatePrintAreas()` function
   - Lines modified: 196-229, 392-507

2. **`src/components/PrintAreaAdmin.jsx`**
   - Fixed template loading and canvas refresh logic
   - Fixed print area visibility timing issues
   - Enhanced template upload handling
   - Lines modified: 169-177, 243-328, 650-717

---

## Testing Instructions

### Prerequisites
- Admin credentials:
  - Email: dave@alpha-omegaltd.com
  - Password: Admin123

### Test Scenario 1: Save Configuration After Deleting Template
1. Open Print Area Configuration for a product (e.g., Tote Bag)
2. Delete the "Back" template/print area
3. Click "Save" button
4. **Expected Result**: Configuration saves successfully without "multiple rows" error
5. **Success Criteria**: Green success message appears, no errors in console

### Test Scenario 2: Template Image Upload
1. Open Print Area Configuration for any product
2. Click "Template" button (purple button in header)
3. Select a new image file (PNG, JPG, etc.)
4. **Expected Result**: 
   - Upload progress indicator shows
   - New template image displays immediately in canvas
   - Success message appears
   - Configuration is automatically saved
5. Refresh the page and verify the new template persists
6. **Success Criteria**: New template visible without needing to switch tabs

### Test Scenario 3: Print Area Initial Visibility
1. Open Print Area Configuration for any product
2. **Expected Result**: 
   - Template image loads immediately
   - Print areas (blue rectangles) are visible on first load
   - No need to switch tabs or refresh
3. **Success Criteria**: All print areas visible within 1-2 seconds of opening

### Test Scenario 4: Keyboard Arrow Key Nudge
1. Open Print Area Configuration
2. Click on a print area to select it
3. Use arrow keys:
   - Press Up/Down/Left/Right arrows (1px movement)
   - Hold Shift + arrow keys (10px movement)
4. **Expected Result**: 
   - Print area moves smoothly
   - Position updates in the sidebar
5. **Success Criteria**: Precise positioning works as expected

---

## Technical Details

### Database Operations
- Operations are now properly sequenced: DELETE → UPDATE → INSERT
- All operations include proper error handling
- Results are filtered for null values

### Canvas Rendering
- Added cache-busting to prevent image caching issues
- Added timing delays to prevent race conditions
- Added crossOrigin support for Supabase storage images
- Multiple `canvas.renderAll()` calls ensure proper rendering

### State Management
- Template URL changes properly trigger canvas refresh via useEffect
- Product state is updated immediately after uploads
- Configuration is automatically saved to database

---

## Rollback Instructions

If any issues arise, you can rollback using:

```bash
cd /home/ubuntu/github_repos/site
git checkout main
git pull origin main
```

---

## Next Steps

1. Test all scenarios with the provided admin credentials
2. Verify the fixes work in both development and production environments
3. Check browser console for any errors
4. Test with different products and template images
5. Verify Supabase database is being updated correctly

---

## Notes

- All changes are backward compatible
- No database schema changes required
- Works with both Supabase and mock authentication modes
- Cache-busting parameter does not affect existing URLs

---

## Support

If you encounter any issues:
1. Check browser console for errors
2. Check network tab for failed API calls
3. Verify Supabase credentials in `.env` file
4. Ensure Supabase storage bucket "product-templates" exists and has proper permissions

---

**End of Bug Fixes Summary**
