-- Rollback for 20260629_orders_soft_delete.sql.
--
-- Restores the original "Users view own orders" RLS qual, drops the
-- partial index (cascades from the column drop, but explicit DROP keeps
-- the rollback symmetric with the forward migration), then drops the
-- column. Any rows with `deleted_at` set will be silently restored
-- (the soft-delete signal is the column itself, which goes away).

BEGIN;

DROP POLICY IF EXISTS "Users view own orders" ON orders;
CREATE POLICY "Users view own orders" ON orders FOR SELECT USING (
  auth.uid() = customer_id OR is_admin(auth.uid())
);

DROP INDEX IF EXISTS orders_active_idx;

ALTER TABLE orders DROP COLUMN IF EXISTS deleted_at;

COMMIT;
