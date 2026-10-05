/**
 * Format a GBP amount for display: £8,300.00.
 *
 * Display-only. Accepts numbers or numeric strings (several callers hold
 * pre-rounded `toFixed(2)` strings) and never feeds back into pricing math.
 * Non-numeric / null input renders as an em dash.
 */
export const formatGBP = (value) => {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (n == null || !Number.isFinite(n)) return '—';
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
