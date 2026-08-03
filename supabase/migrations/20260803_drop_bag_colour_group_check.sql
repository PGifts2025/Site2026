-- 20260803_drop_bag_colour_group_check.sql
-- Drop bag_print_pricing_colour_group_check.
--
-- WHY: the CHECK (natural/black, widened to natural/black/white by the 5oz
-- migration) has already killed one migration partway (23514 on the 5oz white
-- rows) and re-arms on every bag that introduces a new colour group. It does
-- NOT catch the failure that matters — a row can carry an allowed group and
-- still have no matching cost row for the requested selection. The real gate is
-- bagColourGroup() in code plus the seed itself, both verified by each
-- migration's own SELECTs. Its only failure mode is a half-applied migration,
-- the worst kind. Agreed to drop (PR #92 discussion).
--
-- Not runtime-load-bearing: read-time pricing (bagUnitPrice) never consults the
-- constraint; both bags price identically before and after (verified).
--
-- Apply AFTER the 5oz migration (20260803_bag_5oz_mini_cotton.sql). Idempotent,
-- no BEGIN/COMMIT. Safe regardless of whether the constraint currently exists as
-- natural/black or natural/black/white — DROP IF EXISTS removes either.

ALTER TABLE bag_print_pricing DROP CONSTRAINT IF EXISTS bag_print_pricing_colour_group_check;

-- Verify: constraint is gone.
SELECT count(*) AS colour_group_check_remaining
  FROM pg_constraint
 WHERE conrelid = 'bag_print_pricing'::regclass
   AND conname = 'bag_print_pricing_colour_group_check';   -- expect: 0

-- Verify: existing rows are intact and untouched (every group still present).
SELECT colour_group, count(*) AS rows
  FROM bag_print_pricing
 GROUP BY colour_group
 ORDER BY colour_group;                                     -- expect: black, natural, white
