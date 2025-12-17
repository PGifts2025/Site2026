import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, Package, Mail, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { useCart } from '../context/CartContext';

const OrderConfirmation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { clearCart } = useCart();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Prevent React StrictMode double-invoke from clearing order data
  const hasProcessed = useRef(false);

  useEffect(() => {
    const sessionId = searchParams.get('session_id');

    console.log('[OrderConfirmation] Loaded, session_id:', sessionId);
    console.log('[OrderConfirmation] Location state:', location.state);

    if (sessionId) {
      // Verify payment with Stripe
      verifyPayment(sessionId);
    } else if (location.state?.order) {
      // Direct navigation with order state (shouldn't happen with Checkout, but kept for compatibility)
      console.log('[OrderConfirmation] Order from location.state');
      setOrder(location.state.order);
      setLoading(false);
    } else {
      // No session and no order - redirect to home
      console.log('[OrderConfirmation] No session_id or order state, redirecting...');
      setError('No order found');
      setLoading(false);
      setTimeout(() => navigate('/'), 3000);
    }
  }, [searchParams, location.state, navigate]);

  const verifyPayment = async (sessionId) => {
    // Prevent React StrictMode double-invoke from overwriting good data
    if (hasProcessed.current) {
      console.log('[OrderConfirmation] ⚠️ Already processed, skipping double-invoke');
      return;
    }
    hasProcessed.current = true;

    try {
      console.log('[OrderConfirmation] Verifying payment session:', sessionId);

      const response = await fetch(`/api/checkout-session?sessionId=${sessionId}`);
      const sessionData = await response.json();

      console.log('[OrderConfirmation] Session data:', sessionData);

      if (sessionData.status === 'paid') {
        console.log('[OrderConfirmation] ✓ Payment successful!');

        // Payment successful - get order from localStorage
        console.log('=== READING ORDER FROM LOCALSTORAGE ===');
        const pendingOrderJson = localStorage.getItem('pendingOrder');
        console.log('[OrderConfirmation] Raw localStorage data:', pendingOrderJson);

        if (pendingOrderJson) {
          const orderData = JSON.parse(pendingOrderJson);
          console.log('[OrderConfirmation] Parsed full order:', orderData);
          console.log('[OrderConfirmation] Parsed items:', orderData.items);
          console.log('[OrderConfirmation] Parsed subtotal:', orderData.subtotal);
          console.log('[OrderConfirmation] Parsed shipping:', orderData.shipping);
          console.log('[OrderConfirmation] Parsed vat:', orderData.vat);
          console.log('[OrderConfirmation] Parsed total:', orderData.total);
          console.log('[OrderConfirmation] Item count:', orderData.items?.length || 0);

          // Add fallback for missing date
          if (!orderData.date) {
            console.warn('[OrderConfirmation] ⚠️ Missing date, using current date');
            orderData.date = new Date().toISOString();
          }

          // Add payment info
          orderData.paymentStatus = 'paid';
          orderData.stripeSessionId = sessionId;
          orderData.paidAt = new Date().toISOString();

          setOrder(orderData);

          // Clear cart (keep localStorage for now - cleared by hasProcessed ref preventing double-invoke)
          clearCart();

          // Note: Not removing pendingOrder from localStorage immediately to prevent
          // React StrictMode double-invoke from losing data. The ref prevents re-processing.

          console.log('[OrderConfirmation] ✓ Order confirmed with', orderData.items?.length || 0, 'items');
        } else {
          console.warn('[OrderConfirmation] ⚠️ No pending order in localStorage, creating minimal order');
          // No pending order but payment succeeded
          setOrder({
            orderNumber: sessionData.metadata?.orderNumber || 'Unknown',
            date: new Date().toISOString(),
            customer: {
              name: sessionData.metadata?.customerName,
              email: sessionData.customerEmail
            },
            total: (sessionData.amountTotal / 100).toFixed(2),
            paymentStatus: 'paid',
            paidAt: new Date().toISOString()
          });
          clearCart();
        }
      } else {
        console.error('[OrderConfirmation] ✗ Payment not completed. Status:', sessionData.status);
        setError('Payment not completed. Status: ' + sessionData.status);
      }
    } catch (err) {
      console.error('[OrderConfirmation] ✗ Verification error:', err);
      setError('Failed to verify payment. Please contact support.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className='min-h-screen bg-gray-50 flex items-center justify-center'>
        <div className='text-center'>
          <Loader2 className='w-12 h-12 text-blue-600 animate-spin mx-auto mb-4' />
          <p className='text-gray-600'>Confirming your payment...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='min-h-screen bg-gray-50 flex items-center justify-center p-4'>
        <div className='bg-white rounded-2xl shadow-lg p-8 max-w-md text-center'>
          <AlertCircle className='w-16 h-16 text-red-500 mx-auto mb-4' />
          <h1 className='text-2xl font-bold text-gray-900 mb-4'>Order Issue</h1>
          <p className='text-gray-600 mb-6'>{error}</p>
          <Link
            to='/cables'
            className='inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors'
          >
            Continue Shopping
            <ArrowRight className='w-4 h-4' />
          </Link>
        </div>
      </div>
    );
  }

  if (!order) {
    return null;
  }

  return (
    <div className='min-h-screen bg-gray-50 py-12 px-4'>
      <div className='max-w-2xl mx-auto'>

        {/* Print-Only Receipt - Hidden on screen, shown when printing */}
        <div className='hidden print:block'>
          <style>{`
            @media print {
              body {
                background: white !important;
              }
              .no-print {
                display: none !important;
              }
              .print-only {
                display: block !important;
              }
            }
          `}</style>

          {/* Company Header */}
          <div className='text-center mb-8 border-b-2 border-black pb-4'>
            <h1 className='text-3xl font-bold mb-2'>Promo Gifts</h1>
            <p className='text-lg'>YOUR PROMOTIONAL PARTNER</p>
            <p className='text-base mt-2'>01844 600900</p>
          </div>

          {/* Receipt Title */}
          <div className='text-center mb-6'>
            <h2 className='text-2xl font-bold mb-2'>ORDER RECEIPT</h2>
            <p className='text-base'>Order Number: <span className='font-mono font-bold'>{order.orderNumber}</span></p>
            <p className='text-base'>Date: {order.date || order.paidAt ? new Date(order.date || order.paidAt).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB')}</p>
          </div>

          {/* Customer Details */}
          <div className='mb-6'>
            <h3 className='font-bold text-lg mb-2'>Bill To:</h3>
            <p>{order.customer?.name}</p>
            <p>{order.customer?.email}</p>
            {order.customer?.phone && <p>{order.customer.phone}</p>}
            {order.customer?.company && <p>{order.customer.company}</p>}
          </div>

          {/* Shipping Address */}
          {order.shippingAddress && (
            <div className='mb-6'>
              <h3 className='font-bold text-lg mb-2'>Ship To:</h3>
              <p>{order.shippingAddress.line1}</p>
              {order.shippingAddress.line2 && <p>{order.shippingAddress.line2}</p>}
              <p>{order.shippingAddress.city}, {order.shippingAddress.postcode}</p>
              {order.shippingAddress.county && <p>{order.shippingAddress.county}</p>}
              <p>{order.shippingAddress.country}</p>
            </div>
          )}

          {/* Items Table */}
          {order.items && order.items.length > 0 && (
            <table className='w-full mb-6 border-collapse'>
              <thead>
                <tr className='border-b-2 border-black'>
                  <th className='text-left py-2 text-base'>Description</th>
                  <th className='text-center py-2 text-base'>Qty</th>
                  <th className='text-right py-2 text-base'>Unit Price</th>
                  <th className='text-right py-2 text-base'>Amount</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item, index) => {
                  const unitPrice = parseFloat(item.unit_price || item.unitPrice || item.price || 0);
                  const lineTotal = unitPrice * (item.quantity || 0);
                  return (
                    <tr key={index} className='border-b border-gray-300'>
                      <td className='py-2'>
                        <div>{item.name || item.product_name || 'Product'}</div>
                        <div className='text-sm text-gray-600'>Color: {item.color || 'N/A'}</div>
                      </td>
                      <td className='text-center py-2'>{item.quantity || 0}</td>
                      <td className='text-right py-2'>£{unitPrice.toFixed(2)}</td>
                      <td className='text-right py-2'>£{lineTotal.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Totals */}
          <div className='border-t-2 border-black pt-4 ml-auto' style={{width: '300px'}}>
            <div className='flex justify-between py-1 text-base'>
              <span>Subtotal:</span>
              <span>£{parseFloat(order.subtotal || 0).toFixed(2)}</span>
            </div>
            <div className='flex justify-between py-1 text-base'>
              <span>Shipping:</span>
              <span>£{parseFloat(order.shipping || 0).toFixed(2)}</span>
            </div>
            <div className='flex justify-between py-1 text-base'>
              <span>VAT (20%):</span>
              <span>£{parseFloat(order.vat || 0).toFixed(2)}</span>
            </div>
            <div className='flex justify-between py-2 font-bold text-xl border-t-2 border-black mt-2'>
              <span>TOTAL:</span>
              <span>£{parseFloat(order.total || 0).toFixed(2)}</span>
            </div>
          </div>

          {/* Footer */}
          <div className='text-center mt-8 pt-4 border-t-2 border-black'>
            <p className='text-base font-semibold mb-2'>Thank you for your order!</p>
            <p className='text-sm'>For queries, contact us at 01844 600900</p>
          </div>
        </div>

        {/* Screen View - Hidden when printing */}
        <div className='no-print'>
        {/* Success Header */}
        <div className='bg-white rounded-2xl shadow-lg p-8 text-center mb-6'>
          <div className='w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6'>
            <CheckCircle className='w-12 h-12 text-green-600' />
          </div>
          <h1 className='text-3xl font-bold text-gray-900 mb-2'>Payment Successful!</h1>
          <p className='text-gray-600 mb-4'>Thank you for your order</p>
          <div className='bg-gray-100 rounded-lg px-4 py-2 inline-block'>
            <span className='text-sm text-gray-500'>Order Number: </span>
            <span className='font-mono font-bold text-gray-900'>{order.orderNumber}</span>
          </div>
        </div>

        {/* Order Summary */}
        {order.items && order.items.length > 0 && (
          <div className='bg-white rounded-2xl shadow-lg p-6 mb-6'>
            <h2 className='text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2'>
              <Package className='w-5 h-5 text-blue-600' />
              Order Summary
            </h2>

            <div className='space-y-3 mb-4'>
              {order.items.map((item, index) => {
                const unitPrice = parseFloat(item.unit_price || item.unitPrice || item.price || 0);
                const lineTotal = unitPrice * (item.quantity || 0);
                return (
                  <div key={index} className='flex justify-between py-2 border-b border-gray-100'>
                    <div>
                      <p className='font-medium text-gray-900'>{item.name || item.product_name || 'Product'}</p>
                      <p className='text-sm text-gray-500'>Color: {item.color || 'N/A'} | Qty: {item.quantity || 0}</p>
                    </div>
                    <p className='font-medium text-gray-900'>
                      £{lineTotal.toFixed(2)}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className='space-y-2 pt-4 border-t border-gray-200'>
              <div className='flex justify-between text-gray-600'>
                <span>Subtotal</span>
                <span>£{parseFloat(order.subtotal || 0).toFixed(2)}</span>
              </div>
              <div className='flex justify-between text-gray-600'>
                <span>Shipping</span>
                <span>£{parseFloat(order.shipping || 0).toFixed(2)}</span>
              </div>
              <div className='flex justify-between text-gray-600'>
                <span>VAT (20%)</span>
                <span>£{parseFloat(order.vat || 0).toFixed(2)}</span>
              </div>
              <div className='flex justify-between text-lg font-bold text-gray-900 pt-2 border-t'>
                <span>Total Paid</span>
                <span>£{parseFloat(order.total || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Shipping Info */}
        {order.shippingAddress && (
          <div className='bg-white rounded-2xl shadow-lg p-6 mb-6'>
            <h2 className='text-lg font-semibold text-gray-900 mb-4'>Shipping To</h2>
            <div className='text-gray-600'>
              <p className='font-medium text-gray-900'>{order.customer?.name}</p>
              <p>{order.shippingAddress.line1}</p>
              {order.shippingAddress.line2 && <p>{order.shippingAddress.line2}</p>}
              <p>{order.shippingAddress.city}, {order.shippingAddress.postcode}</p>
              <p>{order.shippingAddress.country}</p>
            </div>
          </div>
        )}

        {/* Email Confirmation */}
        <div className='bg-blue-50 rounded-xl p-4 mb-6 flex items-start gap-3'>
          <Mail className='w-5 h-5 text-blue-600 mt-0.5' />
          <div>
            <p className='font-medium text-blue-900'>Order Confirmed</p>
            <p className='text-sm text-blue-700'>
              A confirmation will be sent to {order.customer?.email}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className='flex gap-4'>
          <Link
            to='/cables'
            className='flex-1 bg-blue-600 text-white py-4 rounded-xl font-semibold text-center hover:bg-blue-700 transition-colors'
          >
            Continue Shopping
          </Link>
          <button
            onClick={() => window.print()}
            className='flex-1 border-2 border-gray-300 text-gray-700 py-4 rounded-xl font-semibold hover:bg-gray-50 transition-colors'
          >
            Print Receipt
          </button>
        </div>
        </div>
        {/* End of no-print section */}
      </div>
    </div>
  );
};

export default OrderConfirmation;
