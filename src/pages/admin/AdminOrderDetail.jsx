import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Loader, Package, User, MapPin, CreditCard, Image as ImageIcon, Download, FileImage, StickyNote } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout';
import { supabase, getArtworkSignedUrl, downloadArtworkFile } from '../../services/supabaseService';

// Artwork helpers (mirrors AdminOrders.jsx — kept local to avoid a shared
// module we don't have a home for yet).
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'image/tiff']);

const getFileTypeBadge = (mime) => {
  if (mime === 'application/pdf') return { label: 'PDF', cls: 'bg-red-100 text-red-700' };
  if (mime === 'application/postscript' || mime === 'image/x-eps') return { label: 'EPS', cls: 'bg-purple-100 text-purple-700' };
  if (mime === 'application/illustrator') return { label: 'AI', cls: 'bg-orange-100 text-orange-700' };
  return null;
};

const ARTWORK_STATUS_LABELS = {
  pending_artwork:  'Awaiting Artwork',
  artwork_uploaded: 'Artwork Uploaded',
  in_review:        'In Review',
  proof_sent:       'Proof Sent',
  approved:         'Approved',
  in_production:    'In Production',
};

const ARTWORK_STATUS_CLASSES = {
  pending_artwork:  'bg-orange-100 text-orange-800',
  artwork_uploaded: 'bg-blue-100 text-blue-800',
  in_review:        'bg-yellow-100 text-yellow-800',
  proof_sent:       'bg-purple-100 text-purple-800',
  approved:         'bg-green-100 text-green-800',
  in_production:    'bg-emerald-700 text-white',
};

// Forward-only progression. Empty array = terminal state.
const FORWARD_ARTWORK_STATUSES = {
  pending_artwork:  ['artwork_uploaded', 'in_review', 'proof_sent', 'approved', 'in_production'],
  artwork_uploaded: ['in_review', 'proof_sent', 'approved', 'in_production'],
  in_review:        ['proof_sent', 'approved', 'in_production'],
  proof_sent:       ['approved', 'in_production'],
  approved:         ['in_production'],
  in_production:    [],
};

const formatFileSize = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

const AdminOrderDetail = ({ user, adminRole }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  // Artwork panel state
  const [artwork, setArtwork] = useState([]);
  const [thumbnails, setThumbnails] = useState({});
  const [pendingStatus, setPendingStatus] = useState('');
  const [advancingStatus, setAdvancingStatus] = useState(false);
  const [showStatusConfirm, setShowStatusConfirm] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    fetchOrderDetail();
  }, [id]);

  // Fetch thumbnails once the artwork list loads — non-blocking.
  useEffect(() => {
    if (!artwork.length) return;
    let cancelled = false;
    artwork
      .filter(a => IMAGE_MIME_TYPES.has(a.file_type))
      .forEach(async (a) => {
        const { data, error } = await getArtworkSignedUrl(a.file_url, 3600);
        if (cancelled || error || !data?.signedUrl) return;
        setThumbnails(prev => ({ ...prev, [a.id]: data.signedUrl }));
      });
    return () => { cancelled = true; };
  }, [artwork]);

  const fetchOrderDetail = async () => {
    try {
      setLoading(true);

      // Fetch order. No direct FK from orders → customer_profiles (both
      // reference auth.users), so PostgREST can't auto-embed. Fetch the
      // customer profile separately and attach it for the JSX.
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', id)
        .single();

      if (orderError) throw orderError;

      let customerProfile = null;
      if (orderData?.customer_id) {
        const { data: profileData } = await supabase
          .from('customer_profiles')
          .select('*')
          .eq('id', orderData.customer_id)
          .maybeSingle();
        customerProfile = profileData || null;
      }

      const orderWithProfile = { ...orderData, customer_profiles: customerProfile };
      setOrder(orderWithProfile);
      setAdminNotes(orderData.admin_notes || '');

      // Fetch order items
      const { data: itemsData, error: itemsError } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', id);

      if (itemsError) throw itemsError;
      setOrderItems(itemsData || []);

      // Fetch uploaded artwork
      const { data: artworkData, error: artworkError } = await supabase
        .from('order_artwork')
        .select('*')
        .eq('order_id', id)
        .order('uploaded_at', { ascending: false });

      if (artworkError) throw artworkError;
      setArtwork(artworkData || []);

    } catch (error) {
      console.error('[AdminOrderDetail] Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAdvanceStatus = async () => {
    if (!pendingStatus) return;
    setAdvancingStatus(true);
    // Capture prior status for first-transition email detection below.
    const priorStatus = order?.artwork_status;
    try {
      const { error: statusError } = await supabase
        .from('orders')
        .update({ artwork_status: pendingStatus })
        .eq('id', id);
      if (statusError) throw statusError;

      // When entering in_review or beyond, mark unreviewed artwork files
      // as reviewed so the timestamp reflects when the workflow advanced.
      const REVIEWED_STATUSES = new Set(['in_review', 'proof_sent', 'approved', 'in_production']);
      if (REVIEWED_STATUSES.has(pendingStatus)) {
        await supabase
          .from('order_artwork')
          .update({ reviewed_at: new Date().toISOString() })
          .eq('order_id', id)
          .is('reviewed_at', null);
      }

      // Fire-and-forget: artwork-received email on first transition from
      // pending_artwork → artwork_uploaded. No await, no blocking. Any
      // failure is logged and swallowed — the status change must succeed
      // from the admin's POV regardless of email.
      if (priorStatus === 'pending_artwork' && pendingStatus === 'artwork_uploaded') {
        try {
          fetch(`${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/send-artwork-received-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({ order_id: id }),
          }).catch(err => console.error('[artwork-email] Fire failed:', err));
        } catch (err) {
          console.error('[artwork-email] Setup failed:', err);
        }
      }

      setShowStatusConfirm(false);
      setPendingStatus('');
      await fetchOrderDetail();
    } catch (err) {
      console.error('[AdminOrderDetail] advance status error:', err);
      alert(`Could not update status: ${err.message || err}`);
    } finally {
      setAdvancingStatus(false);
    }
  };

  const handleSaveAdminNotes = async () => {
    setSavingNotes(true);
    setNotesSaved(false);
    try {
      const { error } = await supabase
        .from('orders')
        .update({ admin_notes: adminNotes || null })
        .eq('id', id);
      if (error) throw error;
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch (err) {
      console.error('[AdminOrderDetail] save admin notes error:', err);
      alert(`Could not save notes: ${err.message || err}`);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleDownload = async (artworkRow) => {
    setDownloadingId(artworkRow.id);
    const { error } = await downloadArtworkFile(artworkRow.file_url, artworkRow.file_name);
    setDownloadingId(null);
    if (error) alert(`Could not download file: ${error.message || error}`);
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

      {/* Artwork panel — staff-only: uploaded files, status advance, admin notes */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mt-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-gray-900 flex items-center space-x-2">
            <ImageIcon className="h-5 w-5" />
            <span>Artwork</span>
          </h2>
          {order.artwork_status && (
            <span className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full ${ARTWORK_STATUS_CLASSES[order.artwork_status] || 'bg-gray-100 text-gray-700'}`}>
              {ARTWORK_STATUS_LABELS[order.artwork_status] || order.artwork_status}
            </span>
          )}
        </div>

        {/* Status advancement */}
        {(() => {
          const nextOptions = FORWARD_ARTWORK_STATUSES[order.artwork_status] || [];
          if (nextOptions.length === 0) {
            return (
              <div className="mb-6 p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
                This order is in the final artwork stage. No further advancement available.
              </div>
            );
          }
          return (
            <div className="mb-6 p-4 border border-gray-200 rounded-lg">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Advance artwork status</h3>
              {showStatusConfirm ? (
                <div className="flex items-center flex-wrap gap-3">
                  <span className="text-sm text-gray-700">
                    Move order to <span className="font-semibold">{ARTWORK_STATUS_LABELS[pendingStatus]}</span>?
                  </span>
                  <button
                    type="button"
                    onClick={handleAdvanceStatus}
                    disabled={advancingStatus}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center space-x-1"
                  >
                    {advancingStatus ? <Loader className="h-4 w-4 animate-spin" /> : <span>Yes</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowStatusConfirm(false); setPendingStatus(''); }}
                    disabled={advancingStatus}
                    className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-100 disabled:opacity-50"
                  >
                    No
                  </button>
                </div>
              ) : (
                <div className="flex items-center flex-wrap gap-3">
                  <select
                    value={pendingStatus}
                    onChange={(e) => setPendingStatus(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select next status…</option>
                    {nextOptions.map(s => (
                      <option key={s} value={s}>{ARTWORK_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowStatusConfirm(true)}
                    disabled={!pendingStatus}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                  >
                    Advance
                  </button>
                </div>
              )}
            </div>
          );
        })()}

        {/* Uploaded files */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Uploaded files {artwork.length > 0 && <span className="text-gray-500 font-normal">({artwork.length})</span>}
          </h3>
          {artwork.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-500 border border-gray-200 rounded-xl bg-gray-50">
              No artwork uploaded yet.
            </div>
          ) : (
            <div className="space-y-3">
              {artwork.map(a => {
                const thumbUrl = thumbnails[a.id];
                const badge = getFileTypeBadge(a.file_type);
                const differentUploader = a.user_id && order.customer_profiles?.id && a.user_id !== order.customer_profiles.id;
                return (
                  <div key={a.id} className="flex items-center gap-4 p-4 border border-gray-200 rounded-xl">
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={a.file_name}
                        className="flex-shrink-0 w-20 h-20 rounded-md object-contain bg-gray-50 border border-gray-200"
                        onError={() => setThumbnails(prev => { const n = { ...prev }; delete n[a.id]; return n; })}
                      />
                    ) : badge ? (
                      <div className={`flex-shrink-0 w-20 h-20 rounded-md flex items-center justify-center font-bold text-base ${badge.cls}`}>
                        {badge.label}
                      </div>
                    ) : (
                      <div className="flex-shrink-0 w-20 h-20 bg-gray-100 rounded-md flex items-center justify-center">
                        <FileImage className="h-7 w-7 text-gray-400" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{a.file_name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-gray-500">{formatFileSize(a.file_size)}</span>
                        <span className="text-xs text-gray-400">•</span>
                        <span className="text-xs text-gray-500">{formatDate(a.uploaded_at)}</span>
                        {a.reviewed_at && (
                          <>
                            <span className="text-xs text-gray-400">•</span>
                            <span className="text-xs text-gray-500">Reviewed {formatDate(a.reviewed_at)}</span>
                          </>
                        )}
                      </div>
                      {a.notes && (
                        <p className="text-xs text-gray-500 mt-1 italic">{a.notes}</p>
                      )}
                      {differentUploader && (
                        <p className="text-xs text-gray-500 mt-1">Uploaded by user {a.user_id.slice(0, 8)}…</p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDownload(a)}
                      disabled={downloadingId === a.id}
                      className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                    >
                      {downloadingId === a.id ? (
                        <Loader className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      <span>Download</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Admin notes */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center space-x-2">
            <StickyNote className="h-4 w-4" />
            <span>Internal notes</span>
          </h3>
          <textarea
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            placeholder="Notes visible to staff only — proof revisions, colour approvals, anything the production team needs to know."
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveAdminNotes}
              disabled={savingNotes}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center space-x-1"
            >
              {savingNotes ? <Loader className="h-4 w-4 animate-spin" /> : <span>Save notes</span>}
            </button>
            {notesSaved && (
              <span className="text-sm text-green-600 font-medium">Saved</span>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
};

export default AdminOrderDetail;
