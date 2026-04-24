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
| Frontend | React 19 + Vite 7 + Tailwind CSS |
| Database / Auth / Storage | Supabase (PostgreSQL 17 + Auth + Storage + Edge Functions in Deno) |
| Design canvas | Fabric.js |
| 3D previews | Three.js / React Three Fiber |
| Payments | Stripe Checkout via Edge Function + `confirm_payment_atomic` RPC (LIVE, currently `pk_test_`/`sk_test_` — rotate before go-live per §17.6) |
| Transactional email | Resend — both the Supabase Auth sender (custom SMTP, see §21) and the Edge Function emails (confirm-payment, send-artwork-received). Sender addresses: `hello@promo-gifts.co` (auth), `orders@promo-gifts.co` (orders), `artwork@promo-gifts.co` (artwork-received reply-to) |
| Routing | react-router-dom v7 with `ScrollToTop` helper + `scrollRestoration='manual'` (see §22) |
| Deployment | GitHub → Vercel (auto on push) |
| Supplier API (future) | Laltex API — key provisioned, investigation doc at [`docs/PRE_LALTEX_INVESTIGATION.md`](../docs/PRE_LALTEX_INVESTIGATION.md); sync code pending (§18) |

---

## 3. KEY SOURCE FILES

| File | Purpose |
|---|---|
| `src/pages/Designer.jsx` | Main designer tool — Fabric.js canvas, save, export, print areas, Buy Now (§19), shared guest auth gate (§20) |
| `src/components/ProductDetailPage.jsx` | Now compact layout by default (§24); clothing Configure & Quote — pricing, size inputs, colour rows |
| `src/pages/account/CustomerDesigns.jsx` | My Designs — thumbnail grid, Add to Quote (delegates to `quoteService`), edit, delete |
| `src/pages/account/CustomerQuotes.jsx` | My Quotes — line items, editable qty, Pay Now, flash banner on create |
| `src/services/quoteService.js` | `createQuoteFromDesign()` — shared between CustomerDesigns' Add-to-Quote and Designer's Buy Now. Computes `total_amount` pre-insert (§23) and matches tier to effective qty |
| `src/services/supabaseService.js` | All Supabase calls — saveUserDesign, getUserDesign, etc. |
| `src/components/ScrollToTop.jsx` | Route-change scroll reset; also sets `history.scrollRestoration='manual'` — see §22 |
| `src/components/auth/AuthModal.jsx` | Sign in / Sign up / Forgot password flow; `onSuccess` callback supports same-session auto-continue for Buy Now / PNG / PDF |
| `src/pages/ResetPassword.jsx` | Public page; consumes Supabase recovery session from URL hash, lets user set new password |
| `src/components/HeaderBar.jsx` | Top nav — sticky, cart + quotes badges. Dead feature-bar strip removed (§4.5 work / §18) |
| `src/context/AuthContext.jsx` | Auth state — user, signIn, signUp, signOut, `resetPassword` |
| `supabase/functions/_shared/emailShell.ts` | `renderEmail({...})` — shared HTML/text shell for both Edge Function emails. See §21 |
| `supabase/email-templates/` | Auth email templates (4 HTML files for Supabase Dashboard) generated from `_shell.html` + `_bodies/*.js` via `npm run build:email-templates`. See §21 |
| `src/pages/ChiCup3DPreview.jsx` | 3D Chi Cup preview — Three.js, UV mapping, texture layering |
| `docs/PRE_LALTEX_INVESTIGATION.md` | Pre-integration reconnaissance: schema snapshot, full Laltex API V1.7 reference, field mapping, open questions |

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

- Multiplier: **3× across all export paths** (exportDesign, exportPDF). The 3× is load-bearing — DO NOT reduce.
- Non-logged-in users: the gate opens the **shared AuthModal** (same one Buy Now uses — see §20). Same-session sign-in via `onSuccess` auto-continues the export if the user has a saved design. Sign-up email round-trip carries a `pendingPngIntent` / `pendingPdfIntent` in localStorage and surfaces a "click again to download" toast on return (deliberately does NOT auto-download on mount — surprising UX).
- Signed-in users must have a saved design (`currentDesignId` set). Same save-first rule as before.
- Watermark approach abandoned — AI tools remove overlaid watermarks easily. Files export clean, auth is the only protection.

**Key locations in Designer.jsx:**
- `exportDesign()` — PNG export with `multiplier: 3`
- `exportPDF()` — PDF via jsPDF with `multiplier: 3`
- `handleExportWithWatermark(format)` — gate function:
  - `!user` → `persistExportIntent(format, currentDesignId)` + open shared auth gate with `guestAuthGatePurpose = format`
  - `user && !currentDesignId` → "Please save your design first" toast
  - else → `runExport(format)`
- `runExport(format)` — pure export; no gate, no toast

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

### 10.1 Entry points to the quote pipeline
There are now **three** entry points into quote creation, all converging on `createQuoteFromDesign()` in `src/services/quoteService.js`:

1. **CustomerDesigns → Add to Quote** (the original path): My Designs → click quote icon
2. **ProductDetailPage → Add to Quote** (Configure & Quote card, product pages)
3. **Designer → Buy Now** (§19): the rewired former Cart button in the Designer tool

All three route to `/account/quotes` on success, with a flash banner `"Quote created — ready to pay"` on new-quote paths. The Pay Now button there is the **sole** customer-facing payment trigger.

### 10.2 Clothing vs non-clothing branching
- **Clothing product** (`product_key ∈ CLOTHING_PRODUCTS` list = t-shirts, hoodie, sweatshirts, polo, hi-vis-vest): `createQuoteFromDesign` returns `{ redirect: '/clothing/:slug?design=<id>' }` so the Configure & Quote card owns sizing / colour-row / print config.
- **Non-clothing**: `createQuoteFromDesign` inserts a `quotes` row + one `quote_items` row directly, then returns `{ redirect: '/account/quotes' }`. Designer's Buy Now path shows a **MOQ confirmation modal** (see §19) before the insert.

### 10.3 Session + migration
- Anonymous sessions tracked via `session_id` in localStorage (see `getSessionId()` in `supabaseService.js`)
- On login: `migrateSessionDesignsToUser(sessionId, userId)` migrates anonymous designs — currently **temporarily disabled** inside Designer's auth useEffect (commented-out block, April 2026). The RPC exists and works; re-enable when ready
- `quoteCountChanged` event dispatched after quote creation → updates HeaderBar badge
- Quote number format: `Q-` + last 6 digits of `Date.now()`
- Quote `total_amount` is computed **pre-insert** by `createQuoteFromDesign` (see §23); the `20260422_quote_total_sync_trigger` is the safety net for item edits

### 10.4 Forgot password — end-to-end
- Sign-in modal → "Forgot password?" → in-modal email form (`forgotState: 'idle'|'form'|'sent'`)
- `AuthContext.resetPassword(email)` → `supabase.auth.resetPasswordForEmail(..., { redirectTo: origin + '/reset-password' })`
- Email arrives (via Resend custom SMTP, sender `hello@promo-gifts.co`) using the branded auth template (§21)
- Link lands on `/reset-password` (public route, **not** under any auth guard)
- `ResetPassword.jsx` reads the recovery session from the URL hash via `supabase.auth.onAuthStateChange('PASSWORD_RECOVERY')` + `getSession()`, lets user set a new password via `supabase.auth.updateUser({ password })`, keeps them signed in, navigates to `/account` with a flash
- Session-expired path routes back home with a friendly toast — never surfaces raw Supabase errors

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

7.  ✅ Stripe Checkout — create-checkout-session and confirm-payment Edge Functions deployed
8.  ✅ Pay Now button in CustomerQuotes.jsx
9.  ✅ OrderConfirmation.jsx page built
10. ✅ order_items populated on payment confirmation
11. ✅ Convert to Order schema error fixed (notes column removed)
12. ✅ Idempotency — duplicate order prevention in confirm-payment
13. ✅ Atomic payment confirmation via `confirm_payment_atomic` RPC
    (April 2026) — fixes the silent-failure path where a paid quote could
    end up without an order and no retry could heal it. See §17.
14. ✅ `payment_status` backfilled to `'paid'` on pre-RPC Stripe orders
    that had `stripe_session_id` but were stuck at the default `'pending'`.
15. ✅ Post-payment confirmation email — Resend integration in `confirm-payment` Edge Function
16. ✅ Cart button in Designer **rewired** as Buy Now → routes through quote pipeline (§19)
17. ✅ Branded transactional email suite — auth (4 templates) + 2 Edge Function emails on shared shell (§21)
18. ✅ ScrollToTop + scrollRestoration manual — pages now open at top on nav + hard refresh (§22)
19. ✅ Compact product page layout rolled out globally; star rating + Configure-card trust badges removed (§24)
20. ✅ Forgot password flow wired end-to-end (§10.4)

### PHASE 5 (future)

21. Laltex API integration — nightly product/stock sync; investigation doc at [`docs/PRE_LALTEX_INVESTIGATION.md`](../docs/PRE_LALTEX_INVESTIGATION.md) (10 internal + 14 Laltex-side open questions)
22. AI product search assistant — pgvector available v0.8.0 but not yet enabled; hybrid search (vector + tsvector) recommended; depends on Laltex feed for content
23. Rebuild category filter icons on Laltex taxonomy (replaces removed feature-bar — see §18)
24. Pre-Laltex schema cleanup: drop `products` (0 rows), `product_template_print_areas` (0 rows), audit `product_configurations` (25 rows, suspected legacy)

---

## 12. THINGS CLAUDE CODE MUST NOT DO

- ❌ Change colour_variant constraint or use values other than 'white'/'coloured'
- ❌ Remove pendingDesignData / designLoadedRef guard in Designer.jsx
- ❌ Move canvas snapshot away from Save button click handler
- ❌ Reduce export multiplier below 3×
- ❌ Let guests export without passing through the shared AuthModal — the auth gate is the only non-watermark protection (see §8.4, §20)
- ❌ Reintroduce a Cart-based checkout path in Designer — Buy Now routes through the quote pipeline only (§19). Site-wide `Cart.jsx` drawer is unrelated and intentionally stays
- ❌ Re-add `bg-white/80 backdrop-blur-md` on sticky headers — causes content ghosting through on scroll. Solid `bg-white shadow-sm` only (see §25 if added, or the original frosted-glass-fix commit)
- ❌ Remove `ScrollToTop` or the inline `scrollRestoration='manual'` script in `index.html` (§22) — both needed to prevent mid-scrolled page loads
- ❌ Bypass the shared `renderEmail()` shell in `_shared/emailShell.ts` by inlining HTML in a new Edge Function email — use the shell (§21)
- ❌ Edit `supabase/email-templates/auth/*.html` by hand — they're generated. Edit `_bodies/*.js` or `_shell.html` and run `npm run build:email-templates` (§21)
- ❌ Revert `createQuoteFromDesign`'s pre-insert `total_amount` computation to `0` — the trigger is a safety net, not a substitute (§23)
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
- Guests trying to export see the **shared AuthModal** (not just a toast) → deliberate auth gate, no watermark fallback (§8.4, §20)
- Star rating / reviews section missing from product pages → removed 23-Apr-26; database columns `rating` and `review_count` intentionally retained for Home's Best Sellers carousel and future reuse (§24)
- 🚚 Free Delivery / ⭐ 5-Star Rated badges missing from Configure & Quote card → deliberately removed 23-Apr-26 to tighten the card (§24)
- "Questions? Call 01844 600900" as a plain one-liner instead of a dark card → deliberate compact treatment, not missing content
- Sign-up email confirmation does NOT auto-continue Buy Now / PNG / PDF flows — shows a toast on return instead. Same-session sign-in via AuthModal onSuccess DOES auto-continue (§20)
- `catalog_products.review_count`, `hex_value` on `catalog_product_colors` = `CHAR` (not VARCHAR), `products`/`product_configurations`/`product_template_print_areas` empty tables → legacy quirks, see pre-Laltex investigation doc
- Feature-bar icon strip at top of pages (Best Sellers / Express Delivery / Made in UK / Eco / Real-Time Proof / New Products) is gone — deliberately removed (§18, §4.5 handover)
- PG badge renders as a **red square on Outlook desktop** in transactional emails → accepted Word-engine limitation, not a bug (§21)

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

*Last updated: 24 April 2026 — §§26.10.x added (session 2: embedding pipeline — model, source recipe, hash idempotency, ivfflat index, cost estimates, invariants). §26 Laltex Integration Architecture added earlier 24 April 2026 (session 1: foundation schema + single-product sync). §§19-25 added 23 April 2026 for Buy Now / shared auth gate / transactional email / scroll management / quote total pre-insert / compact product page layout / forgot password. §§2, 3, 8.4, 10, 11, 12, 13, 18 refreshed.*
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

## 17. ORDER FLOW — COMPLETE ARCHITECTURE (as of April 2026)

### 17.1 Two paths to an order

Path A — Pay Now (Stripe, atomic):
  Quote → Pay Now button → create-checkout-session Edge Function
  → Stripe Checkout → confirm-payment Edge Function
  → confirm_payment_atomic RPC (single Postgres transaction):
     • lock the quote row (SELECT ... FOR UPDATE)
     • idempotency check on orders.stripe_session_id — return existing id if found
     • update quote: status=converted, stripe_session_id, paid_at, payment_amount
     • insert order: status=confirmed, payment_status=paid, payment_intent_id
     • copy quote_items → order_items (line_total computed, all design cols carried)
  → /order-confirmation page shown

Path B — Convert to Order (manual, admin use):
  Quote → Convert to Order button → direct Supabase INSERT
  → Order created, quote marked converted
  → No payment taken

### 17.2 Edge Functions and RPC

| Component | Location | Purpose |
|---|---|---|
| create-checkout-session | supabase/functions/create-checkout-session/index.ts | Reads quote, creates Stripe Checkout session, returns URL |
| confirm-payment | supabase/functions/confirm-payment/index.ts | Verifies the Stripe session is `paid`, then delegates ALL DB work to `confirm_payment_atomic`. No direct table writes. |
| confirm_payment_atomic | supabase/migrations/20260417_confirm_payment_atomic.sql | Atomic plpgsql RPC — single transaction, idempotent on `stripe_session_id`. Only writer for Stripe-path orders. |

Both Edge Functions use fetch() to call Stripe REST API — NOT the npm
Stripe package. Both require CORS headers and OPTIONS preflight handling.

The confirm-payment Edge Function must NOT be refactored to do DB work
outside the RPC. The whole point of the RPC is atomicity — splitting the
steps across the function and the DB recreates the ghost-order bug that
was fixed in April 2026 (see §17.7).

### 17.3 order_items

order_items is populated by `confirm_payment_atomic` (Path A) or by the
Convert-to-Order client code (Path B). It is NOT written by the
confirm-payment Edge Function directly.

`line_total` is NOT NULL and has no default. On Path A the RPC computes
it as `ROUND(quantity * unit_price, 2)`. On Path B the client code must
set it explicitly.

When adding new columns to order_items:
- NOT NULL columns: update the RPC's INSERT ... SELECT (new migration
  that replaces the function) and the Path B client insert.
- Nullable columns: safe to add to both paths independently.

Columns currently copied from quote_items → order_items on Path A:
product_id, product_name, quantity, unit_price, line_total (computed),
color, design_data, design_thumbnail, print_areas, notes.

### 17.4 Supabase Secrets (production)

| Secret | Value | Set via |
|---|---|---|
| STRIPE_SECRET_KEY | sk_test_... (rotate before go-live) | supabase secrets set |
| SITE_URL | https://promo-gifts-co.uk | supabase secrets set |
| SUPABASE_SERVICE_ROLE_KEY | auto-available in Edge Functions | automatic |

### 17.5 Vercel Environment Variables

VITE_STRIPE_PUBLISHABLE_KEY — pk_test_... (update to pk_live_ before go-live)
VITE_SUPABASE_FUNCTIONS_URL — https://cbcevjhvgmxrxeeyldza.supabase.co/functions/v1

### 17.6 Before Going Live (Stripe)

- [ ] Rotate Stripe test secret key (was exposed in terminal)
- [ ] Replace pk_test_ with pk_live_ in Vercel env vars
- [ ] Replace sk_test_ with sk_live_ in Supabase secrets
- [ ] Set SITE_URL to https://promo-gifts-co.uk in Supabase secrets
- [ ] Test with a real card for a small amount
- [ ] Enable only GBP in Stripe dashboard
- [ ] Set up Stripe webhook for payment.succeeded as backup confirmation

### 17.7 confirm_payment_atomic — invariants (DO NOT BREAK)

Added April 2026 to fix a silent-failure bug: if the pre-RPC flow was
interrupted between the quote update and the order insert, the quote was
left marked `converted` with no order, and a `quote.status = 'converted'`
short-circuit in the Edge Function then returned HTTP 200 `success: true`
with `order_id: null` on every retry — so no order could ever be created.
One real ghost (QT-MMZ5OZ4N, paid 2026-03-20) was recovered by calling
the RPC directly; result is ORD-20260417-0005.

Rules for anyone touching this path:

1. **The RPC is the only writer** for Stripe-path orders and their items.
   The confirm-payment Edge Function must not UPDATE quotes or INSERT
   into orders/order_items outside the RPC call.

2. **Idempotency anchor is `orders.stripe_session_id`.** The RPC returns
   the existing order id if one is found; any retry is safe.

3. **DO NOT reintroduce a `quote.status === 'converted'` short-circuit**
   anywhere in the Edge Function. `quote.status` is not a valid
   idempotency signal — this is exactly the bug the RPC replaced.

4. **The quote row is locked `FOR UPDATE`** inside the RPC. Two concurrent
   invocations cannot both proceed; the second waits, sees the committed
   order via the idempotency check, and returns it.

5. **`paid_at` is preserved via `COALESCE`.** A retry after a prior
   quote update must not overwrite the original payment timestamp.

6. **EXECUTE is granted only to `service_role`.** anon and authenticated
   are revoked. If the Edge Function's auth model changes (e.g., direct
   client calls instead of going through the Edge Function), review grants.

7. **Schema changes that affect order_items require changing the RPC.**
   New NOT NULL columns must be added to the RPC's `INSERT ... SELECT`
   via a replacement migration. Don't try to work around this by doing
   an `UPDATE orders_items` in the Edge Function after the RPC returns —
   that re-splits the transaction and is exactly what the RPC prevents.

---

## 18. Future work

### Category filter icons
The feature strip (Best Sellers / Express Delivery / Made in UK / Eco /
Real-Time Proof / New Products) was removed from `HeaderBar.jsx` on
**2026-04-23**. Rebuild as part of the Laltex API integration — the
Laltex feed will provide the authoritative product taxonomy (lead times,
origin, eco flags, materials) which should drive any future filter UI.
Avoid inventing a local tagging schema on `catalog_products` that will
need refactoring once the Laltex feed lands.

Note: `catalog_products.is_featured` column stays in use for the
homepage Best Sellers carousel (see `Home.jsx` and `productCatalogService`)
— that's independent and not affected by the strip removal.

---

## 19. BUY NOW FLOW (Designer)

The former "Cart" button in the Designer's Tools panel header was a broken third purchase path — it pushed items into a client-only cart (`useCart` / `addToCart`) and routed to `/checkout` bypassing MOQ, quotes, and the customer dashboard. **Replaced 23-Apr-26** with a Buy Now button that funnels through the standard quote pipeline.

### 19.1 Flow overview
- **Button:** [`Designer.jsx`](../src/pages/Designer.jsx) — "Buy Now" in the Tools panel. Disabled with tooltip `"Save your design first before Buy Now"` when `user && !currentDesignId`. Guest sees it enabled (auth gate fires on click).
- **Guest path:** `handleBuyNow` calls `persistBuyNowIntent(currentDesignId)` + opens the shared AuthModal with `guestAuthGatePurpose='buyNow'`. Same-session sign-in → `onSuccess` runs `runBuyNow(signedInUser)`. Sign-up round-trip → `consumeBuyNowIntent` useEffect on Designer mount restores the flow.
- **Signed-in path:** `runBuyNow()` fetches the saved design, then:
  - Clothing product → `createQuoteFromDesign` returns `{ redirect: '/clothing/:slug?design=<id>' }` (ProductDetailPage's Configure & Quote takes over)
  - Non-clothing → fetch `catalog_products.min_order_quantity`, open the **MOQ modal** (see §19.2), user confirms qty ≥ MOQ, `createQuoteFromDesign({ design, user, quantityOverride })`, navigate to `/account/quotes` with flash `"Quote created - ready to pay"`
- **Mutual exclusion:** MOQ modal and AuthModal **cannot be visible simultaneously** — `runBuyNow` calls `setGuestAuthGateOpen(false)` before `setMoqModalData(...)`, and both JSX renders guard on `!moqModalData` / `!guestAuthGateOpen` respectively

### 19.2 MOQ modal
Small modal at z-50, standard Designer-modal tier (NOT `z-[200]` — that's ArtworkUploadModal's "above-the-header" slot). Body: product name + min-qty message + number input pre-filled at MOQ (cannot go below). Cancel + Continue buttons; Continue disabled when qty < min. Lives in the Designer's JSX near the other modals.

### 19.3 Shared service: [`src/services/quoteService.js`](../src/services/quoteService.js)
```js
export const createQuoteFromDesign = async ({ design, user, quantityOverride = null }) => { ... }
```
- Returns `{ redirect, quoteId?, quoteNumber?, error? }`
- Reused by CustomerDesigns (no `quantityOverride`) and Designer Buy Now (with `quantityOverride` from the MOQ modal)
- Internal helper `pickTierForQty(tiers, qty)` selects the highest-min-quantity tier ≤ qty → fixes mispricing bug that existed when CustomerDesigns was always using the lowest tier regardless of quantity
- Top-of-file `TODO(MOQ-unification)` comment flags the three-column divergence (`catalog_products.min_order_quantity` vs `catalog_pricing_tiers.min_quantity` vs `product_templates.min_order_qty`) for a future consolidation task

### 19.4 Invariants — DO NOT BREAK
- Buy Now must never bypass MOQ. The MOQ modal is the enforcement point for non-clothing; for clothing, the redirect to ProductDetailPage delegates enforcement there
- Buy Now must never skip the quote — orders only exist after Pay Now on the Quotes page (Stripe flow, §17)
- `total_amount` in `createQuoteFromDesign` is computed pre-insert (§23). Do not revert to `0`

---

## 20. SHARED GUEST AUTH GATE

One `AuthModal` mount in Designer serves **three** guest flows: Buy Now, PNG export, PDF export. Purpose discriminator + mutual-exclusion localStorage intents.

### 20.1 State
```js
const [guestAuthGateOpen, setGuestAuthGateOpen] = useState(false);
const [guestAuthGatePurpose, setGuestAuthGatePurpose] = useState(null); // 'buyNow' | 'png' | 'pdf' | null
```

### 20.2 Intent persistence (localStorage, 1h TTL)
Three keys, **mutually exclusive** (setting any one clears all others via `clearAllGuestIntents()`):

- `pendingBuyNowIntent` — shape: `{ designId, ts }`
- `pendingPngIntent` / `pendingPdfIntent` — shape: `{ format, designId, ts }`

**Rationale for mutual exclusion:** a guest who clicks PNG, cancels the auth modal, then clicks PDF must not trigger a stale PNG export after auth. The write-path clears other intents; the read-path's `consume*Intent()` removes the key BEFORE the TTL check so expired intents are silently swept.

### 20.3 onSuccess dispatch (same-session sign-in)
AuthModal's `onSuccess` callback fires inline after successful `signIn` with `data.user`. Designer's mount-time handler:
- Closes the gate + clears purpose
- Calls `clearAllGuestIntents()` (prevents double-fire from the resume useEffect)
- Dispatches: `buyNow` → `runBuyNow(user)`, `png`/`pdf` → `runExport(format)` if `currentDesignId`, else "Please save your design first to export" toast

### 20.4 Resume (sign-up email round-trip)
A single `useEffect([user, loadingProducts])` in Designer consumes whichever intent is found:
- **Buy Now intent:** auto-runs the flow. If `designId` missing, tries to resurrect the most recent saved/migrated design via `getUserDesigns(user.id, sessionId)`; otherwise toasts "Please save your design first"
- **PNG/PDF intent:** shows toast `"Signed in - click PNG/PDF again to download"`. **Does NOT auto-fire the download** — an unprompted file-download on page mount is surprising UX, unlike Buy Now's continuation

### 20.5 Why not reuse the Designer's own inline auth form?
Designer still has its own legacy inline auth at `showAuth` (line ~5980). That's the Save button's auth trigger, unchanged. The **new** shared AuthModal is the Buy Now / PNG / PDF gate, using `useAuth()` + `AuthContext.signIn`. Both coexist; the legacy one will eventually be removed once Save is migrated to the shared gate.

### 20.6 Invariants — DO NOT BREAK
- AuthModal must not be rendered alongside MoqModal (mutual exclusion — §19.1)
- `persistBuyNowIntent` / `persistExportIntent` MUST call `clearAllGuestIntents()` first
- `consume*Intent()` must remove the key BEFORE the TTL check so expired state is silently cleared
- TTL of 1 hour matches `BUY_NOW_INTENT_TTL_MS`; applies to all three intent types

---

## 21. TRANSACTIONAL EMAIL SYSTEM

Six branded transactional emails on one visual system — 4 Supabase Auth templates + 2 Resend-sent Edge Function emails.

### 21.1 Shared visual shell
Design tokens documented in [`supabase/email-templates/BRAND_EMAIL_TOKENS.md`](../supabase/email-templates/BRAND_EMAIL_TOKENS.md). Table-based layout (Outlook-safe), 600px max-width, system font stack (no web fonts), CSS-rendered red `#ef4444` "PG" badge at top, black `#1a1a1a` CTA button, muted footer.

Two parallel implementations of the same shell:
- **HTML** — [`supabase/email-templates/_shell.html`](../supabase/email-templates/_shell.html) for Supabase Dashboard auth templates
- **TS** — [`supabase/functions/_shared/emailShell.ts`](../supabase/functions/_shared/emailShell.ts) exporting `renderEmail({ preheader, heading, bodyHtml, bodyText, ctaLabel?, ctaUrl?, footerNote?, supportEmail })` → `{ html, text }` for Edge Function emails

**If you change the visual shell, mirror it in both files** — they are the two sources of truth. A logo-asset swap (when a real logo is designed) is a 2-file change.

### 21.2 Auth template generator
```
supabase/email-templates/
├── _shell.html                  # placeholders: {{PREHEADER}} {{HEADING}} {{BODY}} {{CTA_LABEL}} {{CTA_URL}} {{FOOTER_NOTE}} {{SUPPORT_EMAIL}}
├── _bodies/
│   ├── confirm-signup.js        # metadata + bodyHtml + plainText per template
│   ├── reset-password.js
│   ├── magic-link.js
│   └── email-change.js
├── build.mjs                    # node:fs generator with assertions
└── auth/                        # GENERATED — paste into Supabase Dashboard
    ├── confirm-signup.html
    ├── reset-password.html
    ├── magic-link.html
    ├── email-change.html
    └── README.md                # Dashboard paste instructions
```

**Generator placeholders use `{{NAME}}`** (no leading dot). **Supabase template variables use `{{ .Var }}`** (Go-template syntax, leading dot, spaces) and pass through untouched. Critical: DON'T confuse the two.

**Run:** `npm run build:email-templates` from `site/`. Build assertions:
- No `{{NAME}}`-style generator placeholder survives in output — catches typos before Dashboard paste
- `{{ .ConfirmationURL }}` must be present in every auth output — catches the most common break

Generated files carry two top-of-file comments (plain-text fallback + "GENERATED FILE — edit `_bodies/`" warning). When applying via Management API, those comments are stripped; when pasted manually they're harmless.

### 21.3 Per-template support-email routing
Footer line `"Need help? Reply to this email or contact <supportEmail>."` routes per template:

| Email | Support address | SMTP Reply-To |
|---|---|---|
| All 4 auth templates | `hello@promo-gifts.co` | n/a (Supabase-sent) |
| confirm-payment | `orders@promo-gifts.co` | `orders@promo-gifts.co` |
| send-artwork-received-email | `artwork@promo-gifts.co` | `artwork@promo-gifts.co` |

**Invariant:** the shell's footer text and the SMTP `Reply-To` header MUST agree. If you change one, change the other.

### 21.4 Supabase Auth SMTP (Resend)
Custom SMTP configured in Supabase Dashboard → Auth → SMTP Settings, sending via Resend. Sender address `hello@promo-gifts.co`. This replaces the default `noreply@mail.app.supabase.io` sender. DNS (SPF/DKIM/DMARC) verified for `promo-gifts.co` under Resend.

**Applied templates via Management API** on 23-Apr-26. Pre-branding snapshot of the Supabase defaults captured in [`supabase/email-templates/auth/_supabase-defaults-backup.json`](../supabase/email-templates/auth/_supabase-defaults-backup.json) — restore via PATCH to `/v1/projects/.../config/auth` with the same field/value pairs.

### 21.5 Supabase URL configuration
- **SITE_URL:** `https://promo-gifts-co.uk` (bare — www 307's to bare; confirmed canonical 23-Apr)
- **URI_ALLOW_LIST:** `https://promo-gifts-co.uk/**, https://www.promo-gifts-co.uk/**, http://localhost:**`
  - Localhost entry is **permanent for dev convenience** — no production security impact since an attacker can't land a victim on their own localhost

### 21.6 Outlook caveat
PG badge `border-radius` is stripped by Outlook's Word rendering engine → renders as a **red square** on Outlook desktop. Accepted edge case. No VML fallback. Documented in `BRAND_EMAIL_TOKENS.md`; future logo-asset swap closes this too.

### 21.7 Invariants — DO NOT BREAK
- Never edit `supabase/email-templates/auth/*.html` by hand. Edit `_bodies/*.js` or `_shell.html` + run generator
- Keep `_shell.html` and `_shared/emailShell.ts` in sync when either is touched
- Generator assertions must both pass; do not suppress them
- `renderEmail`'s `supportEmail` parameter is REQUIRED — do not default it. The type system forces each caller to think about which inbox owns that flow
- The preview-generator script (`preview-edge-emails.mjs`) mirrors the TS shell logic inline; if you change `emailShell.ts`, update the preview script too (it has an explicit "KEEP IN SYNC" banner)

---

## 22. SCROLL MANAGEMENT

Two pieces working together prevent pages loading mid-scrolled:

### 22.1 `ScrollToTop` component
[`src/components/ScrollToTop.jsx`](../src/components/ScrollToTop.jsx), mounted in App.jsx inside `<Router>` above `<HeaderBar />`. `useEffect` on `pathname` runs `window.scrollTo(0, 0)` on every route change. **Hash-link guard:** `if (window.location.hash) return;` — lets the browser handle anchor scrolling for any future `/page#section` URLs.

### 22.2 `scrollRestoration = 'manual'` — inline in index.html
```html
<script>
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }
</script>
```
Placed in `<head>` **before** the bundle's `<script>`. Runs before React boots, so hard-refresh wins the race to disable the browser's default scroll-Y restoration — the bug that was making product pages and Designer open with the viewport already scrolled partway down. Duplicated at the top of `ScrollToTop.jsx` as belt-and-braces for HMR remounts.

### 22.3 Why this matters
Pre-fix symptom: product pages and Designer opened mid-scrolled with the title cut off above the viewport. Both on first navigation and on hard refresh. React Router v6 preserves scroll position by default; browser scroll-restoration restores pre-refresh Y. Combined: jarring load experience.

Post-fix: every route change and every hard refresh lands at top. Back-navigation also lands at top (accepted behavior for catalogue flow; if future work wants to preserve back-nav scroll, change `'manual'` back to `'auto'` with the loss of hard-refresh-reset).

### 22.4 Innocent, do not rip out
All four `autoFocus` occurrences in the codebase (`AuthModal`, `CustomerDesigns`, `ResetPassword`, Designer save modal) are safe — inside modals (`fixed inset-0` — focus doesn't scroll) or conditionally rendered. Both `scrollIntoView` calls (Checkout form-error, Home tools-section click) are user-triggered, not on-mount. None caused the original symptom.

---

## 23. QUOTE TOTAL PRE-INSERT PATTERN

`createQuoteFromDesign` in [`src/services/quoteService.js`](../src/services/quoteService.js) computes `total_amount = effectiveQty * unitPrice` pre-insert:
```js
const initialTotal = +(effectiveQty * unitPrice).toFixed(2);
```
and passes it to the `quotes` INSERT. The `20260422_quote_total_sync_trigger` remains in place as a self-healing safety net for future item edits (it recomputes on any `quote_items` INSERT/UPDATE/DELETE).

Previously, `total_amount: 0` was hardcoded at insert, relying entirely on the trigger to fix it once the first `quote_items` row landed. That left a brief-but-real window with a wrong total in the row, and made the flow brittle to any future trigger change.

### 23.1 Verification
Verified against live DB 23-Apr-26: pre-items `quote.total_amount` reads the computed value (e.g. 302.50); trigger still fires on items INSERT and UPDATE keeping the total in sync.

### 23.2 Invariants — DO NOT BREAK
- `createQuoteFromDesign` must compute `initialTotal` and pass it at INSERT — do not revert to `0`
- The trigger (`recompute_quote_total`) must remain in place — it's the safety net for item edits from other future paths
- Trigger guards `AND status != 'converted'` — never mutates totals on converted quotes (payment is locked). Don't remove that predicate

---

## 24. PRODUCT PAGE LAYOUT (compact — default for all products)

Rolled out 23-Apr-26 after a pilot on `mr-bio` + `gamma-lite`. The former `PILOT_COMPACT_SLUGS` gating has been fully removed; every product uses the compact layout.

### 24.1 What shipped
- Outer container `py-4` (was `py-8`); grid `lg:gap-5` (was `lg:gap-8`)
- Hero image capped at `max-h-[520px]`; container padding `p-6 mb-4` (was `p-12 mb-6`)
- Product info column `space-y-4` (was `space-y-8`)
- Customize card `p-4`, button `py-2` (was `p-6`, `py-3`)
- Key Features block in main flow → **removed**; features render as a bulleted list inside the Product Details tab
- Three full-width info boxes in Details tab (Premium / Eco / Free Delivery) → **collapsed** to a single horizontal icon strip (same three messages, compact)
- "Need Help?" dark gradient card → **replaced** with a single-line `"Questions? Call 01844 600900"` link at the bottom of the pricing panel
- Pricing panel header `p-4` (was `p-6`); Request Sample button `py-2 text-sm` (was `py-4`)
- **Star rating + "(N reviews)"** display → **removed** from product title block. Database columns `catalog_products.rating` and `review_count` retained (still used by Home's Best Sellers carousel and for future reuse); only the visible render is gone
- **🚚 Free Delivery / ⭐ 5-Star Rated** trust-badges strip inside Configure & Quote card → **removed**. The "Questions?" line at the bottom is preserved.

### 24.2 What was deliberately NOT touched
- Configure & Quote card's logic (MOQ, tier lookup, quote creation)
- ProductDetailPage's clothing configurator card (apparel-specific branch, separate logic)
- Data fetching in `productCatalogService.js`
- ProductPageTemplate.jsx and legacy category pages (`Bags.jsx`, `HiVis.jsx`, etc.) — they still reference `rating` / `review_count` in their own rendering; out of scope for this rollout
- The Premium / Eco / Delivery icon strip inside the Product Details tab — deliberately kept as a trust-signal row
- Specifications tab — untouched

### 24.3 Sticky header opacity — related fix
As part of the same session, the 10 per-page sticky section headers across ProductDetailPage, ProductPageTemplate, CategoryPage, and 7 legacy category pages were changed from `bg-white/80 backdrop-blur-md border-b border-gray-200/50` to `bg-white shadow-sm border-b` — opaque, so scrolled content no longer ghosts through. See the commit `af3296d` for the full list.

### 24.4 Invariants — DO NOT BREAK
- Don't re-introduce a per-slug or URL-flag layout gating — rollout is complete
- Don't re-add the star rating render, the Configure-card trust badges, or the Need Help dark card without re-opening the whole compact-layout decision
- Don't touch category pages / legacy product pages (`Bags.jsx`, etc.) to "match" — they have their own treatment and are out of scope pending the Laltex-driven rebuild

---

## 25. QUICK REFERENCE — 23 April 2026 session commit chain

For future sessions looking for why things are the way they are:

| Commit | Scope |
|---|---|
| `cb6d88b` | Cart pop-out z-index above sticky header |
| `cb35d82` | Designer Cart button → Buy Now (rewired through quote pipeline) |
| `9b934ca` | PNG/PDF export gated behind shared AuthModal; intent plumbing |
| `d2a242b` | Forgot password flow wired end-to-end |
| `96818aa` / `d32e0de` | Branded transactional email suite + shared shell |
| `ad6b59b` | Supabase auth template defaults backup |
| `600e18d` / `3930794` | PGifts favicon set + "Promo Gifts" browser title |
| `aeaa70d` | Quote `total_amount` computed pre-insert |
| `a81489b` | Compact product-page pilot (mr-bio, gamma-lite) |
| `af3296d` | Frosted-glass sticky headers → opaque (stops content ghosting) |
| `fbd3100` | ScrollToTop + `scrollRestoration='manual'` |
| `c2e0a00` | Compact layout global rollout + remove star rating + Configure-card trust badges |
| `9f719b0` | Remove dead feature-bar from HeaderBar (defer to Laltex) |
| `8b9b27c` / `da7a7a4` | Pre-Laltex investigation doc + Laltex V1.7 API reference |

---

## 26. LALTEX INTEGRATION ARCHITECTURE

Session 1 (24-Apr-26) laid the foundation schema for pulling the Laltex
supplier feed into Supabase. The AI product-search assistant is a
downstream consumer of this pipeline. Later sessions add: embedding
column + nightly sync (S2), widget + tool-use backend (S3–S4).

### 26.1 Source of truth

- **Existing `catalog_*` tables are NOT touched by Laltex sync.** They
  continue to serve the 25 manually-curated products. Unification of
  `catalog_products` and `supplier_products` (view or migration) is a
  deliberate later-session decision.
- **`supplier_products` is the raw Laltex feed**, stored Laltex-shaped in
  JSONB. One row per Laltex `ProductCode`, UNIQUE on
  `(supplier_id, supplier_product_code)`.

### 26.2 Auth and API shape

- **Auth header is `API_KEY: <value>`** — custom header, NOT `Authorization`
  / `Bearer`. Easy to get wrong; both fail silently with 200 OK + empty
  body in some API variants.
- **Base URL:** `https://auto.laltex.com/trade/api`
- **Single product:** `GET /v1/products/{productCode}` — endpoint path
  is case-insensitive in practice, but the docs say lowercase.
- **Response shape:** the **live API returns a bare JSON array** `[{...}]`.
  The PDF-linked sample at `site/docs/laltex-samples/mg0192.json` is
  wrapped in `{ "value": [{...}] }`. The sync script handles both.

### 26.3 RAW cost principle

The Laltex API returns **raw trade cost**. The dashboard's "Markup &
Copy" feature is a **per-quote calculator** — it does NOT affect API
output. So:

- **Never apply markup at sync time.** `supplier_products.product_pricing`
  stores the raw Laltex price, period.
- Markup is a **read-time** concern (future session). It lives in a view,
  a service-layer function, or a computed column — anywhere but the sync
  path.
- This preserves auditability (we can always reconcile to Laltex's invoice)
  and lets margin policy change without re-syncing.

### 26.4 JSONB rationale

`supplier_products` uses JSONB for `product_pricing`, `print_details`,
`items`, `images`, `plain_images`, `artwork_templates`, `shipping_charges`,
`priority_service`, `raw_payload`.

- 10k+ products × variable nested arrays (e.g. print positions × colour
  count × qty tiers × coordinates) would produce row explosion if
  normalised.
- Reads always pull the **whole product** (AI results, PDPs), so JSONB
  is read-optimal.
- Schema flexibility: Laltex's V1.x pipeline adds fields regularly
  (v1.5 added `Material`, `Ingredients`, `CartonDims`, ...) — JSONB
  absorbs those without a migration.
- `raw_payload` stores the **untouched** API response, so we can detect
  schema drift on future Laltex versions and replay old payloads after
  a parser fix.

### 26.5 Parsing rules (implemented in `scripts/sync-laltex-product.js`)

- **Prices are currency strings** — `"£1.79"` → `1.79`. Strip `£€$,\s`,
  parse numeric.
- **Values > £900 = POA** per Laltex convention. Store `{ price: null,
  is_poa: true }`; never emit a numeric price above the threshold.
- **Coordinates are pixel strings** — `"267.500px"` → `267.5`. Strip
  `px`, parse numeric.
- **`MaxQuantity: "N/A"`** means open-ended top tier — store as `null`.
- **`Diameter`** present → `shape = 'circle'`; else `rectangle`. Matches
  our existing `print_areas` table convention.
- **Left-Handed / Right-Handed** print variants exist on Front position —
  both are kept in `print_details[].print_area_coordinates[]`; UI picks
  which to display.

### 26.6 Idempotency

`scripts/sync-laltex-product.js` does an UPSERT on
`(supplier_id, supplier_product_code)`. Running the sync twice in a row
updates the same row (including `last_synced_at`), never creates a
duplicate. The ON CONFLICT clause refreshes all data columns.

### 26.7 Where the code lives

- Migrations: `site/supabase/migrations/20260424_*.sql` (drop legacy,
  enable pgvector, suppliers + supplier_products).
- Sync script: `site/scripts/sync-laltex-product.js` (ESM; uses
  `LALTEX_API_KEY` for Laltex + `SUPABASE_ACCESS_TOKEN` for DB writes
  via the Management API SQL endpoint).
- Sample payload: `site/docs/laltex-samples/mg0192.json` — gitignored,
  confidential (contains real trade prices).

### 26.8 Out of scope for session 1 (reserved for later sessions)

- Embedding column (`vector` or `halfvec`) on `supplier_products`
- Embedding generation pipeline
- Full-catalogue sync / batch pagination / rate-limit handling
- Nightly cron / Edge Function scheduling
- Stock sync (`GET stocks/{productcode}`) — separate higher-frequency job
- Category / slug reconciliation between `catalog_products` and
  `supplier_products`
- AI assistant backend (function-calling, prompt caching)
- AI assistant UI (chat widget, persistent dashboard tab)

### 26.9 Invariants — DO NOT BREAK (sync)

- Sync writes **raw cost only** — never apply markup at sync time.
- Sync **never touches** existing `catalog_*` tables or any
  Designer/Quote/Order/Stripe code path.
- `raw_payload` must always be populated on UPSERT — it's the
  schema-drift audit trail.
- **Never log the Laltex API key** in full. Truncate to last 4 chars
  for debug (`...9f28`) if logging is needed at all.
- `supplier_products` writes are **service-role only** (RLS); reads are
  open to authenticated + anon. Preserve this grant split — the AI
  widget will eventually read as anon.
- Do not commit `site/docs/laltex-samples/` — it contains real trade
  prices and is already `.gitignore`d.

---

### 26.10 Embedding pipeline (session 2)

Semantic-search layer over `supplier_products`. Each product gets one
1536-dim vector stored on the row alongside the data it was derived
from. Session 2 embedded MG0192 as a proof; session 3 does the full
catalogue batch.

#### 26.10.1 Model and storage

| Property | Value |
|---|---|
| Model | `text-embedding-3-small` |
| Dimensions | 1536 |
| Cost | $0.02 / 1M input tokens |
| DB column | `supplier_products.embedding vector(1536)` |
| Index | `supplier_products_embedding_idx` — ivfflat, `vector_cosine_ops`, `lists=100` |
| Distance metric | Cosine (`<=>` operator) |
| Model const | `EMBEDDING_MODEL` in [scripts/lib/embedding.js](../scripts/lib/embedding.js) — single source of truth |

The embedding lives on the same row as the product data. One row, one
vector. No separate embedding table — it would just add a join on every
query for no benefit.

#### 26.10.2 Source text recipe

Implemented by `buildEmbeddingSourceText(product)` in
[scripts/lib/embedding.js](../scripts/lib/embedding.js). The recipe:

```
[name]. [name].                              ← duplicated for weighting
[category] > [sub_category].
[description OR web_description].
Keywords: [keywords].
Material: [material].
Available in [available_colours].
```

Rules:
- Name is emitted twice — the strongest search-intent signal deserves
  ~2× weight in the bag-of-tokens view.
- `description` falls back to `web_description` (and vice versa).
- Any null/empty field drops the **whole segment** — we never emit
  `"Material: null"`.
- Whitespace is squashed (single spaces, trimmed) and the final string
  is capped at 8000 chars (≈2000 tokens, well under the model's 8191
  token context).

Reference output for MG0192 (513 chars):
```
Polo Plus 400ml Travel Mug. Polo Plus 400ml Travel Mug. Drinkware >
Plastic Travel Mugs. 400ml double walled, solid AS plastic coloured
travel mug with black PP plastic inner, screw on lid and matching
coloured sip cover. BPA & PVC free.. Keywords: travel,drinkware,400ml,
double walled,plastic,mug,thermal,reusable,screw lid,hot drinks,home,
office,handle,indoor,outdoor. Material: PP plastic. Available in Amber,
Black, Blue, Burgundy, Cyan, Green, Grey, Light Green, Light Pink,
Pink, Purple, Red, White, Yellow.
```

#### 26.10.3 Idempotency (SHA-256 source hash)

`supplier_products.embedding_source_hash` stores the SHA-256 hex of the
source text used at embed time. The embed script computes a fresh hash
from the current row **before** calling OpenAI; if it matches the stored
hash AND `embedding IS NOT NULL`, the API call is **skipped entirely**.

This is a hard cost-control mechanism, not a nice-to-have. At 10k
catalogue rows, unconditional re-embedding on every nightly sync would
be:
- **~$0.03 of API cost per run** (pocket change), but
- **~10 minutes of API latency**, and
- **pointless load** on a shared API key.

Re-embed happens only when:
1. Any source field changes (name, category, sub_category, description,
   keywords, material, available_colours) — hash diverges, API call
   fires.
2. `embedding` is explicitly NULLed (e.g. during a manual reset or after
   dropping the column for a model change).

The hash anchor is content-based, not timestamp-based. It survives
equivalent re-writes (same values synced twice via UPSERT).

#### 26.10.4 Retrieval query shape

```sql
SELECT supplier_product_code, name,
       1 - (embedding <=> $1::vector) AS similarity
FROM supplier_products
WHERE embedding IS NOT NULL
ORDER BY embedding <=> $1::vector
LIMIT N;
```

The query embedding is generated **fresh every call** — no client-side
caching. Each query costs ~5–10 tokens (~$0.0000002). Caching would add
complexity without meaningful savings.

`1 - (distance)` converts pgvector's cosine distance into the
conventional "similarity" number (1.0 = identical, 0.0 = orthogonal,
negative for opposite directions).

Expected similarity bands (calibrated against MG0192 + plausible
queries on the one-product corpus):
- `> 0.50` — strong match (correct product family + intent)
- `0.30 – 0.50` — related but materially different (e.g. wrong material)
- `< 0.30` — unrelated category; safe to drop from results

These are loose heuristics, not thresholds — session 4's assistant
should probably sort by similarity and show the top N rather than
filter by absolute score.

#### 26.10.5 Index choice: ivfflat at this scale

`ivfflat lists=100` is chosen for the ≤10k-row catalogue we will reach
at the end of session 3. Notes:

- At 1 row (session 2), the index is trivially used but meaningless.
- At 10k rows, `sqrt(N) ≈ 100` is the ivfflat heuristic sweet spot.
- **Index build is ~instant at 1 row, but will take 1–several minutes
  at 10k embedded rows.** Session 3 should embed first, THEN rebuild the
  index (DROP + CREATE) — much faster than maintaining the index during
  10k sequential INSERTs.
- Revisit when the catalogue crosses ~20k rows: either bump `lists` or
  switch to `hnsw` (better recall/latency at the cost of build time and
  memory).

#### 26.10.6 Cost estimates

Observed: MG0192 embeds at **136 tokens** per embed, ≈ $0.0000027
(~0.0002p) per product.

Extrapolated to the full Laltex catalogue:
- ~136 tokens/product is conservative (MG0192 is mid-length).
- **10k products × 136 tokens ≈ 1.36M tokens ≈ $0.027 (~2.1p)** for
  a full rebuild.
- Day-to-day nightly runs cost essentially zero — only products whose
  source hash changed will re-embed.

These numbers make "re-embed the whole catalogue if we change the
source recipe or the model" a cheap decision, not a scary one.

#### 26.10.7 Invariants — DO NOT BREAK (embeddings)

- **`EMBEDDING_MODEL` has ONE definition** — in `scripts/lib/embedding.js`.
  Every script imports the constant. Do not hardcode `text-embedding-
  3-small` elsewhere; changing the model must be a one-line edit.
- **Never call OpenAI without the hash gate first.** The gate must fire
  *before* the API call, not after. Batch scripts in session 3 must
  preserve this contract.
- **Model change implies schema change.** If `EMBEDDING_MODEL` changes
  to a different-dimension model (e.g. `text-embedding-3-large` is
  3072 dims), the `embedding` column type must change and every row
  must be re-embedded. There is no in-place model swap.
- **Source recipe change is a hash-bust.** Any edit to
  `buildEmbeddingSourceText` will change every hash on next run →
  every row re-embeds. That's fine and cheap (§26.10.6), but be
  deliberate — small cosmetic tweaks still trigger a full rebuild.
- **Query embeddings are generated fresh** — no caching in the search
  script. Preserve this for session 4 until there's a measured reason
  to cache.
- **Do not run full-catalogue embed logic in session 2.** That is the
  explicit boundary of session 3 (scope discipline, not a technical
  limit).
