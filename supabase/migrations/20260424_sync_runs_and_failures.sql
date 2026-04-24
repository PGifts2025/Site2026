-- Observability tables for the nightly supplier sync pipeline.
--
-- sync_runs: one row per sync invocation (cron or manual). Records
--   outcome, counters, and duration. The partial index on (status)
--   where status='running' is for the "find stuck runs" query — at
--   most a handful of rows at any given time, so trivial to maintain.
--
-- sync_failures: per-product failures inside a run. Continue-with-
--   logging philosophy: a bad product never aborts the run, it lands
--   here instead and the sync keeps going. Admin dashboards (future)
--   read from these tables.
--
-- Both tables live in public schema alongside supplier_products.
-- RLS: SELECT open to authenticated (admin dashboard will read);
-- writes service_role only (same pattern as session 1 supplier_products).

-- =====================================================
-- 1. sync_runs
-- =====================================================

CREATE TABLE IF NOT EXISTS sync_runs (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id        UUID        NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  run_type           TEXT        NOT NULL,    -- 'full_catalogue' | future: 'delta' | 'single'
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ,
  status             TEXT        NOT NULL DEFAULT 'running',  -- 'running' | 'completed' | 'failed'
  products_fetched   INTEGER,
  products_inserted  INTEGER,
  products_updated   INTEGER,
  products_failed    INTEGER,
  duration_ms        INTEGER,
  error_message      TEXT,                    -- populated only when status = 'failed' at whole-run level
  triggered_by       TEXT,                    -- 'cron' | 'manual' | 'cli'
  metadata           JSONB,                   -- free-form: feed size, response time, chosen batch size, etc.

  CONSTRAINT sync_runs_status_check CHECK (status IN ('running', 'completed', 'failed'))
);

COMMENT ON TABLE sync_runs IS
  'One row per sync invocation. Core observability for the nightly supplier sync.';

CREATE INDEX IF NOT EXISTS idx_sync_runs_supplier_started
  ON sync_runs (supplier_id, started_at DESC);

-- Partial index — "quickly find stuck runs". At any given time there
-- are usually 0 running rows, occasionally 1 (during a cron execution),
-- so the partial predicate keeps this index tiny.
CREATE INDEX IF NOT EXISTS idx_sync_runs_running
  ON sync_runs (started_at DESC)
  WHERE status = 'running';

-- =====================================================
-- 2. sync_failures
-- =====================================================

CREATE TABLE IF NOT EXISTS sync_failures (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id            UUID        NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  supplier_product_code  TEXT,                 -- nullable: some failures happen before we know the code
  reason                 TEXT        NOT NULL, -- 'parse_error' | 'upsert_failed' | 'bad_pricing_format' | 'unexpected_error'
  error_message          TEXT,
  raw_snippet            JSONB,                -- truncated slice of source payload for debugging
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE sync_failures IS
  'Per-product failures inside a sync run. Never aborts the run; the row lives here and the sync continues.';

CREATE INDEX IF NOT EXISTS idx_sync_failures_run
  ON sync_failures (sync_run_id);

CREATE INDEX IF NOT EXISTS idx_sync_failures_code_recent
  ON sync_failures (supplier_product_code, created_at DESC);

-- =====================================================
-- 3. RLS
-- =====================================================
-- Same model as supplier_products: SELECT open to authenticated + anon
-- (future admin dashboard + debugging read paths); writes service_role only.

ALTER TABLE sync_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_runs_select_all
  ON sync_runs FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY sync_failures_select_all
  ON sync_failures FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY sync_runs_service_role_write
  ON sync_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY sync_failures_service_role_write
  ON sync_failures FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
