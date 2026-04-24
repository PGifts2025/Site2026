-- Supplier + supplier_products foundation.
--
-- New tables are intentionally additive — they do NOT touch the existing
-- catalog_* tables (catalog_products, catalog_pricing_tiers, catalog_print_pricing,
-- catalog_product_colors, catalog_product_images). Those continue to serve the
-- manually-curated 25-product catalogue. Unification of the two surfaces
-- (view vs. migration) is a later-session decision.
--
-- Design notes (full rationale in CLAUDE.md "Laltex Integration Architecture"):
--   * supplier_products stores the Laltex feed shape directly in JSONB.
--     10k+ products × variable nested arrays (print positions, coords,
--     items, shipping, priority) would explode row counts and create
--     schema rigidity if normalised. Reads always pull the whole product
--     (AI results, PDP) so JSONB is read-optimal.
--   * Raw Laltex trade cost only. No markup is applied at sync time.
--     Markup + customer-facing price is a read-time concern (future session).
--   * raw_payload stores the untouched API response for debugging and for
--     schema-drift detection on future Laltex API versions.

-- =====================================================
-- 1. suppliers
-- =====================================================

CREATE TABLE IF NOT EXISTS suppliers (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL UNIQUE,
  slug          TEXT        NOT NULL UNIQUE,
  api_base_url  TEXT,
  notes         TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE suppliers IS
  'Supplier dimension. Session 1 seeds Laltex Promo. Additional suppliers added as they are integrated.';

-- Seed: Laltex Promo
INSERT INTO suppliers (name, slug, api_base_url, notes)
VALUES (
  'Laltex Promo',
  'laltex',
  'https://auto.laltex.com/trade/api',
  'Primary UK supplier. Divisions: PRE, BHQ, SRC, TPC, FFP. API key in .env as LALTEX_API_KEY. Auth header: API_KEY.'
)
ON CONFLICT (slug) DO NOTHING;

-- =====================================================
-- 2. supplier_products
-- =====================================================

CREATE TABLE IF NOT EXISTS supplier_products (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id             UUID        NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_product_code   TEXT        NOT NULL,

  -- Core identity
  name                    TEXT        NOT NULL,
  title                   TEXT,
  description             TEXT,
  web_description         TEXT,
  keywords                TEXT,
  available_colours       TEXT,

  -- Physical / logistics
  product_dims            TEXT,
  unit_weight             TEXT,
  material                TEXT,
  country_of_origin       TEXT,
  tariff_code             TEXT,

  -- Classification
  category                TEXT,
  sub_category            TEXT,
  supplier_division       TEXT,           -- Laltex "Supplier" field (Laltex Promo, etc.)
  product_indicator       TEXT,           -- Clearance / To Be Discontinued / ''

  -- Carton / MOQ
  minimum_order_qty       INTEGER,
  carton_qty              INTEGER,
  carton_dims             TEXT,
  carton_gross_weight     TEXT,

  -- JSONB payloads (see rationale above)
  images                  JSONB,          -- array of URL strings (Product.Images)
  plain_images            JSONB,          -- array of URL strings (Product.PlainImages)
  artwork_templates       JSONB,          -- [{ template, template_type }]
  items                   JSONB,          -- ProductItem[] — colour variants
  product_pricing         JSONB,          -- [{ min_qty, max_qty, price, is_poa }] — parsed
  print_details           JSONB,          -- print positions with nested pricing + coordinates — parsed
  shipping_charges        JSONB,
  priority_service        JSONB,

  -- Debug / sync metadata
  raw_payload             JSONB,          -- full original API response, for debugging and schema-drift detection
  last_synced_at          TIMESTAMPTZ,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT supplier_products_unique UNIQUE (supplier_id, supplier_product_code)
);

COMMENT ON TABLE supplier_products IS
  'Raw supplier feed, stored Laltex-shaped in JSONB. Markup + customer price applied at read time by a later layer, never at sync time. raw_payload preserves the untouched API response.';

COMMENT ON COLUMN supplier_products.product_pricing IS
  'Parsed from Laltex ProductPrice[]. Shape: [{ min_qty:int, max_qty:int|null, price:numeric|null, is_poa:bool }]. Prices stripped of currency symbol; MaxQuantity "N/A" -> null; price > £900 -> is_poa=true, price=null.';

COMMENT ON COLUMN supplier_products.print_details IS
  'Parsed from Laltex PrintDetails[]. Each position carries nested print_price[] and print_area_coordinates[] with pixel values parsed to numbers.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier        ON supplier_products (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_products_category        ON supplier_products (category);
CREATE INDEX IF NOT EXISTS idx_supplier_products_sub_category    ON supplier_products (sub_category);
CREATE INDEX IF NOT EXISTS idx_supplier_products_code            ON supplier_products (supplier_product_code);

-- =====================================================
-- 3. updated_at triggers
-- =====================================================
-- The catalog schema already defines a generic update_updated_at_column()
-- trigger function (see CLAUDE.md §15). Reuse it here.

CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_supplier_products_updated_at
  BEFORE UPDATE ON supplier_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 4. RLS
-- =====================================================
-- SELECT open to authenticated + anon (future AI assistant + PDPs need to
-- read supplier data pre-login). Writes restricted to service_role — only
-- the sync job (running with service-role key) should ever mutate these rows.

ALTER TABLE suppliers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_products ENABLE ROW LEVEL SECURITY;

-- Read policies
CREATE POLICY suppliers_select_all
  ON suppliers FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY supplier_products_select_all
  ON supplier_products FOR SELECT
  TO authenticated, anon
  USING (true);

-- service_role bypasses RLS by default in Supabase, but we make the
-- write grants explicit so intent is documented and auditable.
CREATE POLICY suppliers_service_role_write
  ON suppliers FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY supplier_products_service_role_write
  ON supplier_products FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
