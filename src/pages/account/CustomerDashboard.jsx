import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Package, FileText, Palette, ShoppingBag, Eye, Loader } from 'lucide-react';
import CustomerLayout from '../../components/customer/CustomerLayout';
import { supabase } from '../../services/supabaseService';

const CustomerDashboard = ({ user }) => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalOrders: 0,
    activeQuotes: 0,
    savedDesigns: 0
  });
  const [recentOrders, setRecentOrders] = useState([]);
  const [recentQuotes, setRecentQuotes] = useState([]);
  const [recentDesigns, setRecentDesigns] = useState([]);

  useEffect(() => {
    fetchDashboardData();
  }, [user]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);

      // Fetch orders count
      const { count: ordersCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('customer_id', user.id);

      // Fetch active quotes count
      const { count: quotesCount } = await supabase
        .from('quotes')
        .select('*', { count: 'exact', head: true })
        .eq('customer_id', user.id)
        .in('status', ['draft', 'sent', 'approved']);

      // Fetch saved designs count
      const { count: designsCount } = await supabase
        .from('user_designs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);

      setStats({
        totalOrders: ordersCount || 0,
        activeQuotes: quotesCount || 0,
        savedDesigns: designsCount || 0
      });

      // Fetch recent orders
      const { data: ordersData } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', user.id)
        .order('created_at', { ascending: false })
        .limit(3);

      setRecentOrders(ordersData || []);

      // Fetch recent quotes
      const { data: quotesData } = await supabase
        .from('quotes')
        .select('*')
        .eq('customer_id', user.id)
        .order('created_at', { ascending: false })
        .limit(3);

      setRecentQuotes(quotesData || []);

      // Fetch recent designs
      const { data: designsData } = await supabase
        .from('user_designs')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(3);

      setRecentDesigns(designsData || []);

    } catch (error) {
      console.error('[CustomerDashboard] Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadgeClass = (status) => {
    const classes = {
      pending: 'bg-yellow-100 text-yellow-800',
      confirmed: 'bg-blue-100 text-blue-800',
      in_production: 'bg-purple-100 text-purple-800',
      shipped: 'bg-cyan-100 text-cyan-800',
      completed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      draft: 'bg-gray-100 text-gray-800',
      sent: 'bg-blue-100 text-blue-800',
      approved: 'bg-green-100 text-green-800'
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP'
    }).format(amount || 0);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  const formatProductName = (productKey) => {
    if (!productKey) return 'Unknown Product';
    return productKey
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Get user's first name from email or metadata
  const firstName = user.user_metadata?.first_name || user.email?.split('@')[0] || 'there';

  return (
    <CustomerLayout user={user} pageTitle="Dashboard">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl shadow-sm p-8 mb-8 text-white">
        <h1 className="text-3xl font-bold mb-2">Welcome back, {firstName}!</h1>
        <p className="text-blue-100">Here's what's happening with your account</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total Orders</p>
              <p className="text-3xl font-bold text-gray-900">{stats.totalOrders}</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <Package className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Active Quotes</p>
              <p className="text-3xl font-bold text-gray-900">{stats.activeQuotes}</p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <FileText className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Saved Designs</p>
              <p className="text-3xl font-bold text-gray-900">{stats.savedDesigns}</p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <Palette className="h-6 w-6 text-purple-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Link
          to="/designer"
          className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow group"
        >
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">
              <Palette className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Start New Design</h3>
              <p className="text-sm text-gray-600">Create custom products</p>
            </div>
          </div>
        </Link>

        <Link
          to="/"
          className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow group"
        >
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center group-hover:bg-green-200 transition-colors">
              <ShoppingBag className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Browse Products</h3>
              <p className="text-sm text-gray-600">Explore our catalog</p>
            </div>
          </div>
        </Link>

        <Link
          to="/account/orders"
          className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow group"
        >
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center group-hover:bg-purple-200 transition-colors">
              <Package className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">View All Orders</h3>
              <p className="text-sm text-gray-600">Track your purchases</p>
            </div>
          </div>
        </Link>
      </div>

      {/* Recent Orders and Quotes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Orders */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Recent Orders</h2>
            <Link to="/account/orders" className="text-sm text-blue-600 hover:text-blue-700 font-semibold">
              View All →
            </Link>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="h-8 w-8 text-blue-600 animate-spin" />
            </div>
          ) : recentOrders.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 mb-4">No orders yet</p>
              <Link
                to="/designer"
                className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold"
              >
                Start Designing
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">
                      Order #{order.order_number || order.id.slice(0, 8)}
                    </p>
                    <p className="text-sm text-gray-600">{formatDate(order.created_at)}</p>
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full mt-2 ${getStatusBadgeClass(
                        order.status
                      )}`}
                    >
                      {order.status}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">{formatCurrency(order.total_amount)}</p>
                    <Link
                      to={`/account/orders/${order.id}`}
                      className="text-sm text-blue-600 hover:text-blue-700 mt-2 inline-flex items-center space-x-1"
                    >
                      <Eye className="h-4 w-4" />
                      <span>View</span>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Quotes */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Recent Quotes</h2>
            <Link to="/account/quotes" className="text-sm text-blue-600 hover:text-blue-700 font-semibold">
              View All →
            </Link>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="h-8 w-8 text-blue-600 animate-spin" />
            </div>
          ) : recentQuotes.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No quotes yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {recentQuotes.map((quote) => (
                <div
                  key={quote.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">
                      Quote #{quote.quote_number || quote.id.slice(0, 8)}
                    </p>
                    <p className="text-sm text-gray-600">{formatDate(quote.created_at)}</p>
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full mt-2 ${getStatusBadgeClass(
                        quote.status
                      )}`}
                    >
                      {quote.status}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">{formatCurrency(quote.total_amount)}</p>
                    <Link
                      to={`/account/quotes/${quote.id}`}
                      className="text-sm text-blue-600 hover:text-blue-700 mt-2 inline-flex items-center space-x-1"
                    >
                      <Eye className="h-4 w-4" />
                      <span>View</span>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Designs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mt-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900">Recent Designs</h2>
          <Link to="/account/designs" className="text-sm text-blue-600 hover:text-blue-700 font-semibold">
            View All →
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="h-8 w-8 text-blue-600 animate-spin" />
          </div>
        ) : recentDesigns.length === 0 ? (
          <div className="text-center py-12">
            <Palette className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">No saved designs yet</p>
            <Link
              to="/designer"
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold"
            >
              Start Creating
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recentDesigns.map((design) => (
              <div
                key={design.id}
                className="bg-gray-50 rounded-lg overflow-hidden hover:shadow-md transition-shadow border border-gray-200"
              >
                {/* Thumbnail */}
                <div className="aspect-square bg-gray-200 relative">
                  {design.thumbnail_url ? (
                    <img
                      src={design.thumbnail_url}
                      alt={design.design_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Palette className="h-12 w-12 text-gray-400" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-4">
                  <h3 className="font-semibold text-gray-900 mb-1 truncate">
                    {design.design_name || 'Untitled Design'}
                  </h3>
                  <p className="text-sm text-gray-600 mb-1">
                    {formatProductName(design.product_key)}
                  </p>
                  {design.color_name && (
                    <div className="flex items-center space-x-2 mb-2">
                      <div
                        className="w-4 h-4 rounded-full border border-gray-300"
                        style={{ backgroundColor: design.color_code || '#fff' }}
                      />
                      <span className="text-xs text-gray-500">{design.color_name}</span>
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mb-3">
                    Modified {formatDate(design.updated_at)}
                  </p>

                  {/* Edit Button */}
                  <Link
                    to={`/designer?design=${design.id}`}
                    className="w-full inline-flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold"
                  >
                    <Palette className="h-4 w-4" />
                    <span>Edit Design</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </CustomerLayout>
  );
};

export default CustomerDashboard;
