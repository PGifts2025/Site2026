-- search_tsv: include supplier_product_code at weight A using the
-- 'simple' text-search config.
--
-- HISTORY: the prior migration 20260603 added supplier_product_code at
-- weight A using the 'english' config. That migration appears NOT to
-- have been applied to live state (verified via the live
-- generation_expression on 2026-06-04, which still matches the original
-- 20260511 definition with no supplier_product_code anywhere). This
-- migration is the corrected version and supersedes 20260603.
--
-- WHY 'simple' (not 'english'):
--   * 'english' is correct for prose. It stems, removes stopwords, and
--     applies language-aware token classification. For SKU-style
--     identifiers (MG0110, AA0131, QB0573, edge-classic) the stemming
--     is unnecessary at best and risks future surprises (e.g. a code
--     containing a stopword or a stem collision).
--   * 'simple' just lowercases and tokenises. No stemming, no stopword
--     filtering. The semantically correct config for identifier data.
--   * Verified live (2026-06-04 probe): for current corpus codes both
--     configs produce identical lexemes (to_tsvector('english','MG0110')
--     == to_tsvector('simple','MG0110') == 'mg0110':1). 'simple' is the
--     more defensible long-term choice.
--
-- WHY this is safe at the query side:
--   * websearch_to_tsquery('english','MG0110') == 'mg0110'.
--   * websearch_to_tsquery('simple','MG0110') == 'mg0110'.
--   For code-shaped inputs the query side is config-invariant. AVA's
--   existing 'english' query side still matches the new 'simple'
--   index for the code field. No RPC change required.
--
-- The english tsconfig is preserved for name / description /
-- web_description / keywords / category / sub_category - all of
-- those ARE prose and SHOULD be stemmed.
--
-- Apply path:
--   * Manual via Supabase Dashboard -> SQL Editor (CLAUDE.md §52).
--     DO NOT use `supabase db push`.
--   * Run BEFORE merging the PR that depends on this index. Code
--     changes alone do not restore search; the GIN index must rebuild
--     against the new generated column first.
--
-- Safety:
--   * search_tsv is a STORED GENERATED column. DROP COLUMN + ADD
--     COLUMN materialises the new value for every row on ALTER. No
--     trigger maintenance, no row backfill needed.
--   * Single index supplier_products_search_tsv_idx; DROP and recreate
--     after the column swap.
--   * SET LOCAL maintenance_work_mem='128MB' matches the original
--     20260511 migration's GIN-build memory requirement.
--   * Expected duration on 1,217 rows: sub-second column rematerialise,
--     1-5 seconds GIN build. No long-running locks expected.
--   * BEGIN+ROLLBACK dry-run against live DB verified the rank fix:
--     MG0110 rank goes from 0 (before) to > 0 (after) inside the
--     transaction. See PR body for evidence.

BEGIN;

SET LOCAL maintenance_work_mem = '128MB';

-- 1. Drop the GIN index.
DROP INDEX IF EXISTS supplier_products_search_tsv_idx;

-- 2. Drop the existing GENERATED column.
ALTER TABLE supplier_products DROP COLUMN IF EXISTS search_tsv;

-- 3. Recreate with supplier_product_code (simple) at weight A. All
--    other fields keep 'english' AND keep their existing weights from
--    the live 20260511 definition: name=A, description=B, keywords=C,
--    category+sub_category=D.
ALTER TABLE supplier_products
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple',  coalesce(supplier_product_code, '')),                          'A') ||
    setweight(to_tsvector('english', coalesce(name, '')),                                           'A') ||
    setweight(to_tsvector('english', coalesce(description, '') || ' ' || coalesce(web_description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(keywords, '')),                                       'C') ||
    setweight(to_tsvector('english', coalesce(category, '') || ' ' || coalesce(sub_category, '')), 'D')
  ) STORED;

COMMENT ON COLUMN supplier_products.search_tsv IS
  'Generated tsvector for lexical retrieval. Weight A=supplier_product_code(simple)+name(english), B=description+web_description(english), C=keywords(english), D=category+sub_category(english). Regenerated automatically on any source-column UPDATE - no trigger needed. supplier_product_code uses simple tsconfig (no stemming, just lowercase + tokenise) because it is identifier data, not prose. Added 2026-06-04 - superseded the broken 20260603 attempt.';

-- 4. Recreate the GIN index.
CREATE INDEX supplier_products_search_tsv_idx
  ON supplier_products
  USING GIN (search_tsv);

COMMIT;
