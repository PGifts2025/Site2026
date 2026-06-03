-- Add supplier_product_code to search_tsv at weight A.
--
-- BEFORE: search_tsv was built from name (A) + description+web_description (B)
--         + keywords (C) + category+sub_category (D). The product code itself
--         was NEVER indexed; tsvector_rank for any code-as-query returned 0.
--         Result: AVA could not surface a product when the customer typed its
--         code (e.g. "MG0110", "AA0131"). PGifts Direct slugs incidentally
--         ranked because they happen to contain real English words ("cotton",
--         "notebook"). Pure Laltex alphanumeric codes did not.
--
-- AFTER:  supplier_product_code is added at weight A, alongside name. All
--         existing weights and source fields are preserved BYTE-FOR-BYTE
--         (matched against the live generation_expression dumped before
--         migration). The English text-search config lowercases at both
--         to_tsvector and websearch_to_tsquery time, so the index is
--         case-insensitive in both directions ('MG0110', 'mg0110', and
--         'Mg0110' all resolve to lexeme 'mg0110').
--
-- Apply path:
--   * Manual via Supabase Dashboard -> SQL Editor (CLAUDE.md §52). DO NOT
--     use `supabase db push`.
--   * Run BEFORE merging the PR that depends on this index. Code changes
--     alone do not restore code-based search; the GIN index must rebuild
--     against the new generated column first.
--
-- Safety:
--   * `search_tsv` is a STORED GENERATED column (verified live, 2026-06-03).
--     DROP COLUMN + ADD COLUMN materialises the new value for every row on
--     ALTER. No trigger maintenance, no row backfill needed.
--   * Single index on the column (`supplier_products_search_tsv_idx`).
--     The DROP cascades; we recreate it below.
--   * GIN build needs maintenance_work_mem above the default 32 MB. SET
--     LOCAL '128MB' matches the original 20260511 migration.
--   * Expected duration on 1,217 rows: sub-second column rematerialise,
--     1-5 seconds GIN build. No long-running locks expected at this scale.
--   * No application reads/writes block during the build because the
--     ALTER acquires AccessExclusiveLock only briefly during the column
--     swap; queries that don't touch search_tsv are unaffected.
--
-- This migration is NOT reversible automatically. To roll back: re-apply
-- the search_tsv definition from supabase/migrations/20260511_search_layer_additions.sql.

BEGIN;

SET LOCAL maintenance_work_mem = '128MB';

-- 1. Drop the GIN index. The column DROP would cascade-drop it anyway,
--    but explicit DROP keeps the migration self-documenting and lets a
--    reviewer see the order of operations.
DROP INDEX IF EXISTS supplier_products_search_tsv_idx;

-- 2. Drop the existing GENERATED column.
ALTER TABLE supplier_products DROP COLUMN IF EXISTS search_tsv;

-- 3. Recreate with supplier_product_code added at weight A. All existing
--    fields and weights are preserved exactly as in 20260511.
ALTER TABLE supplier_products
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(supplier_product_code, '')),                          'A') ||
    setweight(to_tsvector('english', coalesce(name, '')),                                           'A') ||
    setweight(to_tsvector('english', coalesce(description, '') || ' ' || coalesce(web_description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(keywords, '')),                                       'C') ||
    setweight(to_tsvector('english', coalesce(category, '') || ' ' || coalesce(sub_category, '')), 'D')
  ) STORED;

COMMENT ON COLUMN supplier_products.search_tsv IS
  'Generated tsvector for lexical retrieval. Weight A=supplier_product_code+name, B=description+web_description, C=keywords, D=category+sub_category. Regenerated automatically on any source-column UPDATE - no trigger needed. supplier_product_code added 2026-06-03 to make AVA code-by-code lookups work (English tsconfig lowercases at both index and query time, so case is irrelevant).';

-- 4. Recreate the GIN index.
CREATE INDEX supplier_products_search_tsv_idx
  ON supplier_products
  USING GIN (search_tsv);

COMMIT;
