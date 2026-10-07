import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

/**
 * In-page notification view for useToast() (src/hooks/useToast.js).
 * type: 'success' | 'error' | 'info'; optional link { to, label }.
 */
const STYLES = {
  success: { box: 'bg-green-50 border-green-200 text-green-900', icon: CheckCircle, iconCls: 'text-green-600' },
  error: { box: 'bg-red-50 border-red-200 text-red-900', icon: AlertCircle, iconCls: 'text-red-600' },
  info: { box: 'bg-blue-50 border-blue-200 text-blue-900', icon: Info, iconCls: 'text-blue-600' },
};

export function Toast({ toast, onClose }) {
  if (!toast) return null;
  const s = STYLES[toast.type] || STYLES.info;
  const Icon = s.icon;
  // bottom-24 keeps it clear of the AI chat launcher in the bottom-right corner.
  return (
    <div className="fixed bottom-24 right-4 left-4 sm:left-auto z-[200] flex justify-end pointer-events-none">
      <div
        key={toast.id}
        role={toast.type === 'error' ? 'alert' : 'status'}
        aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
        className={`pointer-events-auto w-full sm:max-w-sm flex items-start gap-3 border rounded-lg shadow-lg px-4 py-3 ${s.box}`}
      >
        <Icon className={`h-5 w-5 flex-shrink-0 mt-0.5 ${s.iconCls}`} />
        <div className="flex-1 text-sm">
          <p className="font-medium">{toast.message}</p>
          {toast.link && (
            <Link to={toast.link.to} onClick={onClose} className="mt-1 inline-block font-semibold underline hover:no-underline">
              {toast.link.label}
            </Link>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default Toast;
