-- Rollback for 20261015_curation_card_image.sql.
BEGIN;
ALTER TABLE public.category_product_curation
  DROP COLUMN IF EXISTS card_image_url,
  DROP COLUMN IF EXISTS card_image_checked_at;
COMMIT;
-- Verify: expect cols = 0.
SELECT count(*) AS cols FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'category_product_curation'
   AND column_name IN ('card_image_url', 'card_image_checked_at');
