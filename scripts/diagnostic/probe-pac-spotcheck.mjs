#!/usr/bin/env node
// PR #28 regression-protection spot-check (read-only). Builds three
// cohorts of PAC-driven Laltex products so Dave can verify the
// position-priority resolver generalises past MG0660:
//
//   Cohort A — Wrap group exists but is EMPTY of PAC; another
//              position group carries PAC. PR #28 must skip the
//              empty Wrap and land on the populated position.
//   Cohort B — Wrap group carries PAC. Resolver must still default
//              to Wrap (priority-1 hit).
//   Cohort C — No Wrap group at all. Resolver falls through to
//              Front > Back > others among the populated groups.
//
// All cohorts filter to in_stock=true AND is_retired=false.

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

// Reusable per-product position-shape view:
//   For every Laltex active+in_stock product, expose the list of
//   position groups and a flag per group for whether ANY row in the
//   group carries print_area_coordinates entries.
const baseCTE = `
  WITH active_laltex AS (
    SELECT sp.id, sp.supplier_product_code, sp.name, sp.sub_category,
           sp.category, sp.print_details
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id
    WHERE s.slug = 'laltex'
      AND sp.is_retired = false
      AND sp.in_stock = true
      AND jsonb_array_length(sp.print_details) >= 1
  ),
  per_position AS (
    SELECT al.id, al.supplier_product_code, al.name,
           al.sub_category, al.category,
           pd->>'print_position' AS position_name,
           (
             SELECT COUNT(*) FROM jsonb_array_elements(
               COALESCE(pd->'print_area_coordinates', '[]'::jsonb)
             )
           ) AS pac_count
    FROM active_laltex al,
         jsonb_array_elements(al.print_details) pd
  ),
  per_position_unique AS (
    SELECT id, supplier_product_code, name, sub_category, category,
           position_name,
           SUM(pac_count) AS pac_total_for_position
    FROM per_position
    GROUP BY id, supplier_product_code, name, sub_category, category, position_name
  ),
  product_shape AS (
    SELECT id, supplier_product_code, name, sub_category, category,
           bool_or(
             lower(trim(position_name)) = 'wrap'
           ) AS has_wrap_group,
           SUM(CASE WHEN lower(trim(position_name)) = 'wrap'
                    THEN pac_total_for_position ELSE 0 END) AS wrap_pac_count,
           SUM(CASE WHEN lower(trim(position_name)) <> 'wrap'
                    THEN pac_total_for_position ELSE 0 END) AS non_wrap_pac_count,
           SUM(pac_total_for_position) AS total_pac_count,
           string_agg(
             CASE WHEN pac_total_for_position > 0
                  THEN position_name || ' (' || pac_total_for_position || ' PAC)'
                  ELSE NULL END,
             ', ' ORDER BY position_name
           ) AS populated_positions
    FROM per_position_unique
    GROUP BY id, supplier_product_code, name, sub_category, category
  )
`;

// Cohort A — MG0660-shape: Wrap group present, Wrap empty of PAC,
// other position(s) populated.
console.log('=== Cohort A — Wrap group exists but empty; other position has PAC (MG0660 shape) ===\n');
const cohortA = await run(`
  ${baseCTE}
  SELECT supplier_product_code, name, sub_category, category,
         wrap_pac_count, non_wrap_pac_count, populated_positions
  FROM product_shape
  WHERE has_wrap_group = true
    AND wrap_pac_count = 0
    AND non_wrap_pac_count > 0
  ORDER BY sub_category, supplier_product_code
  LIMIT 12;
`, 'cohortA');
console.table(cohortA);

// Cohort B — Wrap populated. Includes MG0192 et al. PR #28 must
// still pick Wrap as canonical here.
console.log('\n=== Cohort B — Wrap populated (regression protection) ===\n');
const cohortB = await run(`
  ${baseCTE}
  SELECT supplier_product_code, name, sub_category, category,
         wrap_pac_count, non_wrap_pac_count, populated_positions
  FROM product_shape
  WHERE has_wrap_group = true
    AND wrap_pac_count > 0
  ORDER BY sub_category, supplier_product_code
  LIMIT 8;
`, 'cohortB');
console.table(cohortB);

// Cohort C — No Wrap at all. Front / Back / others.
console.log('\n=== Cohort C — No Wrap group at all (priority fallthrough) ===\n');
const cohortC = await run(`
  ${baseCTE}
  SELECT supplier_product_code, name, sub_category, category,
         wrap_pac_count, non_wrap_pac_count, populated_positions
  FROM product_shape
  WHERE has_wrap_group = false
    AND non_wrap_pac_count > 0
  ORDER BY sub_category, supplier_product_code
  LIMIT 12;
`, 'cohortC');
console.table(cohortC);

console.log('\n=== DONE ===');
