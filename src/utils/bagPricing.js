/**
 * PGifts Direct BAG print pricing — a build-up-from-supplier-cost model.
 *
 * WHY A THIRD MODEL
 * -----------------
 * Direct clothing reads finished sell totals (catalog_print_pricing.total_sell_price,
 * PR #88). Laltex builds from margined components. Bags are different again: we
 * hold the SUPPLIER unit cost and build up, applying margin at the very end:
 *
 *   cost_subtotal = unit_cost x qty
 *                 + screen_charge        (screen print only: £15 x colours)
 *                 + second_side_charge   (screen print only: £0.20 x qty, if chosen)
 *                 + shipping             (flat per order, by qty band)
 *   sell_total    = cost_subtotal x (1 + margin)
 *   unit_price    = sell_total / qty
 *
 * There is NO separate underbase screen charge — the Black cost tables already
 * carry the underbase in their unit cost (Black is 30p/unit above Natural at
 * every band). The second side adds NO extra screens. DTF has no screen charge
 * and no second-side charge (its two-sided pricing is baked into the cost table).
 *
 * DATA vs POLICY
 * --------------
 * PER-BAG DATA lives in the DB (bag_print_pricing cost rows + bag_shipping
 * bands), so the next bag is a pure data seed. The SHARED POLICY below (margin
 * schedule, £15/colour screen charge, £0.20 second side, 5000 cap) is the same
 * across bags and lives here in code. If a future bag ever needs different
 * policy, revisit — but the cost tables are what vary bag to bag.
 *
 * Fluorescent/metallic inks and the £10 screen-wash charge are deliberately out
 * of scope (Dave handles those by phone).
 */

// ---- shared policy (same for every bag) ----
export const BAG_SCREEN_CHARGE_PER_COLOUR = 15.0;
export const BAG_SECOND_SIDE_PER_UNIT = 0.20;
export const BAG_MAX_QTY = 5000;
export const BAG_MIN_COLOURS = 1;
export const BAG_MAX_COLOURS = 10;
export const BAG_DTF_SIZES = ['A4', 'A3'];
export const BAG_DTF_SIDES = [1, 2];

/**
 * Margin for a bag order.
 *
 * Default schedule: 40% under 1000 units, 35% at 1000 and above (the 12oz
 * Recycled Canvas). A bag may instead carry a per-product FLAT margin
 * (catalog_products.bag_flat_margin) that applies at every quantity — e.g. the
 * 5oz Mini Cotton Bag is flat 40% with a 1000-unit quote ceiling above which we
 * don't quote at all. Pass that flat value through `flatMargin`; null/undefined
 * falls back to the default schedule so the 12oz is untouched.
 */
export const bagMargin = (qty, flatMargin = null) => {
  if (flatMargin != null) return Number(flatMargin);
  return Number(qty) < 1000 ? 0.40 : 0.35;
};

const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

const inBand = (row, qty) =>
  (row.min_quantity == null || qty >= row.min_quantity) &&
  (row.max_quantity == null || qty <= row.max_quantity);

/**
 * Supplier unit cost for the selection, from the loaded bag_print_pricing rows.
 * Screen: matched on (method, colour_group, qty band, colour_count).
 * DTF:    matched on (method, colour_group, qty band, dtf_size, dtf_sides).
 * Returns null when no row matches.
 */
export function findBagUnitCost(rows, { method, colourGroup, qty, colours, dtfSize, dtfSides }) {
  if (!Array.isArray(rows)) return null;
  const q = Number(qty);
  const row = rows.find((r) => {
    if (r.print_method !== method) return false;
    if (r.colour_group !== colourGroup) return false;
    if (!inBand(r, q)) return false;
    if (method === 'screen') return Number(r.colour_count) === Number(colours);
    if (method === 'dtf') return r.dtf_size === dtfSize && Number(r.dtf_sides) === Number(dtfSides);
    return false;
  });
  return row ? Number(row.unit_cost) : null;
}

/** Flat shipping charge for the order quantity, from the loaded bag_shipping rows. */
export function findBagShipping(shippingRows, qty) {
  if (!Array.isArray(shippingRows)) return null;
  const q = Number(qty);
  const row = shippingRows.find((r) => inBand(r, q));
  return row ? Number(row.charge) : null;
}

/**
 * Finished per-unit sell price for a bag decoration selection, or null if the
 * selection can't be priced (missing cost/shipping row).
 *
 * @param {object} opts
 * @param {'screen'|'dtf'} opts.method
 * @param {'natural'|'black'} opts.colourGroup
 * @param {number} opts.qty
 * @param {number} [opts.colours]     screen only, 1-10
 * @param {boolean} [opts.secondSide] screen only
 * @param {number} [opts.secondSideCost] screen only — per-unit second-side COST.
 *   Defaults to BAG_SECOND_SIDE_PER_UNIT (£0.20). Some bags charge more on the
 *   dearer colour group because the second side needs its own underbase (8oz
 *   Canvas: coloured = £0.24). Sourced per (product, colour_group) from
 *   bag_group_second_side; the three earlier bags carry no rows and take £0.20.
 * @param {'A4'|'A3'} [opts.dtfSize]  dtf only
 * @param {1|2} [opts.dtfSides]       dtf only
 * @param {Array} opts.priceRows      bag_print_pricing rows for the product
 * @param {Array} opts.shippingRows   bag_shipping rows for the product
 */
export function bagUnitPrice(opts) {
  const { method, colourGroup, qty, colours, secondSide, secondSideCost, dtfSize, dtfSides, priceRows, shippingRows, flatMargin = null } = opts;
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) return null;

  const unitCost = findBagUnitCost(priceRows, { method, colourGroup, qty: q, colours, dtfSize, dtfSides });
  const shipping = findBagShipping(shippingRows, q);
  if (unitCost == null || shipping == null) return null;

  // Null/undefined (no per-group override) => £0.20 default. Guard explicitly:
  // Number(null) is 0, which is finite, so a bare Number.isFinite check would
  // wrongly zero the second-side charge for every default-rate group.
  const ssCost = (secondSideCost != null && Number.isFinite(Number(secondSideCost)))
    ? Number(secondSideCost)
    : BAG_SECOND_SIDE_PER_UNIT;

  let decoration = 0;
  if (method === 'screen') {
    decoration += BAG_SCREEN_CHARGE_PER_COLOUR * Number(colours);          // £15 x colours, once
    if (secondSide) decoration += ssCost * q;                              // per-unit second side, no extra screens
  }
  // DTF: no screen charge, no second-side charge (baked into the cost table).

  const costSubtotal = unitCost * q + decoration + shipping;
  const sellTotal = costSubtotal * (1 + bagMargin(q, flatMargin));
  return round2(sellTotal / q);
}

/**
 * Map a product colour to its cost group, RESOLVED AGAINST THE GROUPS THE
 * PRODUCT ACTUALLY SEEDS. Bags cost by group, not by individual swatch, and the
 * same swatch name maps to different groups on different bags — most notably
 * 'white':
 *   - 5oz Mini / 5oz Recycled (groups natural + white): White -> 'white'
 *   - 8oz Canvas (groups natural + coloured): White -> 'natural' (Natural and
 *     White share the cheaper table; the five colours take the dearer one)
 * A pure function of the colour name cannot satisfy both, so the caller passes
 * `availableGroups` — a Set of the colour_group values present in the product's
 * bag_print_pricing rows (derive with bagAvailableGroups()). Resolution:
 *   natural -> 'natural' (if present)
 *   white   -> 'white' if present, else 'natural' if present, else the dearer group
 *   other   -> the dearer group present ('coloured', else 'black')
 * "Dearer group" is 'coloured' if seeded, else 'black'.
 *
 * When `availableGroups` is omitted (legacy callers / no product context) it
 * falls back to the original pure mapping: natural->natural, white->white,
 * else->black. Passing the product's groups is strongly preferred for bags.
 *
 * The natural/white cost SWAP (natural dearer than white on the 5oz bags) lives
 * in the seeded cost tables, not here — this function only routes a swatch to a
 * group name.
 */
export function bagColourGroup(colourNameOrCode, availableGroups = null) {
  const n = String(colourNameOrCode ?? '').toLowerCase().trim();

  if (!availableGroups) {
    // Legacy pure mapping — no product context.
    if (n === 'natural') return 'natural';
    if (n === 'white') return 'white';
    return 'black';
  }

  const dearer = availableGroups.has('coloured') ? 'coloured'
    : availableGroups.has('black') ? 'black'
    : null;

  if (n === 'natural') return availableGroups.has('natural') ? 'natural' : (dearer ?? 'coloured');
  if (n === 'white') {
    if (availableGroups.has('white')) return 'white';
    if (availableGroups.has('natural')) return 'natural';
    return dearer ?? 'coloured';
  }
  // Any other colour -> the dearer group the product seeds.
  return dearer ?? (availableGroups.has('white') ? 'white' : 'natural');
}

/** Set of colour_group values present in a product's bag_print_pricing rows. */
export function bagAvailableGroups(priceRows) {
  return new Set((Array.isArray(priceRows) ? priceRows : []).map((r) => r.colour_group));
}
