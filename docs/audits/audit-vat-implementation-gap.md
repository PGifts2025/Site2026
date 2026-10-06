# Audit — VAT (UK 20%) Implementation Gap

**Date:** 2026-07-17
**Scope:** Read-only audit. No source files changed, no orders data touched, no payment flow touched, no packages installed, no PR.
**Verdict:** **VAT is not modelled anywhere in the live purchase path.** This is launch-blocking for real trading, and the fix is **not purely an engineering change** — it requires a commercial decision from Dave first (§9a).

---

## TL;DR — the five things that matter

1. **VAT does not exist in the live path.** A grep for `VAT` across `src/` returns hits in exactly **two files**, both belonging to the **orphaned cart** that can no longer check out. The live path (product page → quote → Pay Now → Stripe) has **zero** VAT logic.
2. **`subtotal`, `tax_amount`, `shipping_cost` are `0.00` on all 20 orders** and `total_amount` is **exactly `SUM(order_items.line_total)`** (difference `0.00` on every order). Stripe is charged that same number. The chain is internally consistent — it just has no VAT in it.
3. **Prices are net-of-VAT by construction** (cost + margin + amortised setup + delivery) but are **displayed with no VAT statement at all**. That is the legally worst option: under UK VAT law a price shown to a customer without qualification is **deemed VAT-inclusive**.
4. **The margin schedule assumes `sell_price` is Dave's revenue.** If current prices are treated as VAT-inclusive, the 35% markup silently becomes **12.5%**, and ~9.5% after card fees — which is *precisely* the "sub-10% net margin / non-viable" problem that CLAUDE.md §57 raised the schedule to fix. **Treating current prices as gross would undo the §57 retune.** This is the single strongest argument for ex-VAT display (§9a).
5. **No invoice generation exists anywhere**, and Dave's VAT number appears nowhere in the codebase (grep for `invoice|vat_number|VAT number` → **no files found**).

**Why the gap exists:** VAT *was* modelled in the original cart/checkout design (`CartContext.jsx`, `server/stripe-server.cjs`). That path was abandoned in favour of the quote pipeline (CLAUDE.md §19), the `/checkout` page was deleted, and **VAT was never carried across to the replacement**. It is an orphaned-feature casualty, not an oversight in new code.

---

## 1. Current pricing calculation

### 1a. PGifts Direct — `ProductDetailPage.jsx`

```jsx
// src/components/ProductDetailPage.jsx:717-723
  const getCurrentTier = () => {
    if (!pricingTiers || pricingTiers.length === 0) {
      return { price_per_unit: 0 };
    }
    // Sort descending by min_quantity so we match the highest qualifying tier first
    const sorted = [...pricingTiers].sort((a, b) => b.min_quantity - a.min_quantity);
```

```jsx
// src/components/ProductDetailPage.jsx:876-881
  const currentTier = getCurrentTier();
  const totalQuantity = product?.pricing_model === 'clothing'
    ? (clothingTotalQty > 0 ? clothingTotalQty : quantity)
    : quantity;
  const totalPrice = currentPrice ? currentPrice.total.toFixed(2) : (currentTier.price_per_unit * totalQuantity).toFixed(2);
```

`price_per_unit` comes straight from `catalog_pricing_tiers`. **No VAT term anywhere.**

### 1b. Laltex — `LaltexProductView.jsx`

```jsx
// src/components/LaltexProductView.jsx:326-338
  // Round to 2dp at the source. Every downstream price column —
  // quote_items.unit_price, order_items.unit_price, order_items.line_total,
  // quotes.total_amount, orders.total_amount — is numeric(10,2) and
  // silently truncates anything finer on INSERT. ... See CLAUDE.md §48.
  const unitPrice = basePrice == null || isAnyPoa
    ? null
    : Number((basePrice + printPerUnitTotal + deliveryUnitWithMargin).toFixed(2));
  const totalPrice = unitPrice == null ? null : Number((unitPrice * quantity).toFixed(2));
```

So the customer-facing unit price = **product sell_price + print sell_price + delivery share (with margin)**. Three components. **VAT is not a fourth.**

### 1c. Quote line — the same number, straight through

```jsx
// src/components/LaltexProductView.jsx:448-452
          quote_number: quoteNumber,
          customer_id: user.id,
          status: 'draft',
          total_amount: +(unitPrice * quantity).toFixed(2),
```

### 1d. Order — `confirm_payment_atomic`

The RPC copies `quote_items → order_items` and writes `total_amount` from the quote. It sets **no** tax field (the INSERT column list is `quote_id, customer_id, status, payment_status, artwork_status, stripe_session_id, payment_intent_id, total_amount` + `shipping_address, po_number` from the 20260520 replacement). `subtotal`, `tax_amount`, `shipping_cost` are never touched → they keep their `DEFAULT 0`.

### 1e. Are stored prices net or gross?

**Net (VAT-exclusive) at every layer**, and provably so:

| Store | Net or gross? | Evidence |
|---|---|---|
| `supplier_products.product_pricing[].price` | **Raw supplier trade cost**, no VAT, no markup | Live column comment: *"Parsed from Laltex ProductPrice[]... Prices stripped of currency symbol; MaxQuantity 'N/A' -> null; price > £900 -> is_poa=true"*. CLAUDE.md §26.3: *"Never apply markup at sync time."* |
| `supplier_products.product_pricing[].sell_price` | **Cost + margin**, no VAT, no delivery | `laltex-margin.js:18-19` — *"product_pricing tier sell_price = price × (1 + margin) (NO delivery, NO setup...)"* |
| `catalog_pricing_tiers.price_per_unit` | Net (no VAT). No column comment either way | No VAT term in any consumer; CLAUDE.md §6.2 margin model is cost→sell only |
| `catalog_print_pricing` | Net | §6.2 formula `sell_price = total_cost / (1 - margin)` — cost-and-margin only |

**Nothing in the schema, the sync scripts, the margin library, or the display layer references VAT.** The single `tax`-ish column in the entire public schema is `orders.tax_amount` (live probe of `information_schema.columns` for `%vat%`/`%tax%` → exactly one row).

### 1f. Print costs

Setup is **amortised into the print tier's `sell_price` at sync time**, then margin applied:

```js
// scripts/lib/laltex-margin.js:20-27
 *   - print_details print_price tier sell_price =
 *       (raw_print + setup_amortised + extra_colour_setup_amortised)
 *       × (1 + margin)
 *
 * The setup component is amortised over tier.min_qty (NOT the actual
 * customer quantity) ...
```

⚠️ CLAUDE.md §46.4 warns loudly against adding `setup_charge` again at a consumer — **the same trap will apply to VAT**: once VAT is added at one layer, adding it again downstream double-charges. Any implementation must name a single VAT boundary (§9b).

### 1g. Delivery

Delivery is **read-time**, not baked (CLAUDE.md §46, decision B1-A):

```jsx
// src/components/LaltexProductView.jsx:312-322 (abridged)
  const deliveryUnitWithMargin = useMemo(() => {
    if (isAnyPoa || basePrice == null) return 0;
    if (!Number.isFinite(quantity) || quantity <= 0) return 0;
    const total = deliveryPerUnit(product?.shippingCharges, product?.piecesPerCarton, quantity, ...
```

**Correction to the prompt's premise:** the prompt says delivery is "currently modelled at £1.07 per project memory". I can find **no `1.07` constant anywhere**. Delivery is computed dynamically per quantity from the supplier's `shipping_charges` carton bands (`computeDeliveryForQuantity` → `deliveryPerUnit`), then margin-uplifted. The effective per-unit delivery therefore **varies by quantity and carton fit**; £1.07 may have been one observed value for one product/quantity, but it is not a modelled rate. This matters for VAT only in that **delivery is part of the taxable supply** and must be inside the VAT base — which it automatically is, since it is folded into `unitPrice` before the quote total.

---

## 2. What's stored in the orders table today

### 2a. Field-level audit — all 20 orders

```
SELECT count(*) AS orders,
       count(*) FILTER (WHERE subtotal=0)     AS subtotal_zero,
       count(*) FILTER (WHERE tax_amount=0)   AS tax_zero,
       count(*) FILTER (WHERE shipping_cost=0) AS ship_zero,
       count(*) FILTER (WHERE total_amount>0) AS total_positive,
       min(total_amount), max(total_amount) FROM orders;
```
```json
{ "orders": 20, "subtotal_zero": 20, "tax_zero": 20, "ship_zero": 20,
  "total_positive": 20, "min_total": "176.75", "max_total": "613.20" }
```

- `subtotal` — **always 0.00. Confirmed** (20/20). Column default `0`; never written.
- `tax_amount` — **always 0.00. Confirmed** (20/20).
- `shipping_cost` — **always 0.00. Confirmed** (20/20).
- `total_amount` — **populated and correct**; it represents the **full amount charged**, which is **net of VAT** in substance (cost+margin+setup+delivery) but is what the customer actually paid.
- Other tax/VAT columns added-but-unpopulated: **none**. `orders.tax_amount` is the only one in the whole `public` schema.

### 2b. Three real orders — order vs quote vs Stripe

```json
[
 { "order_number": "ORD-20260714-0024", "order_total": "243.75",
   "subtotal": "0.00", "tax_amount": "0.00", "shipping_cost": "0.00",
   "payment_status": "paid", "payment_intent_id": "pi_3Tt7bpR5gvw59Yak13ayDXdk",
   "has_session": true, "quote_number": "QT-MRKR35G4",
   "quote_total_sent_to_stripe": "243.75", "order_matches_quote": true },
 { "order_number": "ORD-20260625-0023", "order_total": "231.00",
   "subtotal": "0.00", "tax_amount": "0.00", "shipping_cost": "0.00",
   "payment_status": "paid", "payment_intent_id": "pi_3TmExsR5gvw59Yak0AMkn88W",
   "has_session": true, "quote_number": "QT-MQTN156O",
   "quote_total_sent_to_stripe": "231.00", "order_matches_quote": true },
 { "order_number": "ORD-20260520-0022", "order_total": "219.00",
   "subtotal": "0.00", "tax_amount": "0.00", "shipping_cost": "0.00",
   "payment_status": "paid", "payment_intent_id": "pi_3TZD6HR5gvw59Yak2LL1IhkW",
   "has_session": true, "quote_number": "QT-MPEA7QHW",
   "quote_total_sent_to_stripe": "219.00", "order_matches_quote": true }
]
```

Line items as stored:

```json
[
 { "order_number": "ORD-20260714-0024", "product_name": "Ancoats Blanc 400ml Tumbler",
   "quantity": 25, "unit_price": "9.75", "line_total": "243.75" },
 { "order_number": "ORD-20260625-0023", "product_name": "Tucker Dual Adapter Multi Charger",
   "quantity": 25, "unit_price": "9.24", "line_total": "231.00" },
 { "order_number": "ORD-20260520-0022", "product_name": "Mr Bio",
   "quantity": 25, "unit_price": "8.76", "line_total": "219.00" }
]
```

### 2c. Does what Stripe charged equal `total_amount`? — **Yes, exactly.**

`order_matches_quote: true` on all three, and `quotes.total_amount` is *literally the number sent to Stripe* (§3). Further, `total_amount` is **exactly** the sum of line totals with **zero** residual:

```json
[ { "order_number": "ORD-20260714-0024", "total_amount": "243.75", "sum_line_totals": "243.75", "difference": "0.00" },
  { "order_number": "ORD-20260625-0023", "total_amount": "231.00", "sum_line_totals": "231.00", "difference": "0.00" },
  { "order_number": "ORD-20260520-0022", "total_amount": "219.00", "sum_line_totals": "219.00", "difference": "0.00" },
  { "order_number": "ORD-20260515-0021", "total_amount": "278.00", "sum_line_totals": "278.00", "difference": "0.00" },
  { "order_number": "ORD-20260515-0020", "total_amount": "278.00", "sum_line_totals": "278.00", "difference": "0.00" } ]
```

**Interpretation:** `total_amount` is *effectively gross* only in the trivial sense that it is what was charged. In substance it is a **pure sum of net line values with no VAT component whatsoever**. There is no second issue — the arithmetic is self-consistent; VAT is simply absent from the model.

---

## 3. Stripe checkout flow

Session creation: [`supabase/functions/create-checkout-session/index.ts`](supabase/functions/create-checkout-session/index.ts).

```ts
// :72
    const unitAmountPence = Math.round(Number(quote.total_amount) * 100);
```
```ts
// :78-99
    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("currency", "gbp");
    params.append("line_items[0][quantity]", "1");
    params.append("line_items[0][price_data][currency]", "gbp");
    params.append("line_items[0][price_data][unit_amount]", String(unitAmountPence));
    params.append("line_items[0][price_data][product_data][name]", `PGifts Order ${quote.quote_number}`);
    params.append("success_url", `${siteUrl}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`);
    params.append("cancel_url", `${siteUrl}/account/quotes`);
    params.append("metadata[quote_id]", quote_id);
```

**Findings:**

- **Amount sent to Stripe = `quote.total_amount` exactly** — the same number the customer saw on the product page. Confirmed against live data in §2b.
- **No `tax_rates`, no `automatic_tax`, no tax line.** (Consistent with Dave declining Stripe Tax — noted, not proposed.)
- **The customer sees ONE un-itemised line**: `PGifts Order QT-MRKR35G4 — £243.75`, quantity 1. No products, no quantities, no delivery line, **no VAT line**. The last thing the customer sees before paying is a single opaque total.

**Is this a VAT gap?** Yes, but sharper than the prompt frames it. The prompt says *"customers are being charged 20% less than they legally owe."* That is not quite the legal position. Because the price was displayed **without any VAT qualification**, HMRC treats the £243.75 as **VAT-inclusive**. Dave has not undercharged the customer — he has **silently absorbed £40.63 of VAT out of his own margin** (£243.75 ÷ 6). The customer owes nothing more. See §9a: this is why the fix is a pricing decision, not just a calculation.

---

## 4. Customer-facing display audit

**Definitive grep result** — `VAT|vat_|ex VAT|inc VAT|tax_amount|20%` (case-insensitive) across `src/` matches VAT in exactly **two files**, and both are the dead cart:

```jsx
// src/context/CartContext.jsx:103-114   ← ORPHANED PATH
  const calculateTotals = () => {
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shipping = cart.length > 0 ? 10 : 0; // Flat £10 shipping
    const vat = (subtotal + shipping) * 0.2; // 20% VAT on subtotal + shipping
    const total = subtotal + shipping + vat;
```
```jsx
// src/components/Cart.jsx:11-16   ← ORPHANED PATH
  // Cart-specific VAT calculation (subtotal only, since shipping is "Calculated at checkout")
  const cartVAT = (parseFloat(totals.subtotal) * 0.2).toFixed(2);
  const cartTotal = (parseFloat(totals.subtotal) + parseFloat(cartVAT)).toFixed(2);

  // The standalone /checkout page was removed (it could start a Stripe
  // payment with no backing order — see "remove orphaned checkout" PR).
```

That comment is the smoking gun: **the only VAT logic in the frontend lives in a cart whose checkout page was deleted.** It computes a flat £10 shipping and 20% VAT — both inconsistent with the real model (dynamic carton-based delivery, no VAT). It is dead code that will mislead the next reader.

| Surface | Price shown | VAT indication |
|---|---|---|
| Product page (PGifts Direct) | `price_per_unit × qty` | **None** |
| Product page (Laltex) | `unitPrice × qty` | **None** |
| Configure & Quote card | unit price + breakdown lines (Product / Print / **UK delivery**) | **None** — delivery is itemised, VAT is not |
| Cart / basket drawer | subtotal + 20% VAT + total | *Shows VAT — but cannot check out (dead path)* |
| Stripe checkout page | single line `PGifts Order QT-XXXX — £243.75` | **None** |
| Order confirmation page/email | `Total paid: £243.75` | **None** |

### Which of the two customary UK B2B patterns is the site doing?

**Neither.** The customary options are:
- (a) `£1.20 (ex VAT)` throughout, VAT added at checkout; or
- (b) `£1.44 (inc VAT)` throughout, net breakdown at checkout.

The site shows a **bare, unqualified price** and charges exactly that. It is *computed* like (a) but *presented* — and therefore legally *interpreted* — like (b), with the VAT silently swallowed. **The display is internally consistent (no page contradicts another) but legally ambiguous, which resolves against Dave.**

---

## 5. Confirmation emails / receipts

**Order confirmation email — no VAT breakdown.** [`sendOrderConfirmation.ts:203-208`](supabase/functions/_shared/sendOrderConfirmation.ts#L203) renders one total row:

```ts
                <tfoot>
                  <tr style="font-weight:bold;">
                    <td colspan="2" style="padding:12px 0 8px 0; font-size:14px;">Total paid</td>
                    <td align="right" style="text-align:right; padding:12px 0 8px 0; font-size:14px;">£${totalAmount.toFixed(2)}</td>
                  </tr>
                </tfoot>
```

Plain-text twin at `:224`: `Total paid: £${totalAmount.toFixed(2)}`. Per-item rows carry `product_name`, `qty`, `line_total` — no net/VAT split.

**Invoice generation — does not exist.** Grep for `invoice|Invoice|vat_number|VAT number|company_number|registered office` across the repo (excluding `.md`) → **"No files found."**

**Dave's VAT number — appears nowhere in the codebase.** No env var, no config, no template.

**Consequence:** there is currently **no document issued to a customer that could serve as a VAT invoice.** The confirmation email is the only receipt, and it lacks every mandatory element (VAT number, invoice number, net/VAT/gross split, VAT rate, supplier address).

---

## 6. Admin dashboard views

### Orders list + CSV export

```jsx
// src/pages/admin/AdminOrders.jsx:361-375
  const buildCsv = (rows) => {
    const header = [
      'Order Number', 'Customer Name', 'Customer Email', 'Customer Company',
      'Created Date', 'Status', 'Artwork Status', 'Payment Status',
      'Total',
      'PO Number', 'Stripe Payment Intent ID', 'Tracking Number',
    ];
```
```jsx
// :390
          o.total_amount,
```

**`Total` only.** No Net, no VAT, no Gross. An accountant handed this CSV cannot produce a VAT return from it — the single most likely real use of the export.

### Order detail — actively misleading

```jsx
// src/pages/admin/AdminOrderDetail.jsx:402-419
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Subtotal</span>
                <span className="font-semibold">{formatCurrency(order.subtotal || 0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Shipping</span>
                <span className="font-semibold">{formatCurrency(order.shipping_cost || 0)}</span>
              </div>
              {order.tax_amount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Tax</span>
                  <span className="font-semibold">{formatCurrency(order.tax_amount)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-200">
                <span>Total</span>
                <span>{formatCurrency(order.total_amount)}</span>
              </div>
```

Because the columns are all zero, **every admin order detail page currently renders:**

```
Subtotal   £0.00
Shipping   £0.00
Total    £243.75
```

The `Tax` row is hidden by the `tax_amount > 0` guard, so the UI doesn't even hint that VAT is missing — it just shows a nonsense subtotal. **This is the cheapest possible early-warning signal and it is disabled by a truthy guard.** Note the UI scaffolding for a breakdown already exists; it is only starved of data.

---

## 7. Where the change needs to land

| Layer | Current state | Needed |
|---|---|---|
| **Storage — `orders`** | `subtotal`, `tax_amount`, `shipping_cost` exist, all `0.00`, never written | **Reusable as-is.** `subtotal` = net, `tax_amount` = VAT, `total_amount` = gross. Add `vat_rate numeric(5,4)` to snapshot the rate at sale time (rates change; 2011's 17.5→20 precedent). `shipping_cost` stays 0 — delivery is inside the line prices by design (§46 B1-A); do **not** retrofit it |
| **Storage — `quotes`** | `total_amount` only | Same trio needed if the quote page shows a breakdown before checkout (it should — the customer must see VAT before paying) |
| **Storage — `order_items` / `quote_items`** | `unit_price`, `line_total`, both net | **Leave alone for launch.** Per-line VAT is only needed for mixed-rate baskets, which §8 says don't exist. A single order-level rate is sufficient and far cheaper |
| **Storage — VAT number** | Nowhere | One place (§9g) |
| **Calculation** | None | One canonical helper (§9b) |
| **Display** | 6 surfaces, none VAT-aware | Product page ×2, Configure & Quote card ×2, CustomerQuotes, order confirmation page — plus the **dead Cart** which should be deleted or fixed, not left contradicting the live model |
| **Stripe** | Sends bare `quote.total_amount` | Must send **gross**; ideally itemised (net line + VAT line) so the customer sees the split before paying |
| **Emails** | Total only | Net/VAT/gross rows + VAT number |
| **Admin** | Subtotal £0.00 / Shipping £0.00 | Populates automatically once the RPC writes the columns; CSV needs 3 new columns |

### Blast radius

| PR | Files | LOC (rough) | Migration? |
|---|---|---|---|
| **A — schema + calc + RPC** | 1 migration, 1 new `scripts/lib/vat.js`, `confirm_payment_atomic` replacement, quote-total trigger review | ~150 | **Yes** (add `vat_rate`; populate on write) |
| **B — display + Stripe + email** | `LaltexProductView`, `ProductDetailPage`, `CustomerQuotes`, `create-checkout-session`, `sendOrderConfirmation`, `AdminOrders` (CSV), + delete/repair `Cart.jsx`/`CartContext.jsx` | ~250-350 | No |
| **C — invoice** | New generator + template + numbering sequence | ~300+ | Yes (invoice number sequence) |

⚠️ **The `recompute_quote_total` trigger is a trap.** CLAUDE.md §48 documents that it recomputes `quotes.total_amount = SUM(quantity × unit_price)` after any `quote_items` write and **silently overrides whatever the app inserted**. If VAT is added to `quotes.total_amount` but the trigger keeps recomputing it from net line items, **the trigger will erase the VAT** and Stripe will charge net again. Any VAT work **must** address this trigger explicitly — it is the single most likely way this implementation ships broken.

---

## 8. Zero-rated / exempt / reverse-charge edge cases

Per the brief: **do not over-engineer.** Assessment against the actual catalogue:

- **Books / printed matter.** The catalogue has `a5-notebook` and `a6-pocket-notebook` (CLAUDE.md §5) plus Laltex notebooks. **Blank/promotional notebooks are standard-rated** — the zero rating applies to books meant for reading, not blank stationery. **No exposure.**
- **Children's clothing.** Catalogue clothing is adult workwear/uniform (t-shirts, polo, hoodie, sweatshirts, hi-vis). **Not present. No exposure.**
- **Reverse charge / EU B2B.** The site is UK-only in the delivery model: prices include **UK** delivery, and the AI system prompt tells customers *"Non-UK delivery (Belfast, Channel Islands, Ireland) is firmed at quote time"* (`ai-system-prompt.js:188`), and `ava-conversation-rules.md` says *"International orders are possible but with additional cost. The customer must call before placing the order."* **International is already a manual, off-platform path** — so reverse charge never reaches the automated flow. **Defer, correctly.**

**Recommendation:** flat **20% on everything**, with a `vat_rate` column so a future zero-rated SKU is a data change rather than a migration. That covers 99%+ of B2B promotional merchandise. Do not build a rate-per-product taxonomy now.

---

## 9. Recommended implementation shape

### 9a. FIRST — the commercial decision (Dave, not code)

**This is the fork the whole implementation hangs on, and it is not an engineering call.**

Current prices are *computed* net but *displayed* unqualified, so they are *legally* gross. Dave must choose:

**Option 1 — Prices are NET; add 20% at checkout. ✅ Recommended.**
- `£243.75` becomes `£292.50` at checkout (`£243.75 net + £48.75 VAT`).
- **Cost-neutral to the customer.** B2B buyers are VAT-registered and reclaim input VAT; the £48.75 comes straight back to them. This is *why* ex-VAT display is the B2B norm — the headline price stays comparable against competitors who also quote ex-VAT.
- **Preserves the margin schedule.** `sell_price = cost × (1 + margin)` (`laltex-margin.js:18-19`) assumes `sell_price` is Dave's revenue. Option 1 keeps that true.

**Option 2 — Prices are GROSS; back out VAT from current prices. ❌ Not recommended.**
- `£243.75` stays `£243.75`, of which `£40.63` goes to HMRC and `£203.12` is revenue.
- **This silently destroys the §57 margin retune.** A 35% markup becomes `1.35 ÷ 1.2 = 1.125` → **12.5%**, and ~**9.5%** after the ~3% card fee. CLAUDE.md §57 raised the schedule *precisely because* "sub-10% net margin ... [made] the business non-viable". Option 2 walks straight back into that, invisibly.
- Would require re-running `recompute-laltex-margins.js` against an upward-revised schedule to restore real margin — i.e. prices rise anyway, but with worse optics (a raise) than Option 1 (a clarification).

**The arithmetic makes this near-decisive: Option 1.** But it is Dave's call, and it must be made **before** any code is written, because it determines whether the fix is "add VAT on top" or "reprice the catalogue".

### 9b. Where the calc lives

One canonical helper — `scripts/lib/vat.js`:

```
computeVat(netAmount, vatRate = 0.20) → { net, vat, gross }
```

with rounding to 2dp at the boundary (CLAUDE.md §48 — every price column is `numeric(10,2)` and truncates silently). **Called from exactly two authorities:**

1. **`confirm_payment_atomic`** — the single writer for Stripe-path orders (§17.7). It must write `subtotal` (net), `tax_amount` (VAT), `vat_rate`, `total_amount` (**gross**) in the same transaction. This is the source of truth.
2. **The display/quote layer** — for the customer-facing breakdown and the Stripe amount.

⚠️ Mirror CLAUDE.md §46.4's warning: **name one VAT boundary and never re-apply.** The setup-charge double-count trap is the exact same shape. My recommendation: **keep every stored `unit_price` / `line_total` NET**, and let VAT exist **only** at order/quote level (`subtotal` → `tax_amount` → `total_amount`). Then "is this value net?" has one answer everywhere below the order header.

### 9c. Display strategy

**Ex-VAT throughout, with the VAT breakdown at the quote/checkout step** — matching Option 1 and UK B2B convention.

- Product pages / Configure & Quote: show `£9.75 per unit (ex VAT)`. The word *(ex VAT)* is the legally load-bearing part — its absence is what creates the current ambiguity.
- Quote page (`CustomerQuotes`) and Stripe: show `Subtotal £243.75 / VAT (20%) £48.75 / Total £292.50`.
- **Delete or repair the dead Cart's VAT math** (`CartContext.jsx:103-114`) in the same PR. Leaving a flat-£10-shipping + 20%-VAT calculator in the tree next to a real VAT implementation guarantees a future regression.

### 9d. Migration path for existing orders

**Backfill all 20 test orders**, don't leave them. They are test data (`min 176.75 / max 613.20`, all Dave's), and the admin UI already renders `Subtotal £0.00` from them (§6), so leaving them makes the new breakdown UI look broken in the only data that exists.

Backfill under the **Option 1** reading (treat stored `total_amount` as net, since that's what the margin model intended):
```
subtotal = total_amount; tax_amount = ROUND(total_amount * 0.20, 2);
total_amount = subtotal + tax_amount; vat_rate = 0.20
```
This rewrites `total_amount`, which **diverges from what Stripe actually captured** on those 20 orders. That is acceptable *only because they are test payments*. **Flag explicitly to Dave**, and do it **before** live keys — after go-live this backfill becomes falsifying financial records. A one-line note in the migration is not enough; this should be a conscious "yes, these are test rows" from Dave.

### 9e. Stripe update

Change `create-checkout-session` to send **gross**, and itemise so the customer sees the split:
- `line_items[0]` = net amount, named from the quote
- `line_items[1]` = `VAT (20%)`, or use Stripe's `tax_rates` on the line (a display/reporting feature — **not** Stripe Tax, which Dave declined; no automatic calculation, our number, our rate).

The existing `totalAmount <= 0` guard (`:56-66`) stays and should now check gross.

**Existing test workflows:** the Stripe test-card flow (§16.9) is unaffected in shape — only the amount changes. Worth re-running the §16.9 checklist because the amount assertion in any test fixture will shift by 20%.

### 9f. Invoice generation — defer to PR C, but not far

The confirmation email is currently the only receipt and is not a VAT invoice (§5). **Recommendation: add the net/VAT/gross rows + VAT number to the confirmation email in PR B** (small, ~20 LOC in `sendOrderConfirmation.ts`), which gets Dave to *"customer can see the VAT they paid"* immediately. A **proper** invoice (sequential invoice numbering, supplier address, per-line net/VAT, PDF) is PR C, and it needs an invoice-number sequence — a real design decision (HMRC requires unique sequential numbering; `order_number` is *not* an invoice number and reusing it will cause problems if an order is ever re-invoiced or credit-noted).

For launch, an email showing net/VAT/gross + VAT number + a unique reference is **substantially compliant** for B2B; the PDF is polish.

### 9g. VAT number storage

**Recommendation: an env var** (`VITE_VAT_NUMBER` for any client display, `VAT_NUMBER` as a Supabase Edge Function secret for emails), read once and passed into `renderEmail`.

Rationale: it is a **static business constant**, not per-transaction data. A DB settings row means a query on every email send for a value that changes ~never; a hardcoded literal means N templates to update. The project already has the pattern (Edge Function secrets for `RESEND_API_KEY`, `SITE_URL`). If a `business_settings` table ever exists for other reasons, migrate then.

⚠️ **But the *rate* must be snapshotted per order** (`orders.vat_rate`), not read from config at display time. When the rate changes, historical orders must still render the rate they were charged at. Config for identity, column for the transaction.

### 9h. PR split

| PR | Contents | Blocking? |
|---|---|---|
| **A — Schema + calc + RPC** | `vat_rate` column; `scripts/lib/vat.js`; `confirm_payment_atomic` replacement writing `subtotal`/`tax_amount`/`vat_rate`/gross `total_amount`; **resolve the `recompute_quote_total` trigger conflict** (§7); backfill the 20 test orders | **Yes** |
| **B — Display + Stripe + email** | Ex-VAT labelling on product/quote pages; breakdown at quote + Stripe; gross to Stripe; net/VAT/gross + VAT number in confirmation email; CSV gains Net/VAT/Gross; **delete the dead Cart VAT math** | **Yes** |
| **C — VAT invoice** | Invoice numbering sequence, full invoice document | No — post-launch |

A and B **must ship together or in immediate succession**: A alone makes the DB right while Stripe still charges net (under-charging); B alone has no data to render. If they must be separate PRs, **do not deploy A to production without B**.

---

## 10. Priority recommendation

**VAT is launch-blocking for real trading.** Agreeing with all three of the prompt's priors, with reasoning:

### Should VAT ship before the Stripe live-keys swap? — **Yes. Emphatically.**

This is the hard gate. Reasons, in order of severity:

1. **The backfill stops being legal.** §9d rewrites `total_amount` on 20 orders. While they're test rows that is housekeeping. Once one real payment exists, rewriting captured amounts is falsifying financial records. **The window for a clean backfill closes the moment live keys go in.**
2. **Every real sale becomes a VAT liability against a non-compliant receipt.** Dave owes HMRC output VAT on each sale regardless of whether he collected it. Under the current deemed-inclusive reading he pays it **out of margin**, at the §57 sub-10% level he already identified as non-viable.
3. **Retrofitting VAT onto real customers is a price rise.** Fixing it after go-live means telling live B2B customers their prices went up 20%. Fixing it before go-live means the prices simply *are* what they are. The commercial cost of delay is real and asymmetric.

CLAUDE.md §17.6's go-live checklist should gain a line: **"VAT modelling complete and verified"** above the key swap.

### Should VAT ship before the (paused) internal email notifications? — **Yes.**

The email audit's `orders@` alert was specced to carry a price breakdown, and I had to record that no breakdown exists (`audit-internal-email-notifications.md` §6a). Shipping those emails first means building content against fields that are `0.00`, then rewriting them. VAT first makes that alert correct on first write, at no extra cost. **This ordering saves work rather than costing it.**

### Should VAT ship before the helpdesk email fix? — **Yes, VAT first.**

Not close. The helpdesk email display is cosmetic and reversible in minutes; VAT is a legal obligation with a closing window (point 1 above). Do VAT first.

### Recommended sequence

1. **Dave decides §9a** (net vs gross). Blocks everything; costs one conversation, not one line of code.
2. **PR A + PR B** — schema/calc/RPC, then display/Stripe/email. Ship close together.
3. **Backfill the 20 test orders** (still pre-live).
4. **Then** Stripe live keys (§17.6).
5. **Then** internal email notifications (now able to show a real breakdown).
6. Helpdesk email fix — any time; independent.
7. **PR C** (proper VAT invoice) — post-launch, before the first customer VAT return cycle.

### Honest caveat

I am auditing code, not giving tax advice. The deemed-VAT-inclusive point (§3, §9a) is the standard UK treatment of an unqualified price from a VAT-registered business and it drives the whole recommendation, so it is worth **60 seconds with Dave's accountant to confirm** before the repricing decision is locked. The engineering conclusions (columns unused, no VAT in the path, trigger conflict, Stripe sends net) are all directly verified against code and live data and stand independently.

---

## Appendix — files referenced

| File | Lines | Relevance |
|---|---|---|
| [`src/components/ProductDetailPage.jsx`](src/components/ProductDetailPage.jsx) | 717-723, 876-881 | PGifts Direct tier pricing, no VAT |
| [`src/components/LaltexProductView.jsx`](src/components/LaltexProductView.jsx) | 66-69, 312-338, 448-452 | Laltex unit price = product+print+delivery, no VAT; quote total |
| [`scripts/lib/laltex-margin.js`](scripts/lib/laltex-margin.js) | 1-43 | `sell_price = cost × (1+margin)`; §57 schedule; the Option-2 margin proof |
| [`supabase/functions/create-checkout-session/index.ts`](supabase/functions/create-checkout-session/index.ts) | 56-99 | Sends bare `quote.total_amount`, single un-itemised line, no tax |
| [`supabase/functions/_shared/sendOrderConfirmation.ts`](supabase/functions/_shared/sendOrderConfirmation.ts) | 203-208, 224 | "Total paid" only, no VAT rows |
| [`src/pages/admin/AdminOrderDetail.jsx`](src/pages/admin/AdminOrderDetail.jsx) | 402-419 | Renders Subtotal £0.00 / Shipping £0.00; Tax row suppressed |
| [`src/pages/admin/AdminOrders.jsx`](src/pages/admin/AdminOrders.jsx) | 361-397 | CSV exports `Total` only |
| [`src/context/CartContext.jsx`](src/context/CartContext.jsx) | 103-114 | **Dead** 20% VAT + flat £10 shipping |
| [`src/components/Cart.jsx`](src/components/Cart.jsx) | 11-16 | **Dead** VAT calc; comment confirms `/checkout` removed |
| [`server/stripe-server.cjs`](server/stripe-server.cjs) | 44-83 | **Dead** legacy server; the only place VAT reaches Stripe as a line item |
| [`supabase/migrations/20260417_confirm_payment_atomic.sql`](supabase/migrations/20260417_confirm_payment_atomic.sql) | 57-71 | RPC INSERT — no tax columns |
| [`supabase/migrations/20260520_delivery_address_on_quotes.sql`](supabase/migrations/20260520_delivery_address_on_quotes.sql) | 31-51 | Current RPC |
| [`supabase/migrations/20260422_quote_total_sync_trigger.sql`](supabase/migrations/20260422_quote_total_sync_trigger.sql) | — | `recompute_quote_total` — the trigger that will erase VAT if unhandled |
