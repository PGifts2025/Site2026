#!/usr/bin/env node
/**
 * Confirm the live state of search_tsv before migrating.
 * Read-only. Output goes into the PR body.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const URL = 'https://api.supabase.com/v1/projects/cbcevjhvgmxrxeeyldza/database/query';

async function sql(q) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 400)}`);
  return JSON.parse(t);
}

const probes = [
  ['Column shape (generation expression, type)', `SELECT column_name, data_type, is_generated, generation_expression FROM information_schema.columns WHERE table_name='supplier_products' AND column_name IN ('search_tsv','supplier_product_code');`],
  ['Indexes on search_tsv', `SELECT indexname, indexdef FROM pg_indexes WHERE tablename='supplier_products' AND indexname ILIKE '%search_tsv%';`],
  ['supplier_product_code length distribution', `SELECT MIN(LENGTH(supplier_product_code)) AS min_len, MAX(LENGTH(supplier_product_code)) AS max_len, AVG(LENGTH(supplier_product_code))::int AS avg_len, COUNT(*) AS rows FROM supplier_products;`],
  ['MG0110 current rank (baseline)', `SELECT supplier_product_code, ts_rank(search_tsv, websearch_to_tsquery('english', 'mg0110')) AS rank_lc, ts_rank(search_tsv, websearch_to_tsquery('english', 'MG0110')) AS rank_uc FROM supplier_products WHERE supplier_product_code = 'MG0110';`],
  ['Other code samples (baseline ranks)', `SELECT supplier_product_code, ts_rank(search_tsv, websearch_to_tsquery('english', supplier_product_code)) AS rank FROM supplier_products ORDER BY supplier_product_code LIMIT 10;`],
  ['View / trigger that may interact (sanity check)', `SELECT trigger_name, event_manipulation, action_statement FROM information_schema.triggers WHERE event_object_table = 'supplier_products';`],
];

(async () => {
  for (const [label, q] of probes) {
    console.log('\n=== ' + label + ' ===');
    try {
      const rows = await sql(q);
      console.log(JSON.stringify(rows, null, 2));
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  }
})();
