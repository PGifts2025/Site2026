/**
 * UK VAT calculation — flat 20% with a tiny children's-clothing carve-out.
 *
 * MODEL (kept deliberately minimal — see audit-vat-implementation-gap.md):
 *   - Prices stored and displayed throughout are NET (ex-VAT).
 *   - VAT is added at checkout: gross = net + net * 0.20.
 *   - ONE exception: three children's products are zero-rated on the PRODUCT
 *     cost, but the print / setup / delivery SERVICES on those lines are still
 *     standard-rated at 20%. (UK children's clothing rules — confirmed by
 *     Dave's accountant.)
 *
 * SINGLE SOURCE OF TRUTH FOR STORED VALUES IS THE DATABASE.
 *   quote_items.line_vat and order_items.line_vat are GENERATED columns:
 *       round(round(quantity * COALESCE(taxable_net_unit, unit_price), 2) * 0.20, 2)
 *   where `taxable_net_unit` is the per-unit net that VAT applies to. For a
 *   standard line it is NULL (→ the whole unit_price is taxable); for a
 *   zero-rated line the frontend writes the SERVICES-per-unit (print +
 *   delivery), so only that portion is taxed. recompute_quote_total and
 *   confirm_payment_atomic roll those up into subtotal / tax_amount /
 *   total_amount.
 *
 *   The helpers below MIRROR that arithmetic for the frontend (PR B display)
 *   and for tests. If the DB rounding ever changes, change it here too. The
 *   DB — not this file — is authoritative for what a customer is charged.
 *
 * The 3-code list lives ONLY here (and, at write time, decides whether a
 * quote_item gets a taxable_net_unit). The SQL is code-agnostic: it simply
 * VATs whatever taxable portion it is given, so the list is never duplicated
 * in a migration.
 */

// The only products whose PRODUCT cost is zero-rated for UK VAT. Print, setup
// and delivery on these products remain standard-rated (20%). Add a code here
// (and nowhere else) to zero-rate a new product's garment portion.
export const ZERO_RATED_PRODUCT_CODES = ['TF001K', 'TF004K', 'CF2019'];

// UK standard VAT rate. Services are ALWAYS charged at this rate.
export const VAT_RATE = 0.20;

/** Round to 2 decimal places (money). Matches the numeric(10,2) DB columns. */
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** True when a product code's garment portion is zero-rated. Case-insensitive:
 *  Laltex codes are uppercase (CLAUDE.md §33) but callers may pass any casing. */
export function isZeroRated(productCode) {
  if (productCode == null) return false;
  const c = String(productCode).toUpperCase();
  return ZERO_RATED_PRODUCT_CODES.includes(c);
}

/**
 * Standard case: the whole line net is taxable at 20%.
 * Pass the 2dp line net (quantity * unit_price already rounded).
 */
export function standardLineVat(lineNet) {
  return round2(round2(lineNet) * VAT_RATE);
}

/**
 * Zero-rated product case: the product portion contributes 0 VAT; only the
 * services portion (print + setup + delivery) is taxed at 20%.
 * Pass the 2dp services net for the line.
 */
export function zeroRatedLineVat(servicesNet) {
  return round2(round2(servicesNet) * VAT_RATE);
}

/**
 * Pick the right line VAT for a product. `productNet` and `servicesNet` are
 * the line-level (quantity-multiplied) net amounts.
 *   - standard: VAT on (productNet + servicesNet)
 *   - zero-rated: VAT on servicesNet only
 */
export function lineVat(productCode, productNet, servicesNet) {
  if (isZeroRated(productCode)) {
    return zeroRatedLineVat(servicesNet);
  }
  return standardLineVat(Number(productNet) + Number(servicesNet));
}

/**
 * Convenience for the frontend write path: the value to store in
 * `quote_items.taxable_net_unit`. Returns the SERVICES net per unit for a
 * zero-rated product (so the DB taxes only that), or null for a standard
 * product (so the DB taxes the whole unit_price). Kept at 4dp precision to
 * survive the quantity multiply the DB does before rounding.
 */
export function taxableNetUnit(productCode, servicesNetUnit) {
  if (!isZeroRated(productCode)) return null;
  const v = Number(servicesNetUnit);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.round(v * 10000) / 10000;
}
