-- Down migration for 20260901_ai_ip_rate_limit.sql.
-- No BEGIN/COMMIT. Idempotent. Ends with a verifying SELECT.

DROP FUNCTION IF EXISTS public.check_and_increment_ip_rate_limit(text, integer, integer);
DROP TABLE IF EXISTS public.ai_ip_rate_limits;

-- Verifying SELECT — expect: table_exists = 0, rpc_exists = 0.
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'ai_ip_rate_limits')          AS table_exists,
  (SELECT count(*) FROM pg_proc WHERE proname = 'check_and_increment_ip_rate_limit') AS rpc_exists;
