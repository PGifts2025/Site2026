// Step 2 of 3 — fetch each TM product page and parse its pricing table.
//
//   node scrape-tm-prices.js [--limit N] [--resume] [--input <sitemap.json>]
//
//   --limit N    only scrape the first N URLs (use --limit 10 to test)
//   --resume     continue from output/tm-products-progress.json, skipping
//                already-scraped URLs
//   --input P    use sitemap JSON at path P (default: latest output/sitemap-*.json)
//
// Runs the robots.txt gate first. Saves progress every 10 successes so a crash
// never loses work. The FULL run is ~4-5 hours at the 2.5s rate limit — run it
// overnight. For a quick check use --limit 10.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { politeFetch } from './lib/fetch-polite.js';
import { assertScrapingAllowed } from './lib/robots-check.js';
import { parseTmPage } from './lib/parse-tm-page.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');
const PROGRESS_PATH = path.join(OUTPUT_DIR, 'tm-products-progress.json');
const SAVE_EVERY = 10;

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function parseArgs(argv) {
  const args = { limit: null, resume: false, input: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--resume') args.resume = true;
    else if (a === '--input') args.input = argv[++i];
  }
  if (args.limit !== null && (!Number.isInteger(args.limit) || args.limit <= 0)) {
    throw new Error('--limit must be a positive integer');
  }
  return args;
}

function latestSitemap() {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  const files = fs
    .readdirSync(OUTPUT_DIR)
    .filter((f) => /^sitemap-.*\.json$/.test(f))
    .sort()
    .reverse();
  return files.length ? path.join(OUTPUT_DIR, files[0]) : null;
}

function saveProgress(products, failures) {
  fs.writeFileSync(
    PROGRESS_PATH,
    JSON.stringify({ savedAt: new Date().toISOString(), products, failures }, null, 2),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    await assertScrapingAllowed();

    const sitemapPath = args.input || latestSitemap();
    if (!sitemapPath || !fs.existsSync(sitemapPath)) {
      throw new Error(
        'No sitemap JSON found. Run `node scrape-tm-sitemap.js` first, or pass --input <path>.',
      );
    }
    console.log(`[input] ${sitemapPath}`);
    let urls = JSON.parse(fs.readFileSync(sitemapPath, 'utf8')).urls || [];
    console.log(`[input] ${urls.length} product URLs in sitemap`);

    if (args.limit !== null) {
      urls = urls.slice(0, args.limit);
      console.log(`[limit] restricted to first ${urls.length} URLs`);
    }

    let products = [];
    let failures = [];
    if (args.resume && fs.existsSync(PROGRESS_PATH)) {
      const prog = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
      products = prog.products || [];
      failures = prog.failures || [];
      const done = new Set(products.map((p) => p.url));
      const before = urls.length;
      urls = urls.filter((u) => !done.has(u));
      console.log(
        `[resume] ${products.length} already scraped; ${before - urls.length} skipped; ${urls.length} remaining`,
      );
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    let sinceSave = 0;
    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i];
      const progressLabel = `(${i + 1}/${urls.length})`;
      try {
        const html = await politeFetch(url);
        const parsed = parseTmPage(html, url);
        products.push(parsed);
        sinceSave += 1;
        console.log(`  ${progressLabel} OK ${parsed.tmCode} — ${parsed.tmName}`);
      } catch (err) {
        if (err.fatal) {
          // 403 / 429 / consecutive-404 — stop everything, but keep what we have.
          saveProgress(products, failures);
          console.error(`\nFATAL ${progressLabel}: ${err.message}`);
          console.error(`Progress saved to ${PROGRESS_PATH}. Re-run with --resume after resolving.`);
          process.exit(1);
        }
        failures.push({ url, error: err.message });
        console.warn(`  ${progressLabel} FAIL ${url} — ${err.message}`);
      }

      if (sinceSave >= SAVE_EVERY) {
        saveProgress(products, failures);
        sinceSave = 0;
      }
    }

    const ts = timestamp();
    const outPath = path.join(OUTPUT_DIR, `tm-products-${ts}.json`);
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          scrapedAt: new Date().toISOString(),
          totalProducts: products.length,
          totalFailures: failures.length,
          products,
          failures,
        },
        null,
        2,
      ),
    );

    // Clean up progress only after the final file is safely written.
    if (fs.existsSync(PROGRESS_PATH)) fs.unlinkSync(PROGRESS_PATH);

    console.log('');
    console.log(`Done. ${products.length} products parsed, ${failures.length} failures.`);
    console.log(`Saved to output/tm-products-${ts}.json`);
  } catch (err) {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
