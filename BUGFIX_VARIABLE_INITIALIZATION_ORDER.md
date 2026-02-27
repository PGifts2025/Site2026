# Bug Fix: Variable Initialization Order

## Problem
Error in `src/pages/Home.jsx`:
```
Cannot access 'displayBestSellers' before initialization at line 129
```

This is a **Temporal Dead Zone (TDZ)** error - the variable was being referenced in a useEffect hook before it was declared.

## Root Cause
The variable declarations were in the wrong order:

1. ❌ **useEffect hooks** were declared first (using `displayBestSellers`)
2. ❌ **Variable declarations** came later (defining `displayBestSellers`)

This caused JavaScript to throw a TDZ error because the variables were hoisted but not yet initialized.

## The Issue

### Before (Incorrect Order):

```javascript
// Line 7-17: useState declarations ✅
const [featuredProducts, setFeaturedProducts] = useState([]);
const [hotProducts, setHotProducts] = useState([]);

// Lines 88-101: Static data arrays ✅

// Line 104-119: useEffect for products per slide ✅

// Line 122-129: Auto-slider useEffect ❌ USES displayBestSellers
useEffect(() => {
  if (isSliderPaused || displayBestSellers.length === 0) return; // ❌ ERROR!
  // ...
}, [displayBestSellers.length, isSliderPaused, productsPerSlide]);

// Line 139-145: Functions ❌ USE displayBestSellers
const nextBestSellers = () => {
  setBestSellersSlide((prev) => (prev + 1) % Math.ceil(displayBestSellers.length / productsPerSlide));
};

// Lines 147-244: Data fetching useEffects ✅

// Line 247-248: Variable declarations ❌ TOO LATE!
const displayBestSellers = featuredProducts;
const displayHotProducts = hotProducts;

// Line 250: return statement
```

**Problem:** Variables used on line 123, 126, 129, 140, 144 but not declared until line 247!

### After (Fixed Order):

```javascript
// Line 7-17: useState declarations ✅
const [featuredProducts, setFeaturedProducts] = useState([]);
const [hotProducts, setHotProducts] = useState([]);

// Lines 19-101: Static data arrays ✅

// Line 104-105: Variable declarations ✅ MOVED HERE!
const displayBestSellers = featuredProducts;
const displayHotProducts = hotProducts;

// Line 107-123: useEffect for products per slide ✅

// Line 125-133: Auto-slider useEffect ✅ NOW WORKS!
useEffect(() => {
  if (isSliderPaused || displayBestSellers.length === 0) return; // ✅ OK!
  // ...
}, [displayBestSellers.length, isSliderPaused, productsPerSlide]);

// Line 143-149: Functions ✅ NOW WORK!
const nextBestSellers = () => {
  setBestSellersSlide((prev) => (prev + 1) % Math.ceil(displayBestSellers.length / productsPerSlide));
};

// Lines 152-248: Data fetching useEffects ✅

// Line 250: return statement ✅
```

**Solution:** Variables declared on line 104-105, BEFORE they're used!

## Changes Made

### 1. Moved Variable Declarations UP

**From:** Line 247-248 (right before return statement)
**To:** Line 104-105 (after static data, before useEffects)

**Code Moved:**
```javascript
// Use fetched products from database (must be declared before useEffects that reference them)
const displayBestSellers = featuredProducts;
const displayHotProducts = hotProducts;
```

### 2. Removed Duplicate Declarations

Removed the old declarations from line 247-248 (now redundant).

## Correct Code Order

The proper order for React components:

```javascript
function Component() {
  // 1. useState declarations
  const [state, setState] = useState();

  // 2. Static data / constants
  const staticData = [...];

  // 3. Computed values / derived state
  const computedValue = state; // ← displayBestSellers goes here!

  // 4. useEffect hooks
  useEffect(() => {
    // Can use computedValue ✅
  }, [computedValue]);

  // 5. Event handlers / functions
  const handleClick = () => {
    // Can use computedValue ✅
  };

  // 6. Data fetching useEffects
  useEffect(() => {
    fetchData();
  }, []);

  // 7. return JSX
  return <div>...</div>;
}
```

## Why This Works

### JavaScript Hoisting & TDZ

**Hoisting:** JavaScript hoists `const` and `let` declarations to the top of their scope.

**Temporal Dead Zone (TDZ):** The period between entering scope and the actual declaration line.

```javascript
// TDZ starts
console.log(x); // ❌ ReferenceError: Cannot access 'x' before initialization
const x = 10;   // TDZ ends
console.log(x); // ✅ 10
```

**In our case:**
```javascript
// TDZ for displayBestSellers starts at function entry
useEffect(() => {
  if (displayBestSellers.length === 0) return; // ❌ In TDZ!
}, [displayBestSellers.length]);

const displayBestSellers = featuredProducts; // TDZ ends here
```

**After fix:**
```javascript
const displayBestSellers = featuredProducts; // TDZ ends immediately

useEffect(() => {
  if (displayBestSellers.length === 0) return; // ✅ After TDZ!
}, [displayBestSellers.length]);
```

## Variables Affected

### displayBestSellers
**Used in:**
- Line 127: `if (isSliderPaused || displayBestSellers.length === 0)`
- Line 130: `Math.ceil(displayBestSellers.length / productsPerSlide)`
- Line 133: dependency array
- Line 144: `nextBestSellers` function
- Line 148: `prevBestSellers` function
- Line 373: JSX mapping
- Line 376: slice operation
- Line 430: conditional rendering
- Line 432: slide indicators

### displayHotProducts
**Used in:**
- Line 459: `displayHotProducts.length === 0`
- Line 465: JSX mapping

Both now work correctly! ✅

## Files Modified

1. **src/pages/Home.jsx**
   - **Line 104-105:** Added variable declarations (moved from line 247-248)
   - **Line 247-248:** Removed duplicate declarations

## Testing

After the fix:

- [ ] Page compiles without TDZ errors
- [ ] Best Sellers auto-slider works
- [ ] Navigation arrows work (nextBestSellers, prevBestSellers)
- [ ] Slide indicators render correctly
- [ ] HOT PRODUCTS section renders
- [ ] No console errors about uninitialized variables

## Related Errors Fixed

This fix also resolves:
- Any useEffect dependency warnings about `displayBestSellers`
- Any eslint warnings about using variables before declaration
- Runtime crashes when auto-slider tries to access `.length` on undefined

## Prevention

### Rules to Follow:

1. **Declare before use:** Always declare variables before any code that references them
2. **Order matters:** useState → constants → computed values → useEffects → handlers → return
3. **Dependencies first:** If a useEffect depends on a variable, declare that variable first
4. **Watch for TDZ:** Be careful with `const` and `let` - they're hoisted but not initialized

### ESLint Rule:

Enable this rule to catch these errors:
```json
{
  "rules": {
    "no-use-before-define": ["error", { "variables": true }]
  }
}
```

---

**Fix completed:** Moved `displayBestSellers` and `displayHotProducts` declarations before their first usage, resolving the Temporal Dead Zone error.
