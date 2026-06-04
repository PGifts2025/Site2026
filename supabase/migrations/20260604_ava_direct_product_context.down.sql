-- Down migration for 20260604_ava_direct_product_context.sql
-- Drops the AVA upsell-context table, its index, policy, and trigger.
BEGIN;
DROP TRIGGER IF EXISTS ava_direct_product_context_set_updated_at ON ava_direct_product_context;
DROP POLICY IF EXISTS ava_direct_product_context_select ON ava_direct_product_context;
DROP TABLE IF EXISTS ava_direct_product_context;  -- index drops with the table
COMMIT;
