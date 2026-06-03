#!/usr/bin/env node
/**
 * Reproduce the bug Dave reported: alphanumeric codes rank 0 even though
 * supplier_product_code is now in search_tsv. Investigate by comparing
 * 'english' vs 'simple' tsconfig output for code-shaped inputs.
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
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 600)}`);
  return JSON.parse(t);
}

const probes = [
  ['Live generation_expression on search_tsv', `SELECT generation_expression FROM information_schema.columns WHERE table_name='supplier_products' AND column_name='search_tsv';`],

  ['Standalone tokenisation: english vs simple on MG0110', `SELECT to_tsvector('english','MG0110') AS english_uc, to_tsvector('english','mg0110') AS english_lc, to_tsvector('simple','MG0110') AS simple_uc, to_tsvector('simple','mg0110') AS simple_lc;`],

  ['Standalone tokenisation on more codes', `SELECT
     to_tsvector('english','MG1052') AS english_MG1052, to_tsvector('simple','MG1052') AS simple_MG1052,
     to_tsvector('english','QB0573') AS english_QB0573, to_tsvector('simple','QB0573') AS simple_QB0573,
     to_tsvector('english','AA0131') AS english_AA0131, to_tsvector('simple','AA0131') AS simple_AA0131,
     to_tsvector('english','edge-classic') AS english_slug, to_tsvector('simple','edge-classic') AS simple_slug;`],

  ['Actual search_tsv for MG0110 (what is indexed right now)', `SELECT supplier_product_code, search_tsv FROM supplier_products WHERE supplier_product_code = 'MG0110';`],

  ['Actual search_tsv for QB0573 (what is indexed right now)', `SELECT supplier_product_code, search_tsv FROM supplier_products WHERE supplier_product_code = 'QB0573';`],

  ['Rank check: english vs simple query against current index', `SELECT supplier_product_code,
     ts_rank(search_tsv, websearch_to_tsquery('english','mg0110')) AS rank_english_query,
     ts_rank(search_tsv, websearch_to_tsquery('simple','mg0110')) AS rank_simple_query
   FROM supplier_products WHERE supplier_product_code = 'MG0110';`],

  ['Does the MG0110 lexeme actually appear anywhere in the indexed tsvector?', `SELECT supplier_product_code, search_tsv::text LIKE '%mg0110%' AS contains_code_lexeme FROM supplier_products WHERE supplier_product_code = 'MG0110';`],

  ['websearch_to_tsquery output for codes', `SELECT websearch_to_tsquery('english','MG0110') AS q_eng, websearch_to_tsquery('simple','MG0110') AS q_simple;`],
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
