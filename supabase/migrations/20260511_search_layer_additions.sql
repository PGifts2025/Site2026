-- Session 4b — Hybrid Search Layer schema additions.
--
-- Adds the columns + tsvector + index + RPC functions that
-- /api/search-products and /api/find-alternatives consume. Pure
-- additive — no existing column or row is mutated except the
-- explicit UPDATE statements below.
--
-- See CLAUDE.md §31 for the design rationale. Short version:
--   - is_core_product / core_priority: curated boost (Dave's 8 hero
--     products today; future-extensible to manual Laltex picks).
--   - lead_time_days, express_available, in_stock: structured
--     filter facets the AI assistant needs.
--   - search_tsv: generated tsvector for the lexical retriever in
--     the hybrid scorer. STORED + GIN index — no triggers needed.
--   - rpc_search_supplier_products / rpc_find_alternatives: the
--     hybrid scoring + filtering lives in Postgres, called from the
--     serverless endpoints via PostgREST rpc. Parameterised, so no
--     SQL-injection surface from user input.

BEGIN;

-- maintenance_work_mem defaults to 32MB on Supabase but the GIN index
-- on search_tsv + the GENERATED column materialisation push past that.
-- SET LOCAL is scoped to this transaction only.
SET LOCAL maintenance_work_mem = '128MB';

-- =====================================================
-- 1. New columns on supplier_products
-- =====================================================

ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS is_core_product   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS core_priority     INTEGER,
  ADD COLUMN IF NOT EXISTS lead_time_days    INTEGER,
  ADD COLUMN IF NOT EXISTS express_available BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS in_stock          BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN supplier_products.is_core_product IS
  'Hero/curated product flag. Drives the +15% multiplier in the search scorer (see CLAUDE.md §31). Seeded by this migration for Dave''s 8 PGifts-Direct hero SKUs; future picks set via direct UPDATE.';

COMMENT ON COLUMN supplier_products.core_priority IS
  'Optional secondary ranking among core products (1 = highest). Currently uniform 1 for the 8 seeded hero SKUs; reserved for future tier-2 / tier-3 curated picks.';

COMMENT ON COLUMN supplier_products.lead_time_days IS
  'Integer working days from artwork approval. Parsed from PrintDetails[0].LeadTime for Laltex (e.g. "5 working days …" -> 5, "Immediate …" -> 0). NULL for PGifts-Direct rows today (catalog_products has no lead-time column).';

COMMENT ON COLUMN supplier_products.express_available IS
  'True if the product is sourced from a fast-turnaround division. Currently derived from supplier_division=''Fast Fit'' for Laltex (~85 products today); always false for PGifts-Direct.';

COMMENT ON COLUMN supplier_products.in_stock IS
  'Last-known stock state. NOT a live signal — the Laltex /stocks endpoint is not yet polled (session 5+). Default true; manual override for known out-of-stock SKUs.';

-- =====================================================
-- 2. tsvector + GIN index for lexical retrieval
-- =====================================================
--
-- Weights mirror "search intent priority":
--   A = name (the single strongest signal)
--   B = description / web_description (preferred lookup)
--   C = keywords (supplier-provided tags)
--   D = category + sub_category (broad bucket fallback)
--
-- STORED generated column means no triggers; Postgres recomputes on
-- any source-column UPDATE. The GIN index keeps ts_rank lookups
-- fast at our scale (<10k rows) and well beyond.

ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')),                                          'A') ||
    setweight(to_tsvector('english', coalesce(description, '') || ' ' || coalesce(web_description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(keywords, '')),                                      'C') ||
    setweight(to_tsvector('english', coalesce(category, '') || ' ' || coalesce(sub_category, '')), 'D')
  ) STORED;

COMMENT ON COLUMN supplier_products.search_tsv IS
  'Generated tsvector for lexical retrieval. Weight A=name, B=description+web_description, C=keywords, D=category+sub_category. Regenerated automatically on any source-column UPDATE — no trigger needed.';

CREATE INDEX IF NOT EXISTS supplier_products_search_tsv_idx
  ON supplier_products
  USING GIN (search_tsv);

-- =====================================================
-- 3. Filter-facet indexes
-- =====================================================
-- The hybrid search RPC filters on these heavily. Cheap to maintain.

CREATE INDEX IF NOT EXISTS supplier_products_in_stock_idx       ON supplier_products (in_stock)         WHERE in_stock = true;
CREATE INDEX IF NOT EXISTS supplier_products_express_idx        ON supplier_products (express_available) WHERE express_available = true;
CREATE INDEX IF NOT EXISTS supplier_products_lead_time_idx      ON supplier_products (lead_time_days)   WHERE lead_time_days IS NOT NULL;
CREATE INDEX IF NOT EXISTS supplier_products_indicator_idx      ON supplier_products (product_indicator) WHERE product_indicator IS NOT NULL AND product_indicator <> '';
CREATE INDEX IF NOT EXISTS supplier_products_last_synced_at_idx ON supplier_products (last_synced_at DESC);

-- =====================================================
-- 4. Express derivation for existing Laltex rows
-- =====================================================
-- The Laltex feed uses 'Fast Fit' as the Supplier (division) value
-- for express products — NOT 'FFP' (short code) or 'Fast Fit Promo'.
-- Verified live: SELECT DISTINCT supplier_division FROM supplier_products
--   -> {'Laltex Promo', 'Pencom', 'Source IT', 'Bags HQ', 'Fast Fit'}
-- 85 rows match today.

UPDATE supplier_products sp
   SET express_available = true
  FROM suppliers s
 WHERE sp.supplier_id = s.id
   AND s.slug = 'laltex'
   AND sp.supplier_division = 'Fast Fit'
   AND sp.express_available = false;

-- =====================================================
-- 5. Core-product seeding (Dave's 8 hero PGifts-Direct SKUs)
-- =====================================================
-- DO NOT extend this list without explicit approval — it is
-- the canonical source of "what gets the +15% RRF boost".
-- New hero picks should be added by a follow-up migration so the
-- decision is traceable in git history.

UPDATE supplier_products sp
   SET is_core_product = true,
       core_priority   = 1
  FROM suppliers s
 WHERE sp.supplier_id = s.id
   AND s.slug = 'pgifts-direct'
   AND sp.supplier_product_code IN (
     'ocean-octopus',
     'octopus-mini',
     'mr-bio',
     'mr-bio-pd-long',
     'ice-p',
     'luggie',
     'gamma-lite',
     'chi-cup'
   );

-- =====================================================
-- 6. RPC: hybrid search
-- =====================================================
--
-- RRF (Reciprocal Rank Fusion) with k=60 over vector + tsvector
-- rankings of the filtered candidate set, multiplied by curated
-- and house-supplier boost factors. Multipliers live as constants
-- in the function body so they're tunable via a follow-up migration.
--
-- Why RPC, not SQL-from-JS:
--   - Parameterised end-to-end. No string concatenation of user
--     input into SQL anywhere in the serverless layer.
--   - Filter logic stays in one place (the function) — JS just
--     marshals the request body into named parameters.
--   - Plan stability: PostgREST treats rpc/<fn> as a stable POST
--     contract, separate from the table's REST shape.
--
-- Staleness filter (last_synced_at > now() - 14 days) is INSIDE
-- the function so callers cannot disable it. Discontinued SKUs
-- whose feed entries vanish age out automatically.

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
  -- Tunable constants. Retuned 2026-05-11 (session 4b verification) —
  -- see 20260511_search_layer_retune_core_multiplier.sql for the
  -- Query-C diagnostic that drove CORE_MULTIPLIER up from 1.15 to 1.30.
  RRF_K               constant integer = 60;
  CORE_MULTIPLIER     constant numeric = 1.30;
  HOUSE_MULTIPLIER    constant numeric = 1.05;
  HOUSE_SUPPLIER_SLUG constant text    = 'pgifts-direct';
  STALE_INTERVAL      constant interval = interval '14 days';
  ts_q                tsquery;
  effective_limit     integer;
BEGIN
  -- Clamp limit to a safe range. The serverless caller also clamps
  -- but this is the last line of defence.
  effective_limit := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));

  -- websearch_to_tsquery handles user input safely (quoted phrases,
  -- "or"/"-", etc.) and never errors on bad punctuation.
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
      -- Price filter: POA rows are excluded when a price ceiling is set
      -- (we can't compare unknown to a number). Without a quantity, any
      -- tier under the ceiling qualifies; with a quantity, the tier
      -- bracket must include that quantity.
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
      -- Rows with ts_r = 0 share an arbitrary tail position but all get
      -- the same (small) contribution to RRF — that's the intended
      -- behaviour: "no lexical match → no lexical signal".
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

COMMENT ON FUNCTION rpc_search_supplier_products IS
  'Hybrid search: RRF(k=60) over vector + tsvector rankings, multiplied by core (+15%) and pgifts-direct (+5%) boosts. Staleness filter (14d) is non-bypassable. See CLAUDE.md §31.';

-- =====================================================
-- 7. RPC: find alternatives (vector-only NN + same boosts)
-- =====================================================
--
-- Source product's embedding is fetched from the row (no OpenAI
-- call). Boosts identical to rpc_search_supplier_products so a
-- core product remains preferred when shown alongside generic
-- alternatives.

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

  -- Qualified column reference: supplier_product_code is also the
  -- name of a RETURNS TABLE column, so an unqualified reference is
  -- ambiguous in plpgsql. (Caught in session 4b verification.)
  SELECT supplier_products.embedding
    INTO src_embedding
    FROM supplier_products
   WHERE supplier_products.supplier_product_code = p_supplier_product_code
   LIMIT 1;

  -- Caller distinguishes 404 (no such product) from 200 + empty list:
  --   - 0 rows here when source not found OR has no embedding
  --   - 0 rows can also legitimately mean "everything else stale / OOS"
  -- The serverless wrapper checks src_embedding presence separately
  -- (one extra round-trip) before deciding 404 vs 200-empty.
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

COMMENT ON FUNCTION rpc_find_alternatives IS
  'Vector-only nearest neighbours of a source product, boosted by core (+15%) and pgifts-direct (+5%) multipliers. Source is excluded; staleness 14d applies. See CLAUDE.md §31.';

-- =====================================================
-- 8. Grants
-- =====================================================
-- service_role only. The serverless endpoints use the service-role
-- key (same pattern as the cron sync/embed routes), and the
-- endpoints themselves enforce Bearer CRON_SECRET auth at the HTTP
-- layer.

REVOKE ALL ON FUNCTION rpc_search_supplier_products FROM PUBLIC;
REVOKE ALL ON FUNCTION rpc_find_alternatives        FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_search_supplier_products TO service_role;
GRANT EXECUTE ON FUNCTION rpc_find_alternatives        TO service_role;

COMMIT;
