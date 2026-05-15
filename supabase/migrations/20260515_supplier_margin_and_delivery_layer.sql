-- Supplier margin layer (Stage 1, session 9 / task 10).
--
-- Adds the schema scaffolding for applying a margin schedule to Laltex
-- products. Sync writes `sell_price` into each pricing-tier JSONB entry;
-- read paths consume `sell_price` instead of raw `price`. Delivery is a
-- READ-TIME concern (decision B1-A) and is NOT baked into sell_price at
-- sync time — see scripts/lib/laltex-delivery.js + CLAUDE.md §46.
--
-- The new top-level columns are:
--   * margin_pct_override              — admin override, NULL means use schedule
--   * margin_default_schedule_version  — drift detection for default-schedule rows
--   * margin_last_applied_at           — when sell_price was last computed
--
-- JSONB shape additions inside product_pricing[] and
-- print_details[i].print_price[] are NOT enforced by Postgres (JSONB is
-- loose). They are documented in CLAUDE.md §46 and produced by sync +
-- the recompute script.

BEGIN;

ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS margin_pct_override              numeric(5,4),
  ADD COLUMN IF NOT EXISTS margin_default_schedule_version  smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS margin_last_applied_at           timestamptz;

-- Range guard: override is a decimal in [0, 1). 0.22 = 22%. Anything
-- outside this band is almost certainly a unit mistake (e.g. typing 22
-- instead of 0.22). The default schedule itself runs 0.18 .. 0.22.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supplier_products_margin_pct_override_range'
  ) THEN
    ALTER TABLE public.supplier_products
      ADD CONSTRAINT supplier_products_margin_pct_override_range
      CHECK (margin_pct_override IS NULL
             OR (margin_pct_override >= 0 AND margin_pct_override < 1));
  END IF;
END
$$;

COMMENT ON COLUMN public.supplier_products.margin_pct_override IS
  'Per-product margin override as a decimal (0.22 = 22%). NULL means use the '
  'schedule in scripts/lib/laltex-margin.js keyed on tier min_qty. '
  'Range-checked [0, 1). Changing this column requires a re-sync (or '
  'recompute-laltex-margins.js) to refresh sell_price values inside '
  'product_pricing and print_details JSONB.';

COMMENT ON COLUMN public.supplier_products.margin_default_schedule_version IS
  'Increments whenever the default schedule in laltex-margin.js changes. '
  'The recompute-margins script stamps this onto every row it writes. Lets '
  'the future admin dashboard surface "applied vs latest" drift in one query.';

COMMENT ON COLUMN public.supplier_products.margin_last_applied_at IS
  'When sell_price values were last computed for this row. Distinct from '
  'last_synced_at (which is feed freshness). NULL means no margin has been '
  'applied — read paths fall back to raw price during the deploy window, '
  'then sell_price takes over once recompute-laltex-margins.js runs.';

COMMIT;
