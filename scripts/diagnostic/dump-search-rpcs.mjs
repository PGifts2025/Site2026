#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const URL = 'https://api.supabase.com/v1/projects/cbcevjhvgmxrxeeyldza/database/query';

const r = await fetch(URL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `SELECT proname, pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname IN ('rpc_search_supplier_products','rpc_find_alternatives');`,
  }),
});
const rows = await r.json();
for (const row of rows) {
  console.log('\n===== ' + row.proname + ' =====');
  console.log(row.def);
}
