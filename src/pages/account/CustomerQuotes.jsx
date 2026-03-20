import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, Trash2, ShoppingCart, Loader, AlertCircle, Check, X, CreditCard } from 'lucide-react';
import CustomerLayout from '../../components/customer/CustomerLayout';
import { supabase } from '../../services/supabaseService';
import { supabaseConfig } from '../../config/supabase';

const CustomerQuotes = ({ user }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [quotes, setQuotes] = useState([]);
  const [deletingId, setDeletingId] = useState(null);
  const [convertingQuote, setConvertingQuote] = useState(null); // quote object for confirmation modal
  const [converting, setConverting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(null); // { orderId, orderNumber }
  const [productMinQtys, setProductMinQtys] = useState({});
  const [payingQuoteId, setPayingQuoteId] = useState(null);
  const [payError, setPayError] = useState(null); // { quoteId, message }

  useEffect(() => {
    if (user) fetchQuotes();
  }, [user]);

  const fetchQuotes = async () => {
    try {
      setLoading(true);

      // Fetch quotes with their items in one go
      const { data, error } = await supabase
        .from('quotes')
        .select(`
          *,
          quote_items (*)
        `)
        .eq('customer_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      console.log('[CustomerQuotes] Raw quotes data:', JSON.stringify(data?.map(q => ({
        id: q.id, quote_number: q.quote_number,
        quote_items: q.quote_items,
        keys: Object.keys(q)
      })), null, 2));

      setQuotes(data || []);

      // Fetch min order quantities for all products in these quotes
      const productIds = [...new Set(
        (data || []).flatMap(q => (q.quote_items || []).map(item => item.product_id))
      )].filter(Boolean);

      if (productIds.length > 0) {
        const { data: tierData } = await supabase
          .from('catalog_pricing_tiers')
          .select('catalog_product_id, min_quantity')
          .in('catalog_product_id', productIds)
          .order('min_quantity', { ascending: true });

        const minQtyMap = {};
        tierData?.forEach(tier => {
          if (!minQtyMap[tier.catalog_product_id]) {
            minQtyMap[tier.catalog_product_id] = tier.min_quantity;
          }
        });
        setProductMinQtys(minQtyMap);
      }
    } catch (error) {
      console.error('[CustomerQuotes] Error fetching quotes:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (quoteId, quoteNumber) => {
    if (!confirm(`Delete quote ${quoteNumber}? This cannot be undone.`)) return;

    setDeletingId(quoteId);
    try {
      // Delete quote_items first (child rows)
      const { error: itemsError } = await supabase
        .from('quote_items')
        .delete()
        .eq('quote_id', quoteId);

      if (itemsError) throw itemsError;

      // Then delete the quote
      const { error: quoteError } = await supabase
        .from('quotes')
        .delete()
        .eq('id', quoteId);

      if (quoteError) throw quoteError;

      // Remove from local state
      setQuotes(quotes.filter(q => q.id !== quoteId));

      // Notify header to refresh badge count
      window.dispatchEvent(new Event('quoteCountChanged'));
    } catch (error) {
      console.error('[CustomerQuotes] Error deleting quote:', error);
      alert('Failed to delete quote. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleConvertToOrder = async () => {
    if (!convertingQuote) return;

    const quote = convertingQuote;
    const items = quote.quote_items || [];
    const quoteTotal = getQuoteTotal(items);

    setConverting(true);

    try {
      // Generate order number
      const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}`;
      console.log('[ConvertToOrder] Creating order:', orderNumber, 'from quote:', quote.quote_number);

      // Step 1: Insert order
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          order_number: orderNumber,
          customer_id: user.id,
          status: 'pending',
          artwork_status: 'pending_artwork',
          total_amount: quoteTotal
        })
        .select()
        .single();

      if (orderError) throw orderError;
      console.log('[ConvertToOrder] ✅ Order created:', order.id);

      // Step 2: Insert order_items from quote_items
      const orderItems = items.map(item => ({
        order_id: order.id,
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: Math.round((item.quantity || 0) * (item.unit_price || 0) * 100) / 100,
        color: item.color || null
      }));

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItems);

      if (itemsError) throw itemsError;
      console.log('[ConvertToOrder] ✅ Order items created:', orderItems.length);

      // Step 3: Update quote status to converted
      const { error: updateError } = await supabase
        .from('quotes')
        .update({ status: 'converted' })
        .eq('id', quote.id);

      if (updateError) throw updateError;
      console.log('[ConvertToOrder] ✅ Quote marked as converted');

      // Update local state
      setQuotes(quotes.map(q =>
        q.id === quote.id ? { ...q, status: 'converted' } : q
      ));

      // Notify header
      window.dispatchEvent(new Event('quoteCountChanged'));

      // Show success
      setConvertingQuote(null);
      setOrderSuccess({ orderId: order.id, orderNumber });

    } catch (error) {
      console.error('[ConvertToOrder] ❌ Error:', error);
      alert(`Error converting to order: ${error.message}`);
    } finally {
      setConverting(false);
    }
  };

  const handlePayNow = async (quote) => {
    setPayError(null);
    setPayingQuoteId(quote.id);

    try {
      const functionsUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
        || `${supabaseConfig.url}/functions/v1`;

      const anonKey = supabaseConfig.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY;

      const res = await fetch(`${functionsUrl}/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          quote_id: quote.id,
          customer_email: user?.email || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setPayError({ quoteId: quote.id, message: data.error || 'Payment request failed. Please try again.' });
        setPayingQuoteId(null);
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      } else {
        setPayError({ quoteId: quote.id, message: 'Could not start payment. Please try again.' });
        setPayingQuoteId(null);
      }
    } catch (err) {
      console.error('[handlePayNow] Error:', err);
      setPayError({ quoteId: quote.id, message: 'Could not start payment. Please try again.' });
      setPayingQuoteId(null);
    }
  };

  // Auto-clear pay error after 5 seconds
  useEffect(() => {
    if (!payError) return;
    const timer = setTimeout(() => setPayError(null), 5000);
    return () => clearTimeout(timer);
  }, [payError]);

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  const formatCurrency = (amount) => {
    return `£${parseFloat(amount || 0).toFixed(2)}`;
  };

  const getStatusBadge = (status) => {
    const styles = {
      draft: 'bg-gray-100 text-gray-700',
      sent: 'bg-blue-100 text-blue-700',
      confirmed: 'bg-blue-100 text-blue-700',
      approved: 'bg-green-100 text-green-700',
      converted: 'bg-purple-100 text-purple-700',
      expired: 'bg-red-100 text-red-700',
      cancelled: 'bg-red-100 text-red-700'
    };
    return (
      <span className={`inline-flex px-2.5 py-1 text-xs font-semibold rounded-full ${styles[status] || styles.draft}`}>
        {status?.charAt(0).toUpperCase() + status?.slice(1) || 'Draft'}
      </span>
    );
  };

  const getQuoteTotal = (items) => {
    if (!items || items.length === 0) return 0;
    return items.reduce((sum, item) => sum + ((item.quantity || 0) * (item.unit_price || 0)), 0);
  };

  // Loading skeleton
  if (loading) {
    return (
      <CustomerLayout user={user} pageTitle="My Quotes">
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-pulse">
              <div className="flex justify-between mb-4">
                <div className="h-5 bg-gray-200 rounded w-32" />
                <div className="h-5 bg-gray-200 rounded w-16" />
              </div>
              <div className="h-4 bg-gray-200 rounded w-48 mb-3" />
              <div className="h-4 bg-gray-200 rounded w-64 mb-3" />
              <div className="flex justify-between mt-4">
                <div className="h-8 bg-gray-200 rounded w-24" />
                <div className="h-8 bg-gray-200 rounded w-24" />
              </div>
            </div>
          ))}
        </div>
      </CustomerLayout>
    );
  }

  // Empty state
  if (quotes.length === 0) {
    return (
      <CustomerLayout user={user} pageTitle="My Quotes">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No quotes yet</h3>
          <p className="text-gray-600 mb-6">
            Browse our products and add items to get a quote.
          </p>
          <Link
            to="/"
            className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
          >
            <ShoppingCart className="h-5 w-5" />
            <span>Start Shopping</span>
          </Link>
        </div>
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout user={user} pageTitle="My Quotes">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Quotes</h1>
        <p className="text-gray-600 mt-1">{quotes.length} quote{quotes.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="space-y-4">
        {quotes.map(quote => {
          const items = quote.quote_items || [];
          const quoteTotal = getQuoteTotal(items);

          return (
            <div key={quote.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {/* Quote Header */}
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <div>
                  <div className="flex items-center space-x-3">
                    <h3 className="font-bold text-gray-900">{quote.quote_number}</h3>
                    {getStatusBadge(quote.status)}
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{formatDate(quote.created_at)}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-gray-900">{formatCurrency(quoteTotal)}</p>
                  <p className="text-xs text-gray-500">{items.length} item{items.length !== 1 ? 's' : ''}</p>
                </div>
              </div>

              {/* Items List */}
              {items.length > 0 && (
                <div className="divide-y divide-gray-50">
                  {items.map(item => {
                    const lineTotal = (item.quantity || 0) * (item.unit_price || 0);
                    return (
                      <div key={item.id} className="px-5 py-3 flex items-center justify-between">
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{item.product_name}</p>
                          {item.color && <span className="text-sm text-gray-500">{item.color}</span>}
                          {item.print_areas && (
                            <span className="text-xs bg-gray-100 px-2 py-0.5 rounded ml-2">{item.print_areas}</span>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <label className="text-sm text-gray-500">Qty:</label>
                            <input
                              type="number"
                              min="1"
                              defaultValue={item.quantity || ''}
                              placeholder={productMinQtys[item.product_id] ? `Min. ${productMinQtys[item.product_id]}` : 'Enter qty'}
                              className="w-20 px-2 py-1 text-sm border border-gray-300 rounded"
                              onBlur={async (e) => {
                                const newQty = parseInt(e.target.value);
                                const minQty = productMinQtys[item.product_id] || 1;

                                if (!newQty || newQty < 1) return;

                                if (newQty < minQty) {
                                  alert(`Minimum order quantity for this product is ${minQty} units.`);
                                  e.target.value = minQty;
                                  return;
                                }

                                if (newQty === item.quantity) return;

                                // Find correct unit price for this quantity
                                const { data: tierData } = await supabase
                                  .from('catalog_pricing_tiers')
                                  .select('min_quantity, max_quantity, price_per_unit')
                                  .eq('catalog_product_id', item.product_id)
                                  .order('min_quantity', { ascending: true });

                                let unitPrice = item.unit_price;
                                if (tierData) {
                                  const matchedTier = tierData.find(tier =>
                                    newQty >= tier.min_quantity &&
                                    (tier.max_quantity === null || newQty <= tier.max_quantity)
                                  );
                                  if (matchedTier) unitPrice = matchedTier.price_per_unit;
                                }

                                await supabase
                                  .from('quote_items')
                                  .update({ quantity: newQty, unit_price: unitPrice })
                                  .eq('id', item.id);
                                fetchQuotes();
                              }}
                            />
                            <span className="text-sm text-gray-500">
                              @ {formatCurrency(item.unit_price)} each
                            </span>
                          </div>
                        </div>
                        {item.quantity && item.unit_price ? (
                          <p className="font-semibold text-gray-900 ml-4">{formatCurrency(lineTotal)}</p>
                        ) : (
                          <p className="text-sm text-gray-400 ml-4">Enter qty</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Quote Notes */}
              {quote.notes && (
                <div className="px-5 py-3 bg-yellow-50 border-t border-yellow-100">
                  <p className="text-sm text-yellow-800"><strong>Notes:</strong> {quote.notes}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end space-x-3 px-5 py-4 bg-gray-50 border-t border-gray-100">
                {quote.status === 'converted' ? (
                  <span className="text-sm text-purple-600 font-semibold">Converted to order</span>
                ) : (
                  <>
                    <button
                      onClick={() => handlePayNow(quote)}
                      disabled={payingQuoteId === quote.id}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center space-x-1"
                    >
                      {payingQuoteId === quote.id ? (
                        <>
                          <Loader className="h-4 w-4 animate-spin" />
                          <span>Redirecting to payment...</span>
                        </>
                      ) : (
                        <>
                          <CreditCard className="h-4 w-4" />
                          <span>Pay Now</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setConvertingQuote(quote)}
                      disabled={payingQuoteId === quote.id}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      Convert to Order
                    </button>
                    <button
                      onClick={() => handleDelete(quote.id, quote.quote_number)}
                      disabled={deletingId === quote.id || payingQuoteId === quote.id}
                      className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-50 transition-colors disabled:opacity-50 flex items-center space-x-1"
                    >
                      {deletingId === quote.id ? (
                        <Loader className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      <span>Delete</span>
                    </button>
                  </>
                )}
              </div>
              {payError && payError.quoteId === quote.id && (
                <div className="px-5 py-2 bg-red-50 border-t border-red-100">
                  <p className="text-sm text-red-600 text-right">{payError.message}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Confirmation Modal */}
      {convertingQuote && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Convert to Order</h2>
              <button
                onClick={() => setConvertingQuote(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="p-6">
              <p className="text-sm text-gray-600 mb-4">
                Quote <strong>{convertingQuote.quote_number}</strong>
              </p>

              {/* Items summary */}
              <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-2">
                {(convertingQuote.quote_items || []).map(item => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <span className="text-gray-700">
                      {item.product_name} {item.color ? `(${item.color})` : ''} x{item.quantity}
                    </span>
                    <span className="font-semibold text-gray-900">
                      {formatCurrency(item.quantity * item.unit_price)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 border-t border-gray-200 font-bold">
                  <span>Total</span>
                  <span>{formatCurrency(getQuoteTotal(convertingQuote.quote_items || []))}</span>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-6">
                <p className="text-sm text-amber-800">
                  Once converted, you will need to upload your artwork before we can proceed to print.
                </p>
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => setConvertingQuote(null)}
                  className="flex-1 px-4 py-3 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConvertToOrder}
                  disabled={converting}
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
                >
                  {converting ? (
                    <>
                      <Loader className="h-4 w-4 animate-spin" />
                      <span>Converting...</span>
                    </>
                  ) : (
                    <span>Confirm Order</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {orderSuccess && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Order Placed!</h3>
            <p className="text-gray-600 mb-1">Order reference</p>
            <p className="text-lg font-bold text-blue-600 mb-4">{orderSuccess.orderNumber}</p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-6">
              <p className="text-sm text-amber-800">
                Please upload your artwork so we can begin production.
              </p>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => navigate(`/account/orders/${orderSuccess.orderId}`)}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
              >
                View Order
              </button>
              <button
                onClick={() => setOrderSuccess(null)}
                className="flex-1 px-4 py-3 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
              >
                Back to Quotes
              </button>
            </div>
          </div>
        </div>
      )}
    </CustomerLayout>
  );
};

export default CustomerQuotes;
