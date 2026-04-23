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

### ⚠ Cannot complete — PDF not accessible

**Searched:**
- `/mnt/project/` — path doesn't exist on this Windows host
- `C:/Users/Admin/Downloads/`, `C:/Users/Admin/Documents/`, `C:/Users/Admin/OneDrive/Documents/` — no matches
- `find c: -iname "*laltex*"` (full C: scan) — no matches
- Whole `c:/Users/Admin/pgifts/` repo — no matches
- All `.pdf` files inside the repo: none named laltex (only old bug-fix PDFs)

The PDF `Laltex_API_Documentation_V1_7.pdf` isn't on this machine. Section 2 skeleton below, to be filled in once the PDF is accessible.

**Template for when PDF is available:**

```
### 2.1 Authentication
- Method: ___ (API key header / OAuth / Basic auth)
- Key storage: Vercel env + Supabase Edge Function secret (same pattern as Stripe)
- Rotation: ___

### 2.2 Endpoints
| Endpoint | Method | Purpose | Pagination? |
|---|---|---|---|
| ... | ... | ... | ... |

### 2.3 Rate limits
- Requests/min: ___
- Daily cap: ___
- Throttling response: ___

### 2.4 Product feed shape
| Field | Type | Notes | Maps to |
|---|---|---|---|
| ... | ... | ... | our column |

### 2.5 Laltex → PGifts field mapping
| Laltex field | PGifts column | Transform | Confidence |

### 2.6 New data Laltex provides that we don't capture today
- lead_time_days → NEW column on catalog_products
- country_of_origin → NEW column
- eco_certifications → NEW column (probably jsonb array or separate table)
- stock_level → NEW column / separate stock_levels table with updated_at
- materials → NEW jsonb or separate table
...

### 2.7 Ambiguities / questions for Laltex
- ...
```

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

Decisions / clarifications the next session will need:

1. **Laltex PDF** — where is `Laltex_API_Documentation_V1_7.pdf`? I couldn't find it on this machine. Please drop it anywhere under `c:/Users/Admin/pgifts/` or tell me the path.

2. **Laltex API key** — CLAUDE.md says "key provisioned, no code yet". Not in `.env`, not in Vercel env. Is it stashed somewhere (e.g., password manager) to be introduced when sync work starts, or do we need to rotate / request it?

3. **Supabase plan tier** — can't verify programmatically. Please check Dashboard → Org → Billing. If Free, upgrade before Laltex sync work starts.

4. **Second supplier** — who is it? Naming it now helps shape the `suppliers` table and avoid Laltex-specific assumptions leaking in.

5. **AI assistant strategy** — purely semantic (pgvector + embeddings), or hybrid (pgvector + tsvector / BM25)? Affects whether the sync adds a `search_text tsvector` column alongside `embedding vector(N)`.

6. **Sync semantics** — nightly full-replace, or incremental/upsert by `supplier_product_id`? Affects RLS, transaction boundaries, and whether we can rely on CASCADE semantics.

7. **Laltex pricing** — customer-facing or wholesale (needs markup)? Affects whether we replace `catalog_pricing_tiers` or add a `wholesale_price` alongside `price_per_unit` and compute retail in a view.

8. **Legacy tables** — `products` (0 rows), `product_configurations` (25 rows, unknown if consumed), `product_template_print_areas` (0 rows) look legacy. Confirm drop-candidacy in a separate pre-Laltex cleanup task so the Laltex work isn't writing into dead tables.

9. **`hex_value` column type** in `catalog_product_colors` is `CHAR` (not `VARCHAR`). Minor data-quality footgun if Laltex returns 7-char hex (`#000000`) and column is fixed-width. Verify and possibly migrate to `varchar(7)` or `text` pre-Laltex.

10. **Image hosting strategy** — pass through Laltex image URLs, or fetch-and-store in Supabase Storage `catalog-images` bucket? The latter gives us CDN independence but 10x the egress on initial sync.

---

## Confirmation
**Nothing was modified** during this investigation. No INSERT / UPDATE / DELETE / DDL was run. All Management API calls were reads. No code was edited. No Supabase config was touched. This document is the only artifact.
