import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../services/supabaseService';
import { Loader } from 'lucide-react';

/**
 * AdminGuard Component
 * Protects admin routes by checking if user is authenticated and has admin role
 */
const AdminGuard = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [adminRole, setAdminRole] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    checkAdminAccess();
  }, []);

  const checkAdminAccess = async () => {
    try {
      // Check if user is logged in
      const { data: { user: currentUser }, error: userError } = await supabase.auth.getUser();

      if (userError) throw userError;

      if (!currentUser) {
        // Not logged in, redirect to home
        console.log('[AdminGuard] No user logged in, redirecting to home');
        navigate('/', {
          replace: true,
          state: { message: 'Please log in to access the admin area' }
        });
        return;
      }

      console.log('[AdminGuard] User logged in:', currentUser.email);

      // Check if user is in team_members table with appropriate role
      const { data: teamMember, error: teamError } = await supabase
        .from('team_members')
        .select('role, is_active, first_name, last_name')
        .eq('user_id', currentUser.id)
        .eq('is_active', true)
        .single();

      if (teamError) {
        if (teamError.code === 'PGRST116') {
          // User not found in team_members
          console.log('[AdminGuard] User not authorized as admin');
          navigate('/', {
            replace: true,
            state: { message: 'You do not have permission to access the admin area' }
          });
          return;
        }
        throw teamError;
      }

      if (!teamMember) {
        console.log('[AdminGuard] No team member record found');
        navigate('/', {
          replace: true,
          state: { message: 'You do not have permission to access the admin area' }
        });
        return;
      }

      // Check if role is super_admin or staff
      if (teamMember.role !== 'super_admin' && teamMember.role !== 'staff') {
        console.log('[AdminGuard] User role not authorized:', teamMember.role);
        navigate('/', {
          replace: true,
          state: { message: 'You do not have permission to access the admin area' }
        });
        return;
      }

      // User is authorized!
      console.log('[AdminGuard] User authorized:', {
        email: currentUser.email,
        role: teamMember.role,
        name: `${teamMember.first_name} ${teamMember.last_name}`
      });

      setUser(currentUser);
      setAdminRole(teamMember.role);
      setLoading(false);

    } catch (err) {
      console.error('[AdminGuard] Error checking admin access:', err);
      setError(err.message);
      setLoading(false);

      // On error, redirect to home
      setTimeout(() => {
        navigate('/', {
          replace: true,
          state: { message: 'An error occurred while verifying your access' }
        });
      }, 2000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Verifying admin access...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="bg-red-50 text-red-600 px-6 py-4 rounded-lg mb-4">
            <p className="font-semibold">Access Error</p>
            <p className="text-sm mt-2">{error}</p>
          </div>
          <p className="text-gray-600">Redirecting to home...</p>
        </div>
      </div>
    );
  }

  if (!user || !adminRole) {
    return null;
  }

  // Pass user and role to children via React.cloneElement
  return React.cloneElement(children, { user, adminRole });
};

export default AdminGuard;
