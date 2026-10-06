# Admin Orders Tab Iteration — Audit

Read-only audit covering the four requested items (search bar, export with row selection, soft-delete, date range filter). No code changes made. Schema probed live via the Supabase Management API on 2026-06-29.

---

## §1 Current Admin Orders implementation

### 1.1 Route + guard

- [src/App.jsx:138-140](src/App.jsx#L138-L140)
  ```jsx
  <Route path="/admin"             element={<AdminGuard><AdminDashboard /></AdminGuard>} />
  <Route path="/admin/orders"      element={<AdminGuard><AdminOrders /></AdminGuard>} />
  <Route path="/admin/orders/:id"  element={<AdminGuard><AdminOrderDetail /></AdminGuard>} />
  ```
- [src/components/admin/AdminGuard.jsx](src/components/admin/AdminGuard.jsx) (140 lines). Gates on:
  - Authenticated user (`supabase.auth.getUser()`)
  - Row in `team_members` table with `is_active = true`
  - Role IN `('super_admin', 'staff')`
  - Failed checks `navigate('/')` with a flash message.

### 1.2 Orders page

- File: [src/pages/admin/AdminOrders.jsx](src/pages/admin/AdminOrders.jsx) — 352 lines.
- Wrapped by [src/components/admin/AdminLayout.jsx](src/components/admin/AdminLayout.jsx).
- Sister admin files (out of scope for this iteration but relevant context): `AdminDashboard.jsx`, `AdminOrderDetail.jsx`, `AdminCustomers.jsx`, `AdminCustomerDetail.jsx`, `AdminTeam.jsx`, `AdminSettings.jsx`.

JSX skeleton (top-down):

```
AdminLayout
├── Header card
│   ├── Search input  (✓ wired — see §2)
│   ├── Status dropdown (8 enum values)
│   ├── Artwork dropdown (7 enum values)
│   └── Export button  (⚠ placeholder, no onClick — see §3)
├── Results count
└── Orders table
    ├── thead: Order # | Customer | Date | Status | Artwork | Payment | Total | Actions
    └── tbody.map(paginatedOrders): row → View link to /admin/orders/:id
    └── Pagination (20 per page)
```

### 1.3 Orders table — live schema (probed 2026-06-29)

`public.orders` — 24 columns, **NOT NULL on `order_number`** (populated by trigger):

| # | column | type | nullable | default |
|---|---|---|---|---|
| 1 | id | uuid | NO | `gen_random_uuid()` |
| 2 | order_number | text | **NO** | — (set by trigger) |
| 3 | quote_id | uuid | YES | — |
| 4 | customer_id | uuid | YES | — |
| 5 | status | text | YES | `'pending'` |
| 6 | payment_status | text | YES | `'pending'` |
| 7 | payment_intent_id | text | YES | — |
| 8 | subtotal | numeric | YES | 0 |
| 9 | shipping_cost | numeric | YES | 0 |
| 10 | tax_amount | numeric | YES | 0 |
| 11 | total_amount | numeric | YES | 0 |
| 12 | po_number | text | YES | — |
| 13 | shipping_address | jsonb | YES | — |
| 14 | billing_address | jsonb | YES | — |
| 15 | estimated_delivery | date | YES | — |
| 16 | tracking_number | text | YES | — |
| 17 | admin_notes | text | YES | — |
| 18 | customer_notes | text | YES | — |
| 19 | created_at | timestamptz | YES | `now()` |
| 20 | updated_at | timestamptz | YES | `now()` |
| 21 | artwork_status | text | YES | `'pending_artwork'` |
| 22 | stripe_session_id | text | YES | — |
| 23 | artwork_received_email_sent_at | timestamptz | YES | — |
| 24 | confirmation_email_sent_at | timestamptz | YES | — |

Live row count: **19 orders** (18 `confirmed`, 1 `pending`). Tiny — migration risk is essentially nil from a data-size perspective.

### 1.4 RLS policies on `orders`

| policyname | cmd | qual |
|---|---|---|
| Admins manage orders | ALL | `is_admin(auth.uid())` |
| Users create orders | INSERT | `auth.uid() = customer_id` (with_check) |
| Users view own orders | SELECT | `auth.uid() = customer_id OR is_admin(auth.uid())` |

**Important:** the "Users view own orders" policy does NOT filter on any deletion flag. Soft-delete needs to either amend this policy or add a `WHERE deleted_at IS NULL` to every customer-facing query (8 sites — see §6).

---

## §2 Search bar diagnosis

### 2.1 Code, verbatim

[src/pages/admin/AdminOrders.jsx:15](src/pages/admin/AdminOrders.jsx#L15) state:
```jsx
const [searchQuery, setSearchQuery] = useState('');
```

[src/pages/admin/AdminOrders.jsx:23-25](src/pages/admin/AdminOrders.jsx#L23-L25) effect:
```jsx
useEffect(() => {
  applyFilters();
}, [orders, statusFilter, artworkFilter, searchQuery]);
```

[src/pages/admin/AdminOrders.jsx:83-91](src/pages/admin/AdminOrders.jsx#L83-L91) filter:
```jsx
if (searchQuery) {
  const query = searchQuery.toLowerCase();
  filtered = filtered.filter(order => {
    const orderNum = (order.order_number || '').toLowerCase();
    const customerName = getCustomerDisplayName(order.customer_profiles).toLowerCase();
    return orderNum.includes(query) || customerName.includes(query);
  });
}
```

[src/pages/admin/AdminOrders.jsx:100-110](src/pages/admin/AdminOrders.jsx#L100-L110) display-name helper:
```jsx
const getCustomerDisplayName = (profile) => {
  if (!profile) return 'Unknown Customer';
  const company = (profile.company_name || '').trim();
  if (company) return company;
  const first = (profile.first_name || '').trim();
  const last = (profile.last_name || '').trim();
  const fullName = `${first} ${last}`.trim();
  if (fullName) return fullName;
  if (profile.email) return profile.email;
  return 'Unknown Customer';
};
```

[src/pages/admin/AdminOrders.jsx:167-173](src/pages/admin/AdminOrders.jsx#L167-L173) input:
```jsx
<input
  type="text"
  placeholder="Search by order # or customer..."
  value={searchQuery}
  onChange={(e) => setSearchQuery(e.target.value)}
  className="..."
/>
```

[src/pages/admin/AdminOrders.jsx:256-273](src/pages/admin/AdminOrders.jsx#L256-L273) customer cell renders **two lines**:
```jsx
<td className="...">
  {(() => {
    const profile = order.customer_profiles;
    const name = getCustomerDisplayName(profile);
    const showEmail = profile?.email && profile.email !== name;
    return (
      <div>
        <p className="font-medium">{name}</p>
        {showEmail && <p className="text-xs text-gray-500">{profile.email}</p>}
      </div>
    );
  })()}
</td>
```

### 2.2 Mechanism — handler fires, state updates, filter re-runs, BUT filter doesn't cover all visible cell content

The plumbing is intact:

- Input is controlled (`value={searchQuery}`).
- `onChange` calls `setSearchQuery`.
- `useEffect` depends on `searchQuery` and calls `applyFilters` on every keystroke.
- `applyFilters` rebuilds `filteredOrders`, which is what the table iterates.

**Bug**: the filter only matches against two strings:
1. `order_number` (always present — `NOT NULL` per schema and trigger).
2. The result of `getCustomerDisplayName(profile)` — a **single priority-resolved string** (company → name → email → 'Unknown Customer').

But the customer cell visibly renders **two lines**: the display name AND the email (as a sub-line, when distinct). Typing the email — which the user can see directly under the company name — does NOT match because the filter never sees `profile.email` independently of the display chain.

Worked example (against the live data shape):
- Customer with `company_name="Acme Ltd", email="contact@acme.com"`:
  - Cell renders: `Acme Ltd` / `contact@acme.com`
  - `getCustomerDisplayName` returns `"acme ltd"`
  - Typing `acme` → match. Typing `contact@acme.com` → NO match.

That is the most plausible reproducer for "typing doesn't filter": Dave types something visible (an email or a first name when the customer has a company set) and observes no narrowing.

Additional smaller gap: there is no search across `po_number`, `payment_intent_id`, or the order's full `id` (UUID). The `|| order.id.slice(0, 8)` fallback in the row render (line 254) is defensive but is in practice unreachable because `order_number` is `NOT NULL`.

### 2.3 Playwright corroboration — not run

Admin pages need a `team_members.is_active=true` row in production. I have no admin credentials in this session and the project's mock-auth path (`isMockAuth`) only kicks in when `VITE_SUPABASE_URL` is unset — i.e. it's not available against the live DB. Static analysis above is conclusive without a Playwright pass.

---

## §3 Export — current behaviour

### 3.1 The button is a placeholder

[src/pages/admin/AdminOrders.jsx:208-211](src/pages/admin/AdminOrders.jsx#L208-L211):
```jsx
<button className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
  <Download className="h-4 w-4" />
  <span>Export</span>
</button>
```

**No `onClick` handler.** No accompanying export function in the file. Grep across the project (per `Explore` agent: zero hits for `exportToCSV`, `toCSV`, `xlsx`, `papaparse`, `Blob`) confirms **there is no working export anywhere in admin code**.

The brief's premise that Export "currently exports all orders" is incorrect — the button is decorative. The iteration is effectively "build export + row selection from scratch", not "modify existing export to respect selection".

### 3.2 No export library installed

`package.json` (not pasted here for brevity, but grep returned zero matches for `papaparse`, `xlsx`, `sheetjs`, `csv-stringify`). A new dependency choice is part of this iteration's scope.

---

## §4 Delete affordance — none exists

### 4.1 No UI

Grep within `src/pages/admin/` and `src/components/admin/` for `delete`, `remove`, `archive`, `trash` (excluding lucide-react icon imports): **no order-delete UI or handler anywhere**. The closest existing concept is the `cancelled` status enum value, which is a workflow state, not a deletion.

[AdminOrderDetail.jsx](src/pages/admin/AdminOrderDetail.jsx) advances status (`pending → confirmed → approved → in_production → shipped → completed`) and edits artwork status, but never deletes a row.

### 4.2 No DB-level soft-delete column

Per probe: `orders` has no `deleted_at`, `archived_at`, `is_deleted`, `is_archived`, or `removed_at`. The only deletion-adjacent column is `status` (workflow). Greenfield add.

### 4.3 FK graph — CASCADE on every child

| referencing_table | column | delete_rule |
|---|---|---|
| `order_items` | order_id | **CASCADE** |
| `order_status_history` | order_id | **CASCADE** |
| `order_artwork` | order_id | **CASCADE** |

Three child tables CASCADE on `orders` delete. A hard `DELETE FROM orders WHERE id=…` would silently nuke:
- All `order_items` line rows (priced, quantity-locked at checkout time).
- All `order_status_history` audit rows.
- All `order_artwork` metadata rows — **and orphan the corresponding files in the `order-artwork` Supabase Storage bucket** (storage is not in the FK graph).

That cascade behaviour is why §6 concludes soft-delete is non-negotiable for the "mistake removal" use case Dave described.

---

## §5 Existing filters — pattern + where date filter slots in

### 5.1 Existing filter pattern is client-side

Two existing dropdown filters, both client-side, both following the identical shape:

[AdminOrders.jsx:178-191](src/pages/admin/AdminOrders.jsx#L178-L191) — Status dropdown:
```jsx
<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
  <option value="all">All Status</option>
  <option value="pending">Pending</option>
  ...
</select>
```

[AdminOrders.jsx:193-206](src/pages/admin/AdminOrders.jsx#L193-L206) — Artwork dropdown: same shape.

Filters applied in [AdminOrders.jsx:70-95](src/pages/admin/AdminOrders.jsx#L70-L95) `applyFilters` — three sequential `Array.filter` passes against the in-memory `orders` array. **No `.eq()` is ever pushed to PostgREST for filtering** — `fetchOrders` issues an unconditional `SELECT * FROM orders ORDER BY created_at DESC` (lines 35-38).

### 5.2 Why client-side filtering is fine here

At 19 rows live, server-side filtering would be premature optimisation. Even at 10× growth (~200 orders) client-side `Array.filter` is sub-millisecond. The 20-rows-per-page pagination caps render cost regardless of dataset size.

The new date filter should follow this same pattern: a new state slice + a new branch inside `applyFilters` + a new control in the header row.

---

## §6 Risk surface for soft-delete (the critical section)

### 6.1 What hard-delete would break

Even one mistakenly hard-deleted paid order would:

1. **CASCADE-wipe `order_items`** — line-item history gone. Can't reprint invoice, can't service a refund, can't satisfy HMRC 6-year record retention.
2. **CASCADE-wipe `order_status_history`** — audit trail of who advanced the order through pending → confirmed → … gone.
3. **CASCADE-wipe `order_artwork` rows but ORPHAN the storage files** — the storage bucket `order-artwork` is not in the FK graph. Deleting the row leaves the bytes on disk, billed but unreachable.
4. **Break `confirm_payment_atomic` idempotency** — the RPC anchors on `orders.stripe_session_id` (unique constraint `orders_stripe_session_id_uniq`, CLAUDE.md §44.2). A Stripe webhook retry for the deleted order's session id would attempt a fresh INSERT, succeed (since the unique row is gone), and produce a duplicate ORD-… number plus a fresh order chain — meaning the customer receives a confirmation email for an order they already paid for.
5. **Break customer support** — "what did I order in May?" requires the row to exist.

### 6.2 What soft-delete (`deleted_at IS NOT NULL`) preserves

All five concerns above are answered by keeping the row + flipping a flag:

| Concern | Soft-delete behaviour |
|---|---|
| HMRC retention | Row stays. ✓ |
| Stripe idempotency | `stripe_session_id` still occupies its unique slot, webhook short-circuits as designed. ✓ |
| `order_items` history | Children preserved. ✓ |
| `order_artwork` storage | Bucket files retained, no orphan billing. ✓ |
| Audit | `order_status_history` survives. ✓ |

### 6.3 Backend order-id consumers (must each be considered)

**Edge Functions (Deno):**
- [supabase/functions/confirm-payment/index.ts](supabase/functions/confirm-payment/index.ts) — does NOT touch `orders` directly; delegates to `confirm_payment_atomic` RPC then calls `sendOrderConfirmation`.
- [supabase/functions/stripe-webhook/index.ts](supabase/functions/stripe-webhook/index.ts) — same.
- [supabase/functions/_shared/sendOrderConfirmation.ts:59-79](supabase/functions/_shared/sendOrderConfirmation.ts#L59-L79) — reads orders directly:
  ```ts
  SELECT id, order_number, total_amount, customer_id, confirmation_email_sent_at, ...
  FROM orders WHERE id=$orderId
  ```
  Does NOT filter `deleted_at`. **If an admin soft-deletes mid-flight (between RPC commit and email send), the customer still receives the email.** Defensive fix recommended (§8.3).
- [supabase/functions/send-artwork-received-email/index.ts:44-50](supabase/functions/send-artwork-received-email/index.ts#L44-L50) — same shape, same defensive concern.

**Frontend reads (must each add `WHERE deleted_at IS NULL` post-migration, OR rely on amended RLS):**
- Admin reads (5 files):
  - `src/pages/admin/AdminOrders.jsx:35-38`
  - `src/pages/admin/AdminCustomers.jsx:38, 43`
  - `src/pages/admin/AdminCustomerDetail.jsx:39`
  - `src/pages/admin/AdminOrderDetail.jsx:98, 123, 132, 166, 178, 196, 219`
  - `src/pages/admin/AdminDashboard.jsx:61, 66, 81, 93, 112, 155`
- Customer reads (4 files):
  - `src/pages/account/CustomerDashboard.jsx:28, 53`
  - `src/pages/account/CustomerOrderDetail.jsx:28, 40, 54`
  - `src/pages/account/CustomerOrders.jsx:28`
  - `src/pages/account/CustomerQuotes.jsx:306, 322`
- Service-layer writes:
  - `src/services/supabaseService.js:2820-2965` — `uploadOrderArtwork`, `getOrderArtwork`, `deleteOrderArtwork`. Mutate `orders.artwork_status` and CRUD `order_artwork`. Should NOT operate on soft-deleted orders.

That's **8 admin/customer query sites** that currently `SELECT * FROM orders` without any deletion filter.

### 6.4 The two design choices soft-delete forces

1. **Where to filter `deleted_at IS NULL`** — every query site, OR amend the existing "Users view own orders" RLS qual to `auth.uid() = customer_id AND deleted_at IS NULL OR is_admin(auth.uid())`. The RLS-side fix is cleaner (one change, no sweep) but means admin code that wants to surface deleted rows (e.g. a future "Show deleted" toggle) has to opt in explicitly. Recommend RLS-side fix in §8.3.
2. **What `stripe_session_id` does post-delete** — leave it (anchoring blocks duplicate orders for the same Stripe session, which is correct) OR null it out (frees the slot, but means a retry creates a duplicate order). **Recommend: leave anchored.** Stripe will not retry a session that has already paid; the unique constraint is the safety net against weird re-confirmation flows. Soft-deleting then expecting a fresh order is not the use case ("mistake removal" is about the admin's view, not Stripe re-attempting payment).

---

## §7 Theory ranking for the search bar

Static evidence overwhelmingly supports **Theory B** as the cause. C, D, E are ruled out by the code. A is partially true but is a special case of B.

| # | Theory | Verdict | Evidence |
|---|---|---|---|
| **B** | **Filter exists but isn't applied to ALL visible columns (filtered list discards some intuitive matches)** | **MOST LIKELY** | Filter (lines 86-90) only checks `order_number` and `getCustomerDisplayName` (a SINGLE priority-resolved string). The customer cell visibly renders TWO lines (display name + email subline). Typing the visible email when customer has a company set produces no match. |
| A | onChange exists but state isn't being read in the filter function | partially | State IS read, but only fed into one of two visible cell lines. Sub-variant of B. |
| C | Handler missing — uncontrolled input | RULED OUT | Input is controlled (`value={searchQuery}`, `onChange={(e) => setSearchQuery(e.target.value)}`). |
| D | Server-side fetch ignores search term | RULED OUT | Fetch is one-shot `SELECT *` (line 35-38); search is purely client-side. |
| E | Something else | LOW | useEffect deps include `searchQuery`; `applyFilters` calls `setFilteredOrders`; `paginatedOrders` derives from `filteredOrders`; pagination resets to page 1 on filter change. The chain is intact. |

The fix in §8.1 is therefore a small, targeted change to broaden the filter's coverage of visible fields — no plumbing changes, no new state, no fetch changes.

---

## §8 Recommended implementation shape (prose only)

### 8.1 Search bar fix

**Smallest possible patch.** Replace the filter block at [AdminOrders.jsx:83-91](src/pages/admin/AdminOrders.jsx#L83-L91) with one that searches every cell value the user can see, plus the admin-friendly fields (order id, payment intent id, PO number):

- Match against `order_number` (existing).
- Match against the full `order.id` (UUID) so admins typing the start of an id from the URL find the row.
- Match against `po_number` (customer-supplied reference often used to identify orders externally).
- Match against `payment_intent_id` (Stripe-side reconciliation lookups — admin convenience).
- Match against the **raw profile fields** (`company_name`, `first_name`, `last_name`, `email`) independently, not the priority-resolved display string. This is the fix for the email-not-found bug.

State + handlers unchanged. `useEffect` deps unchanged. Pure logic widening inside `applyFilters`.

| Estimate | S |
|---|---|
| Files touched | 1 (`AdminOrders.jsx`) |
| Lines changed | ~10 |
| New deps | none |
| Migration | none |
| RLS | none |
| Risk | none — purely additive to matching set |

### 8.2 Row selection + filtered export

Build from scratch (the existing button is a placeholder).

**State:** new `Set<string>` of selected order ids, e.g. `const [selectedIds, setSelectedIds] = useState(() => new Set())`. Using a `Set` keeps toggling O(1) and gives natural `selectedIds.size` and `has(id)` semantics in the row render.

**UI:**
- New first column in the table header containing a tri-state checkbox (unchecked / indeterminate when partial / checked when all paginated rows selected). Click toggles every row on the current page (matching common admin-table convention — toggling across all pages is surprising).
- New first cell in each row with a per-row checkbox bound to `selectedIds.has(order.id)`.
- Results-count line gains a parenthetical when there's a selection: `Showing 12 orders (3 selected)`.
- Export button label text adapts: `Export` when none selected, `Export 3 selected` when there is a selection.

**Export semantics** (matches Dave's brief):
- Selection empty → export all currently-filtered rows (i.e. `filteredOrders`, NOT the full unfiltered set — the user has already narrowed via search/status/artwork/date).
- Selection non-empty → export only `filteredOrders.filter(o => selectedIds.has(o.id))`.

**Format:** CSV is the lightest choice and matches accounting/spreadsheet workflows. Build the CSV inline (no library) to avoid a new dependency — the row count is small (19 today, projected hundreds), and CSV escaping is ~15 lines (`"` and `,` and `\n` escape; wrap any field containing those in `"…"` and double internal quotes). Trigger download via a `Blob` + `URL.createObjectURL` + transient `<a download>` — same vanilla pattern the codebase already uses elsewhere if needed.

**Columns to include in the CSV:** Order #, Date (ISO 8601 not the UK display format — so re-imports parse cleanly), Customer (display name), Customer email, Status, Artwork status, Payment status, Subtotal, Shipping, Tax, Total, PO number, Stripe session id, Tracking number. This is the working set an admin needs for reconciliation.

| Estimate | M |
|---|---|
| Files touched | 1 (`AdminOrders.jsx`); maybe extract `exportOrdersToCsv` into a sibling util |
| Lines changed | ~80 |
| New deps | none |
| Migration | none |
| RLS | none |
| Risk | low — additive UI, no mutation |

### 8.3 Soft-delete

**Three-layer change** (DB migration, RLS qual, UI). This is the heaviest item.

**Migration** (one file, manual SQL Editor apply per CLAUDE.md §52):

```sql
ALTER TABLE orders ADD COLUMN deleted_at timestamptz;

-- Partial index covering the live-only list queries (the most common path).
CREATE INDEX orders_active_idx ON orders (created_at DESC) WHERE deleted_at IS NULL;

-- Amend the RLS SELECT policy so soft-deleted rows are invisible to the
-- customer-facing path but admins keep seeing everything (existing
-- "Admins manage orders" ALL policy is unchanged and continues to grant
-- admin SELECT on every row, including deleted).
DROP POLICY "Users view own orders" ON orders;
CREATE POLICY "Users view own orders" ON orders FOR SELECT USING (
  (auth.uid() = customer_id AND deleted_at IS NULL)
  OR is_admin(auth.uid())
);
```

**Default admin list filter.** Because admin code runs with the `is_admin()` branch granted, the customer-side RLS amendment doesn't auto-hide deleted rows from admin views. The admin Orders list should therefore default to `WHERE deleted_at IS NULL` in the JS query (one line change in `fetchOrders`) and the soft-delete affordance + a future "Show deleted" toggle become the only paths to a row with `deleted_at` set. Same one-line addition is needed in `AdminCustomerDetail.jsx` and the dashboard KPI roll-ups (they shouldn't count deleted in customer-facing metrics).

**Defensive filter for Edge Functions.** Add `.is('deleted_at', null)` to the two confirmation-email helpers (`sendOrderConfirmation.ts:59`, `send-artwork-received-email/index.ts:44`) so a soft-delete mid-flight doesn't email the customer a confirmation for an order they don't have. Return `{ sent: false, reason: 'order_deleted' }` rather than throwing — the email skip is non-fatal.

**Customer-side reads need no change** — the RLS amendment hides deleted rows from `auth.uid()=customer_id` automatically.

**UI affordance.** Per-row trashcan icon in the existing Actions column (alongside the View link). On click:
1. Open a confirmation modal: *"Soft-delete order ORD-…? It will be hidden from the admin list and from the customer's dashboard, but retained for accounting and Stripe reconciliation."*
2. On confirm: `UPDATE orders SET deleted_at = NOW() WHERE id = $orderId` (via the existing supabase client; the admin RLS policy permits).
3. On success: optimistically remove the row from local `orders` state; show a toast: *"Order soft-deleted. Restore via SQL if needed."*
4. On error: surface the message; do not optimistically remove.

**Restore path.** Out of scope for the UI in this iteration; documented in CLAUDE.md as a manual SQL recovery: `UPDATE orders SET deleted_at = NULL WHERE id = '…'`. A future "Show deleted" admin toggle could surface a restore button when the row has `deleted_at IS NOT NULL`.

**Stripe session id behaviour.** Leave `stripe_session_id` populated on soft-delete. The unique constraint `orders_stripe_session_id_uniq` continues to block duplicate-confirmation race conditions (CLAUDE.md §44 invariants). Soft-deleting an order is not the same as "letting Stripe create a fresh order for the same session" — that is not a use case Dave has asked for.

| Estimate | L |
|---|---|
| Files touched | 1 new migration + RLS UPDATE + 1 admin JSX + 1 Edge Function file (`sendOrderConfirmation.ts`) + 1 Edge Function file (`send-artwork-received-email/index.ts`). Optionally `AdminDashboard.jsx` for KPI filter. |
| Lines changed | ~120 |
| New deps | none |
| Migration | yes — manual apply gate per §52 |
| RLS | yes — replaces "Users view own orders" |
| Risk | medium — RLS change affects every customer-facing read path; defensive Edge Function filters affect post-payment flow. Both are well-bounded by the schema's small surface. |

### 8.4 Date range filter

**Mirror the existing Status/Artwork pattern.** Client-side. New state slice, new control in the header, new branch in `applyFilters`.

**UI:** preset dropdown (`Any date` / `Last 7 days` / `Last 30 days` / `Last 90 days` / `This year` / `Custom range`) is the lightest fit and matches how admins typically describe a search ("orders from last month, please"). The `Custom range` option reveals two `<input type="date">` controls below. Avoid a date-picker library — `<input type="date">` is well-supported and consistent with the project's no-dep-creep instinct.

Date math is plain JS (`new Date()`, `setDate()`). For the `applyFilters` branch:

```js
if (dateFilter.start) filtered = filtered.filter(o => new Date(o.created_at) >= dateFilter.start);
if (dateFilter.end)   filtered = filtered.filter(o => new Date(o.created_at) <= dateFilter.end);
```

Filters compose naturally with status/artwork/search/(future selection). Results-count text already adapts to whatever `filteredOrders.length` is, so no extra wiring there.

| Estimate | S |
|---|---|
| Files touched | 1 (`AdminOrders.jsx`) |
| Lines changed | ~40 |
| New deps | none |
| Migration | none |
| RLS | none |
| Risk | none |

---

## §9 Bundle or split?

**Recommend:** TWO PRs.

**PR 1 — "Admin Orders: search fix + row-selection export + date range filter"** (items 1, 2, 4):
- All client-side only.
- No migration, no RLS, no Edge Function changes.
- Combined ~130 LOC, single file.
- Ships independently and immediately useful even if item 3 takes longer to land.

**PR 2 — "Admin Orders: soft-delete with RLS amendment"** (item 3):
- Migration + RLS + 1 admin JSX + 2 Edge Function defensive filters.
- Migration-first deploy gate per CLAUDE.md §52 — needs the same SQL-Editor-before-merge ritual as PR #70.
- Different review surface (DB/RLS reviewer attention) from the UI items in PR 1.

Splitting keeps the easy items unblocked by the heavier one and keeps each review focused on one surface. The two PRs can ship in either order; they don't depend on each other (the search/export/date PR's filters happen to operate on whatever rows the existing fetch returns, which is everything until PR 2 lands).

---

## §10 Things this audit explicitly did not do

- Did not run Playwright against `/admin` (no admin credentials in this session; admin pages reject non-`team_members` users; mock-auth is config-bound off when `VITE_SUPABASE_URL` is set; static analysis was sufficient for §2's diagnosis).
- Did not propose code. §8 is implementation shape only; the actual JSX, SQL, and JS land in the follow-up PRs.
- Did not consider hard-delete as the default for the "mistake removal" use case — §6.1 documents why that would be a net loss.
- Did not audit the Quotes tab, the Customers tab, or the dashboard for the same iteration patterns. Scope is the Orders tab.
- Did not assess whether `team_members.role = 'staff'` should be able to soft-delete, or whether soft-delete should be `super_admin` only. Defaulting to "any admin can soft-delete" follows the existing `Admins manage orders` RLS policy which already grants ALL to anyone where `is_admin(auth.uid())` returns true. If Dave wants role-gating, that's a small policy change in PR 2.
