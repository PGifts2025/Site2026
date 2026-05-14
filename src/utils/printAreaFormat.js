/**
 * Pretty-print and structured helpers for the v2 composite `print_area`
 * format introduced in session 9 (CLAUDE.md §43).
 *
 * Format: "Position|Size|PrintClass"
 *   - "Front Chest|200x300mm|FTRAN05"  → composite (v2 multi-row)
 *   - "Front Chest"                    → legacy v2 plain text
 *   - ""                               → empty / missing
 *   - null / undefined                 → empty / missing
 *
 * Used by:
 *   - DesignerV2 My Designs sidebar
 *   - CustomerDesigns card subtitle
 *   - CustomerQuotes chip rendering
 *
 * Pipe was chosen as the delimiter because no Laltex position name or
 * print_area string in the live corpus (1182 rows probed 2026-05-14)
 * contains a pipe character.
 */

/**
 * Human-friendly summary of a v2 composite `print_area` string.
 * Returns empty string for null/undefined.
 *
 *   prettyPrintArea("Front Chest|200x300mm|FTRAN05") -> "Front Chest — 200x300mm"
 *   prettyPrintArea("Front Chest")                   -> "Front Chest"
 *   prettyPrintArea(null)                            -> ""
 */
export function prettyPrintArea(value) {
  if (!value) return '';
  const parts = String(value).split('|');
  if (parts.length === 1) return parts[0];
  const [name, area] = parts;
  return area ? `${name} — ${area}` : name;
}

/**
 * Structured parse of a v2 composite print_area string.
 * Returns null for null/undefined inputs; partial fields are null on
 * legacy plain-text format.
 */
export function parsePrintArea(value) {
  if (!value) return null;
  const parts = String(value).split('|');
  return {
    position: parts[0] || null,
    area: parts[1] || null,
    printClass: parts[2] || null,
    isComposite: parts.length > 1,
  };
}
