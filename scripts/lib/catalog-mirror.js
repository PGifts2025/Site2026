/**
 * catalog-mirror.js — mirrors active catalog_products (PGifts Direct) into
 * supplier_products under the 'pgifts-direct' supplier, so the AI search
 * layer (rpc_search_supplier_products / rpc_find_alternatives) sees the
 * same MOQ, price tiers and lead time the product pages sell at.
 *
 * Used by:
 *   - api/cron/sync-catalog-mirror.js            (Vercel Cron, daily 03:30 UTC)
 *   - scripts/migrate-catalog-to-supplier-products.js  (manual / --dry-run)
 *
 * Why daily: both search RPCs drop rows whose last_synced_at is older than
 * 14 days, and catalogue edits (prices, MOQ, lead time) must reach the AI
 * within a day. Runs before the 04:00 embed cron, which re-embeds only rows
 * whose source text changed (hash-gated). CLAUDE.md §65.
 *
 * Idempotent: UPSERT on (supplier_id, supplier_product_code).
 */

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
    throw new Error(`${name} is required`);
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
    .map((t) => {
      const price = t.price_per_unit != null ? Number(t.price_per_unit) : null;
      // PGifts Direct prices in catalog_pricing_tiers.price_per_unit are
      // ALREADY margin-baked at the catalog layer (manually entered with
      // the 22/20/18% rule applied). For uniform cross-supplier reads
      // (CLAUDE.md §46), mirror them as both `price` AND `sell_price`,
      // and stamp margin_applied_pct=0 to signal "no further margin to
      // apply at read time". shipping_charges stays empty so the
      // read-time delivery helper returns 0 — delivery is assumed to be
      // baked into the PGifts Direct margin already.
      return {
        min_qty: t.min_quantity,
        max_qty: t.max_quantity, // already nullable; null = open-ended top tier
        price,
        sell_price: price,
        margin_applied_pct: 0,
        is_poa: false,
        note: t.is_popular ? 'popular' : null,
      };
    });
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
    .map((r) => {
      const price = r.price_per_unit != null ? Number(r.price_per_unit) : null;
      // Same rationale as shapeProductPricing above: PGifts Direct print
      // prices are already margin-baked. Mirror sell_price = price,
      // margin_applied_pct = 0. CLAUDE.md §46.
      return {
        NumColours: r.colour_count,
        NumPosition: 1,
        MinQuantity: r.min_quantity,
        MaxQuantity: r.max_quantity, // nullable
        Price: price,
        sell_price: price,
        margin_applied_pct: 0,
        ColourVariant: r.colour_variant, // 'white' | 'coloured'
      };
    });
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
// MOQ + lead time
// ---------------------------------------------------------------------------

/**
 * MOQ = the lowest catalog_pricing_tiers row — what the product page and the
 * server checks sell from (CLAUDE.md §16). Falls back to the column when a
 * product has no tiers. A disagreement is logged so it surfaces in the cron
 * output rather than silently diverging again.
 */
function effectiveMoq(product, tiers, warnings) {
  const column = product.min_order_quantity ?? null;
  const mins = (tiers ?? []).map((t) => Number(t.min_quantity)).filter(Number.isFinite);
  if (mins.length === 0) return column;
  const lowest = Math.min(...mins);
  if (column != null && column !== lowest) {
    warnings.push(`${product.slug}: min_order_quantity ${column} disagrees with lowest tier ${lowest} — mirroring ${lowest}`);
  }
  return lowest;
}

/** Calendar days → whole weeks when both bounds divide by 7, else days. */
export function formatLeadTime(minDays, maxDays) {
  const lo = minDays ?? maxDays;
  const hi = maxDays ?? minDays;
  if (lo == null || hi == null) return null;
  const weeks = lo % 7 === 0 && hi % 7 === 0;
  const a = weeks ? lo / 7 : lo;
  const b = weeks ? hi / 7 : hi;
  const unit = weeks ? 'weeks' : 'days';
  const range = a === b ? `${a} ${unit}` : `${a}–${b} ${unit}`;
  return `Lead time: ${range} from artwork approval.`;
}

/** supplier_products.lead_time_days is WORKING days (Laltex feed + search filter). */
export function workingDaysFromCalendar(calendarDays) {
  if (calendarDays == null) return null;
  return Math.ceil((Number(calendarDays) * 5) / 7);
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
  const leadTimeText = formatLeadTime(product.lead_time_days_min, product.lead_time_days_max);
  // Lead time leads the description so it survives slimProduct's 600-char
  // cut and reaches the model verbatim (supplier_products has no range column).
  const description = [leadTimeText, product.description].filter(Boolean).join(' ') || null;
  const moq = effectiveMoq(product, tiers, warnings);
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
    minimum_order_qty: moq,
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
    // Session 4b search facets. PGifts-Direct gets the same shape as
    // Laltex sync. We deliberately do NOT include is_core_product /
    // core_priority / in_stock here — those are curated state owned
    // by the search-layer migration and would be clobbered on re-run
    // if included. PostgREST merge-duplicates only updates columns
    // present in the body, so omitting them is the right pattern.
    lead_time_days: workingDaysFromCalendar(product.lead_time_days_max), // search filter unit = working days
    express_available: false,    // no PGifts-Direct products are express
    // Task 10 / CLAUDE.md §46: mirror rows already have margin baked at
    // the catalog layer, so margin_applied_pct=0 is set per-tier above
    // and the schedule version stamp goes here. margin_pct_override is
    // omitted (admin-owned column; never touched by sync or mirror).
    margin_default_schedule_version: 1,
    margin_last_applied_at: new Date().toISOString(),
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
// Entry point
// ---------------------------------------------------------------------------

/**
 * @returns {{ shaped: number, active: number, live: number|null, warnings: string[],
 *             summaries: object[], rows?: object[] }}
 */
export async function syncCatalogMirror({ supabaseUrl, serviceRoleKey, dryRun = false, log = () => {} }) {
  ensureEnv('VITE_SUPABASE_URL', supabaseUrl);
  ensureEnv('SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey);
  const ctx = { supabaseUrl, serviceRoleKey };

  const supplierId = await fetchSupplierId(ctx);
  const products = await fetchActiveCatalogProducts(ctx);
  log(`fetched ${products.length} active catalog_products rows`);

  // Confirm mapping covers every slug we're about to shape
  const unmapped = products.map((p) => p.slug).filter((s) => !(s in CATEGORY_MAPPING));
  if (unmapped.length) {
    throw new Error(`CATEGORY_MAPPING is missing entries: ${unmapped.join(', ')}. Add to catalog-mirror.js before proceeding.`);
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
  }

  if (dryRun) {
    return { shaped: shapedRows.length, active: products.length, live: null, warnings, summaries, rows: shapedRows };
  }

  const upsertUrl = `${supabaseUrl}/rest/v1/supplier_products?on_conflict=supplier_id,supplier_product_code`;
  await pgRest('POST', upsertUrl, serviceRoleKey, {
    body: shapedRows,
    extraHeaders: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });

  const countRows = await pgRest(
    'GET',
    `${supabaseUrl}/rest/v1/supplier_products?supplier_id=eq.${supplierId}&select=id`,
    serviceRoleKey,
  );
  const live = Array.isArray(countRows) ? countRows.length : 0;
  return { shaped: shapedRows.length, active: products.length, live, warnings, summaries };
}
