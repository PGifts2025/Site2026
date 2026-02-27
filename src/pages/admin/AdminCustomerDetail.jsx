import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader, Mail, Phone, Building2, MapPin, ShoppingCart } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout';
import { supabase } from '../../services/supabaseService';

const AdminCustomerDetail = ({ user, adminRole }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState(null);
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalSpent: 0,
    avgOrderValue: 0
  });

  useEffect(() => {
    fetchCustomerDetail();
  }, [id]);

  const fetchCustomerDetail = async () => {
    try {
      setLoading(true);

      // Fetch customer
      const { data: customerData, error: customerError } = await supabase
        .from('customer_profiles')
        .select('*')
        .eq('id', id)
        .single();

      if (customerError) throw customerError;
      setCustomer(customerData);

      // Fetch customer orders
      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', id)
        .order('created_at', { ascending: false });

      if (ordersError) throw ordersError;
      setOrders(ordersData || []);

      // Calculate stats
      const totalOrders = ordersData?.length || 0;
      const completedOrders = ordersData?.filter(o => o.status === 'completed') || [];
      const totalSpent = completedOrders.reduce(
        (sum, order) => sum + (parseFloat(order.total_amount) || 0),
        0
      );
      const avgOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;

      setStats({
        totalOrders,
        totalSpent,
        avgOrderValue
      });

    } catch (error) {
      console.error('[AdminCustomerDetail] Error:', error);
    } finally {
      setLoading(false);
    }
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

  const getStatusBadgeClass = (status) => {
    const classes = {
      pending: 'bg-yellow-100 text-yellow-800',
      confirmed: 'bg-blue-100 text-blue-800',
      approved: 'bg-indigo-100 text-indigo-800',
      in_production: 'bg-purple-100 text-purple-800',
      shipped: 'bg-cyan-100 text-cyan-800',
      completed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800'
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
  };

  if (loading) {
    return (
      <AdminLayout user={user} adminRole={adminRole} pageTitle="Customer Details">
        <div className="flex items-center justify-center py-12">
          <Loader className="h-8 w-8 text-blue-600 animate-spin" />
        </div>
      </AdminLayout>
    );
  }

  if (!customer) {
    return (
      <AdminLayout user={user} adminRole={adminRole} pageTitle="Customer Details">
        <div className="text-center py-12">
          <p className="text-gray-500">Customer not found</p>
          <Link to="/admin/customers" className="text-blue-600 hover:text-blue-700 mt-4 inline-block">
            ← Back to Customers
          </Link>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      user={user}
      adminRole={adminRole}
      pageTitle={customer.company_name || `${customer.first_name} ${customer.last_name}`}
    >
      {/* Back button */}
      <button
        onClick={() => navigate('/admin/customers')}
        className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to Customers</span>
      </button>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <p className="text-sm text-gray-600 mb-1">Total Orders</p>
          <p className="text-2xl font-bold text-gray-900">{stats.totalOrders}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <p className="text-sm text-gray-600 mb-1">Total Spent</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(stats.totalSpent)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <p className="text-sm text-gray-600 mb-1">Avg Order Value</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(stats.avgOrderValue)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Customer Profile */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Contact Details</h2>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-1">Name</p>
                <p className="font-semibold text-gray-900">
                  {customer.first_name} {customer.last_name}
                </p>
              </div>

              {customer.company_name && (
                <div>
                  <p className="text-sm text-gray-600 mb-1">Company</p>
                  <p className="font-semibold text-gray-900 flex items-center space-x-2">
                    <Building2 className="h-4 w-4 text-gray-400" />
                    <span>{customer.company_name}</span>
                  </p>
                </div>
              )}

              <div>
                <p className="text-sm text-gray-600 mb-1">Email</p>
                <p className="font-semibold text-gray-900 flex items-center space-x-2">
                  <Mail className="h-4 w-4 text-gray-400" />
                  <span>{customer.email}</span>
                </p>
              </div>

              {customer.phone && (
                <div>
                  <p className="text-sm text-gray-600 mb-1">Phone</p>
                  <p className="font-semibold text-gray-900 flex items-center space-x-2">
                    <Phone className="h-4 w-4 text-gray-400" />
                    <span>{customer.phone}</span>
                  </p>
                </div>
              )}

              <div>
                <p className="text-sm text-gray-600 mb-1">Customer Since</p>
                <p className="font-semibold text-gray-900">{formatDate(customer.created_at)}</p>
              </div>
            </div>
          </div>

          {/* Addresses */}
          {customer.billing_address && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center space-x-2">
                <MapPin className="h-5 w-5" />
                <span>Billing Address</span>
              </h2>
              <div className="text-sm text-gray-600 space-y-1">
                <p>{customer.billing_address.line1}</p>
                {customer.billing_address.line2 && <p>{customer.billing_address.line2}</p>}
                <p>{customer.billing_address.city}</p>
                <p>{customer.billing_address.postcode}</p>
                <p>{customer.billing_address.country}</p>
              </div>
            </div>
          )}
        </div>

        {/* Orders History */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <ShoppingCart className="h-5 w-5" />
              <span>Order History</span>
            </h2>

            {orders.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No orders yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-sm text-gray-600 border-b border-gray-200">
                      <th className="pb-3 font-semibold">Order #</th>
                      <th className="pb-3 font-semibold">Date</th>
                      <th className="pb-3 font-semibold">Status</th>
                      <th className="pb-3 font-semibold text-right">Total</th>
                      <th className="pb-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr
                        key={order.id}
                        className="border-b border-gray-100 hover:bg-gray-50"
                      >
                        <td className="py-3 text-sm font-medium text-gray-900">
                          #{order.order_number || order.id.slice(0, 8)}
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
        </div>
      </div>
    </AdminLayout>
  );
};

export default AdminCustomerDetail;
