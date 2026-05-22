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

---

## 43. LALTEX MULTI-ROW POSITION MODEL (session 9)

Laltex's `print_details` is a flat array where **each row is a
(print_position × print_area × print_type) tuple** with its own
`print_price` tier table, `print_area_coordinates`, and `print_class`.
A single product can carry multiple rows under the same
`print_position` — AF0001 has 8 rows under `Front Chest` (5 sizes ×
multiple methods, prices £1.65–£7.70 per unit).

813 of 1182 Laltex products (~69%) have at least one multi-row position.

### 43.1 Normalised shape — `printDetails.positionGroups[]`

`productCatalogService.normaliseProduct` groups raw rows by unique
`print_position` and surfaces a `printDetails.positionGroups[]` array
to consumers:

```js
printDetails: {
  positionGroups: [
    {
      name: 'Front Chest',
      defaultRowIndex: 0,
      rows: [
        {
          area: '90x50mm',
          printType: 'Embroidery Small (90x50)',
          printClass: 'FEMB040',          // stable Laltex method code
          defaultOption: true,
          tiers: [...],
          coordinates: [...],
          setupCharge, extraColourSetupCharge, leadTime, maxColours, notes,
        },
        /* more rows for Front Chest */
      ],
    },
    /* more unique positions */
  ],
},
```

The old `printDetails.positions[]` flat array was dropped atomically;
only `positionGroups` exists post-session-9.

`buildPositionGroups()` is internal to `productCatalogService.js`.
Don't expose it; consumers should always read from
`product.printDetails.positionGroups`.

### 43.2 LaltexProductView — per-position pick + size/method dropdown

State is keyed by **unique position name**:

```js
positionPicks = {
  'Front Chest':  { enabled: true,  selectedRowIndex: 0, colours: 1 },
  'Back':         { enabled: false, selectedRowIndex: 0, colours: 1 },
};
```

UI: one tick box per position; size/method dropdown rendered **inline
under the row** when the position has more than one row. Switching the
dropdown calls `setSelectedRowIndex(name, idx)`, which resets
`colours` to the new row's first available colour count (different
methods support different colour counts).

`positionContributions` iterates groups, picks the active row inside
each, and computes the unit contribution using `tier.allInUnitPrice`
(setup baked at sync time) with a manual baking fallback.

### 43.3 DesignerV2 — grouped tabs + separate Size & Method panel

State:

```js
const [activePositionName, setActivePositionName] = useState(null);
const [activeRowByPosition, setActiveRowByPosition] = useState({});
```

Position tabs render one button per unique position. The active tab
shows a sub-label with the **currently selected row's size + method**
(e.g. `90x50mm — Embroidery Small (90x50)`). The size/method dropdown
lives in a **separate panel below the position tabs** (not inline)
so the canvas print rect updates visibly when the row changes.

The dropdown is hidden when the active position has only one row.

### 43.4 Persistence — composite `print_area` text

DesignerV2's save writes a pipe-delimited composite:

```
${position}|${area}|${printClass}    e.g.  "Front Chest|200x300mm|FTRAN05"
```

Pipe was chosen because no Laltex `print_position` or `print_area`
value contains a pipe character in the 1182-row corpus (verified
2026-05-14). If a future row breaks this assumption, the helpers
fail safely (extra segments are ignored on restore).

Restore (DesignerV2 pre-load effect) parses on `|`:

| Input | Behaviour |
|---|---|
| `"Position|Size|Class"` | Match position → match (area, class) tuple → fall back to (class only) → fall back to default row |
| `"Position"` (legacy plain text) | Match position → use defaultRowIndex; log `console.warn` flagged as "pre-multi-row v2 design" |
| `"Position|Size|Class|extra|stuff"` | First three segments parsed; extras ignored. Tolerant by design |
| `null` / unset | Use default position + default row |

Helper module: [`src/utils/printAreaFormat.js`](../src/utils/printAreaFormat.js)
exports `prettyPrintArea(value)` for display and `parsePrintArea(value)`
for structured access. Used by DesignerV2's My Designs sidebar and
CustomerDesigns' card subtitle.

### 43.5 Quote / order persistence — structured jsonb

`quote_items.print_areas` (jsonb column) carries a structured payload
in place of the old free-form summary string:

```jsonc
{
  "selections": [
    {
      "position": "Front Chest",
      "area": "200x300mm",
      "type": "Transfer Print (300x200)",
      "class": "FTRAN05",
      "num_colours": 2,
      "unit_price": 2.20
    }
  ]
}
```

Envelope-wrapped so future top-level fields (`total_setup_charge`,
`version`, etc.) can be added without re-shaping consumers.
`confirm_payment_atomic` copies jsonb-to-jsonb to `order_items.print_areas`
unchanged.

The confirm-payment Edge Function reads `print_areas` and renders one
sub-line per selection beneath each item in the order-confirmation
email. Preview at
[`supabase/email-templates/previews/confirm-payment-after.html`](../supabase/email-templates/previews/confirm-payment-after.html).

CustomerQuotes' chip-rendering [`formatPrintAreas()`](../src/pages/account/CustomerQuotes.jsx)
handles three shapes: the new jsonb envelope, the legacy free-form
string, and null. Forward-compatible across the rollout window.

### 43.6 Persistence smoke test

[`scripts/smoke-test-position-picker-roundtrip.js`](../scripts/smoke-test-position-picker-roundtrip.js)
inserts via PostgREST (service-role bypasses RLS, mirrors session 8
pattern) and verifies:

1. `user_designs.print_area` composite text round-trips byte-identical
2. `quote_items.print_areas` jsonb round-trips field-by-field
3. Malformed composite (extra pipes) still lands cleanly

Run after any change to the picker, persistence, or `normaliseProduct`:

```
node scripts/smoke-test-position-picker-roundtrip.js
```

### 43.7 Invariants — DO NOT BREAK

- **Do NOT re-introduce `printDetails.positions[]`.** It was
  removed atomically; consumers read `positionGroups[]` only. A
  dual-shape window is a footgun.
- **Do NOT key `positionPicks` (LaltexProductView) by row index.**
  Position-name keys are the new contract. Row index would couple
  state to source array ordering, which is fragile to feed
  reshuffling.
- **Do NOT write a string into `quote_items.print_areas` from the
  Laltex / DesignerV2 path.** Use the `{selections: [...]}`
  envelope. Legacy strings still render via the backward-compat
  branch in `formatPrintAreas`, but new writes must be structured.
- **Do NOT change the pipe delimiter** in `print_area` composite
  without auditing the corpus. Pipe was chosen because no Laltex
  field contains it; another delimiter could collide.
- **Do NOT skip the legacy plain-text fallback in DesignerV2's
  restore.** Designs saved between session 7 (single-row save) and
  session 9 (multi-row save) carry plain position names. Those
  must still restore — they're real customer work-in-progress.
- **Do NOT add `print_class` to a write payload without confirming
  it's in the normalised shape.** It's surfaced via
  `printDetails.positionGroups[].rows[].printClass`; nowhere else.

---

## 44. STRIPE PAYMENT — DUAL-PATH ORDER CREATION (session 9)

Order rows are now created via **two independent paths**, both calling
the same `confirm_payment_atomic` RPC with the same idempotency anchor.
Either path on its own is sufficient to create the order; both running
concurrently is safe.

| Path | File | Trigger |
|---|---|---|
| Redirect (foreground) | `supabase/functions/confirm-payment/index.ts` | Browser hits `/order-confirmation?session_id=...` after Stripe's `success_url` |
| Webhook (background) | `supabase/functions/stripe-webhook/index.ts` | Stripe sends `checkout.session.completed` server-to-server |

### 44.1 Why two paths

Pre-session-9, only the redirect existed. If the customer closed the
tab between Stripe charging the card and hitting the redirect URL,
the money was taken but no order row was created — money in, no
fulfilment. The webhook backup closes this gap. See the Task 4
investigation report for the race-condition analysis that drove the
design (committed alongside this section).

### 44.2 Order idempotency contract — `orders.stripe_session_id`

Both paths call `confirm_payment_atomic(p_quote_id, p_stripe_session_id, ...)`
(CLAUDE.md §17.7). The RPC's concurrency safety rests on three pieces:

1. **`SELECT ... FOR UPDATE` on the quote row** — serialises concurrent
   invocations. The second invocation blocks at this line until the
   first commits, then proceeds and finds the order already created.
2. **`SELECT id FROM orders WHERE stripe_session_id = $1`** —
   short-circuit idempotency check. Returns the existing order id on
   retries / concurrent runs without re-inserting.
3. **`UNIQUE INDEX orders_stripe_session_id_uniq`** (added in
   [20260514_confirmation_email_idempotency.sql](../supabase/migrations/20260514_confirmation_email_idempotency.sql)) —
   DB-level enforcement of what the RPC maintains. Belt-and-braces:
   if a future change ever drops the `FOR UPDATE` clause or the
   idempotency SELECT, the index ensures double-insertion fails fast.

### 44.3 Email idempotency contract — `orders.confirmation_email_sent_at`

The RPC dedupes the order row but **not** the email send. The redirect
and webhook paths both attempt to call `sendOrderConfirmation`
([_shared/sendOrderConfirmation.ts](../supabase/functions/_shared/sendOrderConfirmation.ts)).
That helper enforces single-delivery via two layers:

1. **CAS UPDATE** on `orders.confirmation_email_sent_at`:
   ```ts
   await supabase
     .from('orders')
     .update({ confirmation_email_sent_at: new Date().toISOString() })
     .eq('id', orderId)
     .is('confirmation_email_sent_at', null)  // CAS predicate
     .select('id');
   ```
   If the other path stamped the column between our SELECT and our
   UPDATE, `.select()` returns zero rows and we log
   `stamped_by_other_path` instead of double-claiming success.
2. **Resend `Idempotency-Key: order-<orderId>-confirmation`** —
   end-to-end dedup at SMTP layer. Both paths send the same key, so
   even in the narrow window where both pass the SELECT before either
   lands the UPDATE, Resend itself deduplicates the actual delivery.

The column is timestamped only on Resend HTTP 2xx, so a transient
Resend outage on path A still leaves path B (or a future manual retry)
free to try again.

### 44.4 "Both paths attempt" rationale

Asymmetric strategies (only webhook sends, redirect skips email — or
the reverse) leave a gap: if the chosen path's Resend call fails, no
email goes out and there is no retry. With both paths attempting,
either is a free retry of the other. The CAS + Idempotency-Key combo
prevents duplicate delivery.

### 44.5 Stripe event subscription

The webhook subscribes to **`checkout.session.completed`** and that
event only. Reasons:

- `metadata.quote_id` is attached to the Checkout Session, not the
  PaymentIntent. `payment_intent.succeeded` would lose the metadata
  path.
- The event payload shape matches `GET /v1/checkout/sessions/{id}`
  line for line: `payment_status`, `amount_total`, `payment_intent`,
  `metadata.quote_id`, `customer_email`. Webhook code can call the
  RPC with the same parameter set the redirect path uses.

The webhook is defensive against unsubscribed events: any other
`event.type` is logged and acknowledged with 200, so broadening the
Dashboard subscription later does not require a code change.

### 44.6 Stripe response code contract

The function's HTTP status is the only signal Stripe acts on:

| Scenario | Status | Stripe behaviour |
|---|---|---|
| Signature verification fails | 400 | No retry — wrong signature is permanent |
| Missing required env var | 500 | Retries — fixable by setting the secret |
| Unhandled event type | 200 | No retry — acknowledged |
| Session unpaid / no quote_id | 200 | No retry — not our concern |
| RPC error | 500 | Retries with exponential backoff for ~3 days |
| Success | 200 | No retry |
| Email-send failure inside helper | 200 (parent returns 200) | No retry — email is best-effort, order already created |

Email-send failure does NOT propagate to a 500 response. Triggering
Stripe to retry the whole webhook (and thus the RPC) just to re-attempt
the email would waste retries on a non-causal problem.

### 44.7 Signature verification — Deno specifics

`stripe.webhooks.constructEventAsync(rawBody, signature, secret)` is
**required** in Deno. The synchronous `constructEvent` uses Node's
`crypto` module which is absent in Deno; the async variant uses Web
Crypto's HMAC primitive.

The raw body must be read via `await req.text()` **before** any JSON
parsing. Stripe's signature is computed over the exact bytes it sent;
re-stringifying parsed JSON (different whitespace, key ordering) will
break the HMAC.

### 44.8 Deploy contract — `--no-verify-jwt`

The webhook function MUST be deployed with `--no-verify-jwt`:
```
supabase functions deploy stripe-webhook --project-ref <ref> --no-verify-jwt
```
Stripe does not send a Supabase JWT. Signature verification (inside
the function) is the security boundary instead. Forgetting the flag
means Supabase rejects every event with 401 before the handler runs.

### 44.9 Files

| File | Purpose |
|---|---|
| `supabase/migrations/20260514_confirmation_email_idempotency.sql` | `confirmation_email_sent_at` column + `orders_stripe_session_id_uniq` index |
| `supabase/functions/_shared/sendOrderConfirmation.ts` | Shared email helper — CAS + Idempotency-Key |
| `supabase/functions/stripe-webhook/index.ts` | Webhook handler |
| `supabase/functions/confirm-payment/index.ts` | Refactored — delegates email to the shared helper |

### 44.10 Invariants — DO NOT BREAK

- **Do NOT remove the `FOR UPDATE` clause in `confirm_payment_atomic`.**
  It serialises concurrent redirect + webhook invocations. Without it
  the SELECT-then-INSERT idempotency check is a TOCTOU.
- **Do NOT drop the `orders_stripe_session_id_uniq` index.** It is the
  DB-level guarantor if the RPC ever regresses.
- **Do NOT call Resend without the `Idempotency-Key` header.** The
  CAS column is the primary guard; the header covers the narrow race
  window where both paths pass the SELECT before either lands the
  UPDATE. Removing it makes that window observable to customers.
- **Do NOT stamp `confirmation_email_sent_at` on Resend non-2xx.**
  A failed send must remain retryable. The current helper only stamps
  on success.
- **Do NOT return 2xx from `stripe-webhook` on RPC failure.** Stripe's
  retry is the recovery mechanism for transient DB failures. Swallowing
  the error with 200 turns a recoverable hiccup into a paid-but-no-order
  ghost (the exact bug the redirect-only flow had before this session).
- **Do NOT return 5xx from `stripe-webhook` for non-recoverable cases**
  (signature failure, malformed payload, unhandled event types). Stripe
  would retry for 3 days on something that will never succeed. Use 400
  or 200 as appropriate.
- **Do NOT call `req.json()` before `req.text()` in `stripe-webhook`.**
  The body stream is consumed on first read; signature verification
  needs the raw bytes Stripe sent.
- **Do NOT deploy `stripe-webhook` without `--no-verify-jwt`.** Stripe
  is not a Supabase client; verifying a JWT it doesn't send means every
  event 401s before the function code runs.
- **Do NOT edit the email body, subject, or `renderEmail` inputs
  inside `sendOrderConfirmation.ts` without a separate PR.** The
  session-9 lift was deliberately byte-identical to the previous
  inline implementation; any change to those strings is a content
  change and belongs in its own review.
- **Do NOT add new callers of `sendOrderConfirmation` without
  understanding the CAS contract.** Two callers exist today (redirect
  + webhook). Any third caller must also tolerate `stamped_by_other_path`
  as a non-error outcome.

---

## 45. SUPPLIER PRODUCT CODE CASING — ALREADY DOCUMENTED §33

(Section number reserved to keep numbering aligned with prior commits;
see §33 for the canonical guidance on `getSupplierProductByCode`.)

---

## 46. LALTEX MARGIN + DELIVERY LAYER (session 9 / Stage 1)

Customer-facing Laltex prices are derived at TWO layers:

1. **Sync-time** — `supplier_products.product_pricing[i].sell_price` and
   `print_details[i].print_price[j].sell_price` are computed by
   [`scripts/lib/laltex-margin.js`](../scripts/lib/laltex-margin.js)
   and written by the nightly sync + on-demand recompute. They contain
   product cost + setup amortisation (print only) + margin.
2. **Read-time** — UK STANDARD delivery share at the customer's actual
   order quantity, with margin applied, computed by
   [`scripts/lib/laltex-delivery.js`](../scripts/lib/laltex-delivery.js).
   Added to the sync-stored `sell_price` at every consumer site:
   `LaltexProductView` (Configure & Quote), `api/search-products.js`
   (`unit_price_at_quantity`), `api/ai/chat.js` (`slimProduct`),
   `AIChatWidget` ProductCard ("From £x.xx (MOQ+)").

### 46.1 The all-in cost equation

```
At SYNC time (applyMarginsInPlace, per tier in product_pricing[]):
  cost_basis      = tier.price                            (NO delivery — read-time)
  tier.sell_price = round(cost_basis × (1 + margin), 2)

At SYNC time (applyMarginsInPlace, per tier in print_details[i].print_price[j]):
  setup_amortised = setup_charge / tier.min_qty
  extra_setup_am  = max(num_colours-1, 0) × extra_setup / tier.min_qty
  cost_basis      = tier.price + setup_amortised + extra_setup_am
  tier.sell_price = round(cost_basis × (1 + margin), 4)

At READ time (LaltexProductView, customer's actual qty Q):
  productSell        = product_pricing_tier_for_Q.sell_price        (synced)
  printSell          = sum over enabled positions of position.sell_price (synced)
  marginPctForQ      = scheduleMarginForTier(Q, override)
  deliveryTotal      = computeDeliveryForQuantity(shippingCharges, piecesPerCarton, Q)
  deliveryPerUnit    = deliveryTotal / Q
  deliveryWithMargin = deliveryPerUnit × (1 + marginPctForQ)
  unitPrice          = productSell + printSell + deliveryWithMargin
  totalPrice         = unitPrice × Q
```

### 46.2 Default margin schedule (mirrors PGifts Direct §6.2)

| Tier min_qty | Margin |
|---|---|
| 1 – 99   | 22% |
| 100 – 249 | 20% |
| 250 +    | 18% |

Per-product override via `supplier_products.margin_pct_override`
(decimal [0, 1)). NULL means use the schedule.

### 46.3 Known limitation — setup amortisation uses tier.min_qty (not actual qty)

Print-tier setup amortisation divides the supplier setup charge by
`tier.min_qty`, NOT by the customer's actual order quantity. So at
qty 26 the setup is amortised as if qty 25; at qty 30 still as if 25;
only at qty 50 (the next tier band) does the setup share drop.

This produces a small **step at every tier boundary** in the print-cost
line. It is consistent with how PGifts Direct prices were originally
baked, and was an explicit Stage 1 simplification. Do NOT attempt to
re-amortise setup at sync time using the actual customer qty — that
would require recomputing sell_price for every product on every quote
view and break the "synced sell_price is the single source of truth"
contract (§46.5).

### 46.4 ⚠️ DO NOT — SETUP DOUBLE-COUNTING (R6, top-level warning)

Setup amortisation is **baked into `print_details[i].print_price[j].sell_price`**.
This is a *very* common foot-gun.

**Any future code that adds `setup_charge` separately when computing a
per-position unit cost will double-bill the customer.**

The legacy fallback path in `LaltexProductView` that added setup
on-the-fly was REMOVED in Stage 1 precisely because it would
double-count now that sell_price already includes setup. Do not
re-introduce that path. Do not look at `setup_charge` from a consumer.

Checklist before touching any per-position pricing code:

- [ ] Am I reading `tier.sell_price` (or `tier.allInUnitPrice` which is
      now its alias)? ✅ OK.
- [ ] Am I reading `tier.price` (raw) and adding `setup_charge`? ❌
      You have just doubled the setup bill. STOP.

### 46.5 Invariants — DO NOT BREAK

- **Do NOT bake delivery into sync-stored `sell_price`.** Decision B1-A.
  `sell_price` is product + setup (print tier only) + margin, no
  delivery. Delivery is added at every read site via
  `computeDeliveryForQuantity`. Baking delivery at sync would either
  require a fixed "representative" quantity (inaccurate at actual qty)
  or a double-source between sync and read (fragile arithmetic).
- **Do NOT include `margin_pct_override` in any UPSERT body written by
  sync, the single-product debug script, or the mirror script.** It is
  admin-owned state. The CLI `--override` flag in
  `sync-laltex-product.js` applies the override to the computed
  sell_price values WITHOUT persisting the override itself.
- **Do NOT add setup_charge separately at a print-price consumer site.**
  See §46.4 above.
- **Do NOT change `DEFAULT_SCHEDULE_VERSION` without running
  `recompute-laltex-margins.js --stale-only` to align every row.** The
  schedule version stamp is the drift-detection anchor — bumping it
  without recomputing leaves rows on the old schedule indefinitely.
- **Do NOT send raw cost prices to the AI model.** `slimProduct` does
  a silent swap: the `price` key on each pricing summary entry carries
  the inclusive customer price (sell_price + UK STANDARD delivery
  share at the tier's representative qty + margin on the delivery
  share). The model never sees cost basis or margin percentages.
- **Do NOT touch `catalog_products`, `catalog_pricing_tiers`, or
  `catalog_print_pricing`** in this work. PGifts Direct prices are
  already margin-baked at the catalog layer; the mirror script
  ([`migrate-catalog-to-supplier-products.js`](../scripts/migrate-catalog-to-supplier-products.js))
  reflects them into `supplier_products` with `sell_price = price` and
  `margin_applied_pct = 0` so the read path is uniform across
  suppliers. A future retrofit (split cost vs sell on the catalog
  side) is post-launch admin-dashboard work; do NOT preempt.
- **Do NOT remove `tier.allInUnitPrice` from the normalised Laltex
  product shape.** It is the back-compat alias for `tier.sell_price`
  used by `LaltexProductView`. Removing it requires touching the
  component.
- **Do NOT change the carton-tier lookup math** in
  `computeDeliveryForQuantity` without re-verifying against the live
  Laltex `ShippingCharge` shape (see CLAUDE.md §27 / Task 9 audit).
  The "11+" open-band uses `PerCartonCharge × cartons`; the dense
  1..10 rows use the flat `ShippingCharge` total. Mixing them up
  silently produces wrong delivery totals.

### 46.6 Recompute flow

| Event | Action |
|---|---|
| Default schedule changes (laltex-margin.js edit + version bump) | Run `node scripts/recompute-laltex-margins.js --stale-only` |
| Admin updates a single product's `margin_pct_override` | Run `node scripts/recompute-laltex-margins.js <CODE>` |
| Full refresh after a deploy | Run `node scripts/recompute-laltex-margins.js` |
| Laltex feed price changes | Naturally picked up by next nightly sync; recompute is automatic in `syncFullCatalogue` |

### 46.7 Files

| File | Role |
|---|---|
| `supabase/migrations/20260515_supplier_margin_and_delivery_layer.sql` | New columns: `margin_pct_override`, `margin_default_schedule_version`, `margin_last_applied_at` |
| `supabase/migrations/20260515_search_maxprice_uses_sell_price.sql` | `rpc_search_supplier_products` replacement — filter on sell_price, return shipping_charges + carton_qty |
| `scripts/lib/laltex-margin.js` | Schedule + `applyMarginsInPlace` (sync-time + recompute-time) |
| `scripts/lib/laltex-delivery.js` | `computeDeliveryForQuantity`, `deliveryPerUnit` (read-time at every consumer) |
| `scripts/lib/laltex-sync.js` | Wires `applyMarginsInPlace` into the nightly sync loop |
| `scripts/sync-laltex-product.js` | Single-product debug; supports `--override <pct>` for ad-hoc tests |
| `scripts/recompute-laltex-margins.js` | All / by-code / `--stale-only` recompute modes |
| `scripts/migrate-catalog-to-supplier-products.js` | PGifts Direct mirror — writes `sell_price = price`, `margin_applied_pct = 0` |
| `src/services/productCatalogService.js` | Reads `sell_price` from tier JSONB; exposes `shippingCharges`, `piecesPerCarton`, `marginPctOverride` on the normalised product |
| `src/components/LaltexProductView.jsx` | Wires `deliveryPerUnit` into `unitPrice`; breakdown panel adds "UK delivery" line |
| `src/components/AIChatWidget/AIChatWidget.jsx` | ProductCard "From £x.xx (MOQ+)" — picks the MOQ-or-greater tier |
| `api/ai/chat.js` | `slimProduct` sends inclusive price (sell_price + delivery share at tier.min_qty) |
| `api/search-products.js` | `unit_price_at_quantity` = sell_price + delivery share at filter qty |
| `scripts/lib/ai-system-prompt.js` | One-paragraph addition: prices include UK delivery; non-UK firms at quote time |

---

## 47. AI TOOL sub_category + supplierSlug — CROSS-SUPPLIER FILTER BIAS

The `searchProducts` tool's `sub_category` parameter is **exact-match,
case-sensitive** against `supplier_products.sub_category`. Different
suppliers use different naming conventions:

| Sub-category concept | Laltex value | PGifts Direct value |
|---|---|---|
| Cotton T-shirts | `T-shirts` (lowercase s) | `T-shirts` (normalised in [20260516](../supabase/migrations/20260516_normalise_subcategory_casing.sql); was `T-Shirts` pre-Task 11) |
| Polos / Hoodies / Sweatshirts | identical | identical |
| Coffee Cups (PGifts) ≈ travel mugs (Laltex) | `Plastic Travel Mugs`, `Ceramic Mug`, `Metal Travel Mugs` | `Coffee Cups` |
| Tote bags | `Shoppers`, `Cooler Bags`, `Gift Bags` | `Cotton Bags`, `Canvas Bags`, `Recycled Canvas Bags` |
| Notebooks | `Notebooks` (one bucket) | `A5 Notebooks`, `A6 Pocket Notebooks` |

**Setting `sub_category` typically restricts results to one supplier.**
This is a data-layer constraint, not a ranking bias — it filters at
candidate selection inside `rpc_search_supplier_products`, before any
scoring. The tool description in `scripts/lib/ai-tools.js` warns Claude
off cross-supplier sub_category filtering; the natural-language query
is the right primary signal for cross-supplier searches.

The `supplierSlug` parameter should only be set when the customer
**explicitly names** a supplier preference (e.g. "show me PGifts Direct
cables") or asks for live-design-preview / Designer-compatible products
(which are PGifts-Direct-only at present). Subjective qualifiers like
"premium" or "highest quality" do NOT justify a supplierSlug filter.

### 47.1 Invariants — DO NOT BREAK

- **Do NOT add `sub_category` example values to the tool description
  that match only one supplier's vocabulary.** Task 6 found the
  pre-Task-11 examples (`"T-Shirts", "Charging Cables", "Power Banks",
  "Coffee Cups", "Travel Mugs"`) were all PGifts Direct casing — that
  taught Claude to pass values that silently excluded the entire
  Laltex pool.
- **Do NOT re-introduce the `T-Shirts` (capital S) casing.** Future
  PGifts Direct curation should use the normalised `T-shirts` form.
  Run [20260516_normalise_subcategory_casing.sql](../supabase/migrations/20260516_normalise_subcategory_casing.sql)
  as a one-shot only — it's idempotent (UPDATE WHERE = 'T-Shirts'
  matches zero rows after first apply).
- **Do NOT propose `supplierSlug='pgifts-direct'` as the answer to
  "show me your most premium options"** — there's no objective
  definition of premium in the catalogue, and locking the search to
  25 products on subjective grounds defeats the cross-supplier
  retrieval the system is designed for.
- **Do NOT touch HOUSE_MULTIPLIER (1.05) or CORE_MULTIPLIER (1.30 in
  search, 1.15 in find-alternatives).** Dave's decision: the small
  house multiplier stays as a tiebreaker; the core multiplier
  legitimately surfaces Designer-integrated SKUs for design queries.

---

## 48. PRICING PRECISION — 2dp AT THE BOUNDARY

All Laltex price computations in
[`LaltexProductView.jsx`](../src/components/LaltexProductView.jsx) round
to **2dp at the final `unitPrice` step** (not 4dp internally then 2dp
at display).

The reason is structural: every price column in the schema is
`numeric(10,2)` and Postgres silently truncates anything finer on
INSERT. Confirmed live via `information_schema.columns`:

| Column | Type |
|---|---|
| `quote_items.unit_price` | `numeric(10,2)` |
| `order_items.unit_price` | `numeric(10,2)` |
| `order_items.line_total` | `numeric(10,2)` |
| `quotes.total_amount` | `numeric(10,2)` |
| `orders.total_amount` | `numeric(10,2)` |

The `recompute_quote_total` trigger
([20260422_quote_total_sync_trigger.sql](../supabase/migrations/20260422_quote_total_sync_trigger.sql))
recomputes `quotes.total_amount = SUM(quantity * unit_price)` after
every INSERT/UPDATE on `quote_items`. If `unit_price` lands at 2dp
truncation while the app inserted a precise 4dp-derived `total_amount`,
the trigger silently overrides with the SUM of the truncated rows —
producing a "displayed £X.XX, charged £Y.YY" mismatch where the
customer paid MORE than the screen showed.

### Worked example (the bug this section was written for)

AF0001 at qty 25, Front Chest Embroidery Small (1 colour), 22% margin:

```
Pre-fix:
  unitPrice (4dp)   = 6.72 + 3.8186 + 0.5783 = 11.1169
  totalPrice (2dp)  = round(25 × 11.1169, 2) = £277.92      ← displayed
  quote_items.unit_price stored = TRUNC(11.1169, 2) = 11.12
  recompute_quote_total fires:
    quotes.total_amount = SUM(25 × 11.12) = £278.00          ← overrides
  Stripe reads quotes.total_amount and charges £278.00       ← actual charge
  → 8p mismatch, customer sees £277.92 and pays £278.00

Post-fix:
  unitPrice (2dp)   = round(11.1169, 2)        = 11.12
  totalPrice (2dp)  = round(25 × 11.12, 2)     = £278.00     ← displayed
  quote_items.unit_price stored                = 11.12
  recompute_quote_total: quotes.total_amount   = £278.00
  Stripe charges £278.00                                     ← matches display
```

### DO NOT

- Round to >2dp anywhere on the chain from `unitPrice` →
  `quote_items.unit_price` → `confirm_payment_atomic` →
  `orders.total_amount` → Stripe. The 4dp `.toFixed(4)` that used to
  sit at LaltexProductView's unitPrice was the proximate cause; do
  not reintroduce it.
- Reintroduce 4dp precision on any of the five price columns above
  without auditing every consumer (admin views, email templates,
  exports, the recompute trigger) and the math chain end-to-end.
- "Helpfully" precompute a high-precision `unit_price` at insert time
  thinking the trigger won't fire — the trigger fires AFTER INSERT
  and overrides whatever `total_amount` was just stored.

### DO

- Display the rounded value the customer will be charged. The
  breakdown panel components (product / print / delivery) are each
  rounded independently via `formatGBP()` and may not sum to the
  displayed unit price by 1p in edge cases — this is acceptable
  transparency. The unit price line is the authoritative customer-
  facing number.
- For new pricing logic, round at the boundary where the result is
  customer-visible OR persisted, whichever comes first.

### Where 4dp precision is STILL acceptable

The `print_areas` JSONB selections on `quote_items` (LaltexProductView
line ~396: `unit_price: +p.unit.toFixed(4)`) is an audit trail field,
NOT a price column. Postgres does not truncate JSONB numeric values,
and no trigger sums them. The 4dp precision there records the
per-position cost basis at quote time for back-office reference.

Sync-time `applyMarginsInPlace` ([scripts/lib/laltex-margin.js](../scripts/lib/laltex-margin.js))
writes `print_details[i].print_price[j].sell_price` at 4dp inside the
JSONB — also acceptable for the same reason. The 4dp print sell_price
is consumed by `LaltexProductView` and SUMMED into `unitPrice`, which
then rounds to 2dp at the boundary. So the print precision is
preserved through the math and collapsed only at the persistence /
display boundary, exactly as intended.

---

## 49. HOMEPAGE AVA AI ASSISTANT CARD (session 9 / task 14)

The homepage hosts a full-width Ava AI assistant card directly below
the hero banners. Click anywhere on the card to open the floating AI
chat widget with the active typewriter phrase pre-filled.

### 49.1 Architecture — `pgifts:open-chat` custom event

The card and the chat widget communicate via a window-level
[CustomEvent](https://developer.mozilla.org/docs/Web/API/CustomEvent):

```js
window.dispatchEvent(new CustomEvent('pgifts:open-chat', {
  detail: {
    prefill: 'Find a product, 250 units, under £10 each',
    welcomeMessage: "Your assistant is ready to help! Type your question below…",
  },
}));
```

[`AIChatWidget`](../src/components/AIChatWidget/AIChatWidget.jsx)
subscribes via `useEffect` on mount and reacts:
1. `setOpen(true)` — expands the panel.
2. `setInput(prefill)` — pre-populates the textarea.
3. Prepends `welcomeMessage` as an assistant message **if not already
   at index 0** — idempotent on repeat clicks.
4. Auto-focuses the textarea after a 50ms delay (panel mount race).

The pre-loaded welcome message does **not** call the LLM and does
**not** count against quota — it's a UI-only message rendered with
the same styling as real assistant responses.

### 49.2 AvaTypewriter

[`src/components/AvaTypewriter.jsx`](../src/components/AvaTypewriter.jsx)
— pure React, no deps. State machine:
- `typing` (60ms / char) → `holding` (2500ms) → `erasing` (30ms / char)
  → `pausing` (300ms) → next phrase, loop.
- `onActivePhraseChange(phrase)` fires when a NEW phrase starts typing,
  letting the parent (Home.jsx) snapshot the active intent for the
  click handler's pre-fill.
- Cleanup: `clearTimeout` on unmount.

Blinking cursor + thinking-dots pulse are CSS-only
(`.ava-cursor`, `.ava-thinking-dots` in `src/index.css`).

### 49.3 Sections temporarily hidden

The Helpful Tools section ([`src/pages/Home.jsx`](../src/pages/Home.jsx)
~L500-700) and the Latest From Our Blog section (~L700-790) are
**wrapped in `{false && (…)}` blocks**, NOT deleted. Future restore =
remove the conditional wrappers.

Why `{false && (…)}` instead of `{/* … */}` block comments: each
section contains 10+ nested JSX `{/* … */}` comments. An outer block
comment would terminate at the first inner `*/` and leave subsequent
JSX rendering.

### 49.4 Feature-flag rollout

The chat widget is gated by `VITE_AI_CHAT_PUBLIC_ENABLED` (anon) and
`profiles.ai_chat_enabled` (signed-in) — see CLAUDE.md §32.3. Public
Ava rollout **requires** flipping `VITE_AI_CHAT_PUBLIC_ENABLED=true` in
Vercel Production + Preview env. Without that, the widget is not
mounted for anonymous visitors and Ava-card clicks dispatch into
nothing.

### 49.5 Rate-limit contract (current state, session 9)

The anonymous quota lives in
[`scripts/lib/ai-quota.js`](../scripts/lib/ai-quota.js):
**5 `searchProducts` calls per rolling 24h per `visitor_id_hash`**.
See CLAUDE.md §32.6 for the full design.

Enforced server-side in [`api/ai/chat.js`](../api/ai/chat.js); the
widget surfaces the remaining count but does not enforce. Signed-in
users skip the quota entirely (always allowed).

**Identification:** FingerprintJS visitor ID → SHA-256 (with optional
`VISITOR_HASH_SALT`). IP-hash fallback when FingerprintJS fails.

### 49.6 Known rate-limit gaps — tech debt (open follow-ups)

Three known limitations were deliberately deferred to focused
follow-up PRs rather than scoped into the Ava launch. Dave's Anthropic
Console spend cap is the line of last defence for all three:

1. **Anonymous bypass via `visitor_id` rotation.** An adversary
   POSTing directly to `/api/ai/chat` with a fresh random `visitor_id`
   per request gets fresh quota each time. **Fix:** count against both
   the fingerprint-hash bucket AND the IP-hash bucket in parallel; if
   either exceeds, refuse. ~15 LOC change to `checkSearchQuota` +
   `incrementQuota`.

2. **Per-account rate limit for signed-in users.** Currently
   unlimited. A compromised / abusive signed-in account could rack up
   thousands of LLM calls per day. **Fix:** introduce a parallel
   `ai_quotas_users` table (or extend the existing one with a
   nullable `user_id`) and a `SIGNED_IN_DAILY_LIMIT` constant.
   Suggested initial value: **50/day**. ~80 LOC.

3. **Counter for `findAlternatives` + general chat turns.** Today
   only `searchProducts` increments the quota. A visitor could send
   1,000 small-talk turns / day at ~$0.01 each. **Fix:** add a
   separate (lower-priority, lower-frequency) turn-counter quota.
   Suggested initial value: **30 turns/day** for anon, **higher cap
   for signed-in**. ~40 LOC.

Each is a focused PR; do not bundle with feature work that has its own
review risk surface.

### 49.7 `ava.png` optimisation (tech debt)

`public/images/ava.png` is **749×750 px, 444 KB**. Above-the-fold
homepage image. An optimised ~150 KB version would help LCP by
roughly 300ms on typical broadband. Out of scope for the Ava launch
PR; flagged here as a follow-up. Tooling: any image optimiser
(squoosh.app, sharp CLI). Replace in place; no code changes needed.

### 49.8 Invariants — DO NOT BREAK

- **Do NOT dispatch `pgifts:open-chat` without setting `prefill`** when
  the source is a "click-to-chat" surface. Empty `prefill` is allowed
  (clears input) but undefined leaves the previous input intact —
  surprising UX.
- **Do NOT skip the idempotent welcome-message check.** Re-clicking
  Ava during an in-progress chat must not double-inject the welcome.
- **Do NOT count the welcome message as a quota tick.** It does not
  call the LLM; it is a UI-only message.
- **Do NOT remove `VITE_AI_CHAT_PUBLIC_ENABLED` from the gating logic
  in `AIChatWidget`** without also rethinking whether Ava should be
  publicly accessible. The flag is the single source of truth for the
  widget's anonymous visibility.
- **Do NOT delete the commented-out Helpful Tools or Blog sections.**
  Wrapped in `{false && (…)}` for future restore, not stashed
  elsewhere. JSX must survive in the file.
- **Do NOT scope rate-limit hardening (§49.6) into unrelated PRs.**
  Each of the three follow-ups is its own scope and review.

---

## 50. LALTEX DESIGNER POSITION + IMAGE FALLBACK INVARIANTS

DesignerV2's canvas rendering for Laltex products depends on two
contracts that the canonical-group resolver and the image-fallback
chain must respect together. Investigation report (audit) and the
follow-up fix landed in `feat/laltex-designer-position-priority`.

### 50.1 Position priority must respect PAC presence

`canonicalGroupName` in
[`src/pages/DesignerV2.jsx`](../src/pages/DesignerV2.jsx) picks the
position group that drives the canvas. Resolver invariants:

1. Filter to position groups whose rows carry **at least one
   `print_area_coordinates` entry**. Groups with all-empty rows are
   eliminated from consideration entirely — they have no
   image+coordinate payload to drive the canvas.
2. From the filtered set, prefer by **case-insensitive name** in this
   order: `Wrap`, `Front`, `Back`, then the first remaining group in
   source order.
3. If no group passes the filter, return `null`.

**Why:** Laltex ships some products (e.g. MG0660, the Korvex engraved
tumbler) with a `Wrap` position present but EMPTY of PAC, while the
real engraving PAC lives on `Front`. The pre-fix resolver preferred
the name "Wrap" unconditionally, locking the canvas to an empty
position. Image fallback then walked past the (null) PAC image and
landed on `Items[].ItemImages[0]` — Laltex's marketing photo, which
can carry mockup branding from another customer ("BLACKBRIDGE
SECURITY SOLUTIONS" was a real production sighting). The overlay rect
also dropped out because `colourCoord` was null.

### 50.2 Image fallback chain — plain over marketing

`rawImageUrl` selection priority:

1. `colourCoord?.image_url` — Laltex's plain PAC image (coord-aligned).
2. `selectedColour?.plainImages?.[0]` — per-colour PlainImages (clean).
3. `selectedColour?.images?.[0]` — per-colour ItemImages (**may carry
   mockup branding**, last resort).
4. `product.images?.[0]?.url` — top-level marketing (same risk).

**Why:** Laltex API V1.7 documents PlainImages as the unbranded
product photo. ItemImages is the marketing/catalogue image and may
ship with customer-mockup branding. Always prefer clean over
potentially-branded except where the PAC field is the primary source.

A top-level `product.plainImages` does NOT exist on the normalised
product today (`productCatalogService.normaliseProduct` only surfaces
plain_images at the colour level). If a future refactor adds it,
insert between steps 2 and 3.

### 50.3 `colourCoord` defensive fallback

When the selected colour name doesn't match any PAC entry's `colour`
field in the chosen render position, fall back to `allCoords[0]`
rather than null:

```js
const colourCoord =
  (selectedColour?.name ? allCoords.find(c =>
    c.colour?.toLowerCase().trim() === selectedColour.name.toLowerCase().trim()
  ) : null) || allCoords[0] || null;
```

**Why:** rect coordinates are identical across colours within a
single position group (only the per-colour image varies slightly).
With the canvas locked to a populated position via §50.1, the
worst-case fallback is a marginally-mismatched colour preview — still
strictly better than dropping into the no-coord path where the
overlay disappears AND the image fallback walks back to marketing
photos. The session-7 "Amber→Blue silent swap" bug (CLAUDE.md §37)
does NOT reappear because that bug's prerequisite (some colours
have PAC, customer's colour doesn't, fall back vs not) is rendered
moot — the position-priority rule §50.1 now picks the position with
PAC, and within that position any PAC entry is correct rect-wise.

### 50.4 Invariants — DO NOT BREAK

- **Do NOT lock the canonical group to a position name without
  checking PAC presence first.** The session-9 bug Dave observed
  (MG0660 "BLACKBRIDGE" image + missing overlay) is exactly this
  failure mode. Any new heuristic that bypasses §50.1 is rejecting
  the fix.
- **Do NOT promote `selectedColour.images[0]` above
  `selectedColour.plainImages[0]` in the image fallback chain.**
  ItemImages is marketing-grade and may be branded; PlainImages is
  contractually clean per Laltex API docs.
- **Do NOT consume `marked_image_url` in the Designer.** Parsed and
  stored for completeness only. Despite the field name, it is
  Laltex's "mockup-branded sample for marketing review" — exactly
  what we want to AVOID showing to a customer designing their own
  print.
- **Do NOT change PGifts Direct image-loading paths to share this
  fallback chain.** PGifts Direct uses `variant.template_url` from
  `product_template_variants`; the Laltex chain documented here is
  Laltex-specific.
- **Products with zero PAC anywhere (~34% of the Laltex catalogue per
  the §1.1 audit) correctly hide the Customize card** via
  `isDesignable` in `LaltexProductView`. This is a data gap from
  Laltex, not a Designer bug. Do not relax `isDesignable` to let
  Designer open against zero-PAC products without coordinating
  product decisions first.

---

## 51. RETIRED PRODUCT HANDLING — 3-STRIKE MISSING-FROM-FEED FLAG

Laltex sometimes removes products from their bulk feed without warning
(TF0003 was the originating example: last seen 10 days before the
audit). Pre-this-section, the only thing stopping a retired SKU from
serving customers was the 14-day staleness filter inside the search
RPC (§31.3); the product page, Designer, and category listings would
all continue to serve it until that window expired.

Two columns on `supplier_products` now drive a soft-retire flag:

| Column | Type | Meaning |
|---|---|---|
| `is_retired` | `boolean NOT NULL DEFAULT false` | Single read-side gate. Active listings, product pages, the Designer, and the search RPC filter this to false. |
| `missing_from_feed_count` | `integer NOT NULL DEFAULT 0` | Running count of consecutive sync runs in which the row was not seen in the bulk feed. Increments by 1 per miss; resets to 0 on reappearance. |

Migration: [`20260518_supplier_products_retired_flag.sql`](../supabase/migrations/20260518_supplier_products_retired_flag.sql).
Down migration exists; columns + index + CHECK constraint all drop
cleanly.

### 51.1 The 3-strike threshold

`is_retired` flips to `true` when `missing_from_feed_count` reaches
**3**. Constant: `RETIRE_THRESHOLD` in
[`scripts/lib/laltex-sync.js`](../scripts/lib/laltex-sync.js).

**Why 3 strikes, not 1.** Laltex's bulk feed occasionally fails to
enumerate a product for a single run (transient supplier-side issues,
intermittent network glitches). At nightly cadence:

- 1 miss = same-day blip; could be a network drop. Retiring instantly
  would false-positive on outages.
- 3 misses = consistent absence for ~3 days. Genuinely retired
  products clear within a working week; a one-off glitch never
  false-positives.
- The window must be **shorter than the 14-day staleness filter**
  (otherwise retirement is redundant with staleness — already exists).
  3 days achieves that comfortably.

**Why retire rather than delete.** Order history and saved-design
gallery (My Designs) reference `supplier_products` rows for past
customer work. Deleting would either orphan those rows or require
destructive `ON DELETE CASCADE`. Retirement is a read-side gate; the
row stays intact for historical lookup.

### 51.2 Sync reconciliation phase

Inside [`scripts/lib/laltex-sync.js`](../scripts/lib/laltex-sync.js)
`syncFullCatalogue()`, immediately after the upsert loop completes:

1. **Seen-in-this-sync reset:** every row that survived normalisation
   is upserted with `missing_from_feed_count: 0, is_retired: false`
   alongside its other fields. A previously-retired product that
   reappears in the feed is fully reinstated by this single write — no
   separate UPDATE needed.

2. **Missing-from-feed increment:** the reconciliation block computes
   `missing = existingCodes \ seenCodes` (where `seenCodes` excludes
   upsert-failed rows so a row whose upsert is broken is treated as
   missing too — same trajectory toward retirement as a row Laltex
   omitted). For each missing code, the local counter increments and
   a small bulk UPSERT writes only `{ supplier_id,
   supplier_product_code, missing_from_feed_count, is_retired }` —
   every other column on the row is untouched by
   `Prefer: resolution=merge-duplicates`.

3. **Gating:** the reconciliation block runs only when the upsert loop
   completes without an infra-level throw. If Laltex returned a
   partial feed, the early-return at `fetched === 0` short-circuits
   before this point. If the upsert loop itself threw, the catch
   block flips `status='failed'` and skips reconciliation. Retirement
   never fires on an unhealthy feed.

4. **`last_synced_at` is NOT touched on the missing-update.** The
   column remains the indicator of when the row was last actually
   seen — matches CLAUDE.md §27 / §27.5's "failed rows keep previous
   `last_synced_at`" principle.

5. **Per-batch failure isolation.** Same pattern as the main upsert
   loop: batch UPSERT first, single-row fallback on failure, log
   per-row to `job_failures` with `reason='retirement_update_failed'`.

### 51.3 Read paths — where the filter lands

| Surface | How it filters | Default |
|---|---|---|
| `getSupplierProductByCode(code)` | `.eq('is_retired', false)` on the PostgREST query | Retired excluded |
| `getProductByIdentifier(identifier)` | Inherits from `getSupplierProductByCode` | Retired → null → 404 |
| `rpc_search_supplier_products` | `sp.is_retired = false` inside the candidate WHERE | Non-bypassable |
| `rpc_find_alternatives` (neighbour set) | `sp.is_retired = false` inside the WHERE | Non-bypassable |
| `rpc_find_alternatives` (source lookup) | Unfiltered | Retired source allowed |
| ProductDetailPage `/products/:code` | Uses `getProductByIdentifier` | Retired → "Product not found" error state |
| DesignerV2 `/design/:code` | Uses `getProductByIdentifier` | Retired → `setLoadError` → 404 message |
| AI tool dispatch (`searchProducts`, `findAlternatives`) | Through the RPCs | Retired invisible |

**Opt-in callers** (must pass `{ includeRetired: true }`):
- [`CustomerDesigns.jsx`](../src/pages/account/CustomerDesigns.jsx) —
  saved-design gallery. Customer's design card still needs to render
  the product name/thumbnail; the purchase actions (Edit, Add to
  Quote) fall through to the v2 designer route which 404s for
  retired codes.
- Future: any order-detail page that resolves a `supplier_product_code`
  fresh from the row reference. Today order detail reads from
  `order_items` snapshot directly, so no opt-in needed yet.

### 51.4 Find-alternatives source lookup is intentionally unfiltered

The RPC's source-product SELECT does NOT exclude retired products.
Customers landing from a saved design or an order detail page may
legitimately want "what's similar?" for a now-retired SKU. The
neighbour set still excludes retired alternatives, so every result
remains orderable.

The endpoint-side `lookupSourceProduct` in
[`api/find-alternatives.js`](../api/find-alternatives.js) is also
unfiltered for the same reason. The 404 it surfaces is for "code
doesn't exist" / "not yet embedded", not "retired".

### 51.5 What this does NOT do

- **No `ItemIndicator` consumption.** Laltex's `ItemIndicator` field
  (`'Clearance'`, `'To Be Discontinued'`, `'New'`, …) is a separate
  signal from feed presence. We already round-trip it as
  `product_indicator` on `supplier_products` and the search RPC
  exposes it as a filter, but we don't act on `'To Be Discontinued'`
  automatically. Future enhancement.
- **No stocks-endpoint integration.** Laltex's `GET stocks/{code}`
  returns real-time stock levels with optional due-in dates.
  Retirement is about whether the product exists at all in the feed,
  not whether it's currently in stock. The two are orthogonal:
  `in_stock` is a different (also-soft) signal already on the row.
  Future enhancement.
- **No admin "view retired products" surface.** Admins inspecting
  retirement state today must query the DB directly:
  ```sql
  SELECT supplier_product_code, name, missing_from_feed_count, last_synced_at
    FROM supplier_products
   WHERE is_retired = true
   ORDER BY last_synced_at DESC;
  ```
  Admin-side UI is out of scope for this PR.

### 51.6 Invariants — DO NOT BREAK

- **DO NOT delete `supplier_products` rows for retired products.**
  Orders, saved designs, and analytics all reference them by id /
  code. Retirement is a soft-flag.
- **DO NOT bypass the `is_retired = false` filter in either RPC.**
  Same treatment as the 14-day staleness filter (§31.3) — lives
  inside the function precisely so callers can't disable it.
- **DO NOT include `missing_from_feed_count` or `is_retired` on the
  normaliser output.** They are sync-orchestrator-owned state, not
  feed-derived. The orchestrator stamps them onto the upsert payload
  in [`upsertChunk`](../scripts/lib/laltex-sync.js).
- **DO NOT touch `last_synced_at` on a missing-update.** It must
  continue to reflect when the row was last seen in the actual feed,
  for the staleness filter and any future audit.
- **DO NOT lower `RETIRE_THRESHOLD` below 2 without re-evaluating
  the false-positive risk.** At 1 strike, a single Laltex feed
  glitch retires real products and customers see "product not found"
  the next morning. At 3, the worst case is a 3-day delay before a
  genuinely retired product clears.
- **DO NOT use `is_retired = true` as a stand-in for `in_stock =
  false`.** The two are orthogonal. A product can be in-stock and
  retired (last day of selling old stock — though we'd typically
  retire after stock=0). A product can be out-of-stock and not
  retired (temporary supplier-side fulfilment problem). Keep the
  signals separate.
- **DO NOT remove `{ includeRetired: true }` from
  CustomerDesigns.jsx.** It's there so customers can see their saved
  work even after the product retires. Removing it makes the design
  card render as "Unknown Product" silently — confusing and
  unhelpful.
- **DO NOT add retirement filtering to `catalogue-embed.js`.** The
  embed cron is supplier-agnostic and should keep embedding retired
  rows so a reappearing product is immediately searchable on its
  next sync (counter resets, flag clears, embedding already
  present). Retirement is a read-side gate; the embed pipeline is
  upstream of that.

---

## 52. MIGRATION-FIRST DEPLOY RULE

### The hard rule

**When a PR introduces SQL migrations, ALL migrations must be applied
to production before the PR is merged.** Merging first and migrating
after is a production outage — every code path that references the
new schema fails until the columns exist.

### Required deploy-step checklist for migration PRs

Every PR that touches `supabase/migrations/` MUST include this exact
checklist in the PR body. Every item must be ticked before merge:

```
## Deploy steps (READ BEFORE MERGING)

☐ Migration files reviewed
☐ Migrations applied to production via Supabase Dashboard → SQL Editor
   (in numerical order, one at a time)
☐ Column / function / index existence verified with SELECT against
   information_schema / pg_proc / pg_indexes (paste verification SQL
   and result rows)
☐ If migration adds RPC: call the RPC once with a sample input,
   confirm shape matches
☐ Only NOW is it safe to merge
```

The verification step is non-negotiable. "I ran the migration" is not
the same as "I confirmed the migration landed". Pasted SELECT output in
the PR body is the auditable trail.

### Why the order matters

Vercel deploys within seconds of a merge to `main`. If the migrations
haven't run, the deploy lands code that immediately fails against the
old schema — every customer-facing route that references the new
column / RPC / index returns an error until someone manually applies
the missing migrations.

### Rollback guidance

If a migration PR is merged before its migrations are applied AND
production is broken:

1. **Apply the migrations immediately** via Supabase SQL Editor. This
   is the fastest recovery path — usually 30 seconds. The code is
   already deployed; bringing the schema up to meet it heals
   production in one step.
2. **Don't revert the merge.** Reverting puts production in a
   different broken state (columns now exist, deployed code no longer
   references them, and any subsequent PR depending on the reverted
   change has to be reworked). Forward-fix the schema, not backward
   the code.
3. **Document the incident in CLAUDE.md** if it surfaced a new
   failure mode the rule didn't cover.

### Exempt migration categories

These categories cannot break existing queries, so the merge-after-
apply rule does not bind them:

- **DOWN-only migrations.** Rollback paths applied separately after a
  confirmed bad migration.
- **Index-only migrations** that use `CREATE INDEX CONCURRENTLY`.
  Non-blocking and don't change query semantics — existing queries
  keep running, just unindexed, until the build completes.
- **Comment-only migrations** (`COMMENT ON COLUMN`, `COMMENT ON
  FUNCTION`, etc.) — pure documentation.

If you're not sure a migration fits one of these categories, treat it
as a binding migration and follow the full checklist.

### Origin: PR #29 (2026-05-18)

This rule was codified after PR #29 (retired-product handling) caused
a brief production outage. The PR was approved and merged before the
two migrations it required (`20260518_supplier_products_retired_flag.sql`
and `20260518_search_rpcs_exclude_retired.sql`) had been applied to
Supabase. Every Laltex product page returned "Product not found" until
Dave manually applied them via the SQL Editor. The PR body listed the
deploy steps but framed them as post-merge actions, which is the
wrong order whenever schema changes are involved.

### Invariants — DO NOT BREAK

- **DO NOT merge a migration PR without the checklist above filled in
  and ticked.** "I'll apply them right after merge" is exactly the
  pattern that caused PR #29.
- **DO NOT rely on Vercel preview deployments to test migrations.**
  Preview uses the same Supabase project as production for the DB
  layer; the only way to test the post-migration code is to apply
  the migration to that shared DB, which is the production apply.
- **DO NOT collapse multiple migrations into a single Dashboard
  paste.** Apply them in numerical order, one at a time, so a
  failure on migration N doesn't leave migration N+1 partially
  applied.
- **DO NOT skip the SELECT verification step** even for "obvious"
  schema additions. Schema-cache drift, transaction rollback inside
  a `BEGIN ... COMMIT;` block on error, or a Dashboard timeout can
  all silently leave the migration unapplied. The SELECT is the
  evidence that the change actually landed.

---

## 53. BUCKET-(A) DESIGNER RELAXATION — SMART GATE, BANNER, WATERMARK

Background: ~33% of Laltex products (390 of 1192 active, audited
2026-05-18) have full `print_details` entries but ZERO
`print_area_coordinates` anywhere. Pre-this-section those products
hid the Customize card entirely — `LaltexProductView.isDesignable`
gated on PAC presence and there was no fallback. After the
relaxation, products with at least one recognised position name are
designable via a no-rect Designer path: product photo, amber
disclaimer banner, watermarked export.

The full Phase 1 investigation report (heuristic sanity check
against 4 representative products) is in the
`feat/bucket-a-designer-relaxation` PR description. The short
version of why Option A (no on-canvas rect) is shipping instead of
the originally-spec'd rect overlay:

> Single canvas-fraction coordinates don't survive Laltex's variety
> of photo framings (model-worn / flat-lay / multi-product / mixed
> orientation). Every test product overlay landed wrong somewhere:
> hoodie rects on the model's face, cap rects on the model's chin,
> vertical-pen barrel rects as awkward horizontal slices. Drawing
> nothing is strictly better than drawing wrong — the banner copy
> and watermarked export do the semantic work.

### 53.1 The smart gate

`LaltexProductView.isDesignable` returns true when EITHER:

1. **Path 1 (PAC):** at least one position group has at least one
   row with at least one `print_area_coordinates` entry. Existing
   behaviour, unchanged by this section. CLAUDE.md §50 still
   applies to this path.
2. **Path 2 (heuristic recognition):** no PAC anywhere, but at
   least one position name canonicalises to an entry in
   `RECOGNISED_POSITIONS`.

Products that satisfy neither path stay hidden. The Customize card
disappears and a `mailto:artwork@promo-gifts.co` "Need help with
artwork?" fallback link renders below the Configure & Quote panel.

### 53.2 The recognition module

`src/utils/laltexPositionHeuristics.js` exports:

- `RECOGNISED_POSITIONS: Set<string>` — canonicalised position
  names that are designable. Apparel (Front, Back, Left/Right
  Breast, Left/Right Sleeve), Drinkware (Wrap, Bottle Front/Back,
  Front Centre, …), pen anatomy (Barrel, Barrel - Side 1/2, Clip,
  …), hard-good faces (Top, Lid, Side N, …), accessory positions
  (Patch, Band, Strap, …). Full list in the file; do not duplicate
  here.
- `TREATMENT_POSITIONS: Set<string>` — Laltex's production-
  treatment options that share the schema with real positions
  (`pantone`, `gold plating`, `hard enamel`, …). Products with
  ONLY these stay hidden.
- `PERSONALISATION_POSITIONS: Set<string>` — `individual names`.
  Per-unit personalisation is collected at quote time, not designed
  on the canvas.
- `canonicalisePosition(rawName)` — lowercases, trims, and strips
  everything before the last colon (collapses gift-set prefixes
  like `Goa Bamboo Ball Pen:Barrel` → `barrel`).
- `isPositionDesignable(rawName)` — single-position predicate.
  Returns false for any colon-containing name (gift-set exclusion —
  see §53.7), any treatment-only name, any personalisation name,
  and any unrecognised name.
- `isGiftSetProduct(positionGroups)` — product-level helper.
  Returns true iff any position in the array carries a colon.
- `isBucketADesignable(positionGroups)` — product-level smart-gate
  predicate (Path 2). Returns true iff the product is NOT a
  gift-set AND at least one position passes
  `isPositionDesignable`. This is the function `LaltexProductView`
  and `DesignerV2` call to decide Path 2 eligibility — neither
  should re-implement the gate inline.

`isBucketADesignable` is intentionally stricter than "at least one
designable position". Goa Bamboo (a real example) ships BOTH
colon-prefixed positions like `Goa Bamboo Ball Pen:Barrel` AND
clean siblings like `Barrel - Side 1`. The single-position check
would mark the clean siblings as designable; the product-level
check sees the colons and refuses the whole product. The latter
matches the intent: a gift-set canvas has no honest way to render
"Barrel - Side 1" because the customer can't tell which item (pen
vs pencil) the position refers to.

The module is **intentionally NOT a coordinate generator**. No rect
dimensions, no canvas-fraction values, no Fabric.js imports. It is
pure data + lookup.

### 53.3 The Designer path for bucket-(a)

`DesignerV2.jsx` derives `isBucketA` (no PAC anywhere AND at least
one designable position). When true:

- Position tabs are filtered to designable positions only
  (`displayedPositionGroups`). Treatment-only, personalisation, and
  gift-set positions don't render as tabs.
- The default active position picks by name priority (`Wrap` >
  `Front` > `Back` > first remaining) among designable positions.
  PAC products keep the existing `defaultOption`-row default.
- `renderPosition` short-circuits to `activeRow` so the image-load
  effect has something to drive. Since `activeRow.coordinates` is
  empty for bucket-(a), the existing no-coord branch in the
  image-load effect (lines around 525–635) naturally:
  - centres the image bounds (no rect to anchor on);
  - skips adding the print-rect overlay;
  - leaves `colourPreviewUnavailable` false (no mismatched-colour
    notice).
- The amber "Indicative position — *Position*. Our artwork team
  confirms exact placement at proof stage. Print area approx
  *PrintArea*." banner renders above the canvas card. `PrintArea`
  is interpolated from `activeRow.area`; the sentence is omitted
  if the field is missing.
- The PAC-specific Fix #2 amber notice ("Live preview available on
  *Wrap* only…") is suppressed in bucket-(a) — its
  `!positionsHaveDistinctRects` precondition trips for the wrong
  reason (no rects at all vs duplicated rects) and the banner
  above the canvas carries the right copy.
- Export bakes the mandatory watermark band into the rendered
  image (§53.5).

### 53.4 The "Need help with artwork?" fallback

When `isDesignable` is false (no PAC, no recognised position),
`LaltexProductView` renders a small grey-text link in the same
column where the Customize card would have lived:

```
Need help with artwork? <a>Get in touch</a>.
```

Target: `mailto:artwork@promo-gifts.co?subject=Artwork help - <code>`.
The artwork inbox is the documented support address for artwork
queries (CLAUDE.md §21.3), already configured on Resend with DKIM,
and the subject pre-fill carries the product code so the artwork
team has context.

There is no `/contact` route in the React app today; the existing
"Request Sample" button is an unwired placeholder. Linking to a
real, working mailto is strictly better than inventing a fictional
contact route.

### 53.5 The wearer-vs-viewer convention

Industry standard for apparel embroidery: **"Left Breast" =
wearer's left = viewer's right** when looking at a front-on model
photo. "Right Breast" = wearer's right = viewer's left.

Currently this convention does not influence any rendered UI
element because Option A renders no rect. It IS relevant to the
proof team's manual placement work — when a customer says "Left
Breast" they mean the wearer's left, and the proof should reflect
that regardless of which side of the photo it appears on.

If a future iteration revisits Option C (per-image bounding-box
pipeline + rect placement), the convention is locked: left/right
in position names refers to the wearer, not the viewer.

### 53.6 The export watermark

`fabricCanvasManager.exportCanvasAsPNG` and `exportCanvasAsPDF`
accept an optional `indicativeBanner: { positionName: string }`
parameter. When set, the helper temporarily adds two Fabric
objects to the top of the canvas before `toDataURL`:

- A dark-grey `Rect` (`fill: rgba(55, 65, 81, 0.95)`), full canvas
  width, 32 canvas units tall, anchored at (0, 0).
- A white 12px `Text` reading `"INDICATIVE POSITION — confirm
  placement at proof stage. Customer intent: <PositionName>."`,
  origin-left, 8px padding, vertically centred in the band.

The objects are removed in a `finally` block immediately after
`toDataURL` returns, so the on-canvas UI never shows the band —
the watermark is intrinsic to the exported pixels only. The
customer cannot opt out and the proof team cannot receive an
export without it.

`hideWatermark: true` (the existing parameter, distinct from the
new `indicativeBanner`) still hides the legacy on-canvas
watermark id. The two are independent.

PAC-driven exports continue to receive `indicativeBanner: null`
and remain visually clean.

### 53.7 Gift-set exclusion (re-evaluated post-launch)

Any position name containing a colon character is treated as a
gift-set item and is **not** designable in this iteration, even
when the post-colon suffix is a recognised name (e.g. `Goa
Bamboo Ball Pen:Barrel` would otherwise canonicalise to
`barrel`, which is recognised). The exclusion is enforced in
`isPositionDesignable` and reflected in the gift-set test case
in the PR verification matrix.

Re-evaluate after the main relaxation ships and we have real
customer signal on bucket-(a). The colon-rule is conservative —
removing it unlocks ~10–20 products at the cost of representing
a multi-item set on a single canvas, which has its own UX
problems.

### 53.8 Invariants — DO NOT BREAK

- **Do NOT bypass the smart gate.** Bucket-(a) products without
  a recognised position should never reach DesignerV2. The
  Customize card's gate AND the `isBucketA` derivation in
  DesignerV2 both rely on `isPositionDesignable` for consistent
  behaviour.
- **Do NOT add an on-canvas rect for bucket-(a) products** without
  revisiting the Option-A decision. Phase 1 of the investigation
  verified that any single-fraction heuristic falls over on at
  least one common Laltex photo style. Restoring rects requires
  a per-image bounding-box pipeline (Option C, currently parked).
- **Do NOT strip the export watermark.** It's mandatory on every
  bucket-(a) PNG/PDF export so the proof team can never receive
  an artwork file without the "INDICATIVE POSITION" callout. The
  customer-facing path through `runExport` always sets
  `indicativeBanner` based on `isBucketA`; there is no
  override.
- **Do NOT extend `RECOGNISED_POSITIONS` speculatively.** Add
  values only when audit evidence shows real Laltex products use
  the new name. The current set was authored from the §1 audit
  in the investigation report against the live catalogue.
- **Do NOT add coordinate values to the heuristic module.** It is
  a recognition module, not a placement module. If a future
  Option-C pipeline needs coordinates, store them in a new file
  alongside the per-image bbox data — keep recognition and
  placement as separate concerns.
- **Do NOT remove the gift-set colon-exclusion** without a fresh
  decision. The re-evaluation is a deliberate post-launch step
  (§53.7), not a tidy-up cleanup.
- **Do NOT change the "Need help" link to a non-existent route.**
  `mailto:artwork@promo-gifts.co` is real, working, and routes
  to the correct inbox. A fictional `/contact` page would 404.
- **Do NOT propagate the bucket-(a) banner to PAC products.** The
  amber "Indicative position" banner is gated on `isBucketA`. PAC
  products have their own existing banners (Fix #1 colour-
  preview-unavailable, Fix #2 single-rect-multi-position lock)
  that serve different cases.
- **Do NOT move the `isBucketA` useMemo below the default-position
  useEffect in DesignerV2.jsx.** The effect references `isBucketA`
  during its deps array construction; a useMemo declared below would
  TDZ and silently break the page. The useMemo's intentional
  position above the effect block is documented inline at the
  declaration site.

---

## 54. CIRCULAR PAC ZONES (engraving, etching, label diameter prints)

Laltex's API V1.7 ships two PrintAreaCoordinate shapes interchangeably
in the same `PrintAreaCoordinates[]` array:

| Shape | Width | Height | Diameter | PrintArea string |
|---|---|---|---|---|
| Rectangle | populated | populated | null | `"100x70mm"` |
| Circle | null | null | populated | `"40mm dia."` |

The parser ([scripts/lib/laltex-parser.js](../scripts/lib/laltex-parser.js))
has handled both since session 4 — every PAC entry persisted in
`supplier_products.print_details[].print_area_coordinates[]` carries
either `(width, height)` or `diameter`, plus a `shape: 'rectangle' |
'circle'` discriminator. **The data has always been correct.**

Pre-§54 the DesignerV2 render code ignored `shape` and treated null
W/H as a zero-dimension rect (`Number(null) * scale === 0`),
producing an invisible 0×0 overlay. 63 active Laltex products
(distinct count; ~380 PAC entries across colour variants) were
affected — speakers, engraved bottles, frisbees, stress-balls,
seed-kit lids, pen tops, and any other product where the print zone
is naturally circular. ZA0176 (NOVA Bluetooth Speaker) was the
canonical example.

### 54.1 The render branch

[DesignerV2.jsx ~L733-820](../src/pages/DesignerV2.jsx) chooses one
of three paths inside the `if (colourCoord) { … }` block:

1. **`shape === 'circle' && diameter > 0`** → render a
   `fabric.Circle` with `originX/Y='center'`, centred at
   `(x + diameter/2, y + diameter/2)` after `imageLeft/Top + scale`
   translation.
2. **shape is rectangle/unset AND `width > 0 && height > 0`** →
   existing `fabric.Rect` path, unchanged.
3. **Malformed PAC (no usable W/H AND no usable diameter)** → draw
   nothing. The product image still loads; the customer sees the
   photo without geometric guidance.

The malformed branch is **defensive only** — no products in the
audit hit it after the §54 fix lands, but the pre-§54 code path
silently drew an invisible 0×0 rect which confused export logic.
Falling through to no-overlay is strictly safer than rendering
zero-dimension geometry.

### 54.2 X/Y convention — top-left, same as rects

Laltex's `Xpos`/`YPos` for circles is the **top-left of the
bounding box**, not the centre. Verified in Phase 1 via visual
overlay against ZA0176, MG0119, PS0045, TA0211
([scripts/diagnostic/circular-pac-xy-convention.html](../scripts/diagnostic/circular-pac-xy-convention.html)).
All four products' engraving zones aligned with the top-left
interpretation; the centre interpretation was offset upper-left
in every case.

For `fabric.Circle` with `originX/Y='center'`, the `left`/`top`
properties refer to the centre point. The translation:

```js
const diameter = Number(colourCoord.diameter) * scale;
const radius = diameter / 2;
const left = Number(colourCoord.x) * scale + imageLeft + radius;
const top  = Number(colourCoord.y) * scale + imageTop  + radius;
```

### 54.3 Visual styling — transparent fill, blue dashed stroke

Stroke colour `#3b82f6` (same as rect overlay). Dash pattern `[6, 4]`
(same). Stroke width `1.5px` (same). **Fill is `transparent`**
(distinct from the rect's `rgba(59, 130, 246, 0.08)` light blue
tint).

Why transparent for circles, tinted for rects:
- Engraving zones are small (typically 25–40mm diameter) and the
  tinted interior reads heavy at typical canvas scales.
- Rects cover larger surfaces (T-shirt fronts, mug wraps) where
  the tint helps the customer perceive the print boundary.
- The customer should perceive both as "same level of authority"
  (Laltex-supplied, geometrically accurate). The dashed blue stroke
  carries the trust signal; the fill is a presentation detail.

This is **not** the amber bucket-(a) treatment. Circular PAC products
are PAC-driven (Path 1 in the smart gate); they get the same trust
treatment as rect-PAC products. No amber banner. No watermark on
export.

### 54.4 Mixed-shape products

6 of the 63 affected products carry BOTH rect positions and circle
positions on the same product:

| Code | Name | Mix |
|---|---|---|
| PN3025 | Marico Chalk Set | rect Front/Back + circle Lid |
| SS0505 | Stress Heart | rect Front/Back + circle Front/Back (different sizes) |
| TA0121 | Rainbow Foldable Flying Disk | rect Pouch + circle Disc |
| TA0211 | Foldable Frisbee | rect Pouch + circle Disc |
| TPC950601 | HI-Chrome Ball Pen | rect Barrel positions + circle "Top Circle of Pen" |
| TPC951401 | HI-Chrome Roller Ball Pen | same shape as TPC950601 |

When the customer toggles position tabs, the overlay switches
between rect and circle accordingly. The per-position render is
independent — no special handling needed beyond the shape branch
at §54.1.

### 54.5 No parser change, no resync, no migration

The data is already in place. Persisted PAC entries already carry
`shape` and `diameter`. The fix is render-only — single file
change in DesignerV2.jsx. The 63 affected products go from broken
to correct at deploy time without any data manipulation.

### 54.6 PRINT_AREA_OVERLAY_ID is shared

Circle and rect both use the same `PRINT_AREA_OVERLAY_ID`
constant. Export-time chrome stripping in
[fabricCanvasManager.js](../src/utils/fabricCanvasManager.js)
finds objects by id and hides them regardless of underlying shape
class. Save-time `userObjects` filter at DesignerV2.jsx:704
excludes the overlay by id — same uniform treatment.

Future-proofing note: if a third shape ever lands (Laltex's V1.8+
or another supplier), the same id should be reused. Anything
keying on `instanceof fabric.Rect` would silently break — don't
introduce such guards.

### 54.7 Diagnostic helpers (committed)

- [scripts/diagnostic/probe-circular-pac.mjs](../scripts/diagnostic/probe-circular-pac.mjs)
  — full audit: raw_payload field shape, PrintArea variety,
  per-product breakdown, mixed-shape detection.
- [scripts/diagnostic/probe-persisted-diameter.mjs](../scripts/diagnostic/probe-persisted-diameter.mjs)
  — quick check that persisted PAC entries carry `shape` and
  `diameter`. Run after any parser change to confirm
  round-tripping.
- [scripts/diagnostic/circular-pac-xy-convention.html](../scripts/diagnostic/circular-pac-xy-convention.html)
  — visual overlay harness for confirming Laltex's X/Y convention.
  Useful if a future API version changes the anchor.

### 54.8 Invariants — DO NOT BREAK

- **Do NOT branch on `instanceof fabric.Rect`** to decide overlay
  behaviour. Both Circle and Rect share `PRINT_AREA_OVERLAY_ID`;
  type checks are the wrong signal.
- **Do NOT add a tinted fill to the circle overlay** without
  re-evaluating against the typical engraving size. The
  transparent fill (A2 decision, 2026-05-18) was chosen
  deliberately. The rect's tinted fill stays — the styling
  divergence is intentional, not a bug.
- **Do NOT remove the malformed-PAC fall-through.** Today no
  products hit it; tomorrow's Laltex feed change might. A
  zero-dimension Fabric Rect is worse than nothing.
- **Do NOT change the X/Y convention** from top-left without
  re-running the visual harness against fresh products. Laltex's
  API V1.7 documents this convention; V1.8+ MAY differ.
- **Do NOT introduce an "amber circle banner" path** for circular
  PAC products. They are PAC-driven (Path 1); the bucket-(a)
  amber banner is exclusively for Path 2 (no-PAC) products. The
  trust signals must stay distinct.
- **Do NOT consume `MarkedImageUrl` on circular PAC entries** any
  more than on rect entries. CLAUDE.md §50.4 still applies —
  marked images are customer-mockup samples, not authoritative
  references.
- **Do NOT special-case the 6 mixed-shape products.** The
  per-position render is independent by design. Anything that
  branches on "is this a mixed-shape product" introduces a
  classification step that drifts as Laltex's feed changes.

---

## 55. AI CHAT "SHOW ME MORE" PAGINATION + HEADER SEARCH REMOVAL

Two homepage-related changes shipped together:

1. **Header search bar removed.** The desktop + mobile search inputs
   in [HeaderBar.jsx](../src/components/HeaderBar.jsx) were not
   wired to anything functional and caused mobile layout problems.
   Removed cleanly — flex layout reflows; no placeholder, no
   "search via Ava" CTA, no replacement at all.
2. **AI chat product-card pagination.** Ava's product responses now
   return up to 20 matches; widget renders the first 5 immediately
   and reveals the next 5 per click on a "Show me more →" card.
   Pure client-side pagination from a pre-loaded cache — no extra
   chat round-trip, no LLM cost, no quota tick on expansion.

### 55.1 Pagination contract

| Layer | Behaviour |
|---|---|
| Tool (`scripts/lib/ai-tools.js`) | **Unchanged.** Schema lives in the cached system+tools prefix (CLAUDE.md §32.4) — touching it invalidates the cache. The model's `limit` parameter still defaults to 10 / max 50. |
| Chat endpoint ([api/ai/chat.js](../api/ai/chat.js)) | Accumulates products from every tool call this turn (`productCardMap`). At end-of-turn, caps the result set at **20**, then splits: first **5** go in `products`; remaining (up to 15) go in `products_remainder`. `total_matches` reports the post-cap count. |
| Widget ([AIChatWidget.jsx](../src/components/AIChatWidget/AIChatWidget.jsx)) | Each message holds `products` (currently visible) and `products_remainder` (cached for expansion). Renders one `ProductCard` per visible entry, then a `ShowMoreCard` if remainder is non-empty. Click handler shifts **5** items from remainder to visible. |

Constants:

| Constant | Value | Location | Purpose |
|---|---|---|---|
| `PRODUCT_CARDS_CAP` | 20 | `api/ai/chat.js` | Hard ceiling for product cards surfaced per turn. Beyond that the customer should refine the query. |
| `INITIAL_BATCH_SIZE` | 5 | `api/ai/chat.js` | Cards rendered immediately on response. |
| `SHOW_MORE_BATCH_SIZE` | 5 | `AIChatWidget.jsx` | Cards revealed per "Show me more" click. |

### 55.2 Why pre-loaded vs paginated-RPC

Three reasons the cache lives client-side rather than re-calling
the tool on expansion:

- **Latency.** Each tool round-trip is ~500-800ms on Vercel
  (Anthropic API + RPC + slim). Pre-loading 20 cards once
  collapses N pagination clicks into N free reveals.
- **No extra LLM cost.** The Anthropic system+tools cached prefix
  is the expensive part of each turn; "Show me more" doesn't
  reset the cache, but it doesn't even reach Anthropic in the
  pre-loaded model. Zero token cost.
- **No quota tick.** Anonymous users have 5 `searchProducts` calls
  per 24h. Pagination would burn through the cap on a single
  result set. Pre-loading respects the quota.

The cost: response payload grows from ~5 cards to ~20 cards per
turn. Each slimmed card is ~600-800 bytes after `slimProduct`, so
20 cards × 800 bytes ≈ 16 KB — negligible vs the existing 5-card
~4 KB baseline. Network cost stays under 50 KB for the chat
endpoint's typical response.

### 55.3 Edge-case behaviour

- **Fewer than 5 matches:** All matches go in `products`,
  `products_remainder` is empty, no Show More card. Today's
  behaviour for sparse queries.
- **Exactly 5 matches:** Same as above. `products_remainder.length
  > 0` is the gate; equality at 5 means nothing more to show.
- **Cap reached (>20 matches accumulated):** Sliced to 20. The
  "Show me more" card disappears after the customer fully expands
  — there is no "even more" reveal. Refine query message would be
  premature at this scale; just hide the card silently.
- **Customer asks a follow-up while a Show More card is showing:**
  The previous message's pagination state persists. Each message
  carries independent `products` + `products_remainder`. Scrolling
  back and clicking "Show me more" on the older message works
  exactly as if it were the latest.
- **Mobile chat panel:** Same batch size (5). Vertical stacking on
  mobile means 5 cards is more scroll, but consistency beats a
  separate mobile cap. Don't size-shift per viewport.

### 55.4 ShowMoreCard styling

Soft indigo tint (`rgba(99, 102, 241, 0.08)` background,
`rgba(99, 102, 241, 0.35)` border, `#4f46e5` text). Centred
**"Show me more →"** label in 600-weight 13px. Full width within
the cardListStyle column.

Intentionally distinct from `ProductCard` (white background, grey
border, left-aligned, image + name + price). The customer should
read the row as an action button, not as another product.

### 55.5 Header layout integrity

`HeaderBar.jsx` is the only shared header used across product
detail, category, account, and admin pages. Removed:

- `Search` from the lucide-react import.
- `searchQuery` state declaration.
- The desktop search div (`hidden lg:flex flex-1 max-w-2xl mx-8` wrapper).
- The mobile search div (`lg:hidden pb-4` wrapper, including its inner relative+input).

The remaining flex layout — logo+phone on the left,
Sign In / Cart / Mobile menu button on the right — collapses
naturally without the centre element. No placeholder div added;
no z-index orphans.

The page-level Navbar.jsx (a different, less-used component) keeps
its placeholder search input — out of scope for this PR. Only the
shared HeaderBar.jsx changed.

### 55.6 Invariants — DO NOT BREAK

- **Do NOT call a tool on "Show me more" click.** Pagination is
  pure client-side state from `products_remainder`. Adding a
  network call here ticks the quota and breaks the response-time
  promise.
- **Do NOT extend `PRODUCT_CARDS_CAP` beyond 20.** Bigger result
  sets defeat the point of pagination — past 20 the customer
  should refine the query rather than scroll forever. A future
  change to this number is a deliberate decision, not a tidy-up.
- **Do NOT change `INITIAL_BATCH_SIZE` or `SHOW_MORE_BATCH_SIZE`
  to different values.** Keeping them both at 5 makes the rhythm
  predictable. Asymmetric batch sizes (e.g. 5 then 10) are a UX
  decision that needs its own evaluation.
- **Do NOT size-shift the batch size based on viewport.** Mobile
  customers should see the same pagination cadence as desktop;
  scroll length is the only difference.
- **Do NOT move pagination state to a global store.** Each message
  carries its own `products` + `products_remainder`. Moving to a
  global store breaks the "scroll back and keep expanding"
  behaviour and adds reconciliation complexity for zero benefit.
- **Do NOT change the system prompt or tool schemas to teach Ava
  about pagination.** Pagination is widget UI, not prose. Ava
  still describes the products conversationally; the Show More
  card handles "more available" surfacing on its own.
- **Do NOT re-add a search input to HeaderBar.jsx.** If a search
  feature is wanted in the future, it should route through Ava
  (existing AI chat surface) rather than a separate parallel
  search bar. The shared header's centre column is intentionally
  empty.
- **Do NOT touch `Navbar.jsx`'s placeholder input.** Out of scope
  for this PR and used in fewer places; separate cleanup decision.

### 55.7 Card accumulation — mentioned-first, top up from unmentioned (Fix A)

PR #33 shipped the Show-me-more pagination but the card never
appeared in practice because the prior accumulation logic only
included products Ava explicitly named by code in her prose:

```js
// pre-Fix-A
const cards = (mentioned.length > 0 ? mentioned : allCards).slice(0, PRODUCT_CARDS_CAP);
```

Ava typically names 3-5 products per response. So `cards.length`
was 3-5 in the typical case, the cap of 20 never bit, and
`products_remainder` was empty. The Show-me-more card was
correctly gated on `products_remainder.length > 0` (CLAUDE.md
§55.3) so it never rendered.

The fix (PR #34, [api/ai/chat.js](../api/ai/chat.js)) keeps the
mentioned products first — preserving Ava's editorial choice and
the prose↔card alignment — but tops up from `allCards` minus
mentioned, until `PRODUCT_CARDS_CAP` is reached:

```js
// Fix A
const mentionedCards    = allCards.filter((c) => mentionedCodes.has(c.supplier_product_code));
const unmentionedCards  = allCards.filter((c) => !mentionedCodes.has(c.supplier_product_code));
const cards             = [...mentionedCards, ...unmentionedCards].slice(0, PRODUCT_CARDS_CAP);
```

Three properties this preserves:

1. **Mentioned-first ordering** — Ava's editorial intent is the
   anchor. A customer reading "Hoodie, HF0003, HF0001..." in the
   prose sees those products at the top of the card list in the
   same order. Mentioned products inside `allCards` keep their
   original order (which is `final_score` descending from
   `rpc_search_supplier_products`).

2. **Stable unmentioned ordering** — appended in the order
   `allCards` lists them. No re-ranking, no shuffling.

3. **Edge cases unchanged**:
   - `mentioned.length === 0` (rare — Ava names no codes): falls
     through to `unmentionedCards === allCards` and the entire pool
     is used. Same outcome as the pre-fix `else` branch.
   - `allCards.length <= INITIAL_BATCH_SIZE` (sparse query): all
     cards go to `productCards`, `productCardsRemainder` is empty,
     no Show-me-more card. Matches the §55.3 sparse-query rule.

#### Why "Show me more" works ONLY when the tool returns more candidates than Ava mentions

The pagination depends on `allCards.length > mentioned.length`
holding for the typical query. Today the underlying
`searchProducts` tool defaults to `limit: 10` (max 50) — Ava
usually requests 10, mentions 3-5, the remaining 5-7 land in
`products_remainder`. If a future change tightens the tool's
default `limit` below ~6, pagination shrinks alongside it.

The tool schema lives in the cached prefix (CLAUDE.md §32.4) so
changes are deliberate and rare — but worth knowing the
dependency. Don't tighten the default below 10 without thinking
about pagination.

#### Diagnostic — verifying pagination works in production

For any query that should yield 8+ candidates:

1. Open DevTools Network tab.
2. Send the query to Ava.
3. Inspect `/api/ai/chat` response payload:
   - `products.length` should equal 5
   - `products_remainder.length` should be 1-15
   - `total_matches` should be > 5
4. Click "Show me more" in the chat UI.
5. **No new `/api/ai/chat` request** should fire — pagination is
   pure client-side state (CLAUDE.md §55.2).

If `products_remainder.length === 0` for a query that should be
broad: the bug is likely that the LLM's `limit` request to
`searchProducts` was too low. Inspect `tool_calls[].input.limit`
in the response and check it isn't being clamped server-side
unintentionally.

#### Invariants — DO NOT BREAK (Fix A specific)

- **Do NOT drop the mentioned-first prioritisation.** Pure
  `allCards.slice(0, cap)` would put unmentioned products above
  mentioned ones whenever `final_score` ranks them higher,
  breaking the prose↔card alignment that customers rely on.
- **Do NOT add a third tier (e.g. "mentioned, then core-product
  boosted, then rest")** without a fresh decision. The current
  two-tier scheme is the minimum complexity that fixes the bug;
  more tiers re-introduce the editorial-vs-relevance tension
  this fix sidesteps.
- **Do NOT change the tool's default `limit` below 10** without
  thinking about pagination. If `limit` drops to 5, Ava asks for
  5, mentions all 5, `unmentionedCards` is empty, Show-me-more
  hides — the bug returns under a different cause.

---

## 56. CATEGORY PAGE LALTEX CURATION

Category pages (`/water-bottles`, `/bags`, `/cables`, …) previously
rendered only PGifts Direct products. Laltex's ~1,160 active
products weren't surfaced on category pages because Laltex's
`category` / `sub_category` fields are too messy to auto-derive
against (e.g. "Misc Drinkware" containing both mugs and bottles).

This section documents the editorial curation system: each
category page reads from `category_product_curation` (Dave-controlled
or future admin-UI-controlled) to render a slug-specific list of
Laltex products. The shared `CategoryPage.jsx` component
data-gates three new sections on the curation table being
non-empty for the current slug.

### 56.1 The data-gated shared-component model

All 11 category routes (`Bags`, `Cables`, `Clothing`, …) delegate
to a single shared component at
[src/components/CategoryPage.jsx](../src/components/CategoryPage.jsx)
via one-line wrappers in `src/pages/categories/*.jsx`. The shared
component:

1. Fetches the existing PGifts Direct category data
   (`catalog_categories` + `catalog_products`). Unchanged.
2. Fetches curated Laltex products via
   `getCuratedCategoryProducts(slug)` from
   [productCatalogService.js](../src/services/productCatalogService.js).
3. Derives `hasCuration = curatedProducts.length > 0` and
   conditionally renders three new sections on that flag.

Categories without curation rows (every category except
water-bottles on PR #36's deploy day) hit `hasCuration === false`
and render identically to the pre-§56 page. **The PR #36
verification matrix explicitly tested all 10 unseeded categories
for visual unchanged-ness** — Option A's safety depends on this
gate.

Adding a new category to the curation programme is **seed-only**:

1. `INSERT INTO category_product_curation` rows for the new slug,
   with positions 1..N in editorial order.
2. Add an entry to `AVA_COPY` in `CategoryPage.jsx` with
   category-specific prefill / welcomeMessage / placeholderText.
3. Done. No JSX changes, no new route, no per-category page file.

If `AVA_COPY` doesn't have an entry for a slug, `resolveAvaCopy`
falls back to a generic template using the category name. The
fallback is acceptable as a "shipped without final copy" state;
prefer to add the explicit entry alongside the seed migration.

### 56.2 Three new sections (all gated on `hasCuration`)

1. **Ava prompt card** — below the page title, above the feature
   strip. Renders the [`AvaPromptCard`](../src/components/AvaPromptCard.jsx)
   component with slug-specific `prefill` / `welcomeMessage` /
   `placeholderText`. Click dispatches `pgifts:open-chat` (CLAUDE.md
   §49) which opens the global chat widget pre-filled.
2. **Unified product grid** — PGifts Direct products and curated
   Laltex products render in a SINGLE 4-column grid for visual
   continuity. PGifts Direct cards come first (preserving the
   existing "Best Seller" badge + full description), then Laltex
   cards append in curation order. No row break, no empty cells
   between the two pools. Grid classes
   `grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8` match the
   pre-merge PGifts Direct values precisely — the 10 unseeded
   categories render identically to today (their rendering doesn't
   even reach the new Laltex appendix because `hasCuration` is
   false). Card click routes diverge by source: PGifts Direct uses
   `/<categorySlug>/<slug>`, Laltex uses `/products/<code>` (§56.5).
3. **Load more button** — below the curated grid, only when
   `visibleCuratedCount < curatedProducts.length`. Reveals the
   next `CURATED_LOAD_MORE_STEP` (16) cards from local state.
   Pure client-side pagination — no network call, same pattern
   as Ava's "Show me more" (CLAUDE.md §55).

`CURATED_INITIAL_VISIBLE = 16` and `CURATED_LOAD_MORE_STEP = 16`.
The 4×4 visual contract is the rationale; raising either is a
deliberate decision.

### 56.3 The service helper

`getCuratedCategoryProducts(slug)` lives at
[productCatalogService.js](../src/services/productCatalogService.js)
and:

- Selects from `category_product_curation` filtered by `category_slug`,
  ordered by `position` ascending.
- For each row, resolves the supplier_products row via
  `getSupplierProductByCode(code)` which inherits the
  `is_retired = false` filter (CLAUDE.md §51).
- Returns normalised products via `normaliseProduct(row, supplierSlug)`.
- **Silently drops** rows where the supplier_products lookup
  returns null (retired, deleted, or migration not yet applied).
  The page still renders the rest. Don't surface the drop to the
  customer — it's not actionable from their end.
- **Never throws.** Catches and returns `[]` on any error.
  Page-level effect handles this as "no curation, render existing
  PGifts Direct path unchanged" — graceful degrade. This means
  even a pre-migration deploy (Vercel ships the code before Dave
  runs the migration SQL) renders correctly: every category looks
  like today's production.

### 56.4 Card thumbnail — `plain_images[0]` first

The curated grid's card thumbnail reads from:

```
colour0.plainImages[0]    →  per-colour plain (clean) image
colour0.images[0]          →  per-colour ItemImages (may carry mockup branding)
product.images[0].url      →  top-level fallback
```

`plain_images[0]` is the load-bearing source. ItemImages may
carry a customer-mockup brand on the product (CLAUDE.md §50.2 —
the "BLACKBRIDGE" bug from session 7), which is why the chain
prefers plain.

### 56.5 Click-through routing — `/products/<code>`

Curated cards route to `/products/<supplier_product_code>` (the
generic supplier route from App.jsx) — NOT
`/<categorySlug>/<slug>` which is the PGifts Direct catalog route.
Laltex products don't have a slug in the catalog table; they
identify by `supplier_product_code` only.

### 56.6 Migration-first deploy (CLAUDE.md §52)

`category_product_curation` is a new table. The PR ships the
migration in `supabase/migrations/20260519_category_product_curation.sql`
(+ `.down.sql`). Per CLAUDE.md §52, the migration **must be applied
to production via Supabase SQL Editor BEFORE merging** the PR.

The graceful-degrade fetch (§56.3) means an unapplied migration
won't crash production — the new sections just don't render. But
the seeded water-bottles surface won't render until the table
exists and is populated.

### 56.7 Invariants — DO NOT BREAK

- **Do NOT bypass `is_retired = false`** in
  `getCuratedCategoryProducts`. Use the existing
  `getSupplierProductByCode` helper which respects the filter by
  default. A retired curated product must silently drop, not
  surface in the grid.
- **Do NOT use `images[0]`** (ItemImages) for the card thumbnail.
  Use `plainImages[0]` first — see §50.2 for the BLACKBRIDGE
  precedent. Top-level `images[0].url` is the final fallback only
  when no per-colour image exists.
- **Do NOT add a network call on "Load more" click.** Pure local
  state — slice from `curatedProducts` into `visibleCuratedProducts`.
  Same pattern as CLAUDE.md §55.
- **Do NOT auto-derive Laltex products from `category` or
  `sub_category` fields.** Laltex's field hygiene is poor (mugs in
  "Misc Drinkware", etc.); the curation table is the editorial
  safety net.
- **Do NOT raise `CURATED_INITIAL_VISIBLE` or
  `CURATED_LOAD_MORE_STEP` above 16** without a fresh decision.
  The 4×4 grid is the visual contract.
- **Do NOT make the new sections unconditional.** `hasCuration`
  must gate the Ava widget AND the curated grid AND the Load more
  button. Categories without curation rows render exactly as they
  do today. The PR #36 regression matrix verifies all 10
  unseeded categories visually unchanged — that contract holds
  forever as new categories get seeded.
- **Do NOT bespoke a per-category page when adding a new category.**
  Follow the established pattern: seed
  `category_product_curation` rows, add an `AVA_COPY` entry,
  done. The shared component handles the rendering.
- **Do NOT refactor `Home.jsx`'s inline Ava widget** to use
  `AvaPromptCard`. The homepage cycles through phrases via
  `AvaTypewriter` and uses a different layout (larger avatar,
  multi-phrase typewriter); the shared component is single-phrase.
  Migrating Home.jsx is a separate decision.
- **Do NOT route curated cards to `/<categorySlug>/<slug>`.**
  That's the PGifts Direct catalog route. Laltex products use
  `/products/<supplier_product_code>` (the generic supplier route).
- **Do NOT remove the graceful-degrade catch** in the curation
  fetch effect. An unapplied migration, an RLS hiccup, or a
  pre-merge deploy where Vercel ships the code first MUST render
  the page like today's production — not crash, not show empty
  state.
- **Do NOT split PGifts Direct and curated Laltex into separate
  grid wrappers.** The visual contract is one continuous
  catalogue: PGifts Direct cards first, Laltex cards appended in
  the same grid. Splitting them creates a row break with empty
  cells (the original PR #36 visual bug — fixed in PR #37). Both
  pools share the `grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8`
  wrapper.

---

## 57. MARGIN SCHEDULE (v2, May 2026)

Default Laltex margin schedule, applied to
`supplier_products.product_pricing[].sell_price` and
`print_details[].print_price[].sell_price` at sync time and on recompute.
Lives in [`scripts/lib/laltex-margin.js`](../scripts/lib/laltex-margin.js)
(`DEFAULT_SCHEDULE` + `scheduleMarginForTier`).

| Tier (by tier `min_qty`) | Margin |
|---|---|
| qty < 100 | 35% |
| qty 100–249 | 30% |
| qty 250–499 | 25% |
| qty 500–999 | 22.5% (`0.225`) |
| qty 1000+ | 20% |

`DEFAULT_SCHEDULE_VERSION = 2` (v1 was 22/20/18% across 3 tiers).

Raised from v1 in May 2026 after margin analysis showed v1 produced sub-10%
net margin on commodity products like the RC1015 Bamboo Nail File after the
~3% card-processing fee, making the business non-viable. v2 also added two
high-volume margin bands (500–999, 1000+) to reward bulk orders — the setup +
carriage amortisation at those volumes keeps the lower stated margins healthy
in real terms.

The margin is applied **per pricing tier by `tier.min_qty`**, not by the
customer's actual order quantity (CLAUDE.md §46.3). A product only gets the
22.5% / 20% bands if its Laltex quantity breaks actually include a tier with
`min_qty ≥ 500` / `≥ 1000`; the schedule adds margin *bands*, not new price
rows.

**Override behaviour unchanged:** `supplier_products.margin_pct_override`
(numeric, `[0,1)`) takes precedence over the schedule when set. Overrides are
flat across all tiers — a `0.25` override means 25% margin at every quantity.
Current override count: zero.

**PGifts Direct (25 rows) is unaffected** — it prices off
`catalog_pricing_tiers` / `catalog_print_pricing`, not this schedule.

### 57.1 Invariants — DO NOT BREAK

- **Any schedule change MUST bump `DEFAULT_SCHEDULE_VERSION`** and then run
  `node scripts/recompute-laltex-margins.js` (all rows) or `--stale-only`.
  Without the recompute, stored `sell_price` values drift out of sync with
  the live formula and the version stamp lies.
- **Use exact decimals** — 22.5% is `0.225`, never `0.22`/`0.23`.
- **Do NOT include `margin_pct_override` in any sync/migrate UPSERT body**
  (CLAUDE.md §46.5) — it is admin-owned state.
- **The recompute writes `sell_price` only** (product + print, margin baked);
  delivery stays a read-time concern (§46, decision B1-A). Do NOT bake
  delivery into `sell_price`.
- **After a recompute, the product cache must be cleared** — redeploy Vercel
  (the module-level cache from PR #44 holds prices up to ~5 min and can't be
  reached from a server-side script).

---

## 58. BRANCH HYGIENE AND POST-MERGE VERIFICATION

Two lessons from the PR #60 incident, where signup verification shipped broken
to production even though the PR showed "Merged" and its local tests passed.
Both close the gap between "PR merged" and "code actually live on `main` and
deployed."

### 58.1 Branch base rule — branch off `main`, never stack

Any PR that must reach `main` MUST be branched off `main`. Do NOT stack a fix
branch on another open feature branch for "review clarity." GitHub's
**squash-merge of the parent strands the child**: the parent's squash commit
captures only the parent's own changes, the child's commits stay on the
now-defunct parent branch, and the child PR can even read as "Merged" (merged
*into the parent branch*, not `main`) without a single line reaching `main`.

That is exactly how PR #60's click-to-verify `AuthCallback.jsx` was lost: it
was opened with `--base feat/email-verification-callback` (#59's branch),
merged into that branch, and vanished when #59 was squash-merged to `main`.
Production kept running #59's incompatible version. See
[`audit-authcallback-live-failure.md`](../audit-authcallback-live-failure.md).

**If a stacked PR is genuinely unavoidable**, it is NOT done when GitHub says
"Merged." After the parent merges, confirm the child's code reached `main`:

```
git fetch origin && git checkout main && git pull --ff-only
git grep -n "<distinctive_symbol_from_child_PR>" -- <file_path>
```

If the grep returns nothing, the child code is NOT on `main` and must be
re-applied on a fresh `main`-based branch. Recover stranded file contents
cleanly with `git show <merge_sha>:<path> > <path>` — do NOT `git cherry-pick`
a merge commit (its parent topology can drag in unintended changes).

### 58.2 Post-merge production verification rule — "merged" ≠ "live"

Local pre-merge tests passing, and a PR being merged, do NOT prove the change
is running in production. For any change that fixes a user-visible bug or ships
new behaviour, the verification matrix MUST include at least one check run
**after the Vercel deploy completes**, confirming the change is observable on
`https://promo-gifts-co.uk`. The failure mode this prevents: local dev runs the
new code while production runs something else (a stranded branch, an
unfinished deploy, a cache).

Minimum post-merge check:
- `git grep` a distinctive symbol on `main` to confirm the code landed.
- One deterministic browser check on production (a URL that should now render
  the new UI / behaviour).

This complements §34 (browser-rendered features need human visual
verification) and §52 (migration-first deploy): those cover *what* to verify;
this covers *where* (production, post-deploy) and *when* (after merge, not only
in dev).

### 58.3 Invariants — DO NOT BREAK

- **A fix that must reach `main` is branched off `main`.** Stacking is the
  exception, not the default, and carries a mandatory post-merge `git grep`
  confirmation on `main`.
- **"Merged" is not "done."** Done = code confirmed on `main` AND observed
  live in production, for any user-visible change.
- **Recover stranded file contents with `git show <sha>:<path> > <path>`**, not
  a `git cherry-pick` of a merge commit.

### 58.4 Origin

Codified after PR #60 (May 2026): the click-to-verify `AuthCallback` was merged
into a stacked base branch, lost in #59's squash-merge, and shipped broken to
production because no post-merge production check was run. Diagnosed in
[`audit-authcallback-live-failure.md`](../audit-authcallback-live-failure.md),
recovered by PR #63.
