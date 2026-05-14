/**
 * Compact size summary for AF0002, AF0010, AF0124 — instead of full JSON
 * dumps, just (position, size, type, price, is_default).
 */
import { config } from 'dotenv';
config();
const PROJECT_REF = 'cbcevjhvgmxrxeeyldza';
const token = process.env.SUPABASE_ACCESS_TOKEN;
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

for (const code of ['AF0002', 'AF0010', 'AF0124']) {
  const meta = await sql(`SELECT name, category, sub_category FROM supplier_products WHERE supplier_product_code='${code}' LIMIT 1;`);
  console.log(`\n=== ${code} — ${meta[0]?.name} (${meta[0]?.category} > ${meta[0]?.sub_category}) ===`);
  const rows = await sql(`
    SELECT pd->>'print_position' AS pos,
           pd->>'print_area' AS size,
           pd->>'print_type' AS type,
           pd->>'print_class' AS class,
           (pd->'default_print_option')::text AS is_default,
           pd->'print_price'->0->>'price' AS first_tier_price
    FROM supplier_products sp,
         LATERAL jsonb_array_elements(sp.print_details) AS pd
    WHERE sp.supplier_product_code = '${code}'
    ORDER BY pd->>'print_position', pd->>'print_area';
  `);
  console.table(rows);
}
