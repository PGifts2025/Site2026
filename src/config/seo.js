// Site-wide search wording (CLAUDE.md §66.5). Shared by the React app
// (Home.jsx via setPageMeta) and the build-time prerender
// (scripts/prerender-products.mjs) so the static <head> and the live tab
// title can never drift apart. Plain ESM — no JSX, no browser APIs.

// Owner's keyword choice (16 Nov 2026): high-traffic search terms.
// "Express Delivery": express turnaround is offered on selected supplier
// products (express_available); the 24hr Express service is still pending.
export const HOME_TITLE =
  'Corporate Gifts & Promotional Gifts - Gifts Under £10 & Express Delivery';
export const HOME_H1 = HOME_TITLE;
export const HOME_DESCRIPTION =
  'Corporate gifts and promotional gifts printed with your logo: mugs, bottles, bags, clothing, pens, notebooks, tech. Many under £10, express on selected lines.';

export const SITE_NAME = 'Promo Gifts';
export const SITE_URL = 'https://promo-gifts-co.uk'; // canonical host (§21.5)
