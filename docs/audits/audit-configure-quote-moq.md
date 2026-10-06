# Audit — Configure & Quote MOQ (read-only)

> Scope: map how the Configure & Quote card sets default quantity and the "Minimum order" text for Laltex vs PGifts Direct, before drafting the change. No code changed.

## ⚠️ Headline: the brief's premise is mostly already true in code

The brief says the card shows "Minimum order: **25** units" on every product "regardless of … Laltex or PGifts Direct", implying a hardcoded wrong default for Laltex. **That is not what the Laltex code does.** The Laltex card already:
- defaults the quantity input to the product's **real** MOQ (`product.minimumOrderQty`), and
- renders that real MOQ in the text (`Minimum order: {minQty} units`), and
- floors typed values at that MOQ.

The "25" you see on Laltex products is the **genuine synced MOQ** — **917 of 1192 (77%)** Laltex products really do have MOQ 25. The rest vary and the card already shows their real value (e.g. a 500-MOQ product shows "Minimum order: 500 units" and defaults to 500).

So Dave's ask **"default to the actual MOQ"** is **already implemented**. The only outstanding part is **"drop the text entirely for Laltex"** — a ~3-line JSX deletion. (See §7.)

Also: the brief's §5 assumption that MOQ = `product_pricing[0].min_qty` is **wrong** — that field is `1` (a qty-1 sample tier). The real MOQ lives in the dedicated `minimum_order_qty` column. Details in §5.

---

## 1. File location

- Routing: `/products/:identifier` **and** the legacy catalog routes (`/bags/:productSlug`, etc.) all render `src/pages/ProductDetail.jsx`, which delegates to `ProductDetailPage`:

```jsx
// src/pages/ProductDetail.jsx:5-12
const ProductDetail = () => {
  const { categorySlug, productSlug, identifier } = useParams();
  const id = identifier || productSlug;
  return <ProductDetailPage identifier={id} categorySlug={categorySlug} productSlug={productSlug} />;
};
```

- `ProductDetailPage` is the **brancher**. It resolves the product, then for a **Laltex** (supplier) row it short-circuits to a **separate component**, `LaltexProductView`:

```jsx
// src/components/ProductDetailPage.jsx:1150-1154
if (supplierProduct) {
  return <LaltexProductView product={supplierProduct} />;
}
```

- **Two separate JSX trees** (not a shared card):
  - **Laltex** Configure & Quote → `src/components/LaltexProductView.jsx` (quantity block ~L805-832).
  - **PGifts Direct / catalog** Configure & Quote → `src/components/ProductDetailPage.jsx` (quantity block ~L1655-1677; clothing variant ~L1635-1650).

---

## 2. Quantity input

### Laltex (`LaltexProductView.jsx`) — defaults to the real MOQ already
```jsx
// L154-156
const minQty = product?.minimumOrderQty ?? 1;
const [quantity, setQuantity] = useState(minQty);
const [quantityInput, setQuantityInput] = useState(String(minQty));
```
```jsx
// L196-198  (reset on product change)
setQuantity(minQty);
setQuantityInput(String(minQty));
```
Floor enforcement (already clamps to MOQ):
```jsx
// L346-349
const handleQuantityChange = (n) => {
  if (!Number.isFinite(n)) return;
  const next = Math.max(minQty, Math.floor(n));   // floor at MOQ
  setQuantity(next);
  setQuantityInput(String(next));
```
```jsx
// L352-358 (blur)
  if (!Number.isFinite(parsed) || parsed < minQty) {
    setQuantity(minQty);                            // snap back to MOQ
    setQuantityInput(String(minQty));
  } else {
    setQuantity(parsed);
    setQuantityInput(String(parsed));
```
Input markup at L814-821 (text input bound to `quantityInput`, blur → `handleQuantityBlur`).

### PGifts Direct (`ProductDetailPage.jsx`) — derives from lowest tier, `|| 25` fallback
```jsx
// L341-353
// Derive min order quantity from the lowest pricing tier if available,
// otherwise fall back to the product's min_order_quantity column
const tiers = data.pricing || [];
if (tiers.length > 0) {
  const lowestTierMin = Math.min(...tiers.map(t => t.min_quantity));
  data.min_order_quantity = lowestTierMin;
}
// Set initial quantity to min order quantity
if (data.min_order_quantity) {
  setQuantity(data.min_order_quantity);
  setQuantityInput(data.min_order_quantity.toString());
}
```

---

## 3. "Minimum order: X units" text

### Laltex — interpolated from `minQty` (NOT hardcoded 25)
Configure & Quote card, under the Quantity input — **this is the line Dave means**:
```jsx
// src/components/LaltexProductView.jsx:829-831
<p className="text-xs text-gray-500 mt-2 text-center">
  Minimum order: {minQty} units
</p>
```
There is a **second**, separate "Minimum order" render — a spec row inside the Details panel (different context), conditional on the field being present:
```jsx
// src/components/LaltexProductView.jsx:735-739
{product.minimumOrderQty != null && (
  <div className="flex justify-between py-2 border-b border-gray-100">
    <span className="text-gray-600">Minimum order</span>
    <span className="font-semibold text-gray-900">{product.minimumOrderQty} units</span>
  </div>
)}
```

### PGifts Direct — hardcoded `|| 25` fallback (leave as-is per brief)
```jsx
// src/components/ProductDetailPage.jsx:1676
<p className="text-xs text-gray-500 mt-2 text-center">Minimum order: {product?.min_order_quantity || 25} units</p>
```
```jsx
// src/components/ProductDetailPage.jsx:1646  (clothing variant)
Minimum order: 25 units combined
```

**Neither Laltex line is hardcoded to 25** — both interpolate the product's MOQ. Only the PGifts Direct / catalog side has the literal `25` fallback.

---

## 4. Laltex / PGifts Direct discriminator

`ProductDetailPage` calls `getProductByIdentifier` and branches on `resolved.source`:
```jsx
// src/components/ProductDetailPage.jsx:278-288
const resolved = await getProductByIdentifier(effectiveId);
...
if (resolved.source === 'supplier') {
  // Laltex product — bail out and let LaltexProductView take over.
  setSupplierProduct(resolved.normalised);
```
`getProductByIdentifier` (in `src/services/productCatalogService.js`) tries catalog by slug first, then `supplier_products.supplier_product_code`; it returns `{ source: 'catalog' | 'supplier', raw, normalised }`. **`source === 'supplier'` ⇒ Laltex** (renders `LaltexProductView`); **`source === 'catalog'` ⇒ PGifts Direct** (renders the rest of `ProductDetailPage`). No code-prefix sniffing; it's the resolver's source tag.

---

## 5. MOQ data location on Laltex rows

**The code uses the dedicated `minimum_order_qty` column, not a pricing tier.** Mapping in the normaliser:
```js
// src/services/productCatalogService.js
// supplier (Laltex) branch:
minimumOrderQty: row.minimum_order_qty ?? null,   // L1431
// catalog (PGifts Direct) branch:
minimumOrderQty: row.min_order_quantity ?? null,  // L1361
```
Parser populates it from the raw Laltex feed:
```js
// scripts/lib/laltex-parser.js:320-323, 359
if (raw.MinimumOrderQty != null && raw.MinimumOrderQty !== '') {
  const n = parseInt(raw.MinimumOrderQty, 10);
  if (Number.isFinite(n)) minimumOrderQty = n;
  ...
}
// ...
minimum_order_qty: minimumOrderQty,
```

Live data (read-only probe, `scripts/diagnostic/probe-laltex-moq.mjs`):

| code | `minimum_order_qty` | `product_pricing[0].min_qty` | `raw_payload.MinimumOrderQty` |
|---|---|---|---|
| RC1015 | 25 | 1 | 25 |
| MG0450 | 25 | 1 | 25 |
| ZP1059 | 25 | 1 | 25 |
| RC1138 | 25 | 1 | 25 |

**Across all 1192 Laltex rows:** `minimum_order_qty` is **never null (0 nulls)**. Value distribution:

```
25 → 917   |  100 → 95  |  10 → 74  |  500 → 72
36 → 15    |  250 → 12  |  1000 → 5 |  3000 → 2
```

**Edge cases:**
- `product_pricing[0].min_qty` is `1` (a qty-1 "sample" tier), so the brief's §5 assumption (MOQ = lowest tier `min_qty`) would yield **1**, not the real MOQ. Use `minimum_order_qty`.
- No null `minimum_order_qty` rows exist, so `LaltexProductView`'s `?? 1` fallback (L154) never triggers in practice.

---

## 6. Risk surface

- **Hardcoded `25` defaults — all on the PGifts Direct / catalog side** (`ProductDetailPage.jsx`), which the brief says to leave alone:
  - L247 `clothingTotalQty >= 25` (clothing min)
  - L493, L510 `const minQty = product?.min_order_quantity || 25;`
  - L1646 "Minimum order: 25 units combined" (clothing text)
  - L1676 `{product?.min_order_quantity || 25}`
  - L1802 "Add N more units" message (uses `25` for clothing / `min_order_quantity || 25`)
  - Legacy category pages also hardcode "Minimum order: 25 units" (`HiVis.jsx:318`, `Pens.jsx:318`, `Power.jsx:318`, `Speakers.jsx:318`, `TeaTowels.jsx:318`) — out of scope, not the Configure card.
- **Downstream MOQ validation:**
  - Laltex: Add-to-Quote button is `disabled={!isOrderValid() || addingToQuote}` (L1019); `isOrderValid` returns false when `quantity < minQty` (L340). The quote `.insert` (L426/L438) only fires when valid. Enforcement is **client-side** (button gating + the input floor). No Edge Function / RPC re-checks MOQ on insert.
  - `CustomerQuotes.jsx` fetches per-product min order quantities (L143) and alerts if a user edits a line below it (L639) — applies to existing quote line edits, not the Configure card.
- **Tests pinning 25:** none. The only first-party test is `src/tests/printAreaSystem.test.js` (unrelated); it does not reference MOQ.

---

## 7. Recommended implementation shape (prose)

1. **Default quantity — no change needed.** `LaltexProductView` already defaults the input to `product.minimumOrderQty` (L154-155) and re-syncs on product change (L196-198). The "default to actual MOQ" half of the ask is already done; recommend confirming Dave still wants only the *text* removed.
2. **Text removal — the actual change.** Delete the three-line `<p>Minimum order: {minQty} units</p>` block under the Quantity input (`LaltexProductView.jsx:829-831`). Dave said "remove entirely"; since the value shown is already correct, removal is purely a presentation choice — no functional reason to keep it. Decide separately whether the Details-panel **spec row** (L735-739, a labelled "Minimum order" stat) should also go; it reads as a product spec rather than an input hint, so I'd leave it unless Dave wants it gone too. PGifts Direct text (`ProductDetailPage.jsx:1676`, L1646) stays untouched.
3. **Validation floor — leave as-is.** The floor is already the MOQ for Laltex (`Math.max(minQty, …)` L347, snap-back L353-355, button gating L1019). Removing the visible text does **not** affect it. Recommend keeping the floor so a user can't submit below MOQ even though the hint text is gone.

---

*Read-only audit. No source files edited, no packages installed, no PR. Diagnostic at `scripts/diagnostic/probe-laltex-moq.mjs` (untracked). This report is an untracked file at the repo root.*
