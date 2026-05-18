-- Down migration for 20260518_supplier_products_retired_flag.sql.
--
-- Drops both new columns + the supporting index + check constraint.
-- Apply only if rolling back the retired-product feature.
--
-- Order matters: drop the constraint first (it references the column),
-- then the index, then the columns themselves.

BEGIN;

ALTER TABLE public.supplier_products
  DROP CONSTRAINT IF EXISTS supplier_products_missing_from_feed_count_nonneg;

DROP INDEX IF EXISTS public.idx_supplier_products_supplier_retired;

ALTER TABLE public.supplier_products
  DROP COLUMN IF EXISTS missing_from_feed_count,
  DROP COLUMN IF EXISTS is_retired;

COMMIT;
