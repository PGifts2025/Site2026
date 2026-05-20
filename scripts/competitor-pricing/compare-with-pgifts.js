// Step 3 of 3 — match TM products to PGifts products by name and emit
// side-by-side price comparison CSVs.
//
//   node compare-with-pgifts.js [--threshold N] [--input <tm-products.json>]
//
//   --threshold N   name-match confidence 0..1 (default 0.85)
//   --input P       use TM products JSON at path P (default: latest output/tm-products-*.json)
//
// Reads PGifts products from Supabase (supplier_products: both the laltex feed
// and the pgifts-direct mirror, is_retired = false). No network scraping here,
// so no robots gate. Runs in well under 5 minutes.
//
// ---------------------------------------------------------------------------
// VAT + price-basis notes (read before trusting the numbers):
//  - TM prices: scraped EX-VAT (see lib/parse-tm-page.js header), inc-VAT
//    derived as ×1.20. TM's unit price bundles print + delivery.
//  - PGifts prices: product_pricing[].sell_price, which is EX-VAT and EXCLUDES
//    the read-time UK-delivery share and any on-top print pricing (see
//    CLAUDE.md §46). So a matched PGifts unit price is the *garment/product*
//    sell price; TM's is more fully loaded. The gap_% is therefore indicative
//    of base positioning, and if anything FLATTERS PGifts. README "Caveats"
//    spells this out.
//  - gap_qty{N}_pct = ((pgifts_exvat − tm_exvat) / tm_exvat) × 100.
//    Positive = PGifts more expensive; negative = PGifts cheaper.
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normaliseName, findBestMatch } from './lib/fuzzy-match.js';
import { writeCsvFile } from './lib/csv-writer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const TIERS = [25, 50, 100, 250, 500, 1000];
const VAT_RATE = 0.2;
const TIE_BAND_PCT = 1; // |gap| <= 1% counts as "tied" in the summary

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

// PostgREST caps responses at 1000 rows (CLAUDE.md §28.1), so page explicitly.
async function fetchAllPgifts({ url, key }) {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const select =
    'supplier_product_code,name,margin_pct_override,is_retired,product_pricing,suppliers(slug)';
  const pageSize = 1000;
  const all = [];
  let offset = 0;
  for (;;) {
    const u =
      `${url}/rest/v1/supplier_products?select=${select}` +
      `&is_retired=eq.false&order=supplier_product_code.asc&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(u, { headers });
    if (!res.ok) {
      throw new Error(`Supabase fetch failed: ${res.status} ${await res.text()}`);
    }
    const rows = await res.json();
    all.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

function pgPriceAtQty(pricing, qty) {
  if (!Array.isArray(pricing)) return null;
  for (const t of pricing) {
    if (t.is_poa) continue;
    const min = Number(t.min_qty ?? 0);
    const max = t.max_qty == null ? Infinity : Number(t.max_qty);
    if (qty >= min && qty <= max) {
      const sp = t.sell_price != null ? Number(t.sell_price) : t.price != null ? Number(t.price) : null;
      return sp != null && Number.isFinite(sp) && sp > 0 ? sp : null;
    }
  }
  return null;
}

const BASE_HEADERS = [
  'pgifts_code',
  'pgifts_name',
  'supplier',
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
    const pgifts = await fetchAllPgifts(env);
    console.log(`[input] ${pgifts.length} PGifts products (supplier_products, is_retired=false)`);

    const comparisonRows = [];
    const noMatchRows = [];
    const matchedTmIndices = new Set();
    const gap100Samples = []; // { code, name, gap } for summary

    for (const pg of pgifts) {
      const supplierSlug = (pg.suppliers && pg.suppliers.slug) || '';
      const pgNorm = normaliseName(pg.name);
      const best = findBestMatch(pgNorm, tmNorm, { threshold: 0, normalised: true });

      if (best && best.confidence >= args.threshold) {
        const tm = tmProducts[best.index];
        matchedTmIndices.add(best.index);

        const row = {
          pgifts_code: pg.supplier_product_code,
          pgifts_name: pg.name,
          supplier: supplierSlug,
          match_confidence: Math.round(best.confidence * 100),
          tm_code: tm.tmCode,
          tm_name: tm.tmName,
          tm_url: tm.url,
        };

        for (const q of TIERS) {
          const pgEx = pgPriceAtQty(pg.product_pricing, q);
          const tmEx = numOrNull(tm.pricesExVat ? tm.pricesExVat[q] : null);
          const tmInc = numOrNull(tm.pricesIncVat ? tm.pricesIncVat[q] : null);
          row[`pgifts_qty${q}_exvat`] = fmt2(pgEx);
          row[`pgifts_qty${q}_incvat`] = fmt2(pgEx == null ? null : round2(pgEx * (1 + VAT_RATE)));
          row[`tm_qty${q}_incvat`] = fmt2(tmInc);
          row[`tm_qty${q}_exvat`] = fmt2(tmEx);
          const gap = pgEx != null && tmEx != null && tmEx > 0 ? ((pgEx - tmEx) / tmEx) * 100 : null;
          row[`gap_qty${q}_pct`] = gap == null ? '' : gap.toFixed(1);
          if (q === 100 && gap != null) {
            gap100Samples.push({ code: pg.supplier_product_code, name: pg.name, gap });
          }
        }
        comparisonRows.push(row);
      } else {
        noMatchRows.push({
          pgifts_code: pg.supplier_product_code,
          pgifts_name: pg.name,
          supplier: supplierSlug,
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

    const ts = timestamp();
    const comparisonPath = path.join(OUTPUT_DIR, `comparison-${ts}.csv`);
    const notInPath = path.join(OUTPUT_DIR, `tm-not-in-pgifts-${ts}.csv`);
    const noMatchPath = path.join(OUTPUT_DIR, `no-tm-match-${ts}.csv`);

    writeCsvFile(comparisonPath, COMPARISON_HEADERS, comparisonRows);
    writeCsvFile(
      notInPath,
      ['tm_code', 'tm_name', 'tm_url', 'tm_qty100_incvat', 'tm_qty250_incvat'],
      tmNotInPgifts,
    );
    writeCsvFile(
      noMatchPath,
      ['pgifts_code', 'pgifts_name', 'supplier', 'best_candidate_tm_name', 'best_candidate_confidence'],
      noMatchRows,
    );

    printSummary({
      args,
      pgiftsCount: pgifts.length,
      tmCount: tmProducts.length,
      matchedCount: comparisonRows.length,
      noMatchCount: noMatchRows.length,
      gap100Samples,
      comparisonPath,
      notInPath,
      noMatchPath,
    });
  })().catch((err) => {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  });
}

function printSummary(s) {
  const total = s.pgiftsCount || 1;
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
  console.log(`PGifts products: ${s.pgiftsCount}`);
  console.log(`TM products:     ${s.tmCount}`);
  console.log('');
  console.log(`Confident matches (>= ${s.args.threshold}): ${s.matchedCount} (${pct(s.matchedCount)}%)`);
  console.log(`No match found:                ${s.noMatchCount} (${pct(s.noMatchCount)}%)`);
  console.log('');
  console.log(`Of matched products (compared at qty 100, ${withGap.length} with prices on both sides):`);
  console.log(`  PGifts cheaper than TM:        ${cheaper} (${mPct(cheaper)}%)`);
  console.log(`  PGifts more expensive than TM: ${dearer} (${mPct(dearer)}%)`);
  console.log(`  Tied (within ${TIE_BAND_PCT}%):              ${tied} (${mPct(tied)}%)`);
  console.log('');
  console.log(`Average gap @100 (PGifts vs TM, ex-VAT): ${avgGap}% ${Number(avgGap) < 0 ? '(PGifts cheaper)' : Number(avgGap) > 0 ? '(PGifts more expensive)' : ''}`);
  console.log('');
  if (worst.length) {
    console.log('Worst-positioned products (we are more expensive, by gap @100):');
    for (const w of worst) {
      console.log(`  ${(w.gap >= 0 ? '+' : '') + w.gap.toFixed(1)}%  ${w.code}  ${w.name}`);
    }
    console.log('');
  }
  console.log('NOTE: TM prices include print + delivery; PGifts sell_price excludes the');
  console.log('read-time delivery share and on-top print pricing — so gaps flatter PGifts.');
  console.log('Both sides are ex-VAT in the gap calc. See README "Caveats".');
  console.log('');
  console.log('Output saved to:');
  console.log(`  ${path.relative(PROJECT_ROOT, s.comparisonPath)}`);
  console.log(`  ${path.relative(PROJECT_ROOT, s.notInPath)}`);
  console.log(`  ${path.relative(PROJECT_ROOT, s.noMatchPath)}`);
  console.log('====================================================================');
}

try {
  main();
} catch (err) {
  console.error(`\nERROR: ${err.message}`);
  process.exit(1);
}
