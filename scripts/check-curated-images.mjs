#!/usr/bin/env node
/**
 * check-curated-images.mjs — pick a WORKING card image for every curated
 * category product (category_product_curation), server-side.
 *
 * Why: Laltex's image host answers missing images slowly (~20 s, then fails),
 * so CategoryPage cannot discover broken URLs in the customer's browser fast
 * enough. This script walks each product's candidate images in the same order
 * the page uses (colour plain images, colour images, then product images —
 * CategoryPage `curatedImageCandidates`) and stores the first that returns an
 * image with 200 in `card_image_url`. Products with none get NULL and are
 * hidden from the grid. CLAUDE.md §65.7.
 *
 * Usage (site/.env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY):
 *   node scripts/check-curated-images.mjs            # write results
 *   node scripts/check-curated-images.mjs --dry-run  # report only
 * Re-run after adding curation rows or when Laltex images change.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const URL_BASE = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in site/.env');
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const DRY = process.argv.includes('--dry-run');
const TIMEOUT_MS = 8000;
const CONCURRENCY = 12;

async function rest(method, pathAndQuery, body, extra = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${pathAndQuery}`, { method, headers: { ...H, ...extra }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${pathAndQuery.split('?')[0]} -> ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// Same order as productCatalogService.normaliseProduct + CategoryPage.curatedImageCandidates.
function candidates(row) {
  const byColour = new Map();
  (row.items || []).forEach((it, idx) => {
    const key = String(it.item_colour || it.ItemColour || `Colour ${idx + 1}`).toLowerCase().trim();
    if (!byColour.has(key)) byColour.set(key, { images: [], plain: [] });
    const c = byColour.get(key);
    if (!c.images.length) c.images = (it.item_images || it.ItemImages || []).filter(Boolean);
    if (!c.plain.length) c.plain = (it.plain_images || it.PlainImages || []).filter(Boolean);
  });
  const urls = [...[...byColour.values()].flatMap((c) => [...c.plain, ...c.images]), ...(Array.isArray(row.images) ? row.images : [])]
    .map((u) => (typeof u === 'string' ? u : u?.url)).filter(Boolean);
  return [...new Set(urls)];
}

async function works(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(encodeURI(decodeURI(url)), { method: 'HEAD', signal: ctrl.signal });
    return r.status === 200 && String(r.headers.get('content-type') || '').startsWith('image/');
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

const curation = await rest('GET', 'category_product_curation?select=id,category_slug,supplier_product_code,position&order=id.asc&limit=10000');
const codes = [...new Set(curation.map((c) => c.supplier_product_code))];
const products = new Map();
for (let i = 0; i < codes.length; i += 150) {
  const chunk = codes.slice(i, i + 150).map((c) => `"${c.replace(/"/g, '\\"')}"`).join(',');
  const rows = await rest('GET', `supplier_products?select=supplier_product_code,items,images&supplier_product_code=in.(${encodeURIComponent(chunk)})`);
  rows.forEach((r) => products.set(r.supplier_product_code, r));
}

const checkedAt = new Date().toISOString();
const results = [];
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < curation.length) {
    const row = curation[next++];
    const cands = products.has(row.supplier_product_code) ? candidates(products.get(row.supplier_product_code)) : [];
    let chosen = null; let tried = 0;
    for (const u of cands) { tried += 1; if (await works(u)) { chosen = u; break; } }
    results.push({ ...row, card_image_url: chosen, card_image_checked_at: checkedAt, _tried: tried, _first: cands[0] ?? null });
  }
}));

const none = results.filter((r) => !r.card_image_url);
const fallback = results.filter((r) => r.card_image_url && r.card_image_url !== r._first);
console.log(`[curated-images] ${results.length} curated rows — first image OK: ${results.length - none.length - fallback.length}, `
  + `fixed with a later image: ${fallback.length}, no working image (hidden): ${none.length}`);
for (const r of fallback) console.log(`  fixed   ${r.category_slug.padEnd(14)} ${r.supplier_product_code}`);
for (const r of none) console.log(`  hidden  ${r.category_slug.padEnd(14)} ${r.supplier_product_code}`);

if (!DRY) {
  const body = results.map(({ _tried, _first, ...r }) => r);
  for (let i = 0; i < body.length; i += 200) {
    await rest('POST', 'category_product_curation?on_conflict=id', body.slice(i, i + 200), { Prefer: 'resolution=merge-duplicates,return=minimal' });
  }
  console.log(`[curated-images] wrote ${body.length} rows (checked_at ${checkedAt})`);
}
