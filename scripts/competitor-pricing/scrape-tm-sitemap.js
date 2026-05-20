// Step 1 of 3 — discover every Total Merchandise product URL from their sitemap.
//
//   node scrape-tm-sitemap.js
//
// Writes output/sitemap-<timestamp>.json. Runs the robots.txt gate first.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { politeFetch } from './lib/fetch-polite.js';
import { assertScrapingAllowed } from './lib/robots-check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');
const SITEMAP_URL = 'https://www.totalmerchandise.co.uk/sitemap.xml';

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Product pages look like /branded-products/<category>/<product-slug>
// (3 path segments). Category index pages (2 segments) aren't in the sitemap.
// The /branded-products/special/* bucket holds curated COLLECTION landing pages
// (best-sellers, christmas-ideas, ...), not products — exclude that category.
const EXCLUDED_CATEGORIES = new Set(['special']);
function isProductUrl(loc) {
  try {
    const u = new URL(loc);
    const segs = u.pathname.split('/').filter(Boolean);
    return (
      segs[0] === 'branded-products' &&
      segs.length >= 3 &&
      !EXCLUDED_CATEGORIES.has(segs[1])
    );
  } catch {
    return false;
  }
}

async function collectLocs(url, acc) {
  const xml = await politeFetch(url);
  const $ = cheerio.load(xml, { xmlMode: true });

  if ($('sitemapindex').length) {
    const children = [];
    $('sitemap > loc').each((_, el) => children.push($(el).text().trim()));
    for (const child of children) {
      await collectLocs(child, acc);
    }
    return;
  }

  let found = 0;
  $('url > loc').each((_, el) => {
    acc.push($(el).text().trim());
    found += 1;
  });
  // Fallback for atypical sitemap markup.
  if (found === 0) {
    $('loc').each((_, el) => acc.push($(el).text().trim()));
  }
}

async function main() {
  try {
    await assertScrapingAllowed();

    const allLocs = [];
    await collectLocs(SITEMAP_URL, allLocs);

    const products = [...new Set(allLocs.filter(isProductUrl))];

    if (products.length === 0) {
      throw new Error(
        'No product URLs matched the /branded-products/<category>/<slug> pattern. ' +
          'TM may have changed their sitemap or URL structure — inspect the sitemap manually.',
      );
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const ts = timestamp();
    const outPath = path.join(OUTPUT_DIR, `sitemap-${ts}.json`);
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          scrapedAt: new Date().toISOString(),
          source: SITEMAP_URL,
          totalLocs: allLocs.length,
          totalUrls: products.length,
          urls: products,
        },
        null,
        2,
      ),
    );

    console.log('');
    console.log(`Total <loc> entries in sitemap: ${allLocs.length}`);
    console.log(`Found ${products.length} product URLs. Saved to output/sitemap-${ts}.json`);
    console.log('Sample:');
    for (const u of products.slice(0, 5)) console.log(`  ${u}`);
  } catch (err) {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
