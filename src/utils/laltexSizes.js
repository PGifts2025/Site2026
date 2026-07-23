/**
 * Garment size ordering + short labels for Laltex clothing.
 *
 * Laltex ships one SKU per colour x size pair; sizes arrive as long names
 * ("Xtra Small", "Small", ... "2Xtra Large") or kids age bands ("Age 3-4").
 * Alphabetical order renders "2XL, L, M, S, XL, XS" which reads as broken, so
 * everything sorts against the explicit canonical order below and falls back
 * to feed order for anything unrecognised.
 *
 * Shared by normaliseProduct (pivoting the variant matrix) and
 * LaltexProductView (the size selector). The stored size_breakdown keys are
 * the EXACT feed size names (so the team can match them to Laltex when placing
 * the supplier PO); only the on-screen label is shortened.
 */

// Canonical adult order, most-first. Keys are normalised (lowercased, trimmed).
// Multiple spellings map to the same rank.
const ADULT_ORDER = [
  ['xxs', 'xx small', 'xxsmall'],
  ['xs', 'xtra small', 'extra small', 'x small', 'x-small'],
  ['s', 'small'],
  ['m', 'medium'],
  ['l', 'large'],
  ['xl', 'xtra large', 'extra large', 'x large', 'x-large'],
  ['2xl', 'xxl', '2xtra large', '2x large', 'xx large'],
  ['3xl', 'xxxl', '3xtra large', '3x large'],
  ['4xl', '4xtra large'],
  ['5xl', '5xtra large'],
  ['6xl', '6xtra large'],
];

const ADULT_RANK = (() => {
  const m = new Map();
  ADULT_ORDER.forEach((aliases, i) => aliases.forEach((a) => m.set(a, i)));
  return m;
})();

const norm = (s) => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Sort key for a size name. Lower sorts first.
 *   - Adult sizes: their canonical rank (0..10).
 *   - "One Size" / "OS": before adult sizes.
 *   - Kids "Age N-M": grouped after adult, ordered by the first age number.
 *   - Unrecognised: after everything, in feed order (feedIndex).
 */
export function sizeSortKey(sizeName, feedIndex = 0) {
  const n = norm(sizeName);
  if (!n) return 3000 + feedIndex;
  if (n === 'one size' || n === 'os' || n === 'onesize') return -1;
  if (ADULT_RANK.has(n)) return ADULT_RANK.get(n);
  const age = n.match(/age\s*(\d+)/);
  if (age) return 1000 + Number(age[1]);
  return 2000 + feedIndex;
}

/** Sort an array of size names into garment order, stable on feed order. */
export function sortSizes(names) {
  return names
    .map((name, i) => ({ name, i }))
    .sort((a, b) => sizeSortKey(a.name, a.i) - sizeSortKey(b.name, b.i) || a.i - b.i)
    .map((x) => x.name);
}

// Short display labels for the common long adult names. Anything else shows
// its own (trimmed) name.
const LABELS = new Map([
  ['xxs', 'XXS'], ['xx small', 'XXS'],
  ['xs', 'XS'], ['xtra small', 'XS'], ['extra small', 'XS'], ['x small', 'XS'],
  ['s', 'S'], ['small', 'S'],
  ['m', 'M'], ['medium', 'M'],
  ['l', 'L'], ['large', 'L'],
  ['xl', 'XL'], ['xtra large', 'XL'], ['extra large', 'XL'], ['x large', 'XL'],
  ['2xl', '2XL'], ['xxl', '2XL'], ['2xtra large', '2XL'], ['xx large', '2XL'],
  ['3xl', '3XL'], ['xxxl', '3XL'], ['3xtra large', '3XL'],
  ['4xl', '4XL'], ['4xtra large', '4XL'],
  ['5xl', '5XL'], ['6xl', '6XL'],
]);

/** Short on-screen label for a size (e.g. "Xtra Small" -> "XS"). Falls back to
 *  the original name (e.g. "Age 3-4", "One Size"). */
export function sizeLabel(sizeName) {
  return LABELS.get(norm(sizeName)) || String(sizeName ?? '').trim();
}

/**
 * Render a stored size_breakdown ({"Small":5,"Medium":10}) as a compact
 * one-line string with short labels: "S: 5, M: 10". Keys are already in
 * garment order (inserted ordered at write time). Returns '' for null/empty.
 */
export function formatSizeBreakdown(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return '';
  const entries = Object.entries(breakdown).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return '';
  return entries.map(([name, q]) => `${sizeLabel(name)}: ${q}`).join(', ');
}
