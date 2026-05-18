#!/usr/bin/env node
// Relaxed §3.2 — compare PAC image_url URL patterns vs variant
// plain_images[0] URL patterns within the same product, ignoring
// colour matching (which fails when Laltex ships items[].colour as
// null/undefined, e.g. ZA0172).

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

// For every product, collect:
//   - all PAC image_urls (across positions, colours)
//   - all variant plain_images[0] (one per variant)
// Then flag products where NO PAC image_url matches ANY plain_images[0].
// Those are products where the canvas image (loaded from PAC) and the
// plain-image fallback (used by bucket-(a) or when colourCoord falls
// through) would differ — exactly the "case vs earbud" shape.
console.log('=== PAC image_url URL-set DISJOINT from variant plain_images[0] set ===\n');
const r = await run(`
  WITH pac_urls AS (
    SELECT DISTINCT sp.supplier_product_code,
           pac->>'image_url' AS pac_url
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         jsonb_array_elements(sp.print_details) pd,
         jsonb_array_elements(COALESCE(pd->'print_area_coordinates','[]'::jsonb)) pac
    WHERE s.slug = 'laltex'
      AND sp.is_retired = false
      AND sp.in_stock = true
      AND (pac->>'image_url') IS NOT NULL
  ),
  variant_plain_first AS (
    SELECT DISTINCT sp.supplier_product_code,
           (item->'plain_images')->>0 AS plain_first
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         jsonb_array_elements(sp.items) item
    WHERE s.slug = 'laltex'
      AND sp.is_retired = false
      AND sp.in_stock = true
      AND (item->'plain_images')->>0 IS NOT NULL
  ),
  per_product AS (
    SELECT sp.supplier_product_code, sp.name, sp.category, sp.sub_category,
           ARRAY(SELECT DISTINCT pac_url FROM pac_urls WHERE pac_urls.supplier_product_code = sp.supplier_product_code) AS pac_url_set,
           ARRAY(SELECT DISTINCT plain_first FROM variant_plain_first WHERE variant_plain_first.supplier_product_code = sp.supplier_product_code) AS plain_first_set
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id
    WHERE s.slug = 'laltex'
      AND sp.is_retired = false
      AND sp.in_stock = true
  )
  SELECT supplier_product_code, name, category, sub_category,
         array_length(pac_url_set, 1) AS pac_url_count,
         array_length(plain_first_set, 1) AS plain_first_count,
         pac_url_set,
         plain_first_set
  FROM per_product
  WHERE array_length(pac_url_set, 1) > 0
    AND array_length(plain_first_set, 1) > 0
    AND NOT (pac_url_set && plain_first_set)
  ORDER BY supplier_product_code
  LIMIT 30;
`, 'disjoint');

console.log(`Products where PAC.image_url set and variant.plain_images[0] set are DISJOINT (top 30):`);
for (const p of r) {
  console.log(`\n  ${p.supplier_product_code} — ${p.name}`);
  console.log(`    ${p.category} > ${p.sub_category}`);
  console.log(`    PAC urls (${p.pac_url_count}):`);
  for (const u of (p.pac_url_set || [])) console.log(`      ${u}`);
  console.log(`    plain_first (${p.plain_first_count}):`);
  for (const u of (p.plain_first_set || [])) console.log(`      ${u}`);
}

console.log('\n\n=== Count: total disjoint products / total PAC-having products ===');
const counts = await run(`
  WITH pac_urls AS (
    SELECT DISTINCT sp.supplier_product_code, pac->>'image_url' AS pac_url
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         jsonb_array_elements(sp.print_details) pd,
         jsonb_array_elements(COALESCE(pd->'print_area_coordinates','[]'::jsonb)) pac
    WHERE s.slug = 'laltex' AND sp.is_retired = false AND sp.in_stock = true
      AND (pac->>'image_url') IS NOT NULL
  ),
  vpf AS (
    SELECT DISTINCT sp.supplier_product_code, (item->'plain_images')->>0 AS plain_first
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         jsonb_array_elements(sp.items) item
    WHERE s.slug = 'laltex' AND sp.is_retired = false AND sp.in_stock = true
      AND (item->'plain_images')->>0 IS NOT NULL
  ),
  pp AS (
    SELECT sp.supplier_product_code,
           ARRAY(SELECT DISTINCT pac_url FROM pac_urls WHERE pac_urls.supplier_product_code = sp.supplier_product_code) AS pacs,
           ARRAY(SELECT DISTINCT plain_first FROM vpf WHERE vpf.supplier_product_code = sp.supplier_product_code) AS plains
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id
    WHERE s.slug = 'laltex' AND sp.is_retired = false AND sp.in_stock = true
  )
  SELECT
    COUNT(*) FILTER (WHERE array_length(pacs,1) > 0) AS pac_products,
    COUNT(*) FILTER (WHERE array_length(pacs,1) > 0 AND array_length(plains,1) > 0 AND NOT (pacs && plains)) AS disjoint
  FROM pp;
`, 'counts');
console.log(JSON.stringify(counts[0], null, 2));

// Also: PAC entries with null/missing width or height — the ZA0176 bug.
console.log('\n\n=== PAC entries with NULL width or height (ZA0176 shape) ===');
const nullDims = await run(`
  SELECT sp.supplier_product_code, sp.name, sp.category, sp.sub_category,
         pd->>'print_position' AS position_name,
         pac->>'colour' AS colour,
         (pac->>'x') AS x, (pac->>'y') AS y,
         (pac->>'width') AS width, (pac->>'height') AS height,
         pac->>'image_url' AS image_url
  FROM supplier_products sp
  JOIN suppliers s ON s.id = sp.supplier_id,
       jsonb_array_elements(sp.print_details) pd,
       jsonb_array_elements(COALESCE(pd->'print_area_coordinates','[]'::jsonb)) pac
  WHERE s.slug = 'laltex'
    AND sp.is_retired = false
    AND sp.in_stock = true
    AND (
      (pac->>'width') IS NULL
      OR (pac->>'height') IS NULL
      OR (pac->>'width') = ''
      OR (pac->>'height') = ''
      OR (pac->>'width') = 'null'
      OR (pac->>'height') = 'null'
    )
  ORDER BY sp.supplier_product_code, position_name
  LIMIT 40;
`, 'null-dims');

console.log(`PAC entries with null/missing width or height (top 40):`);
for (const n of nullDims) {
  console.log(`  ${n.supplier_product_code} / ${n.position_name} colour=${n.colour}`);
  console.log(`    x=${n.x} y=${n.y} w=${n.width} h=${n.height}`);
}

console.log('\n=== Count: products with any null-W/H PAC entry ===');
const nullCount = await run(`
  SELECT COUNT(DISTINCT sp.supplier_product_code) AS affected
  FROM supplier_products sp
  JOIN suppliers s ON s.id = sp.supplier_id,
       jsonb_array_elements(sp.print_details) pd,
       jsonb_array_elements(COALESCE(pd->'print_area_coordinates','[]'::jsonb)) pac
  WHERE s.slug = 'laltex' AND sp.is_retired = false AND sp.in_stock = true
    AND (
      (pac->>'width') IS NULL OR (pac->>'height') IS NULL
    );
`, 'null-count');
console.log(JSON.stringify(nullCount[0], null, 2));

console.log('\n=== DONE ===');
