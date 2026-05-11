-- Session 4a.1: make job_runs.supplier_id nullable so cross-supplier
-- embed runs can be recorded without picking a misleading "owning"
-- supplier.
--
-- Context: session 3b introduced job_type='embed' but kept the embed
-- code scoped to a single supplier (Laltex) and therefore kept
-- job_runs.supplier_id NOT NULL. Session 4a added a second supplier
-- (pgifts-direct), so an embed pass that covers every supplier's
-- rows now needs to record itself without naming a single supplier
-- on the row.
--
-- Sync runs remain per-supplier (one cron per supplier, future
-- suppliers add their own routes), so supplier_id stays populated
-- for job_type='sync'. The CHECK constraint below codifies that.

BEGIN;

-- 1. Drop NOT NULL on supplier_id
ALTER TABLE job_runs
  ALTER COLUMN supplier_id DROP NOT NULL;

-- 2. Add a CHECK so future sync rows must still carry a supplier_id
--    (embed rows are explicitly allowed to leave it NULL).
ALTER TABLE job_runs
  ADD CONSTRAINT job_runs_supplier_id_required_for_sync
  CHECK (job_type <> 'sync' OR supplier_id IS NOT NULL);

COMMENT ON COLUMN job_runs.supplier_id IS
  'Owning supplier for the run. Required for job_type=''sync'' (one cron per supplier); NULL allowed for job_type=''embed'' which spans every supplier_products row.';

COMMIT;
