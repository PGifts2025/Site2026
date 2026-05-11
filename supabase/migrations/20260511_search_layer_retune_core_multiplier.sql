-- Session 4b retune — bump CORE_MULTIPLIER in rpc_search_supplier_products
-- from 1.15 to 1.30 based on Query C diagnostic.
--
-- Context: Query C ("charging cable") with 1.15 placed only 2 of the
-- 4 core cable products (mr-bio-pd-long, mr-bio) in top 5; the other
-- two (octopus-mini, ocean-octopus) were missed because their product
-- names don't contain the word "cable", so ts_rank ranks them ~40th
-- vs ~1-3 for Laltex's named-cable products. RRF base for the cable
-- core products was ~0.025 vs ~0.031-0.033 for Laltex cables.
--
-- Math (raw rank data from scripts/probe-charging-cable.js):
--   ocean-octopus vs ZP0200 — needs multiplier 0.0328/0.0250 = 1.313
--   to overtake. 1.30 puts ocean-octopus at #5 behind ZP0200, with the
--   other 3 core cables ahead. That gives all 4 hero cable products in
--   the top 5 with ZP0200 sandwiched at #4 — the closest we can get
--   to the spec's "4 cable products dominate" without per-product
--   priority weighting.
--
-- The corresponding constant in api/search-products.js (SCORING.core_multiplier)
-- is informational only — the RPC owns the actual scoring. Both kept
-- in sync for code-reading clarity and so the response metadata
-- accurately describes what produced the ranking.
--
-- find-alternatives intentionally keeps 1.15 — it scores on raw cosine
-- similarity (~0.5-0.9), so a 30% multiplier there over-biases (would
-- be +0.15-0.27 absolute, vs +0.005 in the RRF domain).

BEGIN;

SET LOCAL maintenance_work_mem = '128MB';

CREATE OR REPLACE FUNCTION rpc_search_supplier_products(
  query_embedding         vector(1536),
  query_text              text,
  p_category              text    DEFAULT NULL,
  p_sub_category          text    DEFAULT NULL,
  p_supplier_slug         text    DEFAULT NULL,
  p_min_order_quantity    integer DEFAULT NULL,
  p_quantity              integer DEFAULT NULL,
  p_max_unit_price        numeric DEFAULT NULL,
  p_max_lead_time_days    integer DEFAULT NULL,
  p_in_stock_only         boolean DEFAULT true,
  p_express_only          boolean DEFAULT false,
  p_product_indicator     text    DEFAULT NULL,
  p_limit                 integer DEFAULT 10
)
RETURNS TABLE (
  id                     uuid,
  supplier_product_code  text,
  supplier               text,
  name                   text,
  description            text,
  category               text,
  sub_category           text,
  minimum_order_qty      integer,
  lead_time_days         integer,
  express_available      boolean,
  in_stock               boolean,
  is_core_product        boolean,
  product_pricing        jsonb,
  print_details          jsonb,
  items                  jsonb,
  images                 jsonb,
  plain_images           jsonb,
  similarity             double precision,
  tsvector_rank          double precision,
  final_score            double precision
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  -- Retuned 2026-05-11 (session 4b verification, Query C diagnostic).
  RRF_K               constant integer = 60;
  CORE_MULTIPLIER     constant numeric = 1.30;   -- was 1.15
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
      (1 - (sp.embedding <=> query_embedding))::double precision AS sim,
      COALESCE(ts_rank(sp.search_tsv, ts_q), 0)::double precision AS ts_r
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id
    WHERE sp.embedding IS NOT NULL
      AND sp.last_synced_at > (now() - STALE_INTERVAL)
      AND (p_category           IS NULL OR sp.category           = p_category)
      AND (p_sub_category       IS NULL OR sp.sub_category       = p_sub_category)
      AND (p_supplier_slug      IS NULL OR s.slug                = p_supplier_slug)
      AND (p_min_order_quantity IS NULL OR sp.minimum_order_qty IS NULL OR sp.minimum_order_qty <= p_min_order_quantity)
      AND (p_max_lead_time_days IS NULL OR sp.lead_time_days IS NOT NULL AND sp.lead_time_days <= p_max_lead_time_days)
      AND (NOT p_in_stock_only  OR sp.in_stock         = true)
      AND (NOT p_express_only   OR sp.express_available = true)
      AND (p_product_indicator  IS NULL OR sp.product_indicator = p_product_indicator)
      AND (
        p_max_unit_price IS NULL
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(sp.product_pricing) tier
          WHERE COALESCE((tier->>'is_poa')::boolean, false) = false
            AND (tier->>'price') IS NOT NULL
            AND (tier->>'price')::numeric <= p_max_unit_price
            AND (
              p_quantity IS NULL
              OR (
                COALESCE((tier->>'min_qty')::integer, 0) <= p_quantity
                AND (
                  (tier->>'max_qty') IS NULL
                  OR (tier->>'max_qty')::integer >= p_quantity
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
$$;

COMMIT;
