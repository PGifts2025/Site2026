# Vercel Cron setup — Laltex nightly jobs

This document is the single reference for configuring, testing, and
recovering from the two Vercel Cron jobs behind the Laltex pipeline
(**sync** at 03:00 UTC, **embed** at 04:00 UTC). Everything below also
lives (summarised) in [`.claude/CLAUDE.md §27`](../.claude/CLAUDE.md),
but this is the operational playbook.

## 1. Architecture at a glance

| Piece | Location |
|---|---|
| Cron declarations | [`site/vercel.json`](../vercel.json) — `crons[]`: `0 3 * * *` (sync), `0 4 * * *` (embed) |
| Sync handler | [`site/api/cron/sync-laltex.js`](../api/cron/sync-laltex.js) — Vercel Serverless Function, `maxDuration: 300` |
| Embed handler | [`site/api/cron/embed-laltex.js`](../api/cron/embed-laltex.js) — Vercel Serverless Function, `maxDuration: 300` |
| Core sync logic | [`site/scripts/lib/laltex-sync.js`](../scripts/lib/laltex-sync.js) — `syncFullCatalogue()` writes `job_type='sync'` |
| Core embed logic | [`site/scripts/lib/laltex-embed.js`](../scripts/lib/laltex-embed.js) — `embedCatalogue()` writes `job_type='embed'` |
| Parsing helpers | [`site/scripts/lib/laltex-parser.js`](../scripts/lib/laltex-parser.js) |
| Embedding helpers | [`site/scripts/lib/embedding.js`](../scripts/lib/embedding.js) (session 2) |
| Sync CLI | [`site/scripts/sync-laltex-catalogue.js`](../scripts/sync-laltex-catalogue.js) — `triggered_by='cli'` |
| Embed CLI | [`site/scripts/embed-laltex-catalogue.js`](../scripts/embed-laltex-catalogue.js) — `triggered_by='cli'` |
| Observability | `job_runs` + `job_failures` tables (one row per job invocation; `job_type` column distinguishes sync vs. embed) |

The 1-hour gap between sync (03:00) and embed (04:00) is deliberate.
Sync typically takes ~90s on production; the hour of headroom means
embed always sees a post-sync steady state, never a mid-write one.

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
after a missed night. Both endpoints share the same auth pattern.

```bash
# Hit production — sync
curl -i \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://promo-gifts-co.uk/api/cron/sync-laltex

# Hit production — embed (typically ~instant after a sync, nothing to embed)
curl -i \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://promo-gifts-co.uk/api/cron/embed-laltex

# Hit a preview deployment (replace <preview>)
curl -i \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://<preview>.vercel.app/api/cron/sync-laltex
```

> **Heads-up:** use `curl`, not PowerShell `Invoke-WebRequest`. The
> latter's default 100s timeout is uncomfortably close to the ~90s a
> production sync actually takes, and its failure modes when a request
> times out mid-flight can surface as a 200-with-SPA-shell rather than
> a clean error. Use `-TimeoutSec 600` explicitly if PowerShell is
> mandatory.

Response shape on a successful **sync** run:

```json
{
  "runId": "uuid-here",
  "fetched": 1192,
  "inserted": 0,
  "updated": 1192,
  "failed": 0,
  "durationMs": 90851,
  "status": "completed"
}
```

Response shape on a successful **embed** run (steady state — nothing
to embed because all source hashes match):

```json
{
  "runId": "uuid-here",
  "considered": 1192,
  "embedRequested": 0,
  "embedSkipped": 1192,
  "updated": 0,
  "failed": 0,
  "tokensUsed": 0,
  "costUsd": 0,
  "durationMs": 850,
  "status": "completed"
}
```

First-time embed run is slower (~5–10 s) and costs ~$0.003 — see
CLAUDE.md §26.10.6 for cost maths. Subsequent nights are steady-state.

### Auth failure modes (both endpoints)

| Request | Response |
|---|---|
| No `Authorization` header | 401 `{"error":"Unauthorized"}` |
| Wrong secret | 401 `{"error":"Unauthorized"}` |
| `CRON_SECRET` not configured on Vercel | 500 `{"error":"CRON_SECRET not configured on Vercel"}` |

## 4. Inspecting job_runs

All run outcomes from both crons land in `job_runs`. `job_type`
distinguishes `'sync'` from `'embed'`.

```sql
-- Last 10 job runs of any type, newest first
SELECT id, job_type, run_type, status, triggered_by,
       products_fetched, products_inserted, products_updated, products_failed,
       duration_ms, started_at, finished_at, error_message
FROM job_runs
ORDER BY started_at DESC
LIMIT 10;

-- Last 10 sync runs only
SELECT id, run_type, status, triggered_by,
       products_fetched, products_updated, products_failed,
       duration_ms, started_at, finished_at
FROM job_runs
WHERE job_type = 'sync'
ORDER BY started_at DESC
LIMIT 10;

-- Last 10 embed runs only (including metadata for token/cost info)
SELECT id, status, products_updated, products_failed,
       duration_ms, metadata, started_at
FROM job_runs
WHERE job_type = 'embed'
ORDER BY started_at DESC
LIMIT 10;

-- Find stuck runs (should return 0 rows unless a job is currently in flight)
SELECT id, job_type, started_at, triggered_by
FROM job_runs
WHERE status = 'running'
  AND started_at < now() - interval '15 minutes';

-- Per-type success/failure over last week
SELECT date_trunc('day', started_at) AS day,
       job_type,
       COUNT(*) FILTER (WHERE status='completed') AS ok,
       COUNT(*) FILTER (WHERE status='failed') AS failed,
       SUM(products_failed) AS products_failed
FROM job_runs
WHERE started_at > now() - interval '7 days'
GROUP BY day, job_type
ORDER BY day DESC, job_type;
```

## 5. Inspecting job_failures for a specific run

```sql
-- Failure breakdown for a specific run (works for both sync and embed)
SELECT reason, COUNT(*) AS occurrences
FROM job_failures
WHERE job_run_id = '<run_id>'
GROUP BY reason
ORDER BY occurrences DESC;

-- First 20 failures for a run, with the raw snippet for debugging
SELECT supplier_product_code, reason, error_message, raw_snippet
FROM job_failures
WHERE job_run_id = '<run_id>'
ORDER BY created_at
LIMIT 20;

-- All failures for a single product across all recent runs (any type)
SELECT job_run_id, reason, error_message, created_at
FROM job_failures
WHERE supplier_product_code = '<CODE>'
ORDER BY created_at DESC
LIMIT 50;
```

## 6. Local testing before merge

```bash
cd site

# 1. Make sure .env has LALTEX_API_KEY, VITE_SUPABASE_URL,
#    SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, OPENAI_API_KEY.

# 2a. Run the full sync locally against the live Laltex API + live DB.
node scripts/sync-laltex-catalogue.js

# 2b. Run the embed over whatever sync just produced.
node scripts/embed-laltex-catalogue.js

# 3. Inspect the latest job_runs rows.
#    (Each CLI prints its run_id — use it in the SQL snippets above.)
```

If you want to test a **handler file** itself (auth, env guards)
without deploying, `scripts/smoke-test-cron-auth.js` imports the
handler and exercises the 401/401/200 contract in-process. Duplicate
the pattern for the embed handler if you need a separate harness.

## 7. Recovery procedure

### Scenario A — a cron failed overnight (`job_runs` row shows `status='failed'`)

1. Inspect `job_runs.error_message` for the failed row. Usual
   culprits per `job_type`:
   - **sync:** Laltex network blip, Laltex auth, Supabase throttling
   - **embed:** OpenAI 5xx, OpenAI 429, Supabase write error during
     per-row update
2. Re-run the failed job manually (`curl` the relevant endpoint or
   run the matching CLI). This creates a **new** `job_runs` row; it
   does NOT retry the failed one.
3. If repeated failures: check Vercel function logs (Project → Logs
   → filter `/api/cron/sync-laltex` or `/api/cron/embed-laltex`).

### Scenario B — high `products_failed` (> ~1% of fetched / considered)

1. Pull the failure breakdown SQL from §5 above.
2. **Sync-side:** if all failures share one `reason` + one field (e.g.
   200 × `parse_error` on `Price`), Laltex probably changed the field
   shape. Patch `scripts/lib/laltex-parser.js` and ship the fix before
   tomorrow's cron. Failed products keep their prior `last_synced_at`.
3. **Embed-side:** `reason='embed_update_failed'` distributed across
   codes usually means a schema drift on `supplier_products.embedding`
   or a transient Supabase write error — re-run the embed CLI to
   retry those rows (hash gate still applies).

### Scenario C — a stuck `'running'` row

`job_runs.status='running'` older than ~15 minutes means a run
crashed in a way even the `finally` block couldn't catch (process
kill, Vercel function timeout). Safe to mark failed manually:

```sql
UPDATE job_runs
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
- Do not collapse the 03:00 sync and 04:00 embed into a single cron.
  The split preserves each job's 5-minute budget and isolates failure
  domains (Laltex outage vs. OpenAI outage).
- Do not call OpenAI outside the hash-gate in the embed path. The gate
  is a cost-control invariant (see CLAUDE.md §26.10.7).
