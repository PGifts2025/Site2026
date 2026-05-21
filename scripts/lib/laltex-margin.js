/**
 * Default Laltex margin schedule + applyMarginsInPlace.
 *
 * Schedule v2 (CLAUDE.md §57 — raised May 2026 for business viability;
 * v1 was 22/20/18% across 3 tiers):
 *   1-99    units → 35%
 *   100-249 units → 30%
 *   250-499 units → 25%
 *   500-999 units → 22.5%
 *   1000+   units → 20%
 *
 * Applied per pricing-tier by tier.min_qty, NOT by the actual order
 * quantity. So a tier covering min_qty=25, max_qty=49 always gets 22%
 * regardless of where in that range the customer falls.
 *
 * Dave's D1 decision (Task 8 Q1, locked): margin applies to the ALL-IN
 * cost. Concretely:
 *   - product_pricing tier sell_price = price × (1 + margin)
 *     (NO delivery, NO setup. Delivery is read-time per B1-A.)
 *   - print_details print_price tier sell_price =
 *       (raw_print + setup_amortised + extra_colour_setup_amortised)
 *       × (1 + margin)
 *
 * The setup component is amortised over tier.min_qty (NOT the actual
 * customer quantity) — this is consistent with how PGifts Direct
 * prices were baked, and produces a small step at tier boundaries.
 * Documented as a known-and-accepted limitation in CLAUDE.md §46.
 *
 * Bump DEFAULT_SCHEDULE_VERSION whenever the schedule changes. The
 * recompute-laltex-margins script writes this into
 * supplier_products.margin_default_schedule_version so a drift query
 * is a single SELECT.
 */

export const DEFAULT_SCHEDULE_VERSION = 2;

const DEFAULT_SCHEDULE = [
  { min_qty: 0,    margin_pct: 0.35 },   // 1-99
  { min_qty: 100,  margin_pct: 0.30 },   // 100-249
  { min_qty: 250,  margin_pct: 0.25 },   // 250-499
  { min_qty: 500,  margin_pct: 0.225 },  // 500-999
  { min_qty: 1000, margin_pct: 0.20 },   // 1000+
];

export function defaultMarginForTierMinQty(minQty) {
  if (!Number.isFinite(minQty)) return DEFAULT_SCHEDULE[0].margin_pct;
  let result = DEFAULT_SCHEDULE[0].margin_pct;
  for (const band of DEFAULT_SCHEDULE) {
    if (minQty >= band.min_qty) result = band.margin_pct;
  }
  return result;
}

export function scheduleMarginForTier(minQty, overridePct) {
  if (overridePct != null && Number.isFinite(Number(overridePct))) {
    return Number(overridePct);
  }
  return defaultMarginForTierMinQty(minQty);
}

/**
 * Apply margin to product_pricing[] and print_details[].print_price[]
 * in place. Mutates the passed arrays.
 *
 * For product_pricing tiers:
 *   sell_price = round(price × (1 + margin), 2)
 * Delivery is NOT included here — added at read time by
 * LaltexProductView and slimProduct using laltex-delivery.js.
 *
 * For print tiers:
 *   setup_amortised = setup_charge / tier.min_qty
 *   extra_setup_am  = max(num_colours-1,0) × extra_colour_setup_charge / tier.min_qty
 *   all_in_raw      = tier.price + setup_amortised + extra_setup_am
 *   sell_price      = round(all_in_raw × (1 + margin), 4)
 *
 * Setup is INSIDE sell_price (margin applied to the all-in figure per
 * Dave's D1). Consumers MUST NOT add setup_charge separately when
 * computing per-position unit cost — see CLAUDE.md §46 R6.
 *
 * POA tiers and tiers missing required fields get sell_price=null,
 * margin_applied_pct=null. Read paths handle null gracefully (POA UX).
 *
 * @param {object} args
 * @param {Array}  args.productPricing  - mutated in place
 * @param {Array}  args.printDetails    - mutated in place
 * @param {number|null} args.overridePct - per-product override; null => schedule
 */
export function applyMarginsInPlace({ productPricing, printDetails, overridePct }) {
  // ---- product_pricing tiers ----
  if (Array.isArray(productPricing)) {
    for (const tier of productPricing) {
      if (!tier || typeof tier !== 'object') continue;
      if (tier.is_poa || tier.price == null || !Number.isFinite(Number(tier.price))) {
        tier.sell_price = null;
        tier.margin_applied_pct = null;
        continue;
      }
      const pct = scheduleMarginForTier(Number(tier.min_qty), overridePct);
      tier.sell_price = Number((Number(tier.price) * (1 + pct)).toFixed(2));
      tier.margin_applied_pct = pct;
    }
  }

  // ---- print_details[i].print_price[j] tiers ----
  if (Array.isArray(printDetails)) {
    for (const pd of printDetails) {
      if (!pd || typeof pd !== 'object') continue;
      const setup = Number.isFinite(Number(pd.setup_charge)) ? Number(pd.setup_charge) : 0;
      const extraSetup = Number.isFinite(Number(pd.extra_colour_setup_charge))
        ? Number(pd.extra_colour_setup_charge)
        : 0;
      const tiers = Array.isArray(pd.print_price) ? pd.print_price : [];
      for (const tier of tiers) {
        if (!tier || typeof tier !== 'object') continue;
        const tierMinQty = Number(tier.min_qty);
        const tierPrice = Number(tier.price);
        if (
          tier.is_poa
          || !Number.isFinite(tierPrice)
          || !Number.isFinite(tierMinQty)
          || tierMinQty <= 0
        ) {
          tier.sell_price = null;
          tier.margin_applied_pct = null;
          continue;
        }
        const pct = scheduleMarginForTier(tierMinQty, overridePct);
        const setupPerUnit = setup / tierMinQty;
        const numCols = Number(tier.num_colours);
        const extraColours = Math.max(0, (Number.isFinite(numCols) ? numCols : 1) - 1);
        const extraSetupPerUnit = extraColours > 0 ? (extraColours * extraSetup) / tierMinQty : 0;
        const allInRaw = tierPrice + setupPerUnit + extraSetupPerUnit;
        tier.sell_price = Number((allInRaw * (1 + pct)).toFixed(4));
        tier.margin_applied_pct = pct;
      }
    }
  }
}
