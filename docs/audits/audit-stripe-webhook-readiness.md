# Audit — Stripe Webhook Readiness (pre-live-keys)

**Date:** 2026-08-06
**Scope:** Read-only. No source changed, no Stripe config touched, no keys swapped, no PR. Both Edge Functions, the shared email/alert helpers, and the LIVE `confirm_payment_atomic` definition were read; the live DB was probed (read-only) for schema, the idempotency index, and a spot-check of real paid orders. Stripe dashboard state (endpoints, subscribed events, live-mode secrets) **cannot be inspected from code** — those items are marked "Dave must confirm in Stripe."

---

## Verdict

**The webhook CODE is safe and genuinely equivalent to the redirect path. No code change blocks the live-key swap.** Order content is built 100% by the shared `confirm_payment_atomic` RPC from identical inputs, so a webhook-only order is byte-for-byte what a redirect order would be; idempotency holds at all three layers (order, customer email, internal alert); failure handling makes Stripe retry rather than swallow.

**But it is NOT yet safe to *rely on* for real money, for two configuration/testing reasons, neither of which is a code fix:**

1. **It has never been exercised end-to-end** (the prompt's premise, confirmed: every real paid order in the DB was created by the redirect path). Correct-by-inspection is not the same as proven-reachable-and-verifying. Dave must run the test-mode sequence in §7, including the tab-closed case, before trusting it.
2. **Live mode needs its OWN endpoint and signing secret.** Stripe test and live are separate. If the keys are swapped without creating the live webhook endpoint and setting its signing secret as `STRIPE_WEBHOOK_SECRET`, **every live webhook fails** — the backstop is dead exactly when real money is on the line, and silently (the customer's redirect still works, so it looks fine until someone closes a tab). This is the #1 launch risk and it is a manual Stripe-dashboard step, not a Vercel one.

**Blocking the swap:** items 1 and 2 above (test it; configure the live endpoint + secret). **Not blocking:** nothing in the code.

---

## 1. The two paths, side by side

Both are thin wrappers around the same RPC + the same two email helpers. Neither writes to `orders`/`order_items` outside the RPC.

| | `confirm-payment` (redirect / browser) | `stripe-webhook` (server-to-server) |
|---|---|---|
| **Trigger** | Browser POSTs `{session_id}` on return to `/order-confirmation` | Stripe POSTs `checkout.session.completed` |
| **Auth / trust boundary** | Re-fetches the session from Stripe API with `STRIPE_SECRET_KEY`; trusts that response | **Signature verification** (`constructEventAsync`) over the raw body |
| **Session source** | `GET /v1/checkout/sessions/{id}` (fresh fetch) | `event.data.object` (the event payload) |
| **Guard: paid?** | `payment_status !== 'paid'` → **400** | `payment_status !== 'paid'` → **200 skip** |
| **Guard: quote_id?** | missing → **400** | missing → **200 skip** (`no_quote_id`) |
| **RPC params** | `p_quote_id`=`metadata.quote_id`, `p_stripe_session_id`=`session_id` (request body), `p_payment_intent_id`, `p_payment_amount`=`amount_total/100` | **identical**: `p_quote_id`=`metadata.quote_id`, `p_stripe_session_id`=`session.id`, `p_payment_intent_id`, `p_payment_amount`=`amount_total/100` |
| **Order building** | none outside the RPC | none outside the RPC |
| **Customer email** | `sendOrderConfirmation(supabase, orderId, stripeSession)` | `sendOrderConfirmation(supabase, orderId, {customer_email})` |
| **Internal alert** | `sendInternalOrderAlert(supabase, orderId, stripeSession)` | `sendInternalOrderAlert(supabase, orderId, {customer_email})` |
| **Delivery address** | copied by the RPC from `quotes.shipping_address` | **same** — copied by the RPC |
| **On RPC error** | **500** to the browser (no retry mechanism; browser one-shot) | **500** → **Stripe retries** (~3 days backoff) |
| **On email failure** | swallowed, still **200** | swallowed, still **200** |
| **On bad input / unhandled** | 400 | 200 (so Stripe stops retrying a non-order event) |

**Asymmetries found, and whether they matter:**

- **Email `session` argument shape** (full session vs `{customer_email}`) — **not a real asymmetry.** Both helpers read *only* `session.customer_email` and otherwise fall back to `auth.users` email via `customer_id`. `create-checkout-session` sets `customer_email` on the session, so both paths have it; if it were ever null, both resolve identically via the customer id. Same recipient either way.
- **Paid-guard status codes** (400 vs 200) — **correct and intentional.** The webhook must 200-ack a non-order event so Stripe stops retrying; the redirect 400s to tell the browser. Neither creates an order for an unpaid session.
- **Failure retry** (browser 500 dead-ends vs webhook 500 → Stripe retries) — **this is the whole point of the webhook** and is correct. The redirect is best-effort; the webhook is the reliable retrier.

There is **no asymmetry that changes the order that gets created.**

---

## 2. Does the webhook produce a complete order?

**Yes — identical to the redirect, because the order is entirely the RPC's output and both paths feed the RPC the same four parameters.** The live `confirm_payment_atomic` (verified from `pg_get_functiondef`) does all of this in one transaction:

| Requested field | Source in the RPC | Status |
|---|---|---|
| `subtotal` | `orders.subtotal = COALESCE(quotes.subtotal, 0)` | ✅ |
| `tax_amount` | `orders.tax_amount = COALESCE(quotes.tax_amount, 0)` | ✅ |
| `total_amount` | `orders.total_amount = p_payment_amount` (Stripe `amount_total/100` = money actually charged) | ✅ |
| `order_items.taxable_net_unit` | copied from `quote_items.taxable_net_unit` | ✅ |
| `order_items.line_vat` | **GENERATED column** — `round(round(quantity * COALESCE(taxable_net_unit, unit_price), 2) * 0.20, 2)`. Auto-computes from the copied fields; the RPC correctly does **not** (and must not) write it. | ✅ (by generation) |
| `size_breakdown` (clothing) | copied from `quote_items.size_breakdown` | ✅ |
| `print_areas` / position data | copied from `quote_items.print_areas` | ✅ |
| `quote_id` | `orders.quote_id = p_quote_id` | ✅ |
| `stripe_session_id` | `orders.stripe_session_id = p_stripe_session_id` | ✅ |
| Delivery address | `orders.shipping_address = quotes.shipping_address` (+ `po_number`) | ✅ |
| `payment_status` | hard-set `'paid'` (also `status='confirmed'`, `artwork_status='pending_artwork'`) | ✅ |

Spot-check of the three most recent paid orders (all redirect-path today): `subtotal`/`tax_amount`/`total_amount` populated (e.g. 297.00 / 59.40 / 356.40), `stripe_session_id` and `quote_id` set, items present, `line_vat` generated. A webhook order runs the *same* RPC on the *same* quote, so it is identically complete.

**Important nuance (affects both paths equally, not a webhook defect):** everything the order carries is copied from the **quote/quote_items at payment time**. If a quote were ever missing `subtotal`/`tax_amount`/`taxable_net_unit`/`size_breakdown`, the order would inherit those gaps — on *either* path. That is a quote-completeness concern, not a webhook-vs-redirect asymmetry, and today's live orders show the quotes are populated.

---

## 3. Idempotency across both paths

Three independent layers, each keyed on the deterministic order (which is keyed on the session id):

**(a) The order — anchor: `orders.stripe_session_id`.** Inside the RPC:
1. `SELECT ... FROM quotes WHERE id = p_quote_id FOR UPDATE` — locks the quote row first, serialising concurrent invocations.
2. `SELECT id FROM orders WHERE stripe_session_id = p_stripe_session_id` — returns the existing order id if present (idempotent short-circuit).
3. Otherwise insert.
Plus a **DB-level guarantee**: `orders_stripe_session_id_uniq` (confirmed live) — `UNIQUE (stripe_session_id) WHERE stripe_session_id IS NOT NULL`. So even if the `FOR UPDATE` serialisation were ever bypassed, a second concurrent insert fails on the unique index; one order wins. **Redirect + webhook concurrent, or Stripe replaying the event, all resolve to the same single order.** Genuinely atomic.

**(b) Customer confirmation email — anchor: `orders.confirmation_email_sent_at`.** `sendOrderConfirmation`: an early gate (`if confirmation_email_sent_at → already_sent`), then after a successful Resend send a **compare-and-swap** `UPDATE ... WHERE id = orderId AND confirmation_email_sent_at IS NULL RETURNING id` (zero rows = the other path won). It stamps **only on Resend 2xx** (a failed send stays retryable). The narrow window where both paths pass the early SELECT is closed by a shared Resend **`Idempotency-Key: order-<orderId>-confirmation`**, so Resend itself dedups the delivery. **At most one email.**

**(c) Internal orders@ alert — anchor: `orders.internal_alert_sent_at`.** `sendInternalOrderAlert`: an atomic CAS claim (`UPDATE ... WHERE id = orderId AND internal_alert_sent_at IS NULL RETURNING id`) before sending; on send failure it **resets the claim to NULL** (retryable); shared Resend `Idempotency-Key: internal-alert-<orderId>`. Both paths call it with the same `orderId`. **At most one alert.**

All three anchors are on the single order row, which is itself idempotent by (a), so replays and cross-path races collapse to one order, one customer email, one internal alert.

---

## 4. Failure and retry behaviour

- **Webhook before redirect / redirect before webhook / both at once** — all safe (see §3): whichever runs first creates the order and sends the emails; the later one's RPC returns the existing order id and the email helpers see the stamps and skip. The tab-closed case (no redirect at all) is exactly what the webhook covers: it creates the order and sends both emails server-side.
- **RPC failure** — the webhook returns **500**, which makes **Stripe retry** with exponential backoff (~3 days). It does **not** swallow the error. (For a permanent bad-data failure Stripe eventually gives up, but that surfaces in Stripe's dashboard as a failing event rather than a silently lost order.) The redirect returns 500 to the browser with no retry — acceptable because the webhook is the retrier.
- **Signature verification** — correct: `stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret)` over the **raw** body read before any JSON parse; on failure it returns **400 (terminal, no retry)** — right, because a bad signature is not transient. Missing `Stripe-Signature` header → 400. Missing env vars → 500 (retryable once the secret lands).
- **Logging** — every branch logs the Stripe `event.id` (and session id / error). Failures are identifiable after the fact by event id, which maps to the payment in the Stripe dashboard. Good enough to reconcile a miss.

One deliberate design note: `sendInternalOrderAlert` does **not** filter `deleted_at` (it must fire at confirmation before a soft-delete could apply). `sendOrderConfirmation` **does** filter `deleted_at IS NULL`. Neither affects money or order creation.

---

## 5. What must be true in Stripe (Dave must confirm — not visible from code)

The **code** requires:

- **Subscribed event:** `checkout.session.completed` — the only event the handler acts on (everything else is 200-acked and ignored). If the endpoint is not subscribed to it, no webhook order is ever created.
- **Endpoint URL:** `https://cbcevjhvgmxrxeeyldza.supabase.co/functions/v1/stripe-webhook`
- **Signing secret:** the function reads `Deno.env.get("STRIPE_WEBHOOK_SECRET")` — a **Supabase Edge Function secret**. It must equal the signing secret of the endpoint that is sending events.
- **Deploy flag:** the function must be deployed `--no-verify-jwt` (Stripe sends no Supabase JWT; the signature is the security boundary).

**The critical live-mode fact:** Stripe **test mode and live mode have entirely separate webhook endpoints and separate signing secrets.** Today's `STRIPE_WEBHOOK_SECRET` is a **test-mode** `whsec_…`. When the API keys go live:

- A **new live-mode endpoint** must be created in the Stripe dashboard (same URL), subscribed to `checkout.session.completed`.
- Its **live signing secret** (`whsec_…`, different from test) must replace `STRIPE_WEBHOOK_SECRET` in Supabase.
- If this is skipped, live events are either not sent (no live endpoint) or fail signature (test secret vs live events) — **the backstop is silently off.**

I cannot read the Stripe dashboard, so Dave must confirm: (i) a test-mode endpoint exists today, subscribed to `checkout.session.completed`, pointing at the URL above, whose secret matches the current `STRIPE_WEBHOOK_SECRET`; and (ii) create the live equivalent at swap time.

---

## 6. Live-key swap runbook (ordered; do the steps in this order)

Legend: **[Stripe]** = Stripe dashboard, **[Vercel]** = Vercel dashboard env vars, **[PowerShell]** = terminal (`supabase` CLI), **[SQL]** = Supabase SQL Editor.

**Pre-flight**
1. **[PowerShell/local]** Confirm the stray key. `.env` currently holds `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (test values). `.env` is git-ignored and is **not** deployed — the production Edge Functions read their secrets from **Supabase Edge Function secrets**, not `.env`. So the `.env` `STRIPE_SECRET_KEY` is a *local dev* value only (used by the local Stripe helper implied by `STRIPE_SERVER_PORT`). **Deleting it from `.env` is safe for production**; only a local dev script would notice. **Do NOT ever put `sk_live_…` in `.env`.** (Also confirm no `STRIPE_SECRET_KEY` is set in Vercel env — it should live only in Supabase; I cannot see Vercel from here.)

**Stripe live config**
2. **[Stripe]** Toggle to **Live mode**. Create a webhook endpoint → URL `https://cbcevjhvgmxrxeeyldza.supabase.co/functions/v1/stripe-webhook` → subscribe **`checkout.session.completed`**. Copy the **live signing secret** (`whsec_…`).
   - *Verify:* the endpoint shows in Live mode with that one event and the correct URL.
3. **[Stripe]** In Live mode, get the live **publishable** (`pk_live_…`) and **secret** (`sk_live_…`) API keys.

**Secrets — Supabase (server-side)**
4. **[PowerShell]** `supabase secrets set STRIPE_SECRET_KEY=sk_live_…`
5. **[PowerShell]** `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…` (the LIVE one from step 2)
6. **[PowerShell]** Confirm `SITE_URL` is already `https://promo-gifts-co.uk` (`supabase secrets list`).
   - *Verify:* `supabase secrets list` shows all three present (values are masked).

**Redeploy the functions that read those secrets** (so they pick up the new values)
7. **[PowerShell]**
   - `supabase functions deploy stripe-webhook --no-verify-jwt`
   - `supabase functions deploy confirm-payment`
   - `supabase functions deploy create-checkout-session`
   - *Verify:* deploys succeed; check function logs are clean on a test invocation.

**Publishable key — Vercel (client-side)**
8. **[Vercel]** Set `VITE_STRIPE_PUBLISHABLE_KEY=pk_live_…` for Production. Redeploy the site (Vercel).
   - *Verify:* the deployed checkout uses the live publishable key (network tab shows `pk_live_`).

**Post-swap verification (small real charge)**
9. **[Stripe live]** Do one real low-value purchase end-to-end. Confirm: the charge appears in the Stripe **Live** dashboard; the order row exists with `payment_status='paid'` and the correct totals; the webhook event shows **succeeded** (200) in the Stripe endpoint's event log.
10. **[Stripe live]** Repeat the **tab-closed** test (§7) once in live mode to prove the backstop.

**Rollback (if something fails after the swap)**
- If checkout or the webhook misbehaves: **[Vercel]** revert `VITE_STRIPE_PUBLISHABLE_KEY` to `pk_test_…` + redeploy, and **[PowerShell]** `supabase secrets set STRIPE_SECRET_KEY=sk_test_…` and `STRIPE_WEBHOOK_SECRET=<test whsec>` + redeploy the three functions. No live charges can be taken while reverted; fix, then re-swap.
- If a **real customer already paid on live but no order was created** (webhook + redirect both failed): find the paid session in the Stripe **Live** dashboard, then either **[Stripe]** "Resend" the `checkout.session.completed` event to the (now-fixed) endpoint, or **[SQL]** call the RPC directly with the real ids — `SELECT confirm_payment_atomic('<quote_id>','<cs_...session_id>','<pi_...>',<amount_pounds>);` — the same manual recovery used for the historical ghost order (CLAUDE.md §17.7). It is idempotent, so it is safe even if the event later redelivers.

---

## 7. What to test before swapping (test mode)

Do this in **test mode** first — it exercises the webhook path, including the never-yet-tested tab-closed case.

**Setup:** confirm the **test-mode** endpoint exists (Stripe → Test mode → Webhooks), URL = the function URL above, subscribed to `checkout.session.completed`, and its signing secret equals the current `STRIPE_WEBHOOK_SECRET`.

1. **Happy path (both paths run).** Buy a test product, pay with `4242 4242 4242 4242`, let the redirect complete. Check: order created, `payment_status='paid'`, totals right, one customer email, one internal alert. In Stripe, the webhook event shows 200. This proves the event fires and verifies.
2. **Tab-closed (webhook-only — the reason the webhook exists).** Start a checkout, pay, then **close the tab / kill the network before the redirect lands**. Wait a few seconds. Check the DB: the order should exist anyway, created by the webhook, complete and paid, with the emails sent. This is the scenario that has never been tested and is the whole point.
3. **Replay / duplicate.** In the Stripe dashboard, open the `checkout.session.completed` event and click **"Resend"**. Confirm **no** second order, **no** second email, **no** second internal alert (idempotency §3). Then run the redirect for the same session as well — still one order.
4. **Bad signature.** POST any body to the endpoint without a valid `Stripe-Signature` → expect **400** and no DB change.
5. **Unpaid / non-order event.** Confirm an unpaid or unrelated event is 200-acked with no order.

**What to check in the DB after each:**
```sql
SELECT order_number, payment_status, subtotal, tax_amount, total_amount,
       stripe_session_id IS NOT NULL AS has_session, quote_id IS NOT NULL AS has_quote,
       confirmation_email_sent_at, internal_alert_sent_at
  FROM orders WHERE stripe_session_id = '<the cs_... id>';
SELECT product_name, quantity, taxable_net_unit, line_vat, size_breakdown, print_areas
  FROM order_items WHERE order_id = (SELECT id FROM orders WHERE stripe_session_id = '<the cs_... id>');
```
Expect exactly one order row, `payment_status='paid'`, totals populated, one non-null `confirmation_email_sent_at` and one `internal_alert_sent_at`, and items carrying the VAT/size/print fields.

---

## Summary of findings

| # | Finding | Severity | Blocks swap? |
|---|---|---|---|
| 1 | Order content is 100% RPC-built from identical inputs; webhook order == redirect order (all VAT/size/print/address/quote/session fields present; `line_vat` generated) | — (this is the good news) | No |
| 2 | Idempotency holds across both paths + replay: `orders.stripe_session_id` (+ unique index + `FOR UPDATE`), email CAS, alert CAS | — | No |
| 3 | Failure handling correct: RPC error → Stripe retries; bad signature → 400 terminal; emails best-effort | — | No |
| 4 | **Webhook never exercised end-to-end**; correct-by-inspection only. Must run §7 (incl. tab-closed) | **High** | **Yes — test first** |
| 5 | **Live mode needs its own endpoint + signing secret**; swapping keys without it silently disables the backstop | **High** | **Yes — configure + verify** |
| 6 | Stray `STRIPE_SECRET_KEY` in `.env` (local/dev only; git-ignored; prod uses Supabase secrets). Safe to delete for prod; never put `sk_live` there | Low | No |

**Bottom line:** ship-ready code, launch-blocking configuration. No fix needed in the repo. Before live keys: (a) run the test-mode webhook sequence including tab-closed and event replay, and (b) create the live endpoint and set its signing secret as part of the §6 runbook, verifying step 9–10 with one real charge.
