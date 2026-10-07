-- Rollback for 20261017_category_thumbnails.sql.
-- Drops the two columns (the page then falls back to card_image_url / the
-- Laltex originals). The `category-thumbs` bucket is left in place: Supabase
-- does not allow deleting storage objects with SQL. To remove it, empty and
-- delete it in Dashboard -> Storage (or the Storage API). It is public-read,
-- service-role-write only, so leaving it is harmless.
BEGIN;
ALTER TABLE public.category_product_curation
  DROP COLUMN IF EXISTS card_thumb_url,
  DROP COLUMN IF EXISTS card_image_source_hash;
COMMIT;
-- Verify: expect cols = 0.
SELECT count(*) AS cols FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'category_product_curation'
   AND column_name IN ('card_thumb_url', 'card_image_source_hash');
