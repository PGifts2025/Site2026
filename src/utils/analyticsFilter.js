// Vercel Web Analytics filter (CLAUDE.md §66.8). Runs in the browser on
// every page view before anything is sent.
//  - Strips the query string and #fragment: they can carry Stripe session
//    ids (/order-confirmation?session_id=…) and sign-in / password-reset
//    tokens (/auth/callback#access_token=…). Only origin + path are sent.
//  - Drops staff-only admin pages entirely.
// Never throw: a broken filter must not break the page.

export function analyticsBeforeSend(event) {
  try {
    const url = new URL(event.url);
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return null;
    return { ...event, url: `${url.origin}${url.pathname}` };
  } catch {
    return event;
  }
}
