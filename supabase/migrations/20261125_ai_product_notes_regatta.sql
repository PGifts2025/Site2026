-- 20261125_ai_product_notes_regatta.sql — CLAUDE.md §68
-- Owner confirmed (25 Nov 2026): the jacket/zip colour rule given for JF0012
-- also applies to the Regatta Ablaze womens (JF0112) and Regatta Uproar mens
-- and womens (JF0013, JF0113). Examples are taken from each product's own
-- colour list. Idempotent. Rollback: 20261125_ai_product_notes_regatta.down.sql

BEGIN;

INSERT INTO public.ai_product_notes (supplier_product_code, note) VALUES
  ('JF0112', 'Two-part colour names on this jacket are the jacket colour first and the zip colour second. For example, "Navy/French Blue" is a navy jacket with a French Blue zip, and "Black/Classic Red" is a black jacket with a Classic Red zip. Where only one colour is given (for example "Rock Grey"), no separate zip colour is listed.'),
  ('JF0013', 'Two-part colour names on this jacket are the jacket colour first and the zip colour second. For example, "Classic Red/Seal Grey" is a Classic Red jacket with a Seal Grey zip, and "Navy/Navy" is a navy jacket with a navy zip. Where only one colour is given (for example "Oxford"), no separate zip colour is listed.'),
  ('JF0113', 'Two-part colour names on this jacket are the jacket colour first and the zip colour second. For example, "Navy/Navy" is a navy jacket with a navy zip. Where only one colour is given (for example "Seal Grey"), no separate zip colour is listed.')
ON CONFLICT (supplier_product_code) DO UPDATE SET note = EXCLUDED.note, updated_at = now();

COMMIT;
