# Audit — Orphan Order Creation Path

**Date:** 2026-07-22
**Scope:** Read-only. No source files changed, no rows deleted, no PR.
**Trigger:** `ORD-MRUU9H9B` — an order with `quote_id NULL`, `stripe_session_id NULL`, `pending/pending`, `£201.75` total, `subtotal`/`tax_amount` both `0.00`, that never touched Stripe.

---

## TL;DR

1. **The path is `handleConvertToOrder` in [`CustomerQuotes.jsx:290-364`](src/pages/account/CustomerQuotes.jsx#L290)** — a "Convert to Order" button that does a **direct client-side `INSERT` into `orders`**, bypassing Stripe, VAT, and the `confirm_payment_atomic` RPC. It is the only `orders` insert in the entire frontend.
2. **The random `ORD-XXXXXXXX` format is its fingerprint.** A DB trigger only generates the `ORD-YYYYMMDD-NNNN` format when `order_number` is left NULL. The Stripe RPC leaves it NULL (→ date format); this path pre-sets `ORD-${Date.now().toString(36)}` (→ random format, trigger skipped).
3. **The UI button is admin-only, but the database is not.** The `isAdmin &&` gate (added 2026-03-25) only hides the button. The `orders` INSERT RLS policy `"Users create orders"` has **no admin check** — `with_check: (auth.uid() = customer_id)`. **Any authenticated customer can create an unpaid, no-VAT order for themselves at the data layer.** This is the load-bearing risk before Stripe live keys.
4. **The existing orphan was admin-created** (creator `dec72a0d…` is a `super_admin`), so this was Dave testing — not proof of live customer abuse. But the RLS hole means a customer *could* do it.
5. **Recommendation: remove the path AND remove the customer INSERT RLS policy.** The Stripe RPC runs as service-role and does not need that policy, so dropping it closes the hole with zero impact on the real payment flow.

---

## 1. The creation path

### 1.1 Every site that inserts into `orders`

Grepping `.from('orders')` across `src/` returns 20 hits; **exactly one is an `INSERT`**. Every other is a `select`/`update`. Plus the server-side RPC.

| # | Location | Sets `quote_id`? | Sets `stripe_session_id`? | `status` | `payment_status` | Notes |
|---|---|---|---|---|---|---|
| A | [`confirm_payment_atomic`](supabase/migrations/20260520_delivery_address_on_quotes.sql#L79) (RPC, service-role) | **Yes** | **Yes** | `confirmed` | `paid` | The canonical Stripe path. Also writes `subtotal`/`tax_amount` (post-VAT-fix). Leaves `order_number` NULL. |
| B | [`CustomerQuotes.jsx:305-315`](src/pages/account/CustomerQuotes.jsx#L305) `handleConvertToOrder` (client) | **No** | **No** | `pending` | *(unset → default `pending`)* | **The orphan path.** Pre-sets `order_number`. Never writes `subtotal`/`tax_amount` (→ default `0`). |

The orphan insert, verbatim:

```jsx
// src/pages/account/CustomerQuotes.jsx:301-315
const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}`;
...
const { data: order, error: orderError } = await supabase
  .from('orders')
  .insert({
    order_number: orderNumber,
    customer_id: user.id,
    status: 'pending',
    artwork_status: 'pending_artwork',
    total_amount: quoteTotal          // raw line sum, no VAT
  })
  .select()
  .single();
```

Every field that makes the orphan an orphan is explained here: no `quote_id`, no `stripe_session_id`, no `payment_status` (defaults to `pending`), no `subtotal`/`tax_amount` (default `0`), `total_amount` = raw `getQuoteTotal(items)` with no VAT. It then inserts `order_items` directly (line 331) and marks the quote `converted` (line 341).

### 1.2 Why the two order-number formats arise

There is a `BEFORE INSERT` trigger on `orders` (confirmed live):

```
CREATE TRIGGER set_order_number BEFORE INSERT ON public.orders
  FOR EACH ROW WHEN (new.order_number IS NULL)
  EXECUTE FUNCTION generate_order_number();
```

- **Path A (Stripe RPC)** does **not** set `order_number` → it is NULL → the trigger fires → `generate_order_number()` produces the sequential **`ORD-YYYYMMDD-NNNN`** (e.g. `ORD-20260722-0025`).
- **Path B (Convert to Order)** **pre-sets** `order_number = ORD-${Date.now().toString(36).toUpperCase()}` → not NULL → the trigger's `WHEN (order_number IS NULL)` is false → skipped → the client's random **`ORD-XXXXXXXX`** survives (e.g. `ORD-MRUU9H9B`).

**So the random-suffix format is a reliable signature of Path B.** Any `ORD-` + random-base36 order came through Convert-to-Order; any `ORD-<date>-<seq>` came through Stripe.

---

## 2. Reachability

**Not dead code. UI-gated to admins; data-layer open to any authenticated user.**

### 2.1 UI layer — admin-only since 2026-03-25

The button is rendered only when `isAdmin` is true:

```jsx
// src/pages/account/CustomerQuotes.jsx:729-737
{isAdmin && (
  <button onClick={() => setConvertingQuote(quote)} ...>
    Convert to Order
  </button>
)}
```

`isAdmin` is a genuine role check against `team_members`:

```jsx
// src/pages/account/CustomerQuotes.jsx:71-82
supabase.from('team_members').select('role')
  .eq('user_id', user.id).eq('is_active', true).maybeSingle()
  .then(({ data }) => {
    if (data && (data.role === 'super_admin' || data.role === 'staff')) setIsAdmin(true);
  });
```

Page: **My Quotes** (`/account/quotes`, behind auth). The button sits next to the (customer-facing) **Pay Now** button, in each non-converted quote card. So in the shipped UI, only a signed-in super_admin/staff sees it.

### 2.2 Data layer — open to ANY authenticated user (the real gap)

The insert runs client-side with the caller's own JWT, so RLS is the actual gate. The live `orders` policies:

| policyname | cmd | with_check / qual |
|---|---|---|
| Users create orders | **INSERT** | `with_check: (auth.uid() = customer_id)` |
| Admins manage orders | ALL | `is_admin(auth.uid())` |
| Users view own orders | SELECT | `(auth.uid() = customer_id AND deleted_at IS NULL) OR is_admin(auth.uid())` |

**`"Users create orders"` requires only that `customer_id = auth.uid()` — no admin check.** So any signed-in customer can `POST /rest/v1/orders` with their own `customer_id`, an arbitrary `total_amount`, `status`, and `payment_status`, and create an unpaid order — the `isAdmin &&` button gate is purely cosmetic. `order_items` INSERT is governed by `"Order items follow order access"` (`ALL`, no admin restriction), so the child rows go in too.

This is the finding that matters before live keys: **removing or hiding the button does not close the hole; the RLS policy does.**

### 2.3 Who created the existing orphan

The creator `customer_id = dec72a0d-9b36-4615-9f05-c51e803760de` **is a `super_admin`** in `team_members`. So `ORD-MRUU9H9B` (and, by inference, the earlier `ORD-MMZ8DWT5`) were created by an admin exercising the button — i.e. Dave testing — **not** evidence of a customer exploiting the RLS gap. But the gap is real and independent of who has used it so far.

---

## 3. Intent (git history)

- **2026-03-05** (`386ae1e`) — `handleConvertToOrder` **added**, when the button was visible to **all customers**. This predates the mature Stripe flow; Phase 4 Stripe (`1e0a11e`) and later atomic fixes hardened payment afterward.
- **2026-03-25** (`72f514a` "Hide Convert to Order button for non-admin users") — the `isAdmin &&` gate added. Earlier fixes (`af3bf9a` "add line_total", `06b9460` "Fix Convert to Order schema error") show it was a live, iterated feature, not a stub.

**Interpretation:** this is CLAUDE.md §17.1's **"Path B — Convert to Order (manual/admin use)"** — a pre-Stripe way to turn a quote into an order with **no payment taken**. It was a customer self-serve action originally, then walled off to admins once real Stripe checkout ("Pay Now") existed. It is **superseded legacy for customers**, retained as an informal admin "make an order without payment" shortcut. It has never been updated for VAT, and it structurally cannot record a payment.

---

## 4. Impact

The orphan is a **real `orders` row**, so it is treated as real everywhere reads happen:

- **Admin Orders list:** ✅ appears (admin `is_admin` SELECT sees all). Shows as `pending`/`pending`. **Staff could mistake it for a genuine order and start production on something never paid for.**
- **Customer My Orders:** ✅ appears (`auth.uid() = customer_id AND deleted_at IS NULL`). The customer sees an "order" they never paid for.
- **Downstream already engaged:** the live orphan has `artwork_status = 'artwork_uploaded'` with **1 `order_items` row and 1 `order_artwork` file**. So artwork upload ran against it, which means the **artwork-received email path fired** — the customer was told "we've got your artwork" for an unpaid order. It is being handled as a live order by the fulfilment-adjacent flow.
- **Can it ever be paid?** **No.** Pay Now / `create-checkout-session` operates on a **quote_id**, not an order; this order has no `quote_id`, and its source quote is already marked `converted`. `confirm_payment_atomic` is keyed quote→order and would never target this row. It is **permanently stranded as unpaid**, with `tax_amount = 0` (no VAT ever computed).
- **VAT:** absent. `total_amount` is the raw net line sum; `subtotal`/`tax_amount` = 0. If it were ever "fulfilled", it would ship with no VAT recorded — the exact compliance gap PR A/B exist to close.

Current live state: only **`ORD-MRUU9H9B`** remains an orphan. `ORD-MMZ8DWT5` no longer exists — it was removed by the VAT migration's test-data wipe (`20260719`). Total orders now = 2 (one healthy Stripe order `ORD-20260722-0025`, one orphan).

---

## 5. Recommendation

**Remove the path, and remove the customer-side `orders` INSERT RLS policy.** Two layers, because the button and the RLS are independent gaps and the RLS is the one that actually protects money.

### Why remove rather than fix/guard

- It is **superseded** for customers by the Stripe quote→Pay Now pipeline (Path A), which is the only path that takes payment and (post-VAT-fix) records VAT.
- It **cannot produce a correct row**: no payment, no VAT, unpayable, orphaned from its quote. "Fixing it to route through the quote pipeline" is redundant — the quote pipeline already exists and is what Pay Now uses.
- If Dave genuinely wants an **admin manual-order tool** (phone orders, pay-by-invoice), that is a *new, deliberate* feature that must compute VAT, mark a payment method, and link the quote — not this insert. Building it is out of scope; it should not block closing the hole.

### The change

1. **Frontend** — remove from [`CustomerQuotes.jsx`](src/pages/account/CustomerQuotes.jsx): `handleConvertToOrder` (290-364), the `{isAdmin && …}` button (729-737), the confirmation modal (764-…), and the now-unused `convertingQuote`/`converting`/`orderSuccess` state and the `isAdmin` fetch (71-82) if not referenced elsewhere in the file. ~80 lines net removal.
2. **RLS migration (load-bearing)** — drop the `"Users create orders"` INSERT policy on `orders`. **Verified safe:** the Stripe path (`confirm_payment_atomic`) runs as **service_role**, which bypasses RLS, so it does not depend on this policy. After removal, `orders` can be created only by the RPC/service-role or by admins (`"Admins manage orders"` ALL). Consider the same review for `order_items` INSERT (`"Order items follow order access"`).

### Blast radius

- **Files touched:** 1 frontend file (`CustomerQuotes.jsx`) + 1 new migration.
- **Migration required:** **Yes** — a single `DROP POLICY "Users create orders" ON public.orders;` (with a `.down` recreating it). Non-destructive to data; apply via SQL Editor per §52. Pairs naturally with the VAT sequencing (both must be in before live keys).
- **Risk:** low. No customer-facing feature is lost (customers use Pay Now). Admins lose an informal shortcut that only ever produced broken rows.

*(Lighter alternative if Dave wants to keep an admin shortcut for now: leave the button but still drop/replace the RLS policy so INSERT requires `is_admin(auth.uid())`. That alone closes the customer-exploit hole. But the resulting admin-created rows are still VAT-less and unpayable, so removal is cleaner.)*

### Delete the orphan rows — yes

`ORD-MMZ8DWT5` is already gone (wiped). Only `ORD-MRUU9H9B` remains; it is admin-created test data, unpaid, unpayable. Delete it and its children. `order_items`/`order_artwork` have `ON DELETE CASCADE` to `orders`, but delete explicitly for clarity and to be safe if cascade config differs:

```sql
BEGIN;
-- Confirm target first (should be exactly the one orphan, unpaid):
--   SELECT order_number, payment_status, quote_id, stripe_session_id
--     FROM orders WHERE order_number = 'ORD-MRUU9H9B';
DELETE FROM public.order_artwork
 WHERE order_id IN (SELECT id FROM public.orders WHERE order_number = 'ORD-MRUU9H9B');
DELETE FROM public.order_items
 WHERE order_id IN (SELECT id FROM public.orders WHERE order_number = 'ORD-MRUU9H9B');
DELETE FROM public.orders
 WHERE order_number = 'ORD-MRUU9H9B';
COMMIT;
```

**Also:** the orphan has 1 uploaded artwork file. After the row delete, remove the leftover object from the private **`order-artwork`** Storage bucket (Dashboard → Storage), since the DB delete does not touch Storage. The file lives under `{user_id}/{order_id}/…` for that order.

Optionally reset its source quote back to payable (it was force-marked `converted` by the same handler), if Dave wants to actually sell it:
```sql
-- UPDATE public.quotes SET status = 'draft'
--  WHERE id = (…the quote that was converted into ORD-MRUU9H9B…) AND status = 'converted';
```
The handler didn't store the link, so the quote must be identified manually (by customer + line total/timestamp) — flagged, not assumed.

---

## Appendix — evidence

| Fact | Source |
|---|---|
| Only `orders` INSERT in frontend | `grep .from('orders')` → sole insert at `CustomerQuotes.jsx:306` |
| Orphan insert fields | `CustomerQuotes.jsx:301-315` |
| Order-number trigger | live: `set_order_number BEFORE INSERT … WHEN (new.order_number IS NULL) EXECUTE generate_order_number()` |
| Button admin-gated | `CustomerQuotes.jsx:729`; gate added `72f514a` (2026-03-25) |
| RLS INSERT open to any authenticated | live `pg_policies`: `"Users create orders"` INSERT `with_check (auth.uid() = customer_id)` |
| Orphan creator is super_admin | live `team_members` for `dec72a0d…` → `super_admin`, active |
| Orphan progressed (artwork) | live: `ORD-MRUU9H9B` `artwork_status='artwork_uploaded'`, 1 item, 1 artwork |
| `MMZ8DWT5` already gone | live: not present; removed by `20260719` wipe |
| Stripe RPC is service-role (RLS-exempt) | `confirm_payment_atomic` grants `service_role` only (§17.7) |
