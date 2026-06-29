import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  // Date range filter — preset key + (when 'custom') a from/to pair.
  // Match the existing client-side filter pattern: branch in applyFilters.
  const [dateRange, setDateRange] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const ordersPerPage = 20;

  // Per-row selection for CSV export. Set<orderId> for O(1) toggle/has.
  // Persists across filter changes by design so admins can build a
  // multi-filter selection (e.g. select 2 from "pending", switch filter
  // to "approved", select 3 more, export all 5).
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Master checkbox in the table header. Tri-state DOM is set imperatively
  // because React only forwards `checked`, not `indeterminate`.
  const masterCheckboxRef = useRef(null);

  useEffect(() => {
    fetchOrders();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [orders, statusFilter, artworkFilter, searchQuery, dateRange, customFrom, customTo]);

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

  // Resolve the active date range to { start, end } JS Date objects (or
  // nulls). Both are inclusive. `start` is normalised to 00:00:00 local,
  // `end` to 23:59:59.999 local so a "Today" preset and a single-day
  // Custom range both cover the full UK working day. Returns
  // { start: null, end: null } when no filter is active.
  const resolveDateRange = () => {
    const startOfDay = (d) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x;
    };
    const endOfDay = (d) => {
      const x = new Date(d);
      x.setHours(23, 59, 59, 999);
      return x;
    };
    const now = new Date();
    switch (dateRange) {
      case 'today':
        return { start: startOfDay(now), end: endOfDay(now) };
      case 'last7': {
        const s = startOfDay(now);
        s.setDate(s.getDate() - 6); // inclusive of today
        return { start: s, end: endOfDay(now) };
      }
      case 'last30': {
        const s = startOfDay(now);
        s.setDate(s.getDate() - 29);
        return { start: s, end: endOfDay(now) };
      }
      case 'thisMonth':
        return {
          start: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)),
          end: endOfDay(now),
        };
      case 'thisYear':
        return {
          start: startOfDay(new Date(now.getFullYear(), 0, 1)),
          end: endOfDay(now),
        };
      case 'custom': {
        // <input type="date"> returns 'YYYY-MM-DD' in local time. Parse
        // explicitly to avoid the UTC-midnight trap (new Date('2026-06-01')
        // would land at the previous evening for negative timezones).
        const parseLocal = (s) => {
          if (!s) return null;
          const [y, m, d] = s.split('-').map(Number);
          if (!y || !m || !d) return null;
          return new Date(y, m - 1, d);
        };
        let start = parseLocal(customFrom);
        let end = parseLocal(customTo);
        // If only one bound provided, the other is open. If both provided
        // but from > to, swap them so the admin never sees a silent empty
        // result from a misordered range.
        if (start && end && start > end) {
          [start, end] = [end, start];
        }
        return {
          start: start ? startOfDay(start) : null,
          end: end ? endOfDay(end) : null,
        };
      }
      case 'all':
      default:
        return { start: null, end: null };
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

    // Date range filter
    const { start, end } = resolveDateRange();
    if (start || end) {
      filtered = filtered.filter((order) => {
        if (!order.created_at) return false;
        const t = new Date(order.created_at).getTime();
        if (start && t < start.getTime()) return false;
        if (end && t > end.getTime()) return false;
        return true;
      });
    }

    // Search filter — match against every field an admin might type:
    // order number (visible header), full id (URL slug), PO number,
    // Stripe payment_intent_id (reconciliation), tracking number, AND
    // every separate customer field (company, first, last, email).
    // Pre-§ the filter only matched order_number + a SINGLE priority-resolved
    // display string, so the visible email subline silently never matched
    // when the customer also had a company name. See audit §2 and §7.
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(order => buildSearchableText(order).includes(query));
    }

    setFilteredOrders(filtered);
    setCurrentPage(1);
  };

  // Build the lowercased "haystack" string for the search filter. Includes
  // every visible identifier plus admin-relevant lookup fields. New fields
  // can be added here without touching the filter loop.
  const buildSearchableText = (order) => {
    const p = order.customer_profiles || {};
    return [
      order.order_number,
      order.id,
      order.po_number,
      order.payment_intent_id,
      order.tracking_number,
      p.company_name,
      p.first_name,
      p.last_name,
      p.email,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
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

  // ---- Row selection + CSV export ----

  // Selection counted against the currently-filtered set only — orders
  // selected then filtered out by status/date stay in `selectedIds` but
  // don't count toward the "selected from view" totals. This keeps the
  // header checkbox honest (it reflects what is currently visible) while
  // preserving the multi-filter selection workflow.
  const selectionInFilteredCount = useMemo(
    () => filteredOrders.reduce((n, o) => (selectedIds.has(o.id) ? n + 1 : n), 0),
    [filteredOrders, selectedIds],
  );

  // Tri-state master checkbox driven by the *currently filtered* page-set.
  // "Visible" here means "passes the active filters", not "on this page" —
  // the master clears/sets all matching rows in one click, which is what
  // an admin wants when about to export the filtered view.
  useEffect(() => {
    if (!masterCheckboxRef.current) return;
    const n = selectionInFilteredCount;
    const total = filteredOrders.length;
    masterCheckboxRef.current.checked = total > 0 && n === total;
    masterCheckboxRef.current.indeterminate = n > 0 && n < total;
  }, [selectionInFilteredCount, filteredOrders.length]);

  const toggleRowSelection = (orderId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const toggleMasterSelection = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      // If every currently-filtered row is already selected -> clear all
      // matching IDs; otherwise -> add every matching ID.
      const allSelected =
        filteredOrders.length > 0 &&
        filteredOrders.every((o) => next.has(o.id));
      if (allSelected) {
        filteredOrders.forEach((o) => next.delete(o.id));
      } else {
        filteredOrders.forEach((o) => next.add(o.id));
      }
      return next;
    });
  };

  // Decide what export emits: selected when non-empty, else everything
  // matching current filters. Filters always apply (search + status +
  // artwork + date) so the export reflects what the admin sees.
  const exportButtonLabel =
    selectionInFilteredCount > 0
      ? `Export ${selectionInFilteredCount} selected`
      : 'Export';

  // Quote a CSV field per RFC 4180 — wrap in double quotes when the value
  // contains a comma, double-quote, CR, or LF; escape internal quotes by
  // doubling them. Empty / null / undefined become an empty field.
  const csvEscape = (value) => {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const buildCsv = (rows) => {
    const header = [
      'Order Number',
      'Customer Name',
      'Customer Email',
      'Customer Company',
      'Created Date',
      'Status',
      'Artwork Status',
      'Payment Status',
      'Total',
      'PO Number',
      'Stripe Payment Intent ID',
      'Tracking Number',
    ];
    const lines = [header.map(csvEscape).join(',')];
    for (const o of rows) {
      const p = o.customer_profiles || {};
      const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
      lines.push(
        [
          o.order_number,
          fullName,
          p.email,
          p.company_name,
          o.created_at, // ISO 8601 — spreadsheet imports parse this reliably
          o.status,
          o.artwork_status,
          o.payment_status,
          o.total_amount,
          o.po_number,
          o.payment_intent_id,
          o.tracking_number,
        ]
          .map(csvEscape)
          .join(','),
      );
    }
    // RFC 4180 line terminator. \r\n keeps Excel on Windows happy.
    return lines.join('\r\n') + '\r\n';
  };

  // pgifts-orders-YYYYMMDD-HHmmss.csv (UTC pad keeps filenames sortable).
  const exportFilename = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const hms = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `pgifts-orders-${ymd}-${hms}.csv`;
  };

  const handleExport = () => {
    const rowsToExport =
      selectionInFilteredCount > 0
        ? filteredOrders.filter((o) => selectedIds.has(o.id))
        : filteredOrders;

    if (rowsToExport.length === 0) return; // nothing to export

    // BOM so Excel detects UTF-8 (otherwise £ glyphs render mojibake).
    const csv = '﻿' + buildCsv(rowsToExport);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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
              placeholder="Search by order #, customer name, email, PO..."
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

            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              aria-label="Date range filter"
            >
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="last7">Last 7 days</option>
              <option value="last30">Last 30 days</option>
              <option value="thisMonth">This month</option>
              <option value="thisYear">This year</option>
              <option value="custom">Custom range…</option>
            </select>

            <button
              onClick={handleExport}
              disabled={filteredOrders.length === 0}
              title={
                selectionInFilteredCount > 0
                  ? `Export ${selectionInFilteredCount} selected order${selectionInFilteredCount === 1 ? '' : 's'} as CSV`
                  : `Export ${filteredOrders.length} filtered order${filteredOrders.length === 1 ? '' : 's'} as CSV`
              }
              className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="h-4 w-4" />
              <span>{exportButtonLabel}</span>
            </button>
          </div>
        </div>

        {/* Custom date range — revealed only when "Custom range…" is picked */}
        {dateRange === 'custom' && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="text-sm text-gray-700 flex items-center gap-2">
              From
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="Custom range from date"
                className="px-3 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
            </label>
            <label className="text-sm text-gray-700 flex items-center gap-2">
              To
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="Custom range to date"
                className="px-3 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
            </label>
            {(customFrom || customTo) && (
              <button
                onClick={() => { setCustomFrom(''); setCustomTo(''); }}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                Clear dates
              </button>
            )}
          </div>
        )}

        {/* Results count */}
        <p className="text-sm text-gray-600 mt-4">
          Showing {filteredOrders.length} {filteredOrders.length === 1 ? 'order' : 'orders'}
          {selectionInFilteredCount > 0 && (
            <span className="ml-2 text-blue-700 font-medium">
              ({selectionInFilteredCount} selected)
            </span>
          )}
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
                    <th className="px-4 py-4 w-10">
                      <input
                        ref={masterCheckboxRef}
                        type="checkbox"
                        onChange={toggleMasterSelection}
                        aria-label="Select all filtered orders"
                        className="h-4 w-4 cursor-pointer accent-blue-600"
                      />
                    </th>
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
                      className={`border-b border-gray-100 transition-colors ${
                        selectedIds.has(order.id) ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-4 py-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(order.id)}
                          onChange={() => toggleRowSelection(order.id)}
                          aria-label={`Select order ${order.order_number || order.id.slice(0, 8)}`}
                          className="h-4 w-4 cursor-pointer accent-blue-600"
                        />
                      </td>
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
