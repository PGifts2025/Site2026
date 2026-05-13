import { config } from 'dotenv';
config();

const PROJECT_REF = 'cbcevjhvgmxrxeeyldza';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN missing');
  process.exit(1);
}

const sql = `
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'user_designs'
  ORDER BY ordinal_position;
`;

const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

const text = await resp.text();
if (!resp.ok) {
  console.error(`HTTP ${resp.status}: ${text}`);
  process.exit(1);
}

const rows = JSON.parse(text);
console.log(`user_designs has ${rows.length} columns:`);
console.log('');
for (const r of rows) {
  console.log(`  ${r.column_name.padEnd(28)} ${r.data_type.padEnd(28)} ${r.is_nullable}`);
}
