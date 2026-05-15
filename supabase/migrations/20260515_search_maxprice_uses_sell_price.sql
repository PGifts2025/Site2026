-- Replacement for rpc_search_supplier_products.
--
-- Three changes relative to 20260511_search_layer_retune_core_multiplier.sql:
--   1. maxUnitPrice filter reads tier->>'sell_price' instead of tier->>'price'
--      (so the customer-facing ceiling is applied to the customer-facing price,
--      not the raw cost).
--   2. Same swap on the IS NOT NULL guard.
--   3. RETURNS TABLE adds shipping_charges (jsonb) and carton_qty (integer)
--      so the AI chat slimProduct path can compute the UK STANDARD delivery
--      share at each tier's representative qty before sending to the model.
--      (Per Dave's decision Q-RPC bundled into Migration B.)
--
-- Scoring constants are unchanged. The function body is otherwise
-- byte-identical to the retune migration.

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
  shipping_charges       jsonb,
  carton_qty             integer,
  similarity             double precision,
  tsvector_rank          double precision,
  final_score            double precision
)
LANGUAGE plpgsql
STABLE
AS $$
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
$$;

COMMENT ON FUNCTION rpc_search_supplier_products IS
  'Hybrid search: RRF(k=60) over vector + tsvector rankings, multiplied by '
  'core (+30%) and pgifts-direct (+5%) boosts. Staleness filter (14d) is '
  'non-bypassable. maxUnitPrice filters on tier.sell_price (customer-facing) '
  'with COALESCE fallback to raw price for transitional rows. shipping_charges '
  'and carton_qty are returned so callers can compute UK STANDARD delivery '
  'share for slimProduct + unit_price_at_quantity. See CLAUDE.md §31, §46.';

COMMIT;
