import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, Loader2, XCircle, Upload, ClipboardCheck, Truck } from 'lucide-react';
import { supabaseConfig } from '../config/supabase';

const OrderConfirmation = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [orderId, setOrderId] = useState(null);

  // Prevent React StrictMode double-invoke
  const hasProcessed = useRef(false);

  useEffect(() => {
    const sessionId = searchParams.get('session_id');

    if (sessionId) {
      confirmPayment(sessionId);
    } else {
      setError('No payment session found.');
      setLoading(false);
    }
  }, [searchParams]);

  const confirmPayment = async (sessionId) => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    try {
      const functionsUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
        || `${supabaseConfig.url}/functions/v1`;

      const anonKey = supabaseConfig.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY;

      const res = await fetch(`${functionsUrl}/confirm-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ session_id: sessionId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Payment could not be verified.');
        return;
      }

      if (data.success && data.order_id) {
        setOrderId(data.order_id);
      } else {
        setError('Payment could not be verified.');
      }
    } catch (err) {
      console.error('[OrderConfirmation] Error:', err);
      setError('Payment could not be verified.');
    } finally {
      setLoading(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg mx-auto text-center">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Confirming your payment...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg mx-auto text-center">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment could not be verified</h1>
          <p className="text-gray-600 mb-6">Please contact us if you believe this is an error.</p>
          <Link
            to="/account/quotes"
            className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Back to My Quotes
          </Link>
        </div>
      </div>
    );
  }

  // Short order reference from the UUID
  const orderRef = orderId ? orderId.slice(-8).toUpperCase() : '';

  // Success state
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg mx-auto mt-16">
        {/* Success header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-12 h-12 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Payment Successful!</h1>
          <p className="text-gray-600">
            Thank you for your order. Your order reference is{' '}
            <span className="font-mono font-bold text-gray-900">#{orderRef}</span>
          </p>
        </div>

        {/* What happens next */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">What happens next?</h2>
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                <Upload className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">1. Upload your artwork</p>
                <p className="text-sm text-gray-600">
                  We'll need your logo or design file to get started. You can upload it now or we'll remind you by email.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                <ClipboardCheck className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">2. We review and send a proof</p>
                <p className="text-sm text-gray-600">
                  Our team will prepare a visual proof for your approval before production begins.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                <Truck className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">3. Production & delivery</p>
                <p className="text-sm text-gray-600">
                  Once you approve the proof, we'll get your order into production.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-3 mb-4">
          <Link
            to="/account/orders"
            className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg font-semibold text-center hover:bg-blue-700 transition-colors"
          >
            Upload Artwork Now
          </Link>
          <Link
            to="/account/orders"
            className="flex-1 px-4 py-3 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold text-center hover:bg-gray-50 transition-colors"
          >
            View My Orders
          </Link>
        </div>

        <p className="text-xs text-gray-400 text-center">
          A confirmation email will be sent to you shortly.
        </p>
      </div>
    </div>
  );
};

export default OrderConfirmation;
