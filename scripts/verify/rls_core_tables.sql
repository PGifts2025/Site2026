-- Post-apply verification for 20261006_rls_core_tables.sql (CLAUDE.md §62.6).
--
-- Paste into Supabase SQL Editor AFTER applying the migration. Self-contained
-- and NON-DESTRUCTIVE: every test runs inside one DO block that always ends in
-- RAISE EXCEPTION, so all test rows (a guest design, an auth user, edits) are
-- rolled back. The "error" you see IS the report — read the R-lines.
--
-- A = dave@alpha-omegaltd.com (super_admin), B = dave@its-4-u.com (customer).
-- Expected values are in [brackets]; R10/R11 count B's non-deleted orders.
DO $v$
DECLARE
  A uuid := 'dec72a0d-9b36-4615-9f05-c51e803760de';
  B uuid := '7dd0fea8-0084-4637-a8a7-3ea42a2861c0';
  NEWU uuid := gen_random_uuid();
  SX text := gen_random_uuid()::text;
  SY text := gen_random_uuid()::text;
  g uuid; o uuid; n int; m int; r text := '';
BEGIN
  -- ================= guest designs (anon) =================
  EXECUTE 'SET LOCAL ROLE anon';
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('request.headers', '{}', true);
  SELECT count(*) INTO n FROM user_designs;                      r := r || format(E'R1 anon, no header: designs visible=%s [expect 0]\n', n);
  BEGIN
    INSERT INTO user_designs (user_id, session_id, product_key, design_name, design_data, status)
    VALUES (NULL, SX, 'water-bottle', 'g', '{}'::jsonb, 'draft');
    r := r || E'R2 FAIL anon inserted guest design without header\n';
  EXCEPTION WHEN others THEN r := r || format(E'R2 no-header guest insert rejected: %s\n', SQLERRM); END;

  PERFORM set_config('request.headers', json_build_object('x-design-session', SX)::text, true);
  INSERT INTO user_designs (user_id, session_id, product_key, design_name, design_data, status)
  VALUES (NULL, SX, 'water-bottle', 'guest', '{}'::jsonb, 'draft') RETURNING id INTO g;
  UPDATE user_designs SET design_name = 'guest2' WHERE id = g;  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || format(E'R3 guest with header: insert+select OK, update rows=%s [expect 1]\n', n);
  BEGIN
    INSERT INTO user_designs (user_id, session_id, product_key, design_name, design_data, status)
    VALUES (B, NULL, 'water-bottle', 'spoof', '{}'::jsonb, 'draft');
    r := r || E'R4 FAIL guest created a design owned by a user\n';
  EXCEPTION WHEN others THEN r := r || format(E'R4 guest insert as user rejected: %s\n', SQLERRM); END;

  PERFORM set_config('request.headers', json_build_object('x-design-session', SY)::text, true);
  SELECT count(*) INTO n FROM user_designs WHERE id = g;           r := r || format(E'R5 other session sees guest design=%s [expect 0]\n', n);
  UPDATE user_designs SET design_name = 'hijack' WHERE id = g;     GET DIAGNOSTICS n = ROW_COUNT;
  r := r || format(E'R6 other session update rows=%s [expect 0]\n', n);
  BEGIN
    PERFORM claim_guest_designs();
    r := r || E'R7 FAIL anon executed claim\n';
  EXCEPTION WHEN others THEN r := r || format(E'R7 anon claim rejected: %s\n', SQLERRM); END;

  -- ================= signed-in customer B =================
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', B, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.headers', json_build_object('x-design-session', SX)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM user_designs WHERE user_id IS NOT NULL AND user_id <> B;
  r := r || format(E'R8 customer sees other users designs=%s [expect 0]\n', n);
  SELECT claim_guest_designs() INTO n;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO m FROM user_designs WHERE id = g AND user_id = B AND session_id IS NULL;
  r := r || format(E'R9 claim returned=%s, design now owned by B=%s [expect 1,1]\n', n, m);
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT count(*) INTO n FROM orders;                              r := r || format(E'R10 customer sees orders=%s [expect 5 own]\n', n);
  SELECT count(*) INTO n FROM order_items;                         r := r || format(E'R11 customer sees order_items=%s [expect own only]\n', n);
  SELECT count(*) INTO n FROM customer_profiles;                   r := r || format(E'R12 customer sees profiles=%s [expect 1]\n', n);
  SELECT id INTO o FROM orders WHERE customer_id = B ORDER BY created_at LIMIT 1;
  UPDATE orders SET shipping_address = shipping_address, po_number = 'PO-T' WHERE id = o;  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || format(E'R13 customer edits own delivery/PO rows=%s [expect 1]\n', n);
  UPDATE orders SET artwork_status = 'artwork_uploaded' WHERE id = o;  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || format(E'R14 customer sets artwork_uploaded rows=%s [expect 1]\n', n);
  BEGIN
    UPDATE orders SET total_amount = 0.01 WHERE id = o;
    r := r || E'R15 FAIL customer changed order total\n';
  EXCEPTION WHEN others THEN r := r || format(E'R15 customer total change rejected: %s\n', SQLERRM); END;
  BEGIN
    UPDATE orders SET artwork_status = 'approved' WHERE id = o;
    r := r || E'R16 FAIL customer approved own artwork\n';
  EXCEPTION WHEN others THEN r := r || format(E'R16 customer artwork approve rejected: %s\n', SQLERRM); END;
  UPDATE orders SET po_number = 'X' WHERE customer_id = A;         GET DIAGNOSTICS n = ROW_COUNT;
  r := r || format(E'R17 customer edits someone else''s orders rows=%s [expect 0]\n', n);
  BEGIN
    INSERT INTO order_items (order_id, product_name, quantity, unit_price) VALUES (o, 'x', 1, 0.01);
    r := r || E'R18 FAIL customer inserted order_items\n';
  EXCEPTION WHEN others THEN r := r || format(E'R18 customer order_items insert rejected: %s\n', SQLERRM); END;
  UPDATE customer_profiles SET phone = phone WHERE id = B;         GET DIAGNOSTICS n = ROW_COUNT;
  r := r || format(E'R19 customer updates own profile rows=%s [expect 1]\n', n);
  BEGIN
    SELECT count(*) INTO n FROM profiles;
    r := r || E'R20 FAIL customer read profiles\n';
  EXCEPTION WHEN others THEN r := r || format(E'R20 customer profiles read rejected: %s\n', SQLERRM); END;

  -- ================= admin A =================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM orders;                              r := r || format(E'R21 admin sees orders=%s [expect 12]\n', n);
  SELECT count(*) INTO n FROM customer_profiles;                   r := r || format(E'R22 admin sees profiles=%s [expect all]\n', n);
  SELECT count(*) INTO n FROM user_designs;                        r := r || format(E'R23 admin sees designs=%s [expect all]\n', n);
  UPDATE orders SET admin_notes = admin_notes, status = status, artwork_status = artwork_status WHERE id = o;
  GET DIAGNOSTICS n = ROW_COUNT;                                   r := r || format(E'R24 admin order update rows=%s [expect 1]\n', n);

  -- ================= sign-up trigger + anon profile insert =================
  EXECUTE 'RESET ROLE';
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  VALUES (NEWU, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test@example.invalid',
          '{"first_name":"Rls","last_name":"Test","company_name":"Acme","phone":"0123"}'::jsonb);
  SELECT count(*) INTO n FROM customer_profiles WHERE id = NEWU AND first_name = 'Rls' AND company_name = 'Acme' AND phone = '0123';
  r := r || format(E'R25 sign-up trigger created profile=%s [expect 1]\n', n);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    INSERT INTO customer_profiles (id, email) VALUES (gen_random_uuid(), 'x@example.invalid');
    r := r || E'R26 FAIL anon inserted a profile\n';
  EXCEPTION WHEN others THEN r := r || format(E'R26 anon profile insert rejected: %s\n', SQLERRM); END;
  SELECT count(*) INTO n FROM catalog_print_pricing;               r := r || format(E'R27 anon reads print pricing rows=%s [expect >0]\n', n);
  BEGIN
    UPDATE catalog_print_pricing SET price_per_unit = price_per_unit WHERE false;
    r := r || E'R28 FAIL anon can write print pricing\n';
  EXCEPTION WHEN others THEN r := r || format(E'R28 anon print pricing write rejected: %s\n', SQLERRM); END;
  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'RLS%', E'
' || r;
END $v$;