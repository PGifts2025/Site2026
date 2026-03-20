# CLAUDE.md — PGifts Project Intelligence File

> **Read this entire file before making any changes.**
> This file exists to prevent regressions. Many things in this codebase were
> hard-won fixes. Breaking them wastes hours of work.

---

## 1. PROJECT OVERVIEW

**PGifts** (Promo Gifts) is a B2B promotional products e-commerce platform.
Customers browse a product catalogue, configure branded merchandise with custom
print, build quotes, and place orders.

- **Live URL:** Deployed on Vercel (auto-deploy from GitHub: PGifts2025/Site2026)
- **Dev:** `npm run dev` in `C:\Users\Admin\pgifts\site`
- **Supabase project:** `cbcevjhvgmxrxeeyldza.supabase.co`

---

## 2. TECH STACK

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| Database / Auth / Storage | Supabase (PostgreSQL + Auth + Storage) |
| Design canvas | Fabric.js |
| 3D previews | Three.js / React Three Fiber |
| Payments (future) | Stripe — Phase 4, not yet started |
| Deployment | GitHub → Vercel (auto on push) |
| Supplier API (future) | Laltex API (key provisioned, no code yet) |

---

## 3. KEY SOURCE FILES

| File | Purpose |
|---|---|
| `src/pages/Designer.jsx` | Main designer tool — Fabric.js canvas, save, export, print areas |
| `src/components/ProductDetailPage.jsx` | Clothing Configure & Quote card — pricing, size inputs, colour rows |
| `src/pages/account/CustomerDesigns.jsx` | My Designs — thumbnail grid, Add to Quote, edit, delete |
| `src/pages/account/CustomerQuotes.jsx` | My Quotes — line items, editable qty, Convert to Order |
| `src/services/supabaseService.js` | All Supabase calls — saveUserDesign, getUserDesign, etc. |
| `src/components/HeaderBar.jsx` | Top nav — sticky, account dropdown z-index fix, quotes badge |
| `src/context/AuthContext.jsx` | Auth state — user object used throughout |
| `src/pages/ChiCup3DPreview.jsx` | 3D Chi Cup preview — Three.js, UV mapping, texture layering |

---

## 4. DATABASE SCHEMA

### 4.1 Catalogue Tables

```
catalog_categories           — 11 product categories
catalog_products             — All products (status: draft/active/archived)
catalog_product_colors       — Per-product colour options with hex values
catalog_product_images       — image_url, thumbnail_url, medium_url, large_url
catalog_product_features     — Bullet-point feature lists
catalog_product_specifications — JSONB technical specs
catalog_pricing_tiers        — Volume pricing (flat/coverage model products)
catalog_print_pricing        — Screen print clothing pricing matrix (see §6)
```

### 4.2 Designer Tables

```
product_templates            — Designer products (t-shirts, hoodie, etc.)
product_template_variants    — Colour + view combinations per template
print_areas                  — Print area coordinates per template
```

### 4.3 Commerce Tables

```
user_designs    — Saved Fabric.js canvas designs (JSONB design_data)
quotes          — Customer quote headers
quote_items     — Line items: product, qty, colour, print_areas, unit_price
orders          — Converted quotes (quote_id FK)
order_artwork   — Uploaded artwork files per order
```

### 4.4 Key Column Constraints

- `catalog_products.pricing_model` — values: 'clothing' | 'flat' | 'coverage'
- `catalog_print_pricing.colour_variant` — ONLY 'white' or 'coloured' (DB check constraint, cannot use other values)
- `catalog_print_pricing.pricing_model` — always 'clothing' for screen print apparel
- `user_designs` — requires either user_id OR session_id (CHECK constraint enforced)

---

## 5. PRODUCT SLUGS (confirmed in DB March 2026)

```
t-shirts              hoodie               sweatshirts
polo                  hi-vis-vest          chi-cup
water-bottle          edge-classic         edge-silver
edge-white            5oz-cotton-bag       8oz-canvas
12oz-recycled-canvas  5oz-recycled-cotton-bag  5oz-mini-cotton-bag
a5-notebook           a6-pocket-notebook   luggie
ice-p                 ocean-octopus        gamma-lite
mr-bio                mr-bio-pd-long       tea-towel
```

---

## 6. CLOTHING PRICING — CRITICAL: DO NOT CHANGE WITHOUT INSTRUCTION

### 6.1 The Two Pricing Tables

- `catalog_pricing_tiers` — "From £X.XX" prices on category pages, flat/coverage products
- `catalog_print_pricing` — Screen print clothing full matrix (qty × colour count × variant)

Clothing Configure & Quote uses `catalog_print_pricing`. Do NOT mix them up.

### 6.2 Margin Model (agreed March 2026)

| Qty range | Margin on sell price |
|---|---|
| 25–99 | 22% |
| 100–249 | 20% |
| 250+ | 18% |

Formula: `sell_price = total_cost / (1 - margin)`

### 6.3 Guard Rails (business rules, DO NOT REMOVE)

1. **Hi-Vis Vest — never undercut competitor**
   `final_price = max(formula_price, competitor_price)`
   This is why Hi-Vis at 250+ units matches competitor exactly — intentional.

2. **Polo under 100 units — capped at +12% over competitor**
   `final_price = min(formula_price, competitor_price * 1.12)`

### 6.4 colour_variant Mapping

DB constraint only allows 'white' or 'coloured'. Mapping:

| Product | Colour selection | colour_variant |
|---|---|---|
| T-shirts | White, Natural | 'white' |
| T-shirts | All other colours | 'coloured' |
| Hi-Vis Vest | Yellow, Orange | 'white' |
| Hi-Vis Vest | All other colours | 'coloured' |
| Hoodie, Sweatshirt, Polo | Any colour | 'coloured' |

### 6.5 Hi-Vis Colour Resolution in ProductDetailPage.jsx

The function `getColourVariant(colorObj)` (line 936) resolves colour_variant.
It is called for the top-level swatch (line 948: `colourVariant = getColourVariant(selectedColorObj)`)
and per-row via `getRowVariant(colorCode)` (line 977) which delegates to `getColourVariant`.

The function MUST follow this logic:
```javascript
// For slug 'hi-vis-vest':
if (colourName.toLowerCase().includes('yellow') || colourName.toLowerCase().includes('orange')) {
  return 'white'; // cheaper garment tier
} else {
  return 'coloured'; // premium garment tier
}
// For slug 't-shirts':
if (colourName.toLowerCase().includes('white') || colourName.toLowerCase().includes('natural')) {
  return 'white';
}
// All others: return 'coloured'
```

### 6.6 catalog_print_pricing — 252 rows, do not delete

36 rows per product/variant: 6 qty tiers × 6 colour counts (1–6 print colours).
Products covered: t-shirts (white+coloured), hoodie, sweatshirts, polo, hi-vis-vest (yellow+other).

---

## 7. CONFIGURE & QUOTE CARD (ProductDetailPage.jsx)

### 7.1 Key State Variables

| Variable | Line | Purpose |
|---|---|---|
| `colorOrderRows` | 182 | `[{id, colorId, colorName, colorCode, sizes: {S,M,L,XL,XXL}}]` — one row per colour |
| `clothingTotalQty` | 217 | Computed: `colorOrderRows.reduce(sum of all sizes)` |
| `printPositions` | 162 | `{Front: '1 col', Back: 'None', ...}` — per-position colour count |
| `activePrintPricing` | 956 | `printPricingData.filter(p => p.colour_variant === colourVariant)` |
| `selectedColorObj` | 935 | `colors.find(c => c.color_code === selectedColor)` — current swatch |
| `colourVariant` | 948 | Result of `getColourVariant(selectedColorObj)` — `'white'` or `'coloured'` |

### 7.2 Key Functions

| Function | Line | Purpose |
|---|---|---|
| `getColourVariant(colorObj)` | 936 | Resolves colour_variant from color object (see §6.5) |
| `getRowVariant(colorCode)` | 977 | Per-row variant: finds colorObj then delegates to `getColourVariant` |
| `getClothingBlendedPrice()` | 985 | Weighted avg price across colour rows, each using own variant's pricing |
| `findPrintRow(colCount, qty)` | 960 | Finds matching `activePrintPricing` row by colour_count + qty range |
| `findGarmentRow(qty)` | 969 | Finds garment_cost row for qty from `activePrintPricing` |
| `getRowSubtotal(row)` | 216 | Sum of all size quantities in a single colour row |
| `isOrderValid()` | 220 | Returns `clothingTotalQty >= 25` for clothing, else `qty >= min_order_quantity` |

### 7.3 Completed Features — Do Not Regress

- Colour swatch click → auto-updates first Configure Your Order colour row dropdown (line ~616)
- Hi-Vis pricing switches colour_variant on swatch click (yellow/orange = 'white')
- Combined Total = sum of all sizes × all colour rows; minimum 25 units
- Size inputs (S/M/L/XL/XXL) — centred layout, helper text below, larger tap targets
- Delete row button — text-red-400 hover:text-red-600, minimum 28×28px
- Open Designer button — blue gradient from-blue-600 to-blue-700
- Print positions — Front/Back/Left Breast/Right Breast/Right Arm with 1–6 colour count

---

## 8. DESIGNER TOOL — FIXED BUGS — DO NOT REVERT

### 8.1 Race Condition — pendingDesignData + designLoadedRef

Canvas was loading before print areas were ready. Fix: design data held in
`pendingDesignData` state, only applied once print areas confirmed loaded via
`designLoadedRef` guard. DO NOT remove or bypass this guard.

**Key locations in Designer.jsx:**
- Refs declared at lines 71–74: `designLoadedRef`, `pendingSaveCanvasJSON`, `pendingSaveThumbnail`, `pendingDesignData` (useState)
- Template load blocked when `designLoadedRef.current === true` (line ~1063)
- `setPendingDesignData(design.design_data)` called during design load (line ~3908)
- Deferred apply effect at lines 1572–1587: waits for `pendingDesignData !== null && printAreasLoaded && printAreas.length > 0`, then calls `canvas.loadFromJSON(designData, ...)` and sets `designLoadedRef.current = true`
- `loadProductTemplate()` also guarded by `designLoadedRef` (line ~2640)

### 8.2 Save / Thumbnail Snapshot

Canvas JSON and thumbnail are captured at the moment Save button is clicked,
stored in `pendingSaveCanvasJSON` and `pendingSaveThumbnail` refs.
DO NOT move this snapshot or make it async — the canvas remounts on modal open
(477→310px resize) and would return empty JSON.

**Key locations in Designer.jsx:**
- Snapshot capture block: lines ~4711–4755 (runs before `setShowSaveModal(true)`)
- `userObjects` filter (lines ~4722–4734): excludes `isPrintAreaGuide`, `excludeFromExport`, template-image, watermark, printAreaOverlay, print-area-* objects
- `pendingSaveCanvasJSON.current` = baseJSON with only user objects (line 4737)
- `pendingSaveThumbnail.current` = `canvas.toDataURL({ multiplier: 1.5 })` with guides hidden (line 4746)
- Consumed during actual save at lines ~4817–4818: falls back to `canvas.toJSON()` if snapshot is null

### 8.3 Thumbnail Z-Order

Guides stripped by filtering objects into `userObjects` array before thumbnail.
No `canvas.remove()` / `canvas.add()` calls — these push template to top of
z-stack and hide the user design. DO NOT change this approach.

Also used in `saveCurrentDesigns()` (line ~2002): `userObjects` filter for the
canvas-to-JSON serialisation path.

### 8.4 Export

- Multiplier: 3× across all export paths (exportDesign, exportPDF, handleExportWithWatermark)
- Non-logged-in users: "Create a free account" message, no export at all
- Watermark approach abandoned — AI tools remove overlaid watermarks easily
- DO NOT reduce multiplier or re-enable guest export

**Key locations in Designer.jsx:**
- `exportDesign()` — line 4257, PNG export with `multiplier: 3` (line 4278)
- `exportPDF()` — line 4297, PDF via jsPDF with `multiplier: 3` (line 4316)
- `handleExportWithWatermark(format)` — line 4330, gate function: requires `user && currentDesignId` for signed-in export, else shows "Create a free account" (line ~4349+)

### 8.5 Hoodie Cord Overlay

`applyStrongColorOverlay(imageUrl, hexColor)` (line 2475) — 95% intensity,
pixel-level luminosity-preserving tint using an offscreen canvas. Used for
T-shirt colour tinting (line ~1169 in colour change effect) AND hoodie cord
colour matching (line ~2619 in `loadProductTemplate`).
Coloured image caching now handled by `src/utils/imageCache.js`
(`cacheColoredImage` / `getCachedImage`), imported at line 9.
Do not refactor without checking both use cases.

### 8.6 Known Remaining Bug — textBaseline (low priority)

`fabric.Text` labels throw 'alphabetical is not a valid CanvasTextBaseline' on
every render frame. Fix when convenient: replace with `fabric.IText` or remove
the on-canvas label (info shown in sidebar). Do not touch the canvas render loop.

### 8.7 Known Remaining Bug — Scale Constraint (low priority)

Objects can still be scaled beyond print area boundary. Suggested fix: switch from
`object:scaling` to `object:scaled` event, clamp scaleX/scaleY, call
`obj.setCoords()` + `canvas.renderAll()`.

---

## 9. 3D PREVIEWS

### Chi Cup (ChiCup3DPreview.jsx)
- Texture applies to `CupBody` mesh specifically
- Inner/outer mesh layers — wrong mesh = black rendering
- Colour rendering on CupBody was a hard-won fix — verify before changing

### Water Bottle
- Texture applies to `LabelBody_2` mesh
- Full UV remapping in place — do not change UV mapping
- Texture loads asynchronously — preserve load order

---

## 10. AUTHENTICATION & COMMERCE FLOWS

- Anonymous sessions tracked via `session_id` in localStorage
- On login: `migrateSessionDesignsToUser(sessionId, userId)` migrates anonymous designs
- Clothing Add to Quote → redirects to `/products/{slug}?design={id}` for Configure & Quote
- Non-clothing Add to Quote → creates quote + quote_item directly, navigates to My Quotes
- `quoteCountChanged` event dispatched after quote creation → updates HeaderBar badge
- Quote number format: `Q-` + last 6 digits of `Date.now()`

---

## 11. PENDING TASKS (priority order)

### IMMEDIATE — SQL in Supabase

1. Fix "From £0.01" on Clothing category page (update catalog_pricing_tiers for clothing)
2. Fix Edge Classic min qty (delete 25+50 unit tiers for product ID 4599d846-...)
3. Check Edge Silver + Edge White for same min qty issue
4. Enter real prices for Cups, Water Bottles, Bags, Pens, Notebooks into catalog_pricing_tiers

### SHORT TERM — Pre-Phase 4

5. Designer: fix textBaseline console error (fabric.Text → fabric.IText)
6. Designer: fix scale constraint (object:scaling → object:scaled)

### PHASE 4 — Stripe Integration

7. ✅ Stripe Checkout — create-checkout-session and confirm-payment Edge Functions deployed
8. ✅ Pay Now button in CustomerQuotes.jsx
9. ✅ OrderConfirmation.jsx page built
10. ✅ order_items populated on payment confirmation
11. ✅ Convert to Order schema error fixed (notes column removed)
12. ✅ Idempotency — duplicate order prevention in confirm-payment
13. Post-payment confirmation email with artwork upload link
14. Cart button in Designer wired to checkout

### PHASE 5 (future)

11. Laltex API integration — nightly product/stock sync into Supabase
12. AI product search assistant (depends on Laltex RAG system)

---

## 12. THINGS CLAUDE CODE MUST NOT DO

- ❌ Change colour_variant constraint or use values other than 'white'/'coloured'
- ❌ Remove pendingDesignData / designLoadedRef guard in Designer.jsx
- ❌ Move canvas snapshot away from Save button click handler
- ❌ Reduce export multiplier below 3×
- ❌ Re-enable export for non-authenticated users
- ❌ Change pricing margins (22/20/18%) without explicit instruction
- ❌ Change Hi-Vis or T-shirt colour_variant resolution logic without instruction
- ❌ Delete or truncate catalog_print_pricing (252 rows, hard to regenerate)
- ❌ Run clearCatalogData() — deletes all catalogue data
- ❌ Disable RLS policies
- ❌ Auto-save the designer canvas (manual save only — by design)
- ❌ Change Open Designer button away from blue gradient
- ❌ Claim build passed without reading actual log output

---

## 13. THINGS THAT LOOK WRONG BUT ARE INTENTIONAL

- Hi-Vis prices at 250+ exactly match competitor → floor guard rail, not a bug
- Polo prices at 25–50 exactly +12% over competitor → cap guard rail, not a bug
- catalog_pricing_tiers has £0.01 entries → unfilled placeholders, not real prices
- colour_variant = 'white' for yellow Hi-Vis → intentional DB constraint workaround
- No auto-save in Designer → deliberate decision
- Guests get "Create account" on export → deliberate, no watermark fallback

---

## 14. BEFORE MAKING ANY CHANGE, CLAUDE CODE MUST

1. Read the relevant source file — never assume line numbers
2. Check DB schema before writing SQL — wrong column names cause cascading bugs
3. Verify product slugs match catalog_products before using in SQL
4. Read actual log files after changes — do not claim "build passed" without checking
5. Test the specific changed behaviour, not just that it compiles
6. Show exact line numbers changed in the summary

---

## 15. SUPABASE QUICK REFERENCE

- **Project ID:** cbcevjhvgmxrxeeyldza
- **Dashboard:** https://app.supabase.com/project/cbcevjhvgmxrxeeyldza
- **Storage buckets:** catalog-images (public), product-templates (public), logos, uploads
- **Key DB functions:** is_admin(uuid), migrate_session_designs_to_user(text, uuid), update_updated_at_column() (trigger)

---

*Last updated: 18 March 2026*
*Update this file at the end of every significant session.*

---

## 16. STRIPE INTEGRATION — RULES AND ARCHITECTURE

### 16.1 Key Security Rule

The Stripe secret key MUST NEVER appear in any file inside src/, in .env,
or in any file committed to GitHub. It lives ONLY in Supabase Edge Function
secrets (set via Supabase dashboard → Edge Functions → Secrets).

### 16.2 Environment Variables

In .env (local) and Vercel dashboard:
  VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
  VITE_SUPABASE_FUNCTIONS_URL=https://cbcevjhvgmxrxeeyldza.supabase.co/functions/v1

In Supabase Edge Function secrets only (NOT in .env or Vercel):
  STRIPE_SECRET_KEY=sk_test_...

### 16.3 Architecture — Payment Flow

1. Customer clicks "Pay Now" in My Quotes (CustomerQuotes.jsx)
2. React calls Supabase Edge Function: create-checkout-session
3. Edge Function reads quote + quote_items from Supabase to get the real total
4. Edge Function creates Stripe Checkout session using secret key via fetch()
5. Edge Function returns { url: 'https://checkout.stripe.com/...' }
6. React redirects: window.location.href = url
7. Customer pays on Stripe-hosted page
8. Stripe redirects to success_url or cancel_url
9. Success page calls second Edge Function: confirm-payment
10. confirm-payment verifies payment with Stripe, then creates order record in DB
11. Order status set to 'pending_artwork', quote status set to 'converted'

Order records are ONLY created AFTER Stripe confirms payment.
Do not create orders on button click — payment must come first.

### 16.4 Edge Functions — Rules

- Location: supabase/functions/{function-name}/index.ts
- Runtime: Deno (NOT Node.js — do not use require(), use import)
- Deploy: supabase functions deploy {function-name}
- Secrets: supabase secrets set STRIPE_SECRET_KEY=sk_test_...
- Do NOT use the Node Stripe npm package — use fetch() to call Stripe REST API directly
  (Deno compatibility issues with the npm package)
- Always include CORS headers:
    'Access-Control-Allow-Origin': '*'
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
- Handle OPTIONS preflight request (return 200 for OPTIONS method)

### 16.5 Stripe Checkout Session — Required Fields

- line_items: array with name, amount (PENCE not pounds — multiply by 100),
  quantity: 1, currency: 'gbp'
- mode: 'payment'
- success_url: '/order-confirmation?session_id={CHECKOUT_SESSION_ID}'
- cancel_url: '/account/quotes'
- metadata: { quote_id, customer_id } — needed to create order on success
- customer_email: pre-fill from user profile if available
- Amount in pence: Math.round(totalPounds * 100) — must be integer

### 16.6 Success Page Rules

- Route: /order-confirmation
- Read session_id from URL query params
- Call confirm-payment Edge Function to verify before showing success
- Must be idempotent — refreshing must not create a duplicate order
  (check if order already exists for this stripe_session_id before inserting)
- Show processing state while verifying — never flash success prematurely

### 16.7 Database Changes — quotes table only

Add these columns to quotes table (do not change existing columns):
  stripe_session_id TEXT
  paid_at TIMESTAMPTZ
  payment_amount NUMERIC

Do not change the schema of quote_items, orders, or any other table.

### 16.8 What NOT to Do

- ❌ Call Stripe API directly from React/browser code
- ❌ Create order records before Stripe payment is confirmed
- ❌ Hardcode prices in Edge Functions — always read from quote_items in Supabase
- ❌ Store STRIPE_SECRET_KEY in .env or any committed file
- ❌ Use the npm Stripe package in Edge Functions — use fetch() only
- ❌ Remove the existing Convert to Order button until Stripe flow is
  fully tested end-to-end in sandbox mode
- ❌ Change the quotes or orders table schema beyond the three columns above

### 16.9 Sandbox Test Checklist

- [ ] Success card: 4242 4242 4242 4242, any future date, any CVC
- [ ] Decline card: 4000 0000 0000 0002
- [ ] Order appears in Supabase after successful payment
- [ ] Order does NOT appear after cancelled payment
- [ ] Refreshing success page does not create duplicate order
- [ ] Quote status changes to 'converted' after payment
- [ ] Stripe dashboard shows the test payment
- [ ] Test with Ocean Octopus product first (simple flat pricing)

---

## 17. ORDER FLOW — COMPLETE ARCHITECTURE (as of March 2026)

### 17.1 Two paths to an order

Path A — Pay Now (Stripe):
  Quote → Pay Now button → create-checkout-session Edge Function
  → Stripe Checkout → confirm-payment Edge Function
  → Order created + order_items inserted + quote marked converted
  → /order-confirmation page shown

Path B — Convert to Order (manual, admin use):
  Quote → Convert to Order button → direct Supabase INSERT
  → Order created, quote marked converted
  → No payment taken

### 17.2 Edge Functions

| Function | Location | Purpose |
|---|---|---|
| create-checkout-session | supabase/functions/create-checkout-session/index.ts | Reads quote, creates Stripe Checkout session, returns URL |
| confirm-payment | supabase/functions/confirm-payment/index.ts | Verifies Stripe payment, creates order + order_items, marks quote converted |

Both use fetch() to call Stripe REST API — NOT the npm Stripe package.
Both require CORS headers and OPTIONS preflight handling.

### 17.3 order_items table

order_items is populated by confirm-payment Edge Function after
successful payment. Required columns include line_total (NOT NULL)
calculated as ROUND(quantity * unit_price, 2).

If adding new columns to order_items, always check NOT NULL
constraints and update the Edge Function INSERT accordingly.

### 17.4 Supabase Secrets (production)

| Secret | Value | Set via |
|---|---|---|
| STRIPE_SECRET_KEY | sk_test_... (rotate before go-live) | supabase secrets set |
| SITE_URL | https://promo-gifts.co | supabase secrets set |
| SUPABASE_SERVICE_ROLE_KEY | auto-available in Edge Functions | automatic |

### 17.5 Vercel Environment Variables

VITE_STRIPE_PUBLISHABLE_KEY — pk_test_... (update to pk_live_ before go-live)
VITE_SUPABASE_FUNCTIONS_URL — https://cbcevjhvgmxrxeeyldza.supabase.co/functions/v1

### 17.6 Before Going Live (Stripe)

- [ ] Rotate Stripe test secret key (was exposed in terminal)
- [ ] Replace pk_test_ with pk_live_ in Vercel env vars
- [ ] Replace sk_test_ with sk_live_ in Supabase secrets
- [ ] Set SITE_URL to https://promo-gifts.co in Supabase secrets
- [ ] Test with a real card for a small amount
- [ ] Enable only GBP in Stripe dashboard
- [ ] Set up Stripe webhook for payment.succeeded as backup confirmation
