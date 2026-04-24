/**
 * Vercel Cron entry point — nightly Laltex embed.
 *
 * Scheduled in site/vercel.json at 04:00 UTC daily (1 hour after the
 * 03:00 sync cron — see CLAUDE.md §27 for the split rationale).
 *
 * Auth + env-guard pattern cloned from api/cron/sync-laltex.js:
 *   Authorization: Bearer ${CRON_SECRET}  — missing/wrong → 401
 *   Missing env var → 500 with { missing: [...] }
 *
 * Exec budget:
 *   maxDuration: 300. Observed steady-state run is < 5s (hash gate
 *   skips everything). First-run / post-sync-change run embeds the
 *   changed subset in a single OpenAI batch call, typically a few
 *   seconds. Well under budget.
 *
 * Failure surface:
 *   - Auth failure            → 401
 *   - Env var missing         → 500
 *   - OpenAI batch failure    → 500, job_runs row marked 'failed',
 *                               errorMessage populated. Next cron retries.
 *   - Per-row UPDATE failure  → job_failures row, embed continues,
 *                               response still 200 with failed>0.
 */

import { embedCatalogue } from '../../scripts/lib/laltex-embed.js';

export const config = {
  maxDuration: 300, // seconds
};

export default async function handler(req, res) {
  // 1. Auth
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected) {
    return res.status(500).json({ error: 'CRON_SECRET not configured on Vercel' });
  }
  if (req.headers?.authorization !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 2. Required env
  const openaiKey = process.env.OPENAI_API_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [];
  if (!openaiKey) missing.push('OPENAI_API_KEY');
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    return res.status(500).json({
      error: 'Missing required env vars',
      missing,
    });
  }

  // 3. Run embed
  try {
    const result = await embedCatalogue({
      openaiKey,
      supabaseUrl,
      serviceRoleKey,
      triggeredBy: 'cron',
    });
    const httpStatus = result.status === 'completed' ? 200 : 500;
    return res.status(httpStatus).json(result);
  } catch (err) {
    console.error('[cron/embed-laltex] fatal:', err);
    return res.status(500).json({ error: err?.message ?? String(err) });
  }
}
