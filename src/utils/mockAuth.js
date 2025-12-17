// Mock authentication system for development/demo purposes
// This simulates Supabase auth when real credentials aren't available

class MockAuth {
  constructor() {
    // Check if user exists in localStorage
    let storedUser = JSON.parse(localStorage.getItem('mockUser'));
    
    // If no user exists, auto-create an admin user for testing
    if (!storedUser) {
      storedUser = {
        id: 'mock-admin-user-id',
        email: 'admin@example.com',
        created_at: new Date().toISOString(),
        user_metadata: {
          is_admin: true
        }
      };
      localStorage.setItem('mockUser', JSON.stringify(storedUser));
      console.log('[MockAuth] Auto-created admin user for testing');
    }
    
    this.user = storedUser;
    this.listeners = [];
  }

  onAuthStateChange(callback) {
    this.listeners.push(callback);
    // Call immediately with current state
    const event = this.user ? 'SIGNED_IN' : 'SIGNED_OUT';
    const session = this.user ? { user: this.user } : null;
    callback(event, session);
    
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            this.listeners = this.listeners.filter(listener => listener !== callback);
          }
        }
      }
    };
  }

  async getUser() {
    return { 
      data: { user: this.user }, 
      error: null 
    };
  }

  async signInWithPassword({ email, password }) {
    // Simple mock validation
    if (email && password.length >= 6) {
      const user = {
        id: 'mock-user-id',
        email,
        created_at: new Date().toISOString(),
        user_metadata: {
          is_admin: true  // All mock users are admin for testing
        }
      };
      
      this.user = user;
      localStorage.setItem('mockUser', JSON.stringify(user));
      
      // Notify listeners
      this.listeners.forEach(callback => {
        callback('SIGNED_IN', { user });
      });
      
      return { data: { user }, error: null };
    } else {
      return { 
        data: null, 
        error: { message: 'Invalid email or password (password must be at least 6 characters)' }
      };
    }
  }

  async signUp({ email, password }) {
    // Simple mock validation
    if (email && password.length >= 6) {
      const user = {
        id: 'mock-user-id',
        email,
        created_at: new Date().toISOString(),
        user_metadata: {
          is_admin: true  // All mock users are admin for testing
        }
      };
      
      this.user = user;
      localStorage.setItem('mockUser', JSON.stringify(user));
      
      // Notify listeners
      this.listeners.forEach(callback => {
        callback('SIGNED_UP', { user });
      });
      
      return { data: { user }, error: null };
    } else {
      return { 
        data: null, 
        error: { message: 'Invalid email or password (password must be at least 6 characters)' }
      };
    }
  }

  async signOut() {
    this.user = null;
    localStorage.removeItem('mockUser');
    
    // Notify listeners
    this.listeners.forEach(callback => {
      callback('SIGNED_OUT', { user: null });
    });
    
    return { error: null };
  }

  async getSession() {
    return { data: { session: this.user ? { user: this.user } : null } };
  }
}

// Mock database functionality
class MockDatabase {
  constructor() {
    this.tables = {
      designs: JSON.parse(localStorage.getItem('mockDesigns')) || []
    };
  }

  from(tableName) {
    return {
      insert: async (data) => {
        if (tableName === 'designs') {
          const designs = Array.isArray(data) ? data : [data];
          designs.forEach(design => {
            design.id = Date.now() + Math.random(); // Simple ID generation
            this.tables.designs.push(design);
          });
          localStorage.setItem('mockDesigns', JSON.stringify(this.tables.designs));
          return { data: designs, error: null };
        }
        return { data: null, error: { message: 'Table not found' } };
      },
      
      select: async (columns = '*') => {
        if (tableName === 'designs') {
          return { data: this.tables.designs, error: null };
        }
        return { data: [], error: null };
      }
    };
  }
}

export const createMockSupabase = () => {
  return {
    auth: new MockAuth(),
    from: (tableName) => new MockDatabase().from(tableName)
  };
};
