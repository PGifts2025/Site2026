-- Session 4b patch — rpc_find_alternatives column-ambiguity fix.
--
-- The first version's source-product lookup said:
--   WHERE supplier_product_code = p_supplier_product_code
-- which Postgres cannot disambiguate: supplier_product_code is both
-- a column on supplier_products AND a name in the function's
-- RETURNS TABLE list. Qualifying it as supplier_products.* resolves
-- the conflict. Behaviour unchanged otherwise.

BEGIN;

CREATE OR REPLACE FUNCTION rpc_find_alternatives(
  p_supplier_product_code text,
  p_exclude_out_of_stock  boolean DEFAULT true,
  p_limit                 integer DEFAULT 5
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
  final_score            double precision
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  CORE_MULTIPLIER     constant numeric = 1.15;
  HOUSE_MULTIPLIER    constant numeric = 1.05;
  HOUSE_SUPPLIER_SLUG constant text    = 'pgifts-direct';
  STALE_INTERVAL      constant interval = interval '14 days';
  src_embedding       vector(1536);
  effective_limit     integer;
BEGIN
  effective_limit := GREATEST(1, LEAST(COALESCE(p_limit, 5), 20));

  -- Qualified column reference to disambiguate from the
  -- RETURNS TABLE column of the same name.
  SELECT supplier_products.embedding
    INTO src_embedding
    FROM supplier_products
   WHERE supplier_products.supplier_product_code = p_supplier_product_code
   LIMIT 1;

  IF src_embedding IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    sp.id,
    sp.supplier_product_code,
    s.slug AS supplier,
    sp.name,
    COALESCE(sp.description, sp.web_description) AS description,
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
    (1 - (sp.embedding <=> src_embedding))::double precision AS similarity,
    (
      (1 - (sp.embedding <=> src_embedding))
      * CASE WHEN sp.is_core_product           THEN CORE_MULTIPLIER  ELSE 1.0 END
      * CASE WHEN s.slug = HOUSE_SUPPLIER_SLUG THEN HOUSE_MULTIPLIER ELSE 1.0 END
    )::double precision AS final_score
  FROM supplier_products sp
  JOIN suppliers s ON s.id = sp.supplier_id
  WHERE sp.embedding IS NOT NULL
    AND sp.supplier_product_code <> p_supplier_product_code
    AND sp.last_synced_at > (now() - STALE_INTERVAL)
    AND (NOT p_exclude_out_of_stock OR sp.in_stock = true)
  ORDER BY final_score DESC
  LIMIT effective_limit;
END;
$$;

COMMIT;
