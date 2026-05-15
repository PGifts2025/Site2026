/**
 * Carton-count delivery helper for Laltex products.
 *
 * Laltex returns ShippingCharge as an array of 8 service options, each
 * with a Charges[] array indexed by carton count. Verified live (Task 9):
 * tiers are dense integers 1..10 followed by an open-ended "11+" band
 * priced per-additional-carton. Surveyed across the corpus — every
 * Laltex product has the same shape.
 *
 * Carton-count derivation:
 *   cartons = ceil(qty / pieces_per_carton)
 *   pieces_per_carton ← supplier_products.carton_qty (synced from
 *   raw_payload.CartonQty by laltex-parser.js)
 *
 * Service:
 *   default = 'ukstandard'. Other services (channelislands, dublin, etc.)
 *   are not surfaced to customers in Stage 1; Dave handles non-UK
 *   manually pre-launch.
 *
 * Per Dave's decision 5 + B1-A:
 *   Delivery is computed at READ time, not baked into sync-stored
 *   sell_price. This helper is called by:
 *     - LaltexProductView (at the customer's actual order quantity)
 *     - api/ai/chat.js slimProduct (at each tier's representative quantity)
 *     - api/search-products.js unit_price_at_quantity (at the filter qty)
 *     - AIChatWidget ProductCard "From £x.xx (MOQ+)" (at the MOQ-tier qty)
 *
 * Returns the TOTAL delivery cost for the order in GBP. Callers divide
 * by qty to get per-unit if needed.
 */

export const DEFAULT_DELIVERY_SERVICE = 'ukstandard';

function parseChargeString(s) {
  if (s == null) return null;
  if (typeof s === 'number' && Number.isFinite(s)) return s;
  const str = String(s).trim();
  if (!str || str.toUpperCase() === 'N/A') return null;
  const cleaned = str.replace(/[£€$,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseCartonCount(s) {
  if (s == null) return null;
  const str = String(s).trim();
  // "11+" → 11, "5" → 5
  const n = parseInt(str.replace(/\+$/, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Total delivery cost for the order. Returns 0 for missing/empty data
 * (PGifts Direct mirror rows have shipping_charges=[]).
 *
 * @param {Array|null} shippingCharges  supplier_products.shipping_charges
 * @param {number|null} piecesPerCarton supplier_products.carton_qty
 * @param {number} quantity              actual order quantity
 * @param {string} service               ServiceType match; defaults to 'ukstandard'
 * @returns {number}                     total cost in GBP
 */
export function computeDeliveryForQuantity(
  shippingCharges,
  piecesPerCarton,
  quantity,
  service = DEFAULT_DELIVERY_SERVICE,
) {
  if (!Array.isArray(shippingCharges) || shippingCharges.length === 0) return 0;
  if (!Number.isFinite(piecesPerCarton) || piecesPerCarton <= 0) return 0;
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;

  // Select the requested service; fall back to ukstandard if missing.
  let svc = shippingCharges.find((s) => s?.ServiceType === service);
  if (!svc) svc = shippingCharges.find((s) => s?.ServiceType === DEFAULT_DELIVERY_SERVICE);
  if (!svc || !Array.isArray(svc.Charges)) return 0;

  const cartonsNeeded = Math.ceil(quantity / piecesPerCarton);

  // Try exact-match row first (dense 1..10 tiers in the surveyed corpus).
  const exact = svc.Charges.find((c) => parseCartonCount(c?.Carton) === cartonsNeeded);
  if (exact) {
    const flat = parseChargeString(exact.ShippingCharge);
    if (flat != null) return Number(flat.toFixed(2));
    // Some rows may carry only PerCartonCharge instead of ShippingCharge.
    const per = parseChargeString(exact.PerCartonCharge);
    if (per != null) return Number((per * cartonsNeeded).toFixed(2));
  }

  // Out-of-band carton count (≥11 typically): use the open "11+" band.
  const openBand = svc.Charges.find((c) => /\+$/.test(String(c?.Carton ?? '')));
  if (openBand) {
    const perCarton = parseChargeString(openBand.PerCartonCharge);
    if (perCarton != null) return Number((perCarton * cartonsNeeded).toFixed(2));
    const flat = parseChargeString(openBand.ShippingCharge);
    if (flat != null) return Number(flat.toFixed(2));
  }

  // Sparse-tier safety net: round UP to the next listed band whose Carton
  // number ≥ cartonsNeeded. Shouldn't trigger on real Laltex data; defensive
  // against feed-shape drift.
  const candidates = svc.Charges
    .map((c) => ({ row: c, n: parseCartonCount(c?.Carton) }))
    .filter((x) => Number.isFinite(x.n) && x.n >= cartonsNeeded)
    .sort((a, b) => a.n - b.n);
  if (candidates.length > 0) {
    const flat = parseChargeString(candidates[0].row.ShippingCharge);
    if (flat != null) return Number(flat.toFixed(2));
  }

  // Last resort: the most expensive listed total. Conservative; surfaces
  // as a high delivery line so a customer notices and Dave can investigate.
  let highest = 0;
  for (const c of svc.Charges) {
    const v = parseChargeString(c?.ShippingCharge);
    if (v != null && v > highest) highest = v;
  }
  return highest;
}

/**
 * Convenience: per-unit delivery cost at the given quantity. Same
 * semantics as computeDeliveryForQuantity but divided by qty.
 *
 * Returns 0 (not Infinity / NaN) when quantity is zero or invalid.
 */
export function deliveryPerUnit(shippingCharges, piecesPerCarton, quantity, service) {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  const total = computeDeliveryForQuantity(shippingCharges, piecesPerCarton, quantity, service);
  return total / quantity;
}
