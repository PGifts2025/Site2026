# Audit — Clothing Sizes Missing + Colour Swatches Blank (Laltex)

**Date:** 2026-07-24
**Scope:** Read-only. No source changed, no sync run, no `supplier_products` mutation, no PR.
**Reported on:** `TF0101` (Fruit of the Loom Women's Valueweight Cotton T-shirt).

---

## TL;DR

- **Size data is in the API and in our DB already.** Laltex ships one SKU per **colour×size** pair in `Items[]`, each carrying `ItemSize`. Our parser stores it (`items[].item_size`), and the live `supplier_products` row for TF0101 holds all 120 variants with sizes intact. **Nothing is dropped at sync.** The gap is purely in the frontend: `normaliseProduct` collapses the matrix wrongly and the UI never offers a size selector.
- **One root cause explains both symptoms.** `normaliseProduct` maps **every** `Items[]` row to a "colour" with no de-duplication. TF0101 has 22 colours × 6 sizes ≈ 120 variants, so the UI shows **"Available Colours (120)"** (should be 22) and never exposes the 6 sizes.
- **Blank swatches = a real Laltex data gap for TF0101, not only the count bug.** Laltex supplies **no hex ever**, and TF0101's variants have **zero images and null PMS**. The swatch renderer falls through to a grey box. De-duplicating fixes the count and removes duplicate tiles, but cannot invent swatch imagery Laltex doesn't provide for this product. (Other clothing, e.g. TF004K, has per-variant images and would render.)
- **Severity: no clothing order can currently be fulfilled.** A 25-unit order carries a colour name and a total but **no S/M/L/XL split**. This blocks the clothing range going live, independent of the Stripe key swap. Sizes are the priority; the colour-swatch cosmetics are secondary.

---

## 1. What the Laltex API actually returns

`GET https://auto.laltex.com/trade/api/v1/products/{code}` (header `API_KEY`, `Accept: application/json`). Top-level keys include `AvailableColours`, `Items`, `ProductPrice`, `Images`, `PlainImages`.

**The variant model is a combined colour×size matrix.** `Items[]` is one entry per colour-size pair. Verbatim `Items[0]` for TF0101:

```json
{
  "ItemCode": "TF01012X-AZBL",
  "ItemDescription": "SS050 Fruit of The Loom Women's Valueweight T-Shirt - AZURE BLUE / 2XL",
  "ItemColour": "Azure Blue",
  "ItemSize": "2Xtra Large",
  "SeedType": null,
  "PMS": null,
  "ItemIndicator": "",
  "ItemImages": [],
  "PlainImages": []
}
```

Measured shape (live):

| Product | Category | `Items[]` (variants) | distinct colours | distinct sizes | sizes | items w/ImageArray | items w/PMS |
|---|---|---|---|---|---|---|---|
| **TF0101** | Clothing/T-shirts | **120** | **22** | **6** | Xtra Small, Small, Medium, Large, Xtra Large, 2Xtra Large | **0** | **0** |
| **TF004K** | Clothing/T-shirts (kids) | 115 | 23 | 5 | Age 3-4, Age 5-6, Age 7-8, Age 9-11, Age 12-13 | 90 | 0 |
| **MG0450** | Drinkware/Metal Bottles | 1 | 1 | 1 | "262 x 90mm dia." (a **dimension**, not a wearable size) | 1 | 1 |

Reading of the table:

- **Size** = `Items[].ItemSize`. Real wearable sizes for clothing (TF0101: XS→2XL as long names; TF004K: age bands). For non-clothing (MG0450) `ItemSize` is a physical dimension string on a single variant — there is no multi-size matrix, so non-clothing has no equivalent gap.
- **Colour** = `Items[].ItemColour` (name only). There is **no hex value anywhere** in the feed. `PMS` is the only colour code and it is `null` for both clothing products. Swatch imagery lives in `Items[].ItemImages` / `Items[].PlainImages` — **empty for every TF0101 variant**, present for most TF004K variants.
- **Independent lists or matrix?** A **matrix** — "Azure Blue in 2XL" (`TF01012X-AZBL`) is its own SKU. `AvailableColours` is a convenience comma-string of colour *names* only (no sizes, no hex).
- **Price is size-uniform.** `ProductPrice` is a flat quantity-tier array (`{MinQuantity, MaxQuantity, Price}` × 11 tiers); `Items[]` carry no price and there is no per-size surcharge field in the feed. So a 2XL costs the same as an S in the data. (Commercially, verify with Laltex whether 2XL+ should carry a surcharge; the API does not encode one.)

---

## 2. What the sync actually stores

**The parser captures size. It is not dropped, and it is not un-fetched.**

```js
// scripts/lib/laltex-parser.js:261-274 — parseItems
export function parseItems(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((it) => ({
    item_code: it?.ItemCode || null,
    item_description: it?.ItemDescription || null,
    item_colour: it?.ItemColour || null,
    item_size: it?.ItemSize || null,          // <-- size IS parsed
    item_indicator: it?.ItemIndicator || null,
    pms: it?.PMS || null,
    seed_type: it?.SeedType || null,
    item_images: Array.isArray(it?.ItemImages) ? it.ItemImages : [],
    plain_images: Array.isArray(it?.PlainImages) ? it.PlainImages : [],
  }));
}
```

`normaliseProduct` maps that to `supplier_products.items` (JSONB). **Live stored row for TF0101** (`supplier_products`, service-role read):

```
stored items count:      120
distinct stored colours: 22
distinct stored sizes:   6   ["2Xtra Large","Large","Medium","Small","Xtra Large","Xtra Small"]
items with item_images:  0
items with hex/HexValue: 0
is_retired:              false
item[0]: {"item_code":"TF01012X-AZBL","item_size":"2Xtra Large","item_colour":"Azure Blue",
          "pms":null,"item_images":[],"plain_images":[], ...}
```

**Conclusion:** the cleanest possible finding — the data arrives and is stored (`items[].item_size` on all 120 rows). Every consumer downstream of the DB row has size available; none use it. This is a **frontend normalisation + UI problem, not a sync problem.** No re-sync is required to fix sizes.

---

## 3. Why the swatches are blank

The swatch renderer expects, in order: a per-colour **image**, then a **hex**, then a grey fallback:

```jsx
// src/components/LaltexProductView.jsx:674-688
{c.images?.[0] ? (
  <img src={c.images[0]} alt={c.name} className="w-full h-full object-cover" loading="lazy" />
) : c.hex ? (
  <span className="block w-full h-full" style={{ backgroundColor: c.hex }} />
) : (
  <span className="block w-full h-full bg-gray-200" />   // <-- TF0101 lands here
)}
```

The colour objects come from `normaliseProduct`, which maps **each Items[] row** to a colour:

```js
// src/services/productCatalogService.js:1440-1450
colours: items.map((it, idx) => ({
  id:   it.item_code || `colour-${idx}`,
  name: it.item_colour || `Colour ${idx + 1}`,
  code: it.item_code || it.item_colour || null,
  hex:  it.HexValue || it.hex_value || null,          // Laltex: always null
  pms:  it.pms || null,
  images:      (it.item_images || []).filter(Boolean), // TF0101: always []
  plainImages: (it.plain_images || []).filter(Boolean),
  size: it.item_size || null,                          // captured, never used as size
})),
```

So for TF0101 every colour object has `images: []`, `hex: null` → the renderer draws `bg-gray-200`. Three compounding causes:

1. **No de-dup** (`items.map`, not grouped by `item_colour`) → 120 tiles, `product.colours.length === 120` → the "**Available Colours (120)**" and "**Show all 120 colours**" text (LaltexProductView:653, 699). The 6 sizes ride inside these as duplicate colour tiles.
2. **No hex in the Laltex feed, ever.** Laltex gives colour names + optional PMS. Swatches for Laltex were always intended to be **image-based** (the file comment says so, LaltexProductView:19, 648).
3. **TF0101 has no colour images** (`ItemImages`/`PlainImages` empty on all variants) → nothing to render → grey box.

**Did it ever work?** For Laltex clothing with empty item images, **no** — it has always fallen to grey (there is no hex path for Laltex, by design). Git history shows the swatch has always keyed on `images[0]` then `hex`; TF0101 satisfies neither. TF004K (90/115 items with images) **would** render swatches, so the bug is data-dependent, not a total regression.

**PGifts Direct comparison (the tell):** PGifts Direct colours come from a different normaliser branch (`row.colors`, productCatalogService:1366) and carry `hex_value` (CLAUDE.md §30.2 / §56.4). So PGifts Direct hits the `c.hex` path and renders coloured chips. **Laltex has names only.** That difference is the whole story: hex-backed (PGifts Direct) renders; image-backed (Laltex) renders only when Laltex supplies images; TF0101 supplies neither.

**Is the swatch issue cosmetic or does it corrupt order data?** Mostly cosmetic. The selected colour's **name** ("Azure Blue") is captured and does flow to the order (`selectedColour.name`, LaltexProductView:475). But because the 120 tiles are colour×size duplicates, "selecting Azure Blue" picks one arbitrary size-variant whose embedded `size` is ignored — so the colour name survives, the size does not. The swatch cosmetics do not block fulfilment; **the missing size does.**

---

## 4. Where sizes would need to surface

Size is currently captured only at the DB row and thrown away by the normaliser. To make it real, it must be threaded through the full order path:

| Stage | Today | Needs |
|---|---|---|
| Product page UI (`LaltexProductView`) | colour + qty + print positions | a **per-size quantity input** (S/M/L/XL/2XL rows) once a colour is chosen; total qty = sum of size qtys |
| `normaliseProduct` | 120 "colours" | pivot the matrix: distinct **colours** (22) and distinct **sizes** (6), with a colour→available-sizes map |
| `quote_items` | `unit_price`, `color`, `print_areas` (JSONB) | a **size breakdown** per line (e.g. `{"Small":5,"Medium":10,...}`) — mirrors the `print_areas` JSONB precedent |
| Pricing | size-uniform | **no per-size price needed** (feed has no surcharge); total = Σ(size qty) × unit_price. If Laltex ever adds a 2XL surcharge, revisit |
| `order_items` | copied by `confirm_payment_atomic` | copy the size breakdown JSONB forward (same as `print_areas`) |
| Customer invoice (`CustomerOrderDetail`, PR #79) | line = name/qty/unit/net | show the size split per line |
| **Internal order alert (`sendInternalOrderAlert`, PR #80)** | name/code/qty/colour/print | **must show the size split** — the team places the supplier order per size |
| Order confirmation email (`sendOrderConfirmation`) | name/qty/total | show size split |
| Admin order detail | line items | show size split |
| Artwork/production flow | print positions | unaffected by size, but the supplier PO needs it |

`quote_items.print_areas` already stores structured per-line JSONB (`{selections:[...]}`, CLAUDE.md §43), so there is a proven pattern and serialisation path for a `size_breakdown` sibling.

---

## 5. Blast radius and options

Because **price is size-uniform in the feed**, the awkward part of a size split (per-size pricing) does not apply, which strongly favours the JSONB approach.

### Option A — Size as a per-line JSONB breakdown (recommended)
Store `{"Small":5,"Medium":10,"Large":10}` on the quote/order line, alongside `print_areas`. Total line qty = sum of the map.

- **Pro:** one row per product line (unchanged row model); matches the `print_areas` precedent; totals and the quote/checkout/invoice/alert renders change only to *display* the split; works cleanly because price is uniform per size.
- **Con:** if Laltex ever introduces a per-size surcharge, per-size pricing inside a JSONB map is more awkward than distinct rows.
- **Files:** `productCatalogService.normaliseProduct` (pivot the matrix), `LaltexProductView` (size UI + write the breakdown), `confirm_payment_atomic` (copy the JSONB — a replacement-function migration), and display-only edits to `CustomerQuotes`, `CustomerOrderDetail`, `AdminOrderDetail`, `sendOrderConfirmation.ts`, `sendInternalOrderAlert.ts`.
- **Migration:** one, small — add `size_breakdown jsonb` to `quote_items` + `order_items` (idempotent, no `BEGIN/COMMIT`, verifying `SELECT`, per the PR #76 lesson) **and** a replacement `confirm_payment_atomic` that copies the new column (it already copies `print_areas`/`taxable_net_unit`, so this is the same shape of change). Alternatively, fold the size map into the existing `print_areas` envelope to avoid a column add — cleaner migration, slightly muddier semantics; a dedicated column reads better.

### Option B — One `quote_items` row per size
`Azure Blue / M × 10` and `Azure Blue / L × 10` as separate rows.

- **Pro:** natural home for per-size pricing if surcharges ever exist; each row is a real orderable SKU (`item_code`).
- **Con:** row explosion (a 4-size, 2-colour order = 8 rows); changes how the quote view groups and totals; more work in every list/rollup; and the `recompute_quote_total` / VAT split all still work but the UI must group rows back together for the customer. Unjustified while pricing is uniform.
- **Files:** larger blast radius in `CustomerQuotes` rendering + the add-to-quote write; same migration surface minus the JSONB column.

### Option C — JSONB breakdown with optional per-size price fields
Option A, but each size entry is `{qty, unit_price}`. Future-proofs for surcharges without row explosion.

- **Pro:** handles a future 2XL surcharge without a data-model change.
- **Con:** more moving parts now for a surcharge the feed does not currently express. Over-engineering unless Dave confirms surcharges are coming.

**Recommendation:** **Option A.** The feed's size-uniform pricing removes Option B's only real advantage, and the `print_areas` JSONB precedent makes A low-risk. The colour de-dup + size pivot in `normaliseProduct` is the same change and should land together.

---

## 6. Severity and sequencing

- **Can a clothing order be fulfilled today? No.** The line records colour name + quantity + total, but no size split. A 25-unit order is unfulfillable without emailing the customer to ask for sizes, which defeats the point. **This blocks the clothing range going live, independent of the Stripe live-key swap.** It is more urgent than cosmetic display work.
- **Are the two issues independent?** Partly. They share one root cause — `normaliseProduct` mishandling the `Items[]` matrix (no de-dup, size ignored). Fixing the normaliser (pivot to colours×sizes) fixes the **colour count** (22 not 120) and **unlocks sizes** in one change. But it does **not** fix TF0101's blank swatches, which are a **separate Laltex data gap** (no images, no hex for this product). So: normaliser fix → sizes + correct colour count; swatch imagery for TF0101 needs either Laltex to supply images or a local fallback (a colour-name label / first-letter chip / a curated name→hex map). Do not block sizes on the swatch cosmetics.
- **Is the swatch issue cosmetic?** Yes, for fulfilment — colour **name** already flows to the order. The broken tiles are UX only. Fix the count/dup with the normaliser change; treat missing imagery as a lower-priority data/fallback task.
- **Non-clothing gap?** None material. Non-clothing products have a single `Items[]` variant where `ItemSize` is a physical dimension (MG0450: "262 x 90mm dia."). No multi-size matrix, so nothing to capture. Clothing is the only category with this gap. (Watch for other apparel sub-categories — hoodies, polos, hi-vis — which will have the same matrix and the same bug.)

**Ship order:**
1. **Sizes (Option A) — first, and blocking for clothing go-live.** Normaliser pivot + size UI + JSONB persistence through quote/order/invoice/alert/admin.
2. **Colour de-dup — same normaliser change, ride along.** Turns "120 colours" into 22 and removes duplicate tiles at no extra cost.
3. **Swatch imagery fallback — lower priority, not launch-blocking.** For colours with neither image nor hex, render a labelled chip (colour name / initial) instead of a blank grey box; optionally seed a name→hex map for common colours. Raise the missing per-variant images with Laltex for TF0101-class products.

---

## Appendix — evidence

| Fact | Source |
|---|---|
| `Items[]` is a colour×size matrix; each carries `ItemSize`/`ItemColour` | live API `TF0101` `Items[0]` |
| TF0101 = 22 colours × 6 sizes ≈ 120 variants; price size-uniform | live API analysis |
| Non-clothing (MG0450) = 1 variant, `ItemSize` is a dimension | live API |
| Parser stores `item_size` | `scripts/lib/laltex-parser.js:267` |
| Stored TF0101 row: 120 items, 6 sizes, 0 images, 0 hex | `supplier_products` service-role read |
| Normaliser maps every item to a colour (no de-dup); captures `size` but never surfaces it | `src/services/productCatalogService.js:1440-1450` |
| Swatch renders image → hex → grey fallback; TF0101 hits grey | `src/components/LaltexProductView.jsx:674-688` |
| "Available Colours (N)" / "Show all N" use `product.colours.length` (=120) | `LaltexProductView.jsx:653, 692-699` |
| Colour name (not size) flows to the order | `LaltexProductView.jsx:475` |
| PGifts Direct colours carry hex (different branch) | `productCatalogService.js:1366`; CLAUDE.md §30.2/§56.4 |
