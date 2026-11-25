-- 20261126_unsubscribes_token_length.sql — CLAUDE.md §67
-- Outreach change request (26 Nov 2026): tokens may be 8–27 characters
-- (was exactly 27). Same character set. Must match TOKEN_RE in
-- api/unsubscribes.js; apply BEFORE the code change deploys, or a short
-- token's button press would fail the CHECK. Existing rows (27 chars) pass.
-- Rollback: 20261126_unsubscribes_token_length.down.sql
BEGIN;
ALTER TABLE public.unsubscribes DROP CONSTRAINT IF EXISTS unsubscribes_token_format;
ALTER TABLE public.unsubscribes ADD CONSTRAINT unsubscribes_token_format
  CHECK (token ~ '^[A-Za-z0-9_-]{8,27}$');
COMMIT;
