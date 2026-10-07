-- =============================================================================
-- 20261017_category_thumbnails.sql — category-card thumbnails (9 Oct 2026)
--
-- Laltex originals are 2000×2000 and up to 1.2 MB, so category cards took
-- 6–9 s to appear. The nightly catalogue sync (api/cron/sync-catalog-mirror.js
-- -> scripts/lib/category-images.js) now checks each curated product's images
-- and writes a ~480px WebP thumbnail to the public `category-thumbs` bucket.
--   card_thumb_url          — public URL of the thumbnail (cache-busted ?v=hash)
--   card_image_source_hash  — hash of the product's candidate image list; a
--                             change means "re-check and re-thumbnail"
-- Bucket: public read (served via /object/public, no RLS policy needed);
-- written only by the service role — NO client insert/update/delete policies.
-- Rollback: .down.sql (drops the columns; see there for the bucket).
-- =============================================================================

BEGIN;

ALTER TABLE public.category_product_curation
  ADD COLUMN IF NOT EXISTS card_thumb_url text,
  ADD COLUMN IF NOT EXISTS card_image_source_hash text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('category-thumbs', 'category-thumbs', true, 307200, ARRAY['image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 307200, allowed_mime_types = ARRAY['image/webp'];

COMMIT;

-- Verify: expect cols = 2, bucket = true, client_write_policies = 0.
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'category_product_curation'
      AND column_name IN ('card_thumb_url', 'card_image_source_hash')) AS cols,
  (SELECT public AND file_size_limit = 307200 FROM storage.buckets WHERE id = 'category-thumbs') AS bucket,
  (SELECT count(*) FROM pg_policy
    WHERE polrelid = 'storage.objects'::regclass
      AND (coalesce(pg_get_expr(polqual, polrelid), '') LIKE '%category-thumbs%'
           OR coalesce(pg_get_expr(polwithcheck, polrelid), '') LIKE '%category-thumbs%')) AS client_write_policies;
