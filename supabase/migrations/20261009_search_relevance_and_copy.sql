-- =============================================================================
-- 20261009_search_relevance_and_copy.sql — follow-up to #115
--
-- 1. rpc_search_supplier_products: the core-product boost (x1.30) applies only
--    when the core product is RELEVANT to the query (matches every query word,
--    or vector similarity >= 0.40). Irrelevant core products get no boost, so
--    in own-product searches power banks no longer outrank bags for "cotton
--    tote bag". The keyword half of the RRF score now counts only for a real
--    keyword match (@@); non-matching rows used to get keyword ranks in
--    supplier_product_code order (arbitrary). CLAUDE.md §65.5.
-- 2. Owner-approved search features (shown as bullets on the product page):
--    chi-cup, 12oz-recycled-canvas.
-- 3. Remove internal pricing notes from 5 customer-facing descriptions (they
--    also skewed search: tea-towel's "matrix used for clothing" ranked it 3rd
--    for "t-shirt").
--
-- Mirror + embeddings: run scripts/migrate-catalog-to-supplier-products.js and
-- scripts/embed-catalogue.js after applying (or wait for the 03:30/04:00 crons).
-- Rollback: 20261009_search_relevance_and_copy.down.sql.
-- =============================================================================

BEGIN;

-- 1. Search ranking ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_search_supplier_products(query_embedding vector, query_text text, p_category text DEFAULT NULL::text, p_sub_category text DEFAULT NULL::text, p_supplier_slug text DEFAULT NULL::text, p_min_order_quantity integer DEFAULT NULL::integer, p_quantity integer DEFAULT NULL::integer, p_max_unit_price numeric DEFAULT NULL::numeric, p_max_lead_time_days integer DEFAULT NULL::integer, p_in_stock_only boolean DEFAULT true, p_express_only boolean DEFAULT false, p_product_indicator text DEFAULT NULL::text, p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, supplier_product_code text, supplier text, name text, description text, category text, sub_category text, minimum_order_qty integer, lead_time_days integer, express_available boolean, in_stock boolean, is_core_product boolean, product_pricing jsonb, print_details jsonb, items jsonb, images jsonb, plain_images jsonb, shipping_charges jsonb, carton_qty integer, similarity double precision, tsvector_rank double precision, final_score double precision)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  RRF_K               constant integer = 60;
  CORE_MULTIPLIER     constant numeric = 1.30;
  -- The core boost applies only when the core product is RELEVANT to the
  -- query: it matches every query word (ts_match) or its vector similarity is
  -- at least CORE_MIN_SIMILARITY. Irrelevant core products get no boost, so
  -- power banks no longer outrank bags for "cotton tote bag" (CLAUDE.md §65.5).
  CORE_MIN_SIMILARITY constant double precision = 0.40;
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
      COALESCE(ts_rank(sp.search_tsv, ts_q), 0)::double precision AS ts_r,
      COALESCE(sp.search_tsv @@ ts_q, false) AS ts_match
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
      -- Keyword half counts only for a real keyword match (@@). Non-matching
      -- rows (ts_rank ~0, even 1e-20) used to share keyword ranks in
      -- supplier_product_code order, an arbitrary boost.
      (1.0 / (RRF_K + r.vec_rank)
       + CASE WHEN r.ts_match THEN 1.0 / (RRF_K + r.ts_rank_pos) ELSE 0 END)
      * CASE WHEN r.is_core_product AND (r.ts_match OR r.sim >= CORE_MIN_SIMILARITY)
             THEN CORE_MULTIPLIER ELSE 1.0 END
      * CASE WHEN r.supplier_slug = HOUSE_SUPPLIER_SLUG THEN HOUSE_MULTIPLIER ELSE 1.0 END
    )::double precision AS final_score
  FROM ranked r
  ORDER BY final_score DESC
  LIMIT effective_limit;
END;
$function$;

-- 2. Features ----------------------------------------------------------------------
INSERT INTO public.catalog_product_features (catalog_product_id, feature_text, sort_order)
SELECT p.id, $d$Insulated, reusable coffee cup and travel mug$d$, COALESCE((SELECT max(sort_order) FROM public.catalog_product_features f WHERE f.catalog_product_id = p.id), 0) + 1
  FROM public.catalog_products p
 WHERE p.slug = 'chi-cup'
   AND NOT EXISTS (SELECT 1 FROM public.catalog_product_features f
                    WHERE f.catalog_product_id = p.id AND f.feature_text = $d$Insulated, reusable coffee cup and travel mug$d$);

INSERT INTO public.catalog_product_features (catalog_product_id, feature_text, sort_order)
SELECT p.id, $d$Reusable tote bag and shopping bag$d$, COALESCE((SELECT max(sort_order) FROM public.catalog_product_features f WHERE f.catalog_product_id = p.id), 0) + 1
  FROM public.catalog_products p
 WHERE p.slug = '12oz-recycled-canvas'
   AND NOT EXISTS (SELECT 1 FROM public.catalog_product_features f
                    WHERE f.catalog_product_id = p.id AND f.feature_text = $d$Reusable tote bag and shopping bag$d$);

-- 3. Descriptions: internal pricing notes removed ---------------------------------
UPDATE public.catalog_products SET description = $d$EN ISO 20471-compliant high-visibility waistcoat in fluorescent yellow and orange, with reflective tape for daylight and low-light visibility. The standard branded PPE option for construction crews, event marshals, warehouse staff, and site-visit giveaways.$d$
 WHERE slug = 'hi-vis-vest';
UPDATE public.catalog_products SET description = $d$Pullover hooded sweatshirt with front pouch pocket and drawstring hood, sized for adult workwear and team kit orders. Available in white and coloured variants. A staple for event staff, sports clubs, and brand merchandise.$d$
 WHERE slug = 'hoodie';
UPDATE public.catalog_products SET description = $d$Classic three-button polo shirt for corporate uniforms, hospitality teams, and staff workwear. Available in white and coloured garment variants.$d$
 WHERE slug = 'polo';
UPDATE public.catalog_products SET description = $d$Crew-neck sweatshirt in a heavyweight blend, suited to corporate uniforms, university merchandise, and winter event kits. Available in white and coloured garment variants.$d$
 WHERE slug = 'sweatshirts';
UPDATE public.catalog_products SET description = $d$Cotton tea towel with full-coverage print area, suited to gift-shop merchandise, charity fundraisers, museum and heritage retail, and hospitality branded merchandise.$d$
 WHERE slug = 'tea-towel';

COMMIT;

-- 4. Verify (paste into the PR body) --------------------------------------------
-- expect: core_gate = true, keyword_gate = true, new_features = 2, jargon_left = 0
SELECT
  (SELECT prosrc LIKE '%CORE_MIN_SIMILARITY%' FROM pg_proc WHERE oid = 'public.rpc_search_supplier_products'::regproc) AS core_gate,
  (SELECT prosrc LIKE '%WHEN r.ts_match THEN%' FROM pg_proc WHERE oid = 'public.rpc_search_supplier_products'::regproc) AS keyword_gate,
  (SELECT count(*) FROM public.catalog_product_features
    WHERE feature_text IN ('Insulated, reusable coffee cup and travel mug', 'Reusable tote bag and shopping bag')) AS new_features,
  (SELECT count(*) FROM public.catalog_products
    WHERE status = 'active' AND description ~* '(pricing|matrix|priced|capped|floored)') AS jargon_left;
