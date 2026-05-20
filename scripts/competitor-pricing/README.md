# Competitor Pricing Intelligence — Total Merchandise

On-demand tool to scrape [Total Merchandise](https://www.totalmerchandise.co.uk)'s
public product catalogue, fuzzy-match it against PGifts' products by name, and
emit side-by-side price comparison CSVs at six quantity tiers (25, 50, 100, 250,
500, 1000) in both ex-VAT and inc-VAT.

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
node compare-with-pgifts.js        # ~5 min   → 3 CSVs in output/
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

## The output CSVs

All land in `output/` (git-ignored). Open in Excel / Google Sheets.

### `comparison-<ts>.csv` — the main file (37 columns)

PGifts products that matched a TM product. For each of the six quantity tiers
there are five columns:

- `pgifts_qty{N}_exvat` — PGifts price ex-VAT
- `pgifts_qty{N}_incvat` — PGifts price × 1.20
- `tm_qty{N}_incvat` — TM price inc-VAT
- `tm_qty{N}_exvat` — TM price ex-VAT
- `gap_qty{N}_pct` — `((pgifts_exvat − tm_exvat) / tm_exvat) × 100`.
  **Positive = we're more expensive. Negative = we're cheaper.**

Plus 7 identity columns: `pgifts_code, pgifts_name, supplier, match_confidence,
tm_code, tm_name, tm_url`.

**To find where we're badly positioned:** sort by `gap_qty100_pct` descending.

### `tm-not-in-pgifts-<ts>.csv`

TM products that no PGifts product matched — candidate range gaps. Columns:
`tm_code, tm_name, tm_url, tm_qty100_incvat, tm_qty250_incvat` (full data is in
the `tm-products-<ts>.json`).

### `no-tm-match-<ts>.csv`

PGifts products with no confident TM match, **including the closest candidate
below threshold** (`best_candidate_tm_name`, `best_candidate_confidence`) so you
can spot-check matches the fuzzy matcher just missed.

## `match_confidence`

A 0–100 score (Dice coefficient on normalised names). Names are lowercased,
stripped of punctuation, and have marketing words removed
("promotional/branded/printed/custom/personalised"). 85 is the default cut-off
and reliably catches like-for-like products (e.g. PGifts `CF1004` ↔ TM `253759`,
both "Essential Sandwich Peak Cotton Cap").

- Too many false matches? Raise `--threshold 0.9`.
- Missing obvious matches? Lower `--threshold 0.8` and eyeball `no-tm-match`.

## Caveats — read before quoting these numbers

- **VAT direction.** TM's site shows ex-VAT by default (the "Everything
  included" wording means print + delivery are bundled, not VAT — the page has a
  separate VAT toggle). The scraper reads the displayed ex-VAT value as the
  source of truth and derives inc-VAT as ×1.20. (The original brief had this
  backwards; see `lib/parse-tm-page.js`.)
- **Not fully like-for-like.** TM's unit price includes print + delivery.
  PGifts' `sell_price` is the product/garment sell price **excluding** the
  read-time UK-delivery share and any on-top print pricing (CLAUDE.md §46). So
  the gap is an **indicative base-positioning** signal that, if anything,
  flatters PGifts. Treat large negative gaps with that in mind. A future v2
  could load PGifts delivery + print to make it strictly like-for-like.
- **Default decoration only.** TM lists several decoration methods per product;
  we capture the one shown by default (what a customer sees first).

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
