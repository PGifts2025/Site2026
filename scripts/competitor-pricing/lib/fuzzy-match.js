// Name-based fuzzy matching between PGifts and TM products.
//
// PGifts and TM both source from the same wholesalers, so product names are
// usually near-identical apart from cosmetic prefix words ("Promotional ...",
// "Branded ..."). We normalise those away, then score with the Dice coefficient.

import stringSimilarity from 'string-similarity';

// Marketing prefix/filler words that vary between sites and carry no signal.
const NOISE_WORDS = new Set([
  'promotional',
  'branded',
  'printed',
  'custom',
  'personalised',
  'personalized',
]);

/**
 * Normalise a product name for matching:
 *  - lowercase
 *  - strip punctuation (keep letters, numbers, spaces)
 *  - drop marketing noise words wherever they appear
 *  - collapse whitespace, trim
 * @param {string} name
 * @returns {string}
 */
export function normaliseName(name) {
  if (!name) return '';
  const cleaned = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
  const kept = cleaned.split(' ').filter((w) => w && !NOISE_WORDS.has(w));
  return kept.join(' ');
}

/**
 * Similarity score 0..1 between two product names (Dice coefficient).
 * Normalises both inputs first, so it is safe to pass raw names.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function similarity(a, b) {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return stringSimilarity.compareTwoStrings(na, nb);
}

/**
 * Find the best matching candidate for a target name.
 *
 * @param {string} target  - the name to match (raw or already-normalised)
 * @param {string[]} candidates - candidate names
 * @param {object} [opts]
 * @param {number} [opts.threshold=0.85] - minimum confidence to count as a match
 * @param {boolean} [opts.normalised=false] - true if `target` and `candidates`
 *        are already normalised (skips re-normalising, for hot loops)
 * @returns {{ match: string, confidence: number, index: number } | null}
 *   Returns the best candidate ABOVE the threshold, or null. To get the closest
 *   candidate regardless of threshold (e.g. for a "no confident match" report),
 *   call with `threshold: 0`.
 */
export function findBestMatch(target, candidates, { threshold = 0.85, normalised = false } = {}) {
  const t = normalised ? target : normaliseName(target);
  if (!t || !Array.isArray(candidates) || candidates.length === 0) return null;

  let bestIndex = -1;
  let bestScore = -1;
  for (let i = 0; i < candidates.length; i += 1) {
    const c = normalised ? candidates[i] : normaliseName(candidates[i]);
    if (!c) continue;
    const score = c === t ? 1 : stringSimilarity.compareTwoStrings(t, c);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex === -1 || bestScore < threshold) return null;
  return { match: candidates[bestIndex], confidence: bestScore, index: bestIndex };
}
