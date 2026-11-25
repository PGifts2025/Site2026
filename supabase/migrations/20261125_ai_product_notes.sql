-- 20261125_ai_product_notes.sql — CLAUDE.md §68
--
-- Owner-confirmed facts about individual products that the catalogue data
-- doesn't carry, given to Ava (api/ai/chat.js) as `notes` on any search /
-- alternatives result whose supplier_product_code matches. One note per
-- product; keep each short, true and product-specific.
--
-- First note (owner, 25 Nov 2026): on the Regatta Ablaze softshell (JF0012)
-- a two-part colour name is "jacket colour / zip colour".
--
-- Read server-side with the service-role key only. Admins may manage rows
-- (future admin screen); no anonymous access.
-- Rollback: 20261125_ai_product_notes.down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_product_notes (
  supplier_product_code  text PRIMARY KEY,
  note                   text NOT NULL CONSTRAINT ai_product_notes_note_length CHECK (length(note) BETWEEN 1 AND 1000),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_product_notes IS
  'Owner-confirmed product facts passed to the AI assistant as `notes` (CLAUDE.md §68). True, product-specific, no pricing.';

ALTER TABLE public.ai_product_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_product_notes FROM anon;
REVOKE ALL ON public.ai_product_notes FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_product_notes TO authenticated;  -- narrowed to admins below

CREATE POLICY "Admins manage ai_product_notes" ON public.ai_product_notes
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

INSERT INTO public.ai_product_notes (supplier_product_code, note) VALUES
  ('JF0012', 'Two-part colour names on this jacket are the jacket colour first and the zip colour second. For example, "Navy/French Blue" is a navy jacket with a French Blue zip, and "Black/Classic Red" is a black jacket with a Classic Red zip. Where only one colour is given (for example "Navy"), no separate zip colour is listed.')
ON CONFLICT (supplier_product_code) DO UPDATE SET note = EXCLUDED.note, updated_at = now();

COMMIT;

-- Verify:
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_product_notes'::regclass;  -- true
-- SELECT supplier_product_code, left(note, 60) FROM public.ai_product_notes;            -- JF0012
