-- Rollback for 20261116_category_intros.sql — removes the About copy and columns.
-- CategoryPage renders nothing when intro is missing, so this is safe to run any time.
BEGIN;
ALTER TABLE public.catalog_categories DROP COLUMN IF EXISTS intro;
ALTER TABLE public.catalog_categories DROP COLUMN IF EXISTS intro_heading;
COMMIT;
