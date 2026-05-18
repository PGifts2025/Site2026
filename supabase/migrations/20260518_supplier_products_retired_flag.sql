-- Retired-product handling (session 9 follow-up / CC task 15).
--
-- Adds the schema scaffolding for marking supplier_products rows as
-- retired when they disappear from the supplier's bulk product feed
-- for a sustained period. Three consecutive nightly syncs in which a
-- product fails to appear is the threshold (see CLAUDE.md §51); a
-- reappearance resets the counter and clears the flag.
--
-- Why retire rather than delete:
--   * orders.* and quote_items.* reference supplier_products.id via
--     joins inside confirm_payment_atomic and the email/order render
--     paths. Deletion would either orphan those rows or require
--     destructive ON DELETE CASCADE on every reference, neither of
--     which we want. Retirement is a read-side filter; the row stays
--     intact for historical lookup.
--   * Laltex sometimes re-lists a previously-missing product (seasonal
--     SKUs, supplier-side admin glitches). Reset-on-reappear is a
--     one-line operation on a retained row; reinstating a deleted row
--     would mean re-syncing every JSONB blob from scratch.
--
-- Why a counter rather than a single boolean toggle on miss:
--   * Laltex's bulk feed occasionally fails to enumerate a product
--     for a single sync due to transient network or supplier-side
--     issues. A 3-strike rule absorbs one-off glitches at nightly
--     cadence (so genuinely retired products clear within a working
--     week, but a one-off blip never false-positives).
--
-- New columns:
--   * is_retired                — single boolean read by every active
--                                 listing / product page / Designer
--                                 / search RPC.
--   * missing_from_feed_count   — counter incremented when a sync run
--                                 completes without seeing the row.
--                                 Reset to 0 on reappearance.
--
-- The sync logic that maintains both columns lives in
-- scripts/lib/laltex-sync.js (post-upsert reconciliation phase).
--
-- See also CLAUDE.md §51 for the invariants this migration enforces.

BEGIN;

ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS is_retired              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS missing_from_feed_count integer NOT NULL DEFAULT 0;

-- Range guard: missing_from_feed_count is a non-negative running total.
-- A negative value is nonsensical and almost certainly indicates a
-- decrement bug. Belt-and-braces beside the application-side reset
-- logic.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supplier_products_missing_from_feed_count_nonneg'
  ) THEN
    ALTER TABLE public.supplier_products
      ADD CONSTRAINT supplier_products_missing_from_feed_count_nonneg
      CHECK (missing_from_feed_count >= 0);
  END IF;
END
$$;

-- Listing queries always filter is_retired=false alongside
-- supplier_id, so a composite index on (supplier_id, is_retired) is
-- the natural shape. The cardinality of is_retired is binary, so the
-- index pays for itself only because supplier_id is the leading column.
CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier_retired
  ON public.supplier_products (supplier_id, is_retired);

COMMENT ON COLUMN public.supplier_products.is_retired IS
  'True when the product has been missing from the supplier feed for '
  '3+ consecutive sync runs (CLAUDE.md §51). Active listings, product '
  'pages, the Designer, and the search RPC must filter is_retired=false. '
  'Order history and saved-design lookups intentionally do NOT filter — '
  'past customer references must still resolve. The row is never '
  'deleted; this is a soft-retire flag.';

COMMENT ON COLUMN public.supplier_products.missing_from_feed_count IS
  'Running count of consecutive sync runs in which this row was not '
  'seen in the supplier bulk feed. Incremented post-upsert by '
  'scripts/lib/laltex-sync.js when supplier_product_code is in the DB '
  'but absent from the feed response; reset to 0 (and is_retired flipped '
  'to false) when the row reappears. Threshold of 3 strikes documented '
  'in CLAUDE.md §51.';

COMMIT;
