#!/usr/bin/env node
// Session 7 diagnostic — AF0001 per-position coord audit + corpus-wide
// scan for products whose print_area_coordinates have only one distinct
// (x,y,w,h) tuple across positions (the "MG0192 problem").
// Summary-only output (the full row dump for AF0001 is 432 rows).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

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
  if (!resp.ok) {
    console.error(`[${label}] HTTP ${resp.status}: ${text}`);
    process.exit(1);
  }
  return JSON.parse(text);
}

// ---------- 1. AF0001 per-position tuple+colour counts ----------
console.log('=== AF0001 per-position summary ===\n');
const af0001Tuples = await run(`
  SELECT
    pd->>'print_position' AS position,
    COUNT(*) AS row_count,
    COUNT(DISTINCT (pac->>'colour')) AS distinct_colours,
    COUNT(DISTINCT concat(pac->>'x', '|', pac->>'y')) AS distinct_xy,
    COUNT(DISTINCT concat(pac->>'x', '|', pac->>'y', '|', pac->>'width', '|', pac->>'height')) AS distinct_rect
  FROM supplier_products sp,
       jsonb_array_elements(sp.print_details) pd,
       jsonb_array_elements(pd->'print_area_coordinates') pac
  WHERE sp.supplier_product_code = 'AF0001'
  GROUP BY pd->>'print_position'
  ORDER BY pd->>'print_position';
`, 'af0001-tuples');
console.table(af0001Tuples);

// ---------- 2. AF0001 — every distinct rect across all positions ----------
console.log('\n=== AF0001 distinct (x,y,w,h) tuples across ALL positions ===\n');
const af0001Global = await run(`
  SELECT
    pac->>'x' AS x, pac->>'y' AS y, pac->>'width' AS w, pac->>'height' AS h,
    COUNT(*) AS occurrences,
    string_agg(DISTINCT pd->>'print_position', ', ') AS positions
  FROM supplier_products sp,
       jsonb_array_elements(sp.print_details) pd,
       jsonb_array_elements(pd->'print_area_coordinates') pac
  WHERE sp.supplier_product_code = 'AF0001'
  GROUP BY pac->>'x', pac->>'y', pac->>'width', pac->>'height'
  ORDER BY 5 DESC;
`, 'af0001-global');
console.table(af0001Global);

// ---------- 3. AF0001 colour coverage per position ----------
console.log('\n=== AF0001 colour coverage per position ===\n');
const af0001Coverage = await run(`
  WITH all_colours AS (
    SELECT DISTINCT pac->>'colour' AS colour
    FROM supplier_products sp,
         jsonb_array_elements(sp.print_details) pd,
         jsonb_array_elements(pd->'print_area_coordinates') pac
    WHERE sp.supplier_product_code = 'AF0001'
  ),
  positions AS (
    SELECT DISTINCT pd->>'print_position' AS position
    FROM supplier_products sp,
         jsonb_array_elements(sp.print_details) pd
    WHERE sp.supplier_product_code = 'AF0001'
  ),
  pairs AS (
    SELECT DISTINCT pd->>'print_position' AS position, pac->>'colour' AS colour
    FROM supplier_products sp,
         jsonb_array_elements(sp.print_details) pd,
         jsonb_array_elements(pd->'print_area_coordinates') pac
    WHERE sp.supplier_product_code = 'AF0001'
  )
  SELECT p.position, COUNT(DISTINCT ac.colour) AS expected_colours,
         COUNT(DISTINCT pr.colour) AS present_colours,
         COUNT(DISTINCT ac.colour) - COUNT(DISTINCT pr.colour) AS missing_count
  FROM positions p
  CROSS JOIN all_colours ac
  LEFT JOIN pairs pr ON pr.position = p.position AND pr.colour = ac.colour
  GROUP BY p.position
  ORDER BY p.position;
`, 'af0001-coverage');
console.table(af0001Coverage);

// ---------- 4. Corpus-wide: distinct (x,y) tuples per Laltex product ----------
console.log('\n=== CORPUS — distinct (x,y) tuples per Laltex product ===\n');
const corpus = await run(`
  WITH coords AS (
    SELECT sp.supplier_product_code AS code,
           sp.name,
           COUNT(*) FILTER (WHERE pac IS NOT NULL) AS coord_rows,
           COUNT(DISTINCT pd->>'print_position') AS distinct_positions,
           COUNT(DISTINCT concat(pac->>'x', '|', pac->>'y')) AS distinct_xy,
           COUNT(DISTINCT concat(pac->>'x', '|', pac->>'y', '|', pac->>'width', '|', pac->>'height')) AS distinct_rect
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id
    LEFT JOIN LATERAL jsonb_array_elements(sp.print_details) pd ON true
    LEFT JOIN LATERAL jsonb_array_elements(pd->'print_area_coordinates') pac ON true
    WHERE s.slug = 'laltex'
    GROUP BY sp.supplier_product_code, sp.name
  )
  SELECT * FROM coords
  WHERE coord_rows > 0
  ORDER BY distinct_xy ASC, distinct_positions DESC, code ASC;
`, 'corpus');

const num = (v) => Number(v);
const single = corpus.filter((r) => num(r.distinct_xy) === 1);
const multi = corpus.filter((r) => num(r.distinct_xy) > 1);
const multiPos = corpus.filter((r) => num(r.distinct_positions) > 1);
const multiPosSingleXY = corpus.filter((r) => num(r.distinct_positions) > 1 && num(r.distinct_xy) === 1);

console.log(`Laltex products with print_area_coordinates: ${corpus.length}`);
console.log(`  distinct_xy = 1 (single rect copied):              ${single.length}`);
console.log(`  distinct_xy > 1 (real per-position rects):         ${multi.length}`);
console.log(`  distinct_positions > 1 (multi-position products):  ${multiPos.length}`);
console.log(`  multi-position AND single-xy (the MG0192 bucket):  ${multiPosSingleXY.length}`);

console.log('\nFirst 25 in the MG0192-pattern bucket (positions>1, distinct_xy=1):\n');
for (const r of multiPosSingleXY.slice(0, 25)) {
  console.log(`  ${r.code.padEnd(8)} | positions=${r.distinct_positions} rows=${String(r.coord_rows).padStart(4)} | ${r.name}`);
}

console.log('\nFirst 25 products with REAL per-position rects (distinct_xy>1):\n');
for (const r of multi.slice(0, 25)) {
  console.log(`  ${r.code.padEnd(8)} | positions=${r.distinct_positions} distinct_xy=${String(r.distinct_xy).padStart(2)} rows=${String(r.coord_rows).padStart(4)} | ${r.name}`);
}

// ---------- 5. Histogram of distinct_xy across catalogue ----------
console.log('\n=== Histogram: distinct_xy buckets ===\n');
const histogram = {};
for (const r of corpus) {
  const k = num(r.distinct_xy);
  histogram[k] = (histogram[k] || 0) + 1;
}
const histRows = Object.keys(histogram).sort((a, b) => num(a) - num(b)).map((k) => ({
  distinct_xy: k,
  product_count: histogram[k],
}));
console.table(histRows);
