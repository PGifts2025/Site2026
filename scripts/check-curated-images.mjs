#!/usr/bin/env node
/**
 * check-curated-images.mjs — manual run of the category image check +
 * thumbnailing. The same work runs automatically every night inside
 * api/cron/sync-catalog-mirror.js; the logic lives in
 * scripts/lib/category-images.js (CLAUDE.md §65.8). You don't need to run
 * this by hand — it's for backfills and debugging.
 *
 * Usage (site/.env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY):
 *   node scripts/check-curated-images.mjs            # only new/changed/stale products
 *   node scripts/check-curated-images.mjs --all      # re-check every product
 *   node scripts/check-curated-images.mjs --dry-run  # report only
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { processCategoryImages } from './lib/category-images.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const summary = await processCategoryImages({
  supabaseUrl: process.env.VITE_SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  force: process.argv.includes('--all'),
  dryRun: process.argv.includes('--dry-run'),
  log: (m) => console.log(`[curated-images] ${m}`),
});
for (const e of summary.errors) console.log(`  error: ${e}`);
if (summary.errors.length) process.exitCode = 1;
