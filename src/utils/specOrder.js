// Display order for the Specifications tab (CLAUDE.md §66.4). JSONB
// stores object keys shortest-first, so catalog_product_specifications
// comes back in an arbitrary-looking order ("Made in" before "Battery").
// Known labels are shown in this order; anything else follows, in the
// order it arrived. Shared by ProductDetailPage and the prerender.

const SPEC_ORDER = [
  'Brand',
  // What it is / headline capability
  'Battery', 'Charges', 'Fast charging', 'Maximum output', 'Cable length',
  'Countries', 'Plugs',
  // Connections
  'Connectors', 'Inputs', 'Input', 'Outputs', 'Charging ports',
  'Charging technology', 'Data transfer', 'In-car use',
  'Pass-through charging', 'Fast-charge indicator', 'Light', 'Compatibility', 'Safety',
  // Materials
  'Material', 'Recycled content', 'Carbon footprint', 'Packaging',
  // Physical + branding
  'Dimensions', 'Weight', 'Print area',
  // Small print
  'Warranty', 'Made in',
];

const rank = new Map(SPEC_ORDER.map((k, i) => [k.toLowerCase(), i]));

/** Object.entries(specs), sorted for display. Unknown keys go last, stable. */
export function orderedSpecEntries(specs) {
  if (!specs || typeof specs !== 'object') return [];
  return Object.entries(specs)
    .map((entry, i) => ({ entry, i, r: rank.get(String(entry[0]).toLowerCase()) ?? SPEC_ORDER.length }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(({ entry }) => entry);
}
