// src/components/HeaderBar.jsx
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, Search, ShoppingCart, User, LogOut, Menu, X, ChevronDown, Package, FileText, MapPin, Settings } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import AuthModal from './auth/AuthModal';

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
  const { user, signOut } = useAuth();
  const { cart, toggleCart } = useCart();
  const [searchQuery, setSearchQuery] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Calculate cart count - number of unique items (line items)
  const cartCount = cart.length;

  const handleSignOut = async () => {
    try {
      await signOut();
      setShowUserMenu(false);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <header className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4">
        {/* Top Header */}
        <div className="flex justify-between items-center py-4">
          {/* Logo */}
          <Link to="/" className="flex items-center hover:opacity-80 transition-opacity cursor-pointer">
            <div className="bg-red-500 text-white rounded-full w-10 h-10 md:w-12 md:h-12 flex items-center justify-center font-bold text-lg md:text-xl mr-2 md:mr-4">
              PG
            </div>
            <div>
              <h1 className="text-lg md:text-2xl font-bold text-gray-900">Promo Gifts</h1>
              <p className="text-xs md:text-sm text-gray-600 hidden sm:block">YOUR PROMOTIONAL PARTNER</p>
              <div className="items-center mt-1 hidden md:flex">
                <Phone className="h-4 w-4 text-red-500 mr-2" />
                <span className="text-sm font-semibold text-gray-700">01844 600900</span>
              </div>
            </div>
          </Link>

          {/* Desktop Search Bar */}
          <div className="hidden lg:flex flex-1 max-w-2xl mx-8">
            <div className="relative w-full">
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

          {/* Right Side Icons */}
          <div className="flex items-center space-x-2 md:space-x-4">
            {/* Desktop User Menu */}
            <div className="hidden md:flex items-center space-x-4">
              {user ? (
                <div className="relative">
                  <button
                    onClick={() => setShowUserMenu(!showUserMenu)}
                    className="flex items-center space-x-2 text-gray-700 hover:text-red-500 transition-colors"
                  >
                    <User className="h-6 w-6" />
                    <span className="hidden lg:inline">{user.email?.split('@')[0]}</span>
                    <ChevronDown className="h-4 w-4" />
                  </button>

                  {/* Dropdown Menu */}
                  {showUserMenu && (
                    <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50">
                      <div className="px-4 py-2 border-b border-gray-200">
                        <p className="text-sm font-semibold text-gray-900">{user.email}</p>
                      </div>
                      <Link
                        to="/account"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center space-x-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <User className="h-4 w-4" />
                        <span>My Account</span>
                      </Link>
                      <Link
                        to="/account/orders"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center space-x-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Package className="h-4 w-4" />
                        <span>My Orders</span>
                      </Link>
                      <Link
                        to="/account/quotes"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center space-x-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <FileText className="h-4 w-4" />
                        <span>My Quotes</span>
                      </Link>
                      <Link
                        to="/account/addresses"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center space-x-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <MapPin className="h-4 w-4" />
                        <span>Addresses</span>
                      </Link>
                      <Link
                        to="/account/settings"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center space-x-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Settings className="h-4 w-4" />
                        <span>Settings</span>
                      </Link>
                      <div className="border-t border-gray-200 mt-2 pt-2">
                        <button
                          onClick={handleSignOut}
                          className="flex items-center space-x-2 px-4 py-2 text-sm text-red-600 hover:bg-gray-50 w-full"
                        >
                          <LogOut className="h-4 w-4" />
                          <span>Sign Out</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="flex items-center space-x-2 text-gray-700 hover:text-red-500 transition-colors"
                >
                  <User className="h-6 w-6" />
                  <span className="hidden lg:inline">Sign In</span>
                </button>
              )}
            </div>

            {/* Cart Button */}
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
              <span className="hidden md:inline">Basket</span>
            </button>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 text-gray-700 hover:text-red-500"
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Search Bar */}
        <div className="lg:hidden pb-4">
          <div className="relative">
            <input
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
            />
            <button className="absolute right-2 top-1.5 bg-red-500 text-white p-1.5 rounded-md hover:bg-red-600 transition-colors">
              <Search className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Desktop Navigation */}
      <nav className="bg-gray-800 hidden md:block">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center h-12">
            <div className="flex space-x-8 overflow-x-auto">
              {categories.map((category, index) => (
                <Link
                  key={index}
                  to={category.path}
                  className="text-white hover:text-red-400 transition-colors text-sm font-medium whitespace-nowrap"
                >
                  {category.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation Menu */}
      {mobileMenuOpen && (
        <nav className="md:hidden bg-gray-800 border-t border-gray-700">
          <div className="max-w-7xl mx-auto px-4 py-2">
            <div className="flex flex-col space-y-1">
              {user ? (
                <>
                  <Link
                    to="/account"
                    onClick={() => setMobileMenuOpen(false)}
                    className="text-white hover:text-red-400 py-2 px-4 transition-colors"
                  >
                    My Account
                  </Link>
                  <Link
                    to="/account/orders"
                    onClick={() => setMobileMenuOpen(false)}
                    className="text-white hover:text-red-400 py-2 px-4 transition-colors"
                  >
                    My Orders
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="text-white hover:text-red-400 py-2 px-4 text-left transition-colors"
                  >
                    Sign Out
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setShowAuthModal(true);
                    setMobileMenuOpen(false);
                  }}
                  className="text-white hover:text-red-400 py-2 px-4 text-left transition-colors"
                >
                  Sign In
                </button>
              )}
              {categories.map((category, index) => (
                <Link
                  key={index}
                  to={category.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-white hover:text-red-400 py-2 px-4 transition-colors"
                >
                  {category.name}
                </Link>
              ))}
            </div>
          </div>
        </nav>
      )}

      {/* Feature Bar - Hidden on mobile, scrollable on tablet */}
      <div className="bg-gray-100 py-3 hidden md:block">
        <div className="max-w-7xl mx-auto px-4">
          <div className="overflow-x-auto">
            <div className="flex items-center space-x-4 lg:space-x-8 text-sm text-gray-600 min-w-max">
              <span className="flex items-center space-x-2 whitespace-nowrap">
                <div className="w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-sm">⭐</span>
                </div>
                <span>Best Sellers</span>
              </span>
              <span className="flex items-center space-x-2 whitespace-nowrap">
                <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">24</span>
                </div>
                <span>Express Delivery</span>
              </span>
              <span className="flex items-center space-x-2 whitespace-nowrap">
                <div className="w-6 h-6 bg-blue-600 rounded-sm flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">UK</span>
                </div>
                <span>Made in the UK</span>
              </span>
              <span className="flex items-center space-x-2 whitespace-nowrap">
                <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-sm">♻️</span>
                </div>
                <span>Eco-Friendly</span>
              </span>
              <span className="flex items-center space-x-2 whitespace-nowrap">
                <div className="w-6 h-6 bg-blue-500 rounded-sm flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs">⚙️</span>
                </div>
                <span>Real-Time Proof</span>
              </span>
              <span className="text-orange-500 font-medium flex items-center space-x-1 whitespace-nowrap">
                <div className="w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-sm font-bold">🆕</span>
                </div>
                <span>New Products</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Auth Modal */}
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </header>
  );
}

export default HeaderBar;
