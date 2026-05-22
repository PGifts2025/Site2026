import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import AuthModal from './AuthModal';

/**
 * CustomerGuard Component
 * Protects customer routes by checking if user is authenticated
 */
const CustomerGuard = ({ children }) => {
  const { user, loading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    // Render the auth modal in place. This used to also render a sibling
    // <Navigate to="/">, which unmounted the guard subtree (and the modal)
    // on commit — the modal flashed for ~one frame then vanished (see
    // audit-ava-signup-popup-bug.md). Render the modal ONLY: on dismiss send
    // the user home; on successful sign-in `user` becomes truthy, this guard
    // re-renders, and `children` render below.
    return (
      <AuthModal
        isOpen
        onClose={() => navigate('/')}
        initialMode={searchParams.get('auth') === 'signup' ? 'signup' : 'signin'}
      />
    );
  }

  // User is authenticated, render children with user prop
  return React.cloneElement(children, { user });
};

export default CustomerGuard;
