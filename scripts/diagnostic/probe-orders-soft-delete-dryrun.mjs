#!/usr/bin/env node
/**
 * BEGIN+ROLLBACK dry-run for 20260629_orders_soft_delete.sql.
 *
 * Applies the migration body inside a transaction, runs the four
 * verification queries (Q1-Q4) INSIDE the same tx, plus a soft-delete /
 * restore round-trip against a real order id, then ROLLBACKs so live
 * state is unchanged.
 *
 * Q1: column exists, correct type / nullable / default
 * Q2: partial index created
 * Q3: RLS policy amended (qual contains AND deleted_at IS NULL)
 * Q4: a) soft-delete a real row -> service-role still sees it with
 *        deleted_at populated (that's correct; admin UI hides it via
 *        the JS filter)
 *     b) restore -> deleted_at back to NULL
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
if (!TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN missing in .env');
  process.exit(1);
}

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
  '20260629_orders_soft_delete.sql',
);
const sqlBody = fs.readFileSync(migrationPath, 'utf8');

// Strip migration's own BEGIN/COMMIT so we wrap with our own tx
const stripped = sqlBody
  .replace(/^\s*BEGIN\s*;?\s*$/im, '')
  .replace(/^\s*COMMIT\s*;?\s*$/im, '');

(async () => {
  console.log('=== STEP 0: Pick a real order id for the round-trip test ===');
  const pick = await sql(
    `SELECT id, order_number FROM orders ORDER BY created_at DESC LIMIT 1;`,
  );
  if (!pick[0]) {
    console.log('No orders in the table - cannot run Q4 round-trip. Aborting.');
    process.exit(1);
  }
  const testId = pick[0].id;
  const testNum = pick[0].order_number;
  console.log(`Using order ${testNum} (id=${testId}) for round-trip`);

  console.log('\n=== STEP 1: Pre-migration sanity (live state) ===');
  const preExpr = await sql(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='deleted_at') AS column_exists;`,
  );
  console.log('  Live deleted_at column already exists?', preExpr[0].column_exists);

  const prePolicy = await sql(
    `SELECT qual FROM pg_policies WHERE tablename='orders' AND policyname='Users view own orders';`,
  );
  console.log('  Live "Users view own orders" qual:');
  console.log('   ', prePolicy[0]?.qual ?? '(policy missing)');

  console.log('\n=== STEP 2: BEGIN + migration + Q1-Q4 + ROLLBACK ===');
  // Capture all verification rows into a TEMP table so the final SELECT
  // returns everything in one round-trip. WITH ... UPDATE inside a
  // subquery isn't allowed by PG (must be top-level), hence the
  // separate UPDATE statements + temp-table accumulator pattern.
  const wrapped = `
BEGIN;

${stripped}

CREATE TEMP TABLE _verify (label text, result jsonb);

-- Q1: column shape
INSERT INTO _verify
SELECT 'Q1-column-shape', json_build_object(
  'column_name', column_name,
  'data_type', data_type,
  'is_nullable', is_nullable,
  'column_default', column_default
)
FROM information_schema.columns
WHERE table_name='orders' AND column_name='deleted_at';

-- Q2: partial index
INSERT INTO _verify
SELECT 'Q2-partial-index', json_build_object(
  'indexname', indexname,
  'indexdef', indexdef
)
FROM pg_indexes
WHERE tablename='orders' AND indexname='orders_active_idx';

-- Q3: RLS amendment - qual must contain "deleted_at IS NULL"
INSERT INTO _verify
SELECT 'Q3-rls-amended', json_build_object(
  'policyname', policyname,
  'cmd', cmd,
  'qual', qual,
  'contains_deleted_at_clause', position('deleted_at IS NULL' in qual) > 0
)
FROM pg_policies
WHERE tablename='orders' AND policyname='Users view own orders';

-- Q4a: soft-delete the test order
UPDATE orders SET deleted_at = NOW() WHERE id = '${testId}';
INSERT INTO _verify
SELECT 'Q4a-after-soft-delete', json_build_object(
  'order_number', order_number,
  'deleted_at_is_set', deleted_at IS NOT NULL,
  'service_role_can_still_see_row', true
)
FROM orders WHERE id = '${testId}';

-- Q4b: confirm filtered-vs-unfiltered visibility (service role)
INSERT INTO _verify
SELECT 'Q4b-service-role-filtered-vs-unfiltered', json_build_object(
  'unfiltered_finds_row', EXISTS (SELECT 1 FROM orders WHERE id = '${testId}'),
  'filtered_finds_row', EXISTS (SELECT 1 FROM orders WHERE id = '${testId}' AND deleted_at IS NULL)
);

-- Q4c: restore, confirm deleted_at back to NULL
UPDATE orders SET deleted_at = NULL WHERE id = '${testId}';
INSERT INTO _verify
SELECT 'Q4c-after-restore', json_build_object(
  'order_number', order_number,
  'deleted_at_after_restore', deleted_at
)
FROM orders WHERE id = '${testId}';

-- Return everything captured.
SELECT label, result FROM _verify ORDER BY label;

ROLLBACK;
`;
  const dryrun = await sql(wrapped);
  console.log(JSON.stringify(dryrun, null, 2));

  console.log('\n=== STEP 3: Post-rollback - confirm live state is unchanged ===');
  const postExpr = await sql(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='deleted_at') AS column_exists;`,
  );
  console.log('  deleted_at column on live orders?', postExpr[0].column_exists);
  const postPolicy = await sql(
    `SELECT qual FROM pg_policies WHERE tablename='orders' AND policyname='Users view own orders';`,
  );
  console.log('  Live qual unchanged?',
    postPolicy[0]?.qual === prePolicy[0]?.qual ? 'YES' : 'NO - LIVE MUTATED');
  const postCol = await sql(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='deleted_at') AS exists;`,
  );
  console.log(`  deleted_at column on live orders post-rollback?`, postCol[0].exists, '(expected: false)');

  console.log('\nDONE.');
})();
