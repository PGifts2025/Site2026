// Supabase configuration
// Replace these with your actual Supabase project credentials
// You can get these from https://app.supabase.com/project/_/settings/api
// Note: In Vite, environment variables must be prefixed with VITE_ to be accessible in the browser

export const supabaseConfig = {
  url: import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co',
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key'
};

// For development/demo purposes, we'll use a mock auth system if Supabase isn't configured
export const isMockAuth = !import.meta.env.VITE_SUPABASE_URL || 
                         import.meta.env.VITE_SUPABASE_URL === 'https://your-project.supabase.co';
