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
for (const table of ['quote_items', 'order_items', 'order_artwork']) {
  const cols = await sql(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='${table}' ORDER BY ordinal_position;
  `);
  console.log(`\n=== ${table} (${cols.length} cols) ===`);
  for (const c of cols) console.log(`  ${c.column_name.padEnd(28)} ${c.data_type}`);
}
