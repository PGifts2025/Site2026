import React from 'react';

/**
 * AboveCeilingNotice — shown beneath the Configure & Quote Total when the
 * entered quantity exceeds the product's top pricing tier.
 *
 * Above the top tier the per-unit price flat-lines at the top-tier rate (the
 * cheapest listed rate), so the order is never under-priced — but a large
 * order quoted at the top-tier rate skips a genuine bulk negotiation. This
 * nudges the customer to call instead of submitting silently. Informational
 * only: Add to Quote stays enabled. See audit-pricing-tier-ceiling.md.
 *
 * Purely presentational — the caller decides when to render it (the
 * `tiers.length > 1` and strict `quantity > topTierQty` guards live at the
 * call sites).
 *
 * @param {number} topTierQty - top tier's min quantity, shown in the message
 * @param {string} [phone]    - phone number; spaces kept in text, stripped in tel:
 */
const AboveCeilingNotice = ({ topTierQty, phone = '01844 398333' }) => {
  const telHref = `tel:${String(phone).replace(/\s+/g, '')}`;
  return (
    <div className="mt-3 p-3 rounded-lg border-l-4 border-amber-400 bg-amber-50 text-amber-900 text-sm leading-snug">
      Need more than {topTierQty} units? Call us on{' '}
      <a href={telHref} className="font-semibold underline hover:text-amber-700">
        {phone}
      </a>{' '}
      for our best bulk price.
    </div>
  );
};

export default AboveCeilingNotice;
