/**
 * Delivery-address validation shared by the admin approval gate and the
 * customer order-edit page.
 *
 * shipping_address jsonb shape (PR B): { company, fao, line1, line2, city,
 * county, postcode, country, phone, instructions }.
 *
 * "Required for approval" = the six fields an order genuinely cannot ship
 * without: a recipient (fao), a contact (phone), and a deliverable address
 * (line1, city, postcode, country). Soft-required at checkout (customer may
 * pay with fao/phone blank); hard-required before admin advances the order
 * to `approved` (CLAUDE.md PR B decision 2).
 */

/**
 * @param {object} orderOrQuote - has a `shipping_address` jsonb field
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateDeliveryForApproval(orderOrQuote) {
  const addr = orderOrQuote?.shipping_address || {};
  const required = ['line1', 'city', 'postcode', 'country', 'fao', 'phone'];
  const missing = required.filter(
    (f) => !addr[f] || String(addr[f]).trim() === '',
  );
  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Build a delivery snapshot from a customer_profiles row. Single source of
 * truth for the account-address → shipping_address mapping, used both by the
 * DeliveryAddressForm preview and by CustomerQuotes' Pay Now snapshot.
 *
 * @param {object|null} profile - customer_profiles row
 * @returns {object} shipping_address-shaped object
 */
export function buildAccountSnapshot(profile) {
  const a = profile?.shipping_address || {};
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
  return {
    company: profile?.company_name || a.company || '',
    fao: profile?.contact_name || fullName || a.fao || '',
    line1: a.line1 || '',
    line2: a.line2 || '',
    city: a.city || '',
    county: a.county || '',
    postcode: a.postcode || '',
    country: a.country || 'United Kingdom',
    phone: profile?.phone || a.phone || '',
    instructions: a.instructions || '',
  };
}

/** True when the account profile carries a usable address (line1 present). */
export function accountHasAddress(profile) {
  return !!(profile?.shipping_address && String(profile.shipping_address.line1 || '').trim());
}

// Human-readable labels for the `missing` field keys, for UI messages.
export const DELIVERY_FIELD_LABELS = {
  line1: 'Address line 1',
  city: 'City',
  postcode: 'Postcode',
  country: 'Country',
  fao: 'FAO / Contact name',
  phone: 'Delivery phone',
};
