import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Loader, AlertCircle, CheckCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabaseService';

// Password-reset landing — CLICK-TO-VERIFY (sibling of AuthCallback.jsx / PR #60).
//
// WHY A BUTTON, NOT AUTO-VERIFY:
// Email security scanners (Outlook / Microsoft Defender, Mimecast, Proofpoint,
// corporate gateways) PRE-FETCH every URL in incoming mail to inspect it.
// Supabase recovery tokens are SINGLE-USE, so an auto-verify-on-load page has
// its token consumed by the scanner before the human ever clicks. The previous
// implementation auto-consumed the recovery token via detectSessionInUrl on
// load — same vulnerability the signup flow had.
//
// Defense: read `token_hash` + `type` from the QUERY string and call verifyOtp
// ONLY on a button click. A token is not spent by appearing in a URL, only by
// verifyOtp. After verification establishes the recovery session, we show the
// new-password form and call updateUser ONLY on form submit.
//
// DO NOT call verifyOtp on mount / effect / hover, and DO NOT call updateUser
// before the form submit — those gestures are the entire defense.
//
// type is 'recovery' (the recovery token_hash flow). The email template must
// link to /reset-password?token_hash={{ .TokenHash }}&type=recovery — see
// docs/supabase-email-template-reset-password.html.

const MIN_LEN = 6; // mirrors the Supabase project policy + the signup form

// Module-level wrappers (NOT defined inside the component) so the password
// inputs in the form state don't remount + lose focus on each keystroke.
function Card({ children, center = true }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className={`bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md w-full ${center ? 'text-center' : ''}`}>
        {children}
      </div>
    </div>
  );
}

function ErrorCard({ resendEmail, setResendEmail, resendState, onResend, onSignIn }) {
  return (
    <Card>
      <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
      <h1 className="text-xl font-bold text-gray-900 mb-2">This reset link didn&apos;t work</h1>
      <p className="text-sm text-gray-600 mb-6">
        It may have expired or already been used. Reset links are valid for a
        short time. Request a fresh one below, or head back to sign in.
      </p>

      <button
        onClick={onSignIn}
        className="w-full mb-4 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
      >
        Back to sign in
      </button>

      {resendState === 'sent' ? (
        <p className="text-sm text-green-700 flex items-center justify-center gap-1">
          <CheckCircle className="h-4 w-4" />
          If that address has an account, a new reset link is on its way.
        </p>
      ) : (
        <form onSubmit={onResend} className="space-y-2 text-left">
          <label className="block text-sm font-medium text-gray-700">Request another reset email</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
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
              <span>Send reset link</span>
            )}
          </button>
        </form>
      )}
    </Card>
  );
}

const ResetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading } = useAuth();

  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') || 'recovery';
  const next = searchParams.get('next') || '/account';

  // 'awaiting' | 'verifying' | 'set-new-password' | 'updating' | 'success' | 'error'
  const [status, setStatus] = useState('awaiting');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [formError, setFormError] = useState(null);

  // Request-another-reset mini-form (error state).
  const [resendEmail, setResendEmail] = useState('');
  const [resendState, setResendState] = useState('idle'); // 'idle' | 'sending' | 'sent'

  // Already signed in with no recovery token in the URL (stray direct visit)
  // → straight to the account. If a token IS present, let the recovery flow
  // proceed (it establishes a fresh session that overrides any stale one).
  useEffect(() => {
    if (!tokenHash && !loading && user) {
      navigate(next, { replace: true });
    }
  }, [tokenHash, loading, user, next, navigate]);

  const passwordLongEnough = password.length >= MIN_LEN;
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const canSubmit = passwordLongEnough && passwordsMatch && status !== 'updating';

  const handleVerify = async () => {
    if (!tokenHash || status === 'verifying') return;
    setStatus('verifying');
    try {
      // The ONLY place the recovery token is consumed — a real user gesture.
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) {
        setStatus('error');
        return;
      }
      setStatus('set-new-password');
    } catch {
      setStatus('error');
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setFormError(null);
    setStatus('updating');
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('session') || msg.includes('expired') || msg.includes('jwt')) {
          // Recovery session lost between verify and submit — send them back to
          // request a fresh link rather than surface a raw Supabase error.
          setStatus('error');
          return;
        }
        setFormError(error.message || 'Could not update password. Please try again.');
        setStatus('set-new-password');
        return;
      }
      setStatus('success');
      setTimeout(() => navigate(next, { replace: true }), 1500);
    } catch {
      setFormError('Something went wrong. Please try again.');
      setStatus('set-new-password');
    }
  };

  const handleResend = async (e) => {
    e.preventDefault();
    if (!resendEmail || resendState === 'sending') return;
    setResendState('sending');
    try {
      await supabase.auth.resetPasswordForEmail(resendEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } catch {
      // Swallow — same neutral message regardless, so we don't leak whether an
      // address has an account.
    } finally {
      setResendState('sent');
    }
  };

  const errorCardProps = {
    resendEmail,
    setResendEmail,
    resendState,
    onResend: handleResend,
    onSignIn: () => navigate('/'),
  };

  // No token in the URL: redirect a signed-in user (effect), spinner while auth
  // resolves, otherwise the error card. (No verifyOtp here — nothing to verify.)
  if (!tokenHash) {
    if (loading || user) {
      return (
        <Card>
          <Loader className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900">One moment…</h1>
        </Card>
      );
    }
    return <ErrorCard {...errorCardProps} />;
  }

  if (status === 'awaiting') {
    return (
      <Card>
        <ShieldCheck className="h-12 w-12 text-blue-600 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-gray-900 mb-2">Reset your password</h1>
        <p className="text-sm text-gray-600 mb-6">
          Click below to verify your reset link and set a new password.
        </p>
        <button
          onClick={handleVerify}
          className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
        >
          Continue
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
        <h1 className="text-xl font-bold text-gray-900 mb-2">Verifying…</h1>
        <p className="text-sm text-gray-600">This will only take a moment.</p>
      </Card>
    );
  }

  if (status === 'updating') {
    return (
      <Card>
        <Loader className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
        <h1 className="text-xl font-bold text-gray-900 mb-2">Updating password…</h1>
      </Card>
    );
  }

  if (status === 'success') {
    return (
      <Card>
        <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-gray-900 mb-2">Password updated</h1>
        <p className="text-sm text-gray-600">Taking you to your account…</p>
      </Card>
    );
  }

  if (status === 'set-new-password') {
    return (
      <Card center={false}>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Set a new password</h1>
        <p className="text-sm text-gray-600 mb-6">Choose a new password for your account.</p>

        <form onSubmit={handleUpdate} className="space-y-4">
          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{formError}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">New password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
              />
            </div>
            <p className={`text-xs mt-1 ${password.length === 0 ? 'text-gray-500' : passwordLongEnough ? 'text-green-600' : 'text-gray-500'}`}>
              Minimum {MIN_LEN} characters
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Confirm password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={() => setConfirmTouched(true)}
                required
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
              />
            </div>
            {confirmTouched && confirmPassword.length > 0 && (
              passwordsMatch ? (
                <p className="text-xs mt-1 text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" /> Passwords match
                </p>
              ) : (
                <p className="text-xs mt-1 text-red-600">Passwords do not match</p>
              )
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full flex items-center justify-center space-x-2 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>Update password</span>
          </button>
        </form>
      </Card>
    );
  }

  // status === 'error'
  return <ErrorCard {...errorCardProps} />;
};

export default ResetPassword;
