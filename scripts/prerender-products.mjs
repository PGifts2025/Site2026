#!/usr/bin/env node
// =====================================================================
// Post-build: static, crawler-readable HTML for every active in-house
// product, plus sitemap.xml. (CLAUDE.md §66)
//
// Why: the site is a single-page app. Every URL used to return the same
// near-empty index.html ("Promo Gifts", no description, empty #root),
// and the product heading/text only appeared after JavaScript ran.
// Google renders JavaScript; most AI search crawlers do not. This step
// writes dist/<category>/<slug>/index.html for each active
// catalog_products row, with:
//   - <title>, meta description, canonical, Open Graph tags
//   - schema.org Product + BreadcrumbList JSON-LD (brand when set)
//   - a plain-HTML copy of what the product page shows (name, subtitle,
//     description, image, features, specifications, price tiers) inside #root
//
// The static #root content is a SUBSET of what the React page renders,
// never extra text: createRoot() replaces it as soon as the app boots,
// so shoppers see the normal page and crawlers see the same words.
//
// Data: read with the public anon key, exactly as the browser does
// (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — already set on Vercel
// for the Vite build). Runs after `vite build` (see package.json).
//
// Fails SOFT: if Supabase is unreachable the build still succeeds and
// the site behaves exactly as before (plain index.html everywhere), with
// a loud warning in the build log. A Supabase blip must never block a
// deploy.
// =====================================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const SITE_URL = 'https://promo-gifts-co.uk'; // canonical host (CLAUDE.md §21.5)
const SITE_NAME = 'Promo Gifts';
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TITLE_TAG = '<title>Promo Gifts</title>';
const ROOT_TAG = '<div id="root"></div>';

// Tier prices are what the product page charges only for tier-priced
// products (CLAUDE.md §16.10). Clothing uses the print matrix and bags
// the bag build-up model, so their tier rows are not the page price —
// publish no price for them rather than a wrong one.
const hasTierPagePrice = (p) =>
  p.pricing_model !== 'clothing' && p.category?.slug !== 'bags';

const PRODUCT_SELECT = [
  '*',
  'category:catalog_categories(name,slug)',
  'images:catalog_product_images(image_url,alt_text,image_type,sort_order,is_primary)',
  'pricing:catalog_pricing_tiers(min_quantity,max_quantity,price_per_unit)',
  'features:catalog_product_features(feature_text,sort_order)',
  'specifications:catalog_product_specifications(specifications)',
].join(',');

// Specifications tab content as [label, value] pairs. The embed is
// one-to-one (unique catalog_product_id) so PostgREST may return an
// object or a one-item array. "Brand" is published as Product.brand.
const specEntries = (p) => {
  const row = Array.isArray(p.specifications) ? p.specifications[0] : p.specifications;
  const specs = row?.specifications;
  if (!specs || typeof specs !== 'object') return [];
  return Object.entries(specs).filter(([k, v]) => k && v != null && String(v).trim() !== '');
};

export const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// JSON inside <script> must not be able to close the tag.
const jsonForScript = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

const money = (n) => `£${Number(n).toFixed(2)}`;
const qty = (n) => Number(n).toLocaleString('en-GB'); // 1,000 — same style as Ava (§65.3)

// Meta description fallback: first sentence(s) of the description,
// cut at a word boundary under 155 characters.
export const summarise = (text, max = 155) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
};

const realTiers = (p) =>
  (p.pricing || [])
    .filter((t) => Number(t.price_per_unit) > 0.01) // £0.01 = unfilled placeholder (§13)
    .sort((a, b) => a.min_quantity - b.min_quantity);

const primaryImage = (p) => {
  const imgs = [...(p.images || [])].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  return imgs.find((i) => i.image_url) || null;
};

export function buildProductPage(template, p) {
  const cat = p.category;
  const url = `${SITE_URL}/${cat.slug}/${p.slug}`;
  const title = p.meta_title || `${p.name} | ${SITE_NAME}`;
  const description = p.meta_description || summarise(p.description || p.subtitle || p.name);
  const img = primaryImage(p);
  const tiers = hasTierPagePrice(p) ? realTiers(p) : [];
  const moq = tiers.length ? tiers[0].min_quantity : p.min_order_quantity;
  const features = [...(p.features || [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((f) => f.feature_text)
    .filter(Boolean);
  const specs = specEntries(p);
  const properties = specs
    .filter(([k]) => k.toLowerCase() !== 'brand')
    .map(([name, value]) => ({ '@type': 'PropertyValue', name, value: String(value) }));

  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    url,
    sku: p.slug,
    description: p.description || description,
    category: cat.name,
    ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
    ...(img ? { image: [img.image_url] } : {}),
    ...(properties.length ? { additionalProperty: properties } : {}),
    ...(tiers.length
      ? {
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'GBP',
            lowPrice: Math.min(...tiers.map((t) => Number(t.price_per_unit))).toFixed(2),
            highPrice: Math.max(...tiers.map((t) => Number(t.price_per_unit))).toFixed(2),
            offerCount: tiers.length,
            url,
            eligibleQuantity: { '@type': 'QuantitativeValue', minValue: moq, unitText: 'units' },
            seller: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
          },
        }
      : {}),
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: cat.name, item: `${SITE_URL}/${cat.slug}` },
      { '@type': 'ListItem', position: 3, name: p.name, item: url },
    ],
  };

  const head = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="product" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    ...(img ? [`<meta property="og:image" content="${escapeHtml(img.image_url)}" />`] : []),
    `<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}" />`,
    `<script type="application/ld+json">${jsonForScript(product)}</script>`,
    `<script type="application/ld+json">${jsonForScript(breadcrumb)}</script>`,
  ].join('\n    ');

  const tierItems = tiers
    .map((t) => {
      const range = t.max_quantity ? `${qty(t.min_quantity)}–${qty(t.max_quantity)}` : `${qty(t.min_quantity)}+`;
      return `<li>${range} units: ${money(t.price_per_unit)} each (ex VAT)</li>`;
    })
    .join('');

  const body = [
    `<main data-prerendered="product">`,
    `<nav aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/${cat.slug}">${escapeHtml(cat.name)}</a> › ${escapeHtml(p.name)}</nav>`,
    `<h1>${escapeHtml(p.name)}</h1>`,
    p.subtitle ? `<p>${escapeHtml(p.subtitle)}</p>` : '',
    p.description ? `<p>${escapeHtml(p.description)}</p>` : '',
    img ? `<img src="${escapeHtml(img.image_url)}" alt="${escapeHtml(img.alt_text || p.name)}" />` : '',
    features.length ? `<h2>Features</h2><ul>${features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : '',
    specs.length
      ? `<h2>Specifications</h2><dl>${specs.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`
      : '',
    tierItems ? `<h2>Pricing</h2><ul>${tierItems}</ul>` : '',
    moq ? `<p>Minimum order: ${qty(moq)} units.</p>` : '',
    `</main>`,
  ]
    .filter(Boolean)
    .join('');

  return template
    .replace(TITLE_TAG, head)
    .replace(ROOT_TAG, `<div id="root">${body}</div>`);
}

export function buildSitemap({ categories, products }) {
  const entry = (loc, lastmod) =>
    `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}</url>`;
  const lines = [
    entry(`${SITE_URL}/`),
    ...categories.map((c) => entry(`${SITE_URL}/${c.slug}`, c.updated_at)),
    ...products.map((p) => entry(`${SITE_URL}/${p.category.slug}/${p.slug}`, p.updated_at)),
    entry(`${SITE_URL}/privacy`),
    entry(`${SITE_URL}/terms`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join('\n')}\n</urlset>\n`;
}

async function fetchRows(base, key, table, query) {
  const res = await fetch(`${base}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const base = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !key) {
    console.warn('[prerender] WARNING: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing — skipped. Product pages will NOT be crawler-readable in this build.');
    return;
  }

  let template;
  try {
    template = await fs.readFile(path.join(DIST, 'index.html'), 'utf8');
  } catch {
    console.warn('[prerender] WARNING: dist/index.html not found — run after `vite build`. Skipped.');
    return;
  }
  if (!template.includes(TITLE_TAG) || !template.includes(ROOT_TAG)) {
    console.warn(`[prerender] WARNING: dist/index.html no longer contains ${TITLE_TAG} and ${ROOT_TAG} — skipped. Update scripts/prerender-products.mjs.`);
    return;
  }

  let products;
  let categories;
  try {
    [products, categories] = await Promise.all([
      fetchRows(base, key, 'catalog_products', `select=${encodeURIComponent(PRODUCT_SELECT)}&status=eq.active&order=slug.asc`),
      fetchRows(base, key, 'catalog_categories', 'select=slug,name,updated_at&is_active=eq.true&order=sort_order.asc'),
    ]);
  } catch (err) {
    console.warn(`[prerender] WARNING: could not read the catalogue (${err.message}) — skipped. Product pages will NOT be crawler-readable in this build.`);
    return;
  }

  products = products.filter((p) => p.slug && p.category?.slug);
  for (const p of products) {
    const dir = path.join(DIST, p.category.slug, p.slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), buildProductPage(template, p));
  }
  await fs.writeFile(path.join(DIST, 'sitemap.xml'), buildSitemap({ categories, products }));

  const branded = products.filter((p) => p.brand).length;
  console.log(`[prerender] wrote ${products.length} product pages (${branded} with a brand) and sitemap.xml (${categories.length} categories).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
