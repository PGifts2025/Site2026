import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader, MapPin, Printer } from 'lucide-react';
import CustomerLayout from '../../components/customer/CustomerLayout';
import { supabase } from '../../services/supabaseService';
import DeliveryAddressForm from '../../components/DeliveryAddressForm';
import { BUSINESS } from '../../config/business';
import { formatSizeBreakdown } from '../../utils/laltexSizes';

// Delivery address can no longer be edited by the customer once the order has
// advanced to (or past) approval — at that point production is committed.
const DELIVERY_LOCKED_STATUSES = new Set(['approved', 'in_production', 'shipped', 'delivered']);

const CustomerOrderDetail = ({ user }) => {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [profile, setProfile] = useState(null);
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

      // Customer identity for the invoice bill-to (name/company/email).
      const { data: profileData } = await supabase
        .from('customer_profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      setProfile(profileData || null);

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

  const customerName =
    profile?.contact_name ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() ||
    null;
  const customerEmail = profile?.email || user?.email || null;
  const company = order.shipping_address?.company || profile?.company_name || null;
  const addr = order.shipping_address;
  const subtotal = Number(order.subtotal) || 0;
  const vat = Number(order.tax_amount) || 0;
  const total = Number(order.total_amount) || 0;

  return (
    <CustomerLayout user={user} pageTitle={`Order #${order.order_number || order.id.slice(0, 8)}`}>
      {/* Action bar — not part of the printed invoice */}
      <div className="no-print flex items-center justify-between mb-6">
        <Link
          to="/account/orders"
          className="flex items-center space-x-2 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Orders</span>
        </Link>
        <button
          onClick={() => window.print()}
          className="flex items-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-800 transition-colors"
        >
          <Printer className="h-4 w-4" />
          <span>Print / Save as PDF</span>
        </button>
      </div>

      {/* VAT INVOICE — the only element shown when printing (see index.css @media print) */}
      <div className="invoice-print-area bg-white rounded-xl shadow-sm border border-gray-200 p-6 md:p-8 mb-6">
        {/* Supplier + invoice header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-6 border-b border-gray-200">
          <div>
            <div className="text-2xl font-bold text-gray-900">{BUSINESS.tradingName}</div>
            <div className="text-sm text-gray-600 mt-1 leading-relaxed">
              {BUSINESS.tradingAddress.map((l, i) => <div key={i}>{l}</div>)}
            </div>
            <div className="text-sm text-gray-700 mt-2">VAT No: {BUSINESS.vatNumber}</div>
          </div>
          <div className="sm:text-right">
            <div className="text-lg font-bold text-gray-900 uppercase tracking-wide">VAT Invoice</div>
            <div className="text-sm text-gray-700 mt-1">
              Order #{order.order_number || order.id.slice(0, 8)}
            </div>
            <div className="text-sm text-gray-600">Date: {formatDate(order.created_at)}</div>
            <div className="text-sm text-gray-600 capitalize">Status: {order.status}</div>
            {order.po_number && <div className="text-sm text-gray-600">PO: {order.po_number}</div>}
          </div>
        </div>

        {/* Bill / deliver to */}
        <div className="py-6 border-b border-gray-200">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Invoice to</div>
          {addr ? (
            <div className="text-sm text-gray-800 leading-relaxed">
              {company && <div className="font-semibold">{company}</div>}
              {addr.fao && <div>FAO: {addr.fao}</div>}
              {customerName && <div>{customerName}</div>}
              <div>{addr.line1}</div>
              {addr.line2 && <div>{addr.line2}</div>}
              <div>{[addr.city, addr.postcode].filter(Boolean).join(', ')}</div>
              {addr.country && <div>{addr.country}</div>}
              {customerEmail && <div className="text-gray-600 mt-1">{customerEmail}</div>}
            </div>
          ) : (
            <div className="text-sm text-gray-800 leading-relaxed">
              {company && <div className="font-semibold">{company}</div>}
              {customerName && <div>{customerName}</div>}
              {customerEmail && <div className="text-gray-600">{customerEmail}</div>}
              <div className="mt-2 inline-block text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Delivery address pending
              </div>
            </div>
          )}
        </div>

        {/* Line items */}
        <div className="py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 font-semibold">Description</th>
                <th className="py-2 font-semibold text-center">Qty</th>
                <th className="py-2 font-semibold text-right">Unit price (ex VAT)</th>
                <th className="py-2 font-semibold text-right">Line net</th>
              </tr>
            </thead>
            <tbody>
              {orderItems.length === 0 ? (
                <tr><td colSpan={4} className="py-4 text-gray-500">No items in this order</td></tr>
              ) : (
                orderItems.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100 align-top">
                    <td className="py-3 pr-2">
                      <div className="font-medium text-gray-900">{item.product_name}</div>
                      {item.color && <div className="text-xs text-gray-500">Colour: {item.color}</div>}
                      {formatSizeBreakdown(item.size_breakdown) && (
                        <div className="text-xs text-gray-500">Sizes: {formatSizeBreakdown(item.size_breakdown)}</div>
                      )}
                    </td>
                    <td className="py-3 text-center text-gray-700">{item.quantity}</td>
                    <td className="py-3 text-right text-gray-700">{formatCurrency(item.unit_price)}</td>
                    <td className="py-3 text-right text-gray-900">{formatCurrency(item.unit_price * item.quantity)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="pt-4 flex justify-end">
          <div className="w-full sm:w-72 space-y-2">
            <div className="flex justify-between text-sm text-gray-700">
              <span>Subtotal (ex VAT)</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-700">
              <span>VAT</span>
              <span>{formatCurrency(vat)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-gray-900 pt-2 border-t border-gray-200">
              <span>Total</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>
        </div>

        {/* Disclosure (Companies Act) */}
        <div className="pt-6 mt-6 border-t border-gray-200 text-xs text-gray-500 leading-relaxed">
          <div>{BUSINESS.disclosure}</div>
          <div>VAT No: {BUSINESS.vatNumber} · {BUSINESS.phone} · {BUSINESS.email}</div>
        </div>
      </div>

      {/* Delivery details (PR B) — editable until the order reaches approval */}
      <div className="no-print bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
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
