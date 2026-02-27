import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../services/supabaseService';

const AuthContext = createContext({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // Check active session
    checkUser();

    // Listen for auth changes
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[AuthContext] Auth state changed:', event);

        if (session?.user) {
          setUser(session.user);
          setIsAuthenticated(true);
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }
        setLoading(false);
      }
    );

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  const checkUser = async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) throw error;

      if (session?.user) {
        setUser(session.user);
        setIsAuthenticated(true);
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('[AuthContext] Error checking user:', error);
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      console.log('[AuthContext] Sign in successful:', data.user.email);
      return { data, error: null };
    } catch (error) {
      console.error('[AuthContext] Sign in error:', error);
      return { data: null, error };
    }
  };

  const signUp = async ({ email, password, firstName, lastName, companyName, phone }) => {
    try {
      // 1. Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName
          }
        }
      });

      if (authError) throw authError;

      // 2. Create customer profile
      const { error: profileError } = await supabase
        .from('customer_profiles')
        .insert({
          id: authData.user.id,
          email: email,
          first_name: firstName,
          last_name: lastName,
          company_name: companyName || null,
          phone: phone || null,
          created_at: new Date().toISOString()
        });

      if (profileError) {
        console.error('[AuthContext] Error creating customer profile:', profileError);
        // Don't throw - user is created, profile creation can be retried
      }

      console.log('[AuthContext] Sign up successful:', authData.user.email);
      return { data: authData, error: null };
    } catch (error) {
      console.error('[AuthContext] Sign up error:', error);
      return { data: null, error };
    }
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      setUser(null);
      setIsAuthenticated(false);
      console.log('[AuthContext] Sign out successful');
      return { error: null };
    } catch (error) {
      console.error('[AuthContext] Sign out error:', error);
      return { error };
    }
  };

  const resetPassword = async (email) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
      });

      if (error) throw error;

      return { error: null };
    } catch (error) {
      console.error('[AuthContext] Reset password error:', error);
      return { error };
    }
  };

  const value = {
    user,
    loading,
    isAuthenticated,
    signIn,
    signUp,
    signOut,
    resetPassword
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
