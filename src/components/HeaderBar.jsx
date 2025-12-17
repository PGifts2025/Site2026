// src/components/HeaderBar.jsx
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, Search, ShoppingCart, User, LogOut } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { useCart } from '../context/CartContext';

const categories = [
  { name: 'Design Tool', path: '/designer' },
  { name: 'Cups', path: '/cups' },
  { name: 'Water Bottles', path: '/water-bottles' },
  { name: 'Bags', path: '/bags' },
  { name: 'Clothing', path: '/clothing' },
  { name: 'Hi Vis', path: '/hi-vis' },
  { name: 'Cables', path: '/cables' },
  { name: 'Power', path: '/power' },
  { name: 'Speakers', path: '/speakers' },
  { name: 'Pens & Writing', path: '/pens' },
  { name: 'Notebooks', path: '/notebooks' },
  { name: 'Tea Towels', path: '/tea-towels' },
];

function HeaderBar() {
  const { user, signIn, signOut } = useAuth();
  const { cart, toggleCart } = useCart();
  const [searchQuery, setSearchQuery] = useState('');
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Calculate cart count - number of unique items (line items)
  const cartCount = cart.length;

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (authMode === 'login') {
        const { error } = await signIn(email, password);
        if (error) throw error;
        setShowAuth(false);
        setEmail('');
        setPassword('');
      } else {
        // For signup, you might want to add signUp to useAuth
        setError('Sign up not implemented yet. Please contact admin.');
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <header className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4">
        {/* Top Header */}
        <div className="flex justify-between items-center py-4">
          <div className="flex items-center">
            <div className="bg-red-500 text-white rounded-full w-12 h-12 flex items-center justify-center font-bold text-xl mr-4">
              PG
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Promo Gifts</h1>
              <p className="text-sm text-gray-600">YOUR PROMOTIONAL PARTNER</p>
              <div className="flex items-center mt-1">
                <Phone className="h-4 w-4 text-red-500 mr-2" />
                <span className="text-sm font-semibold text-gray-700">01844 600900</span>
              </div>
            </div>
          </div>

          <div className="flex-1 max-w-2xl mx-8">
            <div className="relative">
              <input
                type="text"
                placeholder="Search product, brand, colour, keyword or code"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
              <button className="absolute right-2 top-2 bg-red-500 text-white p-2 rounded-md hover:bg-red-600 transition-colors">
                <Search className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {user ? (
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-600">{user.email}</span>
                <button
                  onClick={handleSignOut}
                  className="flex items-center space-x-2 text-gray-700 hover:text-red-500 transition-colors"
                >
                  <LogOut className="h-5 w-5" />
                  <span>Sign Out</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAuth(true)}
                className="flex items-center space-x-2 text-gray-700 hover:text-red-500 transition-colors"
              >
                <User className="h-6 w-6" />
                <span>My Account</span>
              </button>
            )}
            <button
              onClick={toggleCart}
              className="flex items-center space-x-2 text-gray-700 hover:text-red-500 transition-colors relative"
            >
              <div className="relative">
                <ShoppingCart className="h-6 w-6" />
                {cartCount > 0 && (
                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-semibold">
                    {cartCount}
                  </span>
                )}
              </div>
              <span>Basket</span>
            </button>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="bg-gray-800">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center h-12">
            <div className="flex space-x-8">
              {categories.map((category, index) => (
                <Link
                  key={index}
                  to={category.path}
                  className="text-white hover:text-red-400 transition-colors text-sm font-medium"
                >
                  {category.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {/* Feature Bar */}
      <div className="bg-gray-100 py-3">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <div className="flex items-center justify-between w-full space-x-8">
              <span className="flex items-center space-x-2">
                <div className="w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm">⭐</span>
                </div>
                <span>Best Sellers</span>
              </span>
              <span className="flex items-center space-x-2">
                <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-xs font-bold">24</span>
                </div>
                <span>Express Delivery</span>
              </span>
              <span className="flex items-center space-x-2">
                <div className="w-6 h-6 bg-blue-600 rounded-sm flex items-center justify-center">
                  <span className="text-white text-xs font-bold">UK</span>
                </div>
                <span>Made in the UK</span>
              </span>
              <span className="flex items-center space-x-2">
                <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm">♻️</span>
                </div>
                <span>Eco-Friendly</span>
              </span>
              <span className="flex items-center space-x-2">
                <div className="w-6 h-6 bg-blue-500 rounded-sm flex items-center justify-center">
                  <span className="text-white text-xs">⚙️</span>
                </div>
                <span>Real-Time Proof</span>
              </span>
              <span className="text-orange-500 font-medium flex items-center space-x-1">
                <div className="w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-bold">🆕</span>
                </div>
                <span>New Products</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Auth Modal */}
      {showAuth && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">
                {authMode === 'login' ? 'Sign In' : 'Sign Up'}
              </h2>
              <button
                onClick={() => {
                  setShowAuth(false);
                  setError('');
                  setEmail('');
                  setPassword('');
                }}
                className="text-gray-400 hover:text-gray-600 text-3xl"
              >
                ×
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleAuth} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Loading...' : (authMode === 'login' ? 'Sign In' : 'Sign Up')}
              </button>
            </form>

            <div className="mt-4 text-center">
              <p className="text-sm text-gray-600">
                {authMode === 'login'
                  ? "Need an admin account? Contact your administrator."
                  : "Already have an account?"}
              </p>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

export default HeaderBar;
