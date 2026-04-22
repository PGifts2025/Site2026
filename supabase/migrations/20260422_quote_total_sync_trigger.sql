-- Keep quotes.total_amount in sync with SUM(quote_items.quantity * unit_price).
--
-- Problem: two quote-creation code paths exist. The legacy QT-XXXXXXXX
-- path computes and stores total_amount correctly. The newer Q-######
-- path leaves total_amount = 0 and neither path recomputes on item
-- changes. That caused:
--   a) legitimate new-path quotes to trip the £0 checkout guard, and
--   b) before the guard existed, a £0 quote was auto-completed by
--      Stripe and produced a fake "paid" order (Q-976184 / ORD-20260422-0014).
--
-- orders.total_amount remains FROZEN at checkout time — it represents the
-- contractual paid amount. The guard `status != 'converted'` in the trigger
-- is deliberate: once a quote is paid, admins may tweak quote_items for
-- fulfilment reasons (notes, swaps) but the financial total must never
-- drift from what the customer paid. This mirrors the decision not to add
-- a trigger on order_items.

-- =====================================================
-- 1. Recompute function
-- =====================================================

CREATE OR REPLACE FUNCTION public.recompute_quote_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_quote_id uuid;
BEGIN
  -- Handle both the NEW row (insert/update) and OLD row (delete)
  v_quote_id := COALESCE(NEW.quote_id, OLD.quote_id);

  UPDATE public.quotes
  SET total_amount = COALESCE((
    SELECT SUM(quantity * unit_price)
    FROM public.quote_items
    WHERE quote_id = v_quote_id
  ), 0),
  updated_at = now()
  WHERE id = v_quote_id
    AND status != 'converted';  -- never mutate totals on converted quotes (payment is locked)

  RETURN NULL;
END;
$$;

-- =====================================================
-- 2. Triggers (fire AFTER each quote_items mutation)
-- =====================================================

DROP TRIGGER IF EXISTS quote_items_total_sync_ins ON public.quote_items;
CREATE TRIGGER quote_items_total_sync_ins
  AFTER INSERT ON public.quote_items
  FOR EACH ROW
  EXECUTE FUNCTION public.recompute_quote_total();

DROP TRIGGER IF EXISTS quote_items_total_sync_upd ON public.quote_items;
CREATE TRIGGER quote_items_total_sync_upd
  AFTER UPDATE ON public.quote_items
  FOR EACH ROW
  EXECUTE FUNCTION public.recompute_quote_total();

DROP TRIGGER IF EXISTS quote_items_total_sync_del ON public.quote_items;
CREATE TRIGGER quote_items_total_sync_del
  AFTER DELETE ON public.quote_items
  FOR EACH ROW
  EXECUTE FUNCTION public.recompute_quote_total();

-- =====================================================
-- 3. Heal historic draft quotes (draft-only, narrow)
-- =====================================================

-- Heal historic draft quotes whose total_amount is out of sync.
-- Narrow by status='draft' — never touch converted quotes.
UPDATE public.quotes
SET total_amount = COALESCE((
  SELECT SUM(qi.quantity * qi.unit_price)
  FROM public.quote_items qi
  WHERE qi.quote_id = quotes.id
), 0),
updated_at = now()
WHERE status = 'draft'
  AND total_amount != COALESCE((
    SELECT SUM(qi.quantity * qi.unit_price)
    FROM public.quote_items qi
    WHERE qi.quote_id = quotes.id
  ), 0);

-- =====================================================
-- 4. Delete the £0-exploit artefact
-- =====================================================

-- Delete the £0 exploit artefact (Q-976184 / ORD-20260422-0014).
-- Confirmed by user as test data. Referential order matters:
--   order_artwork → order_items → orders → quote_items → quotes
-- Use ON DELETE CASCADE if configured, otherwise explicit deletes.

-- Check for and delete attached artwork first
DELETE FROM public.order_artwork
WHERE order_id IN (
  SELECT id FROM public.orders WHERE order_number = 'ORD-20260422-0014'
);

-- Delete order_items for the order
DELETE FROM public.order_items
WHERE order_id IN (
  SELECT id FROM public.orders WHERE order_number = 'ORD-20260422-0014'
);

-- Delete the order
DELETE FROM public.orders
WHERE order_number = 'ORD-20260422-0014';

-- Delete quote_items for the quote
DELETE FROM public.quote_items
WHERE quote_id IN (
  SELECT id FROM public.quotes WHERE quote_number = 'Q-976184'
);

-- Delete the quote itself
DELETE FROM public.quotes
WHERE quote_number = 'Q-976184';

-- =====================================================
-- 5. Post-migration verification (run manually in SQL editor)
-- =====================================================
--
-- 1. Confirm Q-074562 is healed:
--    SELECT quote_number, total_amount FROM quotes WHERE quote_number = 'Q-074562';
--    -- expect total_amount = 176.75
--
-- 2. Confirm Q-976184 is gone:
--    SELECT quote_number FROM quotes WHERE quote_number = 'Q-976184';
--    -- expect 0 rows
--
-- 3. Confirm ORD-20260422-0014 is gone:
--    SELECT order_number FROM orders WHERE order_number = 'ORD-20260422-0014';
--    -- expect 0 rows
--
-- 4. Confirm QT-MO8M71NG is untouched (paid £176.75 stays):
--    SELECT quote_number, total_amount FROM quotes WHERE quote_number = 'QT-MO8M71NG';
--    -- expect total_amount = 176.75
--
-- 5. Confirm trigger works:
--    -- Pick any draft quote, manually change a quote_item quantity, confirm quotes.total_amount updates.
