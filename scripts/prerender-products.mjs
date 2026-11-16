#!/usr/bin/env node
// =====================================================================
// Post-build: crawler-readable static HTML for the home page, every
// active category page and every active in-house product, plus
// sitemap.xml. (CLAUDE.md §66)
//
// Why: the site is a single-page app. Every URL used to return the same
// near-empty index.html ("Promo Gifts", no description, empty #root),
// and the headings/text only appeared after JavaScript ran. Google
// renders JavaScript; most AI search crawlers do not.
//
// Output (all from the Vite-built dist/index.html template):
//   dist/app.html                     plain app shell — the SPA fallback
//                                     (vercel.json rewrites every other
//                                     path here). ALWAYS written first;
//                                     if it cannot be written the build
//                                     FAILS so Vercel keeps the old deploy.
//   dist/index.html                   home page: title, description, H1
//   dist/<category>/index.html        category pages
//   dist/<category>/<slug>/index.html product pages (Product JSON-LD)
//   dist/sitemap.xml
//
// Static #root content is a SUBSET of what the React page shows, never
// extra text (that would be cloaking). createRoot() replaces it as soon
// as the app boots. It uses Tailwind classes the app already uses so the
// moment before the app starts looks tidy, not like raw HTML.
//
// Data: public anon key, same reads as the browser (VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY, set on Vercel for the Vite build).
// Everything after app.html fails SOFT: Supabase down → warning in the
// build log, pages fall back to the plain shell, site works as before.
// =====================================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { HOME_TITLE, HOME_H1, HOME_DESCRIPTION, SITE_NAME, SITE_URL } from '../src/config/seo.js';
import { orderedSpecEntries } from '../src/utils/specOrder.js';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TITLE_TAG = '<title>Promo Gifts</title>';
const ROOT_TAG = '<div id="root"></div>';
const WRAP = 'max-w-7xl mx-auto px-4 py-6';

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

// Meta description fallback: cut at a word boundary under 155 characters.
export const summarise = (text, max = 155) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
};

// Specifications tab as ordered [label, value] pairs. The embed is
// one-to-one (unique catalog_product_id) so PostgREST may return an
// object or a one-item array.
const specEntries = (p) => {
  const row = Array.isArray(p.specifications) ? p.specifications[0] : p.specifications;
  return orderedSpecEntries(row?.specifications).filter(
    ([k, v]) => k && v != null && String(v).trim() !== '',
  );
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

// <head> block replacing the template's <title>.
function headTags({ title, description, url, type = 'website', image, jsonLd = [] }) {
  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    ...(image ? [`<meta property="og:image" content="${escapeHtml(image)}" />`] : []),
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    ...jsonLd.map((o) => `<script type="application/ld+json">${jsonForScript(o)}</script>`),
  ].join('\n    ');
}

const render = (template, head, body) =>
  template.replace(TITLE_TAG, head).replace(ROOT_TAG, `<div id="root">${body}</div>`);

const breadcrumbLd = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
});

// ---------------------------------------------------------------- home
export function buildHomePage(template, categories) {
  const head = headTags({
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    url: `${SITE_URL}/`,
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'Organization', name: SITE_NAME, url: `${SITE_URL}/` },
      { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: `${SITE_URL}/` },
    ],
  });
  // The header's category bar is on the live home page, so these links are not extra content.
  const links = categories
    .map((c) => `<li><a href="/${c.slug}" class="text-gray-700">${escapeHtml(c.name)}</a></li>`)
    .join('');
  const body = [
    `<main data-prerendered="home" class="${WRAP}">`,
    `<h1 class="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 text-center mb-4">${escapeHtml(HOME_H1)}</h1>`,
    links ? `<nav aria-label="Product categories"><ul class="flex flex-wrap justify-center gap-4">${links}</ul></nav>` : '',
    `</main>`,
  ].join('');
  return render(template, head, body);
}

// ----------------------------------------------------------- category
export function buildCategoryPage(template, c, products) {
  const url = `${SITE_URL}/${c.slug}`;
  const title = c.meta_title || `${c.name} | ${SITE_NAME}`;
  const description = c.meta_description || summarise(c.description || c.name);
  const items = products.map((p) => [p.name, `${SITE_URL}/${c.slug}/${p.slug}`]);
  const head = headTags({
    title,
    description,
    url,
    jsonLd: [
      breadcrumbLd([['Home', `${SITE_URL}/`], [c.name, url]]),
      ...(items.length
        ? [{
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            name: c.name,
            itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, url: item })),
          }]
        : []),
    ],
  });
  const list = products
    .map((p) => `<li><a href="/${c.slug}/${p.slug}" class="text-gray-700">${escapeHtml(p.name)}</a></li>`)
    .join('');
  const body = [
    `<main data-prerendered="category" class="${WRAP}">`,
    `<nav aria-label="Breadcrumb" class="text-gray-600"><a href="/">Home</a> › ${escapeHtml(c.name)}</nav>`,
    `<h1 class="text-4xl font-bold text-gray-900 mb-2">${escapeHtml(c.name)}</h1>`,
    c.description ? `<p class="text-lg text-gray-600">${escapeHtml(c.description)}</p>` : '',
    list ? `<ul>${list}</ul>` : '',
    `</main>`,
  ].join('');
  return render(template, head, body);
}

// ------------------------------------------------------------ product
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
    .filter(([k]) => k.toLowerCase() !== 'brand') // published as Product.brand
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

  const head = headTags({
    title,
    description,
    url,
    type: 'product',
    image: img?.image_url,
    jsonLd: [product, breadcrumbLd([['Home', `${SITE_URL}/`], [cat.name, `${SITE_URL}/${cat.slug}`], [p.name, url]])],
  });

  const tierItems = tiers
    .map((t) => {
      const range = t.max_quantity ? `${qty(t.min_quantity)}–${qty(t.max_quantity)}` : `${qty(t.min_quantity)}+`;
      return `<li>${range} units: ${money(t.price_per_unit)} each (ex VAT)</li>`;
    })
    .join('');

  const body = [
    `<main data-prerendered="product" class="${WRAP}">`,
    `<nav aria-label="Breadcrumb" class="text-gray-600"><a href="/">Home</a> › <a href="/${cat.slug}">${escapeHtml(cat.name)}</a> › ${escapeHtml(p.name)}</nav>`,
    `<h1 class="text-2xl lg:text-4xl font-bold text-gray-900 mb-2">${escapeHtml(p.name)}</h1>`,
    p.subtitle ? `<p class="text-xl font-semibold text-gray-800 mb-4">${escapeHtml(p.subtitle)}</p>` : '',
    p.description ? `<p class="text-gray-700 leading-relaxed">${escapeHtml(p.description)}</p>` : '',
    img ? `<img src="${escapeHtml(img.image_url)}" alt="${escapeHtml(img.alt_text || p.name)}" class="max-h-[520px]" />` : '',
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

  return render(template, head, body);
}

// ------------------------------------------------------------ sitemap
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

async function writePage(relDir, html) {
  const dir = path.join(DIST, relDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), html);
}

async function main() {
  // 1. The SPA fallback. MUST exist — vercel.json rewrites to it.
  //    Any failure here throws → non-zero exit → build fails → Vercel
  //    keeps serving the previous deployment.
  let template = await fs.readFile(path.join(DIST, 'index.html'), 'utf8');
  if (!template.includes(TITLE_TAG)) {
    // Re-run on an already-processed dist/: index.html is now the home
    // page, so the pristine shell is the app.html from the first run.
    const previous = await fs.readFile(path.join(DIST, 'app.html'), 'utf8').catch(() => '');
    if (previous.includes(TITLE_TAG)) template = previous;
  }
  await fs.writeFile(path.join(DIST, 'app.html'), template);
  console.log('[prerender] wrote app.html (SPA fallback)');

  // 2. Everything else fails soft.
  const base = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !key) {
    console.warn('[prerender] WARNING: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing — static pages skipped. The site works, but pages are NOT crawler-readable in this build.');
    return;
  }
  if (!template.includes(TITLE_TAG) || !template.includes(ROOT_TAG)) {
    console.warn(`[prerender] WARNING: dist/index.html no longer contains ${TITLE_TAG} and ${ROOT_TAG} — static pages skipped. Update scripts/prerender-products.mjs.`);
    return;
  }

  let products;
  let categories;
  try {
    [products, categories] = await Promise.all([
      fetchRows(base, key, 'catalog_products', `select=${encodeURIComponent(PRODUCT_SELECT)}&status=eq.active&order=slug.asc`),
      fetchRows(base, key, 'catalog_categories', 'select=slug,name,description,meta_title,meta_description,updated_at&is_active=eq.true&order=sort_order.asc'),
    ]);
  } catch (err) {
    console.warn(`[prerender] WARNING: could not read the catalogue (${err.message}) — static pages skipped. The site works, but pages are NOT crawler-readable in this build.`);
    return;
  }

  products = products.filter((p) => p.slug && p.category?.slug);
  for (const p of products) await writePage(path.join(p.category.slug, p.slug), buildProductPage(template, p));
  for (const c of categories) {
    await writePage(c.slug, buildCategoryPage(template, c, products.filter((p) => p.category.slug === c.slug)));
  }
  await fs.writeFile(path.join(DIST, 'index.html'), buildHomePage(template, categories));
  await fs.writeFile(path.join(DIST, 'sitemap.xml'), buildSitemap({ categories, products }));

  const branded = products.filter((p) => p.brand).length;
  console.log(`[prerender] wrote home, ${categories.length} category pages, ${products.length} product pages (${branded} with a brand) and sitemap.xml.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
