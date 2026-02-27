import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Loader, Package, User, MapPin, CreditCard } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout';
import { supabase } from '../../services/supabaseService';

const AdminOrderDetail = ({ user, adminRole }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState(null);
  const [orderItems, setOrderItems] = useState([]);

  useEffect(() => {
    fetchOrderDetail();
  }, [id]);

  const fetchOrderDetail = async () => {
    try {
      setLoading(true);

      // Fetch order
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select(`
          *,
          customer_profiles (*)
        `)
        .eq('id', id)
        .single();

      if (orderError) throw orderError;
      setOrder(orderData);

      // Fetch order items
      const { data: itemsData, error: itemsError } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', id);

      if (itemsError) throw itemsError;
      setOrderItems(itemsData || []);

    } catch (error) {
      console.error('[AdminOrderDetail] Error:', error);
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
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
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
      <AdminLayout user={user} adminRole={adminRole} pageTitle="Order Details">
        <div className="flex items-center justify-center py-12">
          <Loader className="h-8 w-8 text-blue-600 animate-spin" />
        </div>
      </AdminLayout>
    );
  }

  if (!order) {
    return (
      <AdminLayout user={user} adminRole={adminRole} pageTitle="Order Details">
        <div className="text-center py-12">
          <p className="text-gray-500">Order not found</p>
          <Link to="/admin/orders" className="text-blue-600 hover:text-blue-700 mt-4 inline-block">
            ← Back to Orders
          </Link>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout user={user} adminRole={adminRole} pageTitle={`Order #${order.order_number || order.id.slice(0, 8)}`}>
      {/* Back button */}
      <button
        onClick={() => navigate('/admin/orders')}
        className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to Orders</span>
      </button>

      {/* Order Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Order #{order.order_number || order.id.slice(0, 8)}
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Placed on {formatDate(order.created_at)}
            </p>
          </div>
          <span
            className={`inline-flex px-4 py-2 text-sm font-semibold rounded-full ${getStatusBadgeClass(
              order.status
            )}`}
          >
            {order.status?.replace('_', ' ')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Order items and details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Items */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <Package className="h-5 w-5" />
              <span>Order Items</span>
            </h2>

            {orderItems.length === 0 ? (
              <p className="text-gray-500">No items in this order</p>
            ) : (
              <div className="space-y-4">
                {orderItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start space-x-4 p-4 bg-gray-50 rounded-lg"
                  >
                    {item.product_image && (
                      <img
                        src={item.product_image}
                        alt={item.product_name}
                        className="w-20 h-20 object-cover rounded"
                      />
                    )}
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900">{item.product_name}</h3>
                      {item.color && (
                        <p className="text-sm text-gray-600">Color: {item.color}</p>
                      )}
                      <p className="text-sm text-gray-600">Quantity: {item.quantity}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-600">
                        {formatCurrency(item.unit_price)} each
                      </p>
                      <p className="font-semibold text-gray-900">
                        {formatCurrency(item.unit_price * item.quantity)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Order Totals */}
            <div className="mt-6 pt-6 border-t border-gray-200 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Subtotal</span>
                <span className="font-semibold">{formatCurrency(order.subtotal || 0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Shipping</span>
                <span className="font-semibold">{formatCurrency(order.shipping_cost || 0)}</span>
              </div>
              {order.tax_amount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Tax</span>
                  <span className="font-semibold">{formatCurrency(order.tax_amount)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-200">
                <span>Total</span>
                <span>{formatCurrency(order.total_amount)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right column - Customer and shipping info */}
        <div className="space-y-6">
          {/* Customer Info */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <User className="h-5 w-5" />
              <span>Customer</span>
            </h2>
            <div className="space-y-3">
              <div>
                <p className="font-semibold text-gray-900">
                  {order.customer_profiles?.company_name ||
                    `${order.customer_profiles?.first_name} ${order.customer_profiles?.last_name}`}
                </p>
              </div>
              <div className="text-sm text-gray-600 space-y-1">
                <p>{order.customer_profiles?.email}</p>
                {order.customer_profiles?.phone && (
                  <p>{order.customer_profiles?.phone}</p>
                )}
              </div>
              <Link
                to={`/admin/customers/${order.customer_profiles?.id}`}
                className="text-sm text-blue-600 hover:text-blue-700 font-semibold"
              >
                View customer profile →
              </Link>
            </div>
          </div>

          {/* Shipping Address */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <MapPin className="h-5 w-5" />
              <span>Shipping Address</span>
            </h2>
            <div className="text-sm text-gray-600 space-y-1">
              {order.shipping_address ? (
                <>
                  <p>{order.shipping_address.line1}</p>
                  {order.shipping_address.line2 && <p>{order.shipping_address.line2}</p>}
                  <p>{order.shipping_address.city}</p>
                  <p>{order.shipping_address.postcode}</p>
                  <p>{order.shipping_address.country}</p>
                </>
              ) : (
                <p className="text-gray-400">No shipping address provided</p>
              )}
            </div>
          </div>

          {/* Payment Info */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <CreditCard className="h-5 w-5" />
              <span>Payment</span>
            </h2>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Status</span>
                <span className="font-semibold capitalize">
                  {order.payment_status || 'Pending'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Method</span>
                <span className="font-semibold capitalize">
                  {order.payment_method || 'Not specified'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
};

export default AdminOrderDetail;
