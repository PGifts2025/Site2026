/**
 * Smoke test for the session 9 position-picker round-trip:
 *
 *   1. INSERT a user_designs row with the new composite print_area
 *      format ("Front Chest|200x300mm|FTRAN05") and confirm PostgREST
 *      accepts it.
 *   2. INSERT a quote_items row with the new structured print_areas
 *      jsonb payload and confirm the column round-trips it.
 *   3. Negative-control: insert with a malformed composite (extra
 *      pipes) — should still land cleanly; downstream restore
 *      gracefully falls back to position-name-only.
 *   4. Clean up.
 *
 * Service-role bypasses RLS — same pattern as smoke-test-designer-v2-save.js
 * (session 8 PR #15). Tests the column types + persistence layer; does
 * NOT exercise the UI restore (that needs Dave's auth + browser).
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

const cleanup = [];

async function insertRow(table, row) {
  const resp = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
  const [inserted] = JSON.parse(text);
  cleanup.push({ table, id: inserted.id });
  return inserted;
}

async function cleanupAll() {
  for (const { table, id } of cleanup) {
    await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, {
      method: 'DELETE',
      headers,
    });
  }
}

function deepEqualSelections(a, b) {
  if (!a || !b) return false;
  if (!Array.isArray(a.selections) || !Array.isArray(b.selections)) return false;
  if (a.selections.length !== b.selections.length) return false;
  return a.selections.every((s, i) => {
    const o = b.selections[i];
    return (
      s.position === o.position &&
      s.area === o.area &&
      s.type === o.type &&
      s.class === o.class &&
      s.num_colours === o.num_colours &&
      Number(s.unit_price) === Number(o.unit_price)
    );
  });
}

let failed = false;
try {
  // 1. user_designs with composite print_area
  console.log('=== 1. user_designs composite print_area ===');
  const sessionId = `smoke-pos-picker-${Date.now()}`;
  const composite = 'Front Chest|200x300mm|FTRAN05';
  const userDesign = await insertRow('user_designs', {
    user_id: null,
    session_id: sessionId,
    design_name: 'Position picker smoke',
    supplier_product_code: 'AF0001',
    print_area: composite,
    color_code: 'BLAC',
    color_name: 'Black',
    design_data: { version: '5.3.0', objects: [] },
    thumbnail_url: null,
  });
  if (userDesign.print_area !== composite) {
    console.error(`[FAIL] composite print_area mangled: got "${userDesign.print_area}"`);
    failed = true;
  } else {
    console.log(`[PASS] composite stored verbatim: "${userDesign.print_area}"`);
  }

  // 2. quote_items with structured print_areas jsonb
  console.log('\n=== 2. quote_items structured print_areas jsonb ===');
  const quote = await insertRow('quotes', {
    quote_number: `QT-SMOKE-${Date.now().toString(36).toUpperCase()}`,
    customer_id: null,
    status: 'draft',
    total_amount: 100.00,
  });
  const selectionsPayload = {
    selections: [
      { position: 'Front Chest', area: '200x300mm', type: 'Transfer Print (300x200)', class: 'FTRAN05', num_colours: 2, unit_price: 2.2 },
      { position: 'Back',        area: '150x150mm', type: 'Embroidery Large (150x150)', class: 'FEMB042', num_colours: 1, unit_price: 7.7 },
    ],
  };
  const quoteItem = await insertRow('quote_items', {
    quote_id: quote.id,
    product_id: null,
    product_name: 'Premier Bib Colour Apron (smoke)',
    quantity: 25,
    unit_price: 9.92,
    color: 'Black',
    print_areas: selectionsPayload,
    notes: 'Smoke test: session 9 picker',
  });
  if (!deepEqualSelections(quoteItem.print_areas, selectionsPayload)) {
    console.error('[FAIL] jsonb round-trip semantically differs');
    console.error('  expected:', JSON.stringify(selectionsPayload));
    console.error('  got     :', JSON.stringify(quoteItem.print_areas));
    failed = true;
  } else {
    console.log(`[PASS] jsonb round-trip identical (${selectionsPayload.selections.length} selections, fields preserved)`);
  }

  // 3. Malformed composite — extra pipes
  console.log('\n=== 3. Defensive: malformed composite still lands ===');
  const weird = 'Front Chest|200x300mm|FTRAN05|extra|stuff';
  const userDesign2 = await insertRow('user_designs', {
    user_id: null,
    session_id: `${sessionId}-weird`,
    design_name: 'Malformed composite',
    supplier_product_code: 'AF0001',
    print_area: weird,
    design_data: { version: '5.3.0', objects: [] },
  });
  if (userDesign2.print_area !== weird) {
    console.error(`[FAIL] malformed string mangled: got "${userDesign2.print_area}"`);
    failed = true;
  } else {
    console.log(`[PASS] malformed string stored verbatim ("${weird}"); restore parses first 3 segments and ignores rest`);
  }

  if (!failed) console.log('\nAll checks passed.');
} finally {
  await cleanupAll();
  console.log('\nCleanup done.');
}
process.exit(failed ? 1 : 0);
