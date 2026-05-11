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
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
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
