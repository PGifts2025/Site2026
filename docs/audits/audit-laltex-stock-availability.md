# Audit — Laltex Stock Availability

**Date:** 2026-07-25
**Scope:** Read-only. No source changed, no sync run, no scraper, no PR.
**Question:** Does Laltex expose stock data, at what granularity, and is a twice-daily refresh feasible?

---

## TL;DR — the data exists, at exactly the granularity Dave needs

**Stock is available per colour-size variant, via `GET /trade/api/stocks/{productcode}` — the endpoint the PR #81 step-0 check got wrong.**

That check tried `/trade/api/**v1**/stocks/TF0101` and got a 404, concluding "no stock." The documented and working path has **no `/v1/`**: `/trade/api/stocks/TF0101` returns **HTTP 200** with a `FreeStock` figure per variant. The 404 proved the path wrong, not the data absent.

- **Granularity:** colour × size (the variant SKU / `ItemCode`). e.g. TF0101 "Azure Blue / 2XL" → `FreeStock: 1`, "Black / 2XL" → `FreeStock: 97`.
- **Join:** the stock `ProductCode` equals our stored `items[].item_code` **exactly** — 120/120 match for TF0101. Stock drops straight onto the variants we already store.
- **Fetch model:** one call per product (returns all that product's variants). No working bulk-all endpoint. 1194 products at ~76 ms/call ≈ 90 s sequential — the same shape and cost as the existing nightly product sync. **Twice-daily is comfortably feasible; no rate limit is documented.**
- **Extra signal:** `DueIns` gives incoming quantity + ETA ("back in stock ~date"), and `FreeStock: -1` means **Made To Order** (available, longer lead time — not out of stock).

This is a §5 outcome (data exists → propose the shape). The proposal is below.

---

## 1. What the documentation says (V1.7, read end to end)

`pdftotext` over `docs/Laltex API Documentation V1.7.pdf` (16,963 lines). The documented endpoints:

| Endpoint | Purpose |
|---|---|
| `GET v1/products/list` | product code list |
| `GET v1/products/{productcode}` | full product (the sync uses this) |
| **`GET stocks/{productcode}`** | **stock — note: NO `/v1/`** |
| `GET v1/productmin/list` / `v1/productmin/{division}` | lightweight product feed |
| `GET order/status` / `order/status/{salesorder}` | order status |

**Stock API (verbatim from the PDF):**
```
GET: stocks/{productcode}
URL: https://auto.laltex.com/trade/api/stocks/{productcode}
eg. https://auto.laltex.com/trade/api/stocks/mg0192
    https://auto.laltex.com/trade/api/stocks/mg0192am     <- item-level code also accepted
Parameters: API_KEY (header), Accept: application/json
Response: "Stock details includes freestock, dueins etc"  -> ArrayOfStock
```

**Stock object schema (verbatim):**

| Field | Meaning |
|---|---|
| `ProductCode` | the variant SKU (= our `item_code`) |
| `Description` | item description |
| `Colour` | colour name |
| `PMS` | pantone code |
| **`FreeStock`** | **"Free stock available on the floor. `-1` indicates Made To Order"** |
| `Size` | clothing size ("Small… Xtra Large"); null for non-clothing |
| `SeedType` | promo-seed type (niche) |
| **`DueIns`** | **array of `{ DueInQty, DueInETA }`** — incoming quantity + estimated arrival |

- Version: the PDF is **V1.7**; the live API self-reports the same shape (no newer-version drift observed).
- **No rate limit / throttle is documented anywhere** (searched: rate limit, throttle, requests-per-minute/hour/day, maximum requests → zero hits).

Search term counts in the doc: `stock` 93, `availab…` 797, `FreeStock`/`DueIns` present with a full field table and a worked JSON example (below). This is a first-class, documented feature.

## 2. Live API probe (empirical)

`API_KEY` header, `Accept: application/json`. Exact URLs, status, body:

| URL | HTTP | Body |
|---|---|---|
| `…/trade/api/stocks/TF0101` | **200** | array of 120 variants, each with `FreeStock` (see below) |
| `…/trade/api/stocks/MG0450` | **200** | `[{"ProductCode":"MG0450BK","Colour":"Black","FreeStock":759,"DueIns":[],"Size":null}]` |
| `…/trade/api/stocks/mg0192` | **200** | per-colour: Amber 6000, Black 15457, … |
| `…/trade/api/stocks/MG0192AM` (item-level) | **200** | single variant `{…"FreeStock":6000…}` |
| `…/trade/api/stocks/list` | **200** | **empty body** — no usable bulk-all endpoint |
| `…/trade/api/stocks` (bare) | 404 | IIS not-found |
| `…/trade/api/**v1**/stocks/TF0101` (the PR #81 attempt) | 404 | IIS not-found — **wrong path shape** |

TF0101 live sample (verbatim first two):
```json
[{"ProductCode":"TF01012X-AZBL","Colour":"Azure Blue","Size":"2Xtra Large","FreeStock":1,"DueIns":[],"PMS":""},
 {"ProductCode":"TF01012X-BLAC","Colour":"Black","Size":"2Xtra Large","FreeStock":97,"DueIns":[]}]
```
TF0101 distribution: **114 variants in stock, 6 at zero, 0 Made-To-Order.** So genuine per-variant availability, including real out-of-stock colour-size combinations — exactly the case Dave wants to catch before a PO.

A populated `DueIns` (from the PDF's own example) shows the shape when stock is incoming:
```json
{ "ProductCode":"MG0192AM","FreeStock":1443,
  "DueIns":[{"DueInQty":5760,"DueInETA":"2025-06-20T00:00:00"}] }
```

**Authentication scope:** the same `API_KEY` that reads products reads stock — no separate key or permission needed (the 200s above used the existing key).

## 3. What the sync already discards

The product endpoint's `Items[]` (what `parseItems` maps) carries **no** stock field — confirmed against TF0101's stored `raw_payload` (no `FreeStock`/`DueIns` anywhere in it). So this is **not** an ignored-field situation: stock lives on a **separate endpoint the sync never calls**, not in the product payload. Nothing to un-discard; there is a new endpoint to start calling.

The one thing already in place that makes this cheap: the stock `ProductCode` is byte-identical to our stored `items[].item_code`. **120/120 exact join for TF0101.** So a stock refresh maps onto the variants we already hold with zero reconciliation.

## 4. Non-API sources

Not needed — the API carries it. (No stock file / FTP / separate service is required.)

## 5. Proposed shape (data exists)

### Endpoint & granularity
- `GET /trade/api/stocks/{productcode}` → array of stock objects, **one per colour-size variant**, keyed by `ProductCode` = our `item_code`.
- **Per-product fetch only** (no bulk). ~1194 calls for the Laltex pool.

### Feasibility of twice-daily
- ~76 ms/call → ~90 s sequential for 1194; faster if chunked/parallelised (the existing sync already runs 1194 calls nightly on this budget, CLAUDE.md §28.2). No documented rate limit. **A twice-daily stock cron is well within reach** and independent of the nightly product sync.

### Semantics to encode (do not get these wrong)
- `FreeStock > 0` → in stock (that many).
- `FreeStock === 0` → out of stock **now**; check `DueIns` for a back-in-stock ETA.
- **`FreeStock === -1` → Made To Order** — available, longer lead time. **Must not be shown as "out of stock."**
- `DueIns: [{DueInQty, DueInETA}]` → "more due ~<date>".

### Storage
Stock is **volatile** (twice-daily) whereas `items[]` is product data (changes on product sync). Do not fold stock into the `items[]` JSONB — that couples a fast-moving refresh to the product row and forces rewriting product data on every stock run. Two clean options:

- **(A, recommended) A dedicated stock JSONB column + timestamp on `supplier_products`:** `stock jsonb` mapping `item_code → { free, mto, due_ins }`, plus `stock_checked_at timestamptz`. One row per product = one stock call = one UPSERT touching only these two columns (PostgREST merge-duplicates leaves everything else alone). The normaliser joins it onto colours/sizes by `item_code`.
- **(B) A separate `supplier_stock` table** keyed `(supplier_id, item_code)` with `free_stock int, made_to_order bool, due_ins jsonb, checked_at`. Better if you later want per-variant SQL queries or history; more moving parts now.

Either way, add a **dedicated stock cron** (e.g. `sync-laltex-stock`, ~06:00 and ~14:00 UTC) mirroring the existing sync/embed cron split (§27) so a stock-endpoint outage never blocks product sync and vice-versa. Reuse the `job_runs`/`job_failures` observability with a new `job_type='stock'`.

### Staleness — present it honestly
Twice-daily stock **will** be wrong sometimes (a variant can sell out four hours after the refresh). Recommendations:
- **Indicative badges, not guarantees.** Per colour-size: "In stock", "Low stock (N left)" for small `FreeStock`, "Made to order", "Out of stock — more due ~<date>". Show a small "stock indicative, confirmed at order" note and the `stock_checked_at` freshness ("checked 3h ago").
- **Warn, don't hard-block.** Because the data is up to ~12h stale in both directions, a hard block would sometimes refuse orders for stock that actually exists. Recommend: allow ordering but surface a clear warning when a chosen size's `FreeStock` is 0 or below the requested quantity (e.g. "Some sizes may be on a longer lead time — we'll confirm at order"). Keep the internal orders@ alert (PR #80) as the backstop where the team reconciles against the live PO.
- **Surface at the point of choice:** the size selector (PR #81) is the natural home — annotate each size input with its indicative stock, and total against `FreeStock` per size. The customer sees "Medium: 3 left" before committing.

### Blast radius (for the eventual build, not this audit)
Migration (stock column or table + a `job_type='stock'` value), one new cron route + lib (clone `sync-laltex.js`/`laltex-sync.js`), a normaliser join, and size-selector annotations. No change to pricing/VAT/orders. Modest and self-contained.

## 6. If stock data did not exist

Not applicable — it does. (For the record, had it not: the honest mitigations are a lead-time / "subject to availability" note at checkout, which manages expectation but prevents nothing, plus the PR #80 internal alert as the human backstop. None of that is needed now.)

---

## Correction to the PR #81 step-0 note

PR #81's step 0 recorded "Items[] carries no stock field and `stocks/{code}` returns 404 → no stock available." The first half is true (stock isn't in the product payload); the second half was a **path error** — it queried `/v1/stocks/…`. The correct `/stocks/…` endpoint returns full per-variant `FreeStock` + `DueIns`. **Stock availability is fully exposed by Laltex at colour-size granularity and is practical to refresh twice daily.**

---

## Appendix — evidence

| Fact | Source |
|---|---|
| Stock endpoint is `stocks/{code}` (no `/v1/`), item-level code also valid | PDF V1.7 lines 114-128; live 200s |
| Stock object: FreeStock (−1=MTO), DueIns[{DueInQty,DueInETA}], Colour, Size | PDF field table (l.388-420) + JSON example (l.4440-4515) |
| `/v1/stocks/` 404 (the PR #81 attempt); `/stocks/` 200 | live probe |
| `stocks/list` 200 but empty → no bulk-all | live probe |
| Stock ProductCode == our `items[].item_code`, 120/120 for TF0101 | live join check |
| TF0101: 114 in stock / 6 zero / 0 MTO | live |
| ~76 ms/call; 1194 ≈ 90 s; no documented rate limit | live latency + PDF search |
| No stock field in product `raw_payload` | stored TF0101 row |
