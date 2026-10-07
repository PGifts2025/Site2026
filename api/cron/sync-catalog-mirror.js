/**
 * Vercel Cron entry point — nightly catalogue sync, two steps:
 *   1. PGifts Direct → supplier_products mirror (AI search data);
 *   2. category card images: check new/changed/stale curated products' images
 *      and make thumbnails (scripts/lib/category-images.js, CLAUDE.md §65.8),
 *      within the remaining time budget — leftovers carry over to next night.
 *
 * Scheduled in site/vercel.json at 03:30 UTC daily: after the 03:00 Laltex
 * sync, before the 04:00 embed cron (which re-embeds changed rows).
 * Keeps the AI search layer's MOQ, tiers and lead time in step with the
 * catalogue, and keeps last_synced_at inside the search RPCs' 14-day
 * freshness window (CLAUDE.md §65).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}, as sync-laltex.js.
 */

import { syncCatalogMirror } from '../../scripts/lib/catalog-mirror.js';
import { processCategoryImages } from '../../scripts/lib/category-images.js';

const MAX_DURATION_S = 300;
export const config = {
  maxDuration: MAX_DURATION_S, // mirror takes seconds; the image step uses the rest
};
// Stop starting new image work this long before the function limit.
const IMAGE_SAFETY_MARGIN_MS = 45_000;

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected) {
    return res.status(500).json({ error: 'CRON_SECRET not configured on Vercel' });
  }
  if (req.headers?.authorization !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [];
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    return res.status(500).json({ error: 'Missing required env vars', missing });
  }

  const started = Date.now();
  try {
    const result = await syncCatalogMirror({ supabaseUrl, serviceRoleKey });
    for (const w of result.warnings) console.warn('[cron/sync-catalog-mirror]', w);
    const ok = result.live === result.shaped;

    // Step 2 — category images. Its failure never fails the mirror step.
    let images;
    try {
      images = await processCategoryImages({
        supabaseUrl,
        serviceRoleKey,
        timeBudgetMs: MAX_DURATION_S * 1000 - IMAGE_SAFETY_MARGIN_MS - (Date.now() - started),
        log: (m) => console.log('[cron/sync-catalog-mirror]', m),
      });
      for (const e of images.errors) console.warn('[cron/sync-catalog-mirror] image', e);
    } catch (err) {
      console.error('[cron/sync-catalog-mirror] category images failed:', err);
      images = { error: err?.message ?? String(err) };
    }

    return res.status(ok ? 200 : 500).json({
      status: ok ? 'completed' : 'count_mismatch',
      shaped: result.shaped,
      active: result.active,
      live: result.live,
      warnings: result.warnings,
      images,
    });
  } catch (err) {
    console.error('[cron/sync-catalog-mirror] fatal:', err);
    return res.status(500).json({ error: err?.message ?? String(err) });
  }
}
