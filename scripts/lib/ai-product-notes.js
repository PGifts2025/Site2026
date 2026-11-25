// Owner-confirmed product notes for the AI assistant (CLAUDE.md §68).
// Reads public.ai_product_notes (service role) for the codes in a tool
// result and adds `notes` to the matching products, in place.
//
// FAILS SOFT: a missing table, network error or bad response just means no
// notes this turn — never a broken chat. Not cached: one small indexed
// read per tool call, and edits should reach Ava immediately.

export async function attachProductNotes(products, { supabaseUrl, serviceRoleKey }) {
  if (!Array.isArray(products) || products.length === 0 || !supabaseUrl || !serviceRoleKey) return products;
  const codes = [...new Set(products.map((p) => p?.supplier_product_code).filter(Boolean))];
  if (codes.length === 0) return products;
  try {
    const list = codes.map((c) => `"${String(c).replace(/"/g, '')}"`).join(',');
    const r = await fetch(
      `${supabaseUrl}/rest/v1/ai_product_notes?select=supplier_product_code,note&supplier_product_code=in.(${encodeURIComponent(list)})`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } },
    );
    if (!r.ok) return products;
    const rows = await r.json();
    const byCode = new Map(rows.map((n) => [n.supplier_product_code, n.note]));
    for (const p of products) {
      const note = p && byCode.get(p.supplier_product_code);
      if (note) p.notes = note;
    }
  } catch {
    // no notes this turn
  }
  return products;
}
