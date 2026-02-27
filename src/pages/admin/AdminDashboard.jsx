import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ShoppingCart,
  Users,
  DollarSign,
  FileText,
  TrendingUp,
  Eye,
  CheckCircle,
  Loader,
  AlertCircle
} from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout';
import { supabase } from '../../services/supabaseService';

const AdminDashboard = ({ user, adminRole }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Stats
  const [stats, setStats] = useState({
    totalOrders: 0,
    pendingOrders: 0,
    totalCustomers: 0,
    monthlyRevenue: 0,
    pendingQuotes: 0
  });

  // Recent data
  const [recentOrders, setRecentOrders] = useState([]);
  const [recentCustomers, setRecentCustomers] = useState([]);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch all data in parallel
      await Promise.all([
        fetchStats(),
        fetchRecentOrders(),
        fetchRecentCustomers()
      ]);

    } catch (err) {
      console.error('[AdminDashboard] Error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    // Total Orders (placeholder - adjust query based on your schema)
    const { count: totalOrders } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true });

    // Pending Orders
    const { count: pendingOrders } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    // Total Customers
    const { count: totalCustomers } = await supabase
      .from('customer_profiles')
      .select('*', { count: 'exact', head: true });

    // Monthly Revenue (completed orders this month)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: monthlyOrders } = await supabase
      .from('orders')
      .select('total_amount')
      .eq('status', 'completed')
      .gte('created_at', startOfMonth.toISOString());

    const monthlyRevenue = monthlyOrders?.reduce(
      (sum, order) => sum + (parseFloat(order.total_amount) || 0),
      0
    ) || 0;

    // Pending Quotes
    const { count: pendingQuotes } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'sent');

    setStats({
      totalOrders: totalOrders || 0,
      pendingOrders: pendingOrders || 0,
      totalCustomers: totalCustomers || 0,
      monthlyRevenue,
      pendingQuotes: pendingQuotes || 0
    });
  };

  const fetchRecentOrders = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        id,
        order_number,
        status,
        total_amount,
        created_at,
        customer_profiles (
          first_name,
          last_name,
          company_name
        )
      `)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    setRecentOrders(data || []);
  };

  const fetchRecentCustomers = async () => {
    const { data, error } = await supabase
      .from('customer_profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) throw error;

    // Get order counts for each customer
    const customersWithCounts = await Promise.all(
      data.map(async (customer) => {
        const { count } = await supabase
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('customer_id', customer.id);

        return { ...customer, order_count: count || 0 };
      })
    );

    setRecentCustomers(customersWithCounts);
  };

  const getStatusBadgeClass = (status) => {
    const classes = {
      pending: 'bg-yellow-100 text-yellow-800',
      confirmed: 'bg-blue-100 text-blue-800',
      approved: 'bg-indigo-100 text-indigo-800',
      in_production: 'bg-purple-100 text-purple-800',
      shipped: 'bg-cyan-100 text-cyan-800',
      completed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      sent: 'bg-orange-100 text-orange-800'
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP'
    }).format(amount);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  if (loading) {
    return (
      <AdminLayout user={user} adminRole={adminRole} pageTitle="Dashboard">
        <div className="flex items-center justify-center py-12">
          <Loader className="h-8 w-8 text-blue-600 animate-spin" />
        </div>
      </AdminLayout>
    );
  }

  if (error) {
    return (
      <AdminLayout user={user} adminRole={adminRole} pageTitle="Dashboard">
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center space-x-2">
          <AlertCircle className="h-5 w-5" />
          <span>Error loading dashboard: {error}</span>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout user={user} adminRole={adminRole} pageTitle="Dashboard">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
        {/* Total Orders */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total Orders</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalOrders}</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <ShoppingCart className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>

        {/* Pending Orders */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Pending Orders</p>
              <p className="text-2xl font-bold text-yellow-600">{stats.pendingOrders}</p>
            </div>
            <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-yellow-600" />
            </div>
          </div>
        </div>

        {/* Total Customers */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total Customers</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalCustomers}</p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <Users className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>

        {/* Monthly Revenue */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">This Month</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(stats.monthlyRevenue)}
              </p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <DollarSign className="h-6 w-6 text-purple-600" />
            </div>
          </div>
        </div>

        {/* Pending Quotes */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Pending Quotes</p>
              <p className="text-2xl font-bold text-orange-600">{stats.pendingQuotes}</p>
            </div>
            <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
              <FileText className="h-6 w-6 text-orange-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Recent Orders and Customers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Orders - Takes 2 columns */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Recent Orders</h2>
            <Link
              to="/admin/orders"
              className="text-sm text-blue-600 hover:text-blue-700 font-semibold"
            >
              View All →
            </Link>
          </div>

          {recentOrders.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No orders yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-gray-600 border-b border-gray-200">
                    <th className="pb-3 font-semibold">Order #</th>
                    <th className="pb-3 font-semibold">Customer</th>
                    <th className="pb-3 font-semibold">Date</th>
                    <th className="pb-3 font-semibold">Status</th>
                    <th className="pb-3 font-semibold text-right">Total</th>
                    <th className="pb-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => (
                    <tr
                      key={order.id}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="py-3 text-sm font-medium text-gray-900">
                        #{order.order_number || order.id.slice(0, 8)}
                      </td>
                      <td className="py-3 text-sm text-gray-600">
                        {order.customer_profiles?.company_name ||
                          `${order.customer_profiles?.first_name} ${order.customer_profiles?.last_name}`}
                      </td>
                      <td className="py-3 text-sm text-gray-600">
                        {formatDate(order.created_at)}
                      </td>
                      <td className="py-3">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadgeClass(
                            order.status
                          )}`}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td className="py-3 text-sm font-semibold text-gray-900 text-right">
                        {formatCurrency(order.total_amount)}
                      </td>
                      <td className="py-3">
                        <Link
                          to={`/admin/orders/${order.id}`}
                          className="text-sm text-blue-600 hover:text-blue-700 font-semibold"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Customers - Takes 1 column */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Recent Customers</h2>
            <Link
              to="/admin/customers"
              className="text-sm text-blue-600 hover:text-blue-700 font-semibold"
            >
              View All →
            </Link>
          </div>

          {recentCustomers.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No customers yet</p>
          ) : (
            <div className="space-y-4">
              {recentCustomers.map((customer) => (
                <div
                  key={customer.id}
                  className="flex items-start justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {customer.company_name || `${customer.first_name} ${customer.last_name}`}
                    </p>
                    <p className="text-xs text-gray-600 truncate">{customer.email}</p>
                    <div className="flex items-center space-x-4 mt-1">
                      <span className="text-xs text-gray-500">
                        {customer.order_count} orders
                      </span>
                      <span className="text-xs text-gray-400">
                        Joined {formatDate(customer.created_at)}
                      </span>
                    </div>
                  </div>
                  <Link
                    to={`/admin/customers/${customer.id}`}
                    className="ml-2 text-blue-600 hover:text-blue-700"
                  >
                    <Eye className="h-4 w-4" />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
};

export default AdminDashboard;
