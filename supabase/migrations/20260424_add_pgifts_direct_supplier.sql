-- Add 'pgifts-direct' supplier row.
--
-- This is the second supplier in the suppliers dimension. Context:
--   Laltex is an external trade API (external SKUs, nightly sync).
--   PGifts Direct is the internal curated catalogue — 25 products in
--   catalog_products with deeper integration (Designer templates,
--   3D previews, curated pricing, hex-value colour swatches).
--
-- Session 4a mirrors those 25 rows into supplier_products under this
-- supplier so a single-table AI-searchable catalogue exists. The
-- catalog_products table is NOT deleted or altered — Designer and
-- ProductDetailPage continue to read from it.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING so re-running the migration
-- file is harmless.

INSERT INTO suppliers (name, slug, api_base_url, notes, is_active)
VALUES (
  'PGifts Direct',
  'pgifts-direct',
  NULL,  -- no external API; catalogue is curated internally
  'Internally-curated products with Designer/3D integration. Mirrored from '
  'catalog_products in session 4a (2026-04-24). raw_payload on each '
  'supplier_products row preserves the source catalog_products id plus any '
  'product_templates / print_areas / 3D model references so a future session '
  'can unify the frontend reads. catalog_products remains the source of truth '
  'for the Designer + ProductDetailPage until that unification lands.',
  TRUE
)
ON CONFLICT (slug) DO NOTHING;
