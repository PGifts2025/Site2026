import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Lightweight in-page notification, replacing blocking window.alert().
 *
 *   const [toast, showToast, hideToast] = useToast();
 *   showToast({ type: 'success', message: 'Design saved', link: { to: '/account/designs', label: 'View in My Designs' } });
 *   <Toast toast={toast} onClose={hideToast} />   // src/components/Toast.jsx
 *
 * type: 'success' | 'error' | 'info'. Errors stay until dismissed (or 8 s);
 * others auto-hide after `duration` ms (default 5000).
 */
export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const hideToast = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  const showToast = useCallback((next) => {
    clearTimeout(timer.current);
    const t = { type: 'info', ...next, id: Date.now() };
    setToast(t);
    const duration = t.duration ?? (t.type === 'error' ? 8000 : 5000);
    if (duration > 0) timer.current = setTimeout(() => setToast(null), duration);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return [toast, showToast, hideToast];
}
