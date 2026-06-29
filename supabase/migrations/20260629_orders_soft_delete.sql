-- Soft-delete column for orders + RLS amendment.
--
-- BACKGROUND (audit-admin-orders-iteration.md §6):
--   * order_items, order_status_history, order_artwork all CASCADE on
--     orders DELETE. A hard delete would wipe line-item history, audit
--     trail, and (silently) orphan files in the `order-artwork` Supabase
--     Storage bucket — the bucket is not in the FK graph.
--   * confirm_payment_atomic anchors idempotency on
--     orders.stripe_session_id (unique constraint
--     orders_stripe_session_id_uniq, CLAUDE.md §44.2). Hard-deleting an
--     order frees that anchor; a Stripe webhook retry would create a
--     duplicate ORD-… and re-email the customer.
--   * HMRC requires 6-year transaction record retention.
--
-- WHAT THIS DOES:
--   1. Adds nullable `deleted_at timestamptz` column. NULL = active.
--   2. Adds a partial index covering the active rows (the common path:
--      list views, customer dashboard). Index only contains rows where
--      deleted_at IS NULL so it stays small as soft-deletes accumulate.
--   3. Amends the "Users view own orders" RLS policy to hide
--      soft-deleted rows from the customer-facing path. The admin
--      "Admins manage orders" ALL policy is UNCHANGED so admins
--      continue to see (and can restore) deleted rows.
--
-- WHAT THIS DOES NOT DO:
--   * Touch the `orders` data — no UPDATE statements on existing rows.
--   * Change the "Admins manage orders" policy. Admin UI defaults to
--     hiding deleted rows via a JS-side `.is('deleted_at', null)` so
--     the affordance (and a future "Show deleted" toggle) is the only
--     path to see them.
--   * Filter the Stripe webhook / confirm_payment_atomic path. Those
--     must continue to find soft-deleted orders by id for refunds,
--     chargebacks, and any post-payment reconciliation. Defensive
--     filters added to the two email-sending Edge Functions only
--     (sendOrderConfirmation + send-artwork-received-email) — see the
--     PR description for the per-function reasoning.
--   * Free up stripe_session_id on soft-delete. The unique anchor stays
--     so a Stripe retry for the same session id cannot accidentally
--     create a duplicate order. Recovery of a soft-deleted order is via
--     `UPDATE orders SET deleted_at = NULL WHERE id = '…';`
--
-- APPLY PATH (CLAUDE.md §52):
--   Dave: paste this entire migration into Supabase Dashboard ->
--   SQL Editor -> click Run -> confirm success message before merging
--   the PR. Code alone does nothing.
--
-- ROLLBACK: see 20260629_orders_soft_delete.down.sql in the same
-- directory. Reversible — drops the column (CASCADE on the index) and
-- restores the original policy USING clause.

BEGIN;

-- 1. Column. Nullable, no default — NULL = active is the desired semantics.
ALTER TABLE orders ADD COLUMN deleted_at timestamptz;

COMMENT ON COLUMN orders.deleted_at IS
  'Soft-delete timestamp. NULL = active. Non-NULL = hidden from customer-facing reads via amended "Users view own orders" RLS policy; hidden from default admin list via the JS-side filter on AdminOrders fetchOrders. Stripe webhook and confirm_payment_atomic continue to find soft-deleted rows by id (refunds / chargebacks / reconciliation). Restore with `UPDATE orders SET deleted_at = NULL WHERE id = ''…'';`. Added 2026-06-29 per audit-admin-orders-iteration.md §8.3.';

-- 2. Partial index for the common active-only path. Index stays small
-- as soft-deletes accumulate. The DESC matches AdminOrders fetchOrders
-- ORDER BY created_at DESC.
CREATE INDEX orders_active_idx ON orders (created_at DESC) WHERE deleted_at IS NULL;

-- 3. RLS amendment.
-- Original "Users view own orders" qual (verified live 2026-06-29):
--   auth.uid() = customer_id OR is_admin(auth.uid())
-- New qual adds AND deleted_at IS NULL to the customer-side branch
-- so customers stop seeing soft-deleted orders on their dashboard.
-- The admin OR-branch stays unfiltered — admins keep visibility for
-- the restore workflow.
DROP POLICY "Users view own orders" ON orders;
CREATE POLICY "Users view own orders" ON orders FOR SELECT USING (
  (auth.uid() = customer_id AND deleted_at IS NULL)
  OR is_admin(auth.uid())
);

COMMIT;
