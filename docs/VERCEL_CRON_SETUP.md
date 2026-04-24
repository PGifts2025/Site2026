# Vercel Cron setup — Laltex nightly sync

This document is the single reference for configuring, testing, and
recovering from the nightly Laltex sync cron. Everything below also lives
(summarised) in [`.claude/CLAUDE.md §27`](../.claude/CLAUDE.md), but this
is the operational playbook.

## 1. Architecture at a glance

| Piece | Location |
|---|---|
| Cron declaration | [`site/vercel.json`](../vercel.json) — `crons[]` entry, `0 3 * * *` UTC |
| Handler route | [`site/api/cron/sync-laltex.js`](../api/cron/sync-laltex.js) — Vercel Serverless Function, `maxDuration: 300` |
| Core sync logic | [`site/scripts/lib/laltex-sync.js`](../scripts/lib/laltex-sync.js) |
| Parsing helpers | [`site/scripts/lib/laltex-parser.js`](../scripts/lib/laltex-parser.js) |
| Local CLI runner | [`site/scripts/sync-laltex-catalogue.js`](../scripts/sync-laltex-catalogue.js) — same code path, `triggered_by='cli'` |
| Observability | `sync_runs` + `sync_failures` tables (migration `20260424_sync_runs_and_failures.sql`) |

Session 3b adds a separate 04:00 UTC cron for embeddings. Each cron has
its own 5-minute budget.

## 2. Required Vercel env vars

Set in the Vercel Dashboard (Project → Settings → Environment Variables),
or via the CLI. All four must exist for **Production** and
**Preview** environments (Preview is needed for smoke-testing a branch).

| Var | Source | Notes |
|---|---|---|
| `CRON_SECRET` | Generate locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | Must match `site/.env`'s value exactly. Rotate by updating both sides. |
| `LALTEX_API_KEY` | Laltex admin (Anastasia) | Passed as `API_KEY:` header to Laltex (not `Bearer`). |
| `VITE_SUPABASE_URL` | Supabase Dashboard → Project Settings → API | Already set (used by the frontend too). PostgREST lives at `${VITE_SUPABASE_URL}/rest/v1`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API → `service_role` `secret` | **RLS-bypassing.** Never expose to the browser, never commit. Used only by the sync cron + local CLI. Distinct from `SUPABASE_ACCESS_TOKEN` (PAT, Management API). |

Exact CLI commands used for initial setup (recorded for reproducibility —
adjust the environment argument if you want Preview / Development too):

```bash
vercel env add CRON_SECRET production
vercel env add LALTEX_API_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
# VITE_SUPABASE_URL already present.
```

Each prompt asks for the value at the terminal. Paste and confirm.

After adding, trigger a redeploy so the function picks up the new
secrets: `vercel --prod` (or push a commit / re-deploy from the
Dashboard).

## 3. Manually triggering the cron

Use this for smoke testing, for debugging a failed run, or to catch up
after a missed night.

```bash
# Hit production
curl -i \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://promo-gifts-co.uk/api/cron/sync-laltex

# Hit a preview deployment (replace <preview>)
curl -i \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://<preview>.vercel.app/api/cron/sync-laltex
```

Response shape on success:

```json
{
  "runId": "uuid-here",
  "fetched": 8412,
  "inserted": 0,
  "updated": 8412,
  "failed": 0,
  "durationMs": 42713,
  "status": "completed"
}
```

Expect `inserted` to be meaningful only on the first run (subsequent
nights see ~0 inserts, ~all updates).

### Auth failure modes

| Request | Response |
|---|---|
| No `Authorization` header | 401 `{"error":"Unauthorized"}` |
| Wrong secret | 401 `{"error":"Unauthorized"}` |
| `CRON_SECRET` not configured on Vercel | 500 `{"error":"CRON_SECRET not configured on Vercel"}` |

## 4. Inspecting sync_runs

All run outcomes land in `sync_runs`. Query via the Supabase Dashboard
SQL editor or the Management API:

```sql
-- Last 10 runs, newest first
SELECT id, run_type, status, triggered_by,
       products_fetched, products_inserted, products_updated, products_failed,
       duration_ms, started_at, finished_at, error_message
FROM sync_runs
ORDER BY started_at DESC
LIMIT 10;

-- Find stuck runs (should return 0 rows unless a sync is currently in flight)
SELECT id, started_at, triggered_by
FROM sync_runs
WHERE status = 'running'
  AND started_at < now() - interval '15 minutes';

-- Failure-rate over last week
SELECT date_trunc('day', started_at) AS day,
       COUNT(*) FILTER (WHERE status='completed') AS ok,
       COUNT(*) FILTER (WHERE status='failed') AS failed,
       SUM(products_failed) AS products_failed
FROM sync_runs
WHERE started_at > now() - interval '7 days'
GROUP BY day
ORDER BY day DESC;
```

## 5. Inspecting sync_failures for a specific run

```sql
-- Failure breakdown for a specific run
SELECT reason, COUNT(*) AS occurrences
FROM sync_failures
WHERE sync_run_id = '<run_id>'
GROUP BY reason
ORDER BY occurrences DESC;

-- First 20 failures for a run, with the raw snippet for debugging
SELECT supplier_product_code, reason, error_message, raw_snippet
FROM sync_failures
WHERE sync_run_id = '<run_id>'
ORDER BY created_at
LIMIT 20;

-- All failures for a single product across all recent runs
SELECT sync_run_id, reason, error_message, created_at
FROM sync_failures
WHERE supplier_product_code = '<CODE>'
ORDER BY created_at DESC
LIMIT 50;
```

## 6. Local testing before merge

```bash
cd site

# 1. Make sure .env has LALTEX_API_KEY, VITE_SUPABASE_URL,
#    SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET.

# 2. Run the full sync locally against the live Laltex API + live DB.
node scripts/sync-laltex-catalogue.js

# 3. Inspect the latest sync_runs row.
#    (The CLI prints the run_id — use it in the SQL snippets above.)
```

If you want to test the **handler file** itself (auth, env guards)
without deploying, you can import it into a tiny node script that mocks
`req` and `res`. Session 3a's commit includes a verification run that
covers 401/401/200 via this approach (see session 3a PR description).

## 7. Recovery procedure

### Scenario A — cron failed overnight (sync_runs row shows status='failed')

1. Inspect `sync_runs.error_message`. Usual culprits:
   - Laltex network blip → just re-run
   - Auth error → rotate `LALTEX_API_KEY` or contact Laltex
   - Supabase throttling → very rare; wait and re-run
2. Re-run manually via step 3 above. This creates a new `sync_runs`
   row; it does NOT retry the failed one.
3. If repeated failures: check Vercel function logs (Project → Logs
   → filter function `/api/cron/sync-laltex`).

### Scenario B — high `products_failed` (> ~1% of fetched)

1. Pull the failure breakdown SQL from §5 above.
2. If all failures share one `reason` + one field (e.g. 200 × `parse_error` on `Price`), Laltex
   probably changed the field shape. Patch the parser in
   `scripts/lib/laltex-parser.js` and ship the fix before tomorrow's
   cron. Failed products keep their prior `last_synced_at` — the site
   still serves stale data until the parser catches up.
3. If failures are distributed across codes with `reason='upsert_failed'`,
   that usually means schema drift (new required column). Investigate
   `raw_snippet` and amend.

### Scenario C — a stuck 'running' row

`sync_runs.status='running'` older than ~15 minutes means a run
crashed in a way even the `finally` block couldn't catch (process
kill, Vercel function timeout). Safe to mark failed manually:

```sql
UPDATE sync_runs
SET status = 'failed',
    error_message = 'Manually marked failed — stuck in running state',
    finished_at = now(),
    duration_ms = EXTRACT(epoch FROM (now() - started_at)) * 1000
WHERE id = '<stuck_id>' AND status = 'running';
```

Then run the cron again.

## 8. Do NOT

- Do not set `CRON_SECRET` to a short / guessable value. Always 32+
  bytes of crypto randomness.
- Do not call this endpoint with Laltex credentials — it only needs
  `CRON_SECRET`. Laltex's key is server-side only.
- Do not merge changes to `scripts/lib/laltex-parser.js` without
  running the CLI once — parser bugs hide until a whole catalogue
  runs through them.
- Do not extend the cron to also do embeddings — that's deliberately
  split into the 04:00 UTC cron (session 3b). Keeping them independent
  preserves the 5-minute budget and isolates failure domains.
