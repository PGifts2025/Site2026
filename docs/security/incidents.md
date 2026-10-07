# Security incident log

Newest first. One entry per incident: timeline, impact, containment, fixes, follow-ups.
Times are UTC.

---

## 2026-10-06 — Private tables readable/writable with the public anon key; self-grantable admin

**Status:** Resolved · **Severity:** Critical (exposure), no third-party impact
**Reportable to the ICO:** **No** — every personal record present belonged to the owner
or internal tester accounts; no customer / third-party personal data was held.

### Summary
Ten `public` tables had row-level security **disabled** (created in the Supabase
dashboard, where RLS is off by default). Their policies existed but were inert, and the
`anon` / `authenticated` roles held Supabase's default full table grants. Anyone holding
the anon key — which ships in the site's JavaScript by design — could read and write every
row of `orders`, `order_items`, `quotes`, `quote_items`, `customer_profiles`, `profiles`,
`uploads`, `visual_proofs`, `user_designs` and `catalog_print_pricing`.

Separately, `is_admin()` trusted `raw_user_meta_data.is_admin`, which every user can set on
themselves (at sign-up or via `auth.updateUser`). Any self-registered account was an admin
for every `is_admin()` policy, including read access to all customer artwork in the
`order-artwork` bucket, and could insert itself into `team_members`.
`product_template_variants` additionally allowed anonymous `INSERT`/`UPDATE`.

### Timeline
| When | What |
|---|---|
| (unknown, before Jul 2026) | Tables created via the dashboard with RLS off; `is_admin()` written against user metadata. |
| **2026-08-21 03:21:23–03:21:38** | **External probe.** A client with an old `Chrome/124` user agent requested `select=*&limit=3` against 7 tables in 15 s — `catalog_print_pricing`, `customer_profiles`, `order_items`, `orders`, `quote_items`, `quotes`, `user_designs`. All returned HTTP 206 with rows. **No write requests.** Data returned was at most 3 rows per table, all owner/tester data. Consistent with an automated scanner for exposed Supabase projects. |
| **2026-10-06** | **Discovered** while dry-running the quote-payment-security migration: intruder tests passed that should have failed; `relrowsecurity = false` on 10 tables. Anon read/write confirmed with a rolled-back probe. |
| 2026-10-06 | **1a** — client `INSERT/UPDATE/DELETE/TRUNCATE` revoked on the 5 tables the browser never writes. |
| 2026-10-06 | **1b** — all `anon` access revoked on the 8 private tables (sign-up's anon profile `INSERT` temporarily kept). Real anon-key HTTP requests then returned 401. |
| 2026-10-06 | **1c** — `is_admin()` re-pointed at `team_members`; `EXECUTE` revoked from `PUBLIC`/`anon`; user-metadata policies on `apparel_colors` / `product_template_colors` and the open `product_template_variants` write policies replaced with `is_admin()`. Before/after test: a self-flagged account went from "admin, 31 artwork files visible" to "not admin, 0". |
| 2026-10-06 | **1d** — `catalog-images` bucket (anonymous design-thumbnail uploads) capped at 2 MB, PNG/JPEG/WebP. |
| 2026-10-06 | API logs scanned day by day back to 2026-07-09 (retention boundary): the 21 Aug probe was the only unexplained access. |
| 2026-10-06 23:31 | **PR #110** migration applied — RLS + policies on the 8 non-quote tables, sign-up profile trigger, header-scoped guest designs. Verified 28/28. |
| 2026-10-06 23:41 | **PR #111** migration applied — RLS on `quotes`/`quote_items`, server-side pricing, `create-checkout-session` ownership + total/price checks (deployed 2026-10-07 as v31). Verified 23/23 + 18/18. |
| 2026-10-07 | Service-role key confirmed **not** exposed: absent from all live JS bundles and from all 347 commits of git history. |
| 2026-10-07 | Guardrails (this log's PR): RLS-by-default event trigger, `npm run security:check` in CI, client `TRUNCATE` revoked everywhere, frontend admin checks moved to `team_members`. |

### Impact
- Personal data exposed: owner and tester accounts only (`@alpha-omegaltd.com`, `@its-4-u.com`,
  `@promo-gifts.co`, and one colleague's tester account). No real customers yet.
- Known external access: the 21 Aug probe (read-only, ≤ 3 rows per table).
- No evidence of writes by third parties; Stripe charges for all orders matched their line items.

### Root causes
1. Tables created outside migrations, with Supabase's defaults (RLS off, full grants).
2. Authorisation based on user-editable metadata.
3. No automated check for either.

### Fixes
PR #110, PR #111, and the guardrails PR — see CLAUDE.md §62 (access control) and §64 (security rules).

### Follow-ups
- Preview deployments use the **production** service-role key — resolve with the staging project.
- Dashboard hardening checklist: `docs/security/dashboard-settings.md`.
