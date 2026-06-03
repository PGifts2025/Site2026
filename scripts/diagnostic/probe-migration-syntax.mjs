#!/usr/bin/env node
/**
 * Parse-check the new migration without executing it. Runs a transaction
 * that BEGIN ... ROLLBACK around the migration body so live state is
 * unchanged but Postgres validates every statement.
 *
 * Read-only effect (rolled back). Uses SUPABASE_ACCESS_TOKEN.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const URL = 'https://api.supabase.com/v1/projects/cbcevjhvgmxrxeeyldza/database/query';

const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260603_search_tsv_include_supplier_product_code.sql',
);
const sqlBody = fs.readFileSync(migrationPath, 'utf8');

// Strip the migration's own BEGIN/COMMIT so we can wrap with our own
// rollback transaction.
const stripped = sqlBody
  .replace(/^\s*BEGIN\s*;?\s*$/im, '')
  .replace(/^\s*COMMIT\s*;?\s*$/im, '');

const wrapped = `BEGIN;
${stripped}
ROLLBACK;`;

async function sql(q) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 1000)}`);
  return JSON.parse(t);
}

(async () => {
  console.log('Running migration body inside a BEGIN ... ROLLBACK transaction');
  console.log('(state will not be modified - this only validates syntax + parse correctness)');
  try {
    const res = await sql(wrapped);
    console.log('PARSE OK. Result:', JSON.stringify(res));
  } catch (e) {
    console.log('PARSE FAILED:');
    console.log(e.message);
    process.exit(1);
  }
})();
