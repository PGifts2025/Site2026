/**
 * Vercel Cron entry point — Laltex live-stock refresh.
 *
 * SCHEDULE (the single editable value): site/vercel.json crons[] entry for
 * this path. Set to "0 6-22 * * *" = hourly, 17 runs/day. Vercel Cron fires in
 * UTC and cannot track DST, so this maps to 07:00-23:00 UK during BST (summer)
 * and 06:00-22:00 UK during GMT (winter). To change the cadence, edit ONLY that
 * one schedule string — the times are not hardcoded anywhere else.
 *
 * Auth:
 *   Authorization: Bearer ${CRON_SECRET}  — missing/wrong -> 401.
 *
 * Exec budget:
 *   maxDuration 300 s. ~1194 products at concurrency 8 finishes in well under
 *   a minute (audit-laltex-stock-availability.md §5), leaving ample headroom.
 *
 * Failure surface:
 *   - Auth failure            -> 401
 *   - Env var missing         -> 500 { missing: [...] }
 *   - Infra failure           -> 500, job_runs row marked 'failed'. Next hour retries.
 *   - Individual product fail -> job_failures row, run continues, response 200.
 *     A failed product keeps its PREVIOUS stock (skipped UPSERT), never wiped.
 *
 * Independent of the nightly product sync (sync-laltex) by design (CLAUDE.md
 * §27): a stock-endpoint outage must not block product sync and vice-versa.
 */

import { syncStock } from '../../scripts/lib/laltex-stock.js';

export const config = {
  maxDuration: 300, // seconds
};

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected) {
    return res.status(500).json({ error: 'CRON_SECRET not configured on Vercel' });
  }
  if (req.headers?.authorization !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const laltexApiKey = process.env.LALTEX_API_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [];
  if (!laltexApiKey) missing.push('LALTEX_API_KEY');
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    return res.status(500).json({ error: 'Missing required env vars', missing });
  }

  try {
    const result = await syncStock({
      laltexApiKey,
      supabaseUrl,
      serviceRoleKey,
      triggeredBy: 'cron',
    });
    const httpStatus = result.status === 'completed' ? 200 : 500;
    return res.status(httpStatus).json(result);
  } catch (err) {
    console.error('[cron/sync-laltex-stock] fatal:', err);
    return res.status(500).json({ error: err?.message ?? String(err) });
  }
}
