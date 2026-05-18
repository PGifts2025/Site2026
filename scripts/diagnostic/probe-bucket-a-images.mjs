#!/usr/bin/env node
// Phase 1 sanity-check helper — fetch primary image URL + position list
// for the 4 specific products called out in the implementation prompt.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const PROJECT_REF = 'cbcevjhvgmxrxeeyldza';
const MGMT_SQL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('SUPABASE_ACCESS_TOKEN missing'); process.exit(1); }

async function run(query) {
  const resp = await fetch(MGMT_SQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text}`);
  return JSON.parse(text);
}

const codes = ['MG0061', 'HF0006', 'TPC000550', 'CF1007'];
for (const code of codes) {
  const rows = await run(`
    SELECT
      sp.supplier_product_code,
      sp.name,
      sp.images,
      sp.plain_images,
      sp.items,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'position', pd->>'print_position',
          'print_area', pd->>'print_area',
          'print_type', pd->>'print_type'
        ))
        FROM jsonb_array_elements(sp.print_details) pd
      ) AS positions
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id
    WHERE s.slug = 'laltex'
      AND sp.supplier_product_code = '${code}';
  `);
  if (!rows[0]) { console.log(`${code}: NOT FOUND`); continue; }
  const r = rows[0];
  console.log(`\n=== ${r.supplier_product_code} — ${r.name} ===`);

  // image candidates: plain_images[0], images[0], items[0].item_images[0]
  const plain = Array.isArray(r.plain_images) ? r.plain_images : [];
  const imgs  = Array.isArray(r.images) ? r.images : [];
  const items = Array.isArray(r.items) ? r.items : [];
  console.log(`  plain_images[0]:        ${plain[0]?.url || plain[0] || '(none)'}`);
  console.log(`  images[0]:              ${imgs[0]?.url || imgs[0] || '(none)'}`);
  console.log(`  items[0].plain_images:  ${items[0]?.plain_images?.[0] || '(none)'}`);
  console.log(`  items[0].item_images:   ${items[0]?.item_images?.[0] || '(none)'}`);
  console.log(`  items count: ${items.length}, first item colour: ${items[0]?.colour || items[0]?.name || '?'}`);
  console.log(`  positions (${r.positions?.length || 0}):`);
  for (const p of (r.positions || [])) {
    console.log(`    ${String(p.position).padEnd(28)} area=${p.print_area || '-'}  type=${p.print_type || '-'}`);
  }
}
