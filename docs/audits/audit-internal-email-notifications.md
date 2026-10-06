# Audit — Internal Email Notifications (Orders + Artwork)

**Date:** 2026-07-17
**Scope:** Read-only audit. No source files changed, no packages installed, no emails sent, no storage policies touched.
**Goal:** Add two operational alerts — new confirmed order → `orders@promo-gifts.co`, artwork uploaded → `artwork@promo-gifts.co`.

---

## TL;DR — the five things that change the plan

1. **`hello@` is not used by any code send site.** Both existing code-sent emails already send **from `orders@promo-gifts.co`**. `hello@` is only the Supabase *Auth* SMTP sender (Dashboard-configured, not code). The Session 12 handover's claim is true only for auth emails.
2. **The canonical "order confirmed" event is `confirm_payment_atomic` returning an order id** — and it fires from **two** paths (redirect + webhook). Any internal alert must be dual-path and idempotent, exactly like the customer email, or it double-sends.
3. **There is no admin artwork-upload path.** Storage policies grant admins read + delete but **no INSERT**; `AdminOrderDetail.jsx` only downloads. Artwork upload is customer-only. Dave's "customer OR admin" guess needs correcting.
4. **The artwork email trigger is browser fire-and-forget.** If the customer closes the tab, it never fires and nothing records the miss. That is acceptable-ish for a customer courtesy email; it is **not** acceptable for an internal alert Dave depends on.
5. **The requested price breakdown does not exist.** `orders.subtotal`, `tax_amount`, `shipping_cost` are **`0.00` on all 20 live orders** (DEFAULT 0, never written by the RPC). There is no VAT/subtotal/delivery split to print. Only `total_amount` is real.

Also: the admin deep-link is `/admin/orders/<uuid>`, **not** `/admin/orders/ORD-XXXXXX`.

---

## 1. Existing email landscape

Grep for `resend|Resend|RESEND_API_KEY|api.resend.com|sendEmail` returns exactly **two code send sites**. Both use a raw `fetch` to `https://api.resend.com/emails`; **there is no Resend SDK dependency** anywhere.

| # | Send site | Trigger | Recipient | Type |
|---|---|---|---|---|
| 1 | [`supabase/functions/_shared/sendOrderConfirmation.ts`](supabase/functions/_shared/sendOrderConfirmation.ts) | Called after `confirm_payment_atomic` succeeds, from **both** [`confirm-payment/index.ts:107`](supabase/functions/confirm-payment/index.ts#L107) and [`stripe-webhook/index.ts:175`](supabase/functions/stripe-webhook/index.ts#L175) | **Customer** (Stripe session email → fallback `auth.users`) | Transactional, per-order |
| 2 | [`supabase/functions/send-artwork-received-email/index.ts`](supabase/functions/send-artwork-received-email/index.ts) | HTTP POST `{order_id}` — fired **client-side, fire-and-forget** from [`supabaseService.js:2875`](src/services/supabaseService.js#L2875) | **Customer** (`auth.users` via `customer_id`) | Transactional, per-order |

A third channel exists but is **not a code send site**: the 4 Supabase **Auth** templates (confirm-signup, reset-password, magic-link, email-change) are sent by Supabase itself over Resend custom SMTP, configured in the Dashboard (CLAUDE.md §21.4). Those are the only emails that use `hello@promo-gifts.co`.

**No bulk email exists anywhere.** Everything is per-order transactional.

### 1a. The `from` address — verbatim

Both code send sites use the **same** From, and it is **not** `hello@`:

```ts
// supabase/functions/_shared/sendOrderConfirmation.ts:250-257
body: JSON.stringify({
  from: "PGifts <orders@promo-gifts.co>",
  to: [customerEmail],
  reply_to: "orders@promo-gifts.co",
  subject: `Order confirmation — ${orderRow.order_number}`,
  html,
  text,
}),
```

```ts
// supabase/functions/send-artwork-received-email/index.ts:185-192
body: JSON.stringify({
  from: "PGifts <orders@promo-gifts.co>",
  to: [customerEmail],
  reply_to: "artwork@promo-gifts.co",
  subject: `Artwork received — ${order.order_number}`,
  html,
  text,
}),
```

So `artwork@promo-gifts.co` is currently used **only as a `reply_to`**, never as a `from`, and **never as a `to`**. Neither internal address has ever received mail from this system.

### 1b. Subject / body templates

Both bodies are built inline and wrapped by the shared shell [`_shared/emailShell.ts`](supabase/functions/_shared/emailShell.ts) via `renderEmail({ preheader, heading, bodyHtml, bodyText, ctaLabel?, ctaUrl?, footerNote?, supportEmail })` → `{ html, text }`.

Note the shell's contract (emailShell.ts:8-10):

> `bodyHtml` is trusted caller-provided HTML — **NOT sanitised**. Callers must escape any user-supplied data themselves before passing it in.

`sendOrderConfirmation` already carries an `escHtml()` helper (lines 168-173) used for the customer-entered address block. **Any internal email printing customer free-text (name, company, instructions, PO) must escape it the same way.**

| | Order confirmation | Artwork received |
|---|---|---|
| Subject | `Order confirmation — {order_number}` | `Artwork received — {order_number}` |
| Heading | "Thanks for your order" | "Thanks — we've got your artwork" |
| CTA | "Upload artwork" → `/account/orders` | "View order" → `/account/orders` |
| `supportEmail` (footer) | `orders@promo-gifts.co` | `artwork@promo-gifts.co` |

---

## 2. Order lifecycle events — which one means "confirmed and ready to process"

**Canonical event: `confirm_payment_atomic` returning a non-null order id.** That RPC is the *only* writer for Stripe-path orders (CLAUDE.md §17.7) and it sets the status pair in the same transaction that inserts the row:

```sql
-- supabase/migrations/20260417_confirm_payment_atomic.sql:57-71 (INSERT column list)
  INSERT INTO public.orders (
    quote_id,
    customer_id,
    status,
    payment_status,
    artwork_status,
    stripe_session_id,
    payment_intent_id,
    total_amount
  ) VALUES (
    p_quote_id,
    v_customer_id,
    'confirmed',
    ...
```

The RPC was later replaced (same signature) to also copy the delivery fields:

```sql
-- supabase/migrations/20260520_delivery_address_on_quotes.sql:31-51
CREATE OR REPLACE FUNCTION public.confirm_payment_atomic(
  p_quote_id uuid, p_stripe_session_id text,
  p_payment_intent_id text, p_payment_amount numeric
) RETURNS uuid ...
  SELECT customer_id, shipping_address, po_number
    INTO v_customer_id, v_shipping_address, v_po_number
    FROM public.quotes
   WHERE id = p_quote_id
   FOR UPDATE;
```

### Why not the other candidates

- **"Order creation in the database"** — not a distinct event on the Stripe path. Orders are *only* created by the RPC, after Stripe confirms payment (CLAUDE.md §16.3). There are no unpaid abandoned order rows to worry about. Abandoned carts live as `quotes`, not `orders`.
- **"A status transition to `confirmed` + `paid`"** — same instant as creation; there is no separate later transition to hook. Both values are set in the INSERT above.

### The dual-path complication (this is the important bit)

The RPC is invoked from **two independent callers** (CLAUDE.md §44.1), either of which alone is sufficient, and both of which may run concurrently:

```ts
// supabase/functions/confirm-payment/index.ts:101-118  (redirect / foreground)
    try {
      const emailResult = await sendOrderConfirmation(
        supabase,
        orderId,
        stripeSession,
      );
      console.log("[confirm-payment] sendOrderConfirmation result:", emailResult);
    } catch (emailErr) {
      console.error("[confirm-payment] Email step failed (non-fatal):", emailErr);
    }
```

```ts
// supabase/functions/stripe-webhook/index.ts:169-189  (background / server-to-server)
      try {
        const emailResult = await sendOrderConfirmation(
          supabase,
          orderId,
          { customer_email: session.customer_email ?? null },
        );
        console.log(`[stripe-webhook] event ${event.id} sendOrderConfirmation result:`, emailResult);
      } catch (emailErr) {
        console.error(`[stripe-webhook] event ${event.id} email step failed (non-fatal):`, emailErr);
      }
```

**This is exactly where the `orders@` alert hooks** — the same two call sites, immediately after the RPC returns an order id. It inherits the same requirement: **its own idempotency stamp**, because both paths will try to send it.

### Path B — "Convert to Order" (manual/admin)

CLAUDE.md §17.1 documents a second, non-Stripe path: a direct client-side INSERT from the admin "Convert to Order" button, taking no payment. **Recommendation: do NOT fire the `orders@` alert on Path B.** An admin manually converting a quote already knows the order exists; alerting them about their own click is noise. Flag for Dave to confirm.

---

## 3. Artwork upload event

**Single event, customer-only.** The whole flow lives in one client-side function:

```js
// src/services/supabaseService.js:2807-2894  (abridged, key lines)
export async function uploadOrderArtwork(orderId, userId, file, notes = null) {
    const storagePath = `${userId}/${orderId}/${safeName}`;              // :2815

    // 1. Upload file to storage
    const { data: storageData, error: storageError } = await client.storage
      .from('order-artwork')
      .upload(storagePath, file, { upsert: false, contentType: file.type }); // :2820-2822

    // 3. Insert row into order_artwork
    const { data: artworkRow, error: insertError } = await client
      .from('order_artwork')
      .insert({ order_id: orderId, user_id: userId, file_name: file.name,
                file_url: fileUrl, file_type: file.type, file_size: file.size,
                status: 'uploaded', notes })                              // :2831-2844

    // Detect whether this upload causes the first transition
    const { data: priorOrder } = await client
      .from('orders').select('artwork_status').eq('id', orderId).maybeSingle();
    const wasFirstTransition = priorOrder?.artwork_status === 'pending_artwork'; // :2853-2858

    // 4. Update order artwork_status
    const { error: orderError } = await client
      .from('orders')
      .update({ artwork_status: 'artwork_uploaded' })
      .eq('id', orderId);                                                 // :2861-2864

    // Fire-and-forget: artwork-received email on first transition only.
    if (!orderError && wasFirstTransition) {                              // :2871
      try {
        const functionsUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
          || `${supabaseConfig.url}/functions/v1`;
        fetch(`${functionsUrl}/send-artwork-received-email`, {            // :2875
          method: 'POST',
          headers: { 'Content-Type': 'application/json',
                     'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ order_id: orderId }),
        }).catch(err => console.error('[artwork-email] Fire failed:', err));
      } catch (err) { console.error('[artwork-email] Setup failed:', err); }
    }
```

Called from exactly one place: [`ArtworkUploadModal.jsx:139`](src/components/ArtworkUploadModal.jsx#L139), which is mounted only by [`CustomerOrders.jsx:229`](src/pages/account/CustomerOrders.jsx#L229) — the customer's own dashboard. (Note: not the Designer, despite the prompt's guess.)

### "Artwork upload complete" = what, exactly?

Three candidate signals exist; only one is the real gate today:

| Signal | Value | Used as the email gate? |
|---|---|---|
| `order_artwork.status` | `'uploaded' \| 'approved' \| 'rejected' \| 'needs_changes'` (011_artwork_uploads.sql:18-19) | No — always inserted as `'uploaded'`; the review states are never written by any code I can find |
| `orders.artwork_status` | `'pending_artwork' → 'artwork_uploaded' → 'in_review' → 'proof_sent' → 'approved' → 'in_production'` (011_artwork_uploads.sql:31-40) | **Yes** — the `pending_artwork → artwork_uploaded` transition is the gate |
| `wasFirstTransition` | client-side computed | **Yes** — narrows the gate to the *first* upload only |

### There is NO admin upload path — correcting Dave's guess

The prompt's best guess was "artwork uploaded by customer OR by admin, both should notify." **The admin half does not exist:**

- Storage policies grant admins `SELECT` and `DELETE` on `order-artwork` but **no `INSERT`** ([20260420_fix_order_artwork_storage_policies.sql:55-72](supabase/migrations/20260420_fix_order_artwork_storage_policies.sql#L55-L72)). An admin upload would be rejected by RLS.
- [`AdminOrderDetail.jsx:5`](src/pages/admin/AdminOrderDetail.jsx#L5) imports only `getArtworkSignedUrl` and `downloadArtworkFile` — read paths. There is no admin upload UI.

**So the artwork@ notification has exactly one trigger: a customer uploading a file.** If Dave wants an admin-upload path too, that is a separate feature (new storage policy + admin UI), not part of this work.

### Open decision for Dave — first upload only, or every upload?

Today `wasFirstTransition` means **only the first file** notifies. A customer who uploads a logo, then remembers the artwork for the back print and uploads a second file an hour later, produces **no second notification**. For a customer courtesy email that is correct (don't nag). For an **internal** alert it is arguably wrong — the artwork team needs to know a new file landed. See §10 for the recommendation.

---

## 4. Artwork file storage

| Property | Value | Source |
|---|---|---|
| Bucket | `order-artwork` | supabaseService.js:2821 |
| Public? | **No — private** (`public: false`) | live probe of `storage.buckets` |
| Size limit | 52428800 bytes (50 MB) | live probe |
| Path convention | `{userId}/{orderId}/{filename}` where filename = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}` | supabaseService.js:2814-2815 |
| DB row | `order_artwork` (`order_id`, `user_id`, `file_name`, `file_url`, `file_type`, `file_size`, `status`, `notes`, `uploaded_at`, `reviewed_at`) | 011_artwork_uploads.sql:10-24 |
| `file_url` contents | the **bare storage path**, not a URL (legacy rows may hold a full URL with a `/order-artwork/` marker) | supabaseService.js:2826-2828, 2992-2995 |

### Access control (verbatim)

```sql
-- supabase/migrations/20260420_fix_order_artwork_storage_policies.sql:26-72
-- 3. order-artwork: customer policies (user-folder-scoped).
--    Path pattern: {userId}/{orderId}/{filename}  →  foldername[1] = userId
CREATE POLICY "Customers can upload own artwork files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK ( bucket_id = 'order-artwork'
    AND (storage.foldername(name))[1] = auth.uid()::text );

CREATE POLICY "Customers can read own artwork files"   ... (same USING clause)
CREATE POLICY "Customers can delete own artwork files" ... (same USING clause)

-- 4. order-artwork: admin policies (read + delete all).
CREATE POLICY "Admins can read all artwork files"
  ON storage.objects FOR SELECT TO authenticated
  USING ( bucket_id = 'order-artwork' AND public.is_admin(auth.uid()) );

CREATE POLICY "Admins can delete any artwork file"
  ON storage.objects FOR DELETE TO authenticated
  USING ( bucket_id = 'order-artwork' AND public.is_admin(auth.uid()) );
```

### How the admin UI gets access today

Signed URLs, minted **client-side with the admin's own JWT** (their `is_admin` policy authorises the read):

```js
// src/services/supabaseService.js:2987-3007
export async function getArtworkSignedUrl(filePathOrUrl, expiresIn = 3600) {
    const marker = '/order-artwork/';
    const storagePath = filePathOrUrl.includes(marker)
      ? filePathOrUrl.split(marker)[1]
      : filePathOrUrl;                       // handles legacy full-URL rows

    const { data, error } = await client.storage
      .from('order-artwork')
      .createSignedUrl(storagePath, expiresIn);
```

Used at [`AdminOrderDetail.jsx:83`](src/pages/admin/AdminOrderDetail.jsx#L83) with `3600` (1 hour), and `downloadArtworkFile` (supabaseService.js:3014) for the save-to-disk path.

### Can the email reuse this? — Partly

**No, not this function.** `getArtworkSignedUrl` is browser-side and depends on the caller's JWT. The email is composed in a Deno Edge Function that has **no user session**.

**But the mechanism reuses cleanly.** The Edge Function already builds a service-role client (`send-artwork-received-email/index.ts:39-41`), and service-role **bypasses RLS**, so it can call `createSignedUrl(path, 604800)` on any object without a policy grant. The email needs:

1. `SELECT file_url, file_name FROM order_artwork WHERE order_id = ?` (new query — the function doesn't fetch artwork rows today, only `order_items`).
2. `supabase.storage.from('order-artwork').createSignedUrl(path, 604800)` per file, applying the same legacy `/order-artwork/` marker split as the JS helper.

7-day expiry = **604800 seconds**. Supabase signed URLs accept this; the ceiling is well beyond a week.

⚠️ **Security note:** a 7-day signed URL is a bearer token in an inbox. Anyone with the email (or a forwarded copy) can fetch the file for 7 days with no auth. For internal-only artwork that is an acceptable trade against the alternative (staff having to log in to grab a file), but it should be a conscious decision. Shorter (24-48h) plus the admin deep-link as the durable path is the safer default — recommendation in §10.

---

## 5. Resend configuration

- **No SDK.** No `resend` package in `package.json`; both send sites use raw `fetch("https://api.resend.com/emails")` with `Authorization: Bearer ${resendApiKey}`.
- **Key source:** `Deno.env.get("RESEND_API_KEY")` (sendOrderConfirmation.ts:51, send-artwork-received-email/index.ts:100). A Supabase Edge Function secret — **not** in `.env` (I confirmed `.env` has no `RESEND_API_KEY`; it holds `ANTHROPIC_API_KEY`, `CRON_SECRET`, `LALTEX_API_KEY`, `OPENAI_API_KEY`, `STRIPE_*`, `SUPABASE_*`, `VISITOR_HASH_SALT`, `VITE_*`).
- **Verified domain:** `promo-gifts.co`, SPF/DKIM/DMARC verified under Resend (CLAUDE.md §21.4). Because the **domain** is verified, any `*@promo-gifts.co` address can be used as a `from` without extra Resend setup.

### ⚠️ Question for Dave — the receiving mailboxes

I cannot check Namecheap from code. What the codebase tells me:

- `orders@promo-gifts.co` — used as `from` + `reply_to` today. Replies from customers already land there, so it is **almost certainly a real mailbox**.
- `artwork@promo-gifts.co` — used **only as `reply_to`** (send-artwork-received-email:188), and the customer email tells customers proofs will arrive "from **artwork@promo-gifts.co**" (line 132). So it is *expected* to be real, but nothing in the codebase proves it can **receive**.

**Neither address has ever been a `to:` recipient.** Before shipping, Dave should confirm both are provisioned as receiving mailboxes at Namecheap Private Email — a `to:` that bounces would fail silently from our side (Resend accepts the send; the bounce happens downstream).

### Current failure handling — per send site

**`sendOrderConfirmation.ts`** — structured, no retry:

```ts
// :260-270
  if (!resendRes.ok) {
    const detail = await resendRes.text();
    console.error("[send-order-confirmation] Resend send failed:", resendRes.status, detail);
    // Deliberately do NOT stamp confirmation_email_sent_at — a future call
    // (manual retry, webhook redelivery, etc.) should be free to retry.
    return { sent: false, reason: "resend_error" };
  }
```

- Never throws; returns `{sent, reason}` (`no_api_key | order_not_found | no_customer_email | already_sent | stamped_by_other_path | resend_error`).
- **No retry.** Recovery relies on the *other* path (webhook vs redirect) trying again — a genuine free retry, since a failed send leaves the stamp NULL.
- Both callers log the result and swallow (`confirm-payment:112-118`, `stripe-webhook:180-189`). Errors **never** surface to the user, and correctly so — the order is already paid and committed.

**`send-artwork-received-email`** — same shape but weaker:

```ts
// :195-207
      if (!resendRes.ok) {
        const detail = await resendRes.text();
        console.error("[send-artwork-received-email] Resend failed:", resendRes.status, detail);
        return jsonOk({ success: true, sent: false, reason: "resend_failed" });
      }
    } catch (sendErr) {
      console.error("[send-artwork-received-email] Resend threw:", sendErr);
      return jsonOk({ success: true, sent: false, reason: "resend_failed" });
    }
```

- **Every** return is HTTP 200 (`jsonOk`), by design ("never fail the caller").
- No retry, and **no second path**. Unlike the order email, if this misses, nothing else tries. Combined with the browser fire-and-forget trigger (§3), a closed tab = permanent silent miss.

**Where errors land:** `console.error` only → Supabase Edge Function logs. No Sentry, no error table, no alerting. Searching for a miss today means knowing to look.

---

## 6. Content design

### 6a. What data is actually available (verified against the live schema)

`orders` columns (live probe): `id, order_number, quote_id, customer_id, status, payment_status, payment_intent_id, subtotal, shipping_cost, tax_amount, total_amount, po_number, shipping_address, billing_address, estimated_delivery, tracking_number, admin_notes, customer_notes, created_at, updated_at, artwork_status, stripe_session_id, artwork_received_email_sent_at, confirmation_email_sent_at, deleted_at`

`order_items`: `id, order_id, product_id, product_name, quantity, unit_price, line_total, color, design_data, design_thumbnail, print_areas, notes, created_at`

**Gaps that change the requested content — all verified live:**

| Requested field | Reality | Evidence |
|---|---|---|
| Price breakdown: subtotal / print costs / delivery / VAT | ❌ **Not available.** `subtotal`, `tax_amount`, `shipping_cost` are `DEFAULT 0` and the RPC never writes them. All 20 live orders hold `0.00` for all three. **VAT is not modelled anywhere.** | `SELECT DISTINCT subtotal, tax_amount, shipping_cost FROM orders` → single row `0.00 / 0.00 / 0.00`; column_default = `0` |
| Customer name | ⚠️ Not on `orders`. Lives in `customer_profiles` (`contact_name`, `first_name`, `last_name`) — but only **6 profiles for 8 users**, so it can be missing. Fallbacks: `shipping_address.fao`, then the email address. | live probe |
| Company | `customer_profiles.company_name` or `shipping_address.company` | AdminOrderDetail.jsx:107-111 |
| Phone | `customer_profiles.phone` or `shipping_address.phone` | sendOrderConfirmation.ts:181 |
| Delivery address | `orders.shipping_address` jsonb (`company, fao, line1, line2, city, postcode, country, phone, instructions`) — but only **2 of 20** orders have one (recent feature). Needs a real "not supplied" branch. | sendOrderConfirmation.ts:175-187; live probe `has_addr: 2` |
| Customer notes / rush | `orders.customer_notes` exists but is **never populated (0 of 20)**. Real signals are `po_number` (2 of 20, e.g. `"PO1001"`, `"Test 9999"`) and `shipping_address.instructions`. | live probe |
| Print positions + dimensions | ✅ `order_items.print_areas` jsonb `{selections:[{position, area, type, class, num_colours, unit_price}]}` (CLAUDE.md §43.5). Legacy rows may hold a plain string. | sendOrderConfirmation.ts:120-137 |
| Stripe reconciliation | ✅ `payment_intent_id` + `stripe_session_id` | schema |
| Admin link | ✅ but **`/admin/orders/<uuid>`**, not `ORD-XXXXXX` | App.jsx:140; AdminOrderDetail.jsx:55,100 |

The admin route takes the **UUID**:

```jsx
// src/App.jsx:140
<Route path="/admin/orders/:id" element={<AdminGuard><AdminOrderDetail /></AdminGuard>} />
```
```jsx
// src/pages/admin/AdminOrderDetail.jsx:55, 97-101
  const { id } = useParams();
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', id)          // ← UUID, not order_number
        .single();
```

### 6b. Draft — `orders@` notification

**Subject:** `New order ORD-20260714-0024 — Acme Ltd (Jane Smith) — £243.75`
(Name resolution order: `customer_profiles.contact_name` → `first_name last_name` → `shipping_address.fao` → email local-part → `"Unknown"`. Company prefix only when known.)

**Body — everything needed to act without opening a tab:**

1. **Order** — order number, placed-at (UK local time, not raw UTC), `status` / `payment_status`.
2. **Customer** — name, email (as a `mailto:`), company, phone. Show explicit `not supplied` for missing values rather than blank rows.
3. **Delivery** — the full `shipping_address` block reusing the existing renderer shape; when absent print a loud **"No delivery address supplied — FAO required"**, since that's 18 of 20 historical orders.
4. **Line items** — per item: product name, colour, qty, unit price, line total, and one sub-line per print selection (`position — type, area, N colours`). This replaces the impossible cost breakdown with the per-position detail that actually exists.
5. **Total** — `total_amount` only, labelled **"Total paid (inc. delivery, setup and print)"**. Explicitly **no** subtotal/VAT/delivery lines: those columns are all zero, and printing `VAT: £0.00` on a real order would be actively misleading to whoever is processing it.
6. **Payment reconciliation** — `payment_intent_id`, `stripe_session_id`.
7. **Customer instructions** — `po_number` and `shipping_address.instructions` when present.
8. **CTA** — `https://promo-gifts-co.uk/admin/orders/<uuid>`.

### 6c. Draft — `artwork@` notification

**Subject:** `Artwork uploaded — ORD-20260714-0024 — Acme Ltd (Jane Smith)`

1. **Order + customer** — order number, name, company. Deep-link to admin.
2. **Products** — product name + colour per line, plus **print positions with dimensions** from `print_areas.selections` (`position`, `area`, `type`, `num_colours`) so the team can assess feasibility immediately, as requested.
3. **Files** — for each `order_artwork` row: `file_name`, `file_type`, human-readable `file_size`, `uploaded_at`, customer `notes`, and a **signed download link**.
4. **Context flag** — whether this is the first upload for the order or an addition to existing files (see the §3 open decision).
5. **CTA** — `https://promo-gifts-co.uk/admin/orders/<uuid>` — the durable path once the signed link expires.

---

## 7. Reply-To decision

**Agree with both of the prompt's recommendations**, with one addition.

| Email | Recommendation | Rationale |
|---|---|---|
| `orders@` | **`reply_to: <customer email>`** | Staff routinely need to chase a missing address, a PO, or a rush date. 18 of 20 orders have **no delivery address** — "hit Reply and ask" is the single most likely next action on this alert. |
| `artwork@` | **Omit `reply_to`** | Internal coordination only. A stray reply should not land in a customer's inbox mid-proofing; the proof itself is sent separately from `artwork@` (per the customer email's own promise, send-artwork-received-email:132). |

**Addition:** for `artwork@`, omitting `reply_to` means Resend falls back to the `from` address. Set `from: "PGifts Orders <orders@promo-gifts.co>"` (the verified sender already in use) so a reflexive Reply lands in an internal mailbox, not nowhere. Explicitly **do not** set `reply_to` to the customer here.

---

## 8. Soft-delete interaction

**Soft-delete is already live**, not pending — [`20260629_orders_soft_delete.sql`](supabase/migrations/20260629_orders_soft_delete.sql) is merged, `orders.deleted_at` exists (live probe confirms the column and **1 soft-deleted row** of 20), and *both* email functions already carry defensive filters.

The prompt's analysis is right on both counts, with one refinement:

**`orders@` — essentially no interaction, but inherit the filter anyway.** The alert fires at confirmation, before any soft-delete could realistically apply. But there *is* a narrow window: an admin could soft-delete between `confirm_payment_atomic` committing and the alert rendering. The existing customer helper already guards it and explains why the RLS amendment alone is insufficient:

```ts
// supabase/functions/_shared/sendOrderConfirmation.ts:59-76
  // Defensive filter on deleted_at IS NULL (audit-admin-orders-iteration.md
  // §6.3, §8.3): if an admin soft-deletes an order in the window between
  // confirm_payment_atomic committing and this email helper running, the
  // customer should not receive a confirmation for an order that no longer
  // exists in their view. Service-role bypasses RLS so the RLS amendment
  // alone is not sufficient — this filter is the second layer.
  const { data: orderRow, error: orderFetchError } = await supabase
    .from("orders")
    .select("id, order_number, total_amount, customer_id, confirmation_email_sent_at, shipping_address, po_number, deleted_at")
    .eq("id", orderId)
    .is("deleted_at", null)
    .single();
```

**Nuance worth Dave's call:** for the *internal* alert the argument is weaker than for the customer email. If an order is paid and then instantly soft-deleted, Dave arguably still *wants* to know it happened. My recommendation is to **filter anyway** (consistency, and a soft-deleted order genuinely needs no processing), but this is a deliberate choice, not an obvious one.

**`artwork@` — MUST filter.** Confirmed. Without it, uploading artwork against a soft-deleted order spams `artwork@` about a deleted order. The guard already exists and the new send just needs to sit **inside** it:

```ts
// supabase/functions/send-artwork-received-email/index.ts:51-67
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, order_number, customer_id, total_amount, artwork_received_email_sent_at, artwork_status, deleted_at")
      .eq("id", orderId)
      .is("deleted_at", null)
      .maybeSingle();
    ...
    if (!order) {
      console.warn("[send-artwork-received-email] order not found (may be soft-deleted):", orderId);
      return jsonOk({ success: true, sent: false, reason: "order_not_found" });
    }
```

**Where the check goes:** nowhere new. Both internal sends should be placed **after** the existing `deleted_at IS NULL` fetch in their respective functions and reuse that already-fetched row. Adding a second lookup would be a second chance to get it wrong.

---

## 9. Failure handling

The prompt's framing is correct and the current state is worse than it implies for artwork specifically:

| Failure mode | Order alert | Artwork alert |
|---|---|---|
| Resend 4xx/5xx | Recoverable — the *other* path (webhook/redirect) retries for free | **Unrecoverable** — single path, no retry |
| Trigger never fires | Can't happen — webhook is server-to-server, Stripe retries ~3 days | **Very possible** — browser fire-and-forget; closed tab = silent permanent miss |
| Visibility of a miss | `console.error` in Edge logs only | `console.error` only |

### Recommendation — lightest reliable pattern

**1. Idempotency stamps double as the miss-detector.** Add one nullable timestamp per alert (`orders.internal_order_alert_sent_at`, `orders.internal_artwork_alert_sent_at`), stamped **only on Resend 2xx**, using the same CAS pattern already proven at sendOrderConfirmation.ts:276-296. This buys three things at once: idempotency across the dual path, free retry on a later invocation, and — critically — **a queryable record of every miss**:

```sql
-- The "did we miss anything?" query. Should always return zero rows.
SELECT order_number, created_at, total_amount
  FROM orders
 WHERE payment_status = 'paid'
   AND deleted_at IS NULL
   AND internal_order_alert_sent_at IS NULL
 ORDER BY created_at DESC;
```

This is the fallback the prompt asks for, at the cost of one column. It does not silently drop anything: a failure is a NULL, and a NULL is findable.

**2. Retry: one immediate in-function retry.** On a non-2xx or a throw, wait ~500ms and try once more, then give up and log. Two attempts covers the overwhelmingly common case (a transient Resend blip) without adding a queue. Volumes are pre-launch-low; anything heavier is over-engineering.

**3. Logging: `console.error` with a greppable prefix** (`[internal-order-alert]` / `[internal-artwork-alert]`) → Supabase Edge Function logs. No Sentry is configured; introducing one is out of scope.

**4. Also carry `Idempotency-Key`** (`order-<uuid>-internal-alert`) on the Resend POST, mirroring sendOrderConfirmation.ts:248. It is the belt-and-braces for the dual-path race where both callers pass the SELECT before either lands the UPDATE.

**5. The real reliability fix for artwork is the trigger, not the retry.** No amount of in-function retry helps if the browser never fires the request. Options, cheapest first:
- **(a) Accept it for now** — ship the alert inside the existing function; a missed upload is findable via the query above (`artwork_status = 'artwork_uploaded' AND internal_artwork_alert_sent_at IS NULL`).
- **(b) Move the trigger server-side** — a Postgres trigger on `order_artwork` INSERT calling the function via `pg_net`, or a small server route. Removes the browser dependency entirely.

**Recommendation: (a) now, (b) as a follow-up.** (b) is the correct end state but it is a separate change with its own risk, and the NULL-detector makes (a) safe to run in the meantime. This is worth being explicit with Dave about: **shipping (a) alone means the artwork alert is only as reliable as the customer's browser staying open for one more HTTP request.**

---

## 10. Recommended implementation shape

### A. `orders@` — new confirmed order

| | |
|---|---|
| **Trigger location** | Both existing call sites, immediately after `confirm_payment_atomic` returns an order id: [`confirm-payment/index.ts:107-118`](supabase/functions/confirm-payment/index.ts#L107) and [`stripe-webhook/index.ts:174-189`](supabase/functions/stripe-webhook/index.ts#L174). **Not** Path B (Convert to Order). |
| **Shape** | New sibling helper `supabase/functions/_shared/sendInternalOrderAlert.ts`, mirroring `sendOrderConfirmation`'s contract: never throws, returns `{sent, reason}`, own `deleted_at IS NULL` fetch, own CAS stamp. |
| **Why a separate helper, not an extra send inside `sendOrderConfirmation`** | That helper early-returns on `already_sent` / `no_customer_email` (lines 88-90, 102-108). Piggybacking would make the internal alert inherit the customer email's gates — a customer with no email address would silently suppress Dave's alert. Different recipient, different idempotency key, different failure semantics ⇒ different function. |
| **Send mechanism** | Raw `fetch` to Resend (no SDK), `from: "PGifts Orders <orders@promo-gifts.co>"`, `to: ["orders@promo-gifts.co"]`, `reply_to: <customer email>`, `Idempotency-Key: order-<uuid>-internal-alert`. |
| **Failure handling** | §9: one retry, stamp only on 2xx, `[internal-order-alert]` logs, NULL = findable miss. |
| **Migration** | `orders.internal_order_alert_sent_at timestamptz` (+ optional partial index for the miss query). Migration-first per §52. |
| **Test approach** | Stripe test card `4242 4242 4242 4242` through the real Pay Now flow (CLAUDE.md §16.9) against a throwaway quote → exercises both paths end-to-end. For content iteration without a real order, invoke the deployed function with a known `order_id` of an existing test order and a `dry_run` flag that returns the rendered HTML instead of POSTing to Resend. |
| **Complexity** | **M** — new helper + migration + two call sites + name-resolution fallbacks + escaping. |

### B. `artwork@` — artwork uploaded

| | |
|---|---|
| **Trigger location** | Inside [`send-artwork-received-email/index.ts`](supabase/functions/send-artwork-received-email/index.ts), after the existing `deleted_at IS NULL` fetch (lines 51-67), reusing that row. Send the internal alert **independently of** the customer send's outcome. |
| **Important** | Do **not** gate the internal alert on the customer email's `artwork_received_email_sent_at` (line 70) or its `pending_artwork` status guard (line 75). Those are customer-courtesy gates; the artwork team should be told a file landed regardless. Use a separate stamp. |
| **Signed URLs** | Service-role `createSignedUrl(path, N)` inside the function (bypasses RLS — no policy change needed). Apply the same legacy `/order-artwork/` marker split as supabaseService.js:2992-2995. **Recommend 48h, not 7 days** — the admin deep-link is the durable path, and a 7-day bearer token in a forwardable inbox is a wider window than the convenience warrants. Dave's call; 7 days is defensible if staff work from the inbox. |
| **New query** | `SELECT file_name, file_url, file_type, file_size, notes, uploaded_at FROM order_artwork WHERE order_id = ?` — the function doesn't fetch these today. |
| **Send mechanism** | `from: "PGifts Orders <orders@promo-gifts.co>"`, `to: ["artwork@promo-gifts.co"]`, **no `reply_to`**, `Idempotency-Key: order-<uuid>-artwork-<artworkRowId>` (per-upload, so a second file legitimately re-alerts). |
| **First-upload-only vs every-upload** | **Recommend every upload.** Change the client gate at supabaseService.js:2871 from `wasFirstTransition` to always-fire, and let the two functions' own stamps decide: customer email keeps its `already_sent` gate (so the customer is not nagged), internal alert keys per artwork row (so the team hears about file #2). This is a behaviour change to a shipped path — flag explicitly for Dave. |
| **Migration** | `orders.internal_artwork_alert_sent_at timestamptz`, **or** `order_artwork.internal_alert_sent_at` if per-upload alerting is chosen (the better fit for "every upload"). |
| **Test approach** | Upload a file against a test order from the customer dashboard; or POST `{order_id}` directly to the deployed function with a `dry_run` flag. |
| **Complexity** | **M** (**L** if the server-side trigger move from §9(b) is included). |

### C. One PR or two?

**Two PRs, sequenced.** They share only a little (a recipients constant, the retry/stamp pattern), and they differ in every way that matters: different trigger mechanisms, different files, different migrations, different reliability profiles, and different open decisions for Dave (Path B; per-upload alerting; signed-URL TTL).

- **PR 1 — `orders@`.** Lands first and establishes the shared pattern (helper shape, retry, CAS stamp, miss query). Lower risk, fully server-side, immediately useful.
- **PR 2 — `artwork@`.** Reuses PR 1's pattern; carries the signed-URL logic and the `wasFirstTransition` behaviour change.
- **PR 3 (optional follow-up) — move the artwork trigger server-side** (§9 item 5b).

Bundling them would put a settled, low-risk change (orders) behind an unsettled one (artwork trigger reliability + per-upload semantics).

### D. Decisions needed from Dave before implementation

1. Are `orders@` and `artwork@` provisioned as **receiving** mailboxes at Namecheap? (§5)
2. Confirm: **no admin artwork-upload path exists** — is that acceptable, or is it wanted? (§3)
3. Artwork alert on **every upload** or first only? (§10B)
4. Signed-URL TTL: **48h** (recommended) or 7 days? (§4, §10B)
5. Fire the orders alert on **Path B / Convert to Order** too? (recommend no) (§2)
6. Confirm the **no VAT/subtotal breakdown** limitation is acceptable, or whether populating `subtotal`/`tax_amount` is a prerequisite. (§6a)
7. Soft-deleted orders: suppress the internal alert (recommended) or still notify? (§8)

---

## Appendix — files referenced

| File | Lines | Role |
|---|---|---|
| [`supabase/functions/_shared/sendOrderConfirmation.ts`](supabase/functions/_shared/sendOrderConfirmation.ts) | 51, 59-76, 88-90, 120-137, 168-187, 239-258, 260-270, 276-305 | Customer order email; the pattern to mirror |
| [`supabase/functions/confirm-payment/index.ts`](supabase/functions/confirm-payment/index.ts) | 101-118 | Redirect-path call site (orders@ hook) |
| [`supabase/functions/stripe-webhook/index.ts`](supabase/functions/stripe-webhook/index.ts) | 151-191 | Webhook-path call site (orders@ hook) |
| [`supabase/functions/send-artwork-received-email/index.ts`](supabase/functions/send-artwork-received-email/index.ts) | 26-81, 100-104, 179-207, 211-220 | Artwork email fn (artwork@ hook) |
| [`supabase/functions/_shared/emailShell.ts`](supabase/functions/_shared/emailShell.ts) | 8-10, 12-36 | `renderEmail`; no-sanitisation contract |
| [`src/services/supabaseService.js`](src/services/supabaseService.js) | 2807-2894, 2987-3007, 3014 | Upload, fire-and-forget trigger, signed URL |
| [`src/components/ArtworkUploadModal.jsx`](src/components/ArtworkUploadModal.jsx) | 139 | Only caller of `uploadOrderArtwork` |
| [`src/pages/admin/AdminOrderDetail.jsx`](src/pages/admin/AdminOrderDetail.jsx) | 55, 83, 97-101, 235 | Admin read/download; UUID route param |
| [`src/App.jsx`](src/App.jsx) | 140 | `/admin/orders/:id` |
| [`database/migrations/011_artwork_uploads.sql`](database/migrations/011_artwork_uploads.sql) | 10-40 | `order_artwork` + `artwork_status` enum |
| [`supabase/migrations/20260420_fix_order_artwork_storage_policies.sql`](supabase/migrations/20260420_fix_order_artwork_storage_policies.sql) | 26-72 | Bucket policies (no admin INSERT) |
| [`supabase/migrations/20260417_confirm_payment_atomic.sql`](supabase/migrations/20260417_confirm_payment_atomic.sql) | 57-71 | Original RPC INSERT |
| [`supabase/migrations/20260520_delivery_address_on_quotes.sql`](supabase/migrations/20260520_delivery_address_on_quotes.sql) | 31-51 | Current RPC (adds address/PO) |
| [`supabase/migrations/20260629_orders_soft_delete.sql`](supabase/migrations/20260629_orders_soft_delete.sql) | all | `deleted_at` + RLS amendment (live) |
