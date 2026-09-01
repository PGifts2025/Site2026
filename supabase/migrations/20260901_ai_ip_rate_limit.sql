-- Server-side per-IP rate limit for the AI chat endpoint.
--
-- Why: the anonymous searchProducts quota (ai_quotas) is keyed on a
-- client-supplied identifier, so it cannot bound a bot that rotates the
-- identifier or sends none — and chat turns cost Anthropic tokens whether or
-- not searchProducts is called. This table + RPC add a hard limit per source
-- IP per time window, enforced BEFORE any Anthropic call, independent of any
-- client-supplied value. It applies to every request to /api/ai/chat
-- (anonymous and signed-in alike) as the cost backstop.
--
-- The IP is stored HASHED (SHA-256 with VISITOR_HASH_SALT), never raw — the
-- same salt already used for the quota IP fallback, so IPv4's small space is
-- not rainbow-table-reversible from DB read access.
--
-- Atomicity: the RPC locks the row FOR UPDATE, so concurrent requests from one
-- IP cannot race past the cap. Enforced in Postgres, not app code, because
-- serverless functions are stateless and this is the one place a shared
-- counter can live safely.
--
-- No BEGIN/COMMIT (project convention). Idempotent. Ends with a verifying SELECT.

CREATE TABLE IF NOT EXISTS public.ai_ip_rate_limits (
  ip_hash           TEXT        PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_count     INTEGER     NOT NULL DEFAULT 0,
  rejected_count    INTEGER     NOT NULL DEFAULT 0,
  last_request_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_rejected_at  TIMESTAMPTZ
);

COMMENT ON TABLE public.ai_ip_rate_limits IS
  'Hard per-IP rate limit for /api/ai/chat. One row per SHA-256(salt+ip). request_count is the count in the current fixed window (window_started_at); it resets when a request arrives after the window elapses. rejected_count accumulates over-limit hits so Dave can see the limit firing. Written only by check_and_increment_ip_rate_limit (service_role). Added 2026-09-01.';

-- Atomic check-and-increment. Returns whether the request is allowed, the
-- resulting count, and when the current window resets. Locks the row so two
-- concurrent requests from the same IP cannot both slip past the cap.
CREATE OR REPLACE FUNCTION public.check_and_increment_ip_rate_limit(
  p_ip_hash        text,
  p_window_seconds integer,
  p_max_requests   integer
) RETURNS TABLE (allowed boolean, current_count integer, window_resets_at timestamptz)
  LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := now();
  v_win interval    := make_interval(secs => p_window_seconds);
  v_row public.ai_ip_rate_limits%ROWTYPE;
BEGIN
  INSERT INTO public.ai_ip_rate_limits (ip_hash, window_started_at, request_count, last_request_at)
  VALUES (p_ip_hash, v_now, 0, v_now)
  ON CONFLICT (ip_hash) DO NOTHING;

  SELECT * INTO v_row
    FROM public.ai_ip_rate_limits
   WHERE ip_hash = p_ip_hash
   FOR UPDATE;

  -- Window elapsed → start a fresh window with this request counted as 1.
  IF v_now - v_row.window_started_at >= v_win THEN
    UPDATE public.ai_ip_rate_limits
       SET window_started_at = v_now,
           request_count     = 1,
           last_request_at   = v_now
     WHERE ip_hash = p_ip_hash;
    allowed := true; current_count := 1; window_resets_at := v_now + v_win;
    RETURN NEXT; RETURN;
  END IF;

  -- Within window and at/over the cap → reject, and record the rejection.
  IF v_row.request_count >= p_max_requests THEN
    UPDATE public.ai_ip_rate_limits
       SET rejected_count   = rejected_count + 1,
           last_rejected_at = v_now,
           last_request_at  = v_now
     WHERE ip_hash = p_ip_hash;
    allowed := false; current_count := v_row.request_count;
    window_resets_at := v_row.window_started_at + v_win;
    RETURN NEXT; RETURN;
  END IF;

  -- Within window and under the cap → count this request.
  UPDATE public.ai_ip_rate_limits
     SET request_count   = request_count + 1,
         last_request_at = v_now
   WHERE ip_hash = p_ip_hash;
  allowed := true; current_count := v_row.request_count + 1;
  window_resets_at := v_row.window_started_at + v_win;
  RETURN NEXT;
END;
$$;

-- Only the AI chat endpoint (service_role) should call this.
REVOKE ALL ON FUNCTION public.check_and_increment_ip_rate_limit(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_and_increment_ip_rate_limit(text, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_ip_rate_limit(text, integer, integer) TO service_role;

-- RLS: service_role only, mirroring ai_quotas. No user-facing access.
ALTER TABLE public.ai_ip_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_ip_rate_limits_service_role_all ON public.ai_ip_rate_limits;
CREATE POLICY ai_ip_rate_limits_service_role_all
  ON public.ai_ip_rate_limits FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Verifying SELECT — expect: table_exists = 1, rpc_exists = 1, rls_enabled = t.
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'ai_ip_rate_limits')          AS table_exists,
  (SELECT count(*) FROM pg_proc WHERE proname = 'check_and_increment_ip_rate_limit') AS rpc_exists,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_ip_rate_limits'::regclass) AS rls_enabled;
