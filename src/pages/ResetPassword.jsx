import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Loader, AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '../services/supabaseService';

// Public page landed on from the Supabase password-reset email. Supabase
// client reads the `#access_token=...&type=recovery` hash on page load and
// auto-establishes a recovery session — we then let the user set a new password
// via supabase.auth.updateUser({ password }). Success keeps them signed in
// (option A from the spec); recovery-session-missing routes back to the
// forgot-password flow without surfacing raw Supabase errors.
//
// Password policy mirrors the Supabase project config (min 6, no required
// character classes as of 2026-04). If that policy tightens, update MIN_LEN
// and the helper text together — Supabase does not ship its rules to the
// client, so we keep them in sync manually.
const MIN_LEN = 6;

const ResetPassword = () => {
  const navigate = useNavigate();
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionValid, setSessionValid] = useState(false);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Confirm the recovery session Supabase auto-created from the URL hash.
  // Wait one tick for onAuthStateChange PASSWORD_RECOVERY to land.
  useEffect(() => {
    let cancelled = false;
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      setSessionValid(!!session);
      setCheckingSession(false);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (session && !sessionValid)) {
        setSessionValid(true);
        setCheckingSession(false);
      }
    });
    checkSession();
    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const passwordLongEnough = password.length >= MIN_LEN;
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const canSubmit = passwordLongEnough && passwordsMatch && !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        // Session-expired / missing-session variants land here. Don't surface
        // the raw message — push them back through the forgot flow.
        const msg = (updateError.message || '').toLowerCase();
        if (msg.includes('session') || msg.includes('expired') || msg.includes('jwt')) {
          navigate('/', { state: { flash: 'Reset link expired — please request a new one.' } });
          return;
        }
        setError(updateError.message || 'Could not update password. Please try again.');
        return;
      }
      navigate('/account', {
        state: { flash: 'Password updated — you are signed in.' },
      });
    } catch (err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader className="h-10 w-10 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!sessionValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
          <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Reset link is invalid or expired</h1>
          <p className="text-sm text-gray-600 mb-6">
            Password reset links expire after a short time. Please request a new one from the sign-in page.
          </p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Back to home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Set a new password</h1>
        <p className="text-sm text-gray-600 mb-6">Choose a new password for your account.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
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
            {submitting ? (
              <>
                <Loader className="h-5 w-5 animate-spin" />
                <span>Updating...</span>
              </>
            ) : (
              <span>Update password</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;
