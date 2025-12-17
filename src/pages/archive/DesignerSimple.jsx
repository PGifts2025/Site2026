import React, { useState, useRef, useEffect } from 'react';
import * as fabric from 'fabric';
import { createClient } from '@supabase/supabase-js';
import { supabaseConfig, isMockAuth } from '../config/supabase';
import { createMockSupabase } from '../utils/mockAuth';

// Initialize Supabase or mock auth
const supabase = isMockAuth 
  ? createMockSupabase() 
  : createClient(supabaseConfig.url, supabaseConfig.anonKey);

const DesignerSimple = () => {
  const canvasRef = useRef(null);
  const [canvas, setCanvas] = useState(null);
  const [user, setUser] = useState(null);
  const [fabricError, setFabricError] = useState(null);

  // Check authentication state
  useEffect(() => {
    console.log('Setting up auth listener...');
    
    try {
      const authResponse = supabase.auth.onAuthStateChange((event, session) => {
        console.log('Auth state changed:', event, session);
        setUser(session?.user || null);
      });

      const subscription = authResponse?.data?.subscription || authResponse;

      return () => {
        if (subscription && typeof subscription.unsubscribe === 'function') {
          subscription.unsubscribe();
        }
      };
    } catch (error) {
      console.error('Error setting up auth listener:', error);
    }
  }, []);

  // Initialize canvas
  useEffect(() => {
    if (canvasRef.current && !canvas) {
      try {
        console.log('Initializing fabric canvas...');
        console.log('fabric object:', fabric);
        
        const fabricCanvas = new fabric.Canvas(canvasRef.current, {
          width: 600,
          height: 400,
          backgroundColor: '#f8f9fa'
        });

        console.log('Fabric canvas created:', fabricCanvas);
        setCanvas(fabricCanvas);

        // Test adding a simple shape
        const rect = new fabric.Rect({
          left: 100,
          top: 100,
          width: 100,
          height: 100,
          fill: 'red'
        });
        
        fabricCanvas.add(rect);
        fabricCanvas.renderAll();

        return () => {
          fabricCanvas.dispose();
        };
      } catch (error) {
        console.error('Error initializing fabric canvas:', error);
        setFabricError(error.message);
      }
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="text-2xl font-bold mb-4">Simple Designer Test</h1>
      
      <div className="bg-white p-4 rounded shadow mb-4">
        <p><strong>User:</strong> {user ? user.email : 'Not logged in'}</p>
        <p><strong>Canvas:</strong> {canvas ? 'Initialized' : 'Not initialized'}</p>
        {fabricError && (
          <p className="text-red-600"><strong>Fabric Error:</strong> {fabricError}</p>
        )}
      </div>

      <div className="bg-white p-4 rounded shadow">
        <h3 className="font-bold mb-2">Canvas</h3>
        <canvas ref={canvasRef} className="border border-gray-300" />
      </div>
    </div>
  );
};

export default DesignerSimple;
