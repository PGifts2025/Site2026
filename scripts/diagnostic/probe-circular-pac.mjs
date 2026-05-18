#!/usr/bin/env node
// Phase 1 — Circular PAC zone audit (read-only).
//   - Field shape on null-W/H PAC entries: any Diameter/Shape/Radius?
//   - PrintArea string variety across the 63 affected products.
//   - Approach A feasibility: products that mix null-W/H circles
//     with populated-W/H rects so we can derive mm-per-pixel ratio
//     per-product.
//   - Per-affected-product summary table for the Phase 1 report.

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

// ──────────────────────────────────────────────────────────────────
// §1 — Inspect raw_payload keys on null-W/H PAC entries
// ──────────────────────────────────────────────────────────────────
console.log('=== §1 — All keys present on raw_payload PAC entries where Width/Height are null ===\n');
const rawKeys = await run(`
  WITH raw_pacs AS (
    SELECT sp.supplier_product_code, pac AS raw_pac
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         jsonb_array_elements(sp.raw_payload->'PrintDetails') pd,
         jsonb_array_elements(COALESCE(pd->'PrintAreaCoordinates','[]'::jsonb)) pac
    WHERE s.slug = 'laltex' AND sp.is_retired = false AND sp.in_stock = true
      AND (
        (pac->>'Width') IS NULL
        OR (pac->>'Height') IS NULL
        OR LOWER(pac->>'Width') = 'null'
        OR LOWER(pac->>'Height') = 'null'
      )
  )
  SELECT DISTINCT k AS key_name, COUNT(*) AS occurrences
  FROM raw_pacs,
       jsonb_object_keys(raw_pac) k
  GROUP BY k
  ORDER BY occurrences DESC;
`, 'raw-keys');
console.table(rawKeys);

console.log('\n=== §1b — Sample raw_payload PAC entries (5 different products, all keys + values) ===\n');
const rawSamples = await run(`
  SELECT sp.supplier_product_code, pac AS raw_pac, pd->>'PrintPosition' AS pos,
         pd->>'PrintArea' AS print_area, pd->>'PrintType' AS print_type
  FROM supplier_products sp
  JOIN suppliers s ON s.id = sp.supplier_id,
       jsonb_array_elements(sp.raw_payload->'PrintDetails') pd,
       jsonb_array_elements(COALESCE(pd->'PrintAreaCoordinates','[]'::jsonb)) pac
  WHERE s.slug = 'laltex' AND sp.is_retired = false AND sp.in_stock = true
    AND ((pac->>'Width') IS NULL OR (pac->>'Height') IS NULL)
  ORDER BY sp.supplier_product_code
  LIMIT 6;
`, 'raw-samples');
for (const s of rawSamples) {
  console.log(`\n  ${s.supplier_product_code} / ${s.pos} / print_area=${s.print_area} / print_type=${s.print_type}`);
  console.log('  Full PAC object:');
  console.log('    ' + JSON.stringify(s.raw_pac, null, 2).split('\n').join('\n    '));
}

// ──────────────────────────────────────────────────────────────────
// §2 — PrintArea string variety
// ──────────────────────────────────────────────────────────────────
console.log('\n\n=== §2 — Distinct PrintArea strings across null-W/H positions ===\n');
const printAreaVariety = await run(`
  SELECT pd->>'print_area' AS print_area, COUNT(DISTINCT sp.supplier_product_code) AS product_count
  FROM supplier_products sp
  JOIN suppliers s ON s.id = sp.supplier_id,
       jsonb_array_elements(sp.print_details) pd,
       jsonb_array_elements(COALESCE(pd->'print_area_coordinates','[]'::jsonb)) pac
  WHERE s.slug = 'laltex' AND sp.is_retired = false AND sp.in_stock = true
    AND ((pac->>'width') IS NULL OR (pac->>'height') IS NULL)
  GROUP BY pd->>'print_area'
  ORDER BY product_count DESC;
`, 'print-area-variety');
console.table(printAreaVariety);

// ──────────────────────────────────────────────────────────────────
// §3 — Approach A feasibility: mixed null+populated PAC per product
// ──────────────────────────────────────────────────────────────────
console.log('\n=== §3 — Approach A feasibility: products mixing null-W/H + populated-W/H PAC ===\n');
const mixedShape = await run(`
  WITH per_product AS (
    SELECT sp.supplier_product_code, sp.name, sp.category, sp.sub_category,
           COUNT(*) FILTER (
             WHERE (pac->>'width') IS NULL OR (pac->>'height') IS NULL
           ) AS null_count,
           COUNT(*) FILTER (
             WHERE (pac->>'width') IS NOT NULL AND (pac->>'height') IS NOT NULL
           ) AS populated_count
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         jsonb_array_elements(sp.print_details) pd,
         jsonb_array_elements(COALESCE(pd->'print_area_coordinates','[]'::jsonb)) pac
    WHERE s.slug = 'laltex' AND sp.is_retired = false AND sp.in_stock = true
    GROUP BY sp.supplier_product_code, sp.name, sp.category, sp.sub_category
  )
  SELECT
    COUNT(*) FILTER (WHERE null_count > 0) AS total_affected,
    COUNT(*) FILTER (WHERE null_count > 0 AND populated_count = 0) AS only_circles,
    COUNT(*) FILTER (WHERE null_count > 0 AND populated_count > 0) AS mixed
  FROM per_product;
`, 'mixed-counts');
console.log(JSON.stringify(mixedShape[0], null, 2));

console.log('\n=== §3b — Per-affected-product breakdown (all 63) ===\n');
const perProduct = await run(`
  WITH per_product AS (
    SELECT sp.supplier_product_code, sp.name, sp.category, sp.sub_category,
           COUNT(*) FILTER (
             WHERE (pac->>'width') IS NULL OR (pac->>'height') IS NULL
           ) AS null_count,
           COUNT(*) FILTER (
             WHERE (pac->>'width') IS NOT NULL AND (pac->>'height') IS NOT NULL
           ) AS populated_count
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         jsonb_array_elements(sp.print_details) pd,
         jsonb_array_elements(COALESCE(pd->'print_area_coordinates','[]'::jsonb)) pac
    WHERE s.slug = 'laltex' AND sp.is_retired = false AND sp.in_stock = true
    GROUP BY sp.supplier_product_code, sp.name, sp.category, sp.sub_category
  )
  SELECT supplier_product_code, name, category, sub_category, null_count, populated_count,
         CASE
           WHEN populated_count = 0 THEN 'only-circles'
           ELSE 'mixed'
         END AS shape_class
  FROM per_product
  WHERE null_count > 0
  ORDER BY shape_class, supplier_product_code;
`, 'per-product');
console.table(perProduct);

// ──────────────────────────────────────────────────────────────────
// §4 — Detailed look at a few mixed products: derive mm-per-pixel
// ──────────────────────────────────────────────────────────────────
console.log('\n=== §4 — Detail rows for sample mixed products (rect → mm/px → infer circle pixel diameter) ===\n');
const mixedDetail = await run(`
  WITH per_product AS (
    SELECT sp.supplier_product_code, sp.name,
           COUNT(*) FILTER (
             WHERE (pac->>'width') IS NULL OR (pac->>'height') IS NULL
           ) AS null_count,
           COUNT(*) FILTER (
             WHERE (pac->>'width') IS NOT NULL AND (pac->>'height') IS NOT NULL
           ) AS populated_count
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         jsonb_array_elements(sp.print_details) pd,
         jsonb_array_elements(COALESCE(pd->'print_area_coordinates','[]'::jsonb)) pac
    WHERE s.slug = 'laltex' AND sp.is_retired = false AND sp.in_stock = true
    GROUP BY sp.supplier_product_code, sp.name
  ),
  mixed_codes AS (
    SELECT supplier_product_code FROM per_product
    WHERE null_count > 0 AND populated_count > 0
    LIMIT 6
  )
  SELECT sp.supplier_product_code,
         pd->>'print_position' AS position,
         pd->>'print_area' AS print_area,
         pac->>'colour' AS colour,
         (pac->>'x') AS x, (pac->>'y') AS y,
         (pac->>'width') AS width, (pac->>'height') AS height,
         pac->>'image_url' AS image_url
  FROM supplier_products sp,
       jsonb_array_elements(sp.print_details) pd,
       jsonb_array_elements(COALESCE(pd->'print_area_coordinates','[]'::jsonb)) pac
  WHERE sp.supplier_product_code IN (SELECT supplier_product_code FROM mixed_codes)
  ORDER BY sp.supplier_product_code, position, print_area;
`, 'mixed-detail');
console.table(mixedDetail);

// Image URL list for visual sampling
console.log('\n=== §5 — Pull pac/ image URLs for visual sampling (5 affected products) ===\n');
const imageUrls = await run(`
  WITH per_product AS (
    SELECT sp.supplier_product_code, sp.name,
           COUNT(*) FILTER (
             WHERE (pac->>'width') IS NULL OR (pac->>'height') IS NULL
           ) AS null_count
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         jsonb_array_elements(sp.print_details) pd,
         jsonb_array_elements(COALESCE(pd->'print_area_coordinates','[]'::jsonb)) pac
    WHERE s.slug = 'laltex' AND sp.is_retired = false AND sp.in_stock = true
    GROUP BY sp.supplier_product_code, sp.name
  )
  SELECT DISTINCT sp.supplier_product_code, sp.name,
                  pd->>'print_position' AS position,
                  pd->>'print_area' AS print_area,
                  (pac->>'x')::numeric AS x, (pac->>'y')::numeric AS y,
                  pac->>'image_url' AS image_url,
                  pac->>'marked_image_url' AS marked_image_url
  FROM supplier_products sp,
       jsonb_array_elements(sp.print_details) pd,
       jsonb_array_elements(COALESCE(pd->'print_area_coordinates','[]'::jsonb)) pac
  WHERE sp.supplier_product_code IN ('ZA0176','RC0110','PS0045','PN3025','MG0119')
    AND ((pac->>'width') IS NULL OR (pac->>'height') IS NULL)
  ORDER BY sp.supplier_product_code, position;
`, 'image-urls');
for (const u of imageUrls) {
  console.log(`\n  ${u.supplier_product_code} / ${u.position} / ${u.print_area}`);
  console.log(`    x=${u.x}  y=${u.y}`);
  console.log(`    image_url       = ${u.image_url}`);
  console.log(`    marked_image_url= ${u.marked_image_url || '(none)'}`);
}

console.log('\n=== DONE ===');
