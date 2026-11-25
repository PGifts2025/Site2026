// Owner-approved spelling corrections for supplier text — CLAUDE.md §69.
//
// The Laltex feed overwrites name/title/description/web_description on
// every nightly sync, so a hand edit to supplier_products is undone by
// morning. Corrections live in public.supplier_text_corrections as
// literal find -> replace pairs per product + field, and the sync applies
// them to each row BEFORE the upsert, so the stored text is always right.
//
// Rules (both make a correction safe to leave in place forever):
//  - literal, case-sensitive find; every occurrence is replaced;
//  - skipped when the field already contains the replacement, so if the
//    supplier fixes the typo themselves nothing gets doubled
//    ("Russel Full" -> "Russell Full" never becomes "Russelll").

export const CORRECTABLE_FIELDS = ['name', 'title', 'description', 'web_description'];

/** Map<code, Array<{field, find, replace_with}>> from table rows. */
export function indexCorrections(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (!r?.supplier_product_code || !CORRECTABLE_FIELDS.includes(r.field) || !r.find) continue;
    if (!map.has(r.supplier_product_code)) map.set(r.supplier_product_code, []);
    map.get(r.supplier_product_code).push(r);
  }
  return map;
}

/** Applies this product's corrections to `row` in place. Returns how many fields changed. */
export function applyTextCorrections(row, index) {
  const list = row && index?.get(row.supplier_product_code);
  if (!list) return 0;
  let changed = 0;
  for (const { field, find, replace_with: replacement } of list) {
    const text = row[field];
    if (typeof text !== 'string' || !text.includes(find) || text.includes(replacement)) continue;
    row[field] = text.split(find).join(replacement);
    changed += 1;
  }
  return changed;
}

/** Reads the whole (small) corrections table with the service role. */
export async function fetchTextCorrections({ supabaseUrl, serviceRoleKey }) {
  const r = await fetch(
    `${supabaseUrl}/rest/v1/supplier_text_corrections?select=supplier_product_code,field,find,replace_with&limit=10000`,
    { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } },
  );
  if (!r.ok) throw new Error(`supplier_text_corrections: HTTP ${r.status}`);
  return indexCorrections(await r.json());
}
