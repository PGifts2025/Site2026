-- Normalise sub_category casing — Task 11 / session 9.
--
-- Aligns PGifts Direct's "T-Shirts" (capital S) to Laltex's "T-shirts"
-- (lowercase s). This is the ONLY cross-supplier casing conflict in the
-- catalogue per Task 6 investigation:
--
--   Cross-supplier overlaps in Clothing:
--     Polos       → both use 'Polos'        (no change)
--     Sweatshirts → both use 'Sweatshirts'  (no change)
--     Hoodies     → both use 'Hoodies'      (no change)
--     T-Shirts vs T-shirts → CASING CONFLICT, this migration normalises
--
-- The bias before this migration: rpc_search_supplier_products applies
-- an EXACT-MATCH filter on sub_category (case sensitive). If the AI
-- model called searchProducts(sub_category: "T-Shirts"), all 22 Laltex
-- T-shirt SKUs (stored as 'T-shirts' lowercase) were silently excluded
-- from candidate selection — before scoring even ran. The single
-- PGifts Direct row was the only candidate and "won" by default.
--
-- After this migration:
--   sub_category='T-shirts' matches all 23 t-shirt SKUs
--     (22 Laltex + 1 PGifts Direct mirror).
--
-- The migration also normalises in catalog_products so the source-of-
-- truth table stays consistent with the supplier_products mirror.
-- A subsequent run of scripts/migrate-catalog-to-supplier-products.js
-- would re-write 'T-Shirts' into supplier_products if catalog_products
-- weren't normalised here — so both must move together.
--
-- Other cross-supplier sub_category vocabulary differences (Coffee Cups
-- vs Ceramic Mug, Cotton Bags vs Shoppers, A5 Notebooks vs Notebooks)
-- are NOT casing bugs — they're genuine taxonomic differences and
-- cannot be normalised with a single UPDATE. The companion tool-schema
-- rewrite in scripts/lib/ai-tools.js teaches Claude to skip
-- sub_category filtering for cross-supplier searches.

BEGIN;

-- Normalise the mirror table (the search target).
UPDATE supplier_products
   SET sub_category = 'T-shirts'
 WHERE sub_category = 'T-Shirts';

-- Normalise the source-of-truth table so future mirror re-runs do not
-- re-introduce the capital-S form.
UPDATE catalog_products
   SET sub_category = 'T-shirts'
 WHERE sub_category = 'T-Shirts';

COMMIT;

-- =====================================================
-- Post-application verification (run manually in SQL Editor)
-- =====================================================
--
-- 1. Confirm no rows remain at 'T-Shirts':
--    SELECT count(*) FROM supplier_products WHERE sub_category = 'T-Shirts';
--    -- expect 0
--    SELECT count(*) FROM catalog_products  WHERE sub_category = 'T-Shirts';
--    -- expect 0
--
-- 2. Confirm cross-supplier T-shirt visibility:
--    SELECT s.slug AS supplier, count(*) AS rows
--    FROM supplier_products sp
--    JOIN suppliers s ON s.id = sp.supplier_id
--    WHERE sp.sub_category = 'T-shirts'
--    GROUP BY s.slug;
--    -- expect: laltex=22, pgifts-direct=1
--
-- 3. Confirm no other sub_category casing conflicts surfaced:
--    SELECT sub_category, count(DISTINCT s.slug) AS supplier_count
--    FROM supplier_products sp
--    JOIN suppliers s ON s.id = sp.supplier_id
--    WHERE sub_category IS NOT NULL
--    GROUP BY sub_category
--    HAVING count(DISTINCT s.slug) > 1
--    ORDER BY sub_category;
--    -- expect: Polos, Sweatshirts, Hoodies, T-shirts, Plastic Pens
--    --   (the legitimate cross-supplier overlaps; no casing variants)
