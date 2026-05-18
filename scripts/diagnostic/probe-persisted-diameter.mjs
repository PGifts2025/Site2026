#!/usr/bin/env node
// Quick check: do persisted PAC entries actually carry diameter + shape?
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const PROJECT_REF = 'cbcevjhvgmxrxeeyldza';
const MGMT_SQL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const resp = await fetch(MGMT_SQL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `
    SELECT supplier_product_code, pd->>'print_position' AS pos, pac
    FROM supplier_products sp,
         jsonb_array_elements(sp.print_details) pd,
         jsonb_array_elements(COALESCE(pd->'print_area_coordinates','[]'::jsonb)) pac
    WHERE supplier_product_code = 'ZA0176'
      AND ((pac->>'width') IS NULL OR (pac->>'height') IS NULL)
    LIMIT 2
  `}),
});
const rows = await resp.json();
for (const r of rows) {
  console.log(`\n${r.supplier_product_code} / ${r.pos}`);
  console.log(JSON.stringify(r.pac, null, 2));
}
