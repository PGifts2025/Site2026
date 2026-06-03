#!/usr/bin/env node
/**
 * Probe MG0110 visibility across supplier_products + retired/embed/curation gates.
 * Read-only — uses SUPABASE_ACCESS_TOKEN (PAT) against the Management SQL endpoint.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const PROJECT_REF = 'cbcevjhvgmxrxeeyldza';
const MGMT_SQL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN missing in .env');
  process.exit(1);
}

async function sql(q) {
  const r = await fetch(MGMT_SQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 400)}`);
  return JSON.parse(t);
}

const probes = [
  ['ILIKE mg0110 - any case', `SELECT supplier_product_code, name, is_retired, missing_from_feed_count, last_synced_at, embedding IS NOT NULL AS has_embedding, embedded_at FROM supplier_products WHERE supplier_product_code ILIKE 'mg0110';`],
  ['= MG0110 (case-sensitive upper)', `SELECT supplier_product_code FROM supplier_products WHERE supplier_product_code = 'MG0110';`],
  ['= mg0110 (case-sensitive lower)', `SELECT supplier_product_code FROM supplier_products WHERE supplier_product_code = 'mg0110';`],
  ['neighbour codes around MG0108..MG0112', `SELECT supplier_product_code, name, is_retired, embedding IS NOT NULL AS has_embedding FROM supplier_products WHERE supplier_product_code IN ('MG0108','MG0109','MG0110','MG0111','MG0112','mg0110') ORDER BY supplier_product_code;`],
  ['curation rows for mg0110 (case-insensitive)', `SELECT * FROM category_product_curation WHERE supplier_product_code ILIKE 'mg0110';`],
  ['lowercase codes in entire table - count + sample', `SELECT COUNT(*) AS lower_count FROM supplier_products WHERE supplier_product_code ~ '[a-z]';`],
  ['sample mixed-case rows', `SELECT supplier_product_code FROM supplier_products WHERE supplier_product_code ~ '[a-z]' ORDER BY supplier_product_code LIMIT 20;`],
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
