#!/usr/bin/env node
/**
 * BEGIN+ROLLBACK dry-run: apply the new migration, run the four
 * verification queries from the PR prompt INSIDE the transaction,
 * then ROLLBACK so live state is unchanged.
 *
 * If MG0110 ranks > 0 inside the tx and 0 after rollback, the fix
 * is proven both effective and isolated.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
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

const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260604_search_tsv_use_simple_for_supplier_product_code.sql',
);
const sqlBody = fs.readFileSync(migrationPath, 'utf8');

// Strip migration's own BEGIN/COMMIT so we can wrap with our own transaction
const stripped = sqlBody
  .replace(/^\s*BEGIN\s*;?\s*$/im, '')
  .replace(/^\s*COMMIT\s*;?\s*$/im, '');

// Verification queries (run inside the same tx, before ROLLBACK)
const verificationSelect = `
SELECT * FROM (
  -- Q1: MG0110 should now rank > 0
  SELECT
    'Q1-MG0110-ranks' AS label,
    json_build_object(
      'supplier_product_code', supplier_product_code,
      'rank_simple_query', ts_rank(search_tsv, websearch_to_tsquery('simple','mg0110'))::text,
      'rank_english_query', ts_rank(search_tsv, websearch_to_tsquery('english','mg0110'))::text,
      'search_tsv_contains_mg0110', (search_tsv::text LIKE '%''mg0110''%')
    ) AS result
  FROM supplier_products WHERE supplier_product_code = 'MG0110'
) q1
UNION ALL
SELECT * FROM (
  -- Q2: 10 random rows - all should rank > 0 when queried by own code
  SELECT 'Q2-random-10-sample' AS label, json_build_object(
    'supplier_product_code', supplier_product_code,
    'rank', ts_rank(search_tsv, websearch_to_tsquery('simple', supplier_product_code))::text
  ) AS result
  FROM supplier_products ORDER BY random() LIMIT 10
) q2
UNION ALL
SELECT * FROM (
  -- Q3: regression check - polo tumbler should still rank MG0110 #1
  SELECT 'Q3-polo-tumbler-regression' AS label, json_build_object(
    'supplier_product_code', supplier_product_code,
    'name', name,
    'rank', ts_rank(search_tsv, websearch_to_tsquery('english','polo tumbler'))::text
  ) AS result
  FROM supplier_products
  ORDER BY ts_rank(search_tsv, websearch_to_tsquery('english','polo tumbler')) DESC
  LIMIT 3
) q3
;
`;

const wrapped = `BEGIN;
${stripped}

${verificationSelect}

ROLLBACK;
`;

(async () => {
  console.log('=== Step 1: live state BEFORE dry-run ===');
  const before = await sql(`SELECT supplier_product_code, ts_rank(search_tsv, websearch_to_tsquery('simple', 'mg0110')) AS rank FROM supplier_products WHERE supplier_product_code = 'MG0110';`);
  console.log(JSON.stringify(before, null, 2));

  console.log('\n=== Step 2: dry-run (migration body + verification SELECTs inside BEGIN/ROLLBACK) ===');
  const inside = await sql(wrapped);
  console.log(JSON.stringify(inside, null, 2));

  console.log('\n=== Step 3: live state AFTER rollback (should equal Step 1) ===');
  const after = await sql(`SELECT supplier_product_code, ts_rank(search_tsv, websearch_to_tsquery('simple', 'mg0110')) AS rank FROM supplier_products WHERE supplier_product_code = 'MG0110';`);
  console.log(JSON.stringify(after, null, 2));

  console.log('\n=== Step 4: live generation_expression (should still be original, no supplier_product_code) ===');
  const expr = await sql(`SELECT generation_expression FROM information_schema.columns WHERE table_name='supplier_products' AND column_name='search_tsv';`);
  const stillOriginal = !expr[0].generation_expression.includes('supplier_product_code');
  console.log('Live state unchanged?', stillOriginal ? 'YES' : 'NO - live state was mutated, ROLLBACK failed');
})();
