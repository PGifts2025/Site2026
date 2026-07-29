/**
 * Screen print white-base pricing (Laltex clothing) — flat base-print lookup.
 *
 * WHY THIS EXISTS
 * ---------------
 * Screen printing onto a dark garment needs an opaque white underbase laid
 * down first, so the colours on top stay vibrant. That base is a real print
 * cost: its own screen and its own pass on the press. Laltex do not charge for
 * it (their print price is keyed only on num_colours/num_position/min_qty with
 * no garment-colour dimension), so we add it ourselves.
 *
 * WHY A FLAT LOOKUP, NOT (colours + 1)
 * ------------------------------------
 * The original approach (PR #85) priced the base by looking the print tier up
 * at (colours + 1). That assumed Laltex's colour-step was a fair proxy for the
 * base cost. It is not: Laltex's colour ladder is NON-MONOTONIC — on TF0001 the
 * 1->2 step runs 8p, 20p, 13p, 6p, -2p, 5p across the quantity bands, going
 * negative at 500, which forced a floor that pinned the base to £0.00 there.
 * All 89 Laltex garments share that one erratic matrix. See
 * audit-base-pricing-source.md for the full derivation.
 *
 * This module instead adds a FLAT base-print cost, banded by quantity, taken
 * from Dave's own cost spreadsheet (the coloured-minus-white print delta on the
 * GD005 sheets). That delta is monotonic, always positive, and — verified
 * against the file — IDENTICAL across t-shirts, hoodies, sweatshirts and polos
 * (the print columns match; only the garment column differs), so one table
 * covers all four. Hi-vis's coloured/white print delta is £0.00 at every band,
 * confirming hi-vis takes no base.
 *
 * The base is a PRINT cost: it is added to the print portion and margined
 * exactly like any other print cost (never post-margin). It is additive, not a
 * tier shift, so there is no colour-count ceiling to fall off. It applies once
 * per print position.
 */

/**
 * Normalise a colour / sub-category name for comparison: lowercase, trimmed,
 * whitespace collapsed. Matches colourSwatches.js (PR #82) and the sub_category
 * normalisation elsewhere, so cross-supplier casing ("T-Shirts" vs "T-shirts")
 * cannot cause a miss.
 */
export const normaliseName = (s) => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
// Back-compat alias — some callers import normaliseColourName.
export const normaliseColourName = normaliseName;

/**
 * Colours that do NOT need a white base. Dave's rule: White, Natural and Arctic
 * White are exempt; everything else takes a base.
 *
 * DELIBERATELY NOT exempt: Natural Raw and Natural Stone — Dave confirms these
 * are tinted enough to need a base. Anything not listed here requires a base,
 * which is the safe direction (charge rather than absorb).
 */
export const BASE_EXEMPT_COLOURS = new Set(['white', 'natural', 'arctic white']);

/**
 * The four garment types that take a white base, by normalised `sub_category`.
 *
 * This is an EXPLICIT allow-list, deliberately NOT the `category === 'Clothing'`
 * gate that PR #85 used — that gate wrongly based AF0010 ("Tom Franks Hi Vis
 * Vest", category 'Clothing', sub_category 'Accessories'). Everything off this
 * list (hi-vis, headwear, softshell, coats, fleece, aprons, gloves, bags,
 * non-clothing) gets NO base by default. A new garment type defaults to no base
 * until deliberately added here — the safe direction.
 *
 * Values verified against the live feed: these four sub_category strings are
 * clean and consistent across both suppliers (laltex + pgifts-direct mirror);
 * the §47 normalisation already folded "T-Shirts" -> "T-shirts". Softshell,
 * Coat, Fleece etc. are garments but are intentionally OUT of scope per Dave's
 * four-type list.
 */
export const BASE_TAKING_SUBCATEGORIES = new Set(['t-shirts', 'polos', 'hoodies', 'sweatshirts']);

/**
 * Base-white PRINT COST per unit, banded by order quantity (in £, a COST — the
 * caller margins it like any other print cost). From the GD005 1-colour
 * coloured-minus-white print delta, which is garment-independent (§ audit).
 * Monotonic non-increasing, always positive: 36p / 20p / 20p / 13p / 14p / 14p.
 *
 * Bands use the same min_qty boundaries as Laltex's print tiers, so there is no
 * mismatch at tier edges. Quantities below 25 (below clothing MOQ) take the 25
 * value; 1000+ (incl. 2500/5000 tiers) take the 1000 value — the base cost is
 * flat at volume.
 */
export const BASE_PRINT_COST_BANDS = [
  { minQty: 25, cost: 0.36 },
  { minQty: 50, cost: 0.20 },
  { minQty: 100, cost: 0.20 },
  { minQty: 250, cost: 0.13 },
  { minQty: 500, cost: 0.14 },
  { minQty: 1000, cost: 0.14 },
];

/**
 * Print methods that lay ink through a screen and therefore need a white base
 * on dark fabric. Across all Laltex clothing this is exactly one method:
 * print_class 'FSCREEN1' / print_type 'Spot Print'. Embroidery (FEMB*) uses the
 * same thread regardless of colour; transfer / digital (FTRAN*, CMYK) carry
 * their own opacity — neither takes a base.
 */
export const SCREEN_PRINT_CLASSES = new Set(['FSCREEN1']);
export const SCREEN_PRINT_TYPES = new Set(['Spot Print']);

/** Is this print_details row a screen print? */
export function isScreenPrintRow(row) {
  if (!row) return false;
  const cls = row.printClass ?? row.print_class ?? null;
  if (cls && SCREEN_PRINT_CLASSES.has(cls)) return true;
  if (cls) return false; // known class that isn't screen print
  const type = row.printType ?? row.print_type ?? null;
  return !!type && SCREEN_PRINT_TYPES.has(type);
}

/** Is this garment one of the four base-taking types (by sub_category)? */
export function isBaseTakingGarment(subCategory) {
  return BASE_TAKING_SUBCATEGORIES.has(normaliseName(subCategory));
}

/** Does this garment colour need a white base? True for every colour except the exempt set. */
export function colourNeedsWhiteBase(colourName) {
  return !BASE_EXEMPT_COLOURS.has(normaliseName(colourName));
}

/**
 * Whole-product decision: does a screen print on this product, in this colour,
 * require a white base? True only when the garment type is on the allow-list
 * AND the colour is not exempt.
 */
export function productNeedsWhiteBase(subCategory, colourName) {
  return isBaseTakingGarment(subCategory) && colourNeedsWhiteBase(colourName);
}

/**
 * Flat base-print COST per unit for a given order quantity. Picks the highest
 * band whose minQty <= qty; quantities below the first band take the first
 * band's cost. Returns 0 for invalid qty.
 */
export function baseCostForQty(qty) {
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) return 0;
  let chosen = BASE_PRINT_COST_BANDS[0];
  for (const band of BASE_PRINT_COST_BANDS) {
    if (q >= band.minQty) chosen = band;
  }
  return chosen.cost;
}
