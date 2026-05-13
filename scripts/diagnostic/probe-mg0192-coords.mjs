#!/usr/bin/env node
// One-shot probe — list (position, colour, image_url) tuples for MG0192's
// print_area_coordinates. Session 7 diagnostic, not committed long-term.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PROJECT_REF = 'cbcevjhvgmxrxeeyldza';
const MGMT_SQL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

const SQL = `
SELECT
  pd->>'print_position' AS position,
  pac->>'colour'        AS coord_colour,
  pac->>'image_url'     AS coord_image_url,
  pac->>'x'             AS x,
  pac->>'y'             AS y,
  pac->>'width'         AS width,
  pac->>'height'        AS height
FROM supplier_products sp,
     jsonb_array_elements(sp.print_details) pd,
     jsonb_array_elements(pd->'print_area_coordinates') pac
WHERE sp.supplier_product_code = 'MG0192'
ORDER BY pd->>'print_position', (pac->>'colour');
`;

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('SUPABASE_ACCESS_TOKEN missing'); process.exit(1); }

const resp = await fetch(MGMT_SQL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: SQL }),
});
const text = await resp.text();
if (!resp.ok) {
  console.error(`HTTP ${resp.status}`);
  console.error(text);
  process.exit(1);
}
const rows = JSON.parse(text);
console.log(`rows: ${rows.length}\n`);
for (const r of rows) {
  console.log(`${(r.position || '').padEnd(10)} | ${(r.coord_colour || '').padEnd(20)} | x=${r.x} y=${r.y} ${r.width}x${r.height} | ${r.coord_image_url}`);
}
