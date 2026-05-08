#!/usr/bin/env node
/**
 * migrate-catalog-to-supplier-products.js — session 4a shaping script.
 *
 * Mirrors the 25 active catalog_products rows (plus their pricing tiers,
 * print-pricing matrix, colours, images, features, specs, and designer-
 * template link) into supplier_products under the 'pgifts-direct'
 * supplier.
 *
 * Strategy: MIRROR, not MOVE. catalog_products stays in place — the
 * Designer and ProductDetailPage continue to read from there. This
 * script produces equivalent supplier_products rows that the AI search
 * layer (session 4b+) can query alongside Laltex.
 *
 * Usage:
 *   node scripts/migrate-catalog-to-supplier-products.js           # live
 *   node scripts/migrate-catalog-to-supplier-products.js --dry-run # no writes
 *
 * Idempotent: UPSERT on (supplier_id, supplier_product_code), safe to
 * re-run at any time. Does NOT write embedding / embedding_source_hash /
 * embedded_at — tomorrow's 04:00 UTC embed cron picks up the new rows.
 *
 * Env required in site/.env:
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// ---------------------------------------------------------------------------
// Category mapping (approved 2026-04-24 by Dave — session 4a checkpoint)
// ---------------------------------------------------------------------------
//
// Dave's overrides vs. the initial proposal:
//   - hi-vis-vest: Safety Wear > Hi-Vis Vests  (was Clothing > ...)
//     Rationale: PPE clusters distinctly from apparel in semantic search;
//     future Laltex safety products will land in this bucket too.
//   - tea-towel: Homeware > Tea Towels  (confirmed from 4 alternatives)
//
// Everything else aligned to Laltex's Category > SubCategory conventions
// so a single search pool spans both suppliers coherently.

const CATEGORY_MAPPING = {
  '5oz-cotton-bag':          { category: 'Bags',       sub_category: 'Cotton Bags' },
  '5oz-recycled-cotton-bag': { category: 'Bags',       sub_category: 'Recycled Cotton Bags' },
  '5oz-mini-cotton-bag':     { category: 'Bags',       sub_category: 'Mini Cotton Bags' },
  '8oz-canvas':              { category: 'Bags',       sub_category: 'Canvas Bags' },
  '12oz-recycled-canvas':    { category: 'Bags',       sub_category: 'Recycled Canvas Bags' },
  'a5-notebook':             { category: 'Notebooks',  sub_category: 'A5 Notebooks' },
  'a6-pocket-notebook':      { category: 'Notebooks',  sub_category: 'A6 Pocket Notebooks' },
  'chi-cup':                 { category: 'Drinkware',  sub_category: 'Coffee Cups' },
  'water-bottle':            { category: 'Drinkware',  sub_category: 'Water Bottles' },
  'edge-classic':            { category: 'Writing',    sub_category: 'Plastic Pens' },
  'edge-silver':             { category: 'Writing',    sub_category: 'Plastic Pens' },
  'edge-white':              { category: 'Writing',    sub_category: 'Plastic Pens' },
  'gamma-lite':              { category: 'Power',      sub_category: 'Power Banks' },
  'ice-p':                   { category: 'Power',      sub_category: 'Power Banks' },
  'luggie':                  { category: 'Power',      sub_category: 'Power Banks' },
  'mr-bio':                  { category: 'Cables',     sub_category: 'Charging Cables' },
  'mr-bio-pd-long':          { category: 'Cables',     sub_category: 'Charging Cables' },
  'ocean-octopus':           { category: 'Cables',     sub_category: 'Charging Cables' },
  'octopus-mini':            { category: 'Cables',     sub_category: 'Charging Cables' },
  'polo':                    { category: 'Clothing',   sub_category: 'Polos' },
  'hoodie':                  { category: 'Clothing',   sub_category: 'Hoodies' },
  'sweatshirts':             { category: 'Clothing',   sub_category: 'Sweatshirts' },
  't-shirts':                { category: 'Clothing',   sub_category: 'T-Shirts' },
  'hi-vis-vest':             { category: 'Safety Wear', sub_category: 'Hi-Vis Vests' },
  'tea-towel':               { category: 'Homeware',   sub_category: 'Tea Towels' },
};

const SUPPLIER_SLUG = 'pgifts-direct';
const SUPPLIER_DIVISION_LABEL = 'PGifts Direct';

// ---------------------------------------------------------------------------
// PostgREST helpers (same pattern as session 3a laltex-sync.js)
// ---------------------------------------------------------------------------

function ensureEnv(name, value) {
  if (!value || typeof value !== 'string') {
    throw new Error(`${name} is required in site/.env`);
  }
  return value;
}

function pgRestHeaders(serviceRoleKey, extra = {}) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
}

async function pgRest(method, url, serviceRoleKey, { body, extraHeaders } = {}) {
  const resp = await fetch(url, {
    method,
    headers: pgRestHeaders(serviceRoleKey, extraHeaders),
    body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`PostgREST ${method} ${url.split('?')[0]} -> ${resp.status}: ${text.slice(0, 500)}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Catalog-side reads
// ---------------------------------------------------------------------------

async function fetchSupplierId({ supabaseUrl, serviceRoleKey }) {
  const rows = await pgRest(
    'GET',
    `${supabaseUrl}/rest/v1/suppliers?slug=eq.${encodeURIComponent(SUPPLIER_SLUG)}&select=id`,
    serviceRoleKey,
  );
  if (!Array.isArray(rows) || !rows[0]?.id) {
    throw new Error(`suppliers row for slug='${SUPPLIER_SLUG}' not found — did the 4a supplier migration apply?`);
  }
  return rows[0].id;
}

async function fetchActiveCatalogProducts({ supabaseUrl, serviceRoleKey }) {
  return pgRest(
    'GET',
    `${supabaseUrl}/rest/v1/catalog_products?status=eq.active&select=*&order=slug.asc`,
    serviceRoleKey,
  );
}

async function fetchRelated({ supabaseUrl, serviceRoleKey }, table, productId, order) {
  const q = order ? `&order=${order}` : '';
  return pgRest(
    'GET',
    `${supabaseUrl}/rest/v1/${table}?catalog_product_id=eq.${productId}&select=*${q}`,
    serviceRoleKey,
  );
}

async function fetchProductTemplate({ supabaseUrl, serviceRoleKey }, templateId) {
  if (!templateId) return null;
  const rows = await pgRest(
    'GET',
    `${supabaseUrl}/rest/v1/product_templates?id=eq.${templateId}&select=*`,
    serviceRoleKey,
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

// ---------------------------------------------------------------------------
// Shape helpers — catalog_* → supplier_products JSONB
// ---------------------------------------------------------------------------

function shapeProductPricing(tiers) {
  if (!Array.isArray(tiers)) return [];
  return tiers
    .slice()
    .sort((a, b) => a.min_quantity - b.min_quantity)
    .map((t) => ({
      min_qty: t.min_quantity,
      max_qty: t.max_quantity, // already nullable; null = open-ended top tier
      price: t.price_per_unit != null ? Number(t.price_per_unit) : null,
      is_poa: false,
      note: t.is_popular ? 'popular' : null,
    }));
}

/**
 * Clothing-side shaping. catalog_print_pricing has NO position column —
 * it's a (qty × colour_count × colour_variant) matrix where `max_positions`
 * is always 1 and positions are chosen by the customer at quote time.
 *
 * We represent the whole matrix as ONE print_details entry with
 * PrintPosition='Customer Choice' and a PrintPrice array carrying every
 * matrix row. ColourVariant is added on the PrintPrice shape (PascalCase
 * to match Laltex's convention for other PrintPrice fields — Laltex
 * rows simply won't carry this field).
 */
function shapePrintDetails(printRows) {
  if (!Array.isArray(printRows) || printRows.length === 0) return [];
  const printPrice = printRows
    .slice()
    .sort((a, b) => {
      if (a.colour_variant !== b.colour_variant) return String(a.colour_variant ?? '').localeCompare(String(b.colour_variant ?? ''));
      if (a.colour_count !== b.colour_count) return a.colour_count - b.colour_count;
      return a.min_quantity - b.min_quantity;
    })
    .map((r) => ({
      NumColours: r.colour_count,
      NumPosition: 1,
      MinQuantity: r.min_quantity,
      MaxQuantity: r.max_quantity, // nullable
      Price: r.price_per_unit != null ? Number(r.price_per_unit) : null,
      ColourVariant: r.colour_variant, // 'white' | 'coloured'
    }));
  return [{
    PrintClass: 'CURATED',
    PrintType: 'Spot Print',
    PrintPosition: 'Customer Choice',
    PrintArea: null,
    MaxColours: '6',
    Notes: null,
    LeadTime: null,
    SetupCharge: null,
    RptSetupCharge: null,
    ExtraColourSetupCharge: null,
    DefaultPrintOption: true,
    PrintPrice: printPrice,
    PrintAreaCoordinates: [], // Designer owns coordinates separately (print_areas table)
  }];
}

function shapeItems(colors) {
  if (!Array.isArray(colors)) return [];
  return colors
    .filter((c) => c.is_active !== false)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((c) => ({
      ItemCode: null, // PGifts Direct doesn't have per-colour SKUs
      ItemDescription: null,
      ItemColour: c.color_name,
      ItemSize: null,
      ItemIndicator: null,
      PMS: null, // Laltex has this; we don't
      SeedType: null,
      ItemImages: c.swatch_image_url ? [c.swatch_image_url] : [],
      PlainImages: [],
      HexValue: c.hex_value ?? null, // bonus field — Laltex doesn't give hex
    }));
}

function shapeImages(imgs) {
  if (!Array.isArray(imgs)) return [];
  return imgs
    .slice()
    .sort((a, b) => {
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    })
    .map((i) => i.image_url)
    .filter(Boolean);
}

/**
 * Comma-separated list of colour names for the source-text recipe
 * (session 2's buildEmbeddingSourceText reads available_colours).
 */
function shapeAvailableColours(colors) {
  if (!Array.isArray(colors) || colors.length === 0) return null;
  return colors
    .filter((c) => c.is_active !== false)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((c) => c.color_name)
    .filter(Boolean)
    .join(', ') || null;
}

/**
 * Flatten feature rows into a short, embedding-friendly string that
 * can live in raw_payload and — for products where description is
 * thin — get pulled into the search text recipe later.
 */
function summariseFeatures(features) {
  if (!Array.isArray(features) || features.length === 0) return null;
  return features
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((f) => f.feature_text)
    .filter(Boolean)
    .join('. ') || null;
}

// ---------------------------------------------------------------------------
// One product → one supplier_products row
// ---------------------------------------------------------------------------

async function shapeOne(ctx, product, supplierId, warnings) {
  const [tiers, printRows, colors, images, features, specsRows, template] = await Promise.all([
    fetchRelated(ctx, 'catalog_pricing_tiers',           product.id, 'min_quantity.asc'),
    fetchRelated(ctx, 'catalog_print_pricing',           product.id, 'colour_variant.asc,colour_count.asc,min_quantity.asc'),
    fetchRelated(ctx, 'catalog_product_colors',          product.id, 'sort_order.asc'),
    fetchRelated(ctx, 'catalog_product_images',          product.id, 'sort_order.asc'),
    fetchRelated(ctx, 'catalog_product_features',        product.id, 'sort_order.asc'),
    fetchRelated(ctx, 'catalog_product_specifications',  product.id, null),
    fetchProductTemplate(ctx, product.designer_product_id),
  ]);

  const mapping = CATEGORY_MAPPING[product.slug];
  if (!mapping) {
    warnings.push(`no category mapping for slug: ${product.slug} — row skipped`);
    return null;
  }

  if (!tiers?.length) {
    warnings.push(`${product.slug}: no catalog_pricing_tiers rows — product_pricing will be empty`);
  }

  const specs = Array.isArray(specsRows) ? specsRows[0] ?? null : null;
  const description = product.description ?? null;
  const featuresSummary = summariseFeatures(features);

  const row = {
    supplier_id: supplierId,
    supplier_product_code: product.slug,
    name: product.name,
    title: product.name,
    description,
    web_description: description,
    keywords: featuresSummary, // features make a natural keyword source; Laltex has its own field, we don't
    available_colours: shapeAvailableColours(colors),
    product_dims: null,
    unit_weight: null,
    material: specs?.specifications?.material ?? null,
    country_of_origin: null,
    tariff_code: null,
    category: mapping.category,
    sub_category: mapping.sub_category,
    supplier_division: SUPPLIER_DIVISION_LABEL,
    product_indicator: product.badge ?? null,
    minimum_order_qty: product.min_order_quantity ?? null,
    carton_qty: null,
    carton_dims: null,
    carton_gross_weight: null,
    images: shapeImages(images),
    plain_images: [],
    artwork_templates: [],
    items: shapeItems(colors),
    product_pricing: shapeProductPricing(tiers),
    print_details: shapePrintDetails(printRows),
    shipping_charges: [],
    priority_service: [],
    raw_payload: {
      source: 'catalog_products',
      migrated_at: new Date().toISOString(),
      pricing_model: product.pricing_model ?? null, // 'flat' | 'clothing' | 'coverage'
      category_mapping_source: 'session-4a/CATEGORY_MAPPING',
      catalog_products: product,
      catalog_pricing_tiers: tiers ?? [],
      catalog_print_pricing: printRows ?? [],
      catalog_product_colors: colors ?? [],
      catalog_product_images: images ?? [],
      catalog_product_features: features ?? [],
      catalog_product_specifications: specs,
      product_template: template,
      image_host: 'supabase-storage', // vs Laltex CDN — hint for future frontend work
    },
    last_synced_at: new Date().toISOString(),
    // embedding / embedding_source_hash / embedded_at intentionally omitted —
    // the 04:00 UTC embed cron picks these rows up on next run.
  };

  // Per-product summary for logging
  const summary = {
    slug: product.slug,
    tiers: tiers?.length ?? 0,
    print_rows: printRows?.length ?? 0,
    print_details_entries: row.print_details.length,
    colours: row.items.length,
    images: row.images.length,
    features: features?.length ?? 0,
  };

  return { row, summary };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const supabaseUrl = ensureEnv('VITE_SUPABASE_URL', process.env.VITE_SUPABASE_URL);
  const serviceRoleKey = ensureEnv('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
  const ctx = { supabaseUrl, serviceRoleKey };

  console.log(`[migrate] mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);

  const supplierId = await fetchSupplierId(ctx);
  console.log(`[migrate] supplier '${SUPPLIER_SLUG}' id = ${supplierId}`);

  const products = await fetchActiveCatalogProducts(ctx);
  console.log(`[migrate] fetched ${products.length} active catalog_products rows`);

  // Confirm mapping covers every slug we're about to shape
  const unmapped = products.map((p) => p.slug).filter((s) => !(s in CATEGORY_MAPPING));
  if (unmapped.length) {
    throw new Error(`CATEGORY_MAPPING is missing entries: ${unmapped.join(', ')}. Add to the script before proceeding.`);
  }

  const warnings = [];
  const shapedRows = [];
  const summaries = [];
  for (const p of products) {
    // eslint-disable-next-line no-await-in-loop
    const out = await shapeOne(ctx, p, supplierId, warnings);
    if (!out) continue;
    shapedRows.push(out.row);
    summaries.push(out.summary);
    console.log(
      `[migrate] ${out.summary.slug.padEnd(24)} → ` +
      `${out.summary.tiers} tiers, ` +
      `${out.summary.print_rows} print_rows → ${out.summary.print_details_entries} print_details, ` +
      `${out.summary.colours} colours, ` +
      `${out.summary.images} images, ` +
      `${out.summary.features} features`,
    );
  }

  for (const w of warnings) console.log(`[migrate] WARNING: ${w}`);

  console.log(`[migrate] shaped: ${shapedRows.length}/${products.length}`);

  if (dryRun) {
    console.log('');
    console.log('[migrate] === DRY RUN OUTPUT (JSON) ===');
    console.log(JSON.stringify(shapedRows, null, 2));
    console.log('');
    console.log('[migrate] dry-run complete — no writes performed');
    return;
  }

  // --- Live upsert ---
  const upsertUrl = `${supabaseUrl}/rest/v1/supplier_products?on_conflict=supplier_id,supplier_product_code`;
  await pgRest('POST', upsertUrl, serviceRoleKey, {
    body: shapedRows,
    extraHeaders: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });

  // Verify
  const countRows = await pgRest(
    'GET',
    `${supabaseUrl}/rest/v1/supplier_products?supplier_id=eq.${supplierId}&select=id`,
    serviceRoleKey,
  );
  const live = Array.isArray(countRows) ? countRows.length : 0;

  console.log(`[migrate] upsert complete — ${shapedRows.length} rows sent, supplier_products now has ${live} rows under ${SUPPLIER_SLUG}`);

  if (live !== shapedRows.length) {
    console.log(`[migrate] WARNING: live count (${live}) does not match shaped count (${shapedRows.length})`);
    process.exitCode = 1;
  }

  console.log('');
  console.log('[migrate] embedding / embedding_source_hash / embedded_at left NULL');
  console.log('[migrate] next 04:00 UTC embed cron will pick these up automatically');
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err.message ?? err);
  process.exit(1);
});
