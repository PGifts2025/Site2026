import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FileText, Trash2, ShoppingCart, Loader, AlertCircle, Check, CreditCard } from 'lucide-react';
import CustomerLayout from '../../components/customer/CustomerLayout';
import { supabase } from '../../services/supabaseService';
import { supabaseConfig } from '../../config/supabase';
import DeliveryAddressForm from '../../components/DeliveryAddressForm';
import { buildAccountSnapshot, accountHasAddress } from '../../lib/deliveryValidation';
import { formatSizeBreakdown } from '../../utils/laltexSizes';
import { formatGBP } from '../../utils/currency';

/**
 * Render `quote_items.print_areas` (jsonb) as a short descriptor for
 * the line-item chip. Handles three shapes:
 *   - {selections: [{position, area, num_colours, ...}]}  (v2 picker, session 9)
 *   - "Front Chest: 1 col"                                (legacy string)
 *   - null / undefined                                    -> ""
 */
function formatPrintAreas(value) {
  if (!value) return '';
  // Legacy string format
  if (typeof value === 'string') return value;
  // Structured v2 jsonb shape
  if (value && Array.isArray(value.selections)) {
    return value.selections
      .map((s) => {
        const parts = [s.position];
        if (s.area) parts.push(s.area);
        if (s.num_colours) parts.push(`${s.num_colours} col${s.num_colours > 1 ? 's' : ''}`);
        return parts.filter(Boolean).join(', ');
      })
      .join(' / ');
  }
  // Defensive fallback for anything else
  try { return JSON.stringify(value); } catch { return ''; }
}

const CustomerQuotes = ({ user }) => {
  const location = useLocation();
  const [flash, setFlash] = useState(location.state?.flash || null);
  const [loading, setLoading] = useState(true);
  const [quotes, setQuotes] = useState([]);
  const [deletingId, setDeletingId] = useState(null);
  const [lineInfo, setLineInfo] = useState({ products: {}, suppliers: {} });
  const [qtyErrors, setQtyErrors] = useState({}); // { [itemId]: message }
  const [payingQuoteId, setPayingQuoteId] = useState(null);
  const [payError, setPayError] = useState(null); // { quoteId, message }
  // Delivery (PR B): the customer's account address (for the snapshot
  // fallback) + per-quote delivery form status ({mode, dirty}).
  const [accountProfile, setAccountProfile] = useState(null);
  const [deliveryStatus, setDeliveryStatus] = useState({}); // { [quoteId]: { mode, dirty, hasAccountAddress } }
  // "Combine quotes" feature: selection + confirmation state. Only draft quotes
  // are selectable; the combine merges all selected into the earliest-created.
  const [selectedQuoteIds, setSelectedQuoteIds] = useState(() => new Set());
  const [combineConfirmOpen, setCombineConfirmOpen] = useState(false);
  const [combining, setCombining] = useState(false);
  const [combineError, setCombineError] = useState(null);

  useEffect(() => {
    if (!flash) return;
    window.history.replaceState({}, '');
    const timer = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    if (user) {
      fetchQuotes();
      // Account address — used as the snapshot fallback when the customer
      // delivers to their own address (PR B). customer_profiles.id === auth uid.
      supabase
        .from('customer_profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data }) => setAccountProfile(data || null));
    }
  }, [user]);

  // Persist delivery details onto a quote (jsonb shipping_address + po_number).
  const saveQuoteDelivery = async (quoteId, address, poNumber) => {
    const { error } = await supabase
      .from('quotes')
      .update({ shipping_address: address, po_number: poNumber || null })
      .eq('id', quoteId);
    if (error) throw error;
    setQuotes((prev) =>
      prev.map((q) =>
        q.id === quoteId ? { ...q, shipping_address: address, po_number: poNumber || null } : q,
      ),
    );
  };

  const handleDeliveryStatus = (quoteId, status) => {
    setDeliveryStatus((prev) => {
      const existing = prev[quoteId];
      if (existing && existing.mode === status.mode && existing.dirty === status.dirty
          && existing.hasAccountAddress === status.hasAccountAddress) {
        return prev; // no change — avoid needless re-render
      }
      return { ...prev, [quoteId]: status };
    });
  };

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

      // Per-line editing info. Only tier-priced catalog products can change
      // quantity here (the set_quote_item_quantity RPC re-prices them
      // server-side); clothing, bags and Laltex lines link to their product
      // page instead. Keyed on product_id / supplier_product_id, never names.
      const allItems = (data || []).flatMap(q => q.quote_items || []);
      const productIds = [...new Set(allItems.map(i => i.product_id).filter(Boolean))];
      const supplierIds = [...new Set(allItems.map(i => i.supplier_product_id).filter(Boolean))];
      const none = Promise.resolve({ data: [] });

      const [productsRes, tiersRes, printRes, bagRes, suppliersRes] = await Promise.all([
        productIds.length ? supabase.from('catalog_products').select('id, slug').in('id', productIds) : none,
        productIds.length
          ? supabase.from('catalog_pricing_tiers').select('catalog_product_id, min_quantity').in('catalog_product_id', productIds)
          : none,
        productIds.length
          ? supabase.from('catalog_print_pricing').select('catalog_product_id').in('catalog_product_id', productIds)
          : none,
        productIds.length
          ? supabase.from('bag_print_pricing').select('catalog_product_id').in('catalog_product_id', productIds)
          : none,
        supplierIds.length
          ? supabase.from('supplier_products').select('id, supplier_product_code').in('id', supplierIds)
          : none,
      ]);

      const engineDriven = new Set(
        [...(printRes.data || []), ...(bagRes.data || [])].map(r => r.catalog_product_id)
      );
      const info = {};
      (productsRes.data || []).forEach(p => {
        const mins = (tiersRes.data || [])
          .filter(t => t.catalog_product_id === p.id)
          .map(t => t.min_quantity);
        info[p.id] = {
          href: `/products/${p.slug}`,
          editable: mins.length > 0 && !engineDriven.has(p.id),
          moq: mins.length ? Math.min(...mins) : null,
        };
      });
      const supplierHrefs = {};
      (suppliersRes.data || []).forEach(sp => {
        supplierHrefs[sp.id] = `/products/${sp.supplier_product_code}`;
      });
      setLineInfo({ products: info, suppliers: supplierHrefs });
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
      // Clear from any pending combine selection
      setSelectedQuoteIds(prev => {
        if (!prev.has(quoteId)) return prev;
        const next = new Set(prev);
        next.delete(quoteId);
        return next;
      });

      // Notify header to refresh badge count
      window.dispatchEvent(new Event('quoteCountChanged'));
    } catch (error) {
      console.error('[CustomerQuotes] Error deleting quote:', error);
      alert('Failed to delete quote. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const toggleQuoteSelection = (quoteId) => {
    setSelectedQuoteIds(prev => {
      const next = new Set(prev);
      if (next.has(quoteId)) next.delete(quoteId);
      else next.add(quoteId);
      return next;
    });
  };

  const handleCombineQuotes = async () => {
    const ids = Array.from(selectedQuoteIds);
    if (ids.length < 2) return;

    setCombining(true);
    setCombineError(null);
    try {
      // Server-side safety: re-read statuses; only combine drafts.
      const { data: rows, error: fetchErr } = await supabase
        .from('quotes')
        .select('id, status, created_at')
        .in('id', ids);
      if (fetchErr) throw fetchErr;
      if (!rows || rows.length !== ids.length) {
        throw new Error('One or more selected quotes could not be loaded.');
      }
      if (rows.some(q => q.status !== 'draft')) {
        throw new Error('Only draft quotes can be combined.');
      }

      // Target = earliest-created quote; the rest get folded in.
      const sorted = [...rows].sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      );
      const targetId = sorted[0].id;
      const otherIds = sorted.slice(1).map(q => q.id);

      // Ownership/draft checks, the item move, the total recompute (via the
      // quote_items trigger) and deleting the emptied quotes all happen
      // server-side — customers can't write quote totals directly.
      const { error: combineErr } = await supabase.rpc('combine_quotes', {
        p_target_id: targetId,
        p_other_ids: otherIds,
      });
      if (combineErr) throw combineErr;

      setSelectedQuoteIds(new Set());
      setCombineConfirmOpen(false);
      await fetchQuotes();
      window.dispatchEvent(new Event('quoteCountChanged'));
    } catch (error) {
      console.error('[CustomerQuotes] Combine failed:', error);
      setCombineError(error.message || 'Failed to combine quotes. Please try again.');
    } finally {
      setCombining(false);
    }
  };

  const handlePayNow = async (quote) => {
    setPayError(null);

    // ---- Delivery gate + snapshot (PR B) ----
    // Resolve the form's reported status (defaults derived from the quote +
    // account when the form hasn't reported yet, e.g. immediately on load).
    const hasAcct = accountHasAddress(accountProfile);
    const status = deliveryStatus[quote.id] || {
      mode: quote.shipping_address ? 'custom' : (hasAcct ? 'account' : 'custom'),
      dirty: false,
      hasAccountAddress: hasAcct,
    };

    let workingQuote = quote;

    // Custom address with unsaved edits → make them save first.
    if (status.mode === 'custom' && status.dirty) {
      setPayError({ quoteId: quote.id, message: 'Please save delivery details first.' });
      return;
    }

    // Account address → snapshot it onto the quote if not already set.
    if (status.mode === 'account') {
      if (!hasAcct) {
        setPayError({ quoteId: quote.id, message: 'Please add a delivery address before paying.' });
        return;
      }
      if (!quote.shipping_address) {
        try {
          const snap = buildAccountSnapshot(accountProfile);
          await saveQuoteDelivery(quote.id, snap, quote.po_number || '');
          workingQuote = { ...quote, shipping_address: snap };
        } catch (err) {
          console.error('[handlePayNow] snapshot save failed:', err);
          setPayError({ quoteId: quote.id, message: 'Could not save delivery address. Please try again.' });
          return;
        }
      }
    }

    // Final guard: a deliverable address (hard-required fields) must exist.
    const addr = workingQuote.shipping_address || {};
    if (!addr.line1 || !addr.city || !addr.postcode || !addr.country) {
      setPayError({ quoteId: quote.id, message: 'Please add and save your delivery address before paying.' });
      return;
    }

    setPayingQuoteId(quote.id);

    try {
      const functionsUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
        || `${supabaseConfig.url}/functions/v1`;

      const anonKey = supabaseConfig.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY;

      // The function verifies quote ownership from this token, so it must be
      // the user's session JWT — the anon key identifies nobody.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setPayError({ quoteId: quote.id, message: 'Your session has expired. Please sign in again to pay.' });
        setPayingQuoteId(null);
        return;
      }

      const res = await fetch(`${functionsUrl}/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': anonKey,
        },
        body: JSON.stringify({ quote_id: quote.id }),
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
    return formatGBP(parseFloat(amount || 0));
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

      {flash && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
          <Check className="h-4 w-4 flex-shrink-0" />
          <span>{flash}</span>
        </div>
      )}

      {selectedQuoteIds.size >= 2 && (
        <div className="mb-4 flex items-center justify-between p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <p className="text-sm text-blue-900 font-medium">
            {selectedQuoteIds.size} draft quote{selectedQuoteIds.size !== 1 ? 's' : ''} selected
          </p>
          <button
            onClick={() => { setCombineError(null); setCombineConfirmOpen(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            Combine {selectedQuoteIds.size} selected quotes
          </button>
        </div>
      )}

      {quotes.filter(q => q.status === 'draft').length >= 2 && (
        <p className="mb-4 text-sm text-blue-500">
          💡 Tip: Tick multiple quotes to combine them into a single order
        </p>
      )}

      <div className="space-y-4">
        {quotes.map(quote => {
          const items = quote.quote_items || [];
          const quoteTotal = getQuoteTotal(items);

          return (
            <div key={quote.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {/* Quote Header */}
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <div className="flex items-start gap-3">
                  {quote.status === 'draft' && (
                    <input
                      type="checkbox"
                      checked={selectedQuoteIds.has(quote.id)}
                      onChange={() => toggleQuoteSelection(quote.id)}
                      aria-label={`Select quote ${quote.quote_number} for combining`}
                      className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    />
                  )}
                  <div>
                    <div className="flex items-center space-x-3">
                      <h3 className="font-bold text-gray-900">{quote.quote_number}</h3>
                      {getStatusBadge(quote.status)}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{formatDate(quote.created_at)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-gray-900">{formatCurrency(quote.total_amount ?? quoteTotal)}</p>
                  <p className="text-xs text-gray-500">inc VAT · {items.length} item{items.length !== 1 ? 's' : ''}</p>
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
                            <span className="text-xs bg-gray-100 px-2 py-0.5 rounded ml-2">
                              {formatPrintAreas(item.print_areas)}
                            </span>
                          )}
                          {formatSizeBreakdown(item.size_breakdown) && (
                            <div className="text-xs text-gray-500 mt-1">
                              Sizes: {formatSizeBreakdown(item.size_breakdown)}
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <label className="text-sm text-gray-500">Qty:</label>
                            {(() => {
                              const pInfo = item.product_id ? lineInfo.products[item.product_id] : null;
                              const editable = quote.status === 'draft' && pInfo?.editable;
                              if (!editable) {
                                const href = item.product_id
                                  ? pInfo?.href
                                  : lineInfo.suppliers[item.supplier_product_id];
                                return (
                                  <>
                                    <span className="text-sm font-medium text-gray-900">
                                      {(item.quantity || 0).toLocaleString('en-GB')}
                                    </span>
                                    {quote.status === 'draft' && (href ? (
                                      <Link to={href} className="text-xs text-blue-600 hover:underline">
                                        Change quantity on the product page
                                      </Link>
                                    ) : (
                                      <span className="text-xs text-gray-500">Change quantity on the product page</span>
                                    ))}
                                  </>
                                );
                              }
                              return (
                                <input
                                  type="number"
                                  min={pInfo.moq || 1}
                                  defaultValue={item.quantity || ''}
                                  placeholder={pInfo.moq ? `Min. ${pInfo.moq.toLocaleString('en-GB')}` : 'Enter qty'}
                                  className="w-24 px-2 py-1 text-sm border border-gray-300 rounded"
                                  onBlur={async (e) => {
                                    const newQty = parseInt(e.target.value, 10);
                                    if (!newQty || newQty === item.quantity) return;

                                    if (pInfo.moq && newQty < pInfo.moq) {
                                      setQtyErrors(prev => ({
                                        ...prev,
                                        [item.id]: `Minimum order for this product is ${pInfo.moq.toLocaleString('en-GB')} units.`,
                                      }));
                                      e.target.value = item.quantity;
                                      return;
                                    }

                                    // Server re-checks ownership + MOQ and sets the tier price.
                                    const { error: qtyErr } = await supabase.rpc('set_quote_item_quantity', {
                                      p_item_id: item.id,
                                      p_quantity: newQty,
                                    });
                                    if (qtyErr) {
                                      setQtyErrors(prev => ({ ...prev, [item.id]: qtyErr.message }));
                                      e.target.value = item.quantity;
                                      return;
                                    }
                                    setQtyErrors(prev => {
                                      const next = { ...prev };
                                      delete next[item.id];
                                      return next;
                                    });
                                    fetchQuotes();
                                  }}
                                />
                              );
                            })()}
                            <span className="text-sm text-gray-500">
                              @ {formatCurrency(item.unit_price)} each
                            </span>
                          </div>
                          {qtyErrors[item.id] && (
                            <p className="text-xs text-red-600 mt-1" role="alert">{qtyErrors[item.id]}</p>
                          )}
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

              {/* Delivery details (PR B) — captured on the quote, snapshotted
                  to the order at Pay Now. Hidden once converted/paid. */}
              {quote.status !== 'converted' && (
                <div className="px-5 py-4 border-t border-gray-100">
                  <DeliveryAddressForm
                    entity={quote}
                    accountProfile={accountProfile}
                    showAccountToggle
                    onSave={(address, poNumber) => saveQuoteDelivery(quote.id, address, poNumber)}
                    onStatusChange={(s) => handleDeliveryStatus(quote.id, s)}
                  />
                </div>
              )}

              {/* VAT breakdown — stored values from recompute_quote_total.
                  Shown before Pay Now so the customer sees the split (UK B2B). */}
              {items.length > 0 && (
                <div className="px-5 py-4 border-t border-gray-100">
                  <div className="ml-auto w-full sm:w-64 space-y-1.5 text-sm">
                    <div className="flex justify-between text-gray-600">
                      <span>Subtotal (ex VAT)</span>
                      <span>{formatCurrency(quote.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-gray-600">
                      <span>VAT</span>
                      <span>{formatCurrency(quote.tax_amount)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-gray-900 pt-1.5 border-t border-gray-200">
                      <span>Total</span>
                      <span>{formatCurrency(quote.total_amount)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              {quote.status !== 'converted' && (
                <p className="px-5 pt-4 -mb-2 text-xs text-gray-500 text-right">
                  By paying you agree to our{' '}
                  <Link to="/terms" className="text-blue-700 underline hover:text-blue-900">Terms of Sale</Link>.
                </p>
              )}
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

      {/* Combine Confirmation Modal */}
      {combineConfirmOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              Combine {selectedQuoteIds.size} quotes into one?
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              All items will be merged into the earliest-created quote. The other
              {' '}{selectedQuoteIds.size - 1}{' '}draft quote{selectedQuoteIds.size - 1 !== 1 ? 's' : ''} will be deleted.
              This cannot be undone.
            </p>
            {combineError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded flex items-start space-x-2">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{combineError}</p>
              </div>
            )}
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => { setCombineConfirmOpen(false); setCombineError(null); }}
                disabled={combining}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCombineQuotes}
                disabled={combining}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center space-x-1"
              >
                {combining ? (
                  <>
                    <Loader className="h-4 w-4 animate-spin" />
                    <span>Combining...</span>
                  </>
                ) : (
                  <span>Confirm</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </CustomerLayout>
  );
};

export default CustomerQuotes;
