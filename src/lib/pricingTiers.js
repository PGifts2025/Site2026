/**
 * Pricing-tier helpers shared by the admin margin editor.
 *
 * supplier_products has no top-level price/sell_price column — both live
 * inside the product_pricing JSONB array, one entry per quantity band:
 *   { min_qty, max_qty, price, sell_price, is_poa, margin_applied_pct, note }
 * max_qty === null means an open-ended top tier.
 */

/**
 * Find the product_pricing tier whose [min_qty, max_qty] range contains qty.
 * Returns the tier object, or null if none matches / input is malformed.
 *
 * @param {Array<object>} productPricing
 * @param {number} qty
 * @returns {object|null}
 */
export function findTierAtQty(productPricing, qty) {
  if (!Array.isArray(productPricing)) return null;
  return productPricing.find((t) => {
    const min = t?.min_qty ?? 0;
    const max = t?.max_qty ?? Infinity;
    return qty >= min && qty <= max;
  }) ?? null;
}
