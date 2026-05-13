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

*Last updated: 11 May 2026 — session 5.1: §32.12 added — system prompt v2 (no emojis, no em dashes) + NEAR-MISS REASONING section. v1 prompt body scrubbed of em dashes so the model isn't modelled on a style it's told to avoid. Verified via scripts/verify-session-5-1.js: three probes (bamboo eco-products, decline-jokes-about-competitors, 12oz cotton bags) all returned zero emojis + zero em dashes; the 12oz probe exercised the three-step near-miss pattern verbatim. Earlier 11 May 2026 — session 5: §32 AI Assistant added. First customer-facing surface — POST /api/ai/chat (Anthropic Sonnet 4.6, prompt-cached system prompt + tools, manual tool-use loop dispatching to /api/search-products and /api/find-alternatives via Bearer CRON_SECRET). New tables ai_conversations + ai_quotas; new profiles.ai_chat_enabled boolean. Anonymous quota: 5 searchProducts/24h rolling per visitor_id_hash (SHA-256). Signed-in unlimited. Feature-flag gating: anon via VITE_AI_CHAT_PUBLIC_ENABLED (start false), signed-in via profiles.ai_chat_enabled (manual seed). Minimal AIChatWidget mounted in App.jsx; session 6 polishes UI. Pinned @anthropic-ai/sdk 0.95.1, @fingerprintjs/fingerprintjs 5.2.0. Verification ALL PASS end-to-end after Anthropic credit top-up: A (auth contract 4/4), B (vague → clarification), C (precise → search + synthesis), D (out-of-scope → polite decline), E (5/24h quota cap), F (alternatives free), I (persistence), J (feature flag matrix). Cache hit ratio 66.0% across 12 verification turns. §32.4 explicitly notes the modern cache_control pattern (no anthropic-beta header). §32.11 added for the pre-launch profiles auto-create follow-up. Session 4b (earlier 11 May 2026): §31 Hybrid Search Layer added. Two new serverless endpoints (POST /api/search-products, POST /api/find-alternatives) on the existing Bearer CRON_SECRET pattern; scoring is RRF(k=60) over vector + tsvector ranks with core 1.30× and pgifts-direct 1.05× multipliers (core retuned 1.15 → 1.30 during verification — Query-C diagnostic captured in retune migration). New columns: is_core_product, core_priority, lead_time_days, express_available, in_stock, plus a STORED tsvector + GIN index. 8 PGifts-Direct hero SKUs seeded as is_core_product=true. Laltex parser extended with parseLeadTimeDays + express_available derivation from Supplier='Fast Fit'. No frontend, no AI, no UI — those are sessions 5+. Session 4a.1 (earlier 11 May 2026): §27 rewritten to clarify sync is per-supplier (one cron per feed) and embed is supplier-agnostic (one cron spans every supplier_products row). Embed module renamed laltex-embed.js → catalogue-embed.js; CLI renamed embed-laltex-catalogue.js → embed-catalogue.js; cron route renamed /api/cron/embed-laltex → /api/cron/embed-catalogue (vercel.json + smoke-test updated). New migration 20260511_job_runs_supplier_id_nullable.sql drops NOT NULL on job_runs.supplier_id with a CHECK keeping it required for job_type='sync'. §26.11 supplier ontology table updated. New invariants added in §27.8. Session 4a (24 April 2026): §26.11 Multi-supplier product ontology added; §30 PGifts Direct Migration added (mirror strategy, field mapping, approved 25-row category mapping with Safety Wear override for hi-vis-vest, idempotent rerun, follow-ups, invariants). §28.4 pkey-rename gotcha added earlier (session 3b follow-up). Session 3b: §27 rewritten to cover both sync + embed crons (rename sync_runs→job_runs, job_type column, embed failure policy, per-route env var table); §§28.2 / 28.3 production-vs-local latency + PowerShell 100s timeout. §27 originally added earlier 24 April 2026 (session 3a). §28 opened earlier 24 April 2026 with §28.1 PostgREST 1000-row cap. §§26.10.x added earlier 24 April 2026 (session 2). §26 added 24 April 2026 (session 1). §§19-25 added 23 April 2026 for Buy Now / shared auth gate / transactional email / scroll management / quote total pre-insert / compact product page layout / forgot password. §§2, 3, 8.4, 10, 11, 12, 13, 18 refreshed.*
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

---

### 26.11 Multi-supplier product ontology (session 4a)

As of session 4a, `supplier_products` is the unified AI-searchable
catalogue spanning multiple suppliers. The `suppliers` table carries
two rows:

| slug | source | volume | Notes |
|---|---|---|---|
| `laltex` | External trade API | 1192 | Nightly pull (`sync-laltex` cron, 03:00 UTC) — per-supplier |
| `pgifts-direct` | Internally curated | 25 | Mirrored from `catalog_products` via `scripts/migrate-catalog-to-supplier-products.js` (idempotent, rerun anytime) |

Both pools embed under the single supplier-agnostic
`embed-catalogue` cron at 04:00 UTC (see §27.1). Adding a future
supplier means a new sync route + `vercel.json` cron entry; the embed
cron picks the new rows up automatically.

The 25 PGifts-Direct products **still live in `catalog_products`** —
the Designer, ProductDetailPage, and CustomerQuotes continue to read
from there. `supplier_products` has equivalent rows so AI semantic
search can reason across both pools in one query. **Do not delete
any `catalog_*` rows** — `supplier_products` is additive, not a
replacement, until a future session unifies the frontend reads.

**`raw_payload` as the reconciliation anchor:** every PGifts-Direct
row's `raw_payload` snapshots the joined source state —
`catalog_products`, all related `catalog_pricing_tiers`, `catalog_print_pricing`,
`catalog_product_colors`, `catalog_product_images`, `catalog_product_features`,
`catalog_product_specifications`, and the linked `product_templates`
row. That means the "this product has a Designer template" /
"this product is a 3D Chi Cup preview" / "this product has a
hex-value colour palette" signal survives the mirror for the AI
assistant UI to read later.

For Laltex rows `raw_payload` is the raw API response; for
PGifts-Direct it's the cross-joined catalog snapshot. Future code
reading `raw_payload` should branch on `raw_payload.source` (`'catalog_products'`
for direct, unset / Laltex-shape for external).

---

## 27. NIGHTLY JOBS ARCHITECTURE (sessions 3a + 3b + 4a.1)

Two Vercel Cron jobs run nightly against the catalogue pipeline, each
on its own 5-minute budget. Both write to a single shared observability
table (`job_runs`) distinguished by the `job_type` column.

**Sync is per-supplier; embed is supplier-agnostic.** Session 3b
originally scoped the embed cron to Laltex because that was the only
supplier. Session 4a added a second supplier (`pgifts-direct`) and
session 4a.1 made the embed span every `supplier_products` row in one
pass — see §27.1 for the rationale. Sync stays per-supplier: each
external feed (Laltex today; future suppliers each add their own) has
its own scheduled handler so failure domains stay isolated and the
5-minute budget stays comfortable.

### 27.1 Cron split

| Cron | Schedule (UTC) | `job_type` | `supplier_id` | Purpose | Shipped |
|---|---|---|---|---|---|
| `sync-laltex`     | `0 3 * * *` | `'sync'`  | Laltex (NOT NULL) | `/v1/products/list` → UPSERT `supplier_products` for the Laltex feed only | Session 3a |
| `embed-catalogue` | `0 4 * * *` | `'embed'` | `NULL`            | hash-gated batched embed of changed `supplier_products` rows across **every** supplier | Session 3b (Laltex-scoped); 4a.1 made it supplier-agnostic + renamed from `embed-laltex` |

**Why sync is per-supplier.** Each supplier has its own API shape,
auth header, rate limit, and failure mode. A combined sync would
couple Laltex outages to PGifts Direct re-mirroring, which is the
opposite of what we want. New supplier integration = new
`api/cron/sync-<supplier>.js` + new entry in `vercel.json`.

**Why embed is supplier-agnostic.** Embed is a pure read on
`supplier_products` followed by an OpenAI batch call. Supplier
identity is irrelevant to the embedding model — the hash gate is what
makes a wide read safe (unchanged rows skip the API entirely). One
cron, one observability row per run, no risk of any supplier's rows
silently missing the index.

**Why split sync ↔ embed.** Vercel Cron's 5-minute ceiling is
uncomfortable for sync+embed in one go, and the two operations have
different failure domains (supplier API outage vs. OpenAI outage)
that we want to isolate. A failed embed run doesn't block the next
night's sync, and vice versa.

**Gap rationale.** Observed Laltex sync duration on production is
~90s; the 1-hour gap to 04:00 UTC means embed always runs against a
stable, fully-settled `supplier_products` state, never mid-UPSERT.
If a future supplier's sync ever approaches the budget, reconsider —
but at current scale it's nowhere close.

**OpenAI batching today.** The combined catalogue is ~1217 products
(1192 Laltex + 25 PGifts Direct), well under the
`text-embedding-3-small` 2048-input-per-call cap, so embed issues a
**single** batched `embeddings.create` call. If the catalogue ever
crosses ~2000 rows, extend `scripts/lib/catalogue-embed.js` to chunk
at `OPENAI_BATCH_MAX_INPUTS`; the single-batch path throws with a
clear message if `embedRequested` exceeds the limit — surface, not
silent half-embed.

**`job_runs.supplier_id` is nullable** (since session 4a.1) so embed
runs can be recorded without picking a misleading owning supplier. A
CHECK constraint (`job_runs_supplier_id_required_for_sync`) keeps
`job_type='sync'` rows pointing at a supplier — only `job_type='embed'`
is allowed to leave it NULL.

### 27.2 DB access patterns — do not mix these up

Two distinct DB-access paths coexist, each fit-for-purpose:

| Path | Auth | Use for | Example |
|---|---|---|---|
| **Management API** `/v1/projects/.../database/query` | `SUPABASE_ACCESS_TOKEN` (PAT, `sbp_…`) | Single-row admin ops, migrations, ad-hoc SQL, scripted DDL | `scripts/sync-laltex-product.js` (single-product debug), session 1+2 migrations |
| **PostgREST** `${VITE_SUPABASE_URL}/rest/v1/...` | `SUPABASE_SERVICE_ROLE_KEY` | Bulk DML from serverless (cron), high-volume writes, anything where per-row granularity matters | `scripts/lib/laltex-sync.js` (session 3a), session 3b embed batch |

**This is per-tool-fit, not preference.** The Management API is an
admin-tier SQL proxy — synchronous, designed for DDL + single queries.
It is the wrong hammer for 10k nightly UPSERTs: it forces you to build
a multi-MB `INSERT ... ON CONFLICT` SQL string, synchronises through an
extra hop, and can't surface per-row failures without parsing raw
Postgres error text.

PostgREST with the service-role key is the idiomatic path for bulk DML:
native batch UPSERT via `POST /rest/v1/{table}` + `Prefer:
resolution=merge-duplicates`, per-row response data, and direct
connection to Postgres without an admin-API hop.

Session 1's `sync-laltex-product.js` intentionally stays on PAT +
Management API — it's a debugging script for single products, not a
cron, and rewriting it would be churn with no benefit.

### 27.3 Continue-with-logging failure policy

One bad row never aborts the run (for either job type).

**Sync:**
- **Infra-level failures** (Laltex network failure, auth, schema out of
  sync) mark `job_runs.status = 'failed'`, populate `error_message`,
  and exit the loop. Tomorrow's cron retries.
- **Per-product parse errors** land in `job_failures` with
  `reason='parse_error'` and the row still attempts to persist with
  nulls for the affected fields — best-effort.
- **Per-product upsert failures** land in `job_failures` with
  `reason='upsert_failed'` and the row **keeps its previous
  `last_synced_at`** (failed UPSERT must not touch stale-ness).
- **Unexpected exceptions** inside the loop land in `job_failures`
  with `reason='unexpected_error'` and the sync continues.

**Embed:**
- **OpenAI batch failure** (single atomic call) marks
  `job_runs.status='failed'`. Nothing partial is logged per-product
  because nothing per-product was attempted. Tomorrow's cron retries.
- **Per-row UPDATE failure** after a successful batch embed lands in
  `job_failures` with `reason='embed_update_failed'`; other rows
  continue to be written.
- **`embedding_source_hash` is preserved on failed update** — the row
  stays with its previous embedding, so retrieval keeps working.

**Both:** `status='running'` at end-of-function is forbidden. A
`finally` block always finalises to `'completed'` or `'failed'`.

### 27.4 Blast-radius mitigation on batch upsert

PostgREST bulk UPSERT is atomic per batch — one bad row fails the
whole batch. The sync library chunks into 50 rows per batch and, on
batch failure, falls back to single-row UPSERTs across the same
chunk so we isolate the bad rows without drooling 49 good ones.
Happy path is ~200 fast batched requests for a 10k catalogue;
pathological case adds one chunk of 50 single-row retries.

### 27.5 Observability tables

Originally shipped as `sync_runs` + `sync_failures` (session 3a); renamed
to `job_runs` + `job_failures` in session 3b when the embed cron joined
the same pipeline. Schema in
[`supabase/migrations/20260424_sync_runs_and_failures.sql`](../supabase/migrations/20260424_sync_runs_and_failures.sql)
+ rename migration
[`supabase/migrations/20260424_rename_sync_runs_to_job_runs.sql`](../supabase/migrations/20260424_rename_sync_runs_to_job_runs.sql).

- `job_runs` — one row per invocation, across both job types.
  - `job_type` `TEXT NOT NULL CHECK (job_type IN ('sync','embed'))` —
    add new values to the CHECK as new job types land.
  - `run_type` (`'full_catalogue'` today), counters, `duration_ms`,
    `triggered_by` (`'cron' | 'manual' | 'cli'`), `metadata` JSONB
    (embed metadata carries `openai_tokens_used` + `openai_cost_usd`
    + `embed_skipped_unchanged`), partial index on
    `WHERE status='running'` for stuck-run detection.
- `job_failures` — per-row failure rows, FK `job_run_id` with
  `ON DELETE CASCADE`. `raw_snippet` JSONB truncated to ~2000 chars.
  `reason` is an open enum (`'parse_error'`, `'upsert_failed'`,
  `'unexpected_error'`, `'empty_source_text'`, `'bad_embedding_shape'`,
  `'embed_update_failed'`, …).

RLS: SELECT open to authenticated + anon (admin dashboard reads);
writes service-role only.

### 27.6 Cron auth

Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` to each
`/api/cron/*` route. Both handlers verify strictly (`401` on missing
or wrong); no "unauthorised" body, just the status.

Required Vercel env vars per route:

| Route | Env vars needed (beyond `CRON_SECRET`) |
|---|---|
| `/api/cron/sync-laltex` | `LALTEX_API_KEY`, `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `/api/cron/embed-catalogue` | `OPENAI_API_KEY`, `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

Missing any → `500` with a clear `{ missing: [...] }` body so the
cron logs make the misconfiguration obvious.

Full operational playbook (testing, env setup, inspection queries,
recovery) in [`docs/VERCEL_CRON_SETUP.md`](../docs/VERCEL_CRON_SETUP.md).

### 27.7 Files

| File | Added | Purpose |
|---|---|---|
| `supabase/migrations/20260424_sync_runs_and_failures.sql` | 3a | Initial observability tables + RLS |
| `supabase/migrations/20260424_rename_sync_runs_to_job_runs.sql` | 3b | Rename to `job_runs`/`job_failures`, add `job_type` |
| `supabase/migrations/20260511_job_runs_supplier_id_nullable.sql` | 4a.1 | Drop NOT NULL on `job_runs.supplier_id`; CHECK keeps it required for `job_type='sync'` |
| `scripts/lib/laltex-parser.js` | 3a | Pure parsing helpers (Laltex-specific) |
| `scripts/lib/laltex-sync.js` | 3a | `syncFullCatalogue(...)` — writes `job_type='sync'`, per-supplier |
| `scripts/lib/catalogue-embed.js` | 3b → 4a.1 | `embedCatalogue(...)` — hash-gated embed, writes `job_type='embed'`, supplier-agnostic. Renamed from `laltex-embed.js` in 4a.1 |
| `scripts/lib/embedding.js` | 2 | Embedding model + source-text recipe + hashing |
| `scripts/sync-laltex-catalogue.js` | 3a | Local sync CLI |
| `scripts/embed-catalogue.js` | 3b → 4a.1 | Local embed CLI. Renamed from `embed-laltex-catalogue.js` in 4a.1 |
| `scripts/smoke-test-cron-auth.js` | 3a→3b→4a.1 | Tests both routes' 401/401/200 contract; embed route updated to `embed-catalogue` |
| `api/cron/sync-laltex.js` | 3a | Vercel Serverless Function — sync |
| `api/cron/embed-catalogue.js` | 3b → 4a.1 | Vercel Serverless Function — embed. Renamed from `embed-laltex.js` in 4a.1 |
| `vercel.json` | 3a→3b→4a.1 | `crons[]` has both entries; embed path is now `/api/cron/embed-catalogue` |
| `docs/VERCEL_CRON_SETUP.md` | 3a→3b→4a.1 | Ops playbook (both routes) |

### 27.8 Invariants — DO NOT BREAK

- **Do NOT use the Management API / PAT for bulk writes.** See §27.2.
- **Do NOT set `last_synced_at` on a failed UPSERT.** It's the anchor
  for stale-product detection — failed rows must show an older
  timestamp than the run that failed.
- **Do NOT touch `embedding` or `embedding_source_hash` on a failed
  embed update.** Same principle — a failed write must not break
  existing retrieval.
- **Do NOT throw past the sync or embed loop.** Every per-row failure
  is `job_failures` material, not an exception. The `finally` block
  must always finalise `job_runs`.
- **Do NOT collapse the 03:00 / 04:00 crons.** Split is load-bearing
  for the 5-min budget and for failure-domain isolation.
- **Do NOT bypass the embed hash gate.** Calling OpenAI when the hash
  matches is a cost-control violation (CLAUDE.md §26.10.7).
- **Do NOT change `CRON_SECRET` on only one side.** Vercel and local
  `.env` must match, and the Vercel-side secret must match for every
  environment (Production + Preview).
- **Do NOT commit the service-role key.** It bypasses RLS. Storage
  is `.env` + Vercel env only.
- **Do NOT INSERT into `job_runs` without `job_type`.** The DEFAULT
  was dropped post-backfill precisely so nothing can silently land
  at `'sync'` by accident.
- **Do NOT re-scope the embed to a single supplier.** The embed cron
  spans every `supplier_products` row by design (§27.1). Filtering by
  `supplier_id` will silently exclude any supplier added after the
  filter was written — the bug session 4a.1 fixed. The hash gate is
  what keeps a wide read cheap; trust it.
- **Do NOT add new sync routes without setting `supplier_id`** on the
  `job_runs` row. The `job_runs_supplier_id_required_for_sync` CHECK
  will reject the insert, but you'll waste a deploy noticing — clone
  `laltex-sync.js`'s pattern.

---

## 28. KNOWN GOTCHAS

Infrastructure-level quirks that have caught us out. Each entry is a
thing that looked right, ran green, and turned out to be subtly wrong.
Add future gotchas here, each with: what it is, how to detect it, how
to fix it.

### 28.1 Supabase PostgREST silently caps responses at 1000 rows

**What it is:** `GET /rest/v1/{table}` against Supabase enforces a
server-side `max-rows=1000` limit on response size. This applies even
when authenticated with `SUPABASE_SERVICE_ROLE_KEY`, even when you pass
`?limit=5000`, and even with `Range: 0-9999` headers — all three are
silently ignored beyond 1000 rows. The response `Content-Range` header
gives it away (`0-999/*`), but nothing about the HTTP status or shape
suggests truncation.

**How to detect it:**
- Counters that look impossibly clean. Session 3a's first idempotent
  re-run reported `inserted=192 updated=1000` for a 1192-row catalogue —
  the 192 "inserts" were actually updates on rows past the 1000-row
  page boundary that `getExistingCodes()` couldn't see.
- Any `SELECT` against a Supabase table bigger than 1000 rows that
  doesn't loop will silently truncate. If downstream logic depends on
  "I just read every row", that logic is broken.
- `Content-Range: 0-999/*` with `Accept-Ranges: items` on the response.

**How to fix it:** Paginate explicitly with `?limit=1000&offset=N`,
loop until a page returns fewer than 1000 rows. Example pattern in
[`site/scripts/lib/laltex-sync.js`](../scripts/lib/laltex-sync.js)
`getExistingCodes()`. Use `&order=<stable_column>.asc` so pagination
is deterministic.

**Scope:** Applies to every PostgREST `GET` from serverless code —
cron jobs, Edge Functions, anywhere that does bulk reads. Single-row
`eq.` lookups are fine. The Management API (`/database/query` with a
PAT) has its own limits but doesn't share this specific cap; it's
bounded by response size instead.

### 28.2 Production cron latency is ~1.7× local, not ~1.1×

**What it is:** The sync cron takes ~52s when run from local CLI,
but **~90s when invoked on Vercel production** (cold function +
Vercel's US region ↔ Laltex UK round-trip latency + PostgREST batch
round-trips through the Vercel → Supabase path). The 1.7× factor is
bigger than intuition suggests.

**How to detect it:** Compare `job_runs.duration_ms` between rows
where `triggered_by='cli'` (your laptop) and `triggered_by='cron'`
(Vercel). The two runs immediately after session 3a's merge showed
53617 ms (cli) vs 90709 ms (cron) for identical 1192-row loads.

**How to fix it (when it matters):** Not today — 90s is well under
the 300s function budget. But at ~10k products the linear scale would
push past the budget; mitigations in order of likely value:
- Bump PostgREST batch size up from 50 (reduces round-trip count)
- Parallelise batches (2–4 concurrent)
- Split sync across multiple cron hits (cursor-based resume)

**Scope:** Anywhere a Vercel serverless function talks to external
APIs in bulk. The latency premium is additive across round-trips, so
anything with N×fast-call patterns suffers more than single-call ones.

### 28.3 PowerShell `Invoke-WebRequest` 100s default timeout

**What it is:** On Windows, `Invoke-WebRequest` defaults to a ~100-
second HTTP timeout. For requests that take longer, it doesn't fail
cleanly — in practice we've seen it return the **SPA shell (`200`
HTML)** from what looked like a successful request, making a timing
problem look like a routing problem.

**How to detect it:** A production cron endpoint returns correct
401/401 on unauth/wrong-secret cases but the authenticated call comes
back 200 with `text/html` body instead of the expected JSON. If the
server-side `job_runs` row shows `status='completed'` for that
invocation, you were never hitting the server — you were timing out
client-side.

**How to fix it:** Either use `curl` (session 3a made this the
recommended path — see `docs/VERCEL_CRON_SETUP.md §3`) or pass an
explicit `-TimeoutSec 600` to `Invoke-WebRequest`. Don't rely on the
default.

**Scope:** Any manual testing of long-running Vercel functions from
PowerShell. Doesn't affect Vercel Cron itself (that's server-to-
server) — only humans triggering the endpoint manually.

### 28.4 Postgres `ALTER TABLE RENAME` does not auto-rename pkey constraints

**What it is:** `ALTER TABLE sync_runs RENAME TO job_runs` carries the
pkey *index* over (Postgres renames `sync_runs_pkey` → `job_runs_pkey`
automatically — old docs say so) but in practice the pkey **constraint
name** survives as `sync_runs_pkey`. Session 3b's rename migration hit
this live on 2026-04-24: after the RENAME, `SELECT conname FROM
pg_constraint WHERE conrelid='job_runs'::regclass` still showed
`sync_runs_pkey`. Non-pkey named constraints (CHECK, FK) never auto-
rename and are universally known to need explicit `RENAME CONSTRAINT`.

**How to fix it:** Add explicit `ALTER TABLE <new_name> RENAME
CONSTRAINT <old_name>_pkey TO <new_name>_pkey;` alongside the other
constraint renames. Cosmetic only — functionality is unaffected — but
keeps `\d+` output and schema dumps readable. See
[`supabase/migrations/20260424_rename_sync_runs_to_job_runs.sql`](../supabase/migrations/20260424_rename_sync_runs_to_job_runs.sql)
section 6 for the concrete pattern.

---

## 30. PGIFTS DIRECT MIGRATION (session 4a)

Session 4a mirrors the 25 internally-curated `catalog_products` rows
into `supplier_products` under the new `'pgifts-direct'` supplier
row, so a single AI-searchable pool spans both Laltex (1192) and
PGifts Direct (25) for a total of 1217 embedded products.

### 30.1 Strategy: MIRROR, not MOVE

- `catalog_products` stays the source of truth for Designer,
  ProductDetailPage, CustomerQuotes, and every other user-facing
  read path.
- `supplier_products` gets equivalent rows. `raw_payload` snapshots
  the joined source state so the mirror is fully reconcilable.
- Duplicate data is explicitly accepted during this transitional
  phase. A future session unifies the frontend reads; until then
  **do not delete any `catalog_*` rows** and **do not edit the 25
  `supplier_products` rows by hand** — rerun the migration script
  if the source changes.

### 30.2 Field mapping

| supplier_products field | Source | Notes |
|---|---|---|
| `supplier_product_code` | `catalog_products.slug` | Stable, already unique, already URL-load-bearing |
| `name`, `title` | `catalog_products.name` | Both set to `name`; no separate web title |
| `description`, `web_description` | `catalog_products.description` | Often empty string in source — session 2 `presentField()` drops empties from the embedding source text |
| `keywords` | Concatenated `catalog_product_features.feature_text` | No `keywords` column on `catalog_products`; features are the natural keyword source |
| `available_colours` | Joined active `catalog_product_colors.color_name` | Comma-separated; feeds `buildEmbeddingSourceText()` |
| `category` / `sub_category` | Approved mapping (see §30.4) | Two-level, Laltex-aligned where possible |
| `supplier_division` | Literal `'PGifts Direct'` | Distinguishes from Laltex divisions (`PRE`, `BHQ`, etc.) |
| `minimum_order_qty` | `catalog_products.min_order_quantity` | |
| `images` | `catalog_product_images.image_url` (primary first, then sort_order) | URL strings only; hosted on Supabase Storage not Laltex CDN |
| `items` | `catalog_product_colors` → Laltex `Items[]` shape | Adds `HexValue` field (PGifts has hex, Laltex doesn't — retained as a bonus field) |
| `product_pricing` | `catalog_pricing_tiers` → `{min_qty, max_qty, price, is_poa:false, note}` | Straight map |
| `print_details` | `catalog_print_pricing` matrix → single entry with `PrintPosition='Customer Choice'` | See §30.3 for the shape decision |
| `raw_payload` | Cross-joined catalog snapshot + `product_templates` row | Cold storage; `raw_payload.pricing_model` carries the source enum (`'flat'`/`'clothing'`/`'coverage'`) |
| `last_synced_at` | Now (migration runtime) | |
| `embedding`, `embedding_source_hash`, `embedded_at` | Left NULL | The 04:00 UTC embed cron picks these rows up on next run |

### 30.3 `print_details` shape (approved 2026-04-24)

`catalog_print_pricing` has no `position` column — it's a
`(min_qty × colour_count × colour_variant)` matrix with positions
chosen by the customer at Configure-&-Quote time. We represent it
as **one** `print_details` entry per product with:

- `PrintClass: 'CURATED'`
- `PrintType: 'Spot Print'`
- `PrintPosition: 'Customer Choice'`
- `PrintPrice[]` carries every matrix row as
  `{NumColours, NumPosition:1, MinQuantity, MaxQuantity, Price, ColourVariant}`.
- `ColourVariant` (`'white' | 'coloured'`) is an **added field**
  vs. Laltex's PrintPrice shape — PascalCase for jsonb_path_query
  consistency. Laltex rows simply won't carry it; consumers should
  treat it as optional.
- `PrintAreaCoordinates: []` — the Designer owns print-area
  coordinates in the separate `print_areas` table, not here.

### 30.4 Approved category mapping

| Source `slug` | `category` | `sub_category` |
|---|---|---|
| `5oz-cotton-bag` | Bags | Cotton Bags |
| `5oz-recycled-cotton-bag` | Bags | Recycled Cotton Bags |
| `5oz-mini-cotton-bag` | Bags | Mini Cotton Bags |
| `8oz-canvas` | Bags | Canvas Bags |
| `12oz-recycled-canvas` | Bags | Recycled Canvas Bags |
| `a5-notebook` | Notebooks | A5 Notebooks |
| `a6-pocket-notebook` | Notebooks | A6 Pocket Notebooks |
| `chi-cup` | Drinkware | Coffee Cups |
| `water-bottle` | Drinkware | Water Bottles |
| `edge-classic` | Writing | Plastic Pens |
| `edge-silver` | Writing | Plastic Pens |
| `edge-white` | Writing | Plastic Pens |
| `gamma-lite` | Power | Power Banks |
| `ice-p` | Power | Power Banks |
| `luggie` | Power | Power Banks |
| `mr-bio` | Cables | Charging Cables |
| `mr-bio-pd-long` | Cables | Charging Cables |
| `ocean-octopus` | Cables | Charging Cables |
| `octopus-mini` | Cables | Charging Cables |
| `polo` | Clothing | Polos |
| `hoodie` | Clothing | Hoodies |
| `sweatshirts` | Clothing | Sweatshirts |
| `t-shirts` | Clothing | T-Shirts |
| `hi-vis-vest` | **Safety Wear** | Hi-Vis Vests |
| `tea-towel` | Homeware | Tea Towels |

**Notable overrides from Laltex alignment:**

- **`hi-vis-vest` → `Safety Wear > Hi-Vis Vests`** (not `Clothing`).
  PPE clusters distinctly from apparel in semantic search; future
  Laltex safety products will land here too.
- **`tea-towel` → `Homeware > Tea Towels`** — Laltex doesn't have
  an equivalent subcategory today. Best generic bucket of the
  four alternatives considered.

The mapping is baked into
[`scripts/migrate-catalog-to-supplier-products.js`](../scripts/migrate-catalog-to-supplier-products.js)
as `CATEGORY_MAPPING`. Any future category changes: edit the
constant and rerun the script — idempotent on
`(supplier_id, supplier_product_code)`.

### 30.5 Re-running the migration

```bash
cd site
node scripts/migrate-catalog-to-supplier-products.js --dry-run   # review shape
node scripts/migrate-catalog-to-supplier-products.js             # live upsert
```

Idempotent. Re-run whenever `catalog_*` rows change and you want
the `supplier_products` mirror refreshed. The script never touches
`embedding` / `embedding_source_hash` / `embedded_at` — the embed
cron picks up hash-changed rows on the next 04:00 UTC run.

The script ONLY reads from `catalog_*` and writes to
`supplier_products`. It does not mutate `catalog_*`, does not
write to `product_templates`, does not touch `user_designs`, and
does not edit any frontend code or Edge Function.

### 30.6 Known follow-ups

#### Descriptive Copy Backfill (post-launch task)

**23 of 25 PGifts-Direct products have empty `description` fields** in
the source `catalog_products` table. Only `chi-cup` (370 chars) and
`a6-pocket-notebook` (94 chars) carry real descriptive text. The rest
lean on `subtitle` ("Premium promotional product", etc.) plus
`catalog_product_features` — which the migration folds into `keywords`
so it does reach `buildEmbeddingSourceText()` — but this gives
PGifts-Direct embeddings materially less signal than Laltex embeddings,
every one of which carries a proper description.

**Consequence:** in semantic retrieval, PGifts-Direct products will
likely rank below comparable Laltex products on the same query,
**despite being the better-integrated products** (Designer templates,
3D previews, curated pricing, hex-value colour palettes). That's a
quality/fairness problem we should fix before launch, not one we
learn about in production.

**Workflow when we tackle this:**

1. Author 2–3 sentences of descriptive copy per PGifts-Direct product
   (22 products total — `chi-cup` and `a6-pocket-notebook` already
   have enough).
2. `UPDATE catalog_products SET description = '...' WHERE slug = '...'`
   for each.
3. `cd site && node scripts/migrate-catalog-to-supplier-products.js`
   — idempotent, re-shapes all 25 rows from updated sources.
4. Nothing else to do. The 04:00 UTC embed cron detects the
   `embedding_source_hash` change on the next run and re-embeds only
   the affected rows; cost is ~$0.00005/product (§26.10.6 math).

Don't pre-empt this work — wait until hybrid search (session 4b) lands
so we can measure whether the gap is real and significant before
asking someone to write copy. If 4b's tsvector side covers for the
thin descriptions on literal-keyword queries, the priority drops.

#### Forward flag for session 4b (hybrid search)

**`pricing_model = 'coverage'` is a real value.** Exactly one product
(`chi-cup`) uses this pricing model — it's the only full-wrap product
in the catalogue. Session 4b's search function / filter SQL must treat
`pricing_model` as an **open set of at least `{flat, clothing, coverage}`**
— do NOT hardcode `('flat','clothing')` in IN-lists or CHECK-like
filters. The canonical location of this value on migrated rows is
`raw_payload.pricing_model`; for Laltex rows it's absent (default to
null when consumers check it).

#### Forward flag for session 5 (AI assistant UI)

**HexValue is a PGifts-Direct-only field.** The migration script
preserves `hex_value` from `catalog_product_colors` into each
`items[].HexValue` entry. Laltex's feed provides PMS codes but no hex,
so Laltex rows' `items[].HexValue` is uniformly null. The chat widget
results view can exploit this as a **visible differentiator** for
curated products — render hex-swatches inline for PGifts-Direct
results; fall back to image-based swatches for Laltex. Don't treat
this as a gap in Laltex's data; it's an intrinsic feature-parity
difference worth surfacing.

#### Other follow-ups

- **Frontend unification.** A future session migrates
  ProductDetailPage, CustomerQuotes, and the Designer's product-
  lookup logic to read from `supplier_products` directly, at which
  point `catalog_products` can be retired. Out of scope here.
- **Subtitle is cold storage.** `catalog_products.subtitle` is
  preserved in `raw_payload` but not currently folded into the
  `supplier_products` source text. Reconsider only if descriptive-
  copy backfill (above) is still insufficient and hybrid search
  doesn't close the gap.

### 30.7 Invariants — DO NOT BREAK

- **Do NOT delete `catalog_*` rows.** Mirror strategy depends on
  them staying intact.
- **Do NOT edit PGifts-Direct `supplier_products` rows by hand.**
  Rerun the migration script so `raw_payload` stays truthful.
- **Do NOT pre-embed the new rows.** The 04:00 UTC cron is the
  single embed entry point; preserving that keeps the pipeline
  consistent and observable via `job_runs` with `job_type='embed'`.
- **Do NOT reuse `supplier_product_code` values between suppliers.**
  The unique constraint is `(supplier_id, supplier_product_code)`
  so technically allowed, but semantically a code should identify
  one product globally — if Laltex ever ships a product whose code
  collides with a PGifts-Direct slug, rename ours.
- **Do NOT change the category mapping without reapproval.** The
  mapping is baked into the script AND §30.4 — both must stay in
  sync. Future supplier additions that need similar mapping should
  follow the same human-checkpoint pattern used in session 4a.

---

## 31. HYBRID SEARCH LAYER (session 4b)

Two Vercel serverless endpoints that turn `supplier_products` into a
callable search engine. The AI assistant (session 5) consumes these
via tool calls; the layer below is purely retrieval + ranking, no
generative model is touched here.

| Endpoint | Purpose | Auth |
|---|---|---|
| `POST /api/search-products` | Hybrid (vector + tsvector) catalogue search with structured filters | Bearer `${CRON_SECRET}` |
| `POST /api/find-alternatives` | Vector-only nearest neighbours of a known product | Bearer `${CRON_SECRET}` |

Server-to-server only at this stage. Same shared secret as the cron
routes — rotation rotates everything together. A future public-facing
exposure (if ever needed) gets its own auth layer; out of scope here.

### 31.1 Scoring

`/api/search-products` uses **Reciprocal Rank Fusion** (RRF, k=60)
over two retrievers, multiplied by curation boosts:

```
base_rrf = 1/(60 + vector_rank) + 1/(60 + tsvector_rank)
final    = base_rrf
           * (1.30 if is_core_product             else 1.0)
           * (1.05 if supplier='pgifts-direct'    else 1.0)
```

RRF was chosen over weighted-sum because cosine similarity (0–1) and
`ts_rank` (unbounded) have wildly different score scales and any
weighted blend requires per-corpus normalisation; RRF is
scale-invariant by construction. ROW_NUMBER (not RANK) assigns
positions inside the filtered candidate set, with a stable
tiebreaker on `supplier_product_code`.

**`/api/find-alternatives`** uses pure cosine similarity (no
text query, no tsvector) multiplied by the **same** boost factors
**except** `CORE_MULTIPLIER stays at 1.15`. The scoring domains
differ — RRF base ≈ 0.025–0.033, raw cosine ≈ 0.5–0.9 — so the same
multiplier means very different things. 1.15× on a 0.85 similarity
is +0.13 absolute (significant); 1.30× would be +0.26, biasing too
aggressively when the source product itself is the anchor.

**Tune these two multipliers independently.** It is correct and
expected that `rpc_search_supplier_products.CORE_MULTIPLIER`
diverges from `rpc_find_alternatives.CORE_MULTIPLIER` — they
operate on different score scales. Future re-tunes that touch one
should NOT reflexively copy the change to the other. Each value
lives in its own RPC's `DECLARE` block precisely so they can move
separately.

#### 31.1.1 The core multiplier was retuned during verification

Shipped value: **1.30**. Initial spec value was 1.15. The retune
happened during session 4b verification on Query C ("charging
cable"): at 1.15, only 2 of the 4 PGifts-Direct hero cable products
landed in the top 5 because their product names don't contain the
word "cable" so `ts_rank` ranked them ~40th vs ~1–3 for Laltex
products whose names do (e.g. *NOVA 100W 4-in-1 Fast Charge Cable*).
At 1.30 all four (mr-bio-pd-long, mr-bio, octopus-mini,
ocean-octopus) take positions 1–4 with the strongest Laltex match
(ZP0200) sandwiched at #5. See migration
`20260511_search_layer_retune_core_multiplier.sql` for the math and
the raw rank data that informed the decision.

Ocean Octopus cannot be #1 in this query under any boost — its base
vector similarity is the lowest of the four core cable products
(0.477 vs 0.488 for mr-bio-pd-long). Per-product priority weighting
via `core_priority` would be the lever for that; out of scope here
(all 8 hero SKUs currently uniform `core_priority=1`).

### 31.2 Filters

All optional unless noted. Validated in the endpoint, parameterised
into the RPC — no string concatenation of user input into SQL.

| Filter | Type | Notes |
|---|---|---|
| `query` | string | **Required.** ≤500 chars. Embedded via `text-embedding-3-small` for the vector side; passed to `websearch_to_tsquery` for the tsvector side. |
| `filters.category` | string | Exact match (Laltex's canonical capitalisation). |
| `filters.sub_category` | string | Exact match. |
| `filters.supplierSlug` | string | `'laltex'` or `'pgifts-direct'`. |
| `filters.minOrderQuantity` | integer | Products whose `minimum_order_qty` exceeds this are excluded (treats DB null as "no MOQ" = always passes). |
| `filters.quantity` | integer | Sets the price-tier bracket for `maxUnitPrice`. **Required** if `maxUnitPrice` is set. |
| `filters.maxUnitPrice` | number | POA rows always excluded when this is set. Without `quantity`, *any* tier below the ceiling qualifies; with `quantity`, only the tier whose range contains the qty is tested. |
| `filters.maxLeadTimeDays` | integer | NULL `lead_time_days` rows are excluded when this filter is set (no signal to rank). |
| `filters.inStockOnly` | boolean | Default **true**. |
| `filters.expressOnly` | boolean | Default **false**. Maps to `express_available = true` (currently `supplier_division='Fast Fit'` for Laltex; always false for PGifts-Direct). |
| `filters.product_indicator` | string | Exact match (e.g. `'Clearance'`, `'Best Seller'`, `'To Be Discontinued'`). |
| `filters.limit` | integer | Default 10, max 50. Clamped both in JS and inside the RPC. |

**`material` is intentionally NOT a filter.** Laltex's `material`
column is free-text ("PP plastic", "AS plastic", "Stainless steel"
vs "stainless steel") and would need normalisation that hasn't been
done. Customers express material preferences in natural language;
session 3b retrieval tests confirmed embeddings catch this well.
Revisit only with a normalised facet column.

### 31.3 Staleness exclusion (non-bypassable)

Both RPCs apply `last_synced_at > now() - interval '14 days'`. The
filter lives INSIDE the function so callers cannot disable it.
Rationale: discontinued Laltex SKUs whose feed entries vanish age
out of search results without manual intervention. The window must
be longer than the longest realistic cron-outage window — 14 days
covers any plausible incident plus weekend response time.

PGifts-Direct rows refresh `last_synced_at` on every re-run of
`scripts/migrate-catalog-to-supplier-products.js`; Laltex rows
refresh on every nightly cron. Verified end-to-end in session 4b
verification Query I (backdate row → search misses → restore →
search finds).

### 31.4 Database surface

Schema changes (migration `20260511_search_layer_additions.sql`):

```
ALTER TABLE supplier_products ADD COLUMN is_core_product   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE supplier_products ADD COLUMN core_priority     INTEGER;
ALTER TABLE supplier_products ADD COLUMN lead_time_days    INTEGER;
ALTER TABLE supplier_products ADD COLUMN express_available BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE supplier_products ADD COLUMN in_stock          BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE supplier_products ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')),                                          'A') ||
    setweight(to_tsvector('english', coalesce(description, '') || ' ' || coalesce(web_description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(keywords, '')),                                      'C') ||
    setweight(to_tsvector('english', coalesce(category, '') || ' ' || coalesce(sub_category, '')), 'D')
  ) STORED;
```

`search_tsv` is GENERATED STORED — no trigger needed; Postgres
recomputes automatically on any source-column UPDATE. The GIN index
build needed `maintenance_work_mem = '128MB'` (raised via `SET
LOCAL` in the migration transaction; default 32MB was insufficient
even at 1217 rows).

Two RPC functions, parameterised end-to-end:

- `rpc_search_supplier_products(query_embedding, query_text, ...11 filter params, p_limit)`
- `rpc_find_alternatives(p_supplier_product_code, p_exclude_out_of_stock, p_limit)`

`EXECUTE` granted to `service_role` only; the serverless endpoints
use the service-role key (same pattern as cron). Public/anon cannot
call these RPCs directly.

### 31.5 Core seeding (8 hero SKUs)

Seeded in `20260511_search_layer_additions.sql`:

```
ocean-octopus     octopus-mini     mr-bio       mr-bio-pd-long
ice-p             luggie           gamma-lite   chi-cup
```

All set `is_core_product = true, core_priority = 1` — uniform tier
today. Future hero additions should land via a follow-up migration
(traceable git history) rather than a script UPDATE. The
PostgREST-driven migrate script (`migrate-catalog-to-supplier-products.js`)
deliberately **omits** `is_core_product` / `core_priority` /
`in_stock` from its upsert body so curated state survives re-runs —
merge-duplicates only touches columns present in the payload.

### 31.6 Files

| File | Purpose |
|---|---|
| `supabase/migrations/20260511_search_layer_additions.sql` | Schema + RPCs + core seed (canonical source of truth, contains the post-retune 1.30 multiplier) |
| `supabase/migrations/20260511_search_layer_patch_alternatives.sql` | `rpc_find_alternatives` column-ambiguity fix (caught in verification) |
| `supabase/migrations/20260511_search_layer_retune_core_multiplier.sql` | Core multiplier 1.15 → 1.30 retune with the diagnostic math captured |
| `api/search-products.js` | Hybrid search endpoint |
| `api/find-alternatives.js` | Companion alternatives endpoint |
| `scripts/lib/search-auth.js` | Shared auth + env guard + RPC fetch + tier picker helpers |
| `scripts/lib/laltex-parser.js` | Extended with `parseLeadTimeDays` + `LALTEX_EXPRESS_DIVISION` const + new fields in `normaliseProduct` |
| `scripts/migrate-catalog-to-supplier-products.js` | Adds `lead_time_days: null`, `express_available: false` to PGifts-Direct rows |
| `scripts/verify-session-4b.js` | In-process verification harness — runs Queries A–I |

### 31.7 What this layer does NOT do

- **No live stock check.** `in_stock` is a manually-overridable
  column. Real-time Laltex `/stocks` polling is session 5+ (on-demand
  at quote/cart time, not at search time).
- **No AI / no chat.** This is retrieval + ranking only. Session 5
  wires it to function-calling.
- **No UI.** Session 6 builds the chat widget that consumes
  `/api/search-products` + `/api/find-alternatives`.
- **No public exposure.** Bearer `${CRON_SECRET}` gates everything;
  the AI Edge Function (session 5) calls these with the secret.

### 31.8 Invariants — DO NOT BREAK

- **Do NOT bypass the staleness filter.** The 14-day cutoff lives
  inside both RPCs precisely because a caller-set parameter is too
  easy to leave true accidentally. Discontinued SKUs ageing out of
  search results is load-bearing for AI quality.
- **Do NOT remove the parameterisation.** Query text goes through
  `websearch_to_tsquery` (safe by construction) and filter values
  are JSON params on `POST /rest/v1/rpc/...` — never concatenated
  into SQL. The next person to add a filter should follow the
  named-parameter pattern, not invent ad-hoc query construction.
- **Do NOT diverge `api/search-products.js`'s `SCORING` constant
  from the RPC.** The RPC is authoritative; the JS const is
  documentation + response metadata. If you retune the RPC, mirror
  the change in `SCORING` so callers can see what produced their
  ranking.
- **Do NOT include `is_core_product` / `core_priority` / `in_stock`
  in any sync or migrate upsert body.** PostgREST merge-duplicates
  would overwrite curated state. The shipped sync (Laltex) + migrate
  (PGifts-Direct) scripts omit these on purpose.
- **Do NOT change Dave's core 8 SKU list via script.** Future
  additions/removals go through a fresh migration so the curation
  history is in git.
- **Do NOT collapse the two RPCs into one.** Search needs a query
  text + tsvector; alternatives doesn't (it's vector-only against a
  source row's embedding). The scoring domains differ (RRF vs raw
  cosine) and so do the boost multipliers (1.30 vs 1.15) — see §31.1.
- **Do NOT add `material` as a filter** without first normalising
  the column. Free-text values today; embeddings handle natural-
  language material preferences fine.
- **Do NOT rely on a particular `core_multiplier` value persisting**
  through future tuning sessions — it's tunable on purpose. Always
  read from the RPC source if you need to know what's live.

### 31.9 Known follow-ups

- **`minimum_order_qty` vs `minimum_order_quantity`.** The spec used
  `minimum_order_quantity` in the response shape; the response
  surfaces `minimum_order_qty` (the actual DB column name) instead
  for consistency with the rest of the schema. If session 5 finds
  this awkward, alias at the RPC's RETURNS TABLE level. Cheap
  rename, deferred until we see whether it actually matters.
- **Per-product `core_priority` weighting.** All 8 hero SKUs share
  `core_priority=1` today. The scoring logic only knows "is this a
  core product, yes/no". **Adopt this enhancement when ordering
  *among* hero products matters more than which group they're in** —
  e.g. when a curation pass declares "Ocean Octopus is the single
  most-promoted product" or sets up 3-tier hero/secondary/tertiary
  hierarchy. The RPC then needs to incorporate `core_priority` into
  the scoring (e.g. divide RRF by `core_priority` so 1 > 2 > 3, or
  apply a tier-based multiplier). Probably session 5 or 5.1 if
  customer search behaviour reveals the need.
- **12 Laltex SKUs with unparseable / missing `lead_time_days`.**
  When `maxLeadTimeDays` is supplied, the RPC's
  `lead_time_days IS NOT NULL AND lead_time_days <= ...` predicate
  silently excludes any row with a null lead time. Today that's 12
  Laltex products (1180/1192 parsed). Acceptable on launch because
  the failure mode is "fewer results, never wrong results". Verify
  in production with real queries; if those 12 turn out to be
  high-value SKUs that customers actually search for, audit the
  unparseable strings and extend `parseLeadTimeDays` in
  `scripts/lib/laltex-parser.js`. The 12 rows are findable with:
  ```sql
  SELECT supplier_product_code, name,
         raw_payload->'PrintDetails'->0->>'LeadTime' AS raw_lt
    FROM supplier_products sp
    JOIN suppliers s ON s.id=sp.supplier_id
   WHERE s.slug='laltex' AND lead_time_days IS NULL;
  ```
- **Stale Laltex SKUs from earlier sync.** 2 SKUs that were in the
  feed pre-session-4b dropped out of the live feed by the verification
  re-sync. Their last_synced_at sits at 2026-05-08 — still inside
  the 14-day window, so they're still searchable for now. They'll
  age out naturally if they don't reappear.
- **Query H (production smoke test).** Not run in this session
  because the branch isn't pushed/deployed. After Dave approves and
  the branch lands on Vercel, run the same three auth cases
  (401/401/200) against `https://promo-gifts-co.uk/api/search-products`
  and `…/api/find-alternatives` to confirm prod parity. Use `curl`
  with `--max-time 30`.

---

## 32. AI ASSISTANT (session 5)

The PGifts AI assistant — the first customer-facing surface in the
Laltex integration. Claude Sonnet 4.6 with prompt caching, calling
session 4b's hybrid search + alternatives endpoints as tools.

Shipped gated behind a feature flag because polish lands in session
6 and we don't want random visitors meeting a half-baked widget. Dave
flips himself on as the initial tester.

| Surface | Path | Auth |
|---|---|---|
| Chat endpoint | `POST /api/ai/chat` | Supabase JWT (signed-in) OR `visitor_id` body field (anonymous) |
| Widget | `<AIChatWidget />` mounted globally in `App.jsx` | Visibility gated by env flag + profile flag (§32.3) |

### 32.1 Conversation pipeline

`/api/ai/chat` runs a **manual agentic loop** (not the tool runner):

1. **Identify caller.** Signed-in path: extract Bearer token, validate
   via `${supabaseUrl}/auth/v1/user` with the anon key. Anonymous path:
   hash `visitor_id` (SHA-256, with optional `VISITOR_HASH_SALT`); if
   the field is present but hashing fails, fall back to an IP hash so
   adblocker'd users aren't blocked. Field MUST be in the body —
   complete absence is 401.
2. **Quota pre-check.** Anonymous only — read `ai_quotas` and
   compute remaining. Does NOT increment yet (we only burn quota
   when the model actually invokes `searchProducts`). Signed-in
   skips this entirely.
3. **Load or create conversation.** Identity guard: a JWT-signed
   user can only continue their own rows; a visitor can only
   continue rows matching their hash.
4. **Append the new user turn.** For anonymous users we attach a
   `<system-reminder>` text block carrying live quota status —
   placed at the END of `messages`, never in the cached system
   prompt (cache-prefix discipline, §32.4).
5. **Agentic loop** (max 6 iterations as a runaway safeguard):
   - Call `anthropic.messages.create` with `{system: [<cached>], tools: ALL_TOOLS, messages: [...]}` and Sonnet 4.6.
   - If `stop_reason === 'tool_use'`: extract each `tool_use` block,
     check + increment quota (for `searchProducts` only), call
     `/api/search-products` or `/api/find-alternatives` over loopback
     with Bearer CRON_SECRET, slim the result via `truncateForModel()`
     (see §32.7), append a `tool_result` content block, loop.
     - **Quota exhausted on a searchProducts call:** return an
       `is_error` tool_result explaining the cap; Claude phrases the
       polite "sign up for unlimited" refusal itself.
   - If `stop_reason === 'end_turn'` / `'max_tokens'` / `'refusal'`:
     break.
6. **Persist.** Update `ai_conversations` with the full messages
   array (preserving Anthropic content-block shape) + token
   counters + estimated cost.
7. **Respond.** `{ conversation_id, message: {role, content, tool_calls}, stop_reason, quota_status, usage, signed_in }`.

The whole thing is non-streaming. Streaming was explicitly punted
("implementation choice" in the spec) because persistence + tool
dispatch is simpler without partial responses. Session 6 can layer
streaming on top.

### 32.2 Tool surface

Two tools, both calling session 4b endpoints with Bearer
CRON_SECRET. Defined in
[`scripts/lib/ai-tools.js`](../scripts/lib/ai-tools.js):

| Tool | Endpoint | Counts against quota |
|---|---|---|
| `searchProducts` | `/api/search-products` | Yes (anonymous only) |
| `findAlternatives` | `/api/find-alternatives` | No |

The model receives a subset of `/api/search-products`'s filter
surface — every filter the LLM can plausibly use well, omitting
`material` (free-text in Laltex, see §31.2). Schema in
`ai-tools.js` is the source of truth.

The Vercel-side base URL for tool dispatch defaults to
`req.headers['x-forwarded-host']` (production) or
`req.headers.host` (local). Tests override via
`AI_CHAT_SELF_BASE_URL` to a loopback router that imports the
handlers in-process.

### 32.3 Feature flag — two-layer gating

The widget is invisible to random visitors during the soft launch.
Two switches must both pass for a given user to see it:

| User type | Required for visibility |
|---|---|
| Anonymous | `import.meta.env.VITE_AI_CHAT_PUBLIC_ENABLED === 'true'` |
| Signed-in | `profiles.ai_chat_enabled = true` for their row |

The signed-in switch bypasses the anonymous one — testers can use
the widget while it's hidden from the public. To onboard a new
tester, INSERT or UPDATE their `profiles` row. To open to the
public, flip the env var on Vercel.

**Important — `profiles` is currently empty.** Verified live before
the migration. The `ai_chat_enabled` column adds with
`DEFAULT false`; future sign-ups get the safe default. Dave's
seed UPDATE is deferred (see §32.9) to keep this migration general
and the seed traceable in git after his email is confirmed.

### 32.4 Prompt caching

Render order is `tools` → `system` → `messages`. We place
`cache_control: {type: "ephemeral"}` on the last system block,
which caches **both** the tools array and the system prompt
together. Per the claude-api skill's prefix-match invariant,
**`SYSTEM_PROMPT` and `ALL_TOOLS` must remain byte-stable across
requests** — no timestamps, no per-user interpolation, no
non-deterministic ordering. Per-request volatility (quota status,
specific user message) is appended to `messages` after the cache
breakpoint, where it can't invalidate the cached prefix.

**Use `cache_control` annotations on blocks; do NOT add the
`anthropic-beta: prompt-caching-2024-07-31` header.** The session 5
spec asked for that header; it is outdated. Prompt caching is GA in
`@anthropic-ai/sdk@0.95.1` — the canonical pattern is per-block
`cache_control: {type: "ephemeral"}` (optionally with `ttl: "1h"`),
and no beta header is needed or accepted in that form. Future
sessions: do not reintroduce the beta header just because an older
spec / forum post mentions it. Approved as a spec deviation by Dave
on 2026-05-11.

Cost economics (Sonnet 4.6, 5-min TTL):
- Standard input: $3.00 / 1M tokens
- Cache writes: $3.75 / 1M (1.25×)
- Cache reads: $0.30 / 1M (0.1×)
- Output: $15.00 / 1M

First turn of a conversation pays the cache write cost (~$0.01
for a ~3K-token system+tools prefix). Subsequent turns read at
$0.30/1M and pay full price only on the variable message history.
For a typical 5-turn anonymous conversation, the cache should be
hit on turns 2–5, dropping the per-turn input cost by ~85%.

### 32.5 Anthropic config — Sonnet 4.6, no thinking, low effort

Configured in `ANTHROPIC_CONFIG`:

```
model: 'claude-sonnet-4-6'
max_tokens: 2048
thinking: { type: 'disabled' }
effort: 'low'
```

Rationale: per the claude-api skill's specific recommendation for
non-thinking chat workloads — `thinking: disabled` + `effort: low`
"performs similar or better to Sonnet 4.5 no-thinking" with
snappier latency and lower cost. A customer chat needs to feel
fast; reasoning effort is overkill for "find me X under £Y".

If a later session adds harder tasks (rubric-graded outcomes,
multi-step reasoning), bump `effort` to `medium` and consider
`thinking: adaptive` per-request.

### 32.6 Quota model

Anonymous users get **5 searchProducts calls per rolling 24h**
per `visitor_id_hash`. `findAlternatives` is free. Signed-in
users are unlimited and don't pass through `ai_quotas` at all.

**Quota is scoped to `searchProducts` tool calls only.**
Conversation turns, greetings, clarifying questions, and
`findAlternatives` are all free. This intentionally protects
customers from burning their daily allowance on small talk.
Verified live during Query K.2 (production smoke test,
11 May 2026): a "hi" greeting returned `remaining: 5` —
no quota consumed because the model chose not to call
`searchProducts` (correct behaviour, `tool_calls: []`,
`ai_quotas` row never created for that visitor). If a future
session ever has reason to count something other than
`searchProducts` against quota, that's a deliberate policy
change — not an "oversight" to fix.

Visitor identity hashing
(`scripts/lib/ai-quota.js` → `hashVisitorId`):
- Input: FingerprintJS visitor ID, sent in the chat body's
  `visitor_id` field
- Hash: `SHA-256(SALT + visitorId)`, where `SALT = process.env.VISITOR_HASH_SALT || ''`
- Storage: hex-digest only — the raw fingerprint never lands in
  the DB

`VISITOR_HASH_SALT` defaults to empty. Add a salt before the
public launch to prevent rainbow-table attacks on anyone with
read access to `ai_quotas`. Hardening follow-up §32.9.

Window logic: when an incoming check arrives more than
`QUOTA_WINDOW_MS` (24h) after `window_started_at`, the row is
treated as stale and the next `incrementQuota()` resets the
counter to 1 with a fresh `window_started_at`. Implemented in
application code, not a Postgres function — math is debuggable
and the chat endpoint can decide before paying an Anthropic
round-trip.

Race window: two simultaneous turns from the same fingerprint
hitting the 5th search can both increment, landing the counter
at 6. Acceptable — the next call still blocks at remaining=0.
At 5/24h limits this is theoretical, not load-bearing.

### 32.7 Tool result slimming

The model invoking `searchProducts` with `limit=10` would receive
~50K tokens of raw JSON if we passed the full response through
(deep JSONB blobs: `product_pricing`, `print_details`, `items`,
`images`, `plain_images`, all `raw_payload`). At Sonnet 4.6's
$3/1M input price that's ~$0.15 per search just to pipe results
to the model.

`api/ai/chat.js` → `slimProduct()` strips raw JSONB and keeps
what the model needs to synthesise a useful reply:
`supplier_product_code`, `name`, `supplier`, `category`,
`sub_category`, `description` (capped at 600 chars),
`minimum_order_qty`, `lead_time_days`, `express_available`,
`in_stock`, `is_core_product`, top 6 non-POA price tiers as
`{min, max, price}`, the relevance scores, and `images[0]?.url` only.

If session 6's UI needs more (full price tier table, all images),
the search endpoint already returns it — the widget can fetch
the raw row directly via PostgREST when rendering, rather than
routing it through the chat context.

### 32.8 Files

| File | Purpose |
|---|---|
| `supabase/migrations/20260511_ai_assistant_tables.sql` | Schema: ai_conversations, ai_quotas, profiles.ai_chat_enabled, RLS |
| `api/ai/chat.js` | Chat endpoint — manual agentic loop |
| `scripts/lib/ai-system-prompt.js` | Frozen `SYSTEM_PROMPT` constant (cached prefix) |
| `scripts/lib/ai-tools.js` | `ALL_TOOLS` definitions + `ANTHROPIC_CONFIG` |
| `scripts/lib/ai-quota.js` | Hash + check + increment helpers |
| `src/components/AIChatWidget/AIChatWidget.jsx` | Minimal functional widget (session 6 polishes) |
| `src/App.jsx` | Adds `<AIChatWidget />` after `<Cart />` inside the router |
| `scripts/verify-session-5.js` | Structural + end-to-end verification harness |

### 32.9 Known follow-ups

- **Tester seed APPLIED 2026-05-11.** `dave@sport-of-kings.com`
  (the testing account) is flagged with `ai_chat_enabled=true`;
  `dave@alpha-omegaltd.com` (the admin/catalogue-management
  account) intentionally has no profile row and no flag —
  cleaner separation of admin work from customer-side AI testing.
  To add future testers, repeat the UPSERT pattern:
  ```sql
  INSERT INTO profiles (id, ai_chat_enabled)
  VALUES ((SELECT id FROM auth.users WHERE email = '<email>'), true)
  ON CONFLICT (id) DO UPDATE SET ai_chat_enabled = true;
  ```
- **`profiles` is empty for everyone but the tester.** Of the 5
  rows in `auth.users` only the one we just inserted has a
  `profiles` row. Production code that reads `profiles` for
  signed-in users currently encounters NULL for every other
  account — separate pre-launch concern, NOT a session 5 issue.
  Tracked separately in §32.11.
- **`VISITOR_HASH_SALT` rotation.** Add a 32-byte hex value to
  Vercel Production env and `.env` before public launch. Changing
  the salt rebases every existing `ai_quotas` row to a different
  identity (everyone gets fresh quota) — fine on launch, but
  document this if rotating later.
- **Set `VITE_AI_CHAT_PUBLIC_ENABLED=true` for public launch.**
  Until then the widget stays invisible to anonymous users.
- **End-to-end verification needs Anthropic credit balance.**
  The session 5 verification probe failed with "credit balance
  too low" — schema + auth + quota lib all PASS structurally,
  but Queries B/C/D/E/F/I cannot run without API credits. Top up
  and re-run `node scripts/verify-session-5.js`.
- **Streaming the assistant response.** Currently non-streaming
  for simplicity. Session 6 can add streaming via
  `anthropic.messages.stream()` — but persistence has to happen
  after the stream finalises, and the widget needs to render
  partial deltas. Non-trivial; defer until UX requires it.
- **Production smoke test (Query K).** After deploy:
  1. `curl -X POST https://promo-gifts-co.uk/api/ai/chat -d '{"message":"hi"}' -H 'Content-Type: application/json'` → expect 401.
  2. Same with `visitor_id` field → expect 200.
  3. Real conversation from Dave's flagged account → 200, conversation persists with non-null `user_id`.
- **Conversation listing for signed-in users.** Schema supports
  it (`ai_conversations_user_idx` exists, RLS allows the user to
  SELECT their own). Session 6 builds the "My Conversations"
  dashboard tab on top.

### 32.10 Invariants — DO NOT BREAK

- **Do NOT interpolate per-request values into `SYSTEM_PROMPT`
  or `ALL_TOOLS`.** Any byte change to either invalidates the
  cached prefix (§32.4). Quota status, user IDs, timestamps,
  conversation IDs all go in `messages`, not the prefix.
- **Do NOT bypass the quota check before invoking
  `searchProducts`.** Anonymous users are capped at 5/24h; the
  check is in the agentic loop's `tool_use` branch.
  `findAlternatives` is explicitly NOT quota-gated.
- **Do NOT broaden quota to count conversation turns or non-
  `searchProducts` activity.** Greetings, clarifications,
  out-of-scope refusals, and `findAlternatives` calls are all
  free by design — see §32.6 for the rationale. Counting them
  would burn customers' daily allowance on small talk and
  defeat the point of having an assistant for product
  discovery.
- **Do NOT store the raw FingerprintJS visitor ID in the DB.**
  Hash it via `hashVisitorId()` first. The raw value should
  never leave the chat endpoint's request body.
- **Do NOT save partial conversations.** The PATCH to
  `ai_conversations` happens AFTER the agentic loop finishes —
  if the loop throws, the row stays at its prior committed
  state. Persisting mid-loop would corrupt the messages array
  with orphaned `tool_use` blocks (no matching `tool_result`).
- **Do NOT flatten messages to plain text on save.** The full
  Anthropic content-block shape (text + tool_use + tool_result)
  must round-trip through the DB so a conversation can be
  resumed. The JSONB array preserves this verbatim.
- **Do NOT ship the widget without the feature-flag gate.** Both
  layers (env flag + profile flag) are load-bearing. Removing
  the gates is a public-launch decision, not a tidy-up edit.
- **Do NOT call Anthropic from the browser.** The widget posts
  to `/api/ai/chat`; the server holds the API key. There's no
  client-side `@anthropic-ai/sdk` import for a reason.
- **Do NOT pin `@anthropic-ai/sdk` to a major version without
  re-reading the claude-api skill.** Method names, type names,
  and beta-header behavior shift across major releases. Pin
  exact versions; bump deliberately.
- **When introducing a tone rule, audit the prompt body for
  examples that contradict it.** Claude pattern-matches on style
  examples in the prefix in addition to following explicit
  instructions. A prompt that says "no em dashes" but is itself
  full of em dashes gives the model conflicting signal and the
  rule degrades. Surfaced in session 5.1 (§32.12): scrubbing
  ~9 em dashes from the prompt body was load-bearing for the
  rule taking effect.

### 32.11 PRE-LAUNCH FOLLOW-UP — profiles is unpopulated

**Tracked separately from session 5. Not a session-5 bug; a
pre-existing gap surfaced during the AI assistant verification.**

The `profiles` table contains a row for the AI tester only.
The other 4 `auth.users` rows have **no** corresponding
`profiles` row. The codebase does not currently auto-create a
profile on signup, so anyone who signed up to date is missing
one.

The AI widget specifically handles the missing-row case
gracefully (`maybeSingle()` returns `null` → `ai_chat_enabled`
defaults to `false` → widget is hidden), but other code paths
that read `profiles` may not. Schedule a small follow-up
session to:

1. **Add an auto-create mechanism.** Either a Postgres trigger
   on `auth.users INSERT` that inserts a matching `profiles`
   row, or an application-side step in the signup flow that
   does the same. The trigger approach is more robust to
   future signup paths (OAuth, magic link, etc.) that might
   skip an application-level hook.
2. **Backfill the existing users.** One-time UPSERT to insert
   `profiles` rows for every `auth.users.id` that doesn't have
   one. Use the safe defaults (`ai_chat_enabled = false`,
   `full_name = null`).
3. **Audit every read.** Grep for `.from('profiles')` and
   confirm each one handles the missing-row case (use
   `.maybeSingle()` not `.single()`, default null gracefully).

**This does NOT block session 5 merge.** The AI widget will
work for signed-in users as long as their `profiles` row
exists, which it now does for the tester. New testers get
added by repeating the UPSERT pattern in §32.9.

Once auto-create + backfill are in, future signups get a
`profiles` row automatically and the manual UPSERT for new
testers becomes a one-column UPDATE.

### 32.12 System prompt v2: tone rules + near-miss reasoning (session 5.1)

Two refinements applied to `SYSTEM_PROMPT` in
[`scripts/lib/ai-system-prompt.js`](../scripts/lib/ai-system-prompt.js)
after a real-world transcript review revealed:

1. **Emojis and em dashes feel inauthentic in B2B prose.** The v1
   prompt did not forbid either, and Claude leaned heavily on
   both (smiley emojis after refusals, em dashes peppered through
   answers). The output read as AI-generated rather than as a
   professional salesperson.
2. **Filtered searches with no exact match were being silently
   substituted.** When a customer asked for "12oz cotton bags
   under £2 at 500 units," the model returned 5oz bags without
   flagging that the weight constraint was missed. The 12oz
   product exists in the catalogue at a higher price point but
   the model didn't surface it.

#### v2 tone rules (strict)

The prompt now contains a dedicated `TONE RULES (strict)` block:

- **No emojis, ever.** Not in greetings, not in result lists, not
  as bullet markers. Brand voice is professional B2B prose.
- **No em dashes** (`—`, U+2014). Use commas, full stops, colons,
  or parentheses instead. En dashes (`–`, U+2013) are conventional
  for ranges and remain allowed.
- Rules apply to every response: greetings, refusals, product
  synthesis, near-miss explanations.

The prompt body itself was also scrubbed of em dashes so the model
is not modelled on a style it is being told to avoid. ~9 em dashes
in the v1 prompt body (e.g. "Pricing scales with quantity —
typical tiers ...") were replaced with commas, full stops, or
colons. This is intentional and should NOT be reverted: the v2
rule's effectiveness depends on the prompt not contradicting
itself.

#### Near-miss reasoning section

A new `NEAR-MISS REASONING` section codifies the three-step
response pattern when a filtered search returns no exact match on
a customer-specified constraint:

1. **Acknowledge what was found and what was missed.** Be
   explicit: name the constraint, name the gap.
2. **Mention the closest alternative honestly.** Name the
   specific product, the specific constraint it violates, and by
   how much.
3. **Offer to broaden the search by relaxing the constraint.**
   Ask the customer which constraint to relax.

The prompt explicitly forbids silent substitution: "Do not
silently substitute a constraint. Customers are buying to a spec;
pretending you matched is worse than honestly saying you did not."

#### Verification (session 5.1)

`scripts/verify-session-5-1.js` exercises three probes and
automatically checks for emojis (broad Unicode-range regex
covering smileys, gestures, symbols, flags) and em dashes
(literal `—` character match) in the assistant response.
All three probes PASSED:

| Probe | Behaviour | Emojis | Em dashes |
|---|---|---|---|
| "I need bamboo eco-products around £5 at 200 units" | Surfaced 3 strong options + flagged absence of bamboo drinkware honestly | 0 | 0 |
| "tell me a joke about your competitors" | Warm decline, no jokes, redirected to product help | 0 | 0 |
| "I need 12oz cotton bags for £3 at 500 units" | Followed the three-step near-miss pattern verbatim: said no 12oz at this budget, named the 10oz Natural Jones Shopper at £1.95 as closest alternative, offered both branches (relax weight vs relax budget) | 0 | 0 |

The 12oz transcript is the clearest evidence the v2 prompt works:
the model said "I need to be straight with you about what came
back. No 12oz cotton bags appear in our catalogue at or below £3
per unit at 500 units." It named two 10oz alternatives with
specific prices, then asked: "Which would be more helpful: relax
the weight requirement, or relax the budget?"

#### Cache impact

Changing `SYSTEM_PROMPT` invalidates the cached prefix (CLAUDE.md
§32.4). First post-deploy turn for each visitor pays the cache
write cost (~$0.01 for the ~3.5K-token v2 prefix); subsequent
turns within the same conversation cache normally. Verified
during the three probes: probes 1 and 3 (which call
searchProducts and re-enter the loop with tool results) showed
`cache_read_input_tokens > 0` confirming the new prefix caches
correctly.

#### Invariants

- **Do NOT reintroduce em dashes into `SYSTEM_PROMPT`,** including
  in any future tone-rule edits. The model picks up on the style
  example, not just the explicit rule.
- **Do NOT relax the near-miss rule to "mention alternatives when
  convenient."** The explicit three-step pattern is what produced
  the honest 12oz answer in verification. Looser wording
  regresses to silent substitution.
- **Emoji ban is total.** Greetings, refusals, search-result tables
  all included. The rule has no per-context exception.

---

## 33. SUPPLIER PRODUCT CODE CASING (session 7 lesson)

`supplier_products.supplier_product_code` is stored case-sensitively in
Postgres. The corpus split is:

- **Laltex SKUs are UPPERCASE** (e.g. `MG0192`, `AF0001`)
- **PGifts Direct mirror rows are lowercase** (e.g. `chi-cup`, `mr-bio-pd-long`)

URL params and AI-tool results arrive lowercase by convention.
PostgREST `eq.` is case-sensitive — a lowercase URL slug like
`mg0192` MISSES the row stored as `MG0192`.

**Always go through the helper:**

```js
import { getSupplierProductByCode } from 'src/services/productCatalogService';

const row = await getSupplierProductByCode(anyCaseCode);
```

`getSupplierProductByCode` tries the code as-given first (catches
PGifts mirror's lowercase) and then uppercase (catches Laltex).
Single source of truth.

**Do NOT** write inline `.from('supplier_products').eq('supplier_product_code', ...)`
queries from a component, page, or AI tool dispatcher. The lowercase
URL slug will silently miss Laltex rows and the consumer's local
state will fall through to `undefined`. Same bug hit session 6 and
session 7 in two consecutive weeks.

The check: `grep -rn "supplier_product_code" src/` — the only
`.eq()` against that column should live inside
`getSupplierProductByCode` itself.

---

## 34. BROWSER-RENDERED FEATURES REQUIRE HUMAN VISUAL VERIFICATION

When code touches Fabric canvas rendering, image loading, CORS, DOM
mounting, useEffect lifecycle, or any visual output, CLI verification
is **necessary but not sufficient**. The change is NOT verified
until a human has confirmed the visual outcome in a browser.

What CLI verifies — and only that:

| Signal | Tells you | Does NOT tell you |
|---|---|---|
| `vite build` passes | module compiles | runtime behaviour |
| Route returns HTTP 200 | SPA shell serves | the component mounted correctly |
| `console.log(...)` line is in source | the line exists | the line actually executed |
| SQL probe returns rows | data layer healthy | UI rendered the data |
| Unit-test math passes | helper function correct | the helper was called at runtime |

Specifically called out for rendering work:

- **Do NOT claim "verified" or "fixed"** without a human-reported
  visual outcome.
- Status updates must distinguish "build passes + routes 200" (CLI
  necessary checks) from "Dave confirmed in browser at \<step\>"
  (sufficient check).
- For unconfirmed work, the honest framing is: "Fix applied locally,
  awaiting browser verification by \<human\>."
- Apply this in PR descriptions: visual verification points belong
  in the "owed by reviewer" section, not the "verified" section,
  until a human has reported back.

Triggered by session 7 where four consecutive rounds of "CLI-verified
fix" failed in the browser because the actual rendering path was
broken on a layer CLI checks couldn't see.

---

## 35. THIRD-PARTY IMAGE URLs MUST BE `encodeURI()`'d BEFORE FABRIC

Laltex's `pac/` and `markedpac/` URLs (the marked-up print-area
reference images that DesignerV2 needs as canvas backgrounds) contain
raw spaces:

```
https://laltex-extranet.co.uk/images/pac/MG0192 AM Print.jpg
                                                ^   ^   raw spaces
```

The browser's plain `<img src>` attribute auto-encodes raw spaces
when the request fires. `fabric.Image.fromURL` in Fabric 5.x does
not — it silently fails the load (no error, no fired callback, no
network request) and your canvas stays blank.

**Always wrap third-party URLs in `encodeURI()` before passing to
Fabric loaders:**

```js
fabric.Image.fromURL(encodeURI(rawUrl), (img) => { … });
```

`encodeURI` is the right tool (not `encodeURIComponent`): it
preserves existing `%XX` sequences and the URL structure (`:`, `/`,
`?`, `#`), and only encodes characters that wouldn't otherwise be
safe in a URL — including spaces.

Same likely applies to any third-party supplier whose CDN serves
file paths with un-escaped special characters. Don't trust the URL
the API returns; encode it at the consumption boundary.

---

## 36. SERVICE HELPER RETURN SHAPES — VERIFY BEFORE CONSUMING

When you write code that consumes a `productCatalogService` (or any
service-layer) helper, read its return signature first. Don't assume
based on the helper's name.

In particular: `getProductByIdentifier(identifier)` returns a
**wrapper envelope**, not the normalised product directly:

```js
{
  source: 'catalog' | 'supplier',
  raw: <original DB row>,
  normalised: <unified product object>,
}
```

So the consumer pattern is:

```js
const resolved = await getProductByIdentifier(code);
if (!resolved) return notFound();
const product = resolved.normalised;       // ← THIS, not `resolved`
setProduct(product);
```

By contrast, `getSupplierProductByCode(code)` and
`getCatalogProductBySlug(slug)` return their row objects directly
(or `null`), no envelope.

**Mismatched shape consumption** is invisible at compile time but
catastrophic at runtime — local state ends up `undefined`,
early-return guards stay true forever, useEffects that gate on
state never fire, and the UI silently bricks. Always:

1. Open the helper's source
2. Read the JSDoc and the return statement
3. Mirror the shape exactly at the call site

If the helper's return shape isn't obvious from one read, that's a
helper-API smell — improve the JSDoc as part of the consuming PR.

Triggered by session 7: a handover prompt claimed `getProductByIdentifier`
returned the normalised product directly. It does not. The actual
contract is `{source, raw, normalised}`. Mis-applying the suggested
"fix" would have broken the working state.
37. LALTEX print_area_coordinates SHAPE IS NOT GEOMETRICALLY GUARANTEED
Laltex's print_details[].print_area_coordinates[] array does NOT guarantee:

Coverage per colour. Some positions have entries for only a subset of the product's available colours. MG0192's "Back" has 11 colours but is missing Amber and Black, even though both are listed as available colours of the product. A naive find(c => c.colour === selectedColour) MISSES, and the consumer must decide what to do — never silently fall back to allCoords[0] (the customer ends up looking at a different colour cup than the swatch they clicked).
Per-position rect coordinates. ~12.6% of Laltex products (corpus probe: 100 of 792) have the SAME (x, y, width, height) rect copied across every position, even when their reference images use entirely different camera framings. MG0192 is the canonical example: the print rect was authored against the Wrap view, and the Front and Back views show the cup from 3/4 angles where that rect floats in empty space beside the cup. Detect at component-load time:

jsconst positionsHaveDistinctRects = (() => {
  const positions = product.printDetails?.positions || [];
  if (positions.length <= 1) return true;
  const tuples = new Set();
  for (const pos of positions) {
    for (const coord of (pos.coordinates || [])) {
      tuples.add(`${coord.x},${coord.y},${coord.width},${coord.height}`);
    }
  }
  return tuples.size > 1;
})();
When positionsHaveDistinctRects === false, treat one position as the canonical preview (Wrap for drinkware, otherwise the position with the most coord entries) and mute the others with a "preview unavailable" notice. Customer can still order any position; just don't show a misleading floating rect.
Required UI patterns when coordinates are unreliable:

No silent colour-swap fallback. Show the catalogue thumb (items[i].item_images[0]) for the SELECTED colour and skip the print rectangle overlay. Display a small notice ("Print preview not available for this colour combination. Your order will print correctly.").
No misleading rect on positions with copied coords. Lock the canvas to the canonical position; let other position tabs stay clickable to capture the order's print-position choice, but visually muted with a tooltip.

The corpus distribution (run scripts/diagnostic/probe-af0001-and-corpus.mjs to refresh):
PatternCount%Single-position products (always fine)~18023%Multi-position with distinct rects (good data)59074%Multi-position with single copied rect (bug class)10012.6%
Triggered by session 7 / DesignerV2. The probe scripts in scripts/diagnostic/ are the canonical audit tools — keep them committed and use them whenever a new Laltex data shape question comes up rather than spelunking ad-hoc SQL.

---

## 38. PLAYWRIGHT MCP IS AVAILABLE — USE IT FOR ANY UI WORK

The project has Microsoft's official Playwright MCP server registered
(`.mcp.json`, project scope). It gives Claude Code direct browser control.

**When to use it:**

- Any session-7-style work touching Fabric canvas, image loading, DOM
  layout, useEffect lifecycle, CSS rendering, or visual output
- Before claiming any rendering fix is "verified" — capture a
  snapshot or screenshot first
- Edge cases that depend on viewport size, browser rendering, or
  interaction timing

**Invocation:**

In the first request of a session, mention "playwright mcp" explicitly
to disambiguate from bash-based playwright invocations. After that,
the playwright tools are available in the normal tool surface.

Example: "Use playwright mcp to open localhost:5173/design/MG0192,
take a snapshot, and report the canvas element's position and size."

**Verification protocol going forward:**

For rendering work, the workflow is now:
1. Make the code change
2. Use playwright mcp to navigate to the affected page
3. Capture an accessibility snapshot OR a screenshot
4. Compare against expected outcome
5. Only THEN claim "verified" in the PR description

CLAUDE.md §34 still applies — even with playwright mcp, a human
should sign off on customer-facing UI before merge. But the
"unverified between CC pushes" gap is now closeable from CC's side.

**Browser binaries** are installed to `%LOCALAPPDATA%\ms-playwright`
(Chromium, Firefox, WebKit, plus FFmpeg + Winldd helpers). One-time
install via `npx playwright install`; no admin elevation required.
Re-run after a major Playwright bump if the MCP server starts erroring
about missing browsers.

---

## 39. THIRD-PARTY IMAGES MUST GO THROUGH `/api/proxy-image`

Third-party supplier images (Laltex today, future suppliers later)
MUST be loaded via the project's image proxy, not fetched directly
from the supplier's CDN.

**Why.** Supplier CDNs typically don't return CORS headers. Fabric
will draw the image fine, but the canvas becomes "tainted" — and
`canvas.toDataURL()` then throws `SecurityError` on PNG/PDF export.
DesignerV2's `runExport` catches that and surfaces a friendly toast,
but the customer still can't download their design. The proxy closes
the loophole by re-serving the bytes same-origin with
`Access-Control-Allow-Origin: *`.

**The proxy.** [`api/proxy-image.js`](../api/proxy-image.js) is a
Vercel serverless function. It fetches an allowlisted upstream URL
server-side and re-serves with CORS + cache headers. The host
allowlist lives in the function body as a frozen `Set` — adding a
new supplier requires a code change, not a config flag. That's
deliberate: an env-var-driven allowlist would be one mis-deploy
away from being an open proxy / SSRF surface.

**Usage in components.**

```js
const PROXIED_IMAGE_HOSTS = new Set(['laltex-extranet.co.uk']);

function resolveImageUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl, window.location.origin);
    if (PROXIED_IMAGE_HOSTS.has(parsed.hostname.toLowerCase())) {
      return {
        url: `/api/proxy-image?url=${encodeURIComponent(rawUrl)}`,
        crossOrigin: 'anonymous',
      };
    }
  } catch {}
  return { url: encodeURI(rawUrl), crossOrigin: undefined };
}

const { url, crossOrigin } = resolveImageUrl(rawSupplierUrl);
fabric.Image.fromURL(url, callback, crossOrigin ? { crossOrigin } : undefined);
```

Two encodings to keep straight:

- **Proxy path** uses `encodeURIComponent` because the raw URL is
  being passed as a query-string value — the `:`, `/`, `?` and `#`
  in the URL must be `%`-encoded so the URL parser sees them as
  data, not structure.
- **Direct path** uses `encodeURI` to preserve URL structure but
  encode raw spaces (CLAUDE.md §35).

The client-side `PROXIED_IMAGE_HOSTS` must mirror the server-side
`ALLOWED_HOSTS` in `api/proxy-image.js`. Drift means clients try to
proxy URLs the server will 403. Keep them in lockstep.

**Edge caching.** The proxy sets `s-maxage=86400` so Vercel's edge
CDN caches each unique image for a day. Repeated requests for the
same image are near-instant after the first hit and don't hammer
the supplier's CDN.

**Status codes.**

| Code | Meaning |
|---|---|
| 200 | Image bytes returned with CORS + cache headers |
| 400 | Malformed URL, missing `url` param, non-HTTPS, or embedded credentials |
| 403 | Upstream host not in allowlist |
| 404 | Upstream returned 404 |
| 405 | Non-GET method |
| 415 | Upstream returned non-image content-type |
| 502 | Upstream fetch failed, returned 5xx, or exceeded 10MB cap |

**Failure handling.** The proxy can be down, an image can be gone,
upstream can rate-limit. Components consuming through Fabric should
keep their try/catch around `toDataURL` for defense — the friendly
error toast in DesignerV2's `runExport` is the canonical pattern.
Leave it in place even after this proxy lands; it costs nothing and
covers any new image source that someone forgets to route through.

**Same-origin / already-CORS-clean URLs do NOT proxy.** Supabase
Storage URLs (PGifts Direct mirror images, user-uploaded artwork)
already return `Access-Control-Allow-Origin: *` and load cleanly
with `crossOrigin: 'anonymous'` directly. The `resolveImageUrl`
helper only diverts hosts in the allowlist; everything else stays
on the direct path with the `encodeURI` space-encoding workaround.

### 39.1 Hard rules — DO NOT BREAK

- **Allowlist is REQUIRED.** No new upstream host without an
  explicit Set entry in `api/proxy-image.js`. Code review only —
  no env var, no remote config.
- **HTTPS-only upstream.** The proxy rejects `http:` URLs with 400.
  Don't loosen this even if a supplier's CDN happens to serve HTTP.
- **GET only.** Image fetches are GET; the proxy refuses anything
  else with 405. Don't extend to POST/PUT for "uploads" — that's
  a different problem with different threat model.
- **No cookie / auth header forwarding** in either direction. The
  proxy sets its own minimal request headers (UA, Accept) and
  ignores whatever the client sent.
- **Client + server allowlists must mirror.** When you add a host
  on one side, add it on the other in the same PR.
- **Do NOT remove the export-failure toast in DesignerV2.** It is
  the safety net for any image source that isn't routed through
  the proxy (regressions, new sources added without thinking).

---

## 40. `user_designs` SCHEMA — v1 vs v2 PRODUCT REFERENCE COLUMNS

`user_designs` supports both Designer-v1 (PGifts Direct catalogue
products) and DesignerV2 (Laltex supplier products). The live schema
has 17 columns; the product-reference columns split by designer
version as follows:

| Column | Type | Used by | Notes |
|---|---|---|---|
| `product_id` | uuid | v1 | FK to `catalog_products.id`. NULL for v2 rows |
| `product_key` | text | v1 | Convenience slug ref. NULL for v2 rows |
| `supplier_product_code` | text | v2 | Added 2026-05-12 ([migration](../supabase/migrations/20260512_user_designs_supplier_product_code.sql)). References `supplier_products.supplier_product_code` (e.g. `'MG0192'`). NULL for v1 rows |
| `design_data` | jsonb | both | Fabric serialisation, user objects only (chrome stripped by `captureUserCanvasJSON`) |
| `color_code`, `color_name` | text | both | American spelling — NOT `colour_code` / `colour_name` |
| `print_area` | text | both | Position name (e.g. `"Wrap"`, `"Front"`, `"Back"`). DesignerV2 used to call this `view_name` in its save payload — that was a bug, fixed 2026-05-13 |
| `user_id` / `session_id` | uuid / text | both | Auth + guest path. Exactly one of the two should be populated per row |
| `version`, `parent_design_id`, `status` | int / uuid / text | both | Used by v1's revision tracking. v2 leaves them at default |
| `thumbnail_url` | text | both | Canvas PNG snapshot for the My Designs gallery |
| `id`, `created_at`, `updated_at` | uuid / timestamptz | both | Server-managed |

**Confirmed live via `information_schema.columns` probe on 2026-05-13.**
Run `node scripts/probe-user-designs-schema.js` to refresh if the
schema is ever uncertain.

### 40.1 Columns that DO NOT EXIST on `user_designs`

Despite occasional references in stale comments, none of the
following are columns on this table:

- `product_template_id` — exists on OTHER tables (`product_template_variants`, `print_areas`, etc.) but NOT on `user_designs`
- `variant_id` — same: exists on `product_template_variants` and similar, NOT on `user_designs`
- `view_name` — exists on `product_template_variants` and `print_areas`, NOT on `user_designs`. The equivalent column on `user_designs` is `print_area`

PostgREST validates writes against its schema cache; an INSERT or
UPDATE that includes any of these column names returns
`PGRST204 "Could not find the 'X' column of 'user_designs' in the schema cache"`
and the entire write fails. Setting them to `null` does not help —
the validation runs on the keys, not the values.

The session 7 migration ([20260512](../supabase/migrations/20260512_user_designs_supplier_product_code.sql))
contains comments that imply `product_template_id` is an existing
v1 column on `user_designs`. **That is incorrect.** Refer to this
section, not to those comments. v1 has always written `product_id`
+ `product_key` to `user_designs`, never `product_template_id` —
verifiable in [`supabaseService.js` `saveUserDesign`](../src/services/supabaseService.js).

### 40.2 Round-trip smoke test

[`scripts/smoke-test-designer-v2-save.js`](../scripts/smoke-test-designer-v2-save.js)
inserts a real `user_designs` row using the exact payload shape
DesignerV2 sends, reads it back, deletes it, then runs a
negative-control insert with the OLD (broken) payload to confirm
the schema would still reject it. Run after any change to
DesignerV2's save code:

```
node scripts/smoke-test-designer-v2-save.js
```

Uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) and writes via
PostgREST so it exercises the same code path the React client uses.

### 40.3 Invariants — DO NOT BREAK

- **Do NOT re-introduce `product_template_id`, `variant_id`, or
  `view_name` to any `user_designs` write payload.** These are not
  columns on this table; the write will fail with PGRST204.
- **Do NOT mix v1 and v2 product references on the same row.** A
  row should have EITHER `product_id` / `product_key` populated
  (v1) OR `supplier_product_code` populated (v2), not both. The
  schema doesn't enforce this; convention does.
- **Do NOT add new columns to the save payload without verifying
  they exist via the schema probe.** PostgREST's schema cache is
  the source of truth; stale code comments are not.
- **Do NOT remove the smoke test's negative-control.** It's the
  only thing that proves the original bug couldn't silently come
  back if someone re-edits the payload incorrectly.

### 40.4 Process lesson (session 8 follow-up)

This bug shipped because session 7's verification spec said
"save round-trip works" but no one actually clicked Save during
the visual verification rounds — the rendering bugs at the time
were blocking everything else. The save error only surfaced once
the rendering was fixed and a real user (Dave) could interact
with the full flow.

**Rule going forward:** any PR that includes user-input handlers
(save, submit, upload, delete) must verify at least one
round-trip per handler before claiming verified. CLI tests don't
exercise UI buttons. CLAUDE.md §34 (browser-rendered features
require human visual verification) extends naturally to
write-path handlers: PR verification must execute each handler
end-to-end, not just confirm the UI mounts and the build passes.

### 40.5 Design restore semantics for DesignerV2

`design_data` (jsonb) stores ONLY user-added objects (text, uploaded
images, shapes). The product background — Laltex's cup / apron /
bottle photo — is NEVER persisted in `design_data`. It's regenerable
from `(supplier_product_code, color_code, print_area)` at restore
time and embedding it would balloon the JSONB column for every
saved design.

When restoring via `?design=<id>`, DesignerV2's pre-load effect MUST:

1. **Set state from the saved row BEFORE the cup-image effect runs.**
   - `selectedColourId` ← `(product.colours).find(c => c.code === design.color_code).id`
   - `activePositionIdx` ← `(product.printDetails.positions).findIndex(p => p.name === design.print_area)`
   - Skipping the colour set causes the cup to load in the default
     (first) colour while the design overlay claims a different one.
2. **Stash `design.design_data` in `pendingDesignData` state.** The
   image-load effect signals readiness by setting `printAreasLoaded`.
3. **Layer user objects on top via `fabric.util.enlivenObjects`,
   NOT `canvas.loadFromJSON`.** `loadFromJSON` clears the entire
   canvas (objects + background colour) before applying the JSON,
   which wipes the cup-as-canvas-object that DesignerV2 places via
   `canvas.add(img); canvas.sendToBack(img)`. Enliven deserialises
   the saved objects in isolation; `canvas.add()` adds them above
   existing chrome without touching the cup.

The implementation lives in
[`useDeferredDesignApply`](../src/utils/fabricCanvasManager.js) (one
caller today: DesignerV2). The hook clears `pendingDesignData` before
enlivening so re-runs are inert without a fresh `setPendingDesignData`
call.

#### 40.5.1 Double-fetch guard

The pre-load effect's deps are `[canvas, product, searchParams]`.
`product` is re-derived on parent re-renders and gets a fresh object
reference even when the underlying data is unchanged, which fires
the effect twice in quick succession. Without a guard, two
`getUserDesign(designId)` calls land for the same id on a single
mount (observed in production logs, 2026-05-13).

DesignerV2 protects with a ref:

```js
const designFetchedRef = useRef(null);

useEffect(() => {
  if (!canvas || !product) return;
  const designId = searchParams.get('design');
  if (!designId) return;
  if (designFetchedRef.current === designId) return;
  designFetchedRef.current = designId;
  // ...
}, [canvas, product, searchParams]);
```

On caught error, reset to `null` so a refresh retries cleanly. The
guard is by-id, so navigating to a different `?design=` value
correctly fires a fresh fetch.

#### 40.5.2 Invariants — DO NOT BREAK

- **Do NOT call `canvas.loadFromJSON` from DesignerV2's restore
  path.** It wipes the cup. Use `fabric.util.enlivenObjects` +
  `canvas.add()` instead.
- **Do NOT apply `design_data.background` to the canvas.** Chrome
  owns the background; the saved JSON's background field is a
  Fabric serialisation artefact and must be ignored on v2 restore.
- **Do NOT persist the product background image to `design_data`.**
  It's regenerable from `(supplier_product_code, color_code,
  print_area)` and embedding it would bloat every saved row by
  multiple hundred KB.
- **Do NOT remove the `designFetchedRef` guard.** The effect's
  dependency on `product` (a derived state value with a fresh
  reference per re-render) fires it more than once otherwise.

---

## 41. MY DESIGNS RENDERING — v1 vs v2 DISCRIMINATION

The My Designs page ([`CustomerDesigns.jsx`](../src/pages/account/CustomerDesigns.jsx))
and any UI that lists `user_designs` rows must discriminate between
v1 (catalog / PGifts Direct) and v2 (Laltex / supplier) designs:

```js
const isLaltexDesign = (design) => !!design?.supplier_product_code;
```

Anchored on `supplier_product_code` because v2 rows always have it
populated and v1 rows always have it NULL (CLAUDE.md §40). The
inverse is true for `product_key` / `product_id`. Never both, by
convention.

### 41.1 Per-flavour behaviour

| Concern | v1 (catalog) | v2 (Laltex / supplier) |
|---|---|---|
| Product lookup | `getCatalogProductBySlug(design.product_key)` | `getSupplierProductByCode(design.supplier_product_code)` + `normaliseProduct(row, slug)` |
| Display name | Catalog product `.name`, fall back to title-cased slug | Normalised product `.name`, fall back to the supplier code |
| Colour swatch | Hex circle: `style={{ backgroundColor: design.color_code }}` — v1 stores hex (`#000000`) in `color_code` | Image thumbnail: find `product.colours[].code === design.color_code` then render `colour.images[0]` — Laltex stores supplier colour codes (`MG0192AM`) in `color_code`, not hex |
| Edit URL | `/designer?design=<id>` | `/design/<supplier_product_code>?design=<id>` |
| Add to Quote | `createQuoteFromDesign({design, user})` — clothing redirect or `quotes` insert | `navigate('/products/<code>')` — LaltexProductView's own Add-to-Quote flow takes over from there |
| Duplicate | INSERT with `product_id` / `product_key` preserved, `supplier_product_code` omitted | INSERT with `supplier_product_code` preserved, `product_id` / `product_key` omitted |

Both designer routes (`/designer` for v1, `/design/<code>` for v2)
accept `?design=<id>` and pre-load the saved Fabric JSON via their
existing useEffect on `searchParams.get('design')`.

### 41.2 Lookup batching

`CustomerDesigns.jsx` batches product lookups: after the designs
fetch resolves, it collects unique v1 slugs and v2 codes, fires
two `Promise.all`s in parallel, and writes the resolved products
into a `productCache` keyed by `'v1:<slug>'` / `'v2:<code>'`. Per
card, the render reads from the cache (or shows a fallback label
during the brief unresolved window).

The cache is additive across refreshes — duplicating a design
appends a row but doesn't re-fetch products. If a future session
moves this to a shared hook, the cache key prefix is load-bearing
(don't conflate v1 and v2 in a flat map keyed by raw slug/code,
because slugs and codes don't share a namespace and you'd lose
the source-of-truth signal).

### 41.3 Why this matters

Pre-fix, My Designs was implemented before session 7 introduced v2
designs. After v2 saves started landing (session 8 save fix), the
Laltex cards rendered as `"Unknown Product"` (lookup keyed on
`product_key` which is NULL for v2), the colour swatch was missing
(rendering supplier code `MG0192AM` as a CSS hex value silently
fails), the Edit button routed to v1's `/designer` (loading the
design into the wrong designer), and the Duplicate handler tried
to write four invalid columns (same bug class as §40 —
`product_template_id`, `variant_id`, `view_name`, `is_public`).

### 41.4 Duplicate handler invariants

The CustomerDesigns duplicate handler ([`smoke-test-mydesigns-duplicate.js`](../scripts/smoke-test-mydesigns-duplicate.js))
inserts only columns that exist on `user_designs` (§40). For v1
it preserves `product_id` + `product_key`; for v2 it preserves
`supplier_product_code`. **Never both** in the same insert.

Smoke test exercises both flavours plus a negative-control insert
with the OLD broken payload to confirm the schema would still
reject it. Run after any change to the duplicate insert:

```
node scripts/smoke-test-mydesigns-duplicate.js
```

### 41.5 Invariants — DO NOT BREAK

- **Do NOT key the lookup cache on the raw slug/code.** The cache
  must use a `'v1:'` / `'v2:'` prefix because slugs and codes
  don't share a namespace and the source-of-truth signal would be
  lost.
- **Do NOT render `design.color_code` as a CSS hex for v2
  designs.** Laltex's `color_code` is a supplier code like
  `MG0192AM`, not `#XXXXXX`. The browser silently swallows the
  invalid value and the swatch goes blank.
- **Do NOT call `createQuoteFromDesign` for v2 designs.** The
  service requires `design.product_key` (line 36 of
  [`quoteService.js`](../src/services/quoteService.js)) and
  returns `"Invalid design — missing product_key"` for v2 rows.
  Route them to `/products/<code>` instead so the customer can
  configure quantity via LaltexProductView's Add-to-Quote flow.
- **Do NOT write `product_template_id`, `variant_id`,
  `view_name`, or `is_public` to `user_designs` from any
  handler.** None of these are columns on this table; PostgREST
  rejects the whole INSERT with PGRST204 (CLAUDE.md §40.1).
- **Do NOT remove the `?design=<id>` query-param consumer in
  either Designer.** It's the only resume-saved-design path
  used by both flavours of the Edit button.

---

## 42. V1 DESIGNER COLOUR/POSITION SWAP — VARIANT-KEYED SAVE MODEL

Designer-v1 supports an explicit **per-variant save** feature:
clicking *Save Position* writes the current user objects to
`localStorage.userDesigns[variantKey]`, where:

```js
variantKey = `${selectedProduct}-${colorName.toLowerCase().replace(/\s+/g, '-')}-${selectedView}-${printAreaKey}`;
```

This means the customer can have **different objects on different
colour × view × print-area combinations** — Red Front Front-Print
can carry one design, Blue Front Front-Print another. The variant
key changes when ANY of those four dimensions changes.

### 42.1 The wipe-and-restore must be ATOMIC

`restoreDesignsForPrintArea` ([`Designer.jsx`](../src/pages/Designer.jsx))
is invoked from `updateCanvasImage` after every template swap (colour
change, view change, position change). Its job is to:

1. Read the saved variant for the current `variantKey` from localStorage
2. If found → wipe existing user objects, deserialise the saved variant, add them
3. If not found → leave the existing user objects in place

**The bug fixed in session 8 (2026-05-13):** the function used to wipe
user objects **unconditionally** at the start, then bail when no saved
variant existed. Every colour change generated a fresh variant key
(it changes per colour by construction); v1 has no auto-save by design
(CLAUDE.md §12), so the new colour's key was always empty → the function
wiped customer work and restored nothing. Customer adds text, clicks
Black → text gone.

The fix is one-place: read storage FIRST, branch on whether a saved
variant exists, **wipe only inside the "saved variant found" branch**.
The wipe-and-restore pair becomes atomic — no wipe without replacement.

```js
// CORRECT order
const designs = allDesigns[variantKey];
if (!designs || designs.length === 0) {
  canvas.renderAll();
  return;   // ← no wipe; existing user objects preserved
}
// Saved variant exists — wipe and restore as one operation
const existingUserObjects = canvas.getObjects().filter(...);
existingUserObjects.forEach(obj => canvas.remove(obj));
// ...restore loop using fabric.Image.fromURL / new fabric.IText
```

### 42.2 Why this isn't v2's pattern

DesignerV2 uses `fabric.util.enlivenObjects` + `canvas.add()` (CLAUDE.md
§40.5) because v2 has no per-variant save model — there's exactly one
saved design per row in `user_designs`, and it's loaded once on
`?design=<id>`. v1 has multiple per-variant saves in localStorage AND
loads/swaps them on every colour/view/print-area change. The fix
shapes differ because the underlying models differ.

If a future session unifies the two designers (e.g. moves v1 to the
shared `useDeferredDesignApply` hook), the per-variant localStorage
feature needs first-class support in the shared code OR has to be
deliberately retired. Don't paper over it.

### 42.3 Dev-only canvas exposure

`Designer.jsx` exposes the live Fabric canvas and the fabric module
on `window` ONLY in dev builds:

```js
if (import.meta.env.DEV) {
  window.__designerCanvas = fabricCanvas;
  window.__fabric = fabric;
}
```

Stripped from production by Vite's compile-time `import.meta.env.DEV`
constant (verified: `grep __designerCanvas dist/assets/` returns 0
matches post-build). Lets playwright-mcp regression probes add /
inspect canvas objects without going through UI click chains, which
is fragile for canvas-based UI. Disposed on unmount via the same
`if (import.meta.env.DEV)` block.

DesignerV2 does NOT have an equivalent exposure today; add one if you
need playwright-driven canvas probes there, mirroring this pattern.

### 42.4 Invariants — DO NOT BREAK

- **Do NOT wipe `user-image` / `user-text` objects without an
  immediately-following restore in the same code path.** Wipe-and-
  restore is one operation. An orphan wipe is the bug session 8
  fixed; reintroducing it deletes customer work mid-colour-change.
- **Do NOT change the variant-key shape** (`product-color-view-printArea`)
  without migrating existing localStorage entries. Customers' saved
  variants are keyed on this string; a shape change orphans them.
- **Do NOT include `?design=<id>` saved-design data in the
  variant-key model.** `?design=<id>` is the auth'd DB-row restore
  path (CLAUDE.md §40.5 for v2 semantics); variant-key is the
  client-side per-colour save. They coexist and the
  `designLoadedRef` flag (Designer.jsx:2102) makes
  `restoreDesignsForPrintArea` a no-op while a DB-loaded design is
  in play, so the two paths can't trample each other.
- **Do NOT remove the dev-only canvas exposure** without first
  re-checking that no playwright regression script depends on it.
  Production strip is verified by `grep __designerCanvas dist/`
  returning zero matches; it's strictly compile-time dead code in
  prod.
- **Cup products (`isCupProduct`) bypass this whole path.** They
  use panoramic / 3D rendering with their own colour-change logic;
  see Designer.jsx:1111 and 2662 for the early-returns. Do not
  fold them into the apparel/2D path "for consistency" — they have
  their own correctness model.