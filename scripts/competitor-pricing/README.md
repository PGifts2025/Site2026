# Competitor Pricing Intelligence — Total Merchandise

On-demand tool to scrape [Total Merchandise](https://www.totalmerchandise.co.uk)'s
public product catalogue, fuzzy-match it against PGifts' products by name, and
emit side-by-side **all-in** (product + print + delivery) price comparison CSVs
at six quantity tiers (25, 50, 100, 250, 500, 1000) in both ex-VAT and inc-VAT.

It exists so we can see where PGifts sits price-wise across the catalogue, and
re-run the check whenever we want. **Nothing is scheduled — you run each script
by hand.**

This tool lives entirely in this directory. Its dependencies are local
(`scripts/competitor-pricing/node_modules`) and do not touch the app build.

## Prerequisites

- Node 18+ (uses built-in `fetch`). Verified on Node 20.
- `npm install` inside **this** directory (installs `cheerio` + `string-similarity`).
- The project root `.env` must have `VITE_SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` (already present for the rest of the project). Only
  the comparison step reads them, read-only.

## Run it (three steps, in order)

```bash
cd scripts/competitor-pricing
npm install

node scrape-tm-sitemap.js          # ~1 min   → output/sitemap-<ts>.json
node scrape-tm-prices.js           # ~4-5 hrs → output/tm-products-<ts>.json   (run overnight)
node compare-with-pgifts.js        # ~5 min   → 4 CSVs in output/
```

Each step writes a timestamped file into `output/`; the next step automatically
picks up the most recent one.

### Test on a small sample first

```bash
node scrape-tm-prices.js --limit 10      # scrape just 10 products (~30s)
node compare-with-pgifts.js              # compare using that sample
```

### Resume a crashed / interrupted scrape

The price scraper saves progress every 10 products to
`output/tm-products-progress.json`. If it dies (network drop, machine sleep,
Ctrl-C), restart with:

```bash
node scrape-tm-prices.js --resume
```

Already-scraped URLs are skipped. The progress file is deleted automatically on
a clean finish.

## Flags

| Script | Flag | Meaning |
|---|---|---|
| `scrape-tm-prices.js` | `--limit N` | Scrape only the first N URLs (testing). |
| `scrape-tm-prices.js` | `--resume` | Continue from the progress file. |
| `scrape-tm-prices.js` | `--input <path>` | Use a specific sitemap JSON. |
| `compare-with-pgifts.js` | `--threshold N` | Match confidence 0..1 (default 0.85). |
| `compare-with-pgifts.js` | `--input <path>` | Use a specific tm-products JSON. |

## Pricing basis — both sides are ALL-IN ex-VAT

Both the PGifts and TM prices in the comparison are **all-in, ex-VAT**
(product + print + delivery) — the same number a customer sees on each site:

- **TM:** the scraped per-unit price already bundles product + print +
  delivery. It is shown **ex-VAT by default** (the "Everything included" wording
  means print + delivery, not VAT — the page has a separate VAT toggle). The
  scraper takes the displayed ex-VAT value as the source of truth and derives
  inc-VAT as ×1.20.
- **PGifts:** `compare-with-pgifts.js` computes the all-in price the same way
  [`LaltexProductView.jsx`](../../src/components/LaltexProductView.jsx) renders
  it at quote time — `product sell_price + cheapest print per-unit + UK-standard
  delivery share × (1 + margin)`. (Earlier versions read `product_pricing[].sell_price`
  alone, which omitted print + delivery and made PGifts look artificially cheap.)

### Print anchor

PGifts products have several print positions/methods; TM shows one all-in price.
For an apples-to-apples comparison, the PGifts price uses the **cheapest
available print method/size at qty 100, 1 colour, 1 position** — mirroring TM's
"from £X everything included" framing. The chosen method/size is recorded in the
`pgifts_print_method` / `pgifts_print_size` columns for transparency.

## The output CSVs

All land in `output/` (git-ignored). Open in Excel / Google Sheets.

### `comparison-<ts>.csv` — the main file (38 columns)

PGifts **Laltex** products that matched a TM product. Identity + diagnostic
columns: `pgifts_code, pgifts_name, pgifts_print_method, pgifts_print_size,
match_confidence, tm_code, tm_name, tm_url`. Then, for each of the six quantity
tiers, five columns:

- `pgifts_qty{N}_exvat` — PGifts all-in price ex-VAT
- `pgifts_qty{N}_incvat` — PGifts all-in × 1.20
- `tm_qty{N}_incvat` — TM all-in inc-VAT
- `tm_qty{N}_exvat` — TM all-in ex-VAT
- `gap_qty{N}_pct` — `((pgifts_exvat − tm_exvat) / tm_exvat) × 100`.
  **Positive = we're more expensive. Negative = we're cheaper.**

`pgifts_print_method` / `pgifts_print_size` reflect the qty-100 anchor (the same
basis as `gap_qty100_pct`). A blank PGifts price at a tier means no all-in could
be computed for that qty (POA, or missing print/delivery data).

**To find where we're badly positioned:** sort by `gap_qty100_pct` descending.

### `pgifts-direct-<ts>.csv` — reference only

The 25 PGifts Direct products are **excluded from the matcher** (see below) and
listed here for reference: `pgifts_code, pgifts_name, from_price_indicator,
note`. `from_price_indicator` is the cheapest `catalog_pricing_tiers` per-unit
price if available, else "see admin dashboard". No matching, no gap.

### `tm-not-in-pgifts-<ts>.csv`

TM products that no PGifts product matched — candidate range gaps. Columns:
`tm_code, tm_name, tm_url, tm_qty100_incvat, tm_qty250_incvat` (full data is in
the `tm-products-<ts>.json`).

### `no-tm-match-<ts>.csv`

PGifts Laltex products with no confident TM match, **including the closest
candidate below threshold** (`best_candidate_tm_name`,
`best_candidate_confidence`) so you can spot-check matches the fuzzy matcher just
missed.

## Why PGifts Direct is excluded from the matcher

The 25 PGifts Direct products (lowercase slug codes like `chi-cup`,
`a6-pocket-notebook`) are **unique-to-PGifts** items with no real Total
Merchandise equivalent. Matching them by name produces false signals — a generic
name like "T-Shirts" or "Water Bottle" fuzzy-matches a *physically different* TM
product. They are filtered out of the matcher upstream (only `supplier = laltex`
rows are compared) and emitted to `pgifts-direct-<ts>.csv` for reference. Their
print/delivery pricing also lives in `catalog_print_pricing` /
`catalog_pricing_tiers` (a different render path), not in `supplier_products`.

## `match_confidence`

A 0–100 score (Dice coefficient on normalised names). Names are lowercased,
stripped of punctuation, and have marketing words removed
("promotional/branded/printed/custom/personalised"). The code default is 85;
Dave runs `--threshold 0.75`. It reliably catches identical / near-identical
names (e.g. PGifts `MG0114` ↔ TM `254941`, both "Renoir 400ml Travel Mug").

- Too many false matches? Raise `--threshold 0.9`.
- Missing obvious matches? Lower `--threshold 0.7` and eyeball `no-tm-match`.

## Caveats — read before quoting these numbers

- **Print anchor is the cheapest method.** Occasionally the cheapest 1-colour /
  1-position "print" line is a non-decoration item (e.g. a backing card). It's
  correct per the cheapest-anchor rule but can make a few all-in prices look
  high — worth an eye when spot-checking the worst-positioned list.
- **Name-match quality.** A confident name match isn't a guaranteed
  like-for-like product. Spot-check the worst-positioned rows against the
  `tm_url` before acting on a gap (this is the Step 2 review).
- **Delivery is UK-standard.** The PGifts delivery share uses the UK-standard
  service at the order quantity; non-UK delivery is handled separately.

## Politeness / legal

- Honest `User-Agent` identifying PGifts (no browser impersonation).
- Minimum 2.5s between requests; retries with backoff; hard-aborts on 403/429.
- `robots.txt` is re-checked at the start of every scrape run; if TM ever
  disallows product pages, the scripts abort and do nothing.
- **The scraped data is internal pricing intelligence only. Never republish
  it.** `output/` is git-ignored so price dumps never get committed.

## Troubleshooting: TM redesigned the page and the parser broke

If `scrape-tm-prices.js` starts logging `FAIL ... page structure changed` for
most products, TM has changed their markup. Fix:

1. Save one product page's HTML and inspect it.
2. The parser (`lib/parse-tm-page.js`) keys on:
   - product name: `<h1>` (fallback `<title>`)
   - product code: a `<p>` containing `Product Code:`
   - prices: `span.units` (qty) + `span.rate` (per-unit, ex-VAT) per row
3. Update those selectors. The parser deliberately **throws** on missing fields
   rather than returning empty data, so breakage is loud, not silent.
