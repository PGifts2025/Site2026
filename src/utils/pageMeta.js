// Browser-tab title + meta description for client-side navigation
// (CLAUDE.md §66). Direct visits to in-house product URLs already get
// the right <head> from scripts/prerender-products.mjs; this keeps the
// tab title and description right when a shopper moves between pages
// inside the app, and gives JavaScript-rendering crawlers the same.

export const DEFAULT_TITLE = 'Promo Gifts';

const setMetaDescription = (content) => {
  let tag = document.querySelector('meta[name="description"]');
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', 'description');
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
};

/**
 * Set the page title (and optionally the meta description).
 * Returns a cleanup function that resets the title to the site default,
 * for use as a useEffect cleanup.
 */
export function setPageMeta({ title, description } = {}) {
  if (typeof document === 'undefined') return () => {};
  if (title) document.title = title;
  if (description) setMetaDescription(description);
  return () => {
    document.title = DEFAULT_TITLE;
  };
}
