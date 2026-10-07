#!/usr/bin/env node
/**
 * migrate-catalog-to-supplier-products.js — manual run of the PGifts Direct
 * → supplier_products mirror. The same logic runs daily at 03:30 UTC via
 * api/cron/sync-catalog-mirror.js; the shaping lives in
 * scripts/lib/catalog-mirror.js (CLAUDE.md §65).
 *
 * Usage:
 *   node scripts/migrate-catalog-to-supplier-products.js           # live
 *   node scripts/migrate-catalog-to-supplier-products.js --dry-run # no writes
 *
 * Env required in site/.env:
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { syncCatalogMirror } from './lib/catalog-mirror.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[migrate] mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);

  const result = await syncCatalogMirror({
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    dryRun,
    log: (m) => console.log(`[migrate] ${m}`),
  });

  for (const s of result.summaries) {
    console.log(
      `[migrate] ${s.slug.padEnd(24)} → ${s.tiers} tiers, ` +
      `${s.print_rows} print_rows → ${s.print_details_entries} print_details, ` +
      `${s.colours} colours, ${s.images} images, ${s.features} features`,
    );
  }
  for (const w of result.warnings) console.log(`[migrate] WARNING: ${w}`);
  console.log(`[migrate] shaped: ${result.shaped}/${result.active}`);

  if (dryRun) {
    console.log('');
    console.log('[migrate] === DRY RUN OUTPUT (JSON) ===');
    console.log(JSON.stringify(result.rows, null, 2));
    console.log('');
    console.log('[migrate] dry-run complete — no writes performed');
    return;
  }

  console.log(`[migrate] upsert complete — ${result.shaped} rows sent, supplier_products now has ${result.live} rows under pgifts-direct`);
  if (result.live !== result.shaped) {
    console.log(`[migrate] WARNING: live count (${result.live}) does not match shaped count (${result.shaped})`);
    process.exitCode = 1;
  }
  console.log('[migrate] the 04:00 UTC embed cron re-embeds any row whose source text changed');
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err.message ?? err);
  process.exit(1);
});
