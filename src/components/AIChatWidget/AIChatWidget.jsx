// Minimal AI chat widget. Functional only — session 6 polishes.
//
// Visibility rules (see CLAUDE.md §32.3):
//   Anonymous user: shown when VITE_AI_CHAT_PUBLIC_ENABLED === 'true'
//   Signed-in user: shown when profiles.ai_chat_enabled === true
//                   (anonymous switch ignored for signed-in users so
//                   testers can use the widget while it's hidden from
//                   the public).
//
// FingerprintJS is loaded lazily on first use to avoid blocking initial
// render. We never send the raw fingerprint anywhere except this one
// POST body — the server hashes it before storage.
//
// No localStorage usage for conversations (privacy + simplicity). Anon
// conversations live in component state and vanish on close.

import { useEffect, useRef, useState } from 'react';

import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../services/supabaseService';

const PUBLIC_ENABLED = String(import.meta.env.VITE_AI_CHAT_PUBLIC_ENABLED ?? '').toLowerCase() === 'true';

const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 560;

let fpAgentPromise = null;
async function getVisitorId() {
  if (!fpAgentPromise) {
    fpAgentPromise = import('@fingerprintjs/fingerprintjs').then((m) => m.load());
  }
  try {
    const agent = await fpAgentPromise;
    const result = await agent.get();
    return result?.visitorId ?? null;
  } catch (e) {
    // Adblocker, exotic browser, etc. — server will fall back to IP hash.
    console.warn('[AIChatWidget] FingerprintJS failed; relying on server IP fallback', e?.message);
    return null;
  }
}

async function getSupabaseAccessToken() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function fetchProfileFlag(userId) {
  // RLS lets the user read their own profile row; if no row exists yet
  // the flag is treated as false (the default).
  try {
    const { data } = await supabase
      .from('profiles')
      .select('ai_chat_enabled')
      .eq('id', userId)
      .maybeSingle();
    return Boolean(data?.ai_chat_enabled);
  } catch {
    return false;
  }
}

export default function AIChatWidget() {
  const { user, loading } = useAuth();
  const [profileEnabled, setProfileEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // [{ role, content, tool_calls? }]
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [quotaStatus, setQuotaStatus] = useState(null);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  // Auth flag lookup whenever user changes.
  useEffect(() => {
    let cancelled = false;
    if (!user) { setProfileEnabled(false); return; }
    fetchProfileFlag(user.id).then((on) => { if (!cancelled) setProfileEnabled(on); });
    return () => { cancelled = true; };
  }, [user]);

  // Auto-scroll on new messages.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Visibility gate.
  if (loading) return null;
  const visible = user ? profileEnabled : PUBLIC_ENABLED;
  if (!visible) return null;

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setError(null);
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setSending(true);
    try {
      const visitorId = user ? null : await getVisitorId();
      const accessToken = user ? await getSupabaseAccessToken() : null;

      const resp = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          message: text,
          visitor_id: visitorId,
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(data?.error ?? `Request failed (${resp.status})`);
        return;
      }
      setConversationId(data.conversation_id);
      setQuotaStatus(data.quota_status ?? null);
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: data?.message?.content ?? '(no response)',
          tool_calls: data?.message?.tool_calls ?? [],
          products: Array.isArray(data?.products) ? data.products : [],
        },
      ]);
    } catch (err) {
      setError(err?.message ?? 'Network error');
    } finally {
      setSending(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const quotaExhausted =
    !user &&
    quotaStatus &&
    typeof quotaStatus.remaining === 'number' &&
    quotaStatus.remaining <= 0;

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={launcherStyle}
          aria-label="Open AI assistant"
        >
          AI
        </button>
      )}

      {open && (
        <div style={panelStyle} role="dialog" aria-label="PGifts AI assistant">
          <div style={headerStyle}>
            <div>PGifts AI assistant <span style={{ opacity: 0.6, fontSize: 11 }}>(beta)</span></div>
            <button type="button" style={closeBtnStyle} onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>

          <div ref={scrollRef} style={historyStyle}>
            {messages.length === 0 && (
              <div style={hintStyle}>
                Ask about products, prices, lead times, or "find me something
                like X". I can search our full catalogue.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={m.role === 'user' ? userBubbleStyle : asstBubbleStyle}>
                <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 2 }}>
                  {m.role === 'user' ? 'You' : 'Assistant'}
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>
                  {m.role === 'assistant'
                    ? linkifyProductCodes(m.content, m.products)
                    : m.content}
                </div>
                {Array.isArray(m.products) && m.products.length > 0 && (
                  <div style={cardListStyle}>
                    {m.products.map((p) => (
                      <ProductCard key={p.supplier_product_code} product={p} />
                    ))}
                  </div>
                )}
                {Array.isArray(m.tool_calls) && m.tool_calls.length > 0 && (
                  <div style={toolCallStyle}>
                    {m.tool_calls.map((c, j) => (
                      <span key={j}>
                        {c.name === 'searchProducts' ? '🔎' : '🔄'} {c.name}
                        {j < m.tool_calls.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {sending && <div style={asstBubbleStyle}><em>thinking…</em></div>}
            {error && <div style={errorStyle}>{error}</div>}
          </div>

          <div style={footerStyle}>
            {quotaStatus && !user && (
              <div style={quotaStyle}>
                {typeof quotaStatus.remaining === 'number'
                  ? `${quotaStatus.remaining} ${quotaStatus.remaining === 1 ? 'search' : 'searches'} left today`
                  : ''}
              </div>
            )}
            {quotaExhausted && (
              <div style={signInPromptStyle}>
                You've used your free searches today.{' '}
                <a href="/account" style={{ color: '#1d4ed8' }}>Sign in</a> for unlimited.
              </div>
            )}
            <div style={inputRowStyle}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Type a message…"
                disabled={sending}
                rows={2}
                style={inputStyle}
              />
              <button
                type="button"
                onClick={send}
                disabled={sending || input.trim().length === 0}
                style={sendBtnStyle}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// -----------------------------------------------------------------
// Product card rendering — session 6.
//
// The chat endpoint returns slimmed product records alongside the
// assistant prose (see api/ai/chat.js productCardMap). We render them
// as compact clickable cards below the assistant message. Clicking
// navigates to /products/<code> which the new generic route resolves
// to either catalog_products (PGifts Direct) or supplier_products
// (Laltex).
//
// We also linkify bare code mentions in the prose — when the model
// writes "MG0192" or "ocean-octopus" inline, we wrap it in an anchor
// so the customer can jump directly without scrolling to the card.
// -----------------------------------------------------------------

function ProductCard({ product }) {
  const href = `/products/${encodeURIComponent(product.supplier_product_code)}`;
  const tier = Array.isArray(product.pricing) && product.pricing.length > 0
    ? product.pricing[0]
    : null;
  const priceLabel = product.unit_price_at_quantity != null && !product.unit_price_at_quantity_is_poa
    ? `£${Number(product.unit_price_at_quantity).toFixed(2)}/unit`
    : tier
      ? `From £${Number(tier.price).toFixed(2)} (${tier.min}+)`
      : product.unit_price_at_quantity_is_poa
        ? 'POA'
        : null;
  return (
    <a
      href={href}
      style={cardStyle}
      onClick={(e) => {
        // Soft-navigate via location to keep the widget mount alive.
        // BrowserRouter picks up the change.
        e.preventDefault();
        window.history.pushState({}, '', href);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }}
    >
      <div style={cardImgWrap}>
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            style={cardImg}
            loading="lazy"
          />
        ) : (
          <div style={cardImgPlaceholder}>📦</div>
        )}
      </div>
      <div style={cardBody}>
        <div style={cardName}>{product.name}</div>
        <div style={cardMeta}>
          <span style={cardCode}>{product.supplier_product_code}</span>
          {priceLabel && <span style={cardPrice}>{priceLabel}</span>}
        </div>
      </div>
    </a>
  );
}

/**
 * Wrap supplier_product_codes inside the assistant text in anchor
 * tags so they're clickable. Codes are matched against the product
 * cards returned for this turn (no codes mentioned = no rewriting).
 *
 * We do a literal substring scan rather than regex so we don't
 * accidentally match unrelated alphanumeric strings.
 */
function linkifyProductCodes(text, products) {
  if (!text || !Array.isArray(products) || products.length === 0) return text;
  const codes = products
    .map((p) => p?.supplier_product_code)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length); // longest first so "octopus-mini" wins over "octopus"
  if (codes.length === 0) return text;

  const segments = [text];
  for (const code of codes) {
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      if (typeof seg !== 'string') continue;
      const idx = seg.indexOf(code);
      if (idx === -1) continue;
      const before = seg.slice(0, idx);
      const after = seg.slice(idx + code.length);
      const href = `/products/${encodeURIComponent(code)}`;
      const link = (
        <a
          key={`${code}-${i}`}
          href={href}
          onClick={(e) => {
            e.preventDefault();
            window.history.pushState({}, '', href);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          style={inlineLinkStyle}
        >
          {code}
        </a>
      );
      segments.splice(i, 1, before, link, after);
    }
  }
  return segments;
}

// -----------------------------------------------------------------
// Inline styles — DELIBERATELY MINIMAL. Session 6 replaces this with
// Tailwind classes + design tokens. Keep this file styling-free in
// any meaningful sense so the polish-phase diff is small and clean.
// -----------------------------------------------------------------

const launcherStyle = {
  position: 'fixed',
  right: 20,
  bottom: 20,
  width: 56,
  height: 56,
  borderRadius: '50%',
  background: '#1a1a1a',
  color: 'white',
  border: 'none',
  cursor: 'pointer',
  zIndex: 9000,
  fontWeight: 700,
  fontSize: 16,
  boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
};
const panelStyle = {
  position: 'fixed',
  right: 20,
  bottom: 20,
  width: PANEL_WIDTH,
  height: PANEL_HEIGHT,
  background: 'white',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: 14,
  zIndex: 9000,
};
const headerStyle = {
  padding: '10px 14px',
  borderBottom: '1px solid #e5e7eb',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontWeight: 600,
};
const closeBtnStyle = {
  background: 'transparent',
  border: 'none',
  fontSize: 22,
  lineHeight: 1,
  cursor: 'pointer',
  color: '#6b7280',
};
const historyStyle = {
  flex: 1,
  overflowY: 'auto',
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const hintStyle = { color: '#6b7280', fontSize: 13, padding: '12px 4px' };
const userBubbleStyle = {
  alignSelf: 'flex-end',
  maxWidth: '85%',
  background: '#dbeafe',
  padding: '8px 10px',
  borderRadius: 6,
};
const asstBubbleStyle = {
  alignSelf: 'flex-start',
  maxWidth: '92%',
  background: '#f3f4f6',
  padding: '8px 10px',
  borderRadius: 6,
};
const toolCallStyle = { marginTop: 6, fontSize: 11, color: '#6b7280' };
const errorStyle = { color: '#b91c1c', fontSize: 12, padding: '6px 4px' };
const footerStyle = { borderTop: '1px solid #e5e7eb', padding: 10 };
const quotaStyle = { fontSize: 11, color: '#6b7280', textAlign: 'right', marginBottom: 4 };
const signInPromptStyle = {
  fontSize: 12,
  color: '#1f2937',
  background: '#fef3c7',
  padding: '6px 8px',
  borderRadius: 4,
  marginBottom: 6,
};
const inputRowStyle = { display: 'flex', gap: 6 };
const inputStyle = {
  flex: 1,
  resize: 'none',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  padding: '6px 8px',
  fontFamily: 'inherit',
  fontSize: 14,
};
const sendBtnStyle = {
  background: '#1a1a1a',
  color: 'white',
  border: 'none',
  borderRadius: 4,
  padding: '0 12px',
  cursor: 'pointer',
  fontWeight: 600,
};

// Product cards
const cardListStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginTop: 8,
};
const cardStyle = {
  display: 'flex',
  gap: 8,
  background: 'white',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  padding: 6,
  textDecoration: 'none',
  color: 'inherit',
  cursor: 'pointer',
  transition: 'border-color 120ms',
};
const cardImgWrap = {
  width: 48,
  height: 48,
  flexShrink: 0,
  background: '#f3f4f6',
  borderRadius: 4,
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const cardImg = {
  width: '100%',
  height: '100%',
  objectFit: 'contain',
};
const cardImgPlaceholder = { fontSize: 24 };
const cardBody = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 2,
};
const cardName = {
  fontSize: 12,
  fontWeight: 600,
  color: '#111827',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
};
const cardMeta = {
  display: 'flex',
  gap: 8,
  fontSize: 11,
  color: '#6b7280',
};
const cardCode = {
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  background: '#f3f4f6',
  padding: '0 4px',
  borderRadius: 3,
};
const cardPrice = {
  fontWeight: 600,
  color: '#1d4ed8',
};
const inlineLinkStyle = {
  color: '#1d4ed8',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
};
