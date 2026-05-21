// Step 3 of 3 — match TM products to PGifts (Laltex) products by name and emit
// side-by-side ALL-IN price comparison CSVs.
//
//   node compare-with-pgifts.js [--threshold N] [--input <tm-products.json>]
//
//   --threshold N   name-match confidence 0..1 (default 0.85; Dave runs 0.75)
//   --input P       use TM products JSON at path P (default: latest output/tm-products-*.json)
//
// No network scraping here, so no robots gate. Runs in well under 5 minutes.
//
// ---------------------------------------------------------------------------
// PRICE BASIS — both sides are now ALL-IN ex-VAT (apples-to-apples):
//
//  - TM prices: scraped EX-VAT (see lib/parse-tm-page.js header), inc-VAT
//    derived as ×1.20. TM's displayed unit price bundles product + print +
//    delivery.
//  - PGifts prices: computed by computeAllInPrice() to mirror exactly what
//    LaltexProductView.jsx renders at quote time —
//      product sell_price
//      + cheapest print method/size at qty (1 colour, 1 position)
//      + UK-standard delivery share × (1 + margin)
//    This matches TM's all-in format. (Previously the script read product
//    sell_price only, which understated PGifts' real customer-facing price and
//    made PGifts look artificially cheap. Fixed per Step 1b.)
//  - gap_qty{N}_pct = ((pgifts_exvat − tm_exvat) / tm_exvat) × 100.
//    Positive = PGifts more expensive; negative = PGifts cheaper.
//
// PGifts DIRECT (25 curated products) are EXCLUDED from the matcher: they are
// unique-to-PGifts items with no TM equivalent, so name-matching them produces
// false signals. They are emitted to pgifts-direct-{ts}.csv for reference only.
// Their print/delivery pricing also lives in catalog_print_pricing /
// catalog_pricing_tiers (a different render path), not in supplier_products.
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normaliseName, findBestMatch } from './lib/fuzzy-match.js';
import { writeCsvFile } from './lib/csv-writer.js';
import { deliveryPerUnit } from '../lib/laltex-delivery.js';
import { scheduleMarginForTier } from '../lib/laltex-margin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const TIERS = [25, 50, 100, 250, 500, 1000];
const ANCHOR_QTY = 100; // qty used for the diagnostic print method/size + gap tally
const VAT_RATE = 0.2;
const TIE_BAND_PCT = 1; // |gap| <= 1% counts as "tied" in the summary
const DELIVERY_SERVICE = 'ukstandard';

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmt2 = (n) => (n == null ? '' : n.toFixed(2));

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function parseArgs(argv) {
  const args = { threshold: 0.85, input: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--threshold') args.threshold = parseFloat(argv[++i]);
    else if (argv[i] === '--input') args.input = argv[++i];
  }
  if (!(args.threshold >= 0 && args.threshold <= 1)) {
    throw new Error('--threshold must be between 0 and 1');
  }
  return args;
}

function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  const fromFile = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      fromFile[m[1]] = v;
    }
  }
  const url = process.env.VITE_SUPABASE_URL || fromFile.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || fromFile.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      `Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (looked in env and ${envPath})`,
    );
  }
  return { url, key };
}

function latestTmProducts() {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  const files = fs
    .readdirSync(OUTPUT_DIR)
    .filter((f) => /^tm-products-.*\.json$/.test(f))
    .sort()
    .reverse();
  return files.length ? path.join(OUTPUT_DIR, files[0]) : null;
}

// --- Supabase (PostgREST) reads -------------------------------------------

// supplier_products keys suppliers by supplier_id (UUID FK), not a `supplier`
// text column — so resolve slug → id once and filter by id.
async function fetchSupplierIds({ url, key }) {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const res = await fetch(`${url}/rest/v1/suppliers?select=id,slug`, { headers });
  if (!res.ok) throw new Error(`suppliers fetch failed: ${res.status} ${await res.text()}`);
  const map = {};
  for (const r of await res.json()) map[r.slug] = r.id;
  return map;
}

// PostgREST caps responses at 1000 rows (CLAUDE.md §28.1), so page explicitly.
async function fetchSupplierProducts({ url, key }, supplierId, select) {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const pageSize = 1000;
  const all = [];
  let offset = 0;
  for (;;) {
    const u =
      `${url}/rest/v1/supplier_products?select=${select}` +
      `&supplier_id=eq.${supplierId}&is_retired=eq.false` +
      `&order=supplier_product_code.asc&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(u, { headers });
    if (!res.ok) throw new Error(`supplier_products fetch failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    all.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

// PGifts Direct "from price" lives in catalog_pricing_tiers (slug == code).
async function fetchCatalogFromPrices({ url, key }) {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const res = await fetch(
    `${url}/rest/v1/catalog_products?select=slug,catalog_pricing_tiers(price_per_unit)`,
    { headers },
  );
  if (!res.ok) throw new Error(`catalog_products fetch failed: ${res.status} ${await res.text()}`);
  const map = {};
  for (const row of await res.json()) {
    const prices = (row.catalog_pricing_tiers || [])
      .map((t) => Number(t.price_per_unit))
      .filter((n) => Number.isFinite(n) && n > 0);
    map[row.slug] = prices.length ? Math.min(...prices) : null;
  }
  return map;
}

// --- All-in price calculation (mirrors LaltexProductView.jsx) --------------

// Print "method" names / classes that are NOT real decoration — optional
// packaging / accessory line items that live in print_details alongside genuine
// print methods. They must not be picked as the "cheapest print" anchor, or the
// all-in price is distorted (a backing-card line replaces the real decoration).
//
// NOTE on the brief's list: 'sleeve' was dropped — "Left/Right Sleeve" is a
// legitimate apparel print position (CLAUDE.md §53.2). Matching is word-boundary
// (not raw substring) so e.g. 'tag' does not match inside "vintage".
const NON_DECORATION_KEYWORDS = [
  'backing card', 'backing', 'packaging', 'gift box', 'carton', 'insert',
  'wrapping', 'tag', 'label only', 'no print', 'plain', 'unprinted',
];

// Words that positively identify a real decoration. Used to rescue £0 lines:
// a £0 price means "decoration included in the product price" (common, e.g.
// ZP1026 "Both Sides Full Colour" @ £0), which is valid and selectable — but
// only when the line clearly IS a decoration. A £0 line with no decoration
// wording is treated as suspicious and skipped. (Expanded beyond the brief's
// list so "Full Colour", "Spot", "Pad" etc. register as decoration.)
const DECORATION_KEYWORDS = [
  'print', 'printed', 'embroid', 'engrav', 'doming', 'dome', 'transfer',
  'screen', 'laser', 'etch', 'deboss', 'emboss', 'foil', 'colour', 'color',
  'spot', 'pad', 'vinyl', 'sublimation', 'uv', 'digital', 'litho', 'dtf',
];

const toWordRe = (kw) =>
  new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
const NON_DECORATION_RE = NON_DECORATION_KEYWORDS.map(toWordRe);
const DECORATION_RE = DECORATION_KEYWORDS.map(toWordRe);
const matchesAny = (blob, regexes) => regexes.some((re) => re.test(blob));

function productTierForQty(pricing, qty) {
  if (!Array.isArray(pricing)) return null;
  for (const t of pricing) {
    const min = Number(t.min_qty ?? 0);
    const max = t.max_qty == null ? Infinity : Number(t.max_qty);
    if (qty >= min && qty <= max) return t;
  }
  return null;
}

// Cheapest REAL decoration across all positions/methods at this qty, for
// 1 colour / 1 position. The per-unit cost is the tier's sell_price (margined,
// setup amortisation already baked in — CLAUDE.md §46; do NOT add setup_charge).
// all_in_unit_price / price are no-margin legacy fallbacks for un-recomputed rows.
//
// Non-decoration line items (backing cards, packaging, ...) are excluded so they
// can't masquerade as the cheapest print. A £0 price is accepted ONLY for a line
// that clearly is a decoration (= "included free"), otherwise it's skipped as
// suspicious.
//
// Returns { best: {unit, method, size} | null, wasFiltered }, where wasFiltered
// is true if any print_details entry was excluded by the non-decoration list.
function cheapestPrintAtQty(printDetails, qty) {
  let best = null;
  let wasFiltered = false;
  if (!Array.isArray(printDetails) || printDetails.length === 0) {
    return { best, wasFiltered };
  }
  for (const pd of printDetails) {
    const nameBlob = [
      pd.print_type, pd.PrintType, pd.print_class, pd.PrintClass,
      pd.print_position, pd.PrintPosition,
    ].filter(Boolean).join(' ');
    if (matchesAny(nameBlob, NON_DECORATION_RE)) {
      wasFiltered = true;
      continue; // packaging / accessory line — not a real decoration
    }
    const isDecoration = matchesAny(nameBlob, DECORATION_RE);
    const tiers = pd.print_price || pd.PrintPrice || [];
    for (const t of tiers) {
      if (t.is_poa) continue;
      const colours = Number(t.num_colours ?? t.NumColours ?? 1);
      const positions = Number(t.num_position ?? t.NumPosition ?? 1);
      if (colours !== 1 || positions !== 1) continue;
      const min = Number(t.min_qty ?? t.MinQuantity ?? 0);
      const rawMax = t.max_qty ?? t.MaxQuantity;
      const max = rawMax == null ? Infinity : Number(rawMax);
      if (qty < min || qty > max) continue;
      const unit =
        t.sell_price != null ? Number(t.sell_price)
        : t.all_in_unit_price != null ? Number(t.all_in_unit_price)
        : t.price != null ? Number(t.price) : null;
      if (unit == null || !Number.isFinite(unit) || unit < 0) continue;
      // £0 = decoration included in product price — valid only if the line is
      // clearly a decoration; otherwise a suspicious £0 non-decoration line.
      if (unit === 0 && !isDecoration) {
        wasFiltered = true;
        continue;
      }
      if (best == null || unit < best.unit) {
        best = {
          unit,
          method: pd.print_type || pd.PrintType || pd.print_position || null,
          size: pd.print_area || pd.PrintArea || null,
        };
      }
    }
  }
  return { best, wasFiltered };
}

/**
 * All-in customer-facing per-unit price (ex-VAT) for a Laltex product at qty.
 * Mirrors LaltexProductView.jsx: product sell_price + cheapest print per-unit
 * + delivery share × (1 + margin). Rounds to 2dp at the end only.
 *
 * @returns {{ allIn, productOnly, printMethod, printSize, printPerUnit, deliveryPerUnit, basis }}
 *          allIn is null if any required input is missing (basis says which).
 */
export function computeAllInPrice(row, qty) {
  const ptier = productTierForQty(row.product_pricing, qty);
  if (!ptier || ptier.is_poa) return { allIn: null, wasFiltered: false, basis: 'missing:product-tier' };
  const productOnly =
    ptier.sell_price != null ? Number(ptier.sell_price)
    : ptier.price != null ? Number(ptier.price) : null;
  if (productOnly == null || !(productOnly > 0)) {
    return { allIn: null, productOnly, wasFiltered: false, basis: 'missing:product-price' };
  }

  const { best: print, wasFiltered } = cheapestPrintAtQty(row.print_details, qty);
  if (!print) return { allIn: null, productOnly, wasFiltered, basis: 'missing:print' };

  const delPU = deliveryPerUnit(row.shipping_charges, row.carton_qty, qty, DELIVERY_SERVICE);
  if (!Number.isFinite(delPU) || delPU <= 0) {
    return {
      allIn: null, productOnly, printMethod: print.method, printSize: print.size,
      printPerUnit: print.unit, wasFiltered, basis: 'missing:delivery',
    };
  }
  const marginPct = scheduleMarginForTier(qty, row.margin_pct_override ?? null);
  const deliveryUnitWithMargin = delPU * (1 + marginPct);

  const allIn = Number((productOnly + print.unit + deliveryUnitWithMargin).toFixed(2));
  return {
    allIn,
    productOnly,
    printMethod: print.method,
    printSize: print.size,
    printPerUnit: print.unit,
    deliveryPerUnit: deliveryUnitWithMargin,
    wasFiltered,
    basis: 'all-in',
  };
}

// --- CSV layout ------------------------------------------------------------

const BASE_HEADERS = [
  'pgifts_code',
  'pgifts_name',
  'pgifts_print_method',
  'pgifts_print_size',
  'pgifts_print_was_filtered',
  'match_confidence',
  'tm_code',
  'tm_name',
  'tm_url',
];
const COMPARISON_HEADERS = [...BASE_HEADERS];
for (const q of TIERS) {
  COMPARISON_HEADERS.push(
    `pgifts_qty${q}_exvat`,
    `pgifts_qty${q}_incvat`,
    `tm_qty${q}_incvat`,
    `tm_qty${q}_exvat`,
    `gap_qty${q}_pct`,
  );
}

// --- Main ------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));

  const tmPath = args.input || latestTmProducts();
  if (!tmPath || !fs.existsSync(tmPath)) {
    throw new Error('No tm-products JSON found. Run `node scrape-tm-prices.js` first, or pass --input.');
  }
  console.log(`[input] TM products: ${tmPath}`);
  const tmData = JSON.parse(fs.readFileSync(tmPath, 'utf8'));
  const tmProducts = tmData.products || [];
  const tmNorm = tmProducts.map((p) => normaliseName(p.tmName));
  console.log(`[input] ${tmProducts.length} TM products`);

  const env = loadEnv();

  (async () => {
    const supplierIds = await fetchSupplierIds(env);
    if (!supplierIds.laltex) throw new Error('Could not resolve laltex supplier id from suppliers table');

    const laltex = await fetchSupplierProducts(
      env,
      supplierIds.laltex,
      'supplier_product_code,name,product_pricing,print_details,shipping_charges,carton_qty,margin_pct_override',
    );
    console.log(`[input] ${laltex.length} PGifts Laltex products (matchable, is_retired=false)`);

    const pgiftsDirect = supplierIds['pgifts-direct']
      ? await fetchSupplierProducts(env, supplierIds['pgifts-direct'], 'supplier_product_code,name')
      : [];
    const fromPriceMap = await fetchCatalogFromPrices(env);
    console.log(`[input] ${pgiftsDirect.length} PGifts Direct products (excluded from matcher)`);

    const comparisonRows = [];
    const noMatchRows = [];
    const matchedTmIndices = new Set();
    const gap100Samples = []; // { code, name, gap } for summary

    for (const pg of laltex) {
      const pgNorm = normaliseName(pg.name);
      const best = findBestMatch(pgNorm, tmNorm, { threshold: 0, normalised: true });

      // All-in PGifts price per tier (cheapest print at each qty independently).
      const allInByTier = {};
      for (const q of TIERS) allInByTier[q] = computeAllInPrice(pg, q);
      const anchor = allInByTier[ANCHOR_QTY] || {};

      if (best && best.confidence >= args.threshold) {
        const tm = tmProducts[best.index];
        matchedTmIndices.add(best.index);

        const row = {
          pgifts_code: pg.supplier_product_code,
          pgifts_name: pg.name,
          pgifts_print_method: anchor.printMethod || '',
          pgifts_print_size: anchor.printSize || '',
          pgifts_print_was_filtered: anchor.wasFiltered ? 'true' : 'false',
          match_confidence: Math.round(best.confidence * 100),
          tm_code: tm.tmCode,
          tm_name: tm.tmName,
          tm_url: tm.url,
        };

        for (const q of TIERS) {
          const pgEx = numOrNull(allInByTier[q].allIn);
          const tmEx = numOrNull(tm.pricesExVat ? tm.pricesExVat[q] : null);
          const tmInc = numOrNull(tm.pricesIncVat ? tm.pricesIncVat[q] : null);
          row[`pgifts_qty${q}_exvat`] = fmt2(pgEx);
          row[`pgifts_qty${q}_incvat`] = fmt2(pgEx == null ? null : round2(pgEx * (1 + VAT_RATE)));
          row[`tm_qty${q}_incvat`] = fmt2(tmInc);
          row[`tm_qty${q}_exvat`] = fmt2(tmEx);
          const gap = pgEx != null && tmEx != null && tmEx > 0 ? ((pgEx - tmEx) / tmEx) * 100 : null;
          row[`gap_qty${q}_pct`] = gap == null ? '' : gap.toFixed(1);
          if (q === ANCHOR_QTY && gap != null) {
            gap100Samples.push({ code: pg.supplier_product_code, name: pg.name, gap });
          }
        }
        comparisonRows.push(row);
      } else {
        noMatchRows.push({
          pgifts_code: pg.supplier_product_code,
          pgifts_name: pg.name,
          best_candidate_tm_name: best ? tmProducts[best.index].tmName : '',
          best_candidate_confidence: best ? Math.round(best.confidence * 100) : '',
        });
      }
    }

    const tmNotInPgifts = tmProducts
      .map((tm, i) => ({ tm, i }))
      .filter(({ i }) => !matchedTmIndices.has(i))
      .map(({ tm }) => ({
        tm_code: tm.tmCode,
        tm_name: tm.tmName,
        tm_url: tm.url,
        tm_qty100_incvat: fmt2(numOrNull(tm.pricesIncVat ? tm.pricesIncVat[100] : null)),
        tm_qty250_incvat: fmt2(numOrNull(tm.pricesIncVat ? tm.pricesIncVat[250] : null)),
      }));

    const pgiftsDirectRows = pgiftsDirect.map((pg) => {
      const from = fromPriceMap[pg.supplier_product_code];
      return {
        pgifts_code: pg.supplier_product_code,
        pgifts_name: pg.name,
        from_price_indicator: from != null ? from.toFixed(2) : 'see admin dashboard',
        note: 'PGifts Direct unique product, not compared against TM',
      };
    });

    const ts = timestamp();
    const comparisonPath = path.join(OUTPUT_DIR, `comparison-${ts}.csv`);
    const notInPath = path.join(OUTPUT_DIR, `tm-not-in-pgifts-${ts}.csv`);
    const noMatchPath = path.join(OUTPUT_DIR, `no-tm-match-${ts}.csv`);
    const directPath = path.join(OUTPUT_DIR, `pgifts-direct-${ts}.csv`);

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    writeCsvFile(comparisonPath, COMPARISON_HEADERS, comparisonRows);
    writeCsvFile(
      notInPath,
      ['tm_code', 'tm_name', 'tm_url', 'tm_qty100_incvat', 'tm_qty250_incvat'],
      tmNotInPgifts,
    );
    writeCsvFile(
      noMatchPath,
      ['pgifts_code', 'pgifts_name', 'best_candidate_tm_name', 'best_candidate_confidence'],
      noMatchRows,
    );
    writeCsvFile(
      directPath,
      ['pgifts_code', 'pgifts_name', 'from_price_indicator', 'note'],
      pgiftsDirectRows,
    );

    printSummary({
      args,
      laltexCount: laltex.length,
      directCount: pgiftsDirect.length,
      tmCount: tmProducts.length,
      matchedCount: comparisonRows.length,
      noMatchCount: noMatchRows.length,
      gap100Samples,
      comparisonPath,
      notInPath,
      noMatchPath,
      directPath,
    });
  })().catch((err) => {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  });
}

function printSummary(s) {
  const total = s.laltexCount || 1;
  const pct = (n) => ((n / total) * 100).toFixed(1);

  const withGap = s.gap100Samples;
  const cheaper = withGap.filter((g) => g.gap < -TIE_BAND_PCT).length;
  const dearer = withGap.filter((g) => g.gap > TIE_BAND_PCT).length;
  const tied = withGap.filter((g) => Math.abs(g.gap) <= TIE_BAND_PCT).length;
  const mPct = (n) => (withGap.length ? ((n / withGap.length) * 100).toFixed(1) : '0.0');
  const avgGap = withGap.length
    ? (withGap.reduce((a, g) => a + g.gap, 0) / withGap.length).toFixed(1)
    : 'n/a';

  const worst = [...withGap].sort((a, b) => b.gap - a.gap).slice(0, 10);

  console.log('');
  console.log('==================== COMPETITOR PRICING SUMMARY ====================');
  console.log(`PGifts Laltex products (matchable):  ${s.laltexCount}`);
  console.log(`PGifts Direct products (excluded):   ${s.directCount}`);
  console.log(`TM products:                         ${s.tmCount}`);
  console.log('');
  console.log(`Confident matches (>= ${s.args.threshold}):  ${s.matchedCount} (${pct(s.matchedCount)}%)`);
  console.log(`No match found:                      ${s.noMatchCount} (${pct(s.noMatchCount)}%)`);
  console.log('');
  console.log(`Of matched products (compared at qty 100, ${withGap.length} with prices on both sides):`);
  console.log(`  PGifts cheaper than TM:        ${cheaper} (${mPct(cheaper)}%)`);
  console.log(`  PGifts more expensive than TM: ${dearer} (${mPct(dearer)}%)`);
  console.log(`  Tied (within ${TIE_BAND_PCT}%):              ${tied} (${mPct(tied)}%)`);
  console.log('');
  console.log(
    `Average gap @100 (PGifts vs TM, all-in ex-VAT): ${avgGap}% ` +
      `${Number(avgGap) < 0 ? '(PGifts cheaper)' : Number(avgGap) > 0 ? '(PGifts more expensive)' : ''}`,
  );
  console.log('');
  if (worst.length) {
    console.log('Worst-positioned products (we are more expensive, by gap @100):');
    for (const w of worst) {
      console.log(`  ${(w.gap >= 0 ? '+' : '') + w.gap.toFixed(1)}%  ${w.code}  ${w.name}`);
    }
    console.log('');
  }
  console.log('Both sides are ALL-IN ex-VAT (product + print + delivery). PGifts print');
  console.log('anchor = cheapest method/size at qty 100, 1 colour, 1 position.');
  console.log('');
  console.log('Output saved to:');
  console.log(`  ${path.relative(PROJECT_ROOT, s.comparisonPath)}`);
  console.log(`  ${path.relative(PROJECT_ROOT, s.notInPath)}`);
  console.log(`  ${path.relative(PROJECT_ROOT, s.noMatchPath)}`);
  console.log(`  ${path.relative(PROJECT_ROOT, s.directPath)}`);
  console.log('====================================================================');
}

// Run only when invoked directly (so the module can be imported for testing
// without triggering the full comparison).
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  }
}
