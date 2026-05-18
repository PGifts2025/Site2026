/**
 * Bucket-(a) position recognition for Laltex products. See CLAUDE.md §53.
 *
 * Customer-facing rule: a Laltex product is designable if AND ONLY IF
 *   (a) it has PAC data (`print_details[].print_area_coordinates[]`), OR
 *   (b) at least one of its print_details positions canonicalises to a
 *       name in RECOGNISED_POSITIONS.
 *
 * Treatment-only, per-unit personalisation, and gift-set positions are
 * excluded. Products that fail both gates fall back to the
 * "Need help with artwork?" CTA in LaltexProductView.
 *
 * Single source of truth — adding a position to RECOGNISED_POSITIONS
 * unlocks every product that uses it. Iteration model: ship → observe
 * → extend.
 *
 * This module is intentionally NOT a coordinate-driven rect generator.
 * Phase 1 of the bucket-(a) investigation verified that single
 * canvas-fraction coordinates don't survive Laltex's variety of photo
 * framings (model-worn / flat-lay / multi-product / mixed orientation).
 * The Designer for bucket-(a) products renders the product photo + a
 * disclaimer banner without an on-canvas rect; the watermarked export
 * does the proof-stage work.
 */

// Recognised position names — canonicalised (lowercase, trimmed,
// post-colon suffix only). A product with at least one position whose
// canonicalisation appears here is designable.
export const RECOGNISED_POSITIONS = new Set([
  // Apparel canonical positions
  'front',
  'back',
  'left breast',
  'right breast',
  'left sleeve',
  'right sleeve',

  // Drinkware
  'wrap',
  'bottle front',
  'bottle back',
  'bottle wrap',
  'front centre',

  // Hard-good faces
  'all over',
  'top',
  'lid',
  'box lid',
  'top of lid',
  'lid top',
  'side',
  'side 1',
  'side 2',
  'side 3',

  // Pen anatomy
  'barrel',
  'barrel - side 1',
  'barrel - side 2',
  'barrel - in line with clip',
  'barrel - rotary engrave',
  'barrel - top',
  'clip',
  'beneath clip - side 1',
  'beneath clip - side 2',
  'top of pen - beneath clip',
  'tube',

  // Accessory positions
  'patch',
  'band',
  'bookmark',
  'pen loop',
  'sleeve', // bag/cover sleeve, distinct from apparel "left/right sleeve"
  'strap',
  'sash',
]);

// Treatment-only position names — these aren't geometric positions,
// they're production-treatment options that Laltex lists in the same
// schema (e.g. "Pantone" means colour-match the whole pen, not
// "place artwork in the Pantone area"). Products with ONLY these
// stay hidden.
export const TREATMENT_POSITIONS = new Set([
  'pantone',
  'pantone match the pen',
  'gold plating',
  'hard enamel',
  'rainbow',
  'glitter',
  'ink fill',
  'charms',
  'extra foam',
  'plate & ribbon',
  'backing card',
  'back of card',
]);

// Per-unit personalisation labels — collected at quote time, not
// designed on the canvas.
export const PERSONALISATION_POSITIONS = new Set([
  'individual names',
]);

/**
 * Canonicalise a Laltex position string.
 *
 * Returns the lookup-ready key for the *_POSITIONS sets:
 *   - lowercased and trimmed
 *   - everything before the last colon is stripped (e.g.
 *     "Goa Bamboo Ball Pen:Barrel" → "barrel"). The gift-set
 *     designability gate is enforced separately in
 *     isPositionDesignable() — this helper exists so any future
 *     gift-set unlock can simply remove that gate and the
 *     RECOGNISED_POSITIONS lookup still works.
 *
 * @param {string} rawName
 * @returns {string} canonical key (may be empty string for invalid input)
 */
export function canonicalisePosition(rawName) {
  if (!rawName || typeof rawName !== 'string') return '';
  let s = rawName;
  const lastColon = s.lastIndexOf(':');
  if (lastColon !== -1) {
    s = s.slice(lastColon + 1);
  }
  return s.toLowerCase().trim();
}

/**
 * Returns true if a single position is designable.
 *
 * Gift-set exclusion: for this iteration, any position name
 * containing a colon is a gift-set item and is NOT designable, even
 * if its suffix matches RECOGNISED_POSITIONS. Re-evaluated after the
 * main relaxation ships.
 *
 * @param {string} rawName
 * @returns {boolean}
 */
export function isPositionDesignable(rawName) {
  if (!rawName || typeof rawName !== 'string') return false;
  if (rawName.includes(':')) return false; // gift-set, hidden for now

  const canonical = canonicalisePosition(rawName);
  if (TREATMENT_POSITIONS.has(canonical)) return false;
  if (PERSONALISATION_POSITIONS.has(canonical)) return false;
  return RECOGNISED_POSITIONS.has(canonical);
}

/**
 * Product-level gift-set check.
 *
 * If ANY position name in the product contains a colon, the whole
 * product is treated as a multi-item gift set (e.g. Goa Bamboo Ball
 * Pen + Pencil + Box) and excluded from bucket-(a) — even if some of
 * the un-prefixed sibling positions happen to be recognised. The
 * reason: a gift-set canvas would render one item's photo with a
 * shared position name like "Barrel - Side 1", with no way for the
 * customer to know which item (the pen vs the pencil) the position
 * refers to. Hiding the whole product avoids that confusion.
 *
 * @param {Array<{name?: string}>} positionGroups
 * @returns {boolean}
 */
export function isGiftSetProduct(positionGroups) {
  if (!Array.isArray(positionGroups)) return false;
  return positionGroups.some(
    (g) => typeof g?.name === 'string' && g.name.includes(':'),
  );
}

/**
 * Smart-gate Path 2 product check: a product is bucket-(a)-designable
 * iff
 *   - it is NOT a multi-item gift set (no position carries a colon), AND
 *   - at least one position passes isPositionDesignable.
 *
 * Path 1 (PAC) is checked separately by the caller — this function
 * only answers "could this product be designable via heuristic
 * recognition?" and is irrelevant when PAC is present.
 *
 * @param {Array<{name?: string}>} positionGroups
 * @returns {boolean}
 */
export function isBucketADesignable(positionGroups) {
  if (!Array.isArray(positionGroups) || positionGroups.length === 0) return false;
  if (isGiftSetProduct(positionGroups)) return false;
  return positionGroups.some((g) => isPositionDesignable(g?.name));
}
