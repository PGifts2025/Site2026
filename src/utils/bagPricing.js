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

/** Margin: 40% under 1000 units, 35% at 1000 and above. */
export const bagMargin = (qty) => (Number(qty) < 1000 ? 0.40 : 0.35);

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
 * @param {'A4'|'A3'} [opts.dtfSize]  dtf only
 * @param {1|2} [opts.dtfSides]       dtf only
 * @param {Array} opts.priceRows      bag_print_pricing rows for the product
 * @param {Array} opts.shippingRows   bag_shipping rows for the product
 */
export function bagUnitPrice(opts) {
  const { method, colourGroup, qty, colours, secondSide, dtfSize, dtfSides, priceRows, shippingRows } = opts;
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) return null;

  const unitCost = findBagUnitCost(priceRows, { method, colourGroup, qty: q, colours, dtfSize, dtfSides });
  const shipping = findBagShipping(shippingRows, q);
  if (unitCost == null || shipping == null) return null;

  let decoration = 0;
  if (method === 'screen') {
    decoration += BAG_SCREEN_CHARGE_PER_COLOUR * Number(colours);          // £15 x colours, once
    if (secondSide) decoration += BAG_SECOND_SIDE_PER_UNIT * q;            // £0.20/unit, no extra screens
  }
  // DTF: no screen charge, no second-side charge (baked into the cost table).

  const costSubtotal = unitCost * q + decoration + shipping;
  const sellTotal = costSubtotal * (1 + bagMargin(q));
  return round2(sellTotal / q);
}

/**
 * Map a product colour to its cost group. Bags cost by group, not by individual
 * swatch. Natural (and any exempt/natural-like) -> 'natural'; everything else
 * -> 'black' (the underbase group). Today this bag offers exactly Natural +
 * Black, but the mapping is defensive for future bags with more swatches — any
 * unrecognised colour falls into the dearer (black/underbase) group, the safe
 * direction. Unknown groups should be surfaced to Dave, not silently priced.
 */
export function bagColourGroup(colourNameOrCode) {
  const n = String(colourNameOrCode ?? '').toLowerCase().trim();
  if (n === 'natural') return 'natural';
  return 'black';
}
