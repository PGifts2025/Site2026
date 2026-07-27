/**
 * Screen print white-base pricing (Laltex clothing).
 *
 * WHY THIS EXISTS
 * ---------------
 * Screen printing onto a dark garment needs an opaque white underbase laid
 * down first, so the colours on top stay vibrant. That base is a full extra
 * print colour in every practical sense: its own screen (a real setup cost)
 * and its own pass on the press.
 *
 * Laltex do not charge for it. Their print price is keyed only on
 * (num_colours, num_position, min_qty) with no garment-colour dimension
 * anywhere in the feed (verified end to end in audit-screenprint-base-pricing.md).
 * Dave confirmed with Laltex directly that this is a bug on their side and a
 * fix to their API is months away, so we correct it here.
 *
 * THE CORRECTION
 * --------------
 * On a garment requiring a base, look the print price up at (colours + 1)
 * instead of (colours). A 1-colour design bills as 2-colour, 3 bills as 4.
 *
 * No hardcoded setup fee and no percentage uplift: the existing tier table
 * already contains BOTH the extra ink pass and the amortised screen setup
 * (bakeSetupIntoPrintPrice, laltex-parser.js), so the (colours + 1) step is
 * exactly the right amount and stays correct if Laltex ever reprice.
 *
 * Corroborated by Dave's own cost sheet (Screen_Print_Gildan_Heavy_Tshirts_
 * November_2025.xlsx), where the coloured-garment sheet charges the extra ink
 * pass but omits the £33 base screen. The gap is exactly £33/qty at every
 * break: £1.32 @ 25, £0.33 @ 100, £0.03 @ 1000.
 */

/**
 * Normalise a colour name for comparison: lowercase, trimmed, whitespace
 * collapsed. Matches the convention already used by colourSwatches.js (PR #82)
 * so the two lookups agree on what counts as the "same" colour name.
 */
export const normaliseColourName = (s) => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Colours that do NOT need a white base. Dave's rule, deliberately simple:
 * White and Natural are exempt, everything else needs a base.
 *
 * DO NOT extend this set without Dave confirming. Anything not listed here
 * requires a base, which is the safe direction (it charges rather than
 * absorbs).
 *
 * Candidates surfaced from the live Laltex clothing feed and AWAITING Dave's
 * confirmation (each currently requires a base, i.e. is charged):
 *   arctic white (14 products) · natural raw (1) · natural stone (3)
 *   vanilla (1) · vanilla milkshake (4) · white/black (1) · white/light steel (1)
 *   sand (8) · desert sand (6)
 * Note: Optic White, Off White, Ecru, Ivory, Cream, Bone and Oatmeal do NOT
 * appear anywhere in the Laltex clothing feed.
 */
export const BASE_EXEMPT_COLOURS = new Set(['white', 'natural']);

/**
 * Print methods that lay ink on the garment through a screen, and therefore
 * need a white base on dark fabric.
 *
 * These are the EXACT identifiers read from the live feed, not a partial name
 * match. Across all 89 Laltex clothing products there is exactly one such
 * method: print_type 'Spot Print', print_class 'FSCREEN1' (313 rows / 58
 * products). It is also the only clothing method whose tiers carry more than
 * one colour count (1,2,3,4); every embroidery and transfer method has
 * num_colours = 1 only.
 *
 * Embroidery (FEMB*) uses the same thread regardless of garment colour, and
 * transfer / digital (FTRAN*, CMYK) carry their own opacity, so neither takes
 * a base.
 */
export const SCREEN_PRINT_CLASSES = new Set(['FSCREEN1']);
export const SCREEN_PRINT_TYPES = new Set(['Spot Print']);

/**
 * Is this print_details row a screen print?
 * Matches on print_class first (the stable internal identifier); falls back to
 * an exact print_type match for rows where the class is missing.
 */
export function isScreenPrintRow(row) {
  if (!row) return false;
  const cls = row.printClass ?? row.print_class ?? null;
  if (cls && SCREEN_PRINT_CLASSES.has(cls)) return true;
  if (cls) return false; // known class that isn't screen print
  const type = row.printType ?? row.print_type ?? null;
  return !!type && SCREEN_PRINT_TYPES.has(type);
}

/**
 * Does this garment colour need a white base?
 * True for every colour except the exempt set. An empty / unknown colour name
 * returns true (safe direction: charge rather than absorb).
 */
export function colourNeedsWhiteBase(colourName) {
  return !BASE_EXEMPT_COLOURS.has(normaliseColourName(colourName));
}

/**
 * Scope guard: the base rule applies to garments only. Non-clothing products
 * (pens, mugs, bottles) are entirely unaffected even though many of them also
 * offer Spot Print.
 */
export function isGarmentCategory(category) {
  return normaliseColourName(category) === 'clothing';
}

/**
 * Whole-product decision: does a screen print on this product, in this colour,
 * require a white base?
 */
export function productNeedsWhiteBase(category, colourName) {
  return isGarmentCategory(category) && colourNeedsWhiteBase(colourName);
}
