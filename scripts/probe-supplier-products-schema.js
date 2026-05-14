import { config } from 'dotenv';
config();

const PROJECT_REF = 'cbcevjhvgmxrxeeyldza';
const token = process.env.SUPABASE_ACCESS_TOKEN;

async function sql(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text}`);
  return JSON.parse(text);
}

const cols = await sql(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='supplier_products' ORDER BY ordinal_position;
`);
console.log('supplier_products columns:');
for (const c of cols) console.log(`  ${c.column_name.padEnd(28)} ${c.data_type}`);

// Top-level keys in raw_payload for AF0001
const keys = await sql(`
  SELECT jsonb_object_keys(raw_payload) AS key
  FROM supplier_products WHERE supplier_product_code='AF0001'
  ORDER BY key;
`);
console.log('\nraw_payload top-level keys for AF0001:');
for (const k of keys) console.log(`  ${k.key}`);
