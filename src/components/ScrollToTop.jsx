import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Resets scroll to top on every route change. Also opts out of the browser's
// default scroll-restoration so a hard refresh lands at the top instead of
// restoring a pre-refresh Y.
//
// The same scrollRestoration opt-out is also duplicated in index.html so it
// takes effect before the React bundle loads — this line is belt-and-braces
// for when the React root remounts (e.g. HMR during dev).
if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    // Defensive future-proofing: if the URL carries a hash, let the browser
    // handle the anchor scroll rather than fighting it.
    if (window.location.hash) return;
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
};

export default ScrollToTop;
