/**
 * Vercel Cron entry point — daily PGifts Direct → supplier_products mirror.
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

export const config = {
  maxDuration: 60, // seconds — 25 products, observed run is a few seconds
};

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

  try {
    const result = await syncCatalogMirror({ supabaseUrl, serviceRoleKey });
    for (const w of result.warnings) console.warn('[cron/sync-catalog-mirror]', w);
    const ok = result.live === result.shaped;
    return res.status(ok ? 200 : 500).json({
      status: ok ? 'completed' : 'count_mismatch',
      shaped: result.shaped,
      active: result.active,
      live: result.live,
      warnings: result.warnings,
    });
  } catch (err) {
    console.error('[cron/sync-catalog-mirror] fatal:', err);
    return res.status(500).json({ error: err?.message ?? String(err) });
  }
}
