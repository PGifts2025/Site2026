#!/usr/bin/env node
/**
 * sync-laltex-stock.js — local CLI runner for the Laltex stock refresh.
 *
 * Thin wrapper around syncStock(). Loads env, prints progress, exits 0/1.
 *
 * Usage:
 *   node scripts/sync-laltex-stock.js
 *   node scripts/sync-laltex-stock.js --concurrency=4
 *   node scripts/sync-laltex-stock.js --max-failures=50
 *
 * Env required in site/.env:
 *   LALTEX_API_KEY             — Laltex API key (API_KEY header)
 *   VITE_SUPABASE_URL          — Supabase PostgREST base URL
 *   SUPABASE_SERVICE_ROLE_KEY  — server-side key, RLS-bypassing
 *
 * Exit codes:
 *   0  — status='completed' AND products_failed < MAX_FAILURES
 *   1  — status='failed' OR products_failed >= MAX_FAILURES
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { syncStock } from './lib/laltex-stock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DEFAULT_MAX_FAILURES = 100;

function parseArgs(argv) {
  const out = { maxFailures: DEFAULT_MAX_FAILURES, concurrency: undefined };
  for (const a of argv.slice(2)) {
    let m = /^--max-failures=(\d+)$/.exec(a);
    if (m) { out.maxFailures = parseInt(m[1], 10); continue; }
    m = /^--concurrency=(\d+)$/.exec(a);
    if (m) { out.concurrency = parseInt(m[1], 10); continue; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);

  const laltexApiKey = process.env.LALTEX_API_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing = [];
  if (!laltexApiKey) missing.push('LALTEX_API_KEY');
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    console.error(`[stock] missing env vars in site/.env: ${missing.join(', ')}`);
    process.exit(1);
  }

  const keyTail = laltexApiKey.length >= 4 ? laltexApiKey.slice(-4) : '****';
  console.log(`[stock] starting live-stock refresh (laltex key ...${keyTail})`);

  const result = await syncStock({
    laltexApiKey,
    supabaseUrl,
    serviceRoleKey,
    triggeredBy: 'cli',
    concurrency: args.concurrency,
  });

  console.log('');
  console.log('[stock] RESULT');
  console.log(`  run_id       : ${result.runId}`);
  console.log(`  status       : ${result.status}`);
  console.log(`  fetched      : ${result.fetched}`);
  console.log(`  updated      : ${result.updated}`);
  console.log(`  failed       : ${result.failed}`);
  console.log(`  duration_ms  : ${result.durationMs}`);
  if (result.errorMessage) console.log(`  error_message: ${result.errorMessage}`);
  console.log('');
  console.log('  To inspect failures:');
  console.log(`    SELECT reason, COUNT(*) FROM job_failures WHERE job_run_id = '${result.runId}' GROUP BY reason;`);
  console.log('');

  if (result.status !== 'completed') process.exit(1);
  if (result.failed >= args.maxFailures) {
    console.error(`[stock] failure count ${result.failed} >= threshold ${args.maxFailures} — exit 1`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[stock] UNCAUGHT:', err);
  process.exit(1);
});
