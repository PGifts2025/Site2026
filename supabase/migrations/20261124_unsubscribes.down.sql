-- Rollback for 20261124_unsubscribes.sql.
-- WARNING: dropping the table loses every recorded unsubscribe. Before
-- running this, make sure the outreach server has pulled everything
-- (GET /api/unsubscribes) — those people must never be emailed again.
BEGIN;
DROP TABLE IF EXISTS public.unsubscribes;
COMMIT;
