import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import AuthModal from './AuthModal';

/**
 * CustomerGuard Component
 * Protects customer routes by checking if user is authenticated
 */
const CustomerGuard = ({ children }) => {
  const { user, loading, isAuthenticated } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);

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
    // Show auth modal or redirect to home
    return (
      <>
        <Navigate to="/" replace state={{ message: 'Please sign in to access your account' }} />
        <AuthModal isOpen={true} onClose={() => setShowAuthModal(false)} />
      </>
    );
  }

  // User is authenticated, render children with user prop
  return React.cloneElement(children, { user });
};

export default CustomerGuard;
