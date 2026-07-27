#!/usr/bin/env node
/** PRE-IMPLEMENTATION PROBE (read-only) for the white-base pricing change.
 *  (1) exact screen-print method identifiers in the Laltex CLOTHING feed
 *  (2) every colour name that could plausibly be white/natural
 *  (3) max colour count per screen method (tier ceiling + fallback sizing) */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, Authorization: `Bearer ${key}` };
const get = async (q) => (await fetch(`${url}/rest/v1/${q}`, { headers: h })).json();

const all = [];
for (let off = 0; ; off += 1000) {
  const page = await get(`supplier_products?select=supplier_product_code,name,category,sub_category,items,print_details&is_retired=eq.false&limit=1000&offset=${off}&order=supplier_product_code.asc`);
  if (!page.length) break; all.push(...page); if (page.length < 1000) break;
}
const clothing = all.filter((r) => r.category === 'Clothing');
console.log(`non-retired: ${all.length} | category='Clothing': ${clothing.length}`);

// ---------- (1) method identifiers ----------
console.log('\n=========== (1) PRINT METHODS ON CLOTHING ===========');
const pairs = new Map(); // "print_type||print_class" -> {count, products:Set, maxCols:Set}
for (const r of clothing) {
  for (const p of (r.print_details || [])) {
    const k = `${p.print_type}||${p.print_class}`;
    if (!pairs.has(k)) pairs.set(k, { n: 0, prods: new Set(), maxCols: new Set(), tierCols: new Set() });
    const e = pairs.get(k);
    e.n += 1; e.prods.add(r.supplier_product_code); e.maxCols.add(p.max_colours);
    (p.print_price || []).forEach((t) => e.tierCols.add(t.num_colours));
  }
}
console.log('print_type || print_class            rows  products  max_colours  tier num_colours');
[...pairs.entries()].sort((a, b) => b[1].n - a[1].n).forEach(([k, e]) => {
  console.log(`${k.padEnd(52)} ${String(e.n).padStart(4)} ${String(e.prods.size).padStart(8)}   ${[...e.maxCols].join(',').padEnd(10)} ${[...e.tierCols].sort((x, y) => x - y).join(',')}`);
});

// ---------- (2) candidate white/natural colour names ----------
console.log('\n=========== (2) CANDIDATE WHITE / NATURAL COLOUR NAMES ===========');
const norm = (s) => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
const isScreenish = (p) => /spot print|screen/i.test(`${p.print_type} ${p.print_class}`);
const screenClothing = clothing.filter((r) => (r.print_details || []).some(isScreenish));
const names = new Map();
for (const r of screenClothing) {
  for (const i of (r.items || [])) {
    if (!i.item_colour) continue;
    const n = norm(i.item_colour);
    if (!names.has(n)) names.set(n, { raw: new Set(), prods: new Set() });
    names.get(n).raw.add(i.item_colour.trim());
    names.get(n).prods.add(r.supplier_product_code);
  }
}
console.log(`distinct normalised colour names on screen-printable clothing: ${names.size}`);
const CANDIDATE = /white|natural|ecru|ivory|cream|bone|oatmeal|oat|raw|off.?white|optic|arctic|snow|chalk|milk|vanilla|linen|stone|sand|antique|unbleached|blanc/;
const cands = [...names.entries()].filter(([n]) => CANDIDATE.test(n)).sort((a, b) => a[0].localeCompare(b[0]));
console.log(`\ncandidates matching the white/natural family: ${cands.length}\n`);
console.log('normalised name'.padEnd(34) + 'products  raw variants seen');
for (const [n, meta] of cands) {
  console.log(`${n.padEnd(34)}${String(meta.prods.size).padStart(6)}    ${[...meta.raw].join(' / ')}`);
}
console.log('\n--- EXACT matches to the two rule values (auto-exempt) ---');
console.log([...names.keys()].filter((n) => n === 'white' || n === 'natural').join(', ') || '(none)');

// ---------- (3) tier ceiling ----------
console.log('\n=========== (3) COLOUR-COUNT CEILING (screen methods on clothing) ===========');
const ceil = new Map();
for (const r of screenClothing) {
  for (const p of (r.print_details || [])) {
    if (!isScreenish(p)) continue;
    const cols = [...new Set((p.print_price || []).map((t) => t.num_colours))].sort((a, b) => a - b);
    const maxTier = cols.length ? Math.max(...cols) : null;
    const k = `${p.print_type}||max_colours=${p.max_colours}||tierMax=${maxTier}`;
    ceil.set(k, (ceil.get(k) || 0) + 1);
  }
}
[...ceil.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, c]) => console.log(`  ${String(c).padStart(5)}  ${k}`));
