-- Post-apply verification for 20261007_quote_payment_security.sql (CLAUDE.md §16.10).
--
-- Paste into Supabase SQL Editor AFTER applying the migration. NON-DESTRUCTIVE:
-- one DO block that always ends in RAISE EXCEPTION, so every test quote, line
-- and edit is rolled back. The "error" you see IS the report — read the T-lines.
--
-- A = dave@alpha-omegaltd.com, B = dave@its-4-u.com (acts as an intruder).
-- Expected values are in [brackets]. T11 shows the documented clothing gap
-- (client price kept at insert; create-checkout-session floor-checks it).
DO $verify$
DECLARE
  A  uuid := 'dec72a0d-9b36-4615-9f05-c51e803760de';
  B  uuid := '7dd0fea8-0084-4637-a8a7-3ea42a2861c0';
  WB uuid := '041529b9-7aa9-41fa-98d5-5ac445557309';
  CC uuid := 'b2cb5c8b-3c30-4bfb-bc2f-faa8e28020f9';
  TS uuid := '65a221a6-46cc-4bd2-8893-a93554c10c23';
  q1 uuid; q2 uuid; q3 uuid; i1 uuid; i2 uuid; i3 uuid;
  v_status text; v_ts timestamptz; v_num numeric; v_num2 numeric; v_total numeric;
  v_int int; v_rows int; r text := '';
BEGIN
  -- ===================== TESTS (all rolled back) =====================
  -- helpers via set_config; A = owner, B = intruder
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- T1 client insert cannot create a paid quote
  INSERT INTO quotes (customer_id, status, total_amount, paid_at, payment_amount)
  VALUES (A, 'converted', 1, now(), 1) RETURNING id INTO q1;
  EXECUTE 'RESET ROLE';
  SELECT status, paid_at, payment_amount INTO v_status, v_ts, v_num FROM quotes WHERE id = q1;
  r := r || format(E'T1 status=%s paid_at=%s payment_amount=%s [expect draft,null,null]\n', v_status, v_ts, v_num);

  -- T2 tampered unit_price on tier-priced insert is overwritten
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO quote_items (quote_id, product_id, product_name, quantity, unit_price, taxable_net_unit)
  VALUES (q1, WB, 'x', 1000, 0.01, 0) RETURNING id INTO i1;
  EXECUTE 'RESET ROLE';
  SELECT unit_price, taxable_net_unit INTO v_num, v_num2 FROM quote_items WHERE id = i1;
  SELECT total_amount INTO v_total FROM quotes WHERE id = q1;
  r := r || format(E'T2 unit_price=%s taxable_net_unit=%s quote_total=%s [expect 8.30,null,9960.00]\n', v_num, v_num2, v_total);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- T3 below-MOQ insert rejected
  BEGIN
    INSERT INTO quote_items (quote_id, product_id, product_name, quantity, unit_price) VALUES (q1, WB, 'x', 500, 8.30);
    r := r || E'T3 FAIL inserted below MOQ\n';
  EXCEPTION WHEN others THEN r := r || format(E'T3 rejected: %s\n', SQLERRM); END;

  -- T4 direct unit_price update denied
  BEGIN
    UPDATE quote_items SET unit_price = 0.01 WHERE id = i1;
    r := r || E'T4 FAIL unit_price updated\n';
  EXCEPTION WHEN others THEN r := r || format(E'T4 rejected: %s\n', SQLERRM); END;

  -- T5 direct total_amount update denied
  BEGIN
    UPDATE quotes SET total_amount = 1 WHERE id = q1;
    r := r || E'T5 FAIL total updated\n';
  EXCEPTION WHEN others THEN r := r || format(E'T5 rejected: %s\n', SQLERRM); END;

  -- T6 direct status update denied
  BEGIN
    UPDATE quotes SET status = 'converted' WHERE id = q1;
    r := r || E'T6 FAIL status updated\n';
  EXCEPTION WHEN others THEN r := r || format(E'T6 rejected: %s\n', SQLERRM); END;

  -- T7 delivery details still writable
  UPDATE quotes SET po_number = 'PO-TEST', shipping_address = '{"line1":"x"}'::jsonb WHERE id = q1;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  r := r || format(E'T7 po/address update rows=%s [expect 1]\n', v_rows);

  -- T8 RPC below MOQ rejected
  BEGIN
    PERFORM set_quote_item_quantity(i1, 500);
    r := r || E'T8 FAIL rpc accepted 500\n';
  EXCEPTION WHEN others THEN r := r || format(E'T8 rejected: %s\n', SQLERRM); END;

  -- T9 RPC valid change re-prices + re-totals
  PERFORM set_quote_item_quantity(i1, 2000);
  EXECUTE 'RESET ROLE';
  SELECT quantity, unit_price INTO v_int, v_num FROM quote_items WHERE id = i1;
  SELECT total_amount INTO v_total FROM quotes WHERE id = q1;
  r := r || format(E'T9 qty=%s unit=%s total=%s [expect 2000,8.30,19920.00]\n', v_int, v_num, v_total);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- T10 chi-cup at 100 priced from tier
  INSERT INTO quote_items (quote_id, product_id, product_name, quantity, unit_price)
  VALUES (q1, CC, 'x', 100, 1) RETURNING id INTO i2;
  -- T11 clothing keeps client price (documented gap; floor-checked at checkout)
  INSERT INTO quote_items (quote_id, product_id, product_name, quantity, unit_price)
  VALUES (q1, TS, 'x', 50, 0.01) RETURNING id INTO i3;
  EXECUTE 'RESET ROLE';
  SELECT unit_price INTO v_num FROM quote_items WHERE id = i2;
  SELECT unit_price INTO v_num2 FROM quote_items WHERE id = i3;
  r := r || format(E'T10 chi-cup x100 unit=%s [expect 13.00]\nT11 t-shirt unit=%s [expect 0.01 = known gap]\n', v_num, v_num2);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- T12 RPC refuses engine-priced line
  BEGIN
    PERFORM set_quote_item_quantity(i3, 100);
    r := r || E'T12 FAIL rpc changed clothing qty\n';
  EXCEPTION WHEN others THEN r := r || format(E'T12 rejected: %s\n', SQLERRM); END;

  -- ---- intruder B ----
  PERFORM set_config('request.jwt.claims', json_build_object('sub', B, 'role', 'authenticated')::text, true);

  -- T13 B cannot change A's line via RPC
  BEGIN
    PERFORM set_quote_item_quantity(i1, 3000);
    r := r || E'T13 FAIL intruder changed qty\n';
  EXCEPTION WHEN others THEN r := r || format(E'T13 rejected: %s\n', SQLERRM); END;

  -- T14 B cannot insert into A's quote
  BEGIN
    INSERT INTO quote_items (quote_id, product_id, product_name, quantity, unit_price) VALUES (q1, CC, 'x', 25, 15);
    r := r || E'T14 FAIL intruder inserted\n';
  EXCEPTION WHEN others THEN r := r || format(E'T14 rejected: %s\n', SQLERRM); END;

  -- T15 B cannot delete A's lines (RLS filters to 0 rows)
  DELETE FROM quote_items WHERE quote_id = q1;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  r := r || format(E'T15 intruder delete rows=%s [expect 0]\n', v_rows);

  -- ---- back to A: combine ----
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  INSERT INTO quotes (customer_id, total_amount) VALUES (A, 0) RETURNING id INTO q2;
  INSERT INTO quote_items (quote_id, product_id, product_name, quantity, unit_price) VALUES (q2, CC, 'x', 250, 99);

  -- T17 B cannot combine A's quotes
  PERFORM set_config('request.jwt.claims', json_build_object('sub', B, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM combine_quotes(q1, ARRAY[q2]);
    r := r || E'T17 FAIL intruder combined\n';
  EXCEPTION WHEN others THEN r := r || format(E'T17 rejected: %s\n', SQLERRM); END;

  -- T16 A combines q2 into q1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  PERFORM combine_quotes(q1, ARRAY[q2]);
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO v_int FROM quotes WHERE id = q2;
  SELECT count(*) INTO v_rows FROM quote_items WHERE quote_id = q1;
  SELECT total_amount,
         (SELECT round(sum(quantity * unit_price) + sum(line_vat), 2) FROM quote_items WHERE quote_id = q1)
    INTO v_total, v_num
  FROM quotes WHERE id = q1;
  r := r || format(E'T16 q2_exists=%s q1_lines=%s total=%s recomputed=%s [expect 0,4,equal]\n', v_int, v_rows, v_total, v_num);
  SELECT unit_price INTO v_num FROM quote_items WHERE quote_id = q1 AND quantity = 250;
  r := r || format(E'T16b moved chi-cup x250 unit=%s [expect 11.70, client sent 99]\n', v_num);

  -- T18 anon cannot execute RPCs
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM set_quote_item_quantity(i1, 1000);
    r := r || E'T18 FAIL anon executed rpc\n';
  EXCEPTION WHEN others THEN r := r || format(E'T18 rejected: %s\n', SQLERRM); END;
  EXECUTE 'RESET ROLE';

  -- T20 paid quote is frozen for its owner
  INSERT INTO quotes (customer_id, total_amount) VALUES (A, 0) RETURNING id INTO q3;
  UPDATE quotes SET status = 'converted' WHERE id = q3;  -- as postgres (payment path)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO quote_items (quote_id, product_id, product_name, quantity, unit_price) VALUES (q3, CC, 'x', 25, 15);
    r := r || E'T20 FAIL inserted into paid quote\n';
  EXCEPTION WHEN others THEN r := r || format(E'T20 rejected: %s\n', SQLERRM); END;
  DELETE FROM quotes WHERE id = q3;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  r := r || format(E'T20b delete paid quote rows=%s [expect 0]\n', v_rows);

  -- T19 owner can delete own draft quote (items cascade)
  DELETE FROM quotes WHERE id = q1;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO v_int FROM quote_items WHERE quote_id = q1;
  r := r || format(E'T19 delete own draft rows=%s remaining_items=%s [expect 1,0]\n', v_rows, v_int);

  -- T21 existing paid quotes untouched by migration
  SELECT count(*) INTO v_int FROM quotes q
  WHERE q.status = 'converted'
    AND abs(q.total_amount - (SELECT coalesce(sum(quantity * unit_price) + sum(line_vat), 0) FROM quote_items WHERE quote_id = q.id)) > 0.005;
  r := r || format(E'T21 converted quotes with total drift=%s [expect 0]\n', v_int);
  RAISE EXCEPTION 'QUOTE_SECURITY%', E'
' || r;
END $verify$;
