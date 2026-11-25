-- Rollback for 20261126_unsubscribes_token_length.sql.
-- WARNING: fails if any token shorter than 27 has been recorded — never delete
-- unsubscribe rows to make it pass (§67). Revert the code first, then decide.
BEGIN;
ALTER TABLE public.unsubscribes DROP CONSTRAINT IF EXISTS unsubscribes_token_format;
ALTER TABLE public.unsubscribes ADD CONSTRAINT unsubscribes_token_format
  CHECK (token ~ '^[A-Za-z0-9_-]{27}$');
COMMIT;
