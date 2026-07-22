-- ============================================================================
-- Close the orphan-order hole: drop the customer-facing orders INSERT policy.
-- ----------------------------------------------------------------------------
-- WHY (audit-orphan-order-path.md):
--   The "Users create orders" RLS policy allowed ANY authenticated user to
--   INSERT an order for themselves (with_check: auth.uid() = customer_id, no
--   admin check). That let a signed-in customer create unpaid, zero-VAT orders
--   that bypass Stripe / confirm_payment_atomic entirely. The client button
--   that used it (CustomerQuotes "Convert to Order") is removed in the same PR,
--   but the RLS policy is the real gate and must go too.
--
-- SAFE — the payment path does not use this policy:
--   * confirm_payment_atomic runs as service_role, which BYPASSES RLS, so the
--     Stripe order-creation path is unaffected (verified: EXECUTE granted to
--     service_role only, CLAUDE.md §17.7).
--   * "Admins manage orders" (ALL, is_admin(auth.uid())) stays, so admins can
--     still create/manage orders.
--   * "Users view own orders" (SELECT) stays, so customers still see their
--     orders. Only customer INSERT is removed.
--   After this runs, orders can be created ONLY by the service-role RPC or by
--   an admin — never by a plain customer.
--
-- APPLY (CLAUDE.md §52, and the PR #76 lesson):
--   NO explicit BEGIN/COMMIT (the SQL Editor silently discarded post-DDL
--   statements when a prior migration mixed transaction blocks with DDL).
--   Idempotent. Ends with a SELECT that MUST return ZERO rows, so a green run
--   is visible evidence the INSERT policy is gone rather than "No rows".
-- ============================================================================

DROP POLICY IF EXISTS "Users create orders" ON public.orders;

-- ---------------------------------------------------------------------------
-- Verification 1: there must be NO INSERT policy on orders after this runs.
--   Expected: ZERO rows.
-- ---------------------------------------------------------------------------
SELECT policyname, cmd, roles::text AS roles, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'orders' AND cmd = 'INSERT';

-- ---------------------------------------------------------------------------
-- Verification 2 (optional): the two remaining policies stay intact.
--   Expected: exactly 2 rows — "Admins manage orders" (ALL) and
--   "Users view own orders" (SELECT).
-- ---------------------------------------------------------------------------
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'orders'
--  ORDER BY cmd, policyname;
