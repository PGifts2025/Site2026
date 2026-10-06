# Audit — Pricing Tier Ceiling Behaviour (read-only)

> Scope: map what happens to the Configure & Quote price when a quantity is entered above the top pricing tier, on **both** supplier paths. No source changed. The "call us for larger quantities" message is **not** implemented — that's the next prompt.
>
> Data gathered live via `scripts/diagnostic/probe-pricing-tier-ceiling.mjs` (read-only PostgREST, service-role key, 2026-05-22).

## TL;DR

- **Both paths flat-line the unit price above their top tier. Neither detects "above ceiling" nor warns.** The mechanism differs but the customer-visible result is the same: enter more than the top tier's `min_quantity` and the per-unit price stops moving.
- **PGifts Direct flat-lines early and is hard-capped.** 20 of 25 products flat-line at **1000**, 2 (notebooks) at **500**, 3 (edge pens) at **5000**. The quantity input is **hard-clamped to 10000** in both ProductDetailPage handlers, so the flat zone runs from the top tier up to 10000 and you physically cannot enter more.
- **Laltex flat-lines much later and has NO upper input clamp.** 689 products flat-line at **5000**, 452 at **10000**, 35 single-tier products are flat at every quantity. `handleQuantityChange` / `handleQuantityBlur` clamp the floor only — you can type `999999`.
- **No arithmetic / underbilling exposure.** The top tier is the *cheapest* listed rate (price is monotonically decreasing in every product checked). Above the ceiling the customer is charged that cheapest rate × quantity, and the stored `quote_items.unit_price` / `total_amount` are internally consistent. The exposure is **commercial, not financial**: a 5,000-unit order priced identically per-unit to a 1,000-unit order is uncompetitive and skips a genuine bulk negotiation. See §5.
- **The floor is guarded; the ceiling is not.** Both paths clamp quantity up to `minQty` at the low end. The high end has no price-aware guard at all (PGifts has a blunt 10000 input cap; Laltex has nothing).
- **A "Questions? Call 01844 600900" `tel:` CTA already exists in both views** — reuse it.

---

## 1. PGifts Direct — top tier identification

PGifts Direct products live in `catalog_products` (25 rows) and are priced from two tables depending on `pricing_model` (`flat`=19, `coverage`=1, `clothing`=5).

### 1a. Non-clothing — `catalog_pricing_tiers`

**Ceiling field:** the table HAS a `max_quantity` column, but the **top tier always has `max_quantity = NULL`** (open-ended), and the lookup code (`getCurrentTier`, §3) **ignores `max_quantity` entirely** — it keys only on `min_quantity`. So the effective ceiling is the **highest `min_quantity`** of a product's tiers.

Columns: `id, catalog_product_id, min_quantity, max_quantity, price_per_unit, is_popular, effective_from, effective_to, created_at` (146 rows).

| slug | model | tiers | min_quantity set | TOP min_q (ceiling) | top max_q | price monotonic ↓ |
|---|---|---|---|---|---|---|
| 12oz-recycled-canvas | flat | 6 | 25,50,100,250,500,1000 | **1000** | null | yes |
| 5oz-cotton-bag | flat | 6 | 25,50,100,250,500,1000 | **1000** | null | yes |
| 5oz-mini-cotton-bag | flat | 6 | 25,50,100,250,500,1000 | **1000** | null | yes |
| 5oz-recycled-cotton-bag | flat | 6 | 25,50,100,250,500,1000 | **1000** | null | yes |
| 8oz-canvas | flat | 6 | 25,50,100,250,500,1000 | **1000** | null | yes |
| a5-notebook | flat | 4 | 50,100,250,500 | **500** | null | yes |
| a6-pocket-notebook | flat | 4 | 50,100,250,500 | **500** | null | yes |
| chi-cup | coverage | 6 | 25,50,100,250,500,1000 | **1000** | null | yes |
| edge-classic | flat | 6 | 100,250,500,1000,2000,5000 | **5000** | null | yes |
| edge-silver | flat | 6 | 100,250,500,1000,2000,5000 | **5000** | null | yes |
| edge-white | flat | 6 | 100,250,500,1000,2000,5000 | **5000** | null | yes |
| gamma-lite | flat | 6 | 25,50,100,250,500,1000 | **1000** | null | yes |
| hi-vis-vest | clothing | 6 | 25,50,100,250,500,1000 | 1000 | null | yes |
| hoodie | clothing | 6 | 25,50,100,250,500,1000 | 1000 | null | yes |
| ice-p | flat | 6 | 25,50,100,250,500,1000 | **1000** | null | yes |
| luggie | flat | 6 | 25,50,100,250,500,1000 | **1000** | null | yes |
| mr-bio | flat | 6 | 25,50,100,250,500,1000 | **1000** | null | yes |
| mr-bio-pd-long | flat | 6 | 25,50,100,250,500,1000 | **1000** | null | yes |
| ocean-octopus | flat | 6 | 25,50,100,250,500,1000 | **1000** | null | yes |
| octopus-mini | flat | 6 | 25,50,100,250,500,1000 | **1000** | null | yes |
| polo | clothing | 6 | 25,50,100,250,500,1000 | 1000 | null | yes |
| sweatshirts | clothing | 6 | 25,50,100,250,500,1000 | 1000 | null | yes |
| t-shirts | clothing | 6 | 25,50,100,250,500,1000 | 1000 | null | yes |
| tea-towel | flat | 6 | 25,50,100,250,500,1000 | **1000** | null | yes |
| water-bottle | flat | 6 | 25,50,100,250,500,1000 | **1000** | null | yes |

> The 5 clothing products carry `catalog_pricing_tiers` rows too (used for the "From £X" category display), but their Configure & Quote pricing uses `catalog_print_pricing` (§1b).

**Distribution of effective ceiling (top-tier `min_quantity`):**

| Ceiling | # products | which |
|---|---|---|
| 500 | 2 | a5-notebook, a6-pocket-notebook |
| 1000 | 20 | most products |
| 5000 | 3 | edge-classic, edge-silver, edge-white |

**Dave's "all 1000-capped" hypothesis — partly confirmed, with two exceptions:**
- ✅ 20 of 25 cap at exactly 1000.
- ⚠️ **The two notebooks cap at 500** — they flat-line *earlier* than Dave assumed.
- ⚠️ **The three edge pens cap at 5000** — they scale further.
- **No product is truly open-ended** (none keeps scaling indefinitely); all flat-line at a finite ceiling.

### 1b. Clothing — `catalog_print_pricing`

Columns: `id, catalog_product_id, pricing_model, min_quantity, max_quantity, colour_count, garment_cost, print_cost_per_position, extra_position_price, coverage_type, price_per_unit, max_positions, created_at, updated_at, colour_variant` (252 rows).

Here `max_quantity` **is** used by the lookup. Every clothing product has the same band structure:

| slug | rows | min_quantity bands | max_quantity bands | top band |
|---|---|---|---|---|
| t-shirts | 72 | 25,50,100,250,500,1000 | 49,99,249,499,999,**null** | 1000 → ∞ |
| hi-vis-vest | 72 | 25,50,100,250,500,1000 | 49,99,249,499,999,**null** | 1000 → ∞ |
| hoodie | 36 | 25,50,100,250,500,1000 | 49,99,249,499,999,**null** | 1000 → ∞ |
| sweatshirts | 36 | 25,50,100,250,500,1000 | 49,99,249,499,999,**null** | 1000 → ∞ |
| polo | 36 | 25,50,100,250,500,1000 | 49,99,249,499,999,**null** | 1000 → ∞ |

The **top band's `max_quantity` is NULL** (open-ended), so the lookup's `max_quantity == null || qty <= max_quantity` test matches any `qty >= 1000` → flat-lines at the 1000-band rate.

---

## 2. Laltex — top tier identification

**Source:** `supplier_products.product_pricing` (jsonb array). Parser: [`scripts/lib/laltex-parser.js`](scripts/lib/laltex-parser.js) `parseProductPricing` (L140) →
`{min_qty, max_qty, price, is_poa, note}`. Margin layer adds `sell_price` + `margin_applied_pct`.

**Ceiling field:** each tier has `min_qty` and `max_qty`. **`max_qty` is NULL on the top tier of every Laltex product** (`MaxQuantity: "N/A"` → `null`, parser L146 / L15 docs). So, as with PGifts, the effective ceiling is the highest `min_qty`.

Across all **1192** Laltex rows:

| Metric | Value |
|---|---|
| Products with no tiers | 0 |
| Top tier OPEN-ENDED (`max_qty == null`) | **1192 (100%)** |
| Top tier numeric-bounded | 0 |

**Distribution of top-tier `min_qty` (the quantity at which price flattens):**

| Ceiling (top min_qty) | # products | Notes |
|---|---|---|
| 1 | 35 | single-tier products — flat at *every* quantity (supplier's genuine flat price) |
| 2519 | 2 | |
| 5000 | 689 | the majority |
| 5004 | 14 | |
| 10000 | 452 | scale the longest |

**Consistency:** not a single number — but heavily clustered. ~59% flatten at **5000**, ~38% at **10000**. Laltex ceilings are **5–10× higher than PGifts Direct's**, so the flat-line bites far less often.

**Extreme examples:**
- *Flattens earliest (single-tier, flat everywhere):* `TPC260201WH`, `TPC771201`, `TPC860301`, `EC0161`, … (35 products, 1 tier each).
- *Scales longest (flatten at 10000):* `ZS1010`, `ZP0004`, `ZP0005`, `ZP0006`, `ZZ3013`, `ZZ3016` (7 tiers each).

**Sample full array — MG0450** (flattens at 5000; note `max_qty:null` on the last tier, monotonic `sell_price`):

```json
[{"min_qty":1,"max_qty":1,"price":6.68,"sell_price":9.02},
 {"min_qty":2,"max_qty":24,"price":11.61,"sell_price":15.67},
 {"min_qty":25,"max_qty":49,"price":11.61,"sell_price":15.67},
 {"min_qty":50,"max_qty":99,"price":9.84,"sell_price":13.28},
 {"min_qty":100,"max_qty":249,"price":8.71,"sell_price":11.32},
 {"min_qty":250,"max_qty":499,"price":8.06,"sell_price":10.08},
 {"min_qty":500,"max_qty":999,"price":7.45,"sell_price":9.13},
 {"min_qty":1000,"max_qty":2499,"price":6.89,"sell_price":8.27},
 {"min_qty":2500,"max_qty":4999,"price":6.68,"sell_price":8.02},
 {"min_qty":5000,"max_qty":null,"price":6.55,"sell_price":7.86}]
```

---

## 3. Calc behaviour above the ceiling

### PGifts Direct path — `src/components/ProductDetailPage.jsx`

**Tier lookup — no upper bound at all** ([L710-718](src/components/ProductDetailPage.jsx#L710-L718)):

```jsx
const getCurrentTier = () => {
  if (!pricingTiers || pricingTiers.length === 0) {
    return { price_per_unit: 0 };
  }
  // Sort descending by min_quantity so we match the highest qualifying tier first
  const sorted = [...pricingTiers].sort((a, b) => b.min_quantity - a.min_quantity);
  return sorted.find(tier => quantity >= tier.min_quantity) || pricingTiers[0];
};
```

The predicate is `quantity >= tier.min_quantity` only. For any quantity at or above the top tier's `min_quantity`, the first (highest) tier matches and is returned. There is **no `max_quantity` check, no null return, no flag** — it silently flat-lines forever. `max_quantity` exists in the data but is never read here.

**Quantity input is hard-capped at 10000** ([L492-496](src/components/ProductDetailPage.jsx#L492-L496) and blur L508-518):

```jsx
const handleQuantityChange = (value) => {
  const minQty = product?.min_order_quantity || 25;
  const newQuantity = Math.max(minQty, Math.min(10000, value));  // ← upper cap 10000
  setQuantity(newQuantity);
};
```

Clothing print rows DO test `max_quantity` ([~L1002-1014](src/components/ProductDetailPage.jsx#L1002-L1014)):

```jsx
activePrintPricing.find(p =>
  p.colour_count === colCount &&
  (p.min_quantity == null || qty >= p.min_quantity) &&
  (p.max_quantity == null || qty <= p.max_quantity)
);
```

…but the top band's `max_quantity` is NULL (§1b), so it still matches every high quantity and flat-lines at the 1000-band. If a band's `max_quantity` were a finite number and qty exceeded it, `find` would return `undefined` and the code falls back to `tierBase` (the flat `getCurrentTier` price) — still flat, never an error.

### Laltex path — `src/components/LaltexProductView.jsx`

**Tier lookup — flat-lines via the retained `match`** ([L90-101](src/components/LaltexProductView.jsx#L90-L101)):

```jsx
function pickTier(tiers, qty) {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  const sorted = [...tiers].sort((a, b) => (a.minQty ?? 0) - (b.minQty ?? 0));
  let match = null;
  for (const t of sorted) {
    if (qty >= (t.minQty ?? 0) && (t.maxQty == null || qty <= t.maxQty)) {
      return t;                       // top tier has maxQty==null → returns it directly
    }
    if (qty >= (t.minQty ?? 0)) match = t;   // …or retains top tier as fallback
  }
  return match || sorted[0];
}
```

Because every Laltex top tier has `maxQty == null` (§2), the `t.maxQty == null` branch returns the top tier directly for any `qty >= topMin`. Same flat-line. `pickPrintTier` (L123) delegates to the same function for per-position print pricing.

**Unit price assembly** ([L251-337](src/components/LaltexProductView.jsx#L251-L337)):

```jsx
const baseTier = useMemo(() => pickTier(product?.pricingTiers || [], quantity), ...);   // flat above ceiling
const basePrice = baseTier?.pricePerUnit ?? null;                                       // flat
// positionContributions → pickPrintTier(...) per enabled position                      // flat
const unitPrice = basePrice == null || isAnyPoa
  ? null
  : Number((basePrice + printPerUnitTotal + deliveryUnitWithMargin).toFixed(2));
```

One nuance: `deliveryUnitWithMargin` ([L311-323](src/components/LaltexProductView.jsx#L311-L323)) is recomputed from `shipping_charges` at the *actual* quantity, so for Laltex the **delivery component keeps moving** above the ceiling even though base + print are frozen. The PGifts mirror (and PGifts catalog path) have no delivery line, so their unit price is *perfectly* flat.

**Quantity input — floor clamp only, NO upper cap** ([L345-360](src/components/LaltexProductView.jsx#L345-L360)):

```jsx
const handleQuantityChange = (n) => {
  if (!Number.isFinite(n)) return;
  const next = Math.max(minQty, Math.floor(n));   // lower clamp only
  setQuantity(next);
  setQuantityInput(String(next));
};
const handleQuantityBlur = () => {
  const parsed = parseInt(quantityInput, 10);
  if (!Number.isFinite(parsed) || parsed < minQty) { setQuantity(minQty); ... }
  else { setQuantity(parsed); ... }               // no Math.min — accepts any value
};
```

### What the user sees

Let `C` = the product's ceiling (top-tier `min_quantity`) and `R` = the top-tier per-unit price (the cheapest rate).

| Entry | PGifts Direct | Laltex |
|---|---|---|
| `C + 1` | unit price = `R`, exactly flat; total = `R × (C+1)` | base+print = `R` (flat); delivery share recomputed; total scales |
| `C + 100` | unit price = `R`, flat | base+print flat; delivery recomputed |
| `C × 5` | unit price = `R` if `C×5 ≤ 10000`; **above 10000 the input refuses the value** (clamped to 10000) | unit price base+print flat at any size — `999999` is accepted, no cap |

In all in-range cases the **per-unit price never changes above `C`** and there is **no message, tooltip, or validation** telling the user the price has stopped scaling.

---

## 4. Existing UI hints

**There is no ceiling-related hint, tooltip, banner, or validation on either product page.** Broad search (`larger`, `bulk`, `contact`, `call`, `quote`, `over`, `maximum`, `exceed`, `01844`) found only:

- **Laltex** — `"Contact us for a tailored quote on this configuration."` ([L971](src/components/LaltexProductView.jsx#L971)) renders **only when `unitPrice == null`** (POA configuration). Above-ceiling does *not* null the price, so this never fires for the ceiling case.
- **Laltex** — `"Questions? Call 01844 600900"` inline link, `href="tel:01844600900"` ([L1057-1059](src/components/LaltexProductView.jsx#L1057-L1059)). Always visible.
- **PGifts Direct** — `"Bulk pricing available"` ([L1563](src/components/ProductDetailPage.jsx#L1563)) is a static subtitle in the "Configure & Quote" header. Generic marketing, not ceiling-aware.
- **PGifts Direct** — `"Questions? Call 01844 600900"`, `href="tel:01844600900"` ([L1814-1816](src/components/ProductDetailPage.jsx#L1814-L1816)). Always visible.

**Existing "contact / custom quote" CTA:** the `tel:01844600900` "Call 01844 600900" link in both views is the only working contact CTA. There is **no `/contact` route** in the app, and the "Request Sample" button is an unwired placeholder (CLAUDE.md §53.4). So the phone link is the canonical CTA to reuse.

---

## 5. Add to Quote / Cart validation downstream

**Neither Add-to-Quote handler has an upper-quantity guard.** They submit the flat-lined unit price.

**Laltex** — `handleAddToQuote` ([L396-450](src/components/LaltexProductView.jsx#L396-L450)) validates only `user` and `unitPrice != null`, then:

```jsx
.from('quotes').insert({ ..., total_amount: +(unitPrice * quantity).toFixed(2) })
.from('quote_items').insert({ ..., quantity, unit_price: +unitPrice.toFixed(4), ... })
```

**PGifts Direct** — `handleAddToQuote` ([L878-914+](src/components/ProductDetailPage.jsx#L878-L914)) validates only `user` and `product`, then uses `effectivePricePerUnit` → falls back to `getCurrentTier()?.price_per_unit` (both flat) and inserts the same way.

**Downstream:**
- `isOrderValid()` checks only the **floor** (`quantity >= minQty`) — never a ceiling (Laltex L339-342; PGifts L249).
- No Edge Function / RPC rejects high quantity. `confirm_payment_atomic` copies `quote_items → order_items` verbatim and Stripe charges `quotes.total_amount`. The `recompute_quote_total` trigger recomputes `SUM(quantity × unit_price)` — **consistent with the flat unit price**, so no internal mismatch.

**Financial exposure — stated plainly:** there is **no underbilling / arithmetic bug**. The top tier is the *cheapest* listed rate (price monotonic-decreasing in all 25 PGifts + sampled Laltex products), so above the ceiling the customer is charged that cheapest rate × quantity and the order total is exactly what the screen shows. The real exposure is **commercial**:

- A customer ordering, say, **5,000 units of a 1000-capped product is quoted the same per-unit price as someone ordering 1,000.** That is uncompetitive (a 5k order should command a keener price) and skips the bulk negotiation the business would normally have. Risk = lost deal / eroded trust, **not** money taken incorrectly.
- It tends to favour the *business* margin-wise (their supplier cost falls at volume while the sell price is frozen at the top-tier rate), which is exactly why a "let's talk" prompt is the right intervention — it converts a silently-uncompetitive quote into a conversation.
- Worth noting the inverse is impossible here: there is no path where the system quotes *below* the listed schedule.

---

## 6. Symmetry & risk notes

- **Products where the ceiling rarely bites:** the 3 edge pens (PGifts, cap 5000), and the ~452 Laltex products that flatten at 10000. For these the flat zone only begins at volumes most customers never reach (and PGifts caps the input at 10000 anyway). The 35 single-tier Laltex products are flat at *all* quantities — that is the supplier's genuine flat price, **not** a bug, and a "call us" prompt would be noise for them.
- **Asymmetry between the two paths:**
  1. **Ceiling height** — PGifts mostly 1000 (some 500); Laltex mostly 5000–10000. The issue is far more visible on PGifts Direct (matches Dave's observation that he saw it there first).
  2. **Input cap** — PGifts hard-clamps the input to **10000**; Laltex has **no upper clamp** (accepts `999999`). So a runaway above-ceiling quantity is actually *more* reachable on Laltex.
  3. **Delivery** — Laltex unit price keeps moving (delivery share) above ceiling; PGifts is perfectly flat.
  4. **Latent inconsistency** — `catalog_pricing_tiers` carries a `max_quantity` column that `getCurrentTier` never reads; the data and the code disagree on whether the top tier is bounded.
- **Low-end (floor) is handled, high-end is not.** Both paths clamp quantity *up* to `minQty` (Laltex L347/L353; PGifts L494/L513) and `isOrderValid()` enforces the floor. The upper end has no price-aware guard — PGifts' 10000 is a blunt input cap unrelated to any tier, Laltex has nothing. So the bug is **not** the lower-end logic mirrored incorrectly; the lower end is correct and the upper end is simply absent.

---

## 7. Recommended implementation shape (prose only)

**Where to render.** There is no shared Configure & Quote child component today — `ProductDetailPage.jsx` and `LaltexProductView.jsx` each own their pricing-panel JSX, with different calc shapes. The lightest honest option is a small shared **presentational** component, e.g. `src/components/AboveCeilingNotice.jsx`, that takes `{ visible, phone }` and renders the amber inline notice + the existing `tel:01844600900` CTA. Each page computes its own `isAboveCeiling` from data it already has (PGifts: `quantity > max(min_quantity)`; Laltex: `quantity > max(min_qty)` from `product.pricingTiers`) and drops `<AboveCeilingNotice visible={isAboveCeiling} />` right beneath the Total row. That is one new file plus a two-line insert in each page — both supplier paths get identical copy from one source, without the risk of extracting the whole pricing panel. The ceiling itself is trivially derivable in both components (it is the highest tier's `min_quantity` / `min_qty`); no schema or query change is needed.

**Conditional vs permanent.** Recommend **conditional** (appears only when `quantity` exceeds the product's top tier), over Dave's permanent-secondary lean. The data is decisive: Laltex ceilings sit at 5000–10000, so a permanent "call for bulk" line would be dead weight on the >99% of sessions that never approach it, and it would be actively wrong on the 35 single-tier products whose price is *meant* to be flat. A conditional notice is contextual and actionable — it appears exactly when the price has stopped scaling. Guard the trigger with `tiers.length > 1` so single-tier (genuinely flat) products never show it. If Dave still wants an always-on touch, a subtle one-liner ("Need 5,000+? Call for a bespoke quote") is harmless, but it should be *in addition to*, not *instead of*, the conditional notice.

**Disable Add to Quote above the ceiling?** Recommend **keep it enabled.** §5 shows no arithmetic or underbilling risk — the stored price is the cheapest listed rate and the totals are consistent — so disabling would block legitimate orders (a customer happy to take 2,000 at the 1,000 rate) and cost conversions for zero financial protection. Show the notice as a heads-up / upsell ("you may get a better rate at this volume — call us") while letting the order proceed. Forcing a phone call would be justified only if the business deliberately wants to *recapture margin* by renegotiating every large order, which is a commercial policy decision, not something the current pricing exposure requires.

**Phone / CTA.** Reuse the existing `tel:01844600900` "Call 01844 600900" link already present in both views (§4). Do **not** invent a `/contact` route — none exists, and the "Request Sample" button is an unwired placeholder. The phone link is the single working contact surface.

**Defence-in-depth on the cart/quote summary.** Worth a **second, lower-priority** check on `CustomerQuotes.jsx`: if a saved line item's `quantity` exceeds that product's top tier, show a subtle "large quantity — call to confirm pricing" note next to it. This covers quotes started before the product-page notice was shown (or via other entry points). It is heavier than the product-page change because the quote view does not currently carry tier data per line and would need to re-resolve the product (PGifts via `catalog_pricing_tiers`, Laltex via `getSupplierProductByCode` → `product_pricing`), so treat it as a follow-up rather than part of the first cut. The product page is where ~all configuration happens and should ship first.

---

*Read-only audit. No source files edited, no pricing data changed, no PR opened. Diagnostic script committed to `scripts/diagnostic/probe-pricing-tier-ceiling.mjs` (untracked). This report is an untracked file at the repo root.*
