-- 20260806_add_admins_orders_artwork.sql
-- Grant full super_admin to orders@ and artwork@ (Dave's decision: all three
-- admins are full super_admin; no limited user).
--
-- BOTH mechanisms are required (audit-admin-roles-and-access.md §1.1) and this is
-- the trap:
--   (1) a team_members row  -> dashboard access via AdminGuard
--   (2) raw_user_meta_data.is_admin = true on auth.users -> DATA access via RLS
-- A row WITHOUT the flag = logs in to an empty dashboard (looks broken, is not).
--
-- Both accounts already exist and are email-confirmed (verified 2026-08-06):
--   orders@promo-gifts.co   id ee79d281-257f-46a9-a6ed-64a66f4ec038
--   artwork@promo-gifts.co  id b5fc25dd-d82e-42e0-8337-023f78269619
--   dave@alpha-omegaltd.com id dec72a0d-9b36-4615-9f05-c51e803760de (already full)
--
-- Idempotent (safe to re-run). No BEGIN/COMMIT. Verifying SELECT at the end shows
-- all three admins' team row AND metadata flag together, so a missing flag is
-- immediately visible.

-- 1. team_members rows (insert only if this user has no row yet).
INSERT INTO public.team_members (user_id, email, name, first_name, last_name, role, is_active)
SELECT u.id, 'orders@promo-gifts.co', 'Orders In', 'Orders', 'In', 'super_admin', true
  FROM auth.users u
 WHERE u.email = 'orders@promo-gifts.co'
   AND NOT EXISTS (SELECT 1 FROM public.team_members t WHERE t.user_id = u.id);

INSERT INTO public.team_members (user_id, email, name, first_name, last_name, role, is_active)
SELECT u.id, 'artwork@promo-gifts.co', 'Artwork Dep', 'Artwork', 'Dep', 'super_admin', true
  FROM auth.users u
 WHERE u.email = 'artwork@promo-gifts.co'
   AND NOT EXISTS (SELECT 1 FROM public.team_members t WHERE t.user_id = u.id);

-- 2. Self-heal: if a row already existed with the wrong role/active, correct it.
UPDATE public.team_members t
   SET role = 'super_admin', is_active = true, updated_at = now()
  FROM auth.users u
 WHERE t.user_id = u.id
   AND u.email IN ('orders@promo-gifts.co', 'artwork@promo-gifts.co')
   AND (t.role <> 'super_admin' OR t.is_active IS DISTINCT FROM true);

-- 3. Metadata flag (the easy-to-miss half). Idempotent jsonb merge.
UPDATE auth.users
   SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"is_admin": true}'::jsonb
 WHERE email IN ('orders@promo-gifts.co', 'artwork@promo-gifts.co')
   AND coalesce((raw_user_meta_data->>'is_admin')::boolean, false) IS DISTINCT FROM true;

-- 4. Verify — all three admins, team row AND metadata flag, side by side.
SELECT u.email,
       t.role,
       t.is_active,
       (t.user_id IS NOT NULL)                          AS has_team_row,
       (u.raw_user_meta_data->>'is_admin')::boolean     AS is_admin_flag
  FROM auth.users u
  LEFT JOIN public.team_members t ON t.user_id = u.id
 WHERE u.email IN ('dave@alpha-omegaltd.com', 'orders@promo-gifts.co', 'artwork@promo-gifts.co')
 ORDER BY u.email;
  -- expect ALL THREE rows: role = super_admin, is_active = true,
  --        has_team_row = true, is_admin_flag = true.
  -- If any is_admin_flag is null/false -> that person will see an EMPTY dashboard.
