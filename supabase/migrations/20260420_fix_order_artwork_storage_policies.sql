-- Storage policies: close the wildcard INSERT hole and add scoped policies.
--
-- Previously a single policy "Allow uploads for anyone 1peuqw_0" allowed any
-- user (including anonymous) to upload to any bucket — a serious hole.
-- This migration replaces it with bucket- and path-scoped policies.
--
-- Buckets touched:
--   order-artwork  (private) — customer uploads artwork per order
--   catalog-images (public)  — customers save design thumbnails under
--                              design-thumbnails/ (called from saveUserDesign)
--
-- Admin-scoped policies already exist for product-templates and catalog-images
-- general uploads, so those paths keep working for admins without change.

-- 1. Drop the wildcard policy that lets anyone upload anywhere.
DROP POLICY IF EXISTS "Allow uploads for anyone 1peuqw_0" ON storage.objects;

-- 2. Idempotent cleanup of any prior attempts at the new policies.
DROP POLICY IF EXISTS "Customers can upload own artwork files" ON storage.objects;
DROP POLICY IF EXISTS "Customers can read own artwork files"   ON storage.objects;
DROP POLICY IF EXISTS "Customers can delete own artwork files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can read all artwork files"      ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete any artwork file"     ON storage.objects;
DROP POLICY IF EXISTS "Users can upload design thumbnails"     ON storage.objects;

-- 3. order-artwork: customer policies (user-folder-scoped).
--    Path pattern: {userId}/{orderId}/{filename}  →  foldername[1] = userId
CREATE POLICY "Customers can upload own artwork files"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'order-artwork'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Customers can read own artwork files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'order-artwork'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Customers can delete own artwork files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'order-artwork'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 4. order-artwork: admin policies (read + delete all).
CREATE POLICY "Admins can read all artwork files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'order-artwork'
    AND public.is_admin(auth.uid())
  );

CREATE POLICY "Admins can delete any artwork file"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'order-artwork'
    AND public.is_admin(auth.uid())
  );

-- 5. catalog-images/design-thumbnails: preserve existing saveUserDesign flow.
--    Scoped to the design-thumbnails/ subfolder only; both authenticated and
--    anonymous users are allowed (anonymous customers save designs too).
CREATE POLICY "Users can upload design thumbnails"
  ON storage.objects
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (
    bucket_id = 'catalog-images'
    AND (storage.foldername(name))[1] = 'design-thumbnails'
  );
