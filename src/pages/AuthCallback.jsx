import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader, CheckCircle, AlertCircle, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabaseService';

// Click-to-verify email confirmation landing.
//
// WHY A BUTTON, NOT AUTO-VERIFY:
// Email security scanners (Outlook / Microsoft Defender, Mimecast, Proofpoint,
// and many corporate gateways) PRE-FETCH every URL in an incoming email to
// inspect it. Supabase verification tokens are SINGLE-USE, so an
// auto-verify-on-load page has its token consumed by the scanner before the
// human ever clicks — the real click then hits a spent token. (This is exactly
// why the previous auto-verify flow failed for Outlook/Hotmail users.)
//
// Defense: do NOT verify on page load. The email link carries `token_hash` +
// `type` as QUERY params (via the {{ .TokenHash }} email template). A token is
// NOT consumed by appearing in a URL — only by `verifyOtp` being called. We
// render a button and call verifyOtp only on the click, a gesture scanners do
// not perform. The token survives the pre-fetch.
//
// DO NOT call verifyOtp automatically (useEffect, hover, timer, etc.) — the
// button click is the entire defense. Auto-calling it anywhere reopens the bug.
//
// `type` is read from the URL (the template sends `email`); per Supabase docs
// the token_hash flow uses type 'email' ('signup' is deprecated).
//
// TODO(click-to-verify recovery): password reset (/reset-password) shares this
// scanner vulnerability and should adopt the same click-to-verify pattern in a
// follow-up PR. Out of scope here.
export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading } = useAuth();

  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') || 'email';
  const next = searchParams.get('next') || '/account';

  // 'awaiting' (button shown) | 'verifying' | 'success' | 'error'
  const [status, setStatus] = useState('awaiting');

  // Resend-verification mini-form (error state only).
  const [resendEmail, setResendEmail] = useState('');
  const [resendState, setResendState] = useState('idle'); // 'idle' | 'sending' | 'sent'

  // Already-signed-in with no token in the URL (e.g. link clicked in a tab
  // that's already authed, or a stray visit) → go straight to the account.
  useEffect(() => {
    if (!tokenHash && !loading && user) {
      navigate(next, { replace: true });
    }
  }, [tokenHash, loading, user, next, navigate]);

  const handleVerify = async () => {
    if (!tokenHash || status === 'verifying') return;
    setStatus('verifying');
    try {
      // The ONLY place the token is consumed — a real user gesture.
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) {
        setStatus('error');
        return;
      }
      // verifyOtp sets the session (persistSession:true) and fires SIGNED_IN
      // through AuthContext's listener. Show success briefly, then forward.
      setStatus('success');
      setTimeout(() => navigate(next, { replace: true }), 1500);
    } catch {
      setStatus('error');
    }
  };

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
      // Swallow — same neutral message regardless, so we don't leak whether an
      // address is registered.
    } finally {
      setResendState('sent');
    }
  };

  const Card = ({ children }) => (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
        {children}
      </div>
    </div>
  );

  // No token in the URL: either we're about to redirect a signed-in user, or
  // it's a direct/no-token visit. Show a neutral spinner while auth resolves,
  // then the error card. (No verifyOtp here — there is nothing to verify.)
  if (!tokenHash) {
    if (loading || user) {
      return (
        <Card>
          <Loader className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">One moment…</h1>
        </Card>
      );
    }
    return <ErrorCard
      resendEmail={resendEmail}
      setResendEmail={setResendEmail}
      resendState={resendState}
      onResend={handleResend}
      onSignIn={() => navigate('/')}
    />;
  }

  if (status === 'awaiting') {
    return (
      <Card>
        <ShieldCheck className="h-12 w-12 text-blue-600 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-gray-900 mb-2">One more step</h1>
        <p className="text-sm text-gray-600 mb-6">
          Click below to verify your email and sign in to your account.
        </p>
        <button
          onClick={handleVerify}
          className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
        >
          Verify and sign in
        </button>
        <p className="text-xs text-gray-400 mt-3">
          This extra click protects your account against automated link scanners.
        </p>
      </Card>
    );
  }

  if (status === 'verifying') {
    return (
      <Card>
        <Loader className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
        <h1 className="text-xl font-bold text-gray-900 mb-2">Verifying your email…</h1>
        <p className="text-sm text-gray-600">This will only take a moment.</p>
      </Card>
    );
  }

  if (status === 'success') {
    return (
      <Card>
        <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-gray-900 mb-2">Email verified</h1>
        <p className="text-sm text-gray-600">
          You&apos;re signed in. Taking you to your account…
        </p>
      </Card>
    );
  }

  // status === 'error'
  return <ErrorCard
    resendEmail={resendEmail}
    setResendEmail={setResendEmail}
    resendState={resendState}
    onResend={handleResend}
    onSignIn={() => navigate('/')}
  />;
}

// Error card (shared by the no-token and failed-verify paths). Carries over the
// PR #59 "couldn't verify" UI with the sign-in + resend-verification actions.
function ErrorCard({ resendEmail, setResendEmail, resendState, onResend, onSignIn }) {
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
          onClick={onSignIn}
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
          <form onSubmit={onResend} className="space-y-2 text-left">
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
