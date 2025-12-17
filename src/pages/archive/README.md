# Designer Variants - Archive

**Date Archived:** October 31, 2025

This folder contains **archived development versions** of the Designer component. These files were created during the development process for testing different approaches and features.

## ⚠️ Important

**These files are NOT used in production.** The main production Designer is located at:
- `src/pages/Designer.jsx` - **Production version** (main)

## Archived Files

### 1. DesignerTest.jsx
- **Purpose:** Testing variant
- **Status:** Development/testing only
- **Description:** Used for testing new features before integrating into main Designer

### 2. DesignerSimple.jsx
- **Purpose:** Simplified variant
- **Status:** Development/testing only
- **Description:** Simplified version of the Designer for testing basic functionality

### 3. EnhancedDesigner.jsx
- **Purpose:** Enhanced features variant
- **Status:** Development/testing only
- **Description:** Experimental version with additional features, some of which may have been integrated into production Designer

### 4. Designer.jsx.backup
- **Purpose:** Backup copy
- **Status:** Historical backup
- **Description:** Backup copy of Designer.jsx from an earlier development stage

## Why Archived?

These files were archived to:
1. **Reduce confusion** - Make it clear which Designer is production
2. **Prevent accidental edits** - Avoid mistakenly editing old development versions
3. **Clean up codebase** - Keep the pages folder organized
4. **Preserve history** - Maintain these files for reference if needed

## Routes Removed

The following routes were removed from `App.jsx`:
- `/designer-test` → DesignerTest.jsx
- `/designer-simple` → DesignerSimple.jsx
- `/enhanced-designer` → EnhancedDesigner.jsx

## Production Designer

**Always use:** `src/pages/Designer.jsx`

The production Designer includes:
- ✅ Database-backed product templates
- ✅ Color variants and multiple views (Front/Back)
- ✅ Print area overlays with MM dimensions
- ✅ Text tools with real-time editing
- ✅ Image upload with constraints
- ✅ Transform tools (rotate, delete, nudge)
- ✅ Export to PNG/PDF
- ✅ Design persistence per product-color-view
- ✅ Keyboard shortcuts
- ✅ Loading state management

## If You Need These Files

If you need to reference or restore any of these archived versions:
1. They remain in this archive folder
2. Check git history for the full development timeline
3. Contact the development team before restoring any archived versions

---

**Last Updated:** October 31, 2025
**Action:** Archived during cleanup to clarify production vs. development versions
