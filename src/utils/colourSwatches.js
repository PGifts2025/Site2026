/**
 * Curated colour-name -> hex map for Laltex products that ship NO per-colour
 * imagery (53 of 1194; see audit-laltex-images-regression.md). Laltex supplies
 * no hex and no usable PMS, so this is our own indicative lookup.
 *
 * IMPORTANT:
 *   - These hexes are INDICATIVE, not colour-matched. The colour NAME stays
 *     the authoritative identifier on screen; the swatch is only a visual aid.
 *   - Products that DO have real garment photography keep using it — this map
 *     is a fallback, never an override.
 *   - Only add a colour when you can represent it with reasonable confidence.
 *     Heathers, marls, melanges and any textured/two-tone finish are
 *     deliberately LEFT OUT (a flat hex cannot honestly represent them); those
 *     fall back to the named chip, which is the correct outcome. A gap beats a
 *     wrong colour.
 *
 * Keys are normalised: lowercase, trimmed, whitespace collapsed.
 */

// Normalise a colour name for lookup.
const norm = (s) => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');

const SWATCH_HEX = {
  // --- neutrals ---
  black: '#1c1c1c',
  'jet black': '#101010',
  white: '#ffffff',
  'arctic white': '#f5f7f9',
  natural: '#e8dfce',
  cream: '#f3ecd8',
  grey: '#808080',
  gray: '#808080',
  charcoal: '#36454f',
  'slate grey': '#708090',
  'slate gray': '#708090',
  anthracite: '#3b3f42',
  graphite: '#4b4f54',

  // --- navies / blues ---
  navy: '#1b264f',
  'dark navy': '#141c3a',
  'deep navy': '#17213f',
  'french navy': '#16213e',
  'oxford navy': '#14213d',
  'royal blue': '#1e40af',
  'bright royal': '#2547c4',
  royal: '#1e40af',
  'sky blue': '#6fb7e9',
  'light blue': '#add8e6',
  'azure blue': '#1e7fdf',
  azure: '#1e7fdf',
  sapphire: '#0f52ba',
  'cornflower blue': '#6495ed',
  'denim blue': '#6f8faf',
  'turquoise blue': '#2ec4c4',
  turquoise: '#2ec4c4',

  // --- reds / burgundy ---
  red: '#c8102e',
  'fire red': '#d61f28',
  'cardinal red': '#8c1515',
  'cherry red': '#c60c46',
  burgundy: '#7a2233',
  burgandy: '#7a2233', // feed misspelling

  // --- purples / pinks ---
  purple: '#5b2a86',
  lavender: '#b9a5d9',
  orchid: '#d670c9',
  'light pink': '#f6c3d0',
  pink: '#f4a6c0',
  'hot pink': '#ff5fa2',
  azalea: '#f19cbb',
  'pink carnation': '#ffb1cc',
  fuchsia: '#c74992',
  'electric pink': '#ff33a0',
  magenta: '#c8228c',

  // --- greens ---
  green: '#2e8b57',
  'bottle green': '#073d29',
  'kelly green': '#199c47',
  'irish green': '#159c4b',
  fern: '#4f7942',
  olive: '#6f7d33',
  lime: '#aacb3a',
  'electric green': '#17c917',
  mint: '#a9e3c5',
  pistachio: '#93c572',
  jade: '#00a877',

  // --- yellows / oranges / earth ---
  yellow: '#f7d117',
  'sun yellow': '#ffd400',
  sunflower: '#ffca08',
  'electric yellow': '#f0f23a',
  mustard: '#d9a521',
  orange: '#f5771f',
  'electric orange': '#ff5a1f',
  khaki: '#b3a369',
  sand: '#cbb994',
};

/**
 * Indicative hex for a colour name, or null when the name is not in the map
 * (unknown, or a deliberately-excluded textured finish). Caller falls back to
 * the named chip.
 */
export function getSwatchHex(name) {
  return SWATCH_HEX[norm(name)] || null;
}

/**
 * Rough perceived-lightness test for a hex (#rgb or #rrggbb). Used to give
 * near-white swatches a visible border and to pick a legible selection ring.
 */
export function isLightHex(hex) {
  if (typeof hex !== 'string') return false;
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Perceived luminance (ITU-R BT.601). > ~180 reads as "light".
  return (0.299 * r + 0.587 * g + 0.114 * b) > 180;
}

// Exported for tests / the audit list of what is intentionally unmapped.
export const SWATCH_HEX_KEYS = Object.keys(SWATCH_HEX);
