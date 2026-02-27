import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Package, Loader, Eye, Filter } from 'lucide-react';
import CustomerLayout from '../../components/customer/CustomerLayout';
import { supabase } from '../../services/supabaseService';

const CustomerOrders = ({ user }) => {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [filteredOrders, setFilteredOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    fetchOrders();
  }, [user]);

  useEffect(() => {
    applyFilter();
  }, [orders, statusFilter]);

  const fetchOrders = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (count)
        `)
        .eq('customer_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setOrders(data || []);
    } catch (error) {
      console.error('[CustomerOrders] Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilter = () => {
    if (statusFilter === 'all') {
      setFilteredOrders(orders);
    } else {
      setFilteredOrders(orders.filter(order => order.status === statusFilter));
    }
  };

  const getStatusBadgeClass = (status) => {
    const classes = {
      pending: 'bg-yellow-100 text-yellow-800',
      confirmed: 'bg-blue-100 text-blue-800',
      in_production: 'bg-purple-100 text-purple-800',
      shipped: 'bg-cyan-100 text-cyan-800',
      completed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800'
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

  return (
    <CustomerLayout user={user} pageTitle="My Orders">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Orders</h1>
            <p className="text-sm text-gray-600 mt-1">View and track your orders</p>
          </div>

          {/* Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All Orders</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="in_production">In Production</option>
            <option value="shipped">Shipped</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 flex items-center justify-center">
          <Loader className="h-8 w-8 text-blue-600 animate-spin" />
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <Package className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No orders found</h3>
          <p className="text-gray-600 mb-6">
            {statusFilter === 'all'
              ? "You haven't placed any orders yet. Start designing!"
              : `No ${statusFilter} orders found.`}
          </p>
          <Link
            to="/designer"
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
          >
            Start Designing
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order) => (
            <div
              key={order.id}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
                {/* Order Info */}
                <div className="flex-1">
                  <div className="flex items-center space-x-4 mb-2">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Order #{order.order_number || order.id.slice(0, 8)}
                    </h3>
                    <span
                      className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full ${getStatusBadgeClass(
                        order.status
                      )}`}
                    >
                      {order.status?.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                    <span>Placed on {formatDate(order.created_at)}</span>
                    <span>•</span>
                    <span>{order.order_items?.[0]?.count || 0} items</span>
                  </div>
                </div>

                {/* Total and Action */}
                <div className="flex items-center space-x-6">
                  <div className="text-right">
                    <p className="text-sm text-gray-600 mb-1">Total</p>
                    <p className="text-xl font-bold text-gray-900">
                      {formatCurrency(order.total_amount)}
                    </p>
                  </div>
                  <Link
                    to={`/account/orders/${order.id}`}
                    className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
                  >
                    <Eye className="h-4 w-4" />
                    <span>View Details</span>
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </CustomerLayout>
  );
};

export default CustomerOrders;
