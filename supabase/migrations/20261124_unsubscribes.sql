-- 20261124_unsubscribes.sql — CLAUDE.md §67
--
-- Unsubscribe tokens from the cold-outreach emails ("Unsubscribe:
-- https://promo-gifts-co.uk/u/<token>"). Interface contract from the
-- outreach project, 24 Nov 2026.
--
-- Stores ONLY the opaque token and when it was used. No email address, IP,
-- user agent or anything else: this site never holds personal data about
-- the recipient (the outreach server maps token -> address on its side).
-- Never delete rows: the outreach server pulls them with ?since= and keeps
-- its own high-water mark.
--
-- Written only by api/unsubscribes.js with the service-role key (bypasses
-- RLS). Clients get nothing except admins, who may read it.
-- Rollback: 20261124_unsubscribes.down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.unsubscribes (
  token            text PRIMARY KEY
                   CONSTRAINT unsubscribes_token_format CHECK (token ~ '^[A-Za-z0-9_-]{27}$'),
  unsubscribed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS unsubscribes_unsubscribed_at_idx
  ON public.unsubscribes (unsubscribed_at, token);

COMMENT ON TABLE public.unsubscribes IS
  'Outreach unsubscribe tokens (CLAUDE.md §67). Token + time only; never store personal data here; never delete rows.';

ALTER TABLE public.unsubscribes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.unsubscribes FROM anon;
REVOKE ALL ON public.unsubscribes FROM authenticated;
GRANT SELECT ON public.unsubscribes TO authenticated;  -- narrowed to admins by the policy below

CREATE POLICY "Admins read unsubscribes" ON public.unsubscribes
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

COMMIT;

-- Verify:
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.unsubscribes'::regclass;      -- true
-- SELECT polname FROM pg_policy WHERE polrelid = 'public.unsubscribes'::regclass;       -- 1 row
-- SELECT privilege_type FROM information_schema.role_table_grants
--  WHERE table_name = 'unsubscribes' AND grantee = 'anon';                               -- 0 rows
