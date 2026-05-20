-- margin_override_history: append-only audit log for supplier_products.margin_pct_override changes
--
-- Written by the /api/admin/recompute-margin serverless route (service role)
-- on every admin override change. Each row records the old and new override
-- value, who changed it, and when. No SELECT policy: history is readable via
-- service role / direct SQL only (no v1 viewer UI — CLAUDE.md Phase 2 scope).
--
-- Migration-first deploy (CLAUDE.md §52): apply this via Supabase SQL Editor
-- BEFORE merging the PR. The history INSERT in the route is non-catastrophic
-- (logged, not fatal) so a window where the table is absent only loses audit
-- rows, never blocks an override save.

CREATE TABLE IF NOT EXISTS public.margin_override_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_product_code text NOT NULL,
  old_pct      numeric(5,4),
  new_pct      numeric(5,4),
  changed_by   uuid REFERENCES auth.users(id),
  changed_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT margin_override_history_old_pct_range CHECK (old_pct IS NULL OR (old_pct >= 0 AND old_pct < 1)),
  CONSTRAINT margin_override_history_new_pct_range CHECK (new_pct IS NULL OR (new_pct >= 0 AND new_pct < 1))
);

CREATE INDEX IF NOT EXISTS margin_override_history_product_idx
  ON public.margin_override_history (supplier_product_code, changed_at DESC);

ALTER TABLE public.margin_override_history ENABLE ROW LEVEL SECURITY;

-- Service-role writes only; no SELECT policy for now (history readable only via service role / direct SQL)
DROP POLICY IF EXISTS margin_override_history_service_write ON public.margin_override_history;
CREATE POLICY margin_override_history_service_write
  ON public.margin_override_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
