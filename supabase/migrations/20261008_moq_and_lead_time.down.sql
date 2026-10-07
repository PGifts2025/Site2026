-- Rollback for 20261008_moq_and_lead_time.sql.
-- Restores the pre-migration state exactly: the 10 bag tier rows (original
-- ids/values), the 7 min_order_quantity values, and drops the lead-time columns.
-- Idempotent. No security impact (catalogue data only).

BEGIN;

INSERT INTO public.catalog_pricing_tiers
  (id, catalog_product_id, min_quantity, max_quantity, price_per_unit, is_popular, effective_from, effective_to, created_at)
VALUES
  ('78f3f352-9427-4292-be77-2e048db4c6ca', '820ff91a-7a5d-424a-99cf-13122967b6c2', 25, 49, 5.99, false, '2026-01-14 16:32:38.91496+00', NULL, '2026-01-14 16:32:38.91496+00'),  -- 12oz-recycled-canvas
  ('3019221a-0e20-4149-9519-bf59941e1c7c', '820ff91a-7a5d-424a-99cf-13122967b6c2', 50, 99, 5.39, true, '2026-01-14 16:32:38.91496+00', NULL, '2026-01-14 16:32:38.91496+00'),  -- 12oz-recycled-canvas
  ('ce6400e5-42a3-4740-ae6d-fa79627fef67', '5c0b2e9b-b411-493e-9d80-a0c0dcb98efc', 25, 49, 2.99, false, '2026-01-14 16:32:38.91496+00', NULL, '2026-01-14 16:32:38.91496+00'),  -- 5oz-cotton-bag
  ('f57d535b-1234-4b04-8714-f2f9b0cb399f', '5c0b2e9b-b411-493e-9d80-a0c0dcb98efc', 50, 99, 2.69, true, '2026-01-14 16:32:38.91496+00', NULL, '2026-01-14 16:32:38.91496+00'),  -- 5oz-cotton-bag
  ('d53cbcdb-a5a2-47f8-a9dd-de69560d92fa', 'c8641e80-0bcb-4708-82d1-8c21915ec7b3', 25, 49, 2.69, false, '2026-01-14 16:32:38.91496+00', NULL, '2026-01-14 16:32:38.91496+00'),  -- 5oz-mini-cotton-bag
  ('f6b6a411-d497-428e-904b-8125f930d8df', 'c8641e80-0bcb-4708-82d1-8c21915ec7b3', 50, 99, 2.42, true, '2026-01-14 16:32:38.91496+00', NULL, '2026-01-14 16:32:38.91496+00'),  -- 5oz-mini-cotton-bag
  ('2a07e71e-29e5-4e1d-8cc4-414addfc0aca', '2ce32921-26a4-4b71-bd55-81d74b98d9b2', 25, 49, 3.99, false, '2026-01-14 16:32:38.91496+00', NULL, '2026-01-14 16:32:38.91496+00'),  -- 5oz-recycled-cotton-bag
  ('f0cc9a95-c22f-4f9f-b487-945ea47a2d8c', '2ce32921-26a4-4b71-bd55-81d74b98d9b2', 50, 99, 3.59, true, '2026-01-14 16:32:38.91496+00', NULL, '2026-01-14 16:32:38.91496+00'),  -- 5oz-recycled-cotton-bag
  ('01c92569-25c3-4235-b237-bf4186b36051', '544127cf-d7bc-4b83-9c07-164f8d6f0bb3', 25, 49, 4.99, false, '2026-01-14 16:32:38.91496+00', NULL, '2026-01-14 16:32:38.91496+00'),  -- 8oz-canvas
  ('47e9fedf-e052-460b-a904-8cfe5650c756', '544127cf-d7bc-4b83-9c07-164f8d6f0bb3', 50, 99, 4.49, true, '2026-01-14 16:32:38.91496+00', NULL, '2026-01-14 16:32:38.91496+00')  -- 8oz-canvas
ON CONFLICT (id) DO NOTHING;

UPDATE public.catalog_products SET min_order_quantity = 50
 WHERE slug IN ('t-shirts', 'hoodie', 'sweatshirts', 'polo');
UPDATE public.catalog_products SET min_order_quantity = 25
 WHERE slug IN ('a5-notebook', 'a6-pocket-notebook');
UPDATE public.catalog_products SET min_order_quantity = 250
 WHERE slug = 'edge-white';

-- Original rpc_search_supplier_products (pre-PR 2), verbatim.
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
$function$;

ALTER TABLE public.catalog_products DROP CONSTRAINT IF EXISTS catalog_products_lead_time_days_check;
ALTER TABLE public.catalog_products
  DROP COLUMN IF EXISTS lead_time_days_min,
  DROP COLUMN IF EXISTS lead_time_days_max;

COMMIT;

-- Verify: expect mismatches = 12, bag_sub100_tiers = 10.
SELECT
  (SELECT count(*) FROM (
     SELECT p.id FROM public.catalog_products p
       JOIN public.catalog_pricing_tiers t ON t.catalog_product_id = p.id
      GROUP BY p.id
     HAVING p.min_order_quantity IS DISTINCT FROM min(t.min_quantity)) m) AS mismatches,
  (SELECT count(*) FROM public.catalog_pricing_tiers t
     JOIN public.catalog_products p ON p.id = t.catalog_product_id
    WHERE p.slug IN ('12oz-recycled-canvas', '5oz-cotton-bag', '5oz-mini-cotton-bag',
                     '5oz-recycled-cotton-bag', '8oz-canvas')
      AND t.min_quantity < 100) AS bag_sub100_tiers;
