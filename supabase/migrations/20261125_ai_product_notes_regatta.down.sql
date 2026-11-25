-- Rollback for 20261125_ai_product_notes_regatta.sql (leaves the JF0012 note).
BEGIN;
DELETE FROM public.ai_product_notes WHERE supplier_product_code IN ('JF0112', 'JF0013', 'JF0113');
COMMIT;
