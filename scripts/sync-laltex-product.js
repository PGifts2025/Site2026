#!/usr/bin/env node
/**
 * sync-laltex-product.js
 *
 * Session 1 foundation: pull ONE product from the Laltex API and UPSERT it
 * into supplier_products. Proves the schema + parsing pipeline end-to-end.
 *
 * Usage:
 *   node scripts/sync-laltex-product.js <PRODUCT_CODE>
 *   node scripts/sync-laltex-product.js MG0192
 *
 * Requires in site/.env:
 *   LALTEX_API_KEY         Laltex API key (passed in custom API_KEY header)
 *   SUPABASE_ACCESS_TOKEN  Supabase PAT — used to run the UPSERT via the
 *                          Management API SQL endpoint (matches the pattern
 *                          already documented in project memory for
 *                          admin-side DB operations).
 *
 * Key parsing rules (verified against the Laltex V1.7 PDF + live test):
 *   - Prices are "£1.79" strings — strip "£" and parse numeric.
 *   - Price > £900 per Laltex docs means POA; store is_poa=true, price=null.
 *   - Pixel coordinates are "267.500px" — strip "px", parse numeric.
 *   - MaxQuantity "N/A" means open-ended top tier — store as null.
 *
 * Writes raw Laltex trade cost only. Markup layer lives elsewhere.
 * Never logs the full API key (truncated to last 4 chars for debug).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PROJECT_REF = 'cbcevjhvgmxrxeeyldza';
const LALTEX_BASE = 'https://auto.laltex.com/trade/api';
const MGMT_SQL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

const POA_THRESHOLD = 900; // per Laltex docs, any price above this is POA

function parsePrice(raw) {
  if (raw == null) return { price: null, is_poa: false };
  const s = String(raw).trim();
  if (!s || s.toUpperCase() === 'N/A' || s.toUpperCase() === 'POA') {
    return { price: null, is_poa: s.toUpperCase() === 'POA' };
  }
  // Strip currency symbols and whitespace
  const cleaned = s.replace(/[£€$,\s]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { price: null, is_poa: false };
  if (n > POA_THRESHOLD) return { price: null, is_poa: true };
  return { price: n, is_poa: false };
}

function parsePx(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s.replace(/px$/i, ''));
  return Number.isFinite(n) ? n : null;
}

function parseQtyBound(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s.toUpperCase() === 'N/A') return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function parseQtyRequired(raw) {
  const n = parseQtyBound(raw);
  return n == null ? 0 : n;
}

// ---------------------------------------------------------------------------
// Payload transforms (raw Laltex shape -> our JSONB shape)
// ---------------------------------------------------------------------------

function transformProductPrice(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((tier) => {
    const { price, is_poa } = parsePrice(tier.Price);
    return {
      min_qty: parseQtyRequired(tier.MinQuantity),
      max_qty: parseQtyBound(tier.MaxQuantity),
      price,
      is_poa,
      note: tier.Note || null,
    };
  });
}

function transformPrintPrice(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((tier) => {
    const { price, is_poa } = parsePrice(tier.Price);
    return {
      num_colours: parseQtyRequired(tier.NumColours),
      num_position: parseQtyRequired(tier.NumPosition),
      min_qty: parseQtyRequired(tier.MinQuantity),
      max_qty: parseQtyBound(tier.MaxQuantity),
      price,
      is_poa,
    };
  });
}

function transformPrintAreaCoords(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((c) => {
    const width = parsePx(c.Width);
    const height = parsePx(c.Height);
    const diameter = parsePx(c.Diameter);
    const shape = diameter != null ? 'circle' : 'rectangle';
    return {
      image_url: c.ImageUrl || null,
      marked_image_url: c.MarkedImageUrl || null,
      colour: c.Colour || null,
      x: parsePx(c.Xpos),
      y: parsePx(c.YPos),
      width,
      height,
      diameter,
      shape,
    };
  });
}

function transformPrintDetails(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((pd) => ({
    print_class: pd.PrintClass || null,
    print_type: pd.PrintType || null,
    print_position: pd.PrintPosition || null,
    print_area: pd.PrintArea || null,
    max_colours: pd.MaxColours || null,
    notes: pd.Notes || null,
    lead_time: pd.LeadTime || null,
    setup_charge: parsePrice(pd.SetupCharge).price,
    setup_charge_raw: pd.SetupCharge || null,
    rpt_setup_charge: parsePrice(pd.RptSetupCharge).price,
    rpt_setup_charge_raw: pd.RptSetupCharge || null,
    extra_colour_setup_charge: parsePrice(pd.ExtraColourSetupCharge).price,
    extra_colour_setup_charge_raw: pd.ExtraColourSetupCharge || null,
    default_print_option: !!pd.DefaultPrintOption,
    print_price: transformPrintPrice(pd.PrintPrice),
    print_area_coordinates: transformPrintAreaCoords(pd.PrintAreaCoordinates),
  }));
}

function transformItems(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((it) => ({
    item_code: it.ItemCode || null,
    item_description: it.ItemDescription || null,
    item_colour: it.ItemColour || null,
    item_size: it.ItemSize || null,
    item_indicator: it.ItemIndicator || null,
    pms: it.PMS || null,
    seed_type: it.SeedType || null,
    item_images: Array.isArray(it.ItemImages) ? it.ItemImages : [],
    plain_images: Array.isArray(it.PlainImages) ? it.PlainImages : [],
  }));
}

function transformArtworkTemplates(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((t) => ({
    template: t.Template || null,
    template_type: t.TemplateType || null,
  }));
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function fetchLaltexProduct(code, apiKey) {
  const url = `${LALTEX_BASE}/v1/products/${encodeURIComponent(code.toLowerCase())}`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      API_KEY: apiKey,
      Accept: 'application/json',
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Laltex API ${resp.status} ${resp.statusText} for ${code}: ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  // Response shapes observed in the wild:
  //   1. Live API:   [ { ...product } ]                 (bare array)
  //   2. PDF sample: { value: [ { ...product } ] }      (wrapped)
  //   3. Fallback:   { ...product }                     (single object)
  let product;
  if (Array.isArray(data)) product = data[0];
  else if (Array.isArray(data?.value)) product = data.value[0];
  else product = data;
  if (!product || !product.ProductCode) {
    throw new Error(`Laltex API returned no product for ${code}`);
  }
  return product;
}

async function execSQL(sql, token) {
  const resp = await fetch(MGMT_SQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Supabase SQL ${resp.status}: ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// SQL escaping
// ---------------------------------------------------------------------------

function sqlText(v) {
  if (v == null) return 'NULL';
  const s = String(v).replace(/'/g, "''");
  return `'${s}'`;
}

function sqlInt(v) {
  if (v == null || v === '') return 'NULL';
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.trunc(n)) : 'NULL';
}

function sqlJsonb(obj) {
  if (obj == null) return 'NULL';
  const s = JSON.stringify(obj).replace(/'/g, "''");
  return `'${s}'::jsonb`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const code = process.argv[2];
  if (!code) {
    console.error('Usage: node scripts/sync-laltex-product.js <PRODUCT_CODE>');
    process.exit(1);
  }

  const apiKey = process.env.LALTEX_API_KEY;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!apiKey) {
    console.error('[sync] LALTEX_API_KEY missing from site/.env');
    process.exit(1);
  }
  if (!token) {
    console.error('[sync] SUPABASE_ACCESS_TOKEN missing from site/.env');
    process.exit(1);
  }

  const keyTail = apiKey.length >= 4 ? apiKey.slice(-4) : '****';
  console.log(`[sync] fetching ${code} from Laltex (key ends ...${keyTail})`);

  const product = await fetchLaltexProduct(code, apiKey);
  console.log(`[sync] fetched ${product.ProductCode} — ${product.ProductName}`);

  const supplierRows = await execSQL("SELECT id FROM suppliers WHERE slug = 'laltex'", token);
  if (!Array.isArray(supplierRows) || !supplierRows[0]?.id) {
    throw new Error("suppliers row 'laltex' not found — has the migration been applied?");
  }
  const supplierId = supplierRows[0].id;

  // Build transformed payloads
  const productPricing = transformProductPrice(product.ProductPrice);
  const printDetails = transformPrintDetails(product.PrintDetails);
  const items = transformItems(product.Items);
  const images = Array.isArray(product.Images) ? product.Images : [];
  const plainImages = Array.isArray(product.PlainImages) ? product.PlainImages : [];
  const artworkTemplates = transformArtworkTemplates(product.ArtworkTemplates);
  const shippingCharges = Array.isArray(product.ShippingCharge) ? product.ShippingCharge : [];
  const priorityService = Array.isArray(product.PriorityService) ? product.PriorityService : [];

  // Count coord entries for log summary
  const coordCount = printDetails.reduce(
    (acc, pd) => acc + (pd.print_area_coordinates?.length || 0),
    0,
  );

  // UPSERT
  const columns = [
    'supplier_id',
    'supplier_product_code',
    'name',
    'title',
    'description',
    'web_description',
    'keywords',
    'available_colours',
    'product_dims',
    'unit_weight',
    'material',
    'country_of_origin',
    'tariff_code',
    'category',
    'sub_category',
    'supplier_division',
    'product_indicator',
    'minimum_order_qty',
    'carton_qty',
    'carton_dims',
    'carton_gross_weight',
    'images',
    'plain_images',
    'artwork_templates',
    'items',
    'product_pricing',
    'print_details',
    'shipping_charges',
    'priority_service',
    'raw_payload',
    'last_synced_at',
  ];

  const values = [
    sqlText(supplierId),
    sqlText(product.ProductCode),
    sqlText(product.ProductName),
    sqlText(product.ProductTitle),
    sqlText(product.Description),
    sqlText(product.WebDescription),
    sqlText(product.KeyWords),
    sqlText(product.AvailableColours),
    sqlText(product.ProductDims),
    sqlText(product.UnitWeight),
    sqlText(product.Material),
    sqlText(product.CountryOfOrigin),
    sqlText(product.TariffCode),
    sqlText(product.Category),
    sqlText(product.SubCategory),
    sqlText(product.Supplier),
    sqlText(product.ProductIndicator),
    sqlInt(product.MinimumOrderQty),
    sqlInt(product.CartonQty),
    sqlText(product.CartonDims),
    sqlText(product.CartonGrossWeight),
    sqlJsonb(images),
    sqlJsonb(plainImages),
    sqlJsonb(artworkTemplates),
    sqlJsonb(items),
    sqlJsonb(productPricing),
    sqlJsonb(printDetails),
    sqlJsonb(shippingCharges),
    sqlJsonb(priorityService),
    sqlJsonb(product),        // raw payload
    'NOW()',
  ];

  const updateSet = columns
    .filter((c) => c !== 'supplier_id' && c !== 'supplier_product_code')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(',\n    ');

  const sql = `
INSERT INTO supplier_products (
  ${columns.join(', ')}
) VALUES (
  ${values.join(',\n  ')}
)
ON CONFLICT (supplier_id, supplier_product_code) DO UPDATE SET
    ${updateSet};
`;

  await execSQL(sql, token);

  // Read back to confirm
  const verify = await execSQL(
    `SELECT supplier_product_code, name, last_synced_at FROM supplier_products WHERE supplier_id = '${supplierId}' AND supplier_product_code = '${product.ProductCode.replace(/'/g, "''")}'`,
    token,
  );
  const row = Array.isArray(verify) ? verify[0] : null;
  if (!row) throw new Error('UPSERT appeared to succeed but row not found on re-read');

  console.log('[sync] saved.');
  console.log('[sync] summary:');
  console.log(`  code                  : ${row.supplier_product_code}`);
  console.log(`  name                  : ${row.name}`);
  console.log(`  price_tier_count      : ${productPricing.length}`);
  console.log(`  print_position_count  : ${printDetails.length}`);
  console.log(`  coord_entries_total   : ${coordCount}`);
  console.log(`  colour_variant_count  : ${items.length}`);
  console.log(`  image_count           : ${images.length}`);
  console.log(`  last_synced_at        : ${row.last_synced_at}`);
}

main().catch((err) => {
  console.error('[sync] FAILED:', err.message);
  process.exit(1);
});
