-- Rename sync_runs/sync_failures to job_runs/job_failures and add a
-- job_type column so one observability table tracks every background
-- job type (sync, embed, future types).
--
-- Applied as a single transaction with pre-checks. The migration:
--   1. refuses to run if sync_runs does not exist (session 3a missing)
--   2. refuses to run if any sync_runs.status='running' (would rename
--      mid-flight and strand an in-progress job)
--
-- Pre-migration state (captured 2026-04-24 against live DB):
--   sync_runs rows:          7  (all status='completed')
--   sync_failures rows:      0
--   supplier_products rows:  1192 (1 embedded, from session 2)
--
-- All 7 existing rows are backfilled to job_type='sync'. The DEFAULT
-- on the column is dropped after backfill so future inserts must be
-- explicit about job_type — no silent misclassification.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Guards — refuse to run if preconditions are wrong
-- ---------------------------------------------------------------------------

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sync_runs'
  ) THEN
    RAISE EXCEPTION 'sync_runs does not exist — has session 3a been applied?';
  END IF;

  IF EXISTS (SELECT 1 FROM sync_runs WHERE status = 'running') THEN
    RAISE EXCEPTION 'sync_runs has status=running rows — cannot rename while a job is in flight';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 2. Add job_type (CHECK enforces the enum; DEFAULT used only for backfill)
-- ---------------------------------------------------------------------------
-- Named constraint so the rename below produces a stable, predictable
-- name (PG would otherwise auto-generate sync_runs_job_type_check and
-- leave it attached to the renamed table).

ALTER TABLE sync_runs
  ADD COLUMN job_type TEXT NOT NULL DEFAULT 'sync';

ALTER TABLE sync_runs
  ADD CONSTRAINT job_runs_job_type_check
  CHECK (job_type IN ('sync', 'embed'));

ALTER TABLE sync_runs
  ALTER COLUMN job_type DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- 3. Rename tables (PG auto-renames the pkey index + pkey constraint)
-- ---------------------------------------------------------------------------

ALTER TABLE sync_runs     RENAME TO job_runs;
ALTER TABLE sync_failures RENAME TO job_failures;

-- ---------------------------------------------------------------------------
-- 4. Rename FK column in the child table
-- ---------------------------------------------------------------------------

ALTER TABLE job_failures RENAME COLUMN sync_run_id TO job_run_id;

-- ---------------------------------------------------------------------------
-- 5. Rename secondary indexes (NOT auto-renamed on ALTER TABLE RENAME)
-- ---------------------------------------------------------------------------

ALTER INDEX idx_sync_runs_supplier_started RENAME TO idx_job_runs_supplier_started;
ALTER INDEX idx_sync_runs_running          RENAME TO idx_job_runs_running;
ALTER INDEX idx_sync_failures_run          RENAME TO idx_job_failures_run;
ALTER INDEX idx_sync_failures_code_recent  RENAME TO idx_job_failures_code_recent;

-- ---------------------------------------------------------------------------
-- 6. Rename named constraints
--    PKey constraints are NOT auto-renamed by ALTER TABLE RENAME (verified
--    live — the sync_*_pkey names survived the table rename), so we rename
--    them explicitly for consistency. Functionally cosmetic, but keeps the
--    schema dump readable.
-- ---------------------------------------------------------------------------

ALTER TABLE job_runs
  RENAME CONSTRAINT sync_runs_pkey               TO job_runs_pkey;

ALTER TABLE job_runs
  RENAME CONSTRAINT sync_runs_status_check       TO job_runs_status_check;

ALTER TABLE job_runs
  RENAME CONSTRAINT sync_runs_supplier_id_fkey   TO job_runs_supplier_id_fkey;

ALTER TABLE job_failures
  RENAME CONSTRAINT sync_failures_pkey           TO job_failures_pkey;

ALTER TABLE job_failures
  RENAME CONSTRAINT sync_failures_sync_run_id_fkey TO job_failures_job_run_id_fkey;

-- ---------------------------------------------------------------------------
-- 7. Rename RLS policies (preserved on rename, but keep names consistent)
-- ---------------------------------------------------------------------------

ALTER POLICY sync_runs_select_all          ON job_runs     RENAME TO job_runs_select_all;
ALTER POLICY sync_runs_service_role_write  ON job_runs     RENAME TO job_runs_service_role_write;
ALTER POLICY sync_failures_select_all      ON job_failures RENAME TO job_failures_select_all;
ALTER POLICY sync_failures_service_role_write ON job_failures RENAME TO job_failures_service_role_write;

-- ---------------------------------------------------------------------------
-- 8. Refresh comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE job_runs IS
  'One row per background job invocation. job_type distinguishes sync (Laltex catalogue pull) from embed (OpenAI embedding batch); add new values to the CHECK as new job types land.';

COMMENT ON TABLE job_failures IS
  'Per-row failures inside a job run. Continue-with-logging: failures live here, the run keeps going.';

COMMENT ON COLUMN job_runs.job_type IS
  'sync | embed. Extend the CHECK constraint to add new job types.';

COMMIT;
