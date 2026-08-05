-- 20260805_internal_artwork_alert.sql
-- Server-side internal artwork-uploaded alert (artwork@ inbox).
--
-- An AFTER INSERT trigger on order_artwork fires a pg_net HTTP POST to the
-- send-internal-artwork-alert Edge Function, once per uploaded file. This
-- removes the browser dependency of the old fire-and-forget customer email:
-- a closed tab can no longer lose the alert the team relies on.
--
-- DEPLOY ORDER MATTERS (see the PR body for the full runbook):
--   1. Apply this migration (enables pg_net, adds the stamp, creates the trigger).
--   2. Seed the two Vault secrets (function URL + call secret) — NOT in git.
--   3. Set the ARTWORK_ALERT_SECRET Edge Function secret to the SAME value.
--   4. Deploy send-internal-artwork-alert with --no-verify-jwt.
-- Until steps 2-4 are done the trigger simply logs a warning and skips (uploads
-- are never broken). No BEGIN/COMMIT. Idempotent. Verifying SELECTs at the end.

-- 1. pg_net — the extension the trigger uses to make an async outbound HTTP call.
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Per-UPLOAD idempotency stamp (keyed on the artwork row, NOT the order, so
--    every upload alerts). Stamped only on a successful send; a NULL is a
--    genuine miss and is found by the miss-detector query.
ALTER TABLE public.order_artwork
  ADD COLUMN IF NOT EXISTS internal_alert_sent_at timestamptz;

COMMENT ON COLUMN public.order_artwork.internal_alert_sent_at IS
  'When the internal artwork@ alert was sent for this upload. NULL = not yet sent (a genuine miss if the parent order is live). Claimed atomically by sendInternalArtworkAlert; reset to NULL on send failure.';

-- Miss-detector support: index the unsent rows.
CREATE INDEX IF NOT EXISTS order_artwork_unalerted_idx
  ON public.order_artwork (created_at)
  WHERE internal_alert_sent_at IS NULL;

-- 3. Trigger function. SECURITY DEFINER so it can read the Vault secrets (the
--    function is owned by the applying role, postgres, which can read vault).
--    search_path='' + fully-qualified refs is the safe SECURITY DEFINER pattern.
--    EVERY failure path is non-fatal: an alert problem must never break an upload.
CREATE OR REPLACE FUNCTION public.notify_internal_artwork_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  -- Function URL + call secret from Vault (seeded post-deploy; not in git).
  BEGIN
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'artwork_alert_function_url';
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'artwork_alert_secret';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[artwork-alert-trigger] vault read failed: %', SQLERRM;
    RETURN NEW;
  END;

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[artwork-alert-trigger] vault secrets not seeded (artwork_alert_function_url / artwork_alert_secret) - skipping alert for artwork %', NEW.id;
    RETURN NEW;
  END IF;

  -- Fire-and-forget async POST. pg_net queues it; the INSERT does not wait.
  -- Wrapped so ANY error is swallowed (upload must never fail on an alert).
  BEGIN
    PERFORM net.http_post(
      url     := v_url,
      body    := jsonb_build_object('artwork_id', NEW.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-artwork-alert-secret', v_secret
      ),
      timeout_milliseconds := 8000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[artwork-alert-trigger] net.http_post failed for artwork %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_internal_artwork_alert() IS
  'AFTER INSERT on order_artwork: async pg_net POST to send-internal-artwork-alert. Non-fatal on any failure; skips quietly until Vault secrets are seeded.';

-- 4. The trigger.
DROP TRIGGER IF EXISTS trg_internal_artwork_alert ON public.order_artwork;
CREATE TRIGGER trg_internal_artwork_alert
  AFTER INSERT ON public.order_artwork
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_internal_artwork_alert();

-- 5. Verify (evidence in the PR body).
SELECT installed_version FROM pg_available_extensions WHERE name = 'pg_net';
  -- expect: a version (e.g. 0.14.0), NOT null

SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'order_artwork' AND column_name = 'internal_alert_sent_at';
  -- expect: internal_alert_sent_at | timestamp with time zone

SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgrelid = 'public.order_artwork'::regclass AND tgname = 'trg_internal_artwork_alert';
  -- expect: trg_internal_artwork_alert | O

SELECT proname, prosecdef FROM pg_proc WHERE proname = 'notify_internal_artwork_alert';
  -- expect: notify_internal_artwork_alert | t  (security definer)
