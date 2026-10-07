-- =============================================================================
-- 20261008_moq_and_lead_time.sql — PR 2 (fix/moq-enforcement-and-ai-sync)
--
-- 1. Lead time: nullable catalog_products.lead_time_days_min / _max
--    (CALENDAR days). water-bottle = 28–56 ("4–8 weeks"); all others NULL.
--    The AI mirror converts the max to working days for supplier_products.
-- 2. MOQ source of truth = lowest catalog_pricing_tiers row (CLAUDE.md §16).
--    Owner's decisions (7 Oct 2026) on the 12 products that disagreed:
--      A (column := lowest tier): t-shirts, hoodie, sweatshirts, polo → 25;
--        a5-notebook, a6-pocket-notebook → 50; edge-white → 100.
--      B (minimum is the column, 100): the 5 bags — delete their 25–49 and
--        50–99 flat tiers. No FK references catalog_pricing_tiers; every
--        existing quote line for these bags is >= 100. The bags' remaining
--        tiers stay (the /bags "From £X.XX" reads the cheapest one, §60.4).
--
-- Apply via SQL Editor / Management API BEFORE merging (§52, §64.5).
-- 3. AI search RPC: rpc_search_supplier_products' maxUnitPrice filter prices
--    a quantity below the product's MOQ at the MOQ (else a "200 bottles under
--    £x" search hides the 1,000-minimum water bottle).
--
-- Rollback: 20261008_moq_and_lead_time.down.sql (restores the 10 tier rows
-- with their original ids and values, and the original RPC body).
-- =============================================================================

BEGIN;

-- 1. Lead time columns ----------------------------------------------------------
ALTER TABLE public.catalog_products
  ADD COLUMN IF NOT EXISTS lead_time_days_min integer,
  ADD COLUMN IF NOT EXISTS lead_time_days_max integer;

ALTER TABLE public.catalog_products
  DROP CONSTRAINT IF EXISTS catalog_products_lead_time_days_check;
ALTER TABLE public.catalog_products
  ADD CONSTRAINT catalog_products_lead_time_days_check CHECK (
    (lead_time_days_min IS NULL OR lead_time_days_min >= 0)
    AND (lead_time_days_max IS NULL OR lead_time_days_max >= 0)
    AND (lead_time_days_min IS NULL OR lead_time_days_max IS NULL
         OR lead_time_days_min <= lead_time_days_max)
  );

COMMENT ON COLUMN public.catalog_products.lead_time_days_min IS
  'Production lead time, lower bound, CALENDAR days from artwork approval. NULL = standard / not stated.';
COMMENT ON COLUMN public.catalog_products.lead_time_days_max IS
  'Production lead time, upper bound, CALENDAR days from artwork approval. NULL = standard / not stated.';

UPDATE public.catalog_products
   SET lead_time_days_min = 28, lead_time_days_max = 56
 WHERE slug = 'water-bottle';

-- 2a. Column := lowest tier (decision A) ------------------------------------------
UPDATE public.catalog_products SET min_order_quantity = 25
 WHERE slug IN ('t-shirts', 'hoodie', 'sweatshirts', 'polo');
UPDATE public.catalog_products SET min_order_quantity = 50
 WHERE slug IN ('a5-notebook', 'a6-pocket-notebook');
UPDATE public.catalog_products SET min_order_quantity = 100
 WHERE slug = 'edge-white';

-- 2b. Remove sub-100 tiers on the 5 bags (decision B) ----------------------------
DELETE FROM public.catalog_pricing_tiers t
 USING public.catalog_products p
 WHERE p.id = t.catalog_product_id
   AND p.slug IN ('12oz-recycled-canvas', '5oz-cotton-bag', '5oz-mini-cotton-bag',
                  '5oz-recycled-cotton-bag', '8oz-canvas')
   AND t.min_quantity < 100;

-- 2c. AI search: a budget filter judges below-minimum quantities at the MOQ ----
-- Unchanged except the two p_quantity comparisons (marked). Same signature,
-- so existing grants are kept.
CREATE OR REPLACE FUNCTION public.rpc_search_supplier_products(query_embedding vector, query_text text, p_category text DEFAULT NULL::text, p_sub_category text DEFAULT NULL::text, p_supplier_slug text DEFAULT NULL::text, p_min_order_quantity integer DEFAULT NULL::integer, p_quantity integer DEFAULT NULL::integer, p_max_unit_price numeric DEFAULT NULL::numeric, p_max_lead_time_days integer DEFAULT NULL::integer, p_in_stock_only boolean DEFAULT true, p_express_only boolean DEFAULT false, p_product_indicator text DEFAULT NULL::text, p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, supplier_product_code text, supplier text, name text, description text, category text, sub_category text, minimum_order_qty integer, lead_time_days integer, express_available boolean, in_stock boolean, is_core_product boolean, product_pricing jsonb, print_details jsonb, items jsonb, images jsonb, plain_images jsonb, shipping_charges jsonb, carton_qty integer, similarity double precision, tsvector_rank double precision, final_score double precision)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  RRF_K               constant integer = 60;
  CORE_MULTIPLIER     constant numeric = 1.30;
  HOUSE_MULTIPLIER    constant numeric = 1.05;
  HOUSE_SUPPLIER_SLUG constant text    = 'pgifts-direct';
  STALE_INTERVAL      constant interval = interval '14 days';
  ts_q                tsquery;
  effective_limit     integer;
BEGIN
  effective_limit := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
  ts_q := websearch_to_tsquery('english', COALESCE(query_text, ''));

  RETURN QUERY
  WITH candidate AS (
    SELECT
      sp.id,
      sp.supplier_product_code,
      s.slug AS supplier_slug,
      sp.name,
      sp.description,
      sp.web_description,
      sp.category,
      sp.sub_category,
      sp.minimum_order_qty,
      sp.lead_time_days,
      sp.express_available,
      sp.in_stock,
      sp.is_core_product,
      sp.product_pricing,
      sp.print_details,
      sp.items,
      sp.images,
      sp.plain_images,
      sp.shipping_charges,
      sp.carton_qty,
      (1 - (sp.embedding <=> query_embedding))::double precision AS sim,
      COALESCE(ts_rank(sp.search_tsv, ts_q), 0)::double precision AS ts_r
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id
    WHERE sp.embedding IS NOT NULL
      AND sp.last_synced_at > (now() - STALE_INTERVAL)
      AND sp.is_retired = false
      AND (p_category           IS NULL OR sp.category           = p_category)
      AND (p_sub_category       IS NULL OR sp.sub_category       = p_sub_category)
      AND (p_supplier_slug      IS NULL OR s.slug                = p_supplier_slug)
      AND (p_min_order_quantity IS NULL OR sp.minimum_order_qty IS NULL OR sp.minimum_order_qty <= p_min_order_quantity)
      AND (p_max_lead_time_days IS NULL OR sp.lead_time_days IS NOT NULL AND sp.lead_time_days <= p_max_lead_time_days)
      AND (NOT p_in_stock_only  OR sp.in_stock         = true)
      AND (NOT p_express_only   OR sp.express_available = true)
      AND (p_product_indicator  IS NULL OR sp.product_indicator = p_product_indicator)
      -- Price ceiling: customer-facing sell_price, NOT raw cost.
      -- Falls back to `price` only if `sell_price` is missing (rows that
      -- haven't been recomputed yet — transitional state during the
      -- deploy window). Once recompute-laltex-margins.js runs, every
      -- row has sell_price and this OR-branch never matches.
      AND (
        p_max_unit_price IS NULL
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(sp.product_pricing) tier
          WHERE COALESCE((tier->>'is_poa')::boolean, false) = false
            AND COALESCE((tier->>'sell_price')::numeric, (tier->>'price')::numeric) IS NOT NULL
            AND COALESCE((tier->>'sell_price')::numeric, (tier->>'price')::numeric) <= p_max_unit_price
            AND (
              p_quantity IS NULL
              -- Below the product's minimum, judge the price at the minimum
              -- (matches /api/search-products, which prices below_minimum
              -- rows at their MOQ), so a budget search still surfaces them.
              OR (
                COALESCE((tier->>'min_qty')::integer, 0) <= GREATEST(p_quantity, COALESCE(sp.minimum_order_qty, 0))
                AND (
                  (tier->>'max_qty') IS NULL
                  OR (tier->>'max_qty')::integer >= GREATEST(p_quantity, COALESCE(sp.minimum_order_qty, 0))
                )
              )
            )
        )
      )
  ),
  ranked AS (
    SELECT
      c.*,
      ROW_NUMBER() OVER (ORDER BY c.sim  DESC, c.supplier_product_code) AS vec_rank,
      ROW_NUMBER() OVER (ORDER BY c.ts_r DESC, c.supplier_product_code) AS ts_rank_pos
    FROM candidate c
  )
  SELECT
    r.id,
    r.supplier_product_code,
    r.supplier_slug AS supplier,
    r.name,
    COALESCE(r.description, r.web_description) AS description,
    r.category,
    r.sub_category,
    r.minimum_order_qty,
    r.lead_time_days,
    r.express_available,
    r.in_stock,
    r.is_core_product,
    r.product_pricing,
    r.print_details,
    r.items,
    r.images,
    r.plain_images,
    r.shipping_charges,
    r.carton_qty,
    r.sim                                                  AS similarity,
    r.ts_r                                                 AS tsvector_rank,
    (
      (1.0 / (RRF_K + r.vec_rank) + 1.0 / (RRF_K + r.ts_rank_pos))
      * CASE WHEN r.is_core_product             THEN CORE_MULTIPLIER  ELSE 1.0 END
      * CASE WHEN r.supplier_slug = HOUSE_SUPPLIER_SLUG THEN HOUSE_MULTIPLIER ELSE 1.0 END
    )::double precision AS final_score
  FROM ranked r
  ORDER BY final_score DESC
  LIMIT effective_limit;
END;
$function$;

COMMIT;

-- 3. Verify (paste into the PR body) ---------------------------------------------
-- expect: mismatches = 0, bag_sub100_tiers = 0, water_bottle = 28-56,
--         lead_time_rows = 1
SELECT
  (SELECT count(*) FROM (
     SELECT p.id FROM public.catalog_products p
       JOIN public.catalog_pricing_tiers t ON t.catalog_product_id = p.id
      GROUP BY p.id
     HAVING p.min_order_quantity IS DISTINCT FROM min(t.min_quantity)) m)       AS mismatches,
  (SELECT count(*) FROM public.catalog_pricing_tiers t
     JOIN public.catalog_products p ON p.id = t.catalog_product_id
    WHERE p.slug IN ('12oz-recycled-canvas', '5oz-cotton-bag', '5oz-mini-cotton-bag',
                     '5oz-recycled-cotton-bag', '8oz-canvas')
      AND t.min_quantity < 100)                                                 AS bag_sub100_tiers,
  (SELECT lead_time_days_min || '-' || lead_time_days_max
     FROM public.catalog_products WHERE slug = 'water-bottle')                  AS water_bottle,
  (SELECT count(*) FROM public.catalog_products
    WHERE lead_time_days_min IS NOT NULL OR lead_time_days_max IS NOT NULL)     AS lead_time_rows;
