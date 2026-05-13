/**
 * Smoke test for the corrected DesignerV2 save payload — inserts a
 * row into user_designs with exactly the shape the React code now
 * sends, verifies it lands, then cleans up.
 *
 * Run: node scripts/smoke-test-designer-v2-save.js
 *
 * Uses session_id (anonymous path) to avoid needing an auth.users row.
 * Writes via PostgREST with the service-role key (RLS bypass).
 */

import { config } from 'dotenv';
config();

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const sessionId = `smoke-test-${Date.now()}`;
const row = {
  user_id: null,
  session_id: sessionId,
  design_name: 'Smoke test',
  supplier_product_code: 'MG0192',
  print_area: 'Wrap',
  color_code: 'AM',
  color_name: 'Amber',
  design_data: { version: '5.3.0', objects: [], background: null },
  thumbnail_url: null,
};

console.log('Payload:', JSON.stringify(row, null, 2));
console.log('');

const insertResp = await fetch(`${url}/rest/v1/user_designs`, {
  method: 'POST',
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },
  body: JSON.stringify(row),
});

const insertBody = await insertResp.text();
if (!insertResp.ok) {
  console.error(`[FAIL] INSERT -> HTTP ${insertResp.status}`);
  console.error(insertBody);
  process.exit(1);
}

const [inserted] = JSON.parse(insertBody);
console.log(`[PASS] INSERT -> id=${inserted.id}`);
console.log(`       supplier_product_code=${inserted.supplier_product_code}`);
console.log(`       print_area=${inserted.print_area}`);
console.log(`       color_name=${inserted.color_name}`);
console.log(`       product_id=${inserted.product_id} product_key=${inserted.product_key}`);
console.log(`       design_data type=${typeof inserted.design_data} version=${inserted.design_data?.version}`);
console.log('');

// Round-trip read
const readResp = await fetch(
  `${url}/rest/v1/user_designs?id=eq.${inserted.id}&select=*`,
  {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  },
);
const [readRow] = JSON.parse(await readResp.text());
if (!readRow) {
  console.error('[FAIL] read-back returned nothing');
  process.exit(1);
}
console.log(`[PASS] READ-BACK -> design_name="${readRow.design_name}" supplier_product_code=${readRow.supplier_product_code}`);

// Cleanup
const delResp = await fetch(`${url}/rest/v1/user_designs?id=eq.${inserted.id}`, {
  method: 'DELETE',
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!delResp.ok) {
  console.error(`[WARN] cleanup DELETE returned ${delResp.status} — row left in table`);
} else {
  console.log(`[PASS] CLEANUP -> row deleted`);
}

// Negative control: confirm the OLD payload would actually fail.
console.log('');
console.log('Negative control: inserting OLD-shape payload to confirm bug repro...');
const badRow = {
  ...row,
  session_id: `${sessionId}-bad`,
  view_name: 'Wrap',
  product_template_id: null,
  variant_id: null,
};
const badResp = await fetch(`${url}/rest/v1/user_designs`, {
  method: 'POST',
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },
  body: JSON.stringify(badRow),
});
const badBody = await badResp.text();
if (badResp.ok) {
  console.error('[FAIL] OLD payload was accepted — schema may have unexpectedly added these columns');
  // Cleanup the unexpected row
  const [accidentally] = JSON.parse(badBody);
  if (accidentally?.id) {
    await fetch(`${url}/rest/v1/user_designs?id=eq.${accidentally.id}`, {
      method: 'DELETE',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
  }
  process.exit(1);
}
console.log(`[PASS] OLD payload rejected as expected -> HTTP ${badResp.status}`);
console.log(`       Server said: ${badBody.slice(0, 300)}`);

console.log('');
console.log('All checks passed.');
