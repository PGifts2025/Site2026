import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  FileText,
  Palette,
  MapPin,
  Settings,
  Menu,
  X,
  ChevronRight
} from 'lucide-react';

const CustomerLayout = ({ children, user, pageTitle }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const navItems = [
    {
      path: '/account',
      icon: LayoutDashboard,
      label: 'Dashboard',
      exact: true
    },
    {
      path: '/account/orders',
      icon: Package,
      label: 'My Orders'
    },
    {
      path: '/account/quotes',
      icon: FileText,
      label: 'My Quotes'
    },
    {
      path: '/account/designs',
      icon: Palette,
      label: 'My Designs'
    },
    {
      path: '/account/addresses',
      icon: MapPin,
      label: 'Addresses'
    },
    {
      path: '/account/settings',
      icon: Settings,
      label: 'Account Settings'
    }
  ];

  const isActive = (path, exact = false) => {
    if (exact) {
      return location.pathname === path;
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full w-64 bg-white border-r border-gray-200 z-50
          transform transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
        `}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-gray-200">
          <Link to="/" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">PG</span>
            </div>
            <span className="font-bold text-gray-900">My Account</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-gray-500 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path, item.exact);

            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center space-x-3 px-4 py-3 rounded-lg
                  transition-colors duration-150
                  ${active
                    ? 'bg-blue-50 text-blue-600 font-semibold'
                    : 'text-gray-700 hover:bg-gray-50'
                  }
                `}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main content area */}
      <div className="lg:ml-64">
        {/* Header */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-8 sticky top-0 z-30">
          {/* Mobile menu button */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-gray-600 hover:text-gray-900"
          >
            <Menu className="h-6 w-6" />
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center space-x-2 text-gray-600 text-sm">
            <Link to="/account" className="hover:text-blue-600">
              My Account
            </Link>
            {pageTitle && (
              <>
                <ChevronRight className="h-4 w-4" />
                <span className="font-semibold text-gray-900">{pageTitle}</span>
              </>
            )}
          </div>

          {/* Right side */}
          <Link
            to="/"
            className="text-sm text-gray-600 hover:text-blue-600 hidden md:inline-block"
          >
            ← Back to Shop
          </Link>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
};

export default CustomerLayout;
