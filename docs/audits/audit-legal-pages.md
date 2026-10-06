# Audit — Legal Pages and Compliance Gap

**Date:** 2026-08-08
**Scope:** Read-only. No pages written, no code changed, no PR. Codebase + live-schema inspection only.
**Status of the site:** live, taking real payments (live Stripe keys), holding real customer PII and orders.

> ⚠️ **Not legal advice.** This is an engineering audit of what the code does and what a UK ecommerce site of this type would normally carry. It is not a substitute for a qualified adviser. **Anything drafted from this should be reviewed by someone qualified (solicitor or a reputable template service) before it is relied on**, especially the returns/cancellation, complaints, and retention specifics, which depend on Dave's actual processes.

---

## Verdict up front

**There are no legal pages of any kind** — no Terms & Conditions, Privacy Policy, Cookie notice, Returns/Cancellation, Delivery, or Accessibility page exists as a route, file, or stub. The homepage footer prints the words *"Privacy Policy | Terms & Conditions"* as **plain static text with no links behind them** — arguably worse than absence, because it implies documents that do not exist. The site is live and processing personal data and payments with **no published privacy notice**, which is the one genuinely blocking gap under UK GDPR. Everything else ranges from legally-required-soon to advisable.

---

## 1 — What exists today

| Thing looked for | Result |
|---|---|
| Terms & Conditions | **Absent** — no route, file, or content |
| Privacy Policy | **Absent** |
| Cookie notice / consent banner | **Absent** (and no cookie banner is currently *needed* on today's cookie usage — see §2) |
| Returns / Cancellation / Refunds | **Absent** |
| Delivery / Shipping policy | **Absent** |
| Accessibility statement | **Absent** |
| Footer legal links | The **only** footer is inside `Home.jsx` (lines ~898–1015) — **homepage only**, not global. `App.jsx` renders `<HeaderBar />` on every route but **no global footer**. That footer's bottom line reads: `© 2025 Promo Gifts. All rights reserved. \| Privacy Policy \| Terms & Conditions` — but "Privacy Policy" and "Terms & Conditions" are **plain text, not links** (no `<Link>`/`<a>`). So they don't 404; they simply go nowhere. |
| `Footer.jsx` component | A **stub** ("Footer will go here."), imported only by `Layout.jsx`, which is **not** used as the global wrapper. Dead. |
| Checkout terms tickbox / acknowledgement | **Absent** — `CustomerQuotes.jsx` (Pay Now), `OrderConfirmation.jsx`, and `Cart.jsx` have no "I accept the terms" control or link. |
| Stripe Checkout terms/privacy | **Not configured.** `create-checkout-session/index.ts` sets `line_items`, `mode`, `success_url`, `cancel_url`, `metadata`, `customer_email` — **no** `consent_collection`, `custom_text.terms_of_service_url`, or `business_profile` links. So Stripe's hosted page shows **no** merchant terms or privacy link either. |

**Companies Act footer disclosure** (assessed in §3): the homepage footer *does* render `disclosure` + registered office + VAT number from `src/config/business.js` — but only on the homepage.

**Net:** nothing exists; two phantom labels imply otherwise; the corporate/VAT disclosure is present but homepage-only.

---

## 2 — What the site actually does with personal data (the substance of the privacy notice)

### 2a. Personal data collected

| Data | Where held | Source |
|---|---|---|
| Account: email, password (hashed by Supabase), first/last name | `auth.users` (Supabase Auth) | `AuthContext.signUp` |
| Profile: `contact_name`, `first_name`, `last_name`, `company_name`, `phone`, `email` | `customer_profiles` | signup + account settings |
| Orders: customer id, **shipping address** jsonb (`company, fao, line1, line2, city, postcode, country, phone, instructions`), `po_number`, line items, totals, order history | `orders`, `order_items` | checkout |
| Quotes (pre-order): same shape, address, items | `quotes`, `quote_items` | quote pipeline |
| **Artwork files** — customer-uploaded logos/designs (may contain third-party IP or personal data in the artwork itself) | Supabase **Storage** bucket `order-artwork` (**private**), path `{userId}/{orderId}/{file}`; metadata in `order_artwork` | customer upload |
| Saved designs (Fabric JSON, thumbnails) | `user_designs` | Designer |
| **AI chat**: the customer's typed messages + the full assistant/tool conversation (Anthropic content-block JSON) | `ai_conversations` (retained), and sent to **Anthropic** at request time | AI widget |
| **AI search/chat queries**: the query text is embedded via **OpenAI** (`text-embedding-3-small`) on every `search-products` call | sent to **OpenAI**; not stored as such | `api/search-products.js` |
| **Anonymous visitor fingerprint**: FingerprintJS `visitorId`, **hashed** SHA-256 server-side into `visitor_id_hash` for the 5/24h anonymous AI quota | `ai_quotas` (hash only; raw fingerprint never stored); FingerprintJS runs client-side | `AIChatWidget` → `api/ai/chat` |
| Payment: card data | **Stripe only** — never touches our servers/DB. We store `stripe_session_id`, `payment_intent_id`, amounts | Stripe Checkout |
| Transactional emails: recipient address + order details | sent via **Resend** | Edge Functions |
| Server/request logs (incl. IP addresses) | **Vercel** + **Supabase** platform logs | hosting |

### 2b. Third-party processors (the sub-processor list a privacy notice must disclose)

| Processor | Role | Personal data it sees | Notes for the notice |
|---|---|---|---|
| **Supabase** | Database, Auth, Storage, Edge Functions | All PII, artwork, passwords (hashed) | Primary data host. Confirm the hosting region for an international-transfer statement. |
| **Vercel** | Frontend hosting + serverless (`/api/*`, crons) | Request data, IP addresses | US-based; transfer mechanism worth noting. |
| **Stripe** | Payments | Cardholder + billing data, email | PCI handled by Stripe; we are out of card scope. |
| **Resend** | Transactional email | Recipient email + order contents | Order confirmation, artwork alerts, auth emails. |
| **Anthropic** | AI assistant (Claude) | Whatever the customer types into the chat | Conversations also stored in `ai_conversations`. |
| **OpenAI** | Query embeddings for product search | The search/AI **query text** | Fires on every AI product search. Often overlooked — it *is* a processor of customer input. |
| **FingerprintJS** | Anonymous device identification for AI quota | Device signals → a visitor id | Fingerprinting is a **PECR/consent-sensitive** technique even when "functional" (see §3). |
| **Laltex** | Supplier product/stock feed | **None today** — inbound only; **no** customer order/PII is sent to Laltex | If order submission to Laltex is built later, this changes and the notice must be updated. |

### 2c. Retention & deletion

- **Orders are soft-deleted** (`orders.deleted_at`) — "deleting" an order hides it but the row, items, address, and artwork **persist indefinitely**. There is **no hard-delete or purge** of customer data anywhere.
- **No account-deletion / erasure flow exists.** Grep found `deleteUserDesign` (removes a saved design) and product *archiving*, but **no** `auth.admin.deleteUser`, no "delete my account", no data-erasure mechanism. A UK GDPR erasure ("right to be forgotten") request today could only be honoured by **manual SQL**, and nothing documents a retention period.
- `ai_conversations` and `ai_quotas` (hash) are retained with **no expiry**.
- **No defined retention periods** anywhere. This is a required element of a privacy notice and needs Dave's input (e.g. how long orders are kept for accounting — HMRC generally expects 6 years of records).

> A privacy policy must describe *this* reality. In particular it must not claim data is deleted on request when the mechanism is manual, and it should be honest that order data is retained (for accounting/legal reasons) rather than erased.

---

## 3 — What is legally required (UK, sells to both B2B and B2C)

Distinguishing consumer (B2C) from business (B2B): the **consumer** protections below (Consumer Contracts Regulations, cancellation rights) apply only where the customer is an individual acting outside their trade. **Data-protection law (UK GDPR/PECR) and company-disclosure law apply regardless** of who the customer is.

### UK GDPR + DPA 2018 — **required, and the blocking gap**
A **privacy notice** is mandatory the moment personal data is processed (it is, extensively). It must state, at minimum: identity + contact details of the controller (Alpha Omega Ltd); what data is collected and why; the **lawful basis** for each purpose (contract performance for orders; legitimate interests for the AI quota/fingerprint and fraud; consent where relied on); who it's shared with (the §2b sub-processors); international transfers (US processors); **retention periods**; and the **data-subject rights** (access, rectification, erasure, restriction, portability, objection) with **how to exercise them** and the right to complain to the **ICO**. Also: whether the business is **ICO-registered / pays the data-protection fee** (a controller of this kind normally must — worth Dave confirming).

### Consumer Contracts Regulations 2013 (CCRs) — **required for B2C**
Distance-selling pre-contract information (main characteristics, total price incl. VAT and delivery, trader identity/address, delivery arrangements, complaint handling) and the **14-day cancellation right**.
- **Bespoke-goods exemption (state it explicitly).** Goods "made to the consumer's specifications or clearly personalised" are **exempt from the 14-day cancellation right** (CCRs reg. 28(1)(b)). **Personalised printed merchandise is the core of this business**, so most orders will be exempt — but this must be **stated plainly in the terms** (that personalised/printed items cannot be cancelled/returned once production/approval has begun), not left ambiguous. Non-personalised, unprinted stock would **not** be exempt.
- Faulty/not-as-described goods retain their **Consumer Rights Act 2015** remedies regardless of the bespoke exemption.

### Companies Act 2006 ss.1202–1204 — **required, regardless of B2B/B2C**
Trading under "Promo Gifts" (not the registered name) triggers business-name disclosure: the **corporate name (Alpha Omega Ltd)** and an **address for service** must be given on business documents and the website, and made available to anyone doing business, on request.
- **Assessment:** the homepage footer *content* (Alpha Omega Ltd + registered office + VAT number) **appears to satisfy the substance**, but the **placement is a weakness** — it renders on the **homepage only**. Best practice (and the safer reading) is to make it reachable from **every page** (a global footer, or an "About/Legal" page linked site-wide). VAT registration also independently requires the **VAT number** to be shown on invoices (the order-confirmation email already carries it — good).

### Electronic Commerce (EC Directive) Regulations 2002 — **required, regardless of B2B/B2C**
An "information society service" must make available: the trader's name, geographic address, email, company registration details, VAT number, and clear pricing (incl. tax/delivery). Much of this exists in the footer/emails; it should live somewhere permanent and site-wide (typically the terms or a legal page), not homepage-only.

### PECR (cookies/tracking) — **conditional; currently low exposure**
PECR requires consent for storing/reading non-essential information on a user's device. **Today the site sets no analytics/advertising cookies** (grep found no GA/GTM/Plausible/PostHog/Hotjar/etc., and no `document.cookie` usage). Client storage is limited to the **Supabase auth session (localStorage — strictly necessary)** and **FingerprintJS**. **FingerprintJS is the one to watch:** device fingerprinting is treated as accessing information on the user's device and is **consent-sensitive under PECR** even when used for a "functional" purpose like quota. Options to raise with Dave: rely on a legitimate-interests + transparency position (disclose it in the privacy/cookie notice), gate it behind consent, or drop it in favour of the existing IP-hash fallback. **If any analytics is added later, a consent banner becomes required.** A short cookie/tracking statement is advisable now given FingerprintJS.

---

## 4 — Practical gaps specific to this business (easy to overlook)

These are things the site *does* that terms should cover:

- **Artwork ownership & IP (important).** Customers upload logos/designs (`order-artwork`). Terms should put the **warranty of ownership/licence on the customer** (they confirm they own or are licensed to use what they upload and **indemnify** Promo Gifts against third-party IP claims), and grant Promo Gifts the **licence needed to reproduce it** for the order (and, if wanted, for samples/marketing — that must be explicit, per the marked-image handling noted in CLAUDE.md §50).
- **Print colour tolerance.** The Designer already shows an **"indicative colour / confirmed at proof"** note on swatches (CLAUDE.md §53/§54). Terms should state a **reproduction tolerance** (screen colours are indicative; Pantone/CMYK matching within commercial tolerance; not a defect if within tolerance).
- **Proof approval & disputes.** There is a proof/artwork approval step; terms should state that **once the customer approves artwork/proof, they own errors in the approved artwork** (spelling, layout, colour choices), which is the standard print-trade position and directly limits disputes.
- **MOQs and contact-us thresholds.** Products have **minimum order quantities**, and some bags show a **"contact us for a quote" ceiling** above a threshold (CLAUDE.md §46/§60). Terms/Delivery should acknowledge MOQs and that large runs are individually quoted.
- **Lead times & "Express" claims.** Product pages surface lead times and an **Express** claim (CLAUDE.md §31 `express_available`, "5-day"/"24hr" express appears in UI). Terms should frame lead times as **estimates from artwork approval**, not guarantees, to avoid a delivery-time contractual promise.
- **Stock indications are explicitly indicative** (Laltex live stock, CLAUDE.md §59 — "indicative, confirmed at order"). Terms should say stock/availability is indicative and orders are subject to availability.
- **Delivery.** Pricing includes **delivery to one UK address**; **international by prior arrangement** (CLAUDE.md §46). A short delivery policy should state this, plus who bears re-delivery/wrong-address costs.
- **Payment with order, no credit account.** Orders are **paid in full up front** via Stripe (no invoice/account terms). Terms should state payment is taken at order and the contract forms on payment/acceptance.
- **VAT-inclusive pricing & the zero-rated exception.** VAT is charged (CLAUDE.md §48/§60); children's clothing lines are **zero-rated on the garment portion** (the order email already notes this). Terms/pricing info should state prices, VAT treatment, and that VAT is shown at checkout.

---

## 5 — Recommendation

### Priority

**Blocking (do before continuing to trade much further):**
1. **Privacy Policy** — legally required the moment PII is processed; the site is live without one. It must accurately reflect §2 (data, processors, transfers, retention, rights, ICO). This is the single genuine blocker.
2. **Terms & Conditions of Sale** — required to make the contract enforceable and, critically, to **state the bespoke/personalised no-cancellation position** (§3 CCRs) and the **artwork-IP indemnity** (§4). Without it, consumer cancellation ambiguity and IP liability are live risks now that real orders flow.

**Required-soon / strongly advisable:**
3. **Make the Companies Act / e-commerce disclosure site-wide** — replace the homepage-only footer with a **global footer** carrying the corporate name, registered office, VAT number, and links to the legal pages. Small code change, disproportionately useful (also fixes the phantom non-link labels).
4. **Cookie / tracking statement** — short, covering the Supabase session storage and **FingerprintJS**; decide FingerprintJS's consent posture (§3 PECR).
5. **Delivery & Returns/Cancellation page** — can be folded into the T&Cs or stand alone; states delivery (UK-inclusive, international by arrangement), lead-time-as-estimate, and the returns position (faulty vs bespoke).

**Advisable, not blocking:**
6. **Accessibility statement** — good practice, not strictly mandatory for a private B2B/B2C trader.
7. **A data-erasure / "delete my account" path** (or at least a documented manual process + retention schedule) so GDPR rights requests are answerable without ad-hoc SQL.
8. **Checkout acknowledgement** — a "by paying you agree to our Terms" line + link on the Pay Now step, and/or set Stripe Checkout's `custom_text.terms_of_service_url` + a privacy link so the hosted page shows them.

### Section outlines (not drafts)

- **Privacy Policy:** controller identity; data collected (per §2a); purposes + **lawful basis** each; sub-processors (§2b) + international transfers; retention periods; data-subject rights + how to exercise; cookies/fingerprinting cross-ref; ICO complaint route; contact.
- **Terms & Conditions of Sale:** definitions; B2B vs B2C scope; ordering + acceptance (contract on payment); pricing/VAT; **payment up front, no account**; **artwork: customer IP warranty + indemnity + reproduction licence**; **proof approval & approved-artwork errors**; **colour tolerance**; **MOQs / bespoke quotes**; production **lead times as estimates**; **delivery** (UK-inclusive, international by arrangement); **cancellation/returns incl. the personalised-goods exemption** and CRA rights for faulty goods; liability cap; complaints process; governing law (England & Wales).
- **Delivery policy** (or a T&C section): UK-included, international by arrangement, lead times from approval, stock indicative.
- **Cookie/tracking statement:** session storage (essential); FingerprintJS (purpose + posture); "no analytics cookies currently".

### Where they live (routes + placement)

- New routes: `/privacy`, `/terms`, `/delivery-returns` (or `/returns`), `/cookies`, optionally `/accessibility`. Simple static pages (the site is a Vite SPA; each is a component + a `<Route>` in `App.jsx`, wrapped by the same `HeaderBar`).
- **Global footer** rendered in `App.jsx` (next to `<HeaderBar />`) so it appears on every page, containing the disclosure + these links — replacing the homepage-only footer and the dead `Footer.jsx` stub.
- **Checkout:** add a Terms/Privacy line + link on the Pay Now step (`CustomerQuotes.jsx`) and, ideally, `custom_text.terms_of_service_url` in `create-checkout-session`.

### Template-adaptable vs needs-Dave's-input

- **Adaptable from a reputable UK template** (then reviewed): the boilerplate structure of the privacy policy and T&Cs, GDPR-rights wording, e-commerce disclosure, colour-tolerance and IP-indemnity clauses (standard print-trade language).
- **Needs Dave's specific input** (a template will be wrong otherwise): **returns/refunds handling** (his actual policy for faulty/mis-print), the **complaints process** (who/how/timescale), **data retention periods** (esp. how long orders/accounts are kept — tie to HMRC 6-year records), FingerprintJS consent decision, whether artwork may be reused for **marketing**, and confirmation of **ICO registration**.

### Size

- **Content authoring** (Dave + template/adviser): the bulk of the effort, and outside code — **M–L**, gated on his returns/complaints/retention answers and a legal review.
- **Engineering to host it** (once content exists): static pages + global footer + checkout link + optional Stripe `custom_text` — **S** (roughly a day): ~4–5 route components, one global-footer change in `App.jsx`, one line in `CustomerQuotes.jsx`, one field in `create-checkout-session`. The erasure/retention mechanism (item 7) is a separate **M** if built properly.

---

## Appendix — evidence

| Finding | Evidence |
|---|---|
| No legal routes | `grep terms\|privacy\|cookie\|returns… src/App.jsx` → none |
| No legal page files | `find src -iname *term*/*privacy*/…` → none |
| Footer is homepage-only; labels are plain text | `src/pages/Home.jsx` ~898–1015; bottom line `… \| Privacy Policy \| Terms & Conditions` with no `<Link>`; `App.jsx:71–72` renders `HeaderBar` but no global footer |
| `Footer.jsx` is a dead stub | `src/components/Footer.jsx`; imported only by unused `Layout.jsx` |
| No checkout tickbox | `CustomerQuotes.jsx` / `OrderConfirmation.jsx` / `Cart.jsx` — no terms control |
| Stripe shows no terms/privacy | `create-checkout-session/index.ts` — no `consent_collection`/`custom_text`/`business_profile` |
| No analytics cookies | grep `gtag\|analytics\|document.cookie…` → none |
| FingerprintJS | `AIChatWidget.jsx:44–54,168–180`; hashed at `api/ai/chat.js` |
| OpenAI processes query text | `api/search-products.js:35,179–180` |
| No customer PII to Laltex | outbound grep → only product/stock/pricing |
| Soft-delete only; no erasure | `orders.deleted_at`; no `admin.deleteUser`/account-delete anywhere |
| Business details | `src/config/business.js` (tradingName, legalEntity, vatNumber, tradingAddress, registeredOffice, disclosure) |
