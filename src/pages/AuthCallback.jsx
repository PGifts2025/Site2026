import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader, CheckCircle, AlertCircle, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabaseService';

// Landing page for the Supabase signup verification email.
//
// Flow is IMPLICIT with detectSessionInUrl:true (see
// audit-email-verification-flow.md), so the Supabase client auto-parses the
// `#access_token=...&type=signup` hash on page load and establishes the
// session — no exchangeCodeForSession needed. The session surfaces through
// AuthContext's onAuthStateChange listener, so we just watch user/loading
// here, confirm success, and forward to /account. Implicit needs no PKCE
// verifier in localStorage, so the link still works across devices/browsers.
//
// TODO(auth-callback): magic-link (type=magiclink) and email-change
// (type=email_change) also arrive as implicit hashes and could be served here
// by branching on the URL `type`. They have no callers today, so no
// discrimination logic is added yet. Password recovery deliberately stays on
// its own /reset-password route (it needs a password-set form, not an
// auto-redirect) — do not merge it here.
export default function AuthCallback() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  // Capture whether we arrived with verification tokens BEFORE the client
  // strips the hash (detectSessionInUrl clears it after parsing). Read once at
  // first render so the signal survives the parse.
  const [hadAuthHash] = useState(
    () => typeof window !== 'undefined' && window.location.hash.includes('access_token'),
  );
  const [status, setStatus] = useState('verifying'); // 'verifying' | 'success' | 'error'

  // Resend-verification mini-form (error state only).
  const [resendEmail, setResendEmail] = useState('');
  const [resendState, setResendState] = useState('idle'); // 'idle' | 'sending' | 'sent'

  useEffect(() => {
    // Wait for AuthContext to finish resolving the URL hash / initial session.
    if (loading) return;

    if (user) {
      if (hadAuthHash) {
        // Genuine verification landing — show confirmation, then forward.
        setStatus('success');
        const t = setTimeout(() => navigate('/account', { replace: true }), 1800);
        return () => clearTimeout(t);
      }
      // Already signed in with no verification tokens (e.g. the link was
      // clicked in a tab that's already authed) — skip the success screen and
      // go straight to the account, no "verifying…" flash.
      navigate('/account', { replace: true });
      return;
    }

    // Not loading, no user. If a token hash was present the client may still
    // be racing to establish the session — a landing `user` change re-runs
    // this effect and cancels the timer. Otherwise it's a direct visit, or an
    // expired / already-used link.
    const t = setTimeout(() => setStatus('error'), hadAuthHash ? 2500 : 1200);
    return () => clearTimeout(t);
  }, [user, loading, hadAuthHash, navigate]);

  const handleResend = async (e) => {
    e.preventDefault();
    if (!resendEmail || resendState === 'sending') return;
    setResendState('sending');
    try {
      await supabase.auth.resend({
        type: 'signup',
        email: resendEmail,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
    } catch {
      // Swallow — we show the same neutral message regardless so we don't leak
      // whether an address is registered.
    } finally {
      setResendState('sent');
    }
  };

  if (status === 'verifying') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
          <Loader className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Verifying your email…</h1>
          <p className="text-sm text-gray-600">This will only take a moment.</p>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
          <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Email verified</h1>
          <p className="text-sm text-gray-600">
            You&apos;re signed in. Taking you to your account…
          </p>
        </div>
      </div>
    );
  }

  // error
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
        <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-gray-900 mb-2">We couldn&apos;t verify this link</h1>
        <p className="text-sm text-gray-600 mb-6">
          It may have expired or already been used. Sign in if your account is
          already verified, or request a new verification email below.
        </p>

        <button
          onClick={() => navigate('/')}
          className="w-full mb-4 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
        >
          Go to sign in
        </button>

        {resendState === 'sent' ? (
          <p className="text-sm text-green-700 flex items-center justify-center gap-1">
            <CheckCircle className="h-4 w-4" />
            If that address needs verifying, a new link is on its way.
          </p>
        ) : (
          <form onSubmit={handleResend} className="space-y-2 text-left">
            <label className="block text-sm font-medium text-gray-700">Resend verification</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="email"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              type="submit"
              disabled={!resendEmail || resendState === 'sending'}
              className="w-full flex items-center justify-center space-x-2 py-2 bg-gray-900 text-white rounded-lg font-semibold hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resendState === 'sending' ? (
                <>
                  <Loader className="h-4 w-4 animate-spin" />
                  <span>Sending…</span>
                </>
              ) : (
                <span>Resend verification email</span>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
