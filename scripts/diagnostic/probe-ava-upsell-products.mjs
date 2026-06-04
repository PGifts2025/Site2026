// Read-only diagnostic for the AVA Direct-product upsell context build.
// Pulls catalog_products + pricing tiers + features for the 11 express-delivery
// PGifts Direct products so we can draft ava_direct_product_context rows from
// verbatim source data (never fabricated).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.resolve(dir, '../../.env'), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.+)$', 'm')) || [])[1].trim();
const BASE = g('VITE_SUPABASE_URL');
const KEY = g('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

const slugs = [
  't-shirts', 'polo', 'hoodie', 'sweatshirts',
  'octopus-mini', 'ocean-octopus', 'mr-bio', 'mr-bio-pd-long',
  'ice-p', 'luggie', 'gamma-lite',
];

const j = async (url) => (await fetch(BASE + url, { headers: H })).json();
const arr = async (url) => { const r = await j(url); return Array.isArray(r) ? r : []; };

for (const slug of slugs) {
  const prod = (await j(`/rest/v1/catalog_products?slug=eq.${slug}&select=*`))[0];
  console.log('\n========================================');
  if (!prod) { console.log(slug, 'NOT FOUND in catalog_products'); continue; }
  console.log('SLUG:', slug, '| id:', prod.id);
  console.log('name        :', JSON.stringify(prod.name));
  console.log('subtitle    :', JSON.stringify(prod.subtitle));
  console.log('description :', JSON.stringify(prod.description));
  console.log('web_descr.  :', JSON.stringify(prod.web_description));
  console.log('category_id :', JSON.stringify(prod.category_id));
  console.log('pricing_model:', JSON.stringify(prod.pricing_model));
  console.log('min_order_qty:', JSON.stringify(prod.min_order_quantity));
  console.log('is_featured :', JSON.stringify(prod.is_featured));

  const tiers = await j(`/rest/v1/catalog_pricing_tiers?product_id=eq.${prod.id}&select=*&order=min_quantity.asc`);
  if (tiers.length) {
    console.log('pricing_tiers (' + tiers.length + '):');
    for (const t of tiers) {
      console.log('   ', JSON.stringify({ min: t.min_quantity, max: t.max_quantity, ...Object.fromEntries(Object.entries(t).filter(([k]) => /price|cost/i.test(k))) }));
    }
  } else {
    console.log('pricing_tiers: NONE (clothing → catalog_print_pricing shared matrix, see §6)');
  }

  // features FK column name discovered below; try both common shapes
  let feats = await arr(`/rest/v1/catalog_product_features?product_id=eq.${prod.id}&select=*`);
  console.log('features    :', JSON.stringify(feats.map((f) => f.feature_text ?? f.feature ?? f.text ?? f)));
}
console.log('\n========================================\nDONE');
