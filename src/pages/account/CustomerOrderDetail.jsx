import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Package, Loader, MapPin } from 'lucide-react';
import CustomerLayout from '../../components/customer/CustomerLayout';
import { supabase } from '../../services/supabaseService';
import DeliveryAddressForm from '../../components/DeliveryAddressForm';

// Delivery address can no longer be edited by the customer once the order has
// advanced to (or past) approval — at that point production is committed.
const DELIVERY_LOCKED_STATUSES = new Set(['approved', 'in_production', 'shipped', 'delivered']);

const CustomerOrderDetail = ({ user }) => {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [editingDelivery, setEditingDelivery] = useState(false);

  useEffect(() => {
    fetchOrderDetail();
  }, [id]);

  const fetchOrderDetail = async () => {
    try {
      setLoading(true);

      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', id)
        .eq('customer_id', user.id)
        .single();

      if (orderError) throw orderError;
      setOrder(orderData);

      const { data: itemsData, error: itemsError } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', id);

      if (itemsError) throw itemsError;
      setOrderItems(itemsData || []);

    } catch (error) {
      console.error('[CustomerOrderDetail] Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveOrderDelivery = async (address, poNumber) => {
    const { error } = await supabase
      .from('orders')
      .update({ shipping_address: address, po_number: poNumber || null })
      .eq('id', id)
      .eq('customer_id', user.id);
    if (error) throw error;
    setOrder((prev) => ({ ...prev, shipping_address: address, po_number: poNumber || null }));
    setEditingDelivery(false);
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
      year: 'numeric'
    });
  };

  if (loading) {
    return (
      <CustomerLayout user={user} pageTitle="Order Details">
        <div className="flex items-center justify-center py-12">
          <Loader className="h-8 w-8 text-blue-600 animate-spin" />
        </div>
      </CustomerLayout>
    );
  }

  if (!order) {
    return (
      <CustomerLayout user={user} pageTitle="Order Details">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500 mb-4">Order not found</p>
          <Link to="/account/orders" className="text-blue-600 hover:text-blue-700 font-semibold">
            ← Back to Orders
          </Link>
        </div>
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout user={user} pageTitle={`Order #${order.order_number || order.id.slice(0, 8)}`}>
      <Link
        to="/account/orders"
        className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to Orders</span>
      </Link>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Order #{order.order_number || order.id.slice(0, 8)}
            </h1>
            <p className="text-sm text-gray-600 mt-1">Placed on {formatDate(order.created_at)}</p>
          </div>
          <span className="inline-flex px-4 py-2 text-sm font-semibold rounded-full bg-blue-100 text-blue-800">
            {order.status}
          </span>
        </div>
      </div>

      {/* Order Items */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center space-x-2">
          <Package className="h-5 w-5" />
          <span>Order Items</span>
        </h2>

        {orderItems.length === 0 ? (
          <p className="text-gray-500">No items in this order</p>
        ) : (
          <div className="space-y-4">
            {orderItems.map((item) => (
              <div key={item.id} className="flex items-start space-x-4 p-4 bg-gray-50 rounded-lg">
                {item.product_image && (
                  <img
                    src={item.product_image}
                    alt={item.product_name}
                    className="w-20 h-20 object-cover rounded"
                  />
                )}
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">{item.product_name}</h3>
                  {item.color && <p className="text-sm text-gray-600">Color: {item.color}</p>}
                  <p className="text-sm text-gray-600">Quantity: {item.quantity}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">{formatCurrency(item.unit_price)} each</p>
                  <p className="font-semibold text-gray-900">{formatCurrency(item.unit_price * item.quantity)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Totals */}
        <div className="mt-6 pt-6 border-t border-gray-200 space-y-2">
          <div className="flex justify-between text-lg font-bold">
            <span>Total</span>
            <span>{formatCurrency(order.total_amount)}</span>
          </div>
        </div>
      </div>

      {/* Delivery details (PR B) — editable until the order reaches approval */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 flex items-center space-x-2">
            <MapPin className="h-5 w-5" />
            <span>Delivery details</span>
          </h2>
          {!DELIVERY_LOCKED_STATUSES.has(order.artwork_status) && !editingDelivery && (
            <button
              onClick={() => setEditingDelivery(true)}
              className="text-sm text-blue-600 hover:text-blue-700 font-semibold"
            >
              {order.shipping_address ? 'Edit' : 'Add delivery address'}
            </button>
          )}
        </div>

        {editingDelivery ? (
          <DeliveryAddressForm
            entity={order}
            showAccountToggle={false}
            onSave={saveOrderDelivery}
          />
        ) : order.shipping_address ? (
          <div className="text-sm text-gray-600 leading-relaxed">
            {order.shipping_address.company && <div>{order.shipping_address.company}</div>}
            {order.shipping_address.fao && <div>FAO: {order.shipping_address.fao}</div>}
            <div>{order.shipping_address.line1}</div>
            {order.shipping_address.line2 && <div>{order.shipping_address.line2}</div>}
            <div>{[order.shipping_address.city, order.shipping_address.postcode].filter(Boolean).join(', ')}</div>
            <div>{order.shipping_address.country}</div>
            {order.shipping_address.phone && <div>Phone: {order.shipping_address.phone}</div>}
            {order.shipping_address.instructions && (
              <div className="italic mt-1">Instructions: {order.shipping_address.instructions}</div>
            )}
            {order.po_number && <div className="mt-1">PO: {order.po_number}</div>}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No delivery address on file yet.</p>
        )}

        {DELIVERY_LOCKED_STATUSES.has(order.artwork_status) && (
          <p className="text-xs text-gray-400 mt-3">
            Cannot edit after approval — please contact us if the address needs to change.
          </p>
        )}
      </div>
    </CustomerLayout>
  );
};

export default CustomerOrderDetail;
