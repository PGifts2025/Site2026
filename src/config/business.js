// Single source of truth for business identity shown to customers: invoices
// (order detail page + confirmation email), the site footer disclosure, and
// the Stripe line-item name. Do NOT duplicate the VAT number or addresses
// anywhere else — import from here.
//
// Branding leads with the trading name "Promo Gifts". The legal entity
// (Alpha Omega Ltd) appears only in the small disclosure line required by the
// Companies Act 2006 s.1202-1204 — never in headings, titles, email subjects,
// or the email sender name.
//
// Address usage (do not mix):
//   - tradingAddress (Unit 9)   -> invoices + order detail page (HMRC VAT
//                                   invoice supplier-address requirement).
//   - registeredOffice (Unit 11)-> site footer disclosure only (the address
//                                   the Companies Act disclosure points at).

export const BUSINESS = {
  tradingName: 'Promo Gifts',
  legalEntity: 'Alpha Omega Ltd',
  vatNumber: 'GB 685 8348 77',

  // Supplier address on VAT invoices (order detail page + confirmation email).
  tradingAddress: [
    'Unit 9',
    'Clearfields Industrial Estate',
    'Wotton Underwood',
    'Buckinghamshire',
    'HP18 0RS',
  ],

  // Companies Act disclosure address — site footer only. Same estate as the
  // trading address, different unit.
  registeredOffice: [
    'Unit 11',
    'Clearfields Industrial Estate',
    'Wotton Underwood',
    'Buckinghamshire',
    'HP18 0RS',
  ],

  disclosure: 'Promo Gifts is a trading name of Alpha Omega Ltd. Registered in England & Wales.',
  phone: '01844 398333',
  email: 'hello@promo-gifts.co',
};

// Convenience: address as a single comma-joined line (footer, compact spots).
export const tradingAddressLine = BUSINESS.tradingAddress.join(', ');
export const registeredOfficeLine = BUSINESS.registeredOffice.join(', ');
