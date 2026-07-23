-- ============================================================================
-- Laltex live stock — dedicated storage on supplier_products + a new
-- job_type='stock' for the hourly stock cron.
-- ----------------------------------------------------------------------------
-- WHY a dedicated column, not folded into items[] (CLAUDE.md §26.4 / audit
-- "Laltex Stock Availability" §5): stock is VOLATILE (refreshed ~hourly)
-- whereas items[] is product data (changes on the nightly product sync).
-- Folding stock into the items[] JSONB would couple a fast refresh to the
-- product row and force rewriting product data on every stock run. Instead:
--
--   * stock             jsonb        — map of item_code -> { free, mto, due_ins },
--                                       one entry per colour x size variant.
--                                       free   = FreeStock (>0 in stock, 0 out).
--                                       mto    = FreeStock === -1 (Made To Order,
--                                                available on a longer lead time,
--                                                NEVER "out of stock").
--                                       due_ins = [{ qty, eta }] incoming stock.
--   * stock_checked_at  timestamptz  — when the stock row was last refreshed.
--                                       Drives the freshness note + the stale
--                                       fallback (null / old -> revert to the
--                                       no-stock display).
--
-- One product = one stocks/{code} call = one UPSERT touching ONLY these two
-- columns (PostgREST merge-duplicates leaves every other column alone). The
-- frontend normaliser joins stock onto colours/sizes by item_code.
--
-- The stock cron records into the SHARED job_runs / job_failures tables under
-- a new job_type='stock' (mirrors the sync/embed split, CLAUDE.md §27). The
-- existing CHECK only allowed ('sync','embed'); this migration extends it.
--
-- APPLY (CLAUDE.md §52 + PR #76 lesson): open Supabase SQL Editor, paste, Run.
-- NO explicit BEGIN/COMMIT. Idempotent (re-runnable). The final SELECT must
-- return THREE rows (stock, stock_checked_at columns + the extended CHECK
-- listing 'stock'), NOT "Success. No rows returned". Then merge.
-- ============================================================================

-- 1. Stock storage columns -------------------------------------------------
ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS stock            jsonb,
  ADD COLUMN IF NOT EXISTS stock_checked_at timestamptz;

COMMENT ON COLUMN public.supplier_products.stock IS
  'Live Laltex stock, refreshed hourly by the stock cron (job_type=''stock''). '
  'Map of item_code -> { free: int, mto: bool, due_ins: [{qty,eta}] }. free is '
  'FreeStock (>0 in stock, 0 out of stock). mto is FreeStock === -1 (Made To '
  'Order: available on a longer lead time, NEVER shown as out of stock). '
  'due_ins carries incoming quantities + ETAs. NULL until the first stock run. '
  'The frontend joins this onto colours/sizes by item_code and treats stale / '
  'null stock as "unknown" (reverts to the no-stock display). CLAUDE.md §51 note: '
  'stock is orthogonal to is_retired and in_stock.';

COMMENT ON COLUMN public.supplier_products.stock_checked_at IS
  'When public.supplier_products.stock was last refreshed by the stock cron. '
  'Drives the customer-facing freshness note and the stale-data fallback '
  '(null or older than the freshness window -> revert to no-stock display).';

-- 2. Extend job_runs.job_type to allow 'stock' -----------------------------
-- The constraint was CHECK (job_type IN ('sync','embed')) from
-- 20260424_rename_sync_runs_to_job_runs.sql. Drop-if-exists then re-add so
-- this migration is idempotent.
ALTER TABLE public.job_runs
  DROP CONSTRAINT IF EXISTS job_runs_job_type_check;

ALTER TABLE public.job_runs
  ADD CONSTRAINT job_runs_job_type_check
  CHECK (job_type IN ('sync', 'embed', 'stock'));

COMMENT ON COLUMN public.job_runs.job_type IS
  'sync | embed | stock. sync = per-supplier catalogue pull; embed = '
  'supplier-agnostic OpenAI embedding batch; stock = hourly Laltex live-stock '
  'refresh. Extend the CHECK constraint to add new job types.';

-- ---------------------------------------------------------------------------
-- Verification: must return THREE rows.
--   * supplier_products.stock            (jsonb)
--   * supplier_products.stock_checked_at (timestamp with time zone)
--   * job_runs_job_type_check            constraint listing 'stock'
-- ---------------------------------------------------------------------------
SELECT 'column' AS kind, column_name AS name, data_type AS detail
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'supplier_products'
  AND column_name IN ('stock', 'stock_checked_at')
UNION ALL
SELECT 'constraint' AS kind, conname AS name, pg_get_constraintdef(oid) AS detail
FROM pg_constraint
WHERE conname = 'job_runs_job_type_check'
ORDER BY kind, name;
