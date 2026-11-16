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
//   dist/products/<CODE>/index.html   curated supplier products (no prices)
//   dist/sitemap.xml, dist/llms.txt
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
import { BUSINESS } from '../src/config/business.js';

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

// Category "About" copy: paragraphs separated by a blank line (§66.6).
const introParagraphs = (c) =>
  String(c.intro ?? '')
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);

// Contact details exactly as the site footer shows them (src/config/business.js).
const organizationLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE_NAME,
  url: `${SITE_URL}/`,
  telephone: `+44 ${BUSINESS.phone.replace(/^0/, '')}`,
  email: BUSINESS.email,
  address: {
    '@type': 'PostalAddress',
    streetAddress: BUSINESS.tradingAddress.slice(0, 2).join(', '),
    addressLocality: BUSINESS.tradingAddress[2],
    addressRegion: BUSINESS.tradingAddress[3],
    postalCode: BUSINESS.tradingAddress[4],
    addressCountry: 'GB',
  },
});

// ---------------------------------------------------------------- home
export function buildHomePage(template, categories) {
  const head = headTags({
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    url: `${SITE_URL}/`,
    jsonLd: [
      organizationLd(),
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
export function buildCategoryPage(template, c, products, supplierItems = []) {
  const url = `${SITE_URL}/${c.slug}`;
  const title = c.meta_title || `${c.name} | ${SITE_NAME}`;
  const description = c.meta_description || summarise(c.description || c.name);
  const items = [
    ...products.map((p) => [p.name, `${SITE_URL}/${c.slug}/${p.slug}`]),
    ...supplierItems.map((s) => [s.name, `${SITE_URL}${supplierPath(s.supplier_product_code)}`]),
  ];
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
  // Every card on the live page links to its product (in-house first, then
  // the curated supplier products in curation order, as the page shows them).
  const list = [
    ...products.map((p) => [`/${c.slug}/${p.slug}`, p.name]),
    ...supplierItems.map((s) => [supplierPath(s.supplier_product_code), s.name]),
  ]
    .map(([href, name]) => `<li><a href="${escapeHtml(href)}" class="text-gray-700">${escapeHtml(name)}</a></li>`)
    .join('');
  const intro = introParagraphs(c);
  const body = [
    `<main data-prerendered="category" class="${WRAP}">`,
    `<nav aria-label="Breadcrumb" class="text-gray-600"><a href="/">Home</a> › ${escapeHtml(c.name)}</nav>`,
    `<h1 class="text-4xl font-bold text-gray-900 mb-2">${escapeHtml(c.name)}</h1>`,
    c.description ? `<p class="text-lg text-gray-600">${escapeHtml(c.description)}</p>` : '',
    list ? `<ul>${list}</ul>` : '',
    intro.length
      ? `<section><h2 class="text-2xl font-bold text-gray-900 mb-4">${escapeHtml(c.intro_heading || `About our ${c.name.toLowerCase()}`)}</h2>${intro
          .map((t) => `<p class="text-gray-700 leading-relaxed mb-4">${escapeHtml(t)}</p>`)
          .join('')}</section>`
      : '',
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

// ---------------------------------------------- supplier (curated) product
// /products/<CODE> — the same fields LaltexProductView shows (name,
// category line, description, material, dimensions, country of origin,
// minimum order, lead time, express note). No prices: the page prices with
// margin + delivery + print at view time, so a build-time figure would be
// wrong. Never name the supplier (§65.6). Colours are left out (the page
// derives them from item rows, not from available_colours).
export const supplierPath = (code) => `/products/${encodeURIComponent(code)}`;

export function buildSupplierPage(template, s) {
  const url = `${SITE_URL}${supplierPath(s.supplier_product_code)}`;
  const text = s.description || s.web_description || '';
  const title = `${s.name} | ${SITE_NAME}`;
  const description = summarise(text || s.name);
  // Our own nightly WebP thumbnail only (§65.8). card_image_url points at
  // the supplier's image host, which would name the supplier (§65.6).
  const image = s.card_thumb_url || null;
  const categoryLine = [s.category, s.sub_category].filter(Boolean).join(' › ');
  const facts = [
    ['Material', s.material],
    ['Dimensions', s.product_dims],
    ['Country of origin', s.country_of_origin],
    ['Minimum order', s.minimum_order_qty != null ? `${qty(s.minimum_order_qty)} units` : null],
  ].filter(([, v]) => v != null && String(v).trim() !== '');
  const leadTime = s.lead_time_days != null
    ? `Standard lead time: ${s.lead_time_days} working days from artwork approval.`
    : null;

  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: s.name,
    url,
    sku: s.supplier_product_code,
    ...(text ? { description: text } : {}),
    ...(s.sub_category || s.category ? { category: s.sub_category || s.category } : {}),
    ...(image ? { image: [image] } : {}),
    ...(facts.length || leadTime
      ? {
          additionalProperty: [
            ...facts.map(([name, value]) => ({ '@type': 'PropertyValue', name, value: String(value) })),
            ...(s.lead_time_days != null
              ? [{ '@type': 'PropertyValue', name: 'Lead time', value: `${s.lead_time_days} working days from artwork approval` }]
              : []),
          ],
        }
      : {}),
  };

  const head = headTags({ title, description, url, type: 'product', image, jsonLd: [product] });
  const body = [
    `<main data-prerendered="supplier-product" class="${WRAP}">`,
    `<h1 class="text-3xl font-extrabold text-gray-900">${escapeHtml(s.name)}</h1>`,
    categoryLine ? `<p class="text-gray-600">${escapeHtml(categoryLine)}</p>` : '',
    text ? `<p class="text-gray-700 leading-relaxed">${escapeHtml(text)}</p>` : '',
    image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(s.name)}" class="max-h-[520px]" />` : '',
    facts.length ? `<dl>${facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>` : '',
    leadTime ? `<p>${escapeHtml(leadTime)}</p>` : '',
    s.express_available ? `<p>Express turnaround available</p>` : '',
    `</main>`,
  ]
    .filter(Boolean)
    .join('');
  return render(template, head, body);
}

// ----------------------------------------------------------- llms.txt
// A plain index of the main pages for AI tools (llmstxt.org format).
// Low expectations — few crawlers fetch it — but it is cheap (§66.7).
export function buildLlmsTxt({ categories, products }) {
  const lines = [
    `# ${SITE_NAME}`,
    '',
    `> ${HOME_DESCRIPTION}`,
    '',
    `${SITE_NAME} is a UK supplier of corporate and promotional gifts, printed with your logo. Prices on the site exclude VAT. Contact: ${BUSINESS.phone}, ${BUSINESS.email}.`,
    '',
    '## Categories',
    '',
    ...categories.map((c) => `- [${c.name}](${SITE_URL}/${c.slug}): ${c.meta_description || c.description || c.name}`),
    '',
    '## Our own products',
    '',
    ...products.map((p) => `- [${p.name}](${SITE_URL}/${p.category.slug}/${p.slug}): ${p.meta_description || summarise(p.description || p.subtitle || p.name)}`),
    '',
    '## Information',
    '',
    `- [Terms of sale](${SITE_URL}/terms)`,
    `- [Privacy policy](${SITE_URL}/privacy)`,
    `- [Sitemap](${SITE_URL}/sitemap.xml)`,
    '',
  ];
  return lines.join('\n');
}

// ------------------------------------------------------------ sitemap
export function buildSitemap({ categories, products, supplierProducts = [] }) {
  const entry = (loc, lastmod) =>
    `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}</url>`;
  const lines = [
    entry(`${SITE_URL}/`),
    ...categories.map((c) => entry(`${SITE_URL}/${c.slug}`, c.updated_at)),
    ...products.map((p) => entry(`${SITE_URL}/${p.category.slug}/${p.slug}`, p.updated_at)),
    ...supplierProducts.map((s) => entry(`${SITE_URL}${supplierPath(s.supplier_product_code)}`, s.updated_at)),
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
      // select=* so optional columns (intro, intro_heading) never break the read.
      fetchRows(base, key, 'catalog_categories', 'select=*&is_active=eq.true&order=sort_order.asc'),
    ]);
  } catch (err) {
    console.warn(`[prerender] WARNING: could not read the catalogue (${err.message}) — static pages skipped. The site works, but pages are NOT crawler-readable in this build.`);
    return;
  }

  // Curated supplier products (category pages + /products/<CODE>). Soft:
  // on failure the in-house, category and home pages are still written.
  let curated = [];
  try {
    curated = await fetchCuratedSupplierProducts(base, key);
  } catch (err) {
    console.warn(`[prerender] WARNING: could not read curated supplier products (${err.message}) — /products/<code> pages skipped.`);
  }
  const supplierByCode = new Map();
  for (const s of curated) if (!supplierByCode.has(s.supplier_product_code)) supplierByCode.set(s.supplier_product_code, s);
  const supplierProducts = [...supplierByCode.values()];

  products = products.filter((p) => p.slug && p.category?.slug);
  for (const p of products) await writePage(path.join(p.category.slug, p.slug), buildProductPage(template, p));
  for (const s of supplierProducts) {
    await writePage(path.join('products', s.supplier_product_code), buildSupplierPage(template, s));
  }
  for (const c of categories) {
    // Cards the live page hides (image checked and none works, §65.7) are left out.
    const cards = curated.filter((s) => s.category_slug === c.slug && !(s.card_image_checked_at && !s.card_image_url));
    await writePage(c.slug, buildCategoryPage(template, c, products.filter((p) => p.category.slug === c.slug), cards));
  }
  await fs.writeFile(path.join(DIST, 'index.html'), buildHomePage(template, categories));
  await fs.writeFile(path.join(DIST, 'sitemap.xml'), buildSitemap({ categories, products, supplierProducts }));
  await fs.writeFile(path.join(DIST, 'llms.txt'), buildLlmsTxt({ categories, products }));

  const branded = products.filter((p) => p.brand).length;
  console.log(`[prerender] wrote home, ${categories.length} category pages, ${products.length} product pages (${branded} with a brand), ${supplierProducts.length} supplier product pages, sitemap.xml and llms.txt.`);
}

// category_product_curation (position order) joined in JS to the live,
// non-retired supplier_products rows. Paged: PostgREST caps responses at
// 1000 rows (§28.1); supplier rows are fetched 100 codes at a time.
const SUPPLIER_COLUMNS = [
  'supplier_product_code', 'name', 'description', 'web_description', 'category', 'sub_category',
  'material', 'product_dims', 'country_of_origin', 'minimum_order_qty', 'lead_time_days',
  'express_available', 'updated_at',
].join(',');

async function fetchCuratedSupplierProducts(base, key) {
  const curation = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await fetchRows(
      base, key, 'category_product_curation',
      `select=category_slug,supplier_product_code,position,card_image_url,card_thumb_url,card_image_checked_at&order=category_slug.asc,position.asc&limit=1000&offset=${offset}`,
    );
    curation.push(...page);
    if (page.length < 1000) break;
  }
  const codes = [...new Set(curation.map((r) => r.supplier_product_code))];
  const rows = new Map();
  for (let i = 0; i < codes.length; i += 100) {
    const list = codes.slice(i, i + 100).map((c) => `"${String(c).replace(/"/g, '')}"`).join(',');
    const page = await fetchRows(
      base, key, 'supplier_products',
      `select=${SUPPLIER_COLUMNS}&is_retired=is.false&supplier_product_code=in.(${encodeURIComponent(list)})`,
    );
    for (const r of page) rows.set(r.supplier_product_code, r);
  }
  // Same rule as getCuratedCategoryProducts: retired / missing codes drop out.
  return curation
    .filter((c) => rows.has(c.supplier_product_code))
    .map((c) => ({ ...rows.get(c.supplier_product_code), ...c }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
