-- Rollback for 20261125_ai_product_notes.sql. api/ai/chat.js fails soft
-- without the table (results simply carry no notes), so this is safe to run.
BEGIN;
DROP TABLE IF EXISTS public.ai_product_notes;
COMMIT;
