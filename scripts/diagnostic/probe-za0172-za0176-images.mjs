#!/usr/bin/env node
// Read-only deep-dive: ZA0172 + ZA0176 image-pipeline audit.
//
// Produces:
//   §1 — ZA0172 raw_payload + persisted shape + image URL map
//   §2 — ZA0176 raw_payload + persisted shape + smart-gate path
//   §3 — Catalogue-wide scans for the patterns we suspect

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const PROJECT_REF = 'cbcevjhvgmxrxeeyldza';
const MGMT_SQL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('SUPABASE_ACCESS_TOKEN missing'); process.exit(1); }

async function run(query, label) {
  const resp = await fetch(MGMT_SQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await resp.text();
  if (!resp.ok) { console.error(`[${label}] HTTP ${resp.status}: ${text}`); process.exit(1); }
  return JSON.parse(text);
}

// ─────────────────────────────────────────────────────────────────────
// §1.1 + §1.2 — ZA0172 raw_payload + persisted shape
// ─────────────────────────────────────────────────────────────────────
console.log('=== §1.1 — ZA0172 raw_payload Items[] structure ===\n');
const za0172Raw = await run(`
  SELECT
    supplier_product_code,
    raw_payload->>'Title' AS title,
    jsonb_array_length(COALESCE(raw_payload->'Items','[]'::jsonb)) AS items_count,
    jsonb_array_length(COALESCE(raw_payload->'PrintDetails','[]'::jsonb)) AS pd_count,
    raw_payload->'Items' AS items,
    raw_payload->'PrintDetails' AS print_details
  FROM supplier_products
  WHERE supplier_product_code = 'ZA0172';
`, 'za0172-raw');
const r = za0172Raw[0];
console.log(`Title: ${r.title}`);
console.log(`Items: ${r.items_count}, PrintDetails: ${r.pd_count}\n`);

console.log('--- Items[] (raw_payload) ---');
for (const item of (r.items || [])) {
  console.log(`\n  ItemCode: ${item.ItemCode}  Colour: ${item.Colour}`);
  console.log(`    ItemImages (${(item.ItemImages || []).length}):`);
  for (const ii of (item.ItemImages || [])) console.log(`      ${ii}`);
  console.log(`    PlainImages (${(item.PlainImages || []).length}):`);
  for (const pi of (item.PlainImages || [])) console.log(`      ${pi}`);
}

console.log('\n--- PrintDetails[] (raw_payload) ---');
for (const pd of (r.print_details || [])) {
  console.log(`\n  PrintPosition: ${pd.PrintPosition}  PrintArea: ${pd.PrintArea}  PrintType: ${pd.PrintType}`);
  const pacs = pd.PrintAreaCoordinates || [];
  console.log(`    PrintAreaCoordinates (${pacs.length}):`);
  for (const pac of pacs) {
    console.log(`      Colour=${pac.Colour}  X=${pac.X} Y=${pac.Y} W=${pac.Width} H=${pac.Height}`);
    console.log(`        ImageUrl       = ${pac.ImageUrl}`);
    console.log(`        MarkedImageUrl = ${pac.MarkedImageUrl || '(none)'}`);
  }
}

console.log('\n=== §1.2 — ZA0172 persisted (normalised) state ===\n');
const za0172Norm = await run(`
  SELECT items, print_details, plain_images, images
  FROM supplier_products
  WHERE supplier_product_code = 'ZA0172';
`, 'za0172-norm');
const n = za0172Norm[0];

console.log('--- items[] (persisted) ---');
for (const item of (n.items || [])) {
  console.log(`\n  ItemCode: ${item.item_code || item.ItemCode}  Colour: ${item.colour || item.Colour}`);
  const itemImages = item.item_images || item.ItemImages || [];
  const plainImages = item.plain_images || item.PlainImages || [];
  console.log(`    item_images (${itemImages.length}):`);
  for (const ii of itemImages) console.log(`      ${ii}`);
  console.log(`    plain_images (${plainImages.length}):`);
  for (const pi of plainImages) console.log(`      ${pi}`);
}

console.log('\n--- print_details[] (persisted) ---');
for (const pd of (n.print_details || [])) {
  const pacs = pd.print_area_coordinates || [];
  console.log(`\n  print_position: ${pd.print_position}  print_area: ${pd.print_area}  print_type: ${pd.print_type}`);
  console.log(`    print_area_coordinates (${pacs.length}):`);
  for (const pac of pacs) {
    console.log(`      colour=${pac.colour}  x=${pac.x} y=${pac.y} w=${pac.width} h=${pac.height}`);
    console.log(`        image_url        = ${pac.image_url}`);
    console.log(`        marked_image_url = ${pac.marked_image_url || '(none)'}`);
  }
}

console.log('\n--- Top-level images / plain_images ---');
console.log(`top.plain_images: ${JSON.stringify(n.plain_images)}`);
console.log(`top.images:       ${JSON.stringify(n.images)}`);

// ─────────────────────────────────────────────────────────────────────
// §2 — ZA0176 same treatment
// ─────────────────────────────────────────────────────────────────────
console.log('\n\n=== §2.1 — ZA0176 raw_payload Items[] structure ===\n');
const za0176Raw = await run(`
  SELECT
    supplier_product_code,
    raw_payload->>'Title' AS title,
    jsonb_array_length(COALESCE(raw_payload->'Items','[]'::jsonb)) AS items_count,
    jsonb_array_length(COALESCE(raw_payload->'PrintDetails','[]'::jsonb)) AS pd_count,
    raw_payload->'Items' AS items,
    raw_payload->'PrintDetails' AS print_details
  FROM supplier_products
  WHERE supplier_product_code = 'ZA0176';
`, 'za0176-raw');
const r2 = za0176Raw[0];
console.log(`Title: ${r2.title}`);
console.log(`Items: ${r2.items_count}, PrintDetails: ${r2.pd_count}\n`);

console.log('--- Items[] (raw_payload) ---');
for (const item of (r2.items || [])) {
  console.log(`\n  ItemCode: ${item.ItemCode}  Colour: ${item.Colour}`);
  console.log(`    ItemImages (${(item.ItemImages || []).length}):`);
  for (const ii of (item.ItemImages || [])) console.log(`      ${ii}`);
  console.log(`    PlainImages (${(item.PlainImages || []).length}):`);
  for (const pi of (item.PlainImages || [])) console.log(`      ${pi}`);
}

console.log('\n--- PrintDetails[] (raw_payload) ---');
for (const pd of (r2.print_details || [])) {
  const pacs = pd.PrintAreaCoordinates || [];
  console.log(`\n  PrintPosition: ${pd.PrintPosition}  PrintArea: ${pd.PrintArea}  PrintType: ${pd.PrintType}`);
  console.log(`    PrintAreaCoordinates (${pacs.length}):`);
  for (const pac of pacs) {
    console.log(`      Colour=${pac.Colour}  X=${pac.X} Y=${pac.Y} W=${pac.Width} H=${pac.Height}`);
    console.log(`        ImageUrl       = ${pac.ImageUrl}`);
    console.log(`        MarkedImageUrl = ${pac.MarkedImageUrl || '(none)'}`);
  }
}

console.log('\n=== §2.2 — ZA0176 persisted (normalised) state ===\n');
const za0176Norm = await run(`
  SELECT items, print_details, plain_images, images
  FROM supplier_products
  WHERE supplier_product_code = 'ZA0176';
`, 'za0176-norm');
const n2 = za0176Norm[0];

console.log('--- items[] (persisted) ---');
for (const item of (n2.items || [])) {
  const itemImages = item.item_images || item.ItemImages || [];
  const plainImages = item.plain_images || item.PlainImages || [];
  console.log(`\n  ItemCode: ${item.item_code || item.ItemCode}  Colour: ${item.colour || item.Colour}`);
  console.log(`    item_images (${itemImages.length}):`);
  for (const ii of itemImages) console.log(`      ${ii}`);
  console.log(`    plain_images (${plainImages.length}):`);
  for (const pi of plainImages) console.log(`      ${pi}`);
}

console.log('\n--- print_details[] (persisted) ---');
for (const pd of (n2.print_details || [])) {
  const pacs = pd.print_area_coordinates || [];
  console.log(`\n  print_position: ${pd.print_position}  print_area: ${pd.print_area}  print_type: ${pd.print_type}`);
  console.log(`    print_area_coordinates (${pacs.length}):`);
  for (const pac of pacs) {
    console.log(`      colour=${pac.colour}  x=${pac.x} y=${pac.y} w=${pac.width} h=${pac.height}`);
    console.log(`        image_url        = ${pac.image_url}`);
    console.log(`        marked_image_url = ${pac.marked_image_url || '(none)'}`);
  }
}

console.log('\n--- Top-level images / plain_images ---');
console.log(`top.plain_images: ${JSON.stringify(n2.plain_images)}`);
console.log(`top.images:       ${JSON.stringify(n2.images)}`);

// ─────────────────────────────────────────────────────────────────────
// §3 — Catalogue-wide scans
// ─────────────────────────────────────────────────────────────────────
console.log('\n\n=== §3.1 — Items with 2+ PlainImages (potential "case vs earbud" pattern) ===\n');
const multiPlain = await run(`
  WITH items_unrolled AS (
    SELECT sp.supplier_product_code, sp.name, sp.category, sp.sub_category,
           item->>'item_code' AS item_code,
           jsonb_array_length(COALESCE(item->'plain_images', '[]'::jsonb)) AS plain_count,
           jsonb_array_length(COALESCE(item->'item_images', '[]'::jsonb)) AS item_count,
           item->'plain_images' AS plain_images
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         jsonb_array_elements(sp.items) item
    WHERE s.slug = 'laltex'
      AND sp.is_retired = false
      AND sp.in_stock = true
  )
  SELECT supplier_product_code, name, category, sub_category,
         MAX(plain_count) AS max_plain,
         MAX(item_count) AS max_item,
         (SELECT string_agg(elem, ', ')
          FROM jsonb_array_elements_text(
            (SELECT plain_images FROM items_unrolled iu2
             WHERE iu2.supplier_product_code = items_unrolled.supplier_product_code
             AND iu2.plain_count >= 2 LIMIT 1)) elem) AS sample_urls
  FROM items_unrolled
  WHERE plain_count >= 2
  GROUP BY supplier_product_code, name, category, sub_category
  ORDER BY max_plain DESC, supplier_product_code
  LIMIT 30;
`, 'multi-plain');
console.log(`Products with ANY item having plain_images.length >= 2: ${multiPlain.length}`);
for (const p of multiPlain.slice(0, 15)) {
  console.log(`\n  ${p.supplier_product_code} — ${p.name}`);
  console.log(`    category: ${p.category} > ${p.sub_category}`);
  console.log(`    max_plain=${p.max_plain}, max_item=${p.max_item}`);
  console.log(`    plain_images sample: ${p.sample_urls}`);
}

console.log('\n=== §3.1b — count of distinct products with multi-PlainImage items ===');
const multiPlainCount = await run(`
  WITH items_unrolled AS (
    SELECT sp.supplier_product_code,
           jsonb_array_length(COALESCE(item->'plain_images','[]'::jsonb)) AS plain_count
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         jsonb_array_elements(sp.items) item
    WHERE s.slug = 'laltex'
      AND sp.is_retired = false
      AND sp.in_stock = true
  )
  SELECT
    COUNT(DISTINCT supplier_product_code) FILTER (WHERE plain_count >= 2) AS multi_plain,
    COUNT(DISTINCT supplier_product_code) AS total_active
  FROM items_unrolled;
`, 'multi-plain-count');
console.log(JSON.stringify(multiPlainCount[0], null, 2));

console.log('\n\n=== §3.2 — PAC image_url mismatch with variant plain_images[0] ===\n');
// For products with PAC, compare the PAC's image_url against the
// active variant's plain_images[0]. A mismatch suggests the rect
// could be drawn against a different image than the canvas displays.
const pacImageMismatch = await run(`
  WITH pac_rows AS (
    SELECT sp.supplier_product_code, sp.name, sp.category, sp.sub_category,
           pd->>'print_position' AS position_name,
           pac->>'colour' AS pac_colour,
           pac->>'image_url' AS pac_image_url
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         jsonb_array_elements(sp.print_details) pd,
         jsonb_array_elements(COALESCE(pd->'print_area_coordinates','[]'::jsonb)) pac
    WHERE s.slug = 'laltex'
      AND sp.is_retired = false
      AND sp.in_stock = true
  ),
  item_first_plain AS (
    SELECT sp.supplier_product_code,
           item->>'colour' AS item_colour,
           (item->'plain_images')->>0 AS first_plain,
           (item->'item_images')->>0 AS first_item
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         jsonb_array_elements(sp.items) item
    WHERE s.slug = 'laltex'
      AND sp.is_retired = false
      AND sp.in_stock = true
  )
  SELECT pr.supplier_product_code,
         pr.name,
         pr.position_name,
         pr.pac_colour,
         pr.pac_image_url,
         ifp.first_plain,
         ifp.first_item,
         (pr.pac_image_url IS DISTINCT FROM ifp.first_plain) AS differs_from_first_plain,
         (pr.pac_image_url IS DISTINCT FROM ifp.first_item)  AS differs_from_first_item
  FROM pac_rows pr
  LEFT JOIN item_first_plain ifp
    ON ifp.supplier_product_code = pr.supplier_product_code
   AND lower(trim(ifp.item_colour)) = lower(trim(pr.pac_colour))
  WHERE pr.pac_image_url IS NOT NULL
    AND ifp.first_plain IS NOT NULL
    AND (pr.pac_image_url <> ifp.first_plain)
  ORDER BY pr.supplier_product_code, pr.position_name
  LIMIT 25;
`, 'pac-mismatch');
console.log(`Sample rows where PAC.image_url != variant.plain_images[0] (top 25):\n`);
for (const m of pacImageMismatch.slice(0, 15)) {
  const pacEnd = m.pac_image_url ? m.pac_image_url.split('/').slice(-2).join('/') : '(none)';
  const firstEnd = m.first_plain ? m.first_plain.split('/').slice(-2).join('/') : '(none)';
  const itemEnd = m.first_item ? m.first_item.split('/').slice(-2).join('/') : '(none)';
  console.log(`  ${m.supplier_product_code} / ${m.position_name} / colour=${m.pac_colour}`);
  console.log(`    PAC.image_url  = .../${pacEnd}`);
  console.log(`    plain_images[0]= .../${firstEnd}`);
  console.log(`    item_images[0] = .../${itemEnd}`);
}

console.log('\n\n=== §3.2b — count summary of PAC mismatch ===');
const mismatchSummary = await run(`
  WITH pac_rows AS (
    SELECT sp.supplier_product_code,
           pd->>'print_position' AS position_name,
           pac->>'colour' AS pac_colour,
           pac->>'image_url' AS pac_image_url
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         jsonb_array_elements(sp.print_details) pd,
         jsonb_array_elements(COALESCE(pd->'print_area_coordinates','[]'::jsonb)) pac
    WHERE s.slug = 'laltex' AND sp.is_retired = false AND sp.in_stock = true
  ),
  item_first AS (
    SELECT sp.supplier_product_code,
           item->>'colour' AS item_colour,
           (item->'plain_images')->>0 AS first_plain
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         jsonb_array_elements(sp.items) item
    WHERE s.slug = 'laltex' AND sp.is_retired = false AND sp.in_stock = true
  )
  SELECT
    COUNT(DISTINCT pr.supplier_product_code) FILTER (
      WHERE pr.pac_image_url IS NOT NULL AND ifp.first_plain IS NOT NULL
        AND pr.pac_image_url <> ifp.first_plain
    ) AS products_with_mismatch,
    COUNT(DISTINCT pr.supplier_product_code) AS pac_products_total
  FROM pac_rows pr
  LEFT JOIN item_first ifp
    ON ifp.supplier_product_code = pr.supplier_product_code
   AND lower(trim(ifp.item_colour)) = lower(trim(pr.pac_colour));
`, 'mismatch-summary');
console.log(JSON.stringify(mismatchSummary[0], null, 2));

console.log('\n\n=== §3.3 — PAC products with structurally empty PAC arrays (paranoia check) ===');
const emptyPac = await run(`
  WITH per_product AS (
    SELECT sp.supplier_product_code, sp.name,
           jsonb_array_length(sp.print_details) AS pd_count,
           (SELECT COUNT(*) FROM jsonb_array_elements(sp.print_details) pd,
                   jsonb_array_elements(COALESCE(pd->'print_area_coordinates','[]'::jsonb)) pac
           ) AS pac_count
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id
    WHERE s.slug = 'laltex' AND sp.is_retired = false AND sp.in_stock = true
  )
  SELECT supplier_product_code, name, pd_count
  FROM per_product
  WHERE pd_count >= 1 AND pac_count = 0
  ORDER BY supplier_product_code
  LIMIT 5;
`, 'empty-pac');
console.log(`Products with print_details but zero PAC anywhere (sample of 5, full bucket-(a)):`);
for (const e of emptyPac) {
  console.log(`  ${e.supplier_product_code} — ${e.name} (pd=${e.pd_count})`);
}

// ─────────────────────────────────────────────────────────────────────
// Extra: ZA0172 / ZA0176 print_details with all PrintArea sizes mapped
// to PAC counts. Helpful for §1.3 / §2.3 to see what canonicalGroupName
// would land on.
// ─────────────────────────────────────────────────────────────────────
console.log('\n\n=== ZA0172 / ZA0176 position-level PAC summary ===');
const summary = await run(`
  WITH expanded AS (
    SELECT sp.supplier_product_code,
           pd->>'print_position' AS position_name,
           pd->>'print_area' AS print_area,
           pd->>'print_type' AS print_type,
           jsonb_array_length(COALESCE(pd->'print_area_coordinates','[]'::jsonb)) AS pac_count
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         jsonb_array_elements(sp.print_details) pd
    WHERE s.slug = 'laltex'
      AND sp.supplier_product_code IN ('ZA0172','ZA0176')
  )
  SELECT supplier_product_code, position_name, print_area, print_type, pac_count
  FROM expanded
  ORDER BY supplier_product_code, position_name, print_area;
`, 'summary');
console.table(summary);

console.log('\n=== DONE ===');
