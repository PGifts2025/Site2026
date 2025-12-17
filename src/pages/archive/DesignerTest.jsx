import React, { useState, useRef, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { supabaseConfig, isMockAuth } from '../config/supabase';
import { createMockSupabase } from '../utils/mockAuth';

// Initialize Supabase or mock auth
const supabase = isMockAuth 
  ? createMockSupabase() 
  : createClient(supabaseConfig.url, supabaseConfig.anonKey);

const DesignerTest = () => {
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState('initializing');

  // Check authentication state
  useEffect(() => {
    console.log('Setting up auth listener...');
    console.log('isMockAuth:', isMockAuth);
    console.log('supabase:', supabase);
    
    try {
      // Handle both real Supabase and mock auth systems
      const authResponse = supabase.auth.onAuthStateChange((event, session) => {
        console.log('Auth state changed:', event, session);
        setUser(session?.user || null);
        setAuthStatus('ready');
      });

      console.log('authResponse:', authResponse);

      // Extract subscription - handle both formats
      const subscription = authResponse?.data?.subscription || authResponse;
      console.log('subscription:', subscription);

      return () => {
        console.log('Cleaning up auth listener...');
        if (subscription && typeof subscription.unsubscribe === 'function') {
          subscription.unsubscribe();
        }
      };
    } catch (error) {
      console.error('Error setting up auth listener:', error);
      setAuthStatus('error');
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="text-2xl font-bold mb-4">Designer Test Page</h1>
      <div className="bg-white p-4 rounded shadow">
        <p><strong>Auth Status:</strong> {authStatus}</p>
        <p><strong>Is Mock Auth:</strong> {isMockAuth ? 'Yes' : 'No'}</p>
        <p><strong>User:</strong> {user ? user.email : 'Not logged in'}</p>
        <p><strong>Supabase Client:</strong> {supabase ? 'Initialized' : 'Not initialized'}</p>
      </div>
    </div>
  );
};

export default DesignerTest;
