// Extract product code, name, and tiered pricing from a Total Merchandise
// product page's HTML.
//
// ============================================================================
// IMPORTANT — VAT semantics (corrected against the live page, 2026-05-20)
// ============================================================================
// The build brief assumed TM's displayed "Everything Included Price" is
// INCLUSIVE of VAT. Inspecting the live page proves otherwise: the page ships
// an embedded JSON blob with both `rate_ex_vat` and `rate_incl_vat`, and the
// numbers rendered in the visible pricing table match `rate_ex_vat`, not
// `rate_incl_vat`. There is a "VAT" toggle on the page; the server-rendered
// default state shows EX-VAT.
//
//   Example (Essential Sandwich Peak Cotton Cap, 10 units):
//     visible table .rate          = £11.82 / unit
//     JSON rate_ex_vat             = 11.817   ✅ matches the visible value
//     JSON rate_incl_vat           = 14.18    (= 11.817 × 1.20)
//
// "Everything included" refers to print + delivery being bundled into the unit
// price; VAT is shown/hidden by the toggle and is EXCLUDED by default. So:
//   - We parse the visible table values as EX-VAT (the source of truth).
//   - We derive inc-VAT as exVat × 1.20 (UK standard rate).
// This keeps the comparison apples-to-apples: PGifts prices are also ex-VAT.
// Treating the displayed value as inc-VAT (and dividing by 1.20) would have
// understated TM by ~17%, making PGifts look artificially expensive.
//
// ----------------------------------------------------------------------------
// We parse the visible DOM table (semantic .units / .total / .rate classes)
// rather than the JSON blob on purpose: the table renders exactly ONE pricing
// set — TM's default decoration method — which is "what a customer sees first".
// The JSON carries 4+ decoration variants with no machine-readable "default"
// flag, so picking the right one programmatically is fragile. The table already
// resolves that for us.
// ============================================================================

import * as cheerio from 'cheerio';

const VAT_RATE = 0.2;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function extractName($) {
  const h1 = $('h1').first().text().trim();
  if (h1) return h1;
  // Fall back to <title> ("Name | Category" → "Name").
  const title = $('title').first().text().trim();
  if (title) return title.split('|')[0].trim();
  return '';
}

function extractCode($) {
  let code = null;
  // The code lives in a <p> like: "Product Code: 253759" (cheerio drops the
  // React <!-- --> comment artefact from .text()).
  $('p').each((_, el) => {
    const txt = $(el).text().trim();
    const m = txt.match(/Product\s*Code:\s*([A-Za-z0-9][A-Za-z0-9._/-]*)/i);
    if (m) {
      code = m[1].trim();
      return false; // stop iterating
    }
    return undefined;
  });
  return code;
}

function extractExVatTiers($) {
  // One pricing row looks like:
  //   <span class="kUUqaY">
  //     <span class="units">10 units</span>
  //     <span class="favpJU">
  //       <span class="total">£118.17</span>
  //       <span class="rate">£11.82/ unit</span>
  //     </span>
  //   </span>
  // The table is rendered twice (desktop + mobile), so we key by quantity to
  // dedupe — first valid occurrence per qty wins.
  const exVat = {};
  $('span.units').each((_, el) => {
    const qtyText = $(el).text();
    const qtyMatch = qtyText.match(/([\d,]+)\s*units?/i);
    if (!qtyMatch) return;
    const qty = parseInt(qtyMatch[1].replace(/,/g, ''), 10);
    if (!Number.isInteger(qty) || qty <= 0) return;

    const wrapper = $(el).parent();
    let rateText = wrapper.find('span.rate').first().text();
    if (!rateText) {
      // Defensive fallback if the markup nests differently.
      rateText = $(el).closest('button').find('span.rate').first().text();
    }
    const rateMatch = rateText.match(/£\s*([\d,]+\.?\d*)/);
    if (!rateMatch) return;
    const rate = parseFloat(rateMatch[1].replace(/,/g, ''));
    if (!Number.isFinite(rate) || rate <= 0) return;

    if (exVat[qty] == null) exVat[qty] = rate;
  });
  return exVat;
}

/**
 * Parse a TM product page.
 * @param {string} html
 * @param {string} url
 * @returns {{ url, tmCode, tmName, pricesExVat, pricesIncVat, scrapedAt }}
 * @throws {Error} with a clear message naming the missing field if structure changed.
 */
export function parseTmPage(html, url) {
  if (!html || typeof html !== 'string') {
    throw new Error(`Empty HTML for ${url}`);
  }
  const $ = cheerio.load(html);

  const tmName = extractName($);
  if (!tmName) {
    throw new Error(`Could not find product name (no <h1>/<title>) — page structure changed: ${url}`);
  }

  const tmCode = extractCode($);
  if (!tmCode) {
    throw new Error(`Could not find "Product Code:" — page structure changed: ${url}`);
  }

  const pricesExVat = extractExVatTiers($);
  const tierCount = Object.keys(pricesExVat).length;
  if (tierCount === 0) {
    throw new Error(
      `No pricing tiers found (span.units/.rate missing or empty) — ` +
        `page structure changed or product is POA: ${url}`,
    );
  }

  const pricesIncVat = {};
  for (const [qty, ex] of Object.entries(pricesExVat)) {
    pricesIncVat[qty] = round2(ex * (1 + VAT_RATE));
  }

  return {
    url,
    tmCode,
    tmName,
    pricesExVat, // source of truth, scraped directly from the visible table
    pricesIncVat, // derived: exVat × 1.20
    scrapedAt: new Date().toISOString(),
  };
}

export { VAT_RATE };
