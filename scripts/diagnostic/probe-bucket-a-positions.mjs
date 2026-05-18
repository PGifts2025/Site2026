#!/usr/bin/env node
// Investigation probe — bucket-(a) Designer relaxation (CC task 15 follow-up).
//
// Bucket-(a) = Laltex products with at least one print_details entry but
// zero print_area_coordinates anywhere (no pixel-anchored PAC). Currently
// hidden from the Designer via LaltexProductView's `isDesignable` gate.
//
// This probe:
//   1) Confirms the bucket-(a) population size.
//   2) Aggregates distinct PrintPosition names within bucket-(a).
//   3) Samples 2-3 example product codes per position.
//   4) Captures the print_area dimension strings (e.g. "170 x 40mm") per
//      position so we can sanity-check whether PrintArea-driven sizing
//      is feasible.
//   5) Tags each position with the dominant product category for context.
//
// Read-only. Standard PAT + Management-SQL pattern (see ../README.md and
// CLAUDE.md §27.2).

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
  if (!resp.ok) {
    console.error(`[${label}] HTTP ${resp.status}: ${text}`);
    process.exit(1);
  }
  return JSON.parse(text);
}

// ---------- 0. Bucket-(a) population ----------
console.log('=== Population sizes ===\n');
const populations = await run(`
  WITH laltex_products AS (
    SELECT sp.id, sp.supplier_product_code, sp.name, sp.category, sp.sub_category,
           sp.print_details, sp.is_retired,
           COALESCE(jsonb_array_length(sp.print_details), 0) AS pd_count,
           (
             SELECT COUNT(*) FROM jsonb_array_elements(COALESCE(sp.print_details, '[]'::jsonb)) pd,
                    jsonb_array_elements(COALESCE(pd->'print_area_coordinates', '[]'::jsonb)) pac
           ) AS pac_count
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id
    WHERE s.slug = 'laltex'
  )
  SELECT
    COUNT(*) AS total_laltex,
    COUNT(*) FILTER (WHERE is_retired = false) AS active_laltex,
    COUNT(*) FILTER (WHERE pd_count = 0 AND is_retired = false) AS bucket_no_print_details,
    COUNT(*) FILTER (WHERE pd_count >= 1 AND pac_count = 0 AND is_retired = false) AS bucket_a_active,
    COUNT(*) FILTER (WHERE pd_count >= 1 AND pac_count = 0) AS bucket_a_all,
    COUNT(*) FILTER (WHERE pac_count >= 1 AND is_retired = false) AS bucket_with_pac
  FROM laltex_products;
`, 'populations');
console.table(populations);

// ---------- 1. Distinct PrintPosition names within bucket-(a) ----------
console.log('\n=== §1 — Distinct PrintPosition names in active bucket-(a) ===\n');
const positions = await run(`
  WITH bucket_a AS (
    SELECT sp.id, sp.supplier_product_code, sp.name,
           sp.category, sp.sub_category, sp.print_details
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id
    WHERE s.slug = 'laltex'
      AND sp.is_retired = false
      AND jsonb_array_length(sp.print_details) >= 1
      AND (
        SELECT COUNT(*) FROM jsonb_array_elements(sp.print_details) pd,
               jsonb_array_elements(COALESCE(pd->'print_area_coordinates', '[]'::jsonb)) pac
      ) = 0
  ),
  position_rows AS (
    SELECT b.supplier_product_code, b.name, b.category, b.sub_category,
           pd->>'print_position' AS position_name,
           pd->>'print_area'     AS print_area_str
    FROM bucket_a b,
         jsonb_array_elements(b.print_details) pd
  )
  SELECT position_name,
         COUNT(DISTINCT supplier_product_code) AS product_count,
         (
           SELECT string_agg(code || ' (' || COALESCE(cat, '-') || ')', '; ')
           FROM (
             SELECT DISTINCT supplier_product_code AS code, category AS cat
             FROM position_rows pr2
             WHERE pr2.position_name = position_rows.position_name
             ORDER BY supplier_product_code
             LIMIT 3
           ) sub
         ) AS sample_products,
         (
           SELECT string_agg(DISTINCT cat, ' | ' ORDER BY cat)
           FROM (
             SELECT DISTINCT COALESCE(category, '(uncategorised)') AS cat
             FROM position_rows pr3
             WHERE pr3.position_name = position_rows.position_name
           ) c
         ) AS categories,
         (
           SELECT string_agg(DISTINCT pa, ' | ' ORDER BY pa)
           FROM (
             SELECT DISTINCT NULLIF(print_area_str, '') AS pa
             FROM position_rows pr4
             WHERE pr4.position_name = position_rows.position_name
             LIMIT 5
           ) p
         ) AS sample_print_areas
  FROM position_rows
  WHERE position_name IS NOT NULL
  GROUP BY position_name
  ORDER BY product_count DESC, position_name ASC;
`, 'positions');
console.log(`Distinct PrintPosition values: ${positions.length}\n`);
for (const r of positions) {
  console.log(
    `  ${String(r.position_name).padEnd(28)} | count=${String(r.product_count).padStart(4)} | cats=${r.categories || '-'}`
  );
}

// ---------- 2. Coverage table — top N covers what fraction? ----------
console.log('\n=== §1 — Cumulative coverage (top N position names) ===\n');
let totalProducts = 0;
for (const r of positions) totalProducts += Number(r.product_count);
let cum = 0;
const cumRows = positions.slice(0, 30).map((r) => {
  cum += Number(r.product_count);
  return {
    position: r.position_name,
    count: Number(r.product_count),
    cumulative_pct: ((cum / totalProducts) * 100).toFixed(1) + '%',
  };
});
console.table(cumRows);
console.log(`\nTotal position-occurrences across bucket-(a): ${totalProducts}`);

// ---------- 3. Categories breakdown for bucket-(a) ----------
console.log('\n=== §1 — Category breakdown of active bucket-(a) ===\n');
const categories = await run(`
  WITH bucket_a AS (
    SELECT sp.id, sp.supplier_product_code, sp.category
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id
    WHERE s.slug = 'laltex'
      AND sp.is_retired = false
      AND jsonb_array_length(sp.print_details) >= 1
      AND (
        SELECT COUNT(*) FROM jsonb_array_elements(sp.print_details) pd,
               jsonb_array_elements(COALESCE(pd->'print_area_coordinates', '[]'::jsonb)) pac
      ) = 0
  )
  SELECT COALESCE(category, '(uncategorised)') AS category,
         COUNT(*) AS product_count
  FROM bucket_a
  GROUP BY category
  ORDER BY product_count DESC;
`, 'categories');
console.table(categories);

// ---------- 4. Sub-category distribution per position (for the top 8 positions) ----------
console.log('\n=== §1 — Sub-category distribution for top 8 positions ===\n');
const topPositions = positions.slice(0, 8).map((r) => r.position_name);
for (const pos of topPositions) {
  const escaped = pos.replace(/'/g, "''");
  const sub = await run(`
    WITH bucket_a AS (
      SELECT sp.supplier_product_code, sp.category, sp.sub_category, sp.print_details
      FROM supplier_products sp
      JOIN suppliers s ON s.id = sp.supplier_id
      WHERE s.slug = 'laltex'
        AND sp.is_retired = false
        AND jsonb_array_length(sp.print_details) >= 1
        AND (
          SELECT COUNT(*) FROM jsonb_array_elements(sp.print_details) pd,
                 jsonb_array_elements(COALESCE(pd->'print_area_coordinates', '[]'::jsonb)) pac
        ) = 0
    )
    SELECT COALESCE(sub_category, '(none)') AS sub_category,
           COUNT(DISTINCT supplier_product_code) AS n
    FROM bucket_a b,
         jsonb_array_elements(b.print_details) pd
    WHERE pd->>'print_position' = '${escaped}'
    GROUP BY sub_category
    ORDER BY n DESC
    LIMIT 8;
  `, `subcat-${pos}`);
  console.log(`\n  "${pos}" — top sub-categories:`);
  for (const s of sub) {
    console.log(`    ${String(s.sub_category).padEnd(36)} ${String(s.n).padStart(3)}`);
  }
}

// ---------- 5. Sample print_area strings per top position (for sizing decision) ----------
console.log('\n=== §2 — print_area dimension strings for top 8 positions ===\n');
for (const pos of topPositions) {
  const escaped = pos.replace(/'/g, "''");
  const dims = await run(`
    WITH bucket_a AS (
      SELECT sp.supplier_product_code, sp.print_details
      FROM supplier_products sp
      JOIN suppliers s ON s.id = sp.supplier_id
      WHERE s.slug = 'laltex'
        AND sp.is_retired = false
        AND jsonb_array_length(sp.print_details) >= 1
        AND (
          SELECT COUNT(*) FROM jsonb_array_elements(sp.print_details) pd,
                 jsonb_array_elements(COALESCE(pd->'print_area_coordinates', '[]'::jsonb)) pac
        ) = 0
    )
    SELECT pd->>'print_area' AS print_area_str,
           COUNT(DISTINCT supplier_product_code) AS n
    FROM bucket_a b,
         jsonb_array_elements(b.print_details) pd
    WHERE pd->>'print_position' = '${escaped}'
      AND pd->>'print_area' IS NOT NULL
      AND pd->>'print_area' <> ''
    GROUP BY pd->>'print_area'
    ORDER BY n DESC
    LIMIT 6;
  `, `pa-${pos}`);
  console.log(`\n  "${pos}" — most common print_area strings:`);
  if (dims.length === 0) console.log('    (no print_area data)');
  for (const d of dims) {
    console.log(`    ${String(d.print_area_str).padEnd(28)} ${String(d.n).padStart(3)}`);
  }
}

// ---------- 6. Test-shortlist candidates ----------
console.log('\n=== §4 — Test product candidate pool ===\n');

async function pickCandidates(positionName, category = null, subCategory = null, n = 3) {
  const escaped = positionName.replace(/'/g, "''");
  const catFilter = category ? `AND sp.category = '${category.replace(/'/g, "''")}'` : '';
  const subFilter = subCategory ? `AND sp.sub_category = '${subCategory.replace(/'/g, "''")}'` : '';
  return run(`
    WITH bucket_a AS (
      SELECT sp.supplier_product_code, sp.name, sp.category, sp.sub_category, sp.print_details, sp.in_stock
      FROM supplier_products sp
      JOIN suppliers s ON s.id = sp.supplier_id
      WHERE s.slug = 'laltex'
        AND sp.is_retired = false
        ${catFilter}
        ${subFilter}
        AND jsonb_array_length(sp.print_details) >= 1
        AND (
          SELECT COUNT(*) FROM jsonb_array_elements(sp.print_details) pd,
                 jsonb_array_elements(COALESCE(pd->'print_area_coordinates', '[]'::jsonb)) pac
        ) = 0
    )
    SELECT DISTINCT b.supplier_product_code, b.name, b.category, b.sub_category,
           b.in_stock,
           (
             SELECT string_agg(DISTINCT pd2->>'print_position', ', ' ORDER BY pd2->>'print_position')
             FROM jsonb_array_elements(b.print_details) pd2
           ) AS positions
    FROM bucket_a b,
         jsonb_array_elements(b.print_details) pd
    WHERE pd->>'print_position' = '${escaped}'
      AND b.in_stock = true
    ORDER BY b.supplier_product_code
    LIMIT ${n};
  `, `pick-${positionName}`);
}

console.log('\nDrinkware with "Wrap" position:');
console.table(await pickCandidates('Wrap', 'Drinkware'));

console.log('\nApparel with "Front" position:');
console.table(await pickCandidates('Front', 'Clothing'));

console.log('\nApparel with "Left Breast" position:');
console.table(await pickCandidates('Left Breast', 'Clothing'));

console.log('\nProducts with Wrap + Front + Back (multi-position bucket-(a)):');
const multiPos = await run(`
  WITH bucket_a AS (
    SELECT sp.supplier_product_code, sp.name, sp.category, sp.print_details, sp.in_stock
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id
    WHERE s.slug = 'laltex'
      AND sp.is_retired = false
      AND sp.in_stock = true
      AND jsonb_array_length(sp.print_details) >= 1
      AND (
        SELECT COUNT(*) FROM jsonb_array_elements(sp.print_details) pd,
               jsonb_array_elements(COALESCE(pd->'print_area_coordinates', '[]'::jsonb)) pac
      ) = 0
  )
  SELECT supplier_product_code, name, category,
         (SELECT string_agg(DISTINCT pd->>'print_position', ', ' ORDER BY pd->>'print_position')
          FROM jsonb_array_elements(print_details) pd) AS positions,
         jsonb_array_length(print_details) AS n_positions
  FROM bucket_a
  WHERE jsonb_array_length(print_details) >= 3
  ORDER BY n_positions DESC, supplier_product_code
  LIMIT 5;
`, 'multi-pos');
console.table(multiPos);

console.log('\nAccessories candidates (cufflinks/badges/keyrings):');
const accessories = await run(`
  WITH bucket_a AS (
    SELECT sp.supplier_product_code, sp.name, sp.category, sp.sub_category, sp.print_details, sp.in_stock
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id
    WHERE s.slug = 'laltex'
      AND sp.is_retired = false
      AND sp.in_stock = true
      AND jsonb_array_length(sp.print_details) >= 1
      AND (
        SELECT COUNT(*) FROM jsonb_array_elements(sp.print_details) pd,
               jsonb_array_elements(COALESCE(pd->'print_area_coordinates', '[]'::jsonb)) pac
      ) = 0
  )
  SELECT supplier_product_code, name, category, sub_category,
         (SELECT string_agg(DISTINCT pd->>'print_position', ', ' ORDER BY pd->>'print_position')
          FROM jsonb_array_elements(print_details) pd) AS positions
  FROM bucket_a
  WHERE (LOWER(name) LIKE '%cufflink%' OR LOWER(name) LIKE '%badge%' OR LOWER(name) LIKE '%keyring%'
         OR LOWER(name) LIKE '%key ring%' OR LOWER(name) LIKE '%pin%')
  ORDER BY supplier_product_code
  LIMIT 5;
`, 'accessories');
console.table(accessories);

console.log('\nLanyard candidates (Strap/Lanyard positions):');
const lanyards = await run(`
  WITH bucket_a AS (
    SELECT sp.supplier_product_code, sp.name, sp.category, sp.sub_category, sp.print_details, sp.in_stock
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id
    WHERE s.slug = 'laltex'
      AND sp.is_retired = false
      AND sp.in_stock = true
      AND jsonb_array_length(sp.print_details) >= 1
      AND (
        SELECT COUNT(*) FROM jsonb_array_elements(sp.print_details) pd,
               jsonb_array_elements(COALESCE(pd->'print_area_coordinates', '[]'::jsonb)) pac
      ) = 0
  )
  SELECT supplier_product_code, name, category, sub_category,
         (SELECT string_agg(DISTINCT pd->>'print_position', ', ' ORDER BY pd->>'print_position')
          FROM jsonb_array_elements(print_details) pd) AS positions
  FROM bucket_a
  WHERE (LOWER(name) LIKE '%lanyard%' OR sub_category ILIKE '%lanyard%')
  ORDER BY supplier_product_code
  LIMIT 5;
`, 'lanyards');
console.table(lanyards);

console.log('\nUnusual-position-name candidates (less-common position from §1 audit):');
const tail = positions.slice(-15).filter((r) => Number(r.product_count) >= 1 && Number(r.product_count) <= 5);
console.log('Tail-end positions (rare but present):');
for (const r of tail.slice(0, 10)) {
  console.log(`  ${String(r.position_name).padEnd(28)} count=${r.product_count} samples=${r.sample_products}`);
}

console.log('\n=== DONE ===');
