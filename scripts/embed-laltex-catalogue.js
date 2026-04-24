#!/usr/bin/env node
/**
 * embed-laltex-catalogue.js — local CLI runner for the full embed job.
 *
 * Thin wrapper around embedCatalogue(). Loads env, prints progress,
 * exits 0/1 based on outcome.
 *
 * Usage:
 *   node scripts/embed-laltex-catalogue.js
 *
 * Env required in site/.env:
 *   OPENAI_API_KEY            — embeddings-only restricted key
 *   VITE_SUPABASE_URL         — Supabase PostgREST base URL
 *   SUPABASE_SERVICE_ROLE_KEY — server-side key, RLS-bypassing
 *
 * Exit codes:
 *   0 — status='completed'
 *   1 — status='failed'
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { embedCatalogue } from './lib/laltex-embed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const openaiKey = process.env.OPENAI_API_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing = [];
  if (!openaiKey) missing.push('OPENAI_API_KEY');
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    console.error(`[embed] missing env vars in site/.env: ${missing.join(', ')}`);
    process.exit(1);
  }

  const keyTail = openaiKey.length >= 4 ? openaiKey.slice(-4) : '****';
  console.log(`[embed] starting full-catalogue embed (openai key ...${keyTail})`);

  const result = await embedCatalogue({
    openaiKey,
    supabaseUrl,
    serviceRoleKey,
    triggeredBy: 'cli',
  });

  console.log('');
  console.log('[embed] RESULT');
  console.log(`  run_id           : ${result.runId}`);
  console.log(`  status           : ${result.status}`);
  console.log(`  considered       : ${result.considered}`);
  console.log(`  embed_requested  : ${result.embedRequested}`);
  console.log(`  embed_skipped    : ${result.embedSkipped}`);
  console.log(`  updated          : ${result.updated}`);
  console.log(`  failed           : ${result.failed}`);
  console.log(`  tokens_used      : ${result.tokensUsed}`);
  console.log(`  cost_usd         : $${result.costUsd.toFixed(6)}`);
  console.log(`  duration_ms      : ${result.durationMs}`);
  if (result.errorMessage) console.log(`  error_message    : ${result.errorMessage}`);
  console.log('');
  console.log('  To inspect failures:');
  console.log(`    SELECT reason, COUNT(*) FROM job_failures WHERE job_run_id = '${result.runId}' GROUP BY reason;`);
  console.log('');

  process.exit(result.status === 'completed' ? 0 : 1);
}

main().catch((err) => {
  console.error('[embed] UNCAUGHT:', err);
  process.exit(1);
});
