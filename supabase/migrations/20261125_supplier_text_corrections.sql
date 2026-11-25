-- 20261125_supplier_text_corrections.sql — CLAUDE.md §69
--
-- Spelling corrections for supplier product text. The nightly Laltex sync
-- (scripts/lib/laltex-sync.js) and the manual sync script apply these to
-- each product BEFORE storing it, because the feed overwrites name, title
-- and descriptions every night. Literal find -> replace, per product and
-- field; skipped when the field already contains the replacement, so a
-- supplier-side fix never gets doubled.
--
-- Seeded from a full spell-check of all 1,268 live names/titles and the
-- descriptions of every product shown on category pages (25 Nov 2026).
-- Owner asked for the JF0013 "Shoftshell" fix and a check for others.
-- Not changed (real model names): Legant, Mech (mechanical), Thelon/THENLON
-- (name and title disagree — owner to confirm), Marico, Datafrost, etc.
--
-- Also corrects the current rows once, so the site is right before the
-- next nightly sync. Rollback: 20261125_supplier_text_corrections.down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.supplier_text_corrections (
  supplier_product_code  text NOT NULL,
  field                  text NOT NULL CONSTRAINT supplier_text_corrections_field
                         CHECK (field IN ('name', 'title', 'description', 'web_description')),
  find                   text NOT NULL CHECK (length(find) > 0),
  replace_with           text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier_product_code, field, find)
);

COMMENT ON TABLE public.supplier_text_corrections IS
  'Owner-approved spelling fixes applied to supplier text on every sync (CLAUDE.md §69).';

ALTER TABLE public.supplier_text_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_text_corrections FROM anon;
REVOKE ALL ON public.supplier_text_corrections FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_text_corrections TO authenticated;  -- narrowed to admins below

CREATE POLICY "Admins manage supplier_text_corrections" ON public.supplier_text_corrections
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

INSERT INTO public.supplier_text_corrections (supplier_product_code, field, find, replace_with) VALUES
  ('JF0013',     'name',            'Shoftshell',          'Softshell'),
  ('QB0664',     'title',           'Drawsting',           'Drawstring'),
  ('MG1337',     'name',            '(formely ',           '(formerly '),
  ('QB5810',     'name',            'Natrual',             'Natural'),
  ('MS2101',     'title',           'Powebank',            'Powerbank'),
  ('MG9133',     'title',           'RECYLCED',            'RECYCLED'),
  ('TPC911111',  'name',            'Antibicrobial',       'Antimicrobial'),
  ('TPC911111',  'title',           'Antibicrobial',       'Antimicrobial'),
  ('QB0590Cols', 'name',            'Cloured',             'Coloured'),
  ('QB0590Cols', 'title',           'Cloured',             'Coloured'),
  ('XU0002',     'name',            'Trianglular',         'Triangular'),
  ('XU0002',     'title',           'Trianglular',         'Triangular'),
  ('HF002K',     'name',            'AWDid',               'AWDis'),
  ('HF002K',     'title',           'AWDid',               'AWDis'),
  ('JF0022',     'name',            'Russel Full',         'Russell Full'),
  ('JF0014',     'description',     'sylish',              'stylish'),
  ('TPC860401',  'description',     '(Engraving availab',  '(Engraving available)'),
  ('TPC860401',  'web_description', '(Engraving availab',  '(Engraving available)')
ON CONFLICT (supplier_product_code, field, find) DO UPDATE SET replace_with = EXCLUDED.replace_with;

-- One-off: correct the stored rows now (same rule as the sync). One
-- statement per field: an UPDATE … FROM applies only ONE joined row per
-- target, so a product with both a name and a title fix needs two passes.
-- position() not LIKE, so "_" / "%" in a find string are literal.
UPDATE public.supplier_products sp SET name = replace(sp.name, c.find, c.replace_with)
  FROM public.supplier_text_corrections c
 WHERE c.supplier_product_code = sp.supplier_product_code AND c.field = 'name'
   AND position(c.find IN sp.name) > 0 AND position(c.replace_with IN sp.name) = 0;

UPDATE public.supplier_products sp SET title = replace(sp.title, c.find, c.replace_with)
  FROM public.supplier_text_corrections c
 WHERE c.supplier_product_code = sp.supplier_product_code AND c.field = 'title'
   AND position(c.find IN sp.title) > 0 AND position(c.replace_with IN sp.title) = 0;

UPDATE public.supplier_products sp SET description = replace(sp.description, c.find, c.replace_with)
  FROM public.supplier_text_corrections c
 WHERE c.supplier_product_code = sp.supplier_product_code AND c.field = 'description'
   AND position(c.find IN sp.description) > 0 AND position(c.replace_with IN sp.description) = 0;

UPDATE public.supplier_products sp SET web_description = replace(sp.web_description, c.find, c.replace_with)
  FROM public.supplier_text_corrections c
 WHERE c.supplier_product_code = sp.supplier_product_code AND c.field = 'web_description'
   AND position(c.find IN sp.web_description) > 0 AND position(c.replace_with IN sp.web_description) = 0;

COMMIT;
