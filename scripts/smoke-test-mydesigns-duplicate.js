/**
 * Smoke test for the corrected CustomerDesigns duplicate payload —
 * proves both v1 and v2 duplicate inserts pass the schema check, and
 * re-runs the OLD broken payload as a negative control to confirm
 * PostgREST still rejects it (same bug class as PR #15).
 *
 * Run: node scripts/smoke-test-mydesigns-duplicate.js
 */

import { config } from 'dotenv';
config();

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
};

async function insertAndCleanup(row, label) {
  const insertResp = await fetch(`${url}/rest/v1/user_designs`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  const text = await insertResp.text();
  if (!insertResp.ok) {
    console.log(`[FAIL] ${label} -> HTTP ${insertResp.status}: ${text.slice(0, 200)}`);
    return false;
  }
  const [inserted] = JSON.parse(text);
  console.log(`[PASS] ${label} -> id=${inserted.id} sup=${inserted.supplier_product_code} pk=${inserted.product_key}`);
  // Cleanup
  await fetch(`${url}/rest/v1/user_designs?id=eq.${inserted.id}`, {
    method: 'DELETE',
    headers,
  });
  return true;
}

const sessionPrefix = `smoke-dup-${Date.now()}`;

// v2 duplicate — Laltex design
const v2Row = {
  user_id: null,
  session_id: `${sessionPrefix}-v2`,
  design_name: 'Boom 2 (Copy)',
  design_data: { version: '5.3.0', objects: [] },
  thumbnail_url: null,
  color_code: 'MG0192AM',
  color_name: 'Amber',
  print_area: 'Wrap',
  supplier_product_code: 'MG0192',
};

// v1 duplicate — catalog design
const v1Row = {
  user_id: null,
  session_id: `${sessionPrefix}-v1`,
  design_name: 'May test 1 (Copy)',
  design_data: { version: '5.3.0', objects: [] },
  thumbnail_url: null,
  color_code: '#000000',
  color_name: 'Black',
  print_area: 'Front Print',
  product_id: null,
  product_key: 'octopus-mini',
};

const v2Ok = await insertAndCleanup(v2Row, 'v2 duplicate (Laltex)');
const v1Ok = await insertAndCleanup(v1Row, 'v1 duplicate (catalog)');

// Negative control: the OLD broken payload (product_template_id etc.)
console.log('');
console.log('Negative control: old broken duplicate payload...');
const oldRow = {
  user_id: null,
  session_id: `${sessionPrefix}-old`,
  product_template_id: null,
  variant_id: null,
  design_name: 'Old shape (Copy)',
  design_data: { version: '5.3.0', objects: [] },
  thumbnail_url: null,
  view_name: 'Wrap',
  product_key: 'octopus-mini',
  color_code: '#000000',
  color_name: 'Black',
  print_area: 'Front',
  is_public: false,
};
const oldResp = await fetch(`${url}/rest/v1/user_designs`, {
  method: 'POST',
  headers: { ...headers, Prefer: 'return=representation' },
  body: JSON.stringify(oldRow),
});
const oldText = await oldResp.text();
let negativeOk = false;
if (oldResp.ok) {
  console.error('[FAIL] OLD payload was accepted — schema may have changed unexpectedly');
  const [accidental] = JSON.parse(oldText);
  if (accidental?.id) {
    await fetch(`${url}/rest/v1/user_designs?id=eq.${accidental.id}`, {
      method: 'DELETE',
      headers,
    });
  }
} else {
  console.log(`[PASS] OLD payload rejected as expected -> HTTP ${oldResp.status}`);
  console.log(`       Server said: ${oldText.slice(0, 240)}`);
  negativeOk = true;
}

const allOk = v2Ok && v1Ok && negativeOk;
console.log('');
console.log(allOk ? 'All checks passed.' : 'FAILURES PRESENT — see log above');
process.exit(allOk ? 0 : 1);
