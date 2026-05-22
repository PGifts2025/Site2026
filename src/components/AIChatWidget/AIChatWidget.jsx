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
// conversations live in component state. The header has two buttons:
//   −  Minimise — collapses the panel but preserves messages, input,
//                 and conversationId so the customer can resume.
//   ×  Close   — collapses AND clears all client-side conversation
//                 state. The server-side rolling 24h quota survives
//                 either action (clearing the client doesn't reset
//                 quota on the backend).
// Re-opening from minimise scrolls to the bottom of the preserved
// conversation. Re-opening from close shows the empty hint.

import { cloneElement, useEffect, useRef, useState } from 'react';

import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../services/supabaseService';

const PUBLIC_ENABLED = String(import.meta.env.VITE_AI_CHAT_PUBLIC_ENABLED ?? '').toLowerCase() === 'true';

// Canonical Ava avatar path. The ?v=2 query string is a cache-bust so
// returning visitors get the new image without a hard refresh (browsers
// cache by URL). Bump to ?v=3 etc. on future image swaps — single edit
// covers the launcher, panel header, and assistant message bubbles.
// File is lowercase ava.png; Vercel is case-sensitive — do NOT capitalise.
const AVA_AVATAR_SRC = '/images/ava.png?v=2';

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

export default function AIChatWidget() {
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // [{ role, content, tool_calls? }]
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [quotaStatus, setQuotaStatus] = useState(null);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  // Listen for `pgifts:open-chat` from the homepage Ava card (and any
  // future programmatic opener). Detail shape:
  //   { prefill?: string, welcomeMessage?: string }
  // Behaviour:
  //   - setOpen(true)
  //   - setInput(prefill) when provided (allows empty string to clear)
  //   - prepend welcomeMessage as an assistant message IF not already
  //     at the top of messages (idempotent — re-clicks don't double
  //     the welcome). Does NOT touch quota or hit the API.
  //   - auto-focus the textarea after the panel mounts.
  // CLAUDE.md §49.
  useEffect(() => {
    const handler = (e) => {
      setOpen(true);
      if (typeof e?.detail?.prefill === 'string') {
        setInput(e.detail.prefill);
      }
      const welcome = e?.detail?.welcomeMessage;
      if (typeof welcome === 'string' && welcome.length > 0) {
        setMessages((m) => {
          if (m[0]?.role === 'assistant' && m[0]?.content === welcome) return m;
          return [{ role: 'assistant', content: welcome, tool_calls: [], products: [] }, ...m];
        });
      }
      // Wait for the panel to mount (the {open && (...)} branch
      // renders the textarea conditionally).
      setTimeout(() => {
        try { textareaRef.current?.focus(); } catch { /* ignore */ }
      }, 50);
    };
    window.addEventListener('pgifts:open-chat', handler);
    return () => window.removeEventListener('pgifts:open-chat', handler);
  }, []);

  // Auto-scroll to bottom when:
  //   (a) a new message arrives, OR
  //   (b) the panel re-opens with preserved messages. The conditional
  //       render of the panel at `{open && (…)}` remounts a fresh
  //       scrollRef each open cycle, defaulting to scrollTop=0; without
  //       this trigger, customers resuming a minimised conversation
  //       would land scrolled to the top of the history.
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, messages]);

  // Visibility gate. Signed-in customers always get AVA, on every route
  // (the widget is mounted globally in App.jsx, so it persists across
  // navigation). Anonymous visitors stay behind the env flag (the documented
  // soft-launch gate, CLAUDE.md §32.3) until public launch. The previous
  // per-profile `ai_chat_enabled` gate for signed-in users was the tester-only
  // soft-launch limiter and is intentionally retired now that AVA is open to
  // all logged-in customers.
  if (loading) return null;
  const visible = user ? true : PUBLIC_ENABLED;
  if (!visible) return null;

  // Minimise: collapse the panel, preserve everything. Re-opening
  // (via launcher or another `pgifts:open-chat`) lands the customer
  // back on the same conversation, scrolled to the bottom.
  const handleMinimise = () => {
    setOpen(false);
  };

  // Close: collapse + full client-side state clear. The server's
  // rolling 24h quota is keyed on visitor_id_hash and is unaffected
  // by clearing the client; we deliberately do NOT clear quotaStatus
  // here so the displayed remaining-count keeps reflecting server
  // reality (a customer who used 3/5 searches then closed should
  // still see "2 searches left today" on next open).
  const handleClose = () => {
    setOpen(false);
    setMessages([]);
    setInput('');
    setConversationId(null);
    setError(null);
  };

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
          // Pagination contract (CLAUDE.md §55):
          //   `products`           = rendered now (server-sent first batch of 5).
          //   `products_remainder` = revealed in batches of 5 on "Show me more"
          //                          click. Pre-loaded — no follow-up tool call.
          //   Each message holds its own pagination state so customers can
          //   scroll back to an earlier result set and keep expanding it.
          products: Array.isArray(data?.products) ? data.products : [],
          products_remainder: Array.isArray(data?.products_remainder)
            ? data.products_remainder
            : [],
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

  // "Show me more" pagination handler (CLAUDE.md §55).
  // Moves BATCH_SIZE items from products_remainder into products for the
  // given message index. Pure local state update — no network call.
  // Each message's pagination state is independent, so a customer can
  // scroll back to an earlier result set and keep expanding it after
  // sending further messages.
  const SHOW_MORE_BATCH_SIZE = 5;
  const revealMoreProducts = (messageIndex) => {
    setMessages((prev) => prev.map((msg, idx) => {
      if (idx !== messageIndex) return msg;
      const remainder = Array.isArray(msg.products_remainder) ? msg.products_remainder : [];
      if (remainder.length === 0) return msg;
      const toReveal = remainder.slice(0, SHOW_MORE_BATCH_SIZE);
      const stillRemaining = remainder.slice(SHOW_MORE_BATCH_SIZE);
      return {
        ...msg,
        products: [...(msg.products || []), ...toReveal],
        products_remainder: stillRemaining,
      };
    }));
  };

  const quotaExhausted =
    !user &&
    quotaStatus &&
    typeof quotaStatus.remaining === 'number' &&
    quotaStatus.remaining <= 0;

  return (
    <>
      {/* Floating launcher. When a minimised conversation exists
          (messages.length > 0), show a small indigo dot badge in the
          top-right corner of the launcher so the customer knows there
          is preserved chat waiting. The badge disappears on the next
          full close. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={launcherStyle}
          aria-label={messages.length > 0 ? 'Resume AI conversation' : 'Open AI assistant'}
        >
          <img
            src={AVA_AVATAR_SRC}
            alt="Ava"
            loading="eager"
            style={launcherImgStyle}
          />
          {messages.length > 0 && <span style={launcherBadgeStyle} aria-hidden="true" />}
        </button>
      )}

      {open && (
        <div style={panelStyle} role="dialog" aria-label="PGifts AI assistant">
          <div style={headerStyle}>
            <div style={headerTitleStyle}>
              <img src={AVA_AVATAR_SRC} alt="Ava" style={headerAvatarStyle} />
              <span>PGifts AI assistant <span style={{ opacity: 0.6, fontSize: 11 }}>(beta)</span></span>
            </div>
            <div style={headerBtnGroupStyle}>
              <button
                type="button"
                style={iconBtnStyle}
                onClick={handleMinimise}
                aria-label="Minimise chat"
                title="Minimise (keeps your conversation)"
              >
                {/* U+2212 minus sign — the universally understood
                    minimise glyph (matches desktop window controls),
                    renders consistently across fonts. */}
                −
              </button>
              <button
                type="button"
                style={iconBtnStyle}
                onClick={handleClose}
                aria-label="Close and clear chat"
                title="Close and clear chat"
              >
                ×
              </button>
            </div>
          </div>

          <div ref={scrollRef} style={historyStyle}>
            {messages.length === 0 && (
              <div style={hintStyle}>
                Ask about products, prices, lead times, or "find me something
                like X". I can search our full catalogue.
              </div>
            )}
            {messages.map((m, i) => {
              const isUser = m.role === 'user';
              const bubble = (
              <div style={isUser ? userBubbleStyle : asstBubbleStyle}>
                <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 2 }}>
                  {isUser ? 'You' : 'Assistant'}
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>
                  {!isUser
                    ? linkifyProductCodes(m.content, m.products)
                    : m.content}
                </div>
                {Array.isArray(m.products) && m.products.length > 0 && (
                  <div style={cardListStyle}>
                    {m.products.map((p) => (
                      <ProductCard key={p.supplier_product_code} product={p} />
                    ))}
                    {/* "Show me more" card — pure client-side pagination
                        from the pre-loaded `products_remainder` cache. No
                        new chat round-trip, no LLM cost, no quota hit.
                        See CLAUDE.md §55. */}
                    {Array.isArray(m.products_remainder) && m.products_remainder.length > 0 && (
                      <ShowMoreCard
                        remainingCount={m.products_remainder.length}
                        onClick={() => revealMoreProducts(i)}
                      />
                    )}
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
              );
              // User messages stay exactly as before: right-aligned bubble,
              // no avatar (the bubble already carries userBubbleStyle, so
              // render it directly as the flex child via cloneElement).
              // Assistant messages get a 24px Ava avatar to the left in a
              // flex row; the row owns column alignment, the bubble keeps
              // its own background/padding.
              if (isUser) return cloneElement(bubble, { key: i });
              return (
                <div key={i} style={asstRowStyle}>
                  <img src={AVA_AVATAR_SRC} alt="Ava" loading="lazy" style={msgAvatarStyle} />
                  {bubble}
                </div>
              );
            })}
            {/* Typing indicator is an assistant-style message; give it the
                same Ava avatar + row treatment so it reads consistently. */}
            {sending && (
              <div style={asstRowStyle}>
                <img src={AVA_AVATAR_SRC} alt="Ava" loading="lazy" style={msgAvatarStyle} />
                <div style={asstBubbleStyle}><em>thinking…</em></div>
              </div>
            )}
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
                {/* These users are anonymous (no account yet), so "Create account"
                    is the accurate CTA. ?auth=signup opens the AuthModal on the
                    Create Account tab via CustomerGuard. */}
                <a href="/account?auth=signup" style={{ color: '#1d4ed8' }}>Create account</a> for unlimited.
              </div>
            )}
            <div style={inputRowStyle}>
              <textarea
                ref={textareaRef}
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
  // MOQ-aware "From" tier: prefer the lowest tier whose min_qty meets the
  // product's commercial MOQ. Falls back to pricing[0] for products
  // without a declared MOQ. Fixes the previous "From £x.xx (1+)" surface
  // that quoted a per-unit price the customer couldn't actually order
  // at — bundled fix per CLAUDE.md §46 / Task 8 §5.2.
  const moq = Number(product.minimum_order_qty);
  const pricingArr = Array.isArray(product.pricing) ? product.pricing : [];
  const tier = pricingArr.length === 0
    ? null
    : (Number.isFinite(moq) && moq > 0
        ? (pricingArr.find((t) => Number(t.min) >= moq) ?? pricingArr[0])
        : pricingArr[0]);
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
 * "Show me more" reveal card (CLAUDE.md §55). Renders below the
 * visible product cards when the pagination remainder is non-empty.
 * Click reveals the next BATCH_SIZE items from the in-message cache;
 * no network call, no LLM round-trip.
 *
 * Visually distinct from a ProductCard — soft indigo tint signals
 * "action, not product". Width matches the card list so it lines up
 * underneath the cards.
 */
function ShowMoreCard({ remainingCount, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={showMoreCardStyle}
      aria-label={`Show ${Math.min(remainingCount, 5)} more matches (${remainingCount} cached)`}
    >
      Show me more →
    </button>
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
  // White (was #1a1a1a). ava.png has transparent alpha; black would
  // show through and frame the face oddly. White matches the avatar
  // wrappers on Home + AvaPromptCard.
  background: '#ffffff',
  color: 'white',
  border: 'none',
  cursor: 'pointer',
  zIndex: 9000,
  fontWeight: 700,
  fontSize: 16,
  boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
  padding: 0,
  overflow: 'hidden',
};
// Ava image fills the 56x56 launcher circle, masked by the button's
// borderRadius: 50% + overflow: hidden.
const launcherImgStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  borderRadius: '50%',
  display: 'block',
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
// Title block: 32px Ava avatar + the existing title text, in a flex row.
const headerTitleStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  minWidth: 0,
};
const headerAvatarStyle = {
  width: 32,
  height: 32,
  borderRadius: '50%',
  objectFit: 'cover',
  background: '#fff',
  flexShrink: 0,
};
// Shared style for the minimise (−) and close (×) header buttons.
// Was `closeBtnStyle` pre-Task-16; renamed for the two-button pattern.
const iconBtnStyle = {
  background: 'transparent',
  border: 'none',
  fontSize: 22,
  lineHeight: 1,
  cursor: 'pointer',
  color: '#6b7280',
  padding: '0 6px',
  minWidth: 24,
};
const headerBtnGroupStyle = {
  display: 'flex',
  gap: 2,
  alignItems: 'center',
};

// Indigo dot badge on the launcher when a minimised conversation
// exists. Sits in the launcher's top-right corner. The dark ring
// (boxShadow) matches the launcher's black background so the badge
// reads as a distinct visual element. Position: absolute is relative
// to the launcher's position: fixed (fixed creates a positioning
// context for absolute children).
const launcherBadgeStyle = {
  position: 'absolute',
  top: 6,
  right: 6,
  width: 10,
  height: 10,
  borderRadius: '50%',
  background: '#6366f1',
  boxShadow: '0 0 0 2px #1a1a1a',
  pointerEvents: 'none',
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
// Assistant bubble is now a flex child of asstRowStyle (avatar + bubble).
// The row owns column alignment + max width; the bubble keeps its own
// background/padding. minWidth:0 lets long content wrap inside the row.
const asstBubbleStyle = {
  background: '#f3f4f6',
  padding: '8px 10px',
  borderRadius: 6,
  minWidth: 0,
};
// Row wrapper for assistant messages: 24px Ava avatar to the left of the
// bubble. alignSelf positions the whole row left in the history column.
const asstRowStyle = {
  alignSelf: 'flex-start',
  maxWidth: '92%',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 6,
};
const msgAvatarStyle = {
  width: 24,
  height: 24,
  borderRadius: '50%',
  objectFit: 'cover',
  background: '#fff',
  flexShrink: 0,
  marginTop: 2,
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
// "Show me more" pagination button (CLAUDE.md §55). Soft indigo to
// signal it's an action, not a product. Sits inside cardListStyle's
// flex column so it lines up underneath the visible product cards.
const showMoreCardStyle = {
  display: 'block',
  width: '100%',
  padding: '10px 12px',
  background: 'rgba(99, 102, 241, 0.08)',
  border: '1px solid rgba(99, 102, 241, 0.35)',
  borderRadius: 6,
  color: '#4f46e5',
  fontWeight: 600,
  fontSize: 13,
  textAlign: 'center',
  cursor: 'pointer',
  transition: 'background 120ms, border-color 120ms',
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
