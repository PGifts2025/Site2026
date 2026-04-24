/**
 * Vercel Cron entry point — nightly Laltex catalogue sync.
 *
 * Scheduled in site/vercel.json at 03:00 UTC daily.
 *
 * Auth:
 *   Authorization: Bearer ${CRON_SECRET}
 *   Missing or wrong -> 401 (no body mention of "unauthorised" — just status).
 *
 * Exec budget:
 *   export const config = { maxDuration: 300 } — 5 minutes, the max
 *   allowed on Vercel Pro. Observed single-run duration is well under
 *   that (see CLAUDE.md §27). Embeddings live in a separate cron (3b)
 *   specifically so the 5-min ceiling never pressures this one.
 *
 * Failure surface:
 *   - Auth failure            -> 401
 *   - Env var missing         -> 500
 *   - Laltex network failure  -> 500, sync_runs row marked 'failed',
 *                                errorMessage populated. Next cron retries.
 *   - Individual product fail -> sync_failures row, sync continues,
 *                                response still 200.
 */

import { syncFullCatalogue } from '../../scripts/lib/laltex-sync.js';

export const config = {
  maxDuration: 300, // seconds
};

export default async function handler(req, res) {
  // -------------------------------------------------------------------------
  // 1. Auth — strictly Bearer ${CRON_SECRET}
  // -------------------------------------------------------------------------
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected) {
    return res.status(500).json({ error: 'CRON_SECRET not configured on Vercel' });
  }
  if (req.headers?.authorization !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // -------------------------------------------------------------------------
  // 2. Required env
  // -------------------------------------------------------------------------
  const laltexApiKey = process.env.LALTEX_API_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [];
  if (!laltexApiKey) missing.push('LALTEX_API_KEY');
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    return res.status(500).json({
      error: 'Missing required env vars',
      missing,
    });
  }

  // -------------------------------------------------------------------------
  // 3. Run sync
  // -------------------------------------------------------------------------
  try {
    const result = await syncFullCatalogue({
      laltexApiKey,
      supabaseUrl,
      serviceRoleKey,
      triggeredBy: 'cron',
    });
    // 200 even when some products failed — that's continue-with-logging.
    // Only infra-level run failure yields non-200 below (via caught exception
    // path, which also logged the failure into sync_runs.error_message).
    const httpStatus = result.status === 'completed' ? 200 : 500;
    return res.status(httpStatus).json(result);
  } catch (err) {
    console.error('[cron/sync-laltex] fatal:', err);
    return res.status(500).json({ error: err?.message ?? String(err) });
  }
}
