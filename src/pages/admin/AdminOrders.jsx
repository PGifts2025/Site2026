import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Search, Filter, Download, Loader, Eye } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout';
import { supabase } from '../../services/supabaseService';

const AdminOrders = ({ user, adminRole }) => {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [filteredOrders, setFilteredOrders] = useState([]);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [artworkFilter, setArtworkFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const ordersPerPage = 20;

  useEffect(() => {
    fetchOrders();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [orders, statusFilter, artworkFilter, searchQuery]);

  const fetchOrders = async () => {
    try {
      setLoading(true);

      // No direct FK from orders → customer_profiles (both reference
      // auth.users), so PostgREST can't auto-embed. Fetch orders and
      // customer_profiles separately and merge client-side so the existing
      // JSX can keep reading order.customer_profiles.*.
      const { data: ordersData, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const customerIds = [...new Set(
        (ordersData || []).map(o => o.customer_id).filter(Boolean)
      )];
      let profilesMap = {};
      if (customerIds.length) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('customer_profiles')
          .select('id, first_name, last_name, company_name, email')
          .in('id', customerIds);
        if (profilesError) throw profilesError;
        profilesMap = Object.fromEntries(
          (profilesData || []).map(p => [p.id, p])
        );
      }

      const withProfiles = (ordersData || []).map(o => ({
        ...o,
        customer_profiles: profilesMap[o.customer_id] || null,
      }));

      setOrders(withProfiles);
    } catch (error) {
      console.error('[AdminOrders] Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...orders];

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(order => order.status === statusFilter);
    }

    // Artwork-status filter
    if (artworkFilter !== 'all') {
      filtered = filtered.filter(order => order.artwork_status === artworkFilter);
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(order => {
        const orderNum = (order.order_number || '').toLowerCase();
        const customerName = getCustomerDisplayName(order.customer_profiles).toLowerCase();
        return orderNum.includes(query) || customerName.includes(query);
      });
    }

    setFilteredOrders(filtered);
    setCurrentPage(1);
  };

  // Chain: company_name → first+last → email → 'Unknown Customer'.
  // Guards against null profiles (FK → auth.users, not customer_profiles)
  // and against missing first/last that would render as "undefined undefined".
  const getCustomerDisplayName = (profile) => {
    if (!profile) return 'Unknown Customer';
    const company = (profile.company_name || '').trim();
    if (company) return company;
    const first = (profile.first_name || '').trim();
    const last = (profile.last_name || '').trim();
    const fullName = `${first} ${last}`.trim();
    if (fullName) return fullName;
    if (profile.email) return profile.email;
    return 'Unknown Customer';
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

  // Artwork status badge — distinct palette from order status so staff can
  // read both pipelines at a glance.
  const getArtworkStatusBadge = (artworkStatus) => {
    const config = {
      pending_artwork:  { cls: 'bg-orange-100 text-orange-800',   label: 'Awaiting Artwork' },
      artwork_uploaded: { cls: 'bg-blue-100 text-blue-800',       label: 'Artwork Uploaded' },
      in_review:        { cls: 'bg-yellow-100 text-yellow-800',   label: 'In Review' },
      proof_sent:       { cls: 'bg-purple-100 text-purple-800',   label: 'Proof Sent' },
      approved:         { cls: 'bg-green-100 text-green-800',     label: 'Approved' },
      in_production:    { cls: 'bg-emerald-700 text-white',       label: 'In Production' },
    };
    return config[artworkStatus] || null;
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

  // Pagination
  const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);
  const startIndex = (currentPage - 1) * ordersPerPage;
  const paginatedOrders = filteredOrders.slice(startIndex, startIndex + ordersPerPage);

  return (
    <AdminLayout user={user} adminRole={adminRole} pageTitle="Orders">
      {/* Header Actions */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by order # or customer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Filters */}
          <div className="flex items-center space-x-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="approved">Approved</option>
              <option value="in_production">In Production</option>
              <option value="shipped">Shipped</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <select
              value={artworkFilter}
              onChange={(e) => setArtworkFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              aria-label="Artwork status filter"
            >
              <option value="all">All Artwork</option>
              <option value="pending_artwork">Awaiting Artwork</option>
              <option value="artwork_uploaded">Artwork Uploaded</option>
              <option value="in_review">In Review</option>
              <option value="proof_sent">Proof Sent</option>
              <option value="approved">Approved</option>
              <option value="in_production">In Production</option>
            </select>

            <button className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
              <Download className="h-4 w-4" />
              <span>Export</span>
            </button>
          </div>
        </div>

        {/* Results count */}
        <p className="text-sm text-gray-600 mt-4">
          Showing {filteredOrders.length} {filteredOrders.length === 1 ? 'order' : 'orders'}
        </p>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="h-8 w-8 text-blue-600 animate-spin" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No orders found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-gray-600 border-b border-gray-200 bg-gray-50">
                    <th className="px-6 py-4 font-semibold">Order #</th>
                    <th className="px-6 py-4 font-semibold">Customer</th>
                    <th className="px-6 py-4 font-semibold">Date</th>
                    <th className="px-6 py-4 font-semibold">Status</th>
                    <th className="px-6 py-4 font-semibold">Artwork</th>
                    <th className="px-6 py-4 font-semibold">Payment</th>
                    <th className="px-6 py-4 font-semibold text-right">Total</th>
                    <th className="px-6 py-4 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedOrders.map((order) => (
                    <tr
                      key={order.id}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        #{order.order_number || order.id.slice(0, 8)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {(() => {
                          const profile = order.customer_profiles;
                          const name = getCustomerDisplayName(profile);
                          // Only show the email sub-line when it's not already
                          // the primary name (avoids duplicating when email is
                          // the only identifier we have).
                          const showEmail = profile?.email && profile.email !== name;
                          return (
                            <div>
                              <p className="font-medium text-gray-900">{name}</p>
                              {showEmail && (
                                <p className="text-xs text-gray-500">{profile.email}</p>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {formatDate(order.created_at)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full ${getStatusBadgeClass(
                            order.status
                          )}`}
                        >
                          {order.status?.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {(() => {
                          const ab = getArtworkStatusBadge(order.artwork_status);
                          return ab ? (
                            <span className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full ${ab.cls}`}>
                              {ab.label}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded">
                          {order.payment_status || 'Pending'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-gray-900 text-right">
                        {formatCurrency(order.total_amount)}
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          to={`/admin/orders/${order.id}`}
                          className="inline-flex items-center space-x-1 text-blue-600 hover:text-blue-700 font-semibold text-sm"
                        >
                          <Eye className="h-4 w-4" />
                          <span>View</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Page {currentPage} of {totalPages}
                </p>
                <div className="flex space-x-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
};

export default AdminOrders;
