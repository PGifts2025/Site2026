# Pre-Laltex Integration Investigation

**Captured:** 2026-04-23
**Scope:** read-only reconnaissance; nothing in Supabase, Vercel, or the repo was modified
**Next session will reference this document** when designing the Laltex sync + AI assistant pipeline

---

## Table of contents
1. [Current Supabase schema snapshot](#1-current-supabase-schema-snapshot)
2. [Laltex API documentation review](#2-laltex-api-documentation-review) — ⚠ blocked, PDF not found
3. [pgvector extension check](#3-pgvector-extension-check)
4. [Data volume baseline](#4-data-volume-baseline)
5. [Other supplier hooks](#5-other-supplier-hooks)
6. [Questions for Dave](#6-questions-for-dave)

---

## 1. Current Supabase schema snapshot

**Postgres 17.4** on project `cbcevjhvgmxrxeeyldza` (EU-west-2). All queries ran against the live DB via Management API.

### 1.1 Tables at a glance

| Table | Rows | Role |
|---|---:|---|
| `catalog_categories` | 11 | Category taxonomy (hierarchical via `parent_id`) |
| `catalog_products` | 25 | Canonical product records (live catalogue) |
| `catalog_pricing_tiers` | 146 | Volume pricing for flat / coverage pricing models |
| `catalog_print_pricing` | 252 | Screen-print apparel matrix (qty × colour_count × variant) |
| `catalog_product_colors` | 393 | Per-product colour swatches |
| `catalog_product_images` | 220 | Image URLs per product (optionally per colour) |
| `catalog_product_features` | 100 | Bullet-point feature lists |
| `catalog_product_specifications` | 24 | Technical specs (JSONB `specifications`) |
| `product_templates` | 25 | Designer-tool product definitions (Fabric.js canvas) |
| `product_template_variants` | 221 | Colour + view image combinations per template |
| `product_template_colors` | 111 | Template↔apparel_color bridge |
| `product_template_print_areas` | **0** | Superseded by `print_areas` — empty table, candidate for cleanup |
| `print_areas` | 47 | Print area coordinates per template / variant |
| `product_configurations` | 25 | Legacy — appears unused in current flows; candidate for cleanup |
| `products` | **0** | Legacy — empty, pre-refactor table; candidate for cleanup |

**Observations:**
- Three tables are **empty and candidate legacy**: `products`, `product_template_print_areas`, and `product_configurations` may or may not be referenced in code — worth a cleanup pass in a later task, not this one.
- `catalog_products.designer_product_id → product_templates.id` is the single bridge between the catalog schema and the designer schema.

### 1.2 `catalog_products` — the main product table

Columns (21):

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | NO | `uuid_generate_v4()` | PK |
| category_id | uuid | YES | | FK → `catalog_categories.id` (SET NULL) |
| name | varchar | NO | | |
| slug | varchar | NO | | **Unique**; matches the URL segment and `user_designs.product_key` |
| subtitle | text | YES | | |
| description | text | YES | | |
| rating | numeric | YES | `0.0` | Displayed on PDP removed 2026-04-23; column retained |
| review_count | integer | YES | `0` | Same as above |
| badge | varchar | YES | | e.g. "New" / "Best Seller" |
| is_featured | boolean | YES | `false` | Drives Home's Best Sellers carousel |
| is_customizable | boolean | YES | `false` | Whether the Designer tool applies |
| status | varchar | YES | `'draft'` | `draft | active | archived` |
| published_at | timestamptz | YES | | |
| min_order_quantity | integer | YES | `25` | Canonical MOQ for Buy Now flow |
| designer_product_id | uuid | YES | | FK → `product_templates.id` (SET NULL) |
| meta_title / meta_description | varchar / text | YES | | SEO |
| pricing_model | text | YES | | `'clothing' | 'flat' | 'coverage'` |
| max_print_positions | integer | YES | `1` | |
| created_at / updated_at | timestamptz | NO | `now()` (UTC) | |

Indexes:
- PK on `id`; UNIQUE on `slug`
- `idx_catalog_products_category`, `..._featured` (partial), `..._customizable` (partial), `..._status` (partial for `active`), `..._slug`, `..._designer_product`

**No `supplier_id`, `laltex_id`, or any supplier-originating column exists.** Clean slate for multi-supplier design.

### 1.3 Per-product child tables (FK → `catalog_products.id` ON DELETE CASCADE)

All of the following cascade-delete cleanly when a product is removed:

#### `catalog_pricing_tiers` (flat/coverage volume pricing)
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| catalog_product_id | uuid | FK CASCADE |
| min_quantity, max_quantity | int | tier bounds; `max_quantity` nullable = open-ended top |
| price_per_unit | numeric | |
| is_popular | boolean | UI hint |
| effective_from / effective_to | timestamptz | time-bounded pricing |

Indexes: `idx_catalog_pricing_product`, `..._quantity` (composite `product_id, min_qty, max_qty`), `..._effective`

#### `catalog_print_pricing` (screen-print matrix, clothing pricing model)
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| catalog_product_id | uuid | FK CASCADE |
| pricing_model | text | NOT NULL; always `'clothing'` in current data |
| min_quantity, max_quantity | int | qty tier |
| colour_count | int | 1–6 print colours |
| garment_cost, print_cost_per_position, extra_position_price, price_per_unit | numeric | |
| max_positions | int NOT NULL default 1 | |
| coverage_type | text | |
| colour_variant | text default `'coloured'` | DB CHECK: only `'white'` or `'coloured'` — see CLAUDE.md §6.4 |

No FK-specific indexes — one composite candidate index worth adding when this table scales with Laltex (sync performance).

#### `catalog_product_colors`
UNIQUE `(catalog_product_id, color_code)`. Fields: color_code, color_name, hex_value (CHAR! — not VARCHAR, worth noting), swatch_image_url, sort_order, is_active.

Partial index on `is_active = true`.

#### `catalog_product_images`
Fields: image_url, thumbnail_url, medium_url, large_url (4 sizes), alt_text, image_type, sort_order, is_primary, optional color_id FK → `catalog_product_colors.id` (SET NULL).

Partial index on `is_primary = true`.

#### `catalog_product_features`
Simple ordered list: feature_text, icon, sort_order.

#### `catalog_product_specifications`
UNIQUE on `catalog_product_id` (one spec row per product). JSONB `specifications` column with GIN index `idx_catalog_specs_jsonb` — already well-positioned for Laltex dumping arbitrary spec shapes.

### 1.4 Designer schema (separate from catalog)

`product_templates` / `product_template_variants` / `product_template_colors` / `print_areas` — these drive the Fabric.js Designer tool, not the catalogue. Linked via `catalog_products.designer_product_id`. Laltex sync should **not** touch these tables — the Designer is a manual product-template authoring flow.

### 1.5 Foreign-key map (catalog side)

```
catalog_categories ──┬── (self, parent_id) SET NULL
                     └── catalog_products.category_id SET NULL

catalog_products ──┬── catalog_pricing_tiers.catalog_product_id CASCADE
                   ├── catalog_print_pricing.catalog_product_id CASCADE
                   ├── catalog_product_colors.catalog_product_id CASCADE
                   ├── catalog_product_images.catalog_product_id CASCADE
                   │                           └─ .color_id → catalog_product_colors.id SET NULL
                   ├── catalog_product_features.catalog_product_id CASCADE
                   ├── catalog_product_specifications.catalog_product_id CASCADE (UNIQUE 1:1)
                   └── .designer_product_id → product_templates.id SET NULL
```

Cascade chain is clean: deleting a product sweeps its tiers, print pricing, colors, images, features, specs. Safe for Laltex full-refresh if we ever choose "delete-and-reinsert" sync semantics.

### 1.6 Pre-existing invariants relevant to Laltex sync

From CLAUDE.md + live DB inspection:
- `catalog_print_pricing.colour_variant` is constrained to `'white' | 'coloured'` only (DB CHECK). Any Laltex colour taxonomy needs mapping to this binary.
- `catalog_products.slug` is unique and used as URL key AND as `user_designs.product_key`. Stable slug is critical — Laltex product ID should NOT become the slug; keep our own stable slug layer.
- `pricing_model` is `'clothing'|'flat'|'coverage'`. Laltex's pricing shape will determine which of these each synced product lands in.

---

## 2. Laltex API documentation review

Source: `site/docs/Laltex API Documentation V1.7.pdf` (version 1.7, dated 2025-05-20, latest).

### 2.1 Authentication
- **Mechanism:** `API_KEY` passed as an HTTP header. Key is "provided by admin" — no self-service provisioning or rotation process is documented.
- **No OAuth, no HMAC request signing.** Single static key.
- **Currency:** the `CURR` parameter (either header or query — docs are ambiguous, example URLs don't include it) accepts `GBP` or `EUR`. GBP is the documented default.
- **Response format:** JSON or XML, selected via `Content-Type` / `Accept: application/json`.
- **Planned key storage (for PGifts):** mirror the Stripe pattern — put the key in Supabase Edge Function secrets, never in `.env` or Vercel env. Sync runs from an Edge Function.

### 2.2 Endpoints — all GET, all read-only

Base URL: `https://auto.laltex.com/trade/api/`

| Endpoint | Purpose | Returns |
|---|---|---|
| `GET v1/products/list` | Full product feed | `ArrayOfProduct` |
| `GET v1/products/{productcode}` | One product, full detail | `Product` |
| `GET stocks/{productcode}` | Stock per product (level + due-ins) | `ArrayOfStock` |
| `GET v1/productmin/list` | **Lightweight** feed for every product (fewer fields) | `ArrayOfSKUProduct` |
| `GET v1/productmin/{division}` | Lightweight feed filtered to one division | `ArrayOfSKUProduct` |
| `GET order/status` | All orders for the API key's account | `ArrayOfOrderStatus` |
| `GET order/status/{salesorder}` | One order's status | `OrderStatus` |

**Divisions:** `PRE`, `BHQ`, `SRC`, `TPC`, `FFP`. Meaning not explained in the PDF. `FFP` is the apparel-like division per version-history hint ("Added ItemSize in Stock & Product API for FFP items") — likely the Fruit-of-the-Loom-Fashion-Plus (educated guess, needs Laltex confirmation).

### 2.3 Rate limits / throttling
**Not documented.** The PDF makes no mention of request ceilings, per-minute limits, or throttling response codes. **Treat this as a gap to resolve with Laltex directly before production sync.**

### 2.4 Products endpoint — full response field reference

A `Product` object carries the following top-level fields (inferred from both the documentation tables and the JSON examples; `*` marks fields added after v1.0):

| Field | Type | Notes |
|---|---|---|
| `ProductCode` | string | e.g. `"MG0192"` — the Laltex product key |
| `ProductName` | string | |
| `ProductTitle` * | string (v1.2) | Web title — may differ from `ProductName` |
| `Description` | string | |
| `WebDescription` * | string (v1.2) | Web-friendly description |
| `KeyWords` * | string (v1.3) | Comma-separated keywords for search/SEO |
| `AvailableColours` | string | Comma-separated colour-name list (informational; authoritative colours live in `Items[].ItemColour`) |
| `ProductDims` | string | Free-form, e.g. `"170x87mm dia"` |
| `UnitWeight` * | string (v1.3) | KG, may be empty string |
| `Supplier` | string | Sales division — e.g. `"Laltex Promo"` |
| `Category` | string | |
| `SubCategory` | string | |
| `ProductIndicator` * | string (v1.6) | Enum-ish: `""` (normal), `"Clearance"`, `"To Be Discontinued"`, presumably also Made-To-Order values |
| `TariffCode` * | string (v1.4) | HS tariff code |
| `CountryOfOrigin` * | string (v1.4) | e.g. `"CHINA"` — upper-case country name |
| `MinimumOrderQty` | int | |
| `CartonQty` | int | Pieces per carton |
| `CartonDims` * | string (v1.5) | e.g. `"28 x 37.8 x 74 cm"` |
| `CartonGrossWeight` * | string (v1.5) | e.g. `"8.410 kg"` |
| `Material` * | string (v1.5) | e.g. `"Plastic"` |
| `Ingredients` * | string (v1.5) | Usually empty; populated for consumables |
| `Images` | array<string> | Main/group image URLs |
| `PlainImages` * | array<string> (v1.5) | Plain (no-lifestyle) image URLs |
| `ArtworkTemplates` | array<Template> | PDF artwork templates (one per colour-variant, typically) |
| `Items` | array<ProductItem> | Per-colour item variants |
| `ProductPrice` | array<ProductPrice> | Volume-price tiers at product level |
| `PrintDetails` | array<PrintDetails> | Print methods, pricing, lead times, print-area coordinates |
| `PriorityService` | array<Priority> | Rush-service options — empty `[]` is common |
| `ShippingCharge` | array<Shipping> | Per-service, per-carton shipping cost tables |

#### `ProductItem` (colour variant of the product)
| Field | Type | Notes |
|---|---|---|
| `ItemCode` | string | e.g. `"MG0192AM"` (parent code + colour suffix) |
| `ItemDescription` | string | |
| `ItemColour` | string | Human colour name; authoritative |
| `ItemIndicator` * | string (v1.6) | Per-item equivalent of `ProductIndicator` |
| `PMS` * | string (v1.5) | Pantone code (`"1505C"`, `"Black"`, ...) |
| `ItemImages` | array<string> | |
| `PlainImages` * | array<string> (v1.5) | |
| `ItemSize` * | string (v1.5) | Non-null for FFP/clothing items (e.g. size label) |
| `SeedType` * | string / null (v1.7) | Promo-seed items only |

#### `ProductPrice` (volume tier at product level)
| Field | Type | Notes |
|---|---|---|
| `MinQuantity` | string | Lower bound |
| `MaxQuantity` | string | Upper bound OR literal `"N/A"` for open-ended top tier |
| `Price` | string | **Currency-formatted string with symbol**, e.g. `"£1.54"`. Must strip + parse. Values > £900 mean **POA (Price on Application)** — flag in UI, not a real price |
| `Note` | string | |

#### `PrintDetails` (per print method / position)
| Field | Type | Notes |
|---|---|---|
| `PrintClass` | string | Personalisation category (e.g. `"Spot Print"`) |
| `PrintType` | string | Specific technique |
| `PrintPosition` | string | `"Front"`, `"Back"`, `"Side"`, `"Top"`, ... |
| `PrintArea` | string | Max printable area (free-form) |
| `MaxColours` | string | Max colours for this position/method |
| `LeadTime` | string | Lead-time for this personalisation |
| `SetupCharge` | string | Per colour/design |
| `RptSetupCharge` | string | Repeat print setup charge |
| `ExtraColourSetupCharge` | string | |
| `PrintPrice` | array<PrintPrice> | Volume tiers for print cost |
| `DefaultPrintOption` * | bool (v1.5) | True = show this method as default |
| `PrintAreaCoordinates` * | array<PrintAreaCoordinate> (v1.6.1) | Per-colour pixel coordinates for the print area |

#### `PrintPrice`
`MinQuantity` · `MaxQuantity` (may be `"N/A"`) · `Price` (currency string) · `NumColours` · `NumPosition`.

#### `PrintAreaCoordinate` (v1.6.1+)
| Field | Type | Notes |
|---|---|---|
| `ImageUrl` | string | Source image |
| `MarkedImageUrl` * | string (v1.6.2) | Same image with the print-area box overlaid |
| `Colour` | string | Colour name this coordinate set applies to |
| `Xpos`, `YPos` | string | e.g. `"267.500px"` — **includes the `px` suffix**, strip before parsing |
| `Width`, `Height` | string / null | Rectangular areas; null for circles |
| `Diameter` | string / null | Set for circular areas; null for rectangles |

This aligns exactly with our existing `print_areas` table's `shape = 'rectangle' | 'circle'` split — good sign, minimal schema work needed to ingest.

#### `Priority` (rush service)
`PriorityServiceType` · `PrintClass` · `PrintType` · `MaxColours` · `Quantity` · `PriorityCharge`.

#### `Templates` (artwork PDFs)
`Template` (URL) · `TemplateType` (e.g. `"Spot Print"`). Typically one per colour variant.

#### `Shipping` / `ShipCharge`
Each service type (e.g. `ukstandard`, `ukpre1030am`) has a table by carton count.
`ShipCharge`: `Carton` (number or `"11+"`) · `Pieces` (matching count or `"396+"`) · `ShippingCharge` (currency string or `"N/A"` or `"POA"`) · `PerCartonCharge` (overflow rate, or `"N/A"`).

### 2.5 Stock endpoint — response shape

`Stock` object (one per item/colour variant):

| Field | Type | Notes |
|---|---|---|
| `ProductCode` | string | Item code (e.g. `"MG0192AM"`) |
| `Description` | string | |
| `Colour` | string | |
| `PMS` | string | |
| `FreeStock` | int | Floor stock. **`-1` means Made-To-Order** |
| `Size` | string / null | Size label for FFP items; null otherwise |
| `SeedType` * | string / null (v1.7) | Seed-item variants only |
| `DueIns` | array<DueIn> | Upcoming restocks |

`DueIn`: `DueInQty` (int) · `DueInETA` (ISO timestamp, e.g. `"2025-06-20T00:00:00"`).

### 2.6 Product Min endpoint — lightweight feed

`SKUProduct` object — a trimmed-down `Product`:

`ProductCode`, `ProductName`, `ProductTitle`, `Description`, `WebDescription`, `KeyWords`, `AvailableColours`, `Supplier`, `Category`, `SubCategory`.

**No pricing, no print details, no stock, no images in the min feed.** Useful for category-browsing / lookup tables, not for full product pages.

### 2.7 Order Status endpoint — read-only

`OrderStatus` object:

| Field | Type | Notes |
|---|---|---|
| `SalesOrder` | int | Laltex's order reference |
| `Reference` | string | Customer-supplied reference (ours) |
| `OrderDate` | string | `"dd/mm/yyyy"` UK format |
| `OrderStatus` | string | `"Open"`, etc. Enum values not fully listed |
| `Address1`-`Address6` | string | Delivery address (6 lines) |
| `PostCode`, `Country` | string | |
| `OrderValue`, `VatValue`, `TotalValue` | number | Pound/Euro monetary values — these are **numbers**, not currency strings, unlike product prices |
| `FinanceApproved`, `StockAllocated` | `"Yes"`/`"No"` | Stringly-typed booleans |
| `ArtworkStatus` | string | |
| `ArtflowApprovalLink` | string / URL | |
| `IsOnHold` | `"Yes"`/`"No"` | |
| `ItemDetails` | array<ProductItem> | Order lines |
| `DespatchDetails` | array<Despatch> | |

`Order-status ProductItem`: `ProductCode`, `Description`, `Quantity` (int), `UnitPrice` (number), `RequiredDate` (string), `PrintDetail` (object or null).

`Order-status PrintDetail` (inside order items): `PrintText`, `PrintColours`, `PrintPosition`, `NumCols`, `NumPosition`, `NumHits`, `MarkCarton`.

`Despatch`: `DespatchDate` (ISO or null), `Carrier`, `TrackingNum`, `TrackingLink`.

### 2.8 Laltex → PGifts schema mapping

Mapping from Laltex feed fields into our existing columns. **Transform** column notes any normalisation needed.

#### `Product` → `catalog_products`

| Laltex | PGifts column | Transform | Confidence |
|---|---|---|---|
| `ProductCode` | `catalog_products.supplier_product_id` (NEW column, see §2.9) | keep verbatim | High |
| `ProductCode` (slugified) or `ProductName` (slugified) | `catalog_products.slug` | needs our own stable slug layer to avoid churn if Laltex renames | High |
| `ProductName` | `catalog_products.name` | verbatim | High |
| `ProductTitle` | `catalog_products.meta_title` (re-use) **or** NEW `title` column | verbatim | Medium — PGifts's `name` is the primary display; need to decide semantics |
| `Description` | `catalog_products.description` | verbatim | High |
| `WebDescription` | `catalog_products.description` (override?) | prefer `WebDescription` if present | Medium |
| `KeyWords` | NEW `keywords` column or future `catalog_products.search_text tsvector` | split on comma, feed into tsvector | High |
| `AvailableColours` | derived (use `Items[]` instead) | ignore — the `Items` array is authoritative | High |
| `ProductDims` | `catalog_product_specifications.specifications` (JSONB) | put under `dimensions` key | High |
| `UnitWeight` | `catalog_product_specifications.specifications.unit_weight_kg` | strip unit, parse number | High |
| `Supplier` | NEW `suppliers.division` OR `catalog_products.supplier_division` | Laltex-only, flags division | Medium |
| `Category` / `SubCategory` | `catalog_categories.name` + subcategory tree | need to reconcile with our 11 categories; divergence likely | Low — real decision needed |
| `ProductIndicator` | NEW `catalog_products.status_indicator` | enum: `clearance | to_be_discontinued | null` | High |
| `TariffCode` | `catalog_product_specifications.specifications.tariff_code` | verbatim | High |
| `CountryOfOrigin` | NEW `catalog_products.country_of_origin` | upper-case to ISO3 or keep as-is | High |
| `MinimumOrderQty` | `catalog_products.min_order_quantity` | direct | High |
| `CartonQty` | `catalog_product_specifications.specifications.carton_qty` | int | High |
| `CartonDims` | `catalog_product_specifications.specifications.carton_dims` | string | High |
| `CartonGrossWeight` | `catalog_product_specifications.specifications.carton_gross_weight_kg` | strip unit | High |
| `Material` | NEW `catalog_products.material` or spec JSONB | verbatim | High |
| `Ingredients` | `catalog_product_specifications.specifications.ingredients` | verbatim | High |
| `Images` | `catalog_product_images` rows with `image_type='main'` | one image per URL; generate our own `thumbnail/medium/large` via derive-on-upload or defer until we re-host | High |
| `PlainImages` | `catalog_product_images` rows with `image_type='plain'` | same | High |
| `ArtworkTemplates` | NEW table `catalog_artwork_templates` (per-variant) | URL + type | High |
| `Items[]` | `catalog_product_colors` + per-item images | see below | High |

#### `Items[]` (colour variants) → `catalog_product_colors`

| Laltex | PGifts column | Transform | Confidence |
|---|---|---|---|
| `ItemCode` | NEW `catalog_product_colors.supplier_item_code` | verbatim | High |
| `ItemDescription` | — (not stored; redundant with parent description) | drop | High |
| `ItemColour` | `catalog_product_colors.color_name` | verbatim | High |
| `ItemColour` (first char or lookup) | `catalog_product_colors.color_code` | our internal code | High |
| *PMS-derived* or NULL | `catalog_product_colors.hex_value` | Laltex doesn't give hex; need a PMS→hex lookup OR leave null and display via image only | Low — real gap |
| `PMS` | NEW `catalog_product_colors.pms` | verbatim | High |
| `ItemIndicator` | NEW `catalog_product_colors.status_indicator` | enum | Medium |
| `ItemImages` | `catalog_product_images` rows FK'd to colour_id | one row per URL | High |
| `PlainImages` | `catalog_product_images` rows, `image_type='plain'`, FK'd to colour_id | | High |
| `ItemSize` | NEW `catalog_product_colors.size` (FFP/apparel only) | nullable | High |
| `SeedType` | NEW `catalog_product_colors.seed_type` | nullable, seeds only | High |

#### `ProductPrice[]` → `catalog_pricing_tiers`

Direct match. Laltex gives MinQty/MaxQty/Price tiers; our table has exactly the same shape.

| Laltex | PGifts column | Transform | Confidence |
|---|---|---|---|
| `MinQuantity` | `catalog_pricing_tiers.min_quantity` | parse int | High |
| `MaxQuantity` | `catalog_pricing_tiers.max_quantity` | `"N/A"` → null | High |
| `Price` | `catalog_pricing_tiers.price_per_unit` | strip `£`/`€`, parse numeric; **if value > £900 set a `is_poa` flag and keep price null** | High — needs new `is_poa` column |

#### `PrintDetails[]` → `catalog_print_pricing` + new `catalog_print_area_coordinates`

**Biggest schema friction.** Laltex's print model is richer than our `catalog_print_pricing` matrix.

| Laltex field | PGifts column | Notes |
|---|---|---|
| `PrintClass`, `PrintType` | NEW columns on `catalog_print_pricing` | Laltex distinguishes class + type; we currently don't |
| `PrintPosition` | `catalog_print_pricing` — currently implied per-row; make explicit | |
| `PrintArea` | `catalog_print_pricing.coverage_type` or free-form | likely direct |
| `MaxColours` | reuse via `colour_count` matrix | |
| `LeadTime` | NEW column `lead_time_days` (parse to int from string like `"5 working days"`) | |
| `SetupCharge`, `RptSetupCharge`, `ExtraColourSetupCharge` | NEW columns | |
| `PrintPrice[]` | `catalog_print_pricing` rows, one per (NumColours, NumPosition, MinQty) triple | |
| `DefaultPrintOption` | NEW bool column | |
| `PrintAreaCoordinates[]` | NEW table `catalog_print_area_coordinates` | see mapping below |

#### `PrintAreaCoordinate[]` → NEW table aligned with existing `print_areas`

Our existing `print_areas` table (for the Designer) has `x`, `y`, `width`, `height`, `shape`, `width_mm`, `height_mm`. Laltex's `PrintAreaCoordinate` maps well:

| Laltex | Target column | Notes |
|---|---|---|
| `ImageUrl`, `MarkedImageUrl` | URL columns | |
| `Colour` | FK to `catalog_product_colors` | |
| `Xpos`, `YPos` | `x`, `y` | strip `px`, parse numeric |
| `Width`, `Height` | `width`, `height` | strip `px` |
| `Diameter` | `diameter` (NEW) | strip `px` |
| Implied | `shape` | `Diameter` present → `circle`; else `rectangle` |

**Decision to make:** reuse the existing `print_areas` table (designed for the canvas Designer) OR create a separate `catalog_print_area_coordinates` table (supplier-driven, read-mostly). Recommending the latter — Designer templates are manually authored and should not be overwritten by a supplier sync.

#### `Stock` → NEW table `catalog_stock_levels`

No current equivalent in our schema. Proposed:

```
catalog_stock_levels (
  id uuid PK,
  item_code text UNIQUE NOT NULL,        -- Laltex ItemCode
  catalog_product_color_id uuid FK → catalog_product_colors.id,
  free_stock integer NOT NULL,           -- -1 means Made-To-Order
  size text,
  seed_type text,
  synced_at timestamptz NOT NULL,
  created_at, updated_at
)
catalog_stock_due_ins (
  id uuid PK,
  stock_id uuid FK → catalog_stock_levels.id ON DELETE CASCADE,
  qty integer NOT NULL,
  eta timestamptz NOT NULL
)
```

#### `OrderStatus` → existing `orders` table

Our existing `orders` table already carries most of what Laltex returns. If we choose to reconcile order status back into our DB, mapping is straightforward. **But first we need to answer: how are orders placed with Laltex in the first place?** (see §6).

### 2.9 NEW data Laltex brings that PGifts doesn't capture today

Fields we'd need to add:

1. **`supplier_product_id`** (on `catalog_products`) — Laltex ProductCode reconciliation anchor. Unique per supplier.
2. **`country_of_origin`** — currently no column.
3. **`tariff_code`** — export HS code. Store in `specifications` JSONB or a dedicated column.
4. **`material`** — single-value string; candidate for a filterable column.
5. **`ingredients`** — rarely populated but legally relevant for consumables.
6. **`keywords`** — currently no column; prime candidate for feeding a future `tsvector` search_text column.
7. **`product_indicator` / `item_indicator`** — Clearance / To Be Discontinued flags. Drive filter UI.
8. **`status_indicator`** values MAY include Made-To-Order and Clearance — not fully enumerated in the PDF.
9. **`carton_qty`, `carton_dims`, `carton_gross_weight`** — shipping/logistics; probably JSONB on specs.
10. **`unit_weight_kg`** — shipping calc input.
11. **`pms`** (Pantone code) on colour variants — brand-matching aid, not currently stored.
12. **`default_print_option`** per print method.
13. **`lead_time`** per print method — drives Express Delivery filter (when we rebuild the feature strip per §18).
14. **`priority_service`** — rush-order options and surcharge tiers.
15. **`shipping_charges`** — per-carton tables per service. Our checkout currently has flat "£250+ free delivery" rules; Laltex's actual costs are detailed.
16. **`print_area_coordinates`** with per-colour image overlays (`ImageUrl` + `MarkedImageUrl`) — richer than our current `print_areas` table has for catalog products (the Designer has coordinates but those are manually authored per template).
17. **`is_poa`** flag — any price > £900 per Laltex rules is "Price on Application" and should be surfaced as "Call for price" not a numeric value.
18. **`artwork_template`** URLs per colour variant.
19. **`free_stock` + `due_ins`** — no stock tracking today.
20. **`seed_type`** — only for promo-seed items; niche.
21. **`size`** (on items) — for FFP/apparel division only.

### 2.10 Key gaps / ambiguities

- **No rate limits documented.** Must confirm with Laltex; plan conservatively (e.g. 1 req/sec) until known.
- **No webhook / push mechanism.** Sync is pull-only. Frequency TBD — nightly is natural but stock-critical items may want hourly.
- **No "Eco-Friendly" explicit flag.** The closest proxies are `Material` strings containing "recycled"/"bamboo"/"cotton" and `KeyWords` mentions. If eco-filtering is a launch-day requirement, we'll need either a text-mining rule or a manual override column.
- **No order placement API.** The `order/status` endpoint is read-only. **Orders must flow to Laltex via some channel not in this PDF** — email, a separate portal, EDI, or a different documented API. Dave needs to clarify before we wire the Pay-Now flow to actually reach Laltex.
- **No sandbox/test environment mentioned.** Same `auto.laltex.com` for production. Risk of hammering a live endpoint during development.
- **POA handling** (Price > £900 → Price on Application) is stated in prose but not carried as a flag in the payload — the client has to detect it from the string/number. Ingest logic needs to detect and flag.
- **Currency-string prices** ("£1.54") require encoding-aware parsing (the PDF renders `£` as `�` in some contexts). Be careful about UTF-8 handling in ingest.
- **`"N/A"` is overloaded.** Appears in `MaxQuantity`, `ShippingCharge`, `PerCartonCharge` — each with slightly different semantics. Ingest layer must branch per field.
- **Division meanings** (`PRE/BHQ/SRC/TPC/FFP`) are not explained. We'd need this to implement `GET v1/productmin/{division}` usefully.
- **PMS → hex colour** is not provided. Laltex gives Pantone codes only. Our `catalog_product_colors.hex_value` expects a hex. Need either a PMS lookup table, a fallback to image-based swatches, or accept null for Laltex-origin products.
- **API key provisioning / rotation process** not documented.

---

## 3. pgvector extension check

**Queried:** `pg_available_extensions` + `pg_extension` on the live DB.

| Property | Value |
|---|---|
| Extension name | `vector` |
| Available on project | ✅ Yes |
| Default version available | 0.8.0 |
| Currently installed | ❌ No |
| Postgres version | 17.4 (compatible with pgvector 0.8.x) |

**To enable (do not run in this task):**
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```
This is a one-time DDL; can be run via Management API once the AI assistant work begins.

**Design notes for future session:**
- pgvector 0.8.0 supports `halfvec` (16-bit) and `sparsevec` (sparse) in addition to full `vector(n)` — consider halfvec for product embeddings (~50% storage savings with minimal recall loss for 1536-dim or smaller models).
- HNSW index is the current recommended index type (better recall/latency than IVFFlat for small-to-medium corpora). At 25 products today, any index is overkill; at Laltex-scale (10k+) HNSW is the right default.
- No tsvector full-text search index currently exists on `catalog_products.name` / `description`. For a hybrid search strategy (dense + sparse / BM25), add a `tsvector` column alongside `embedding` — worth planning in the same migration.

---

## 4. Data volume baseline

### 4.1 Current catalogue
- **25 products** live in `catalog_products`
- **16 MB** total database size across all tables (`pg_database_size(current_database())`)
- Dominant table by row count: `catalog_product_colors` (393 rows)

### 4.2 Laltex feed size
**Unknown** — pending PDF (§2). Need confirmation of:
- Total number of products in the feed
- Whether it's paginated or full-dump
- Whether it's push or pull

### 4.3 Supabase plan / usage
**Couldn't fetch plan tier programmatically.** The Management API `/v1/organizations/{id}/billing/subscription` endpoint returned 404. Project add-ons endpoint showed `selected_addons: []` (no paid add-ons active), consistent with Free tier but not conclusive.

**Recent usage pulled from `analytics/endpoints/usage.api-counts`:**
- Last minute: 56 REST, 12 Storage, 0 Auth, 0 Realtime — well below any limit

**"EXCEEDING USAGE LIMITS" flag from earlier session:** not reproducible right now. DB is 16 MB (Free tier cap: 500 MB); no signals of pressure. Two possibilities:
- (a) Was a transient issue (e.g., project-paused-due-to-inactivity on Free tier, or one-day egress spike)
- (b) A different limit (bandwidth / Auth MAU / Edge Function invocations) was briefly hit

**Recommendation before Laltex sync goes live:** confirm plan tier in the Supabase Dashboard → Organization → Billing page. If still Free, consider pre-emptive upgrade to Pro ($25/mo) — Laltex nightly sync of potentially thousands of products, plus embedding generation for the AI assistant, will push bandwidth and Edge Function usage.

### 4.4 Scaling indicators for the next session
- `catalog_print_pricing` is 252 rows for 7 products (36 rows/product). At 10k Laltex products that matrix could balloon — **design decision needed: do we explode Laltex pricing into tier rows, or keep it as a JSONB blob on `catalog_products.pricing`**?
- `catalog_product_colors` at 393 rows for 25 products (15.7 avg) × 10k ≈ 157k rows — still small, no index concerns.
- `catalog_product_images` at 220 rows × 10k / 25 ≈ 88k rows — fine.
- Storage (`catalog-images` bucket) will dominate — plan for Laltex image-URL pass-through rather than re-hosting if possible.

---

## 5. Other supplier hooks

**Grep sweep of `site/src` for:** `laltex | supplier_id | supplier_sku | supplier_name`

**Result: zero matches.** The codebase is entirely single-supplier implicitly (us) but has no hardcoded assumption. No column, no env var, no type definition, no reference — not even in seed scripts.

**Grep of `.env`, Vercel env:** no `LALTEX_*` / `SUPPLIER_*` variables.

**Grep of all `.md` docs in the repo:** `laltex` appears only in `site/.claude/CLAUDE.md` (handover notes + the §18 Future work block I added earlier today).

**Implication for multi-supplier schema design:** **genuinely clean slate.** The next session can design a `suppliers` dimension table + `catalog_products.supplier_id` FK (or similar) from scratch without reverse-engineering assumptions. No refactor debt.

**Suggested approach to capture in the next session:**
```
suppliers (id, name, slug, api_base_url, notes, is_active)
catalog_products.supplier_id → suppliers.id
catalog_products.supplier_product_id (Laltex's ID; preserve for sync reconciliation)
catalog_products.supplier_last_synced_at (nullable timestamptz)
```
UNIQUE `(supplier_id, supplier_product_id)` to prevent duplicate imports.

---

## 6. Questions for Dave

Decisions / clarifications the next session will need, plus open questions for Laltex directly.

### 6.1 For Dave (internal decisions)

1. **Laltex API key** — CLAUDE.md says "key provisioned, no code yet". Not in `.env`, not in Vercel env. Where is it stashed (password manager)? When do we introduce it into Supabase Edge Function secrets?

2. **Supabase plan tier** — can't verify programmatically. Please check Dashboard → Org → Billing. If Free, upgrade before Laltex sync work starts — nightly sync + embedding generation for the AI assistant will put real load on bandwidth and Edge Function invocations.

3. **Second supplier** — who is it? Naming it now helps shape the `suppliers` table and avoid Laltex-specific assumptions leaking in.

4. **AI assistant strategy** — purely semantic (pgvector + embeddings), or hybrid (pgvector + tsvector / BM25)? Affects whether the sync adds a `search_text tsvector` column alongside `embedding vector(N)`. Given Laltex's `KeyWords` field, hybrid looks strongly preferable.

5. **Sync semantics** — nightly full-replace, or incremental upsert by `supplier_product_id`? Stock (`free_stock`) probably wants a separate higher-frequency sync (hourly?) from the product feed (nightly is fine).

6. **Laltex pricing** — customer-facing or wholesale (needs markup)? Affects whether we replace `catalog_pricing_tiers` or add a `wholesale_price` alongside `price_per_unit` and compute retail in a view. Current PGifts margin model (§6 of CLAUDE.md — 22/20/18%) will need to be applied to Laltex prices somewhere.

7. **Legacy tables** — `products` (0 rows), `product_configurations` (25 rows, unknown if consumed), `product_template_print_areas` (0 rows) look legacy. Confirm drop-candidacy in a separate pre-Laltex cleanup task so the Laltex work isn't writing into dead tables.

8. **`hex_value` column type** in `catalog_product_colors` is `CHAR` (not `VARCHAR`). Minor data-quality footgun if Laltex returns 7-char hex (`#000000`) and column is fixed-width. But Laltex gives PMS codes not hex — so real question is: do we maintain a PMS→hex lookup ourselves, or show colour swatches via image-only and accept `hex_value = null` for Laltex-origin products?

9. **Image hosting strategy** — pass through Laltex image URLs directly (they serve from `laltex-extranet.co.uk/images/`), or fetch-and-store in Supabase Storage `catalog-images` bucket? Pass-through is simpler; re-hosting gives CDN independence at the cost of 10x egress on initial sync and ongoing storage. For launch, **recommend pass-through** and revisit if Laltex's CDN becomes a problem.

10. **Category mapping** — our 11 categories vs Laltex's `Category` + `SubCategory` pair. Plausibly we keep our own category taxonomy and map Laltex products into it via rules/overrides, rather than auto-importing Laltex's categories. Confirm.

11. **"Eco-Friendly" filter** — not in Laltex data as a flag. Options: (a) text-mine `Material` + `KeyWords` fields for eco indicators, (b) add a manual override column per product, (c) don't offer this filter on Laltex products. Which?

12. **Compound product+item keying** — our `catalog_products.slug` is used as URL key and as `user_designs.product_key`. Should our slug = Laltex `ProductCode` (lower-cased), or our own hand-crafted slug with a separate `supplier_product_id` column? Latter survives Laltex renames and preserves nice URLs.

### 6.2 For Laltex (to raise with them)

13. **Rate limits** — totally undocumented. What's the per-minute / per-day ceiling? What does a throttled response look like (429? specific body?)?

14. **Full feed size** — how many products does `v1/products/list` return? How big is the payload (MB)? Is it paginated or monolithic? We need to budget for initial sync.

15. **Sandbox environment** — is there a test/staging endpoint? All examples in the PDF point at production `auto.laltex.com`.

16. **Division meanings** — what do `PRE`, `BHQ`, `SRC`, `TPC`, `FFP` stand for? Which of our product categories would each map to?

17. **Order placement** — the PDF has `order/status` (read) but no `POST /order`. How do we actually send an order to Laltex? Email? EDI? A different documented API?

18. **POA (Price on Application) handling** — prices > £900 are marked as POA. What's the expected workflow? Do we call/email Laltex, or is there a self-service quote API?

19. **Webhook availability** — any push notification for stock changes, price updates, or order status transitions? Or is polling the only option?

20. **Stock refresh cadence** — how often does `FreeStock` on Laltex's side update? Real-time? Nightly? Affects our sync frequency vs usefulness.

21. **Currency conversion** — when we call with `CURR=EUR`, does Laltex do the FX internally (and how frequently is it re-rated), or should we always pull GBP and convert on our side?

22. **Key rotation / revocation** — is there a self-service key-rotation process, or does every rotation go through "provided by admin" (human)?

23. **PMS → hex colour** — do they have an official PMS lookup they can share, or is that on us?

24. **`ProductIndicator` / `ItemIndicator` full enum** — the PDF lists `"Clearance"` and `"To Be Discontinued"`. Are there others (`"Made To Order"`, `"New Product"`)? Full set please.

25. **Image licence / usage** — are the image URLs licensed for use on our customer-facing site, and is hotlinking permitted (vs requiring re-host)?

26. **Artwork proofing flow** — `ArtflowApprovalLink` appears on order status. Is that a Laltex-hosted flow, and do customers interact with it directly, or does it route through us?

---

## Confirmation
**Nothing was modified** during this investigation. No INSERT / UPDATE / DELETE / DDL was run. All Management API calls were reads. No code was edited. No Supabase config was touched. This document is the only artifact.
