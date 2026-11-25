-- Rollback for 20261125_supplier_text_corrections.sql. Drops the table only:
-- the sync code treats a missing table as "no corrections" (warning in the
-- log), and the next nightly sync restores the supplier's original text.
BEGIN;
DROP TABLE IF EXISTS public.supplier_text_corrections;
COMMIT;
