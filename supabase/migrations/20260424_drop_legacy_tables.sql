-- Drop legacy objects superseded by the current catalog_* schema.
--
-- Pre-drop inventory (verified 2026-04-24 via information_schema + COUNT(*)):
--
--   products                     BASE TABLE, 0 rows    -- DROP TABLE
--   product_template_print_areas BASE TABLE, 0 rows    -- DROP TABLE
--   product_configurations       VIEW,       25 rows   -- DROP VIEW
--
-- Note on the VIEW: product_configurations is defined in site/supabase/schema.sql
-- as a join over product_templates + print_areas. The "25 rows" reflects the
-- view's projection (== row count of product_templates), not stored data —
-- nothing is lost by dropping it.
--
-- The session-1 spec called for DROP TABLE IF EXISTS on all three. We diverge
-- on product_configurations only: DROP TABLE ... IF EXISTS suppresses the
-- "does not exist" error but NOT the "wrong object type" error, so the
-- literal DROP TABLE would have failed on first run. DROP VIEW is the
-- correct syntax for a view and carries the same intent.
--
-- No production code references any of these three objects (grep of site/src
-- returned zero matches); only schema.sql seed file + investigation docs.
-- CASCADE is included for parity with the spec although none of the three
-- objects currently has dependants.

DROP VIEW  IF EXISTS product_configurations       CASCADE;
DROP TABLE IF EXISTS product_template_print_areas CASCADE;
DROP TABLE IF EXISTS products                     CASCADE;
