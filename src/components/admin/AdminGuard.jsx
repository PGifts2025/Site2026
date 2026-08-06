import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabaseService';
import { useAuth } from '../../context/AuthContext';
import AuthModal from '../auth/AuthModal';
import { Loader } from 'lucide-react';

/**
 * AdminGuard
 *
 * Protects admin routes. Auth existence is taken from AuthContext (storage-backed
 * getSession + a settled `loading` flag) rather than an independent network
 * getUser() call. The old version called getUser() on mount and treated EVERY
 * failure — including a transient network blip on a cold load — as a fatal
 * "Access Error" that bounced to the homepage, so a legitimately signed-in admin
 * could be ejected and look locked out (audit-admin-roles-and-access.md §2.2).
 *
 * Four outcomes, kept distinct:
 *   - auth still loading            -> wait (no decision yet)
 *   - no session                    -> sign in IN PLACE (AuthModal), returning to
 *                                      this same admin route on success. No home
 *                                      bounce, no error screen.
 *   - signed in, not an admin       -> clear "no access" state
 *   - signed in, role check failed  -> transient error with Retry, NOT a lockout
 *   - signed in and an admin        -> render the page (adminRole passed through)
 *
 * Only the team_members role lookup (dashboard gate) lives here; RLS still gates
 * the data separately via the is_admin metadata flag (audit §1.1).
 */

const Screen = ({ children }) => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center">
    <div className="text-center">{children}</div>
  </div>
);

const AdminGuard = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  // 'checking' | 'authorized' | 'denied' | 'error'
  const [roleState, setRoleState] = useState('checking');
  const [adminRole, setAdminRole] = useState(null);

  const checkRole = useCallback(async () => {
    if (!user) return;
    setRoleState('checking');
    try {
      const { data, error } = await supabase
        .from('team_members')
        .select('role, is_active, first_name, last_name')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      // maybeSingle(): no row -> data null, error null (a genuine "not an admin",
      // NOT a failure). A thrown/returned error here is a real/transient problem.
      if (error) throw error;

      if (!data || (data.role !== 'super_admin' && data.role !== 'staff')) {
        console.log('[AdminGuard] signed in but not an admin:', user.email);
        setRoleState('denied');
        return;
      }

      setAdminRole(data.role);
      setRoleState('authorized');
    } catch (err) {
      // Transient (network/RLS hiccup) — do NOT treat as a lockout.
      console.error('[AdminGuard] role check failed (transient, retryable):', err);
      setRoleState('error');
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && user) checkRole();
  }, [authLoading, user, checkRole]);

  // 1. Wait for auth to settle before deciding anything.
  if (authLoading) {
    return (
      <Screen>
        <Loader className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
        <p className="text-gray-600">Verifying admin access...</p>
      </Screen>
    );
  }

  // 2. No session -> sign in IN PLACE. The modal renders on this admin route, so a
  //    successful sign-in flips `user` truthy, this guard re-renders here, and the
  //    admin page loads. No homepage bounce, no "Access Error". Dismiss -> home.
  if (!user) {
    return <AuthModal isOpen onClose={() => navigate('/')} initialMode="signin" />;
  }

  // 3. Signed in, role lookup in flight.
  if (roleState === 'checking') {
    return (
      <Screen>
        <Loader className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
        <p className="text-gray-600">Verifying admin access...</p>
      </Screen>
    );
  }

  // 4. Transient failure -> retry, never a silent lockout.
  if (roleState === 'error') {
    return (
      <Screen>
        <div className="bg-amber-50 text-amber-800 px-6 py-4 rounded-lg mb-4 max-w-sm">
          <p className="font-semibold">Could not verify your access</p>
          <p className="text-sm mt-2">This is usually a temporary connection issue, not a permissions problem.</p>
        </div>
        <button
          onClick={checkRole}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Try again
        </button>
      </Screen>
    );
  }

  // 5. Signed in but not an admin -> clear no-access state.
  if (roleState === 'denied') {
    return (
      <Screen>
        <div className="bg-red-50 text-red-700 px-6 py-4 rounded-lg mb-4 max-w-sm">
          <p className="font-semibold">You do not have access to the admin area</p>
          <p className="text-sm mt-2">This account is signed in but is not an admin. If that is wrong, ask an existing admin to add you.</p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
        >
          Back to site
        </button>
      </Screen>
    );
  }

  // 6. Authorized — pass the user + role through, as before.
  return React.cloneElement(children, { user, adminRole });
};

export default AdminGuard;
