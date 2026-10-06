# Audit — Admin Roles and Access

**Date:** 2026-08-06
**Scope:** Read-only. No source files changed, no accounts or `team_members` rows created, no roles/permissions/metadata changed, no PR. Live schema/metadata probed via the Management API (read-only SELECTs).
**Answers:** Part 1 (what the role system supports + how to add Dave's three admins) and Part 2 (the `/admin` redirect behaviour + the suspected race).

---

## TL;DR — the eight things that decide the plan

1. **There are TWO decoupled admin mechanisms, and a working admin needs BOTH.**
   - **Dashboard access** is gated on a `team_members` row (`role` ∈ {`super_admin`, `staff`}, `is_active`), checked by `AdminGuard`.
   - **Data access (all RLS)** is gated on a *completely separate* flag: `is_admin(auth.uid())` reads `auth.users.raw_user_meta_data.is_admin = true`. It does **not** look at `team_members` or `role` at all.
   - Only Dave has the metadata flag. If you add a `team_members` row but forget the metadata flag, that person passes the dashboard gate and then sees **empty** orders/customers (every query is RLS-blocked). This split is almost certainly behind the "admin-access issue".

2. **`role` accepts exactly two values** — a CHECK constraint pins it to `super_admin` or `staff`. A third role needs the CHECK altered.

3. **The dashboard cannot restrict a user to Orders + Customers only today.** There is no permissions column, no join table, and no per-section allow-list. `staff` gets Dashboard + Orders + Customers + **Products** (and can reach Pricing by URL). Section gating is done three different, inconsistent ways (see §1.2).

4. **RLS is binary and role-blind.** Because `is_admin` is a metadata true/false, a limited admin who can see Orders/Customers data *necessarily* also has full data-layer access to Products/Pricing. Any section restriction is therefore **UI-only, not data-enforced** unless RLS is made role-aware (a bigger change).

5. **The Team UI is display-only.** "Add Member" is a "coming soon" placeholder; Edit/Deactivate/Activate buttons have no handlers. Adding an admin is **SQL-only**.

6. **The unauthenticated `/admin` error is a real bug, not cosmetics-only.** `AdminGuard` calls `supabase.auth.getUser()`, which *throws* `AuthSessionMissingError` when there is no session. That lands in the catch block → "Access Error" screen → 2s → home. The intended clean "not logged in → redirect" branch is **dead code**.

7. **The race is real by construction, and it is the more serious Part-2 issue.** `AdminGuard` validates auth with a **network call** (`getUser()`), ignores the already-correct `AuthContext` (which uses `getSession()` from storage), and treats *every* failure — transient network included — as a fatal lockout that bounces home. A genuinely signed-in admin on a cold load or poor wifi can be bounced with the exact symptom Dave saw. `ProductManager` shares the same fragility.

8. **Two security asides found in passing:** `/admin/seed-data` has **no guard at all** (and it imports `clearCatalogData`), and `team_members` has **RLS disabled** (policies exist but are inert).

---

## Part 1 — What the role system actually supports

### 1.1 Roles

**`team_members` schema (live):**
`id uuid pk`, `user_id uuid` (nullable), `email text NOT NULL`, `name text NOT NULL`, `role text NOT NULL`, `is_active bool default true`, `created_at`, `updated_at`, `first_name`, `last_name`.

**`role` is free-text `TEXT` but constrained:**
```
team_members_role_check: CHECK (role = ANY (ARRAY['super_admin','staff']))
```
So exactly two values are accepted. Not an enum; a CHECK. Adding a third role = `ALTER TABLE ... DROP/ADD CONSTRAINT`.

**Where role is read (every site):**
| Place | What it checks |
|---|---|
| `AdminGuard.jsx:42-79` | `team_members` row for `user_id`, `is_active=true`, and `role ∈ {super_admin, staff}`. This is the **only** gate on most `/admin` routes. |
| `AdminLayout.jsx:71-76` | Hides nav items flagged `superAdminOnly` when `adminRole !== 'super_admin'`. UI only. |
| `AdminSettings.jsx:7`, `AdminTeam.jsx:12` | `if (adminRole !== 'super_admin') → Access Denied`. Real per-page gate. |
| `ProductManager.jsx:226-234` | Its own check via `isCurrentUserAdmin()` — the **metadata** flag, not role (see below). |
| `AdminPricing.jsx` | **No role enforcement** despite the "super_admin" comment. Nav-hidden only; reachable by URL. |

**Live role usage:** one row — `dave@alpha-omegaltd.com`, `super_admin`, active. `staff` is *implemented in code* but no user holds it.

**The decoupled second mechanism — `is_admin()` (all RLS):**
```sql
CREATE FUNCTION public.is_admin(user_id uuid) RETURNS boolean ... SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM auth.users
    WHERE id = user_id AND (raw_user_meta_data->>'is_admin')::boolean = true);
END; $$;
```
This is what every admin RLS policy uses (`orders`, `customers`/`customer_profiles`, `catalog_*`, `order_artwork`, `team_members`, storage buckets, …). It is **role-blind** — it only knows true/false from user metadata. `isCurrentUserAdmin()` in `productCatalogService.js` mirrors it client-side (also metadata, also via `getUser()`).

**Live metadata:** only Dave has `raw_user_meta_data.is_admin = true`. `orders@promo-gifts.co` and `artwork@promo-gifts.co` **already have auth accounts** (created 2026-08-06) but **no** `is_admin` flag and **no** `team_members` row — i.e. set up but not yet made admins.

### 1.2 Granular permissions — can we restrict to Orders + Customers only?

**No. Not today.** There is no permissions column, no join table, and no per-route allow-list. Section access is an inconsistent mix of three mechanisms:

**The admin sections (for defining an allow-list precisely):**

| Section | Route | Route guard | Per-page gate | In nav for `staff`? | Reachable by URL for `staff`? |
|---|---|---|---|---|---|
| Dashboard | `/admin` | AdminGuard | none | yes | yes |
| Orders | `/admin/orders`, `/orders/:id` | AdminGuard | none | yes | yes |
| Customers | `/admin/customers`, `/customers/:id` | AdminGuard | none | yes | yes |
| Products | `/admin/products` | AdminGuard | `isCurrentUserAdmin()` (metadata, binary) | **yes** (no `superAdminOnly`) | yes |
| Pricing | `/admin/pricing` | AdminGuard | **none** | no (nav-hidden) | **yes** (nav-hidden but not gated) |
| Team | `/admin/team` | AdminGuard | `role==='super_admin'` else denied | no | no (page denies) |
| Settings | `/admin/settings` | AdminGuard | `role==='super_admin'` else denied | no | no (page denies) |
| Seed Data | `/admin/seed-data` | **NONE** | none | no | **yes to anyone** (see §1.4 asides) |

So today `staff` ≈ Dashboard + Orders + Customers + Products, plus Pricing-by-URL. That is **not** "Orders + Customers only," and nothing off-the-shelf produces that set.

**Navigation is role-driven only via the `superAdminOnly` flag** (`AdminLayout.jsx`), and it is **UI-only** — hiding a nav link does not gate the route (`Pricing` proves it). Routes are guarded by **one** `AdminGuard` per route with **no section awareness**; the only genuine per-section gates are the two hand-rolled `super_admin` checks on Team/Settings.

**Recommendation (lightest that works — not a full RBAC):**
- Add **one section allow-list** keyed on role, in a single constant, e.g.
  `super_admin → [all]`, `staff → [dashboard, orders, customers, products]`, new `orders_customers → [dashboard, orders, customers]`.
- **Alter the role CHECK** to permit the third value.
- Use that one map in **two** places: `AdminLayout`'s nav filter, and a **per-section gate** — give `AdminGuard` a `section` prop and have it redirect to `/admin` when the role's allow-list excludes it. Replace the three ad-hoc mechanisms (per-page `super_admin` checks, `superAdminOnly` nav flag, `isCurrentUserAdmin` gate) with this one so behaviour is consistent.
- **Size: S–M.** ~1 constant + `AdminGuard` prop + nav filter change + per-route `section` on ~8 routes + the CHECK migration. No new tables.
- **Caveat to state to Dave:** this is **UI/route enforcement only**. See §1.4 — RLS stays binary, so a limited admin can still reach Products/Pricing *data* via the API. For three trusted internal users that is a reasonable line to draw; making it data-enforced is a larger change.

### 1.3 Adding the two new admins

**The Team UI cannot do it.** `AdminTeam.jsx` is a read-only list; "Add Member" opens a modal that literally says *"Feature coming soon"*, and Edit/Deactivate/Activate have no `onClick`. So this is **SQL + one browser step**.

**`team_members.user_id`** is nullable in the schema, but `AdminGuard` matches on `user_id = auth.uid()`, so it **must** be set to the person's real `auth.users.id` to work — which means **the auth account must exist first**. Both mailboxes already have accounts, so that step is done.

**Exact steps for Dave (immediate, independent of any code change):**

1. **Browser (already done for these two):** the person signs up / the account exists in Supabase Auth. Confirm the email is verified so they can log in. (`orders@` and `artwork@` accounts already exist as of 2026-08-06.)

2. **SQL Editor — create the `team_members` row** (ties the login to the dashboard gate). Reference SQL (Dave runs it):
   ```sql
   INSERT INTO public.team_members (user_id, email, name, first_name, last_name, role, is_active)
   VALUES
     ((SELECT id FROM auth.users WHERE email='orders@promo-gifts.co'),
      'orders@promo-gifts.co', 'Orders In', 'Orders', 'In', 'super_admin', true),
     ((SELECT id FROM auth.users WHERE email='artwork@promo-gifts.co'),
      'artwork@promo-gifts.co', 'Artwork Dep', 'Artwork', 'Dep', 'staff', true);
   ```
   (`artwork@` shown as `staff` as the nearest existing role — but note `staff` today ≠ "Orders + Customers only"; the true restriction needs the §1.2 change. Until then `staff` still exposes Products and Pricing-by-URL.)

3. **SQL Editor — set the metadata flag** (this is the step that is easy to miss and produces "logs in but sees nothing"):
   ```sql
   UPDATE auth.users
      SET raw_user_meta_data = coalesce(raw_user_meta_data,'{}'::jsonb) || '{"is_admin":true}'::jsonb
    WHERE email IN ('orders@promo-gifts.co','artwork@promo-gifts.co');
   ```
   Without this, RLS blocks all admin data for them. **With** it, both get full data-layer admin (RLS is binary) — including Products/Pricing data for `artwork@`, regardless of the UI restriction. That trade-off is the §1.4 point.

Browser vs SQL summary: **browser** = the account exists + email verified; **SQL** = the `team_members` row **and** the metadata flag. Nothing else.

### 1.4 RLS

- **Every admin table gates on `is_admin(auth.uid())`** = the `raw_user_meta_data.is_admin` flag. Confirmed across `orders`, `order_items`, `order_artwork`, `customer_profiles`, `quotes`, `quote_items`, all `catalog_*`, `product_templates`, `print_areas`, `design_approvals`, and the storage buckets. It is **binary and role-blind**.
- **Consequence for a limited admin:** to see Orders/Customers *data*, `artwork@` must have `is_admin=true`; that same flag grants full data access to Products/Pricing/etc. **RLS cannot express "Orders + Customers only."** So a section restriction is enforced at the **route** layer only; the data is reachable directly (API, or a crafted request). Route-only is weaker than route + RLS. For three trusted internal users it's a defensible line, but Dave should decide knowingly.
- **`team_members` has RLS DISABLED** (`relrowsecurity=false`) even though two policies ("Admins full access", "Users read own record") are defined — so the policies are **inert** and access falls back to table grants. Worth enabling RLS so the intended policies actually apply.
- Making RLS role-aware (so Products/Pricing data is truly closed to a limited admin) would mean teaching `is_admin`/policies about `team_members.role` (or a per-section grant). That is a **larger** change than the route allow-list and is not needed for the three-user goal unless Dave wants data-layer enforcement.

---

## Part 2 — The `/admin` redirect behaviour

### 2.1 The unauthenticated case

**What happens now (`AdminGuard.jsx:22-104`):**
```
getUser()  ── no session ──▶ throws AuthSessionMissingError
   └▶ caught at line 92 → setError(...) → "Access Error" screen → setTimeout 2s → navigate('/')
```
The intended clean branch `if (!currentUser) { navigate('/', "Please log in") }` (lines 29-37) is **never reached for a truly unauthenticated visitor**, because `getUser()` *throws* rather than returning `{ user: null }`. So a not-signed-in visitor gets a red "Access Error — Auth session missing!" that reads like a broken admin account, exactly as Dave experienced.

**Recommendation:** determine auth from **storage** (`getSession()` or the existing `AuthContext`), and branch on three distinct outcomes instead of one catch-all:
- **No session →** send to sign-in and return to `/admin` afterwards. Note there is **no `/login` route**; sign-in is the in-app `AuthModal`. So either add a small `/login` page (cleanest for a deep-link return) or redirect home with a flag that opens the modal + a stored `returnTo=/admin`.
- **Signed in but not an admin →** home with the "no permission" message (as today).
- **Transient error →** do **not** treat as a lockout (see §2.2).
- **Size: S.**

### 2.2 The race — is it real?

**Yes — the design permits it, and it is the more important Part-2 issue.**

- `AdminGuard` runs `checkAdminAccess()` in a mount `useEffect([])` and calls `supabase.auth.getUser()` **immediately**. It does **not** consult `AuthContext` and does **not** wait for auth to finish initialising.
- `AuthContext` already does the right thing — `checkUser()` uses `getSession()` (reads storage, no network, waits for the client to restore the session) and exposes `loading` / `user`. **`AdminGuard` ignores all of it.**
- `getUser()` is a **network** validation (`GET /auth/v1/user`), unlike `getSession()`. `AdminGuard`'s catch block treats **every** failure — transient network error, token-refresh hiccup, *and* the genuine no-session case — identically: `setError` → "Access Error" → bounce home.
- The console ordering Dave saw (`[AdminGuard] Error …` **before** `[AuthContext] … INITIAL_SESSION`) confirms `AdminGuard` decides **independently and eagerly**, ahead of the app's own auth resolution.

**Why this bites a legitimate admin:** on a cold load or poor wifi, a signed-in admin's `getUser()` network call can fail or lag transiently. `AdminGuard` converts that into the same fatal "Access Error → home" as a real permission failure — indistinguishable from being locked out, intermittent, and hard to reproduce. `ProductManager.jsx:226` (`isCurrentUserAdmin()` → `getUser()`) has the identical fragility.

I cannot deterministically *reproduce* a timing-only failure from static analysis, but the code path unambiguously allows a valid admin to be bounced by a transient network error, which is precisely the "surfaces on poor wifi" failure the prompt describes. This matters more than the redirect cosmetics: it can make a correctly-configured admin *look* locked out.

**Recommendation (fixes 2.1 and 2.2 together):** have `AdminGuard` consume `AuthContext` — wait for `loading===false`, read `user` from it (storage-backed `getSession`), and only then check the `team_members` role. Redirect **only** on a definite outcome (no session → sign-in; not-admin → home). On a transient error, retry / show a soft "checking…" state rather than bouncing. Optionally fold `ProductManager`'s check into the same pattern.
**Size: S** (one component, ~the same shape it already has).

---

## Recommendations and sizes

| # | Change | Priority | Size |
|---|---|---|---|
| A | **Fix `AdminGuard`** — use `AuthContext`/`getSession`, distinguish no-session vs not-admin vs transient, stop bouncing on transient errors, send unauth visitors to sign-in with return to `/admin`. Fold in `ProductManager`. | **High** (Dave hit it; can falsely lock out real admins) | **S** |
| B | **Section allow-list** — one role→sections map used by nav + a per-section `AdminGuard` gate; add the third role (+ CHECK migration); retire the three ad-hoc gates. Restricts `artwork@` to Orders + Customers at the **route** layer. | High (needed for the requested access split) | **S–M** |
| C | **Add the two admins now** — `team_members` rows + `is_admin` metadata (SQL in §1.3). Independent of A/B; unblocks testing immediately. `orders@` = full (super_admin), `artwork@` = limited (needs B to be a real restriction). | High | **XS** (SQL only) |
| D | **Guard `/admin/seed-data`** — wrap in `AdminGuard` (it exposes `clearCatalogData`). | Medium (writes are RLS-blocked for non-admins, but the route should not be public) | **XS** |
| E | **Enable RLS on `team_members`** so its existing policies actually apply. | Medium | **XS** |
| F | *(Optional, only if data-layer enforcement is wanted)* make RLS role-aware so a limited admin truly cannot read Products/Pricing data. Not needed for three trusted users. | Low | **L** |

**Suggested order:** C (unblock testing today) → A (stop the false lockouts) → B (the real access split) → D, E (cheap hardening). F only if Dave wants the restriction enforced at the data layer, not just the UI.

**Note on the two shared mailboxes:** using `orders@` and `artwork@` as admin logins is Dave's deliberate call and works fine mechanically — `team_members` keys on the auth user id, not on a person. The only thing to be aware of is that anyone with the mailbox password is that admin; there is no per-person audit trail within a shared login.

---

## Appendix — files and evidence

| File | Lines | Role in this audit |
|---|---|---|
| `src/components/admin/AdminGuard.jsx` | 18-20, 22-37, 42-79, 92-104 | The one route gate; `getUser()` + catch-all bounce (§2) |
| `src/context/AuthContext.jsx` | 19-64, 161-169 | Correct `getSession()` init + `loading`/`user`, which AdminGuard ignores |
| `src/components/admin/AdminLayout.jsx` | 28-76 | Nav items + `superAdminOnly` UI-only filter (§1.2) |
| `src/pages/admin/AdminTeam.jsx` | 12-21, 71-77, 167-185 | `super_admin` gate; Add/Edit are placeholders (§1.3) |
| `src/pages/admin/AdminSettings.jsx` | 5-7 | `super_admin` per-page gate |
| `src/pages/AdminPricing.jsx` | 9-12, 55 | "super_admin" in comment, **no** enforcement (§1.2) |
| `src/pages/ProductManager.jsx` | 226-244, 2401-2413 | Own `isCurrentUserAdmin()` (metadata) gate + same `getUser()` fragility |
| `src/pages/AdminSeedData.jsx` + `src/App.jsx:147` | — | Unguarded `/admin/seed-data`, imports `clearCatalogData` (§1.4) |
| `src/services/productCatalogService.js` | 122-137 | `isCurrentUserAdmin()` = metadata flag |
| DB (live probe) | — | `team_members` schema + CHECK; `is_admin()` = metadata; RLS policies; `team_members` RLS disabled; only Dave has `is_admin=true`; `orders@`/`artwork@` accounts exist without flag/row |
