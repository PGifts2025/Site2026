import React, { useState, useEffect, useMemo } from 'react';
import { Search, Loader } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import { supabase } from '../services/supabaseService';
import { invalidateProductCache } from '../services/productCatalogService';
import { findTierAtQty } from '../lib/pricingTiers';

/**
 * AdminPricing — Laltex per-product margin_pct_override editor (super_admin).
 *
 * Reads supplier_products (Laltex only) client-side, displays raw + computed
 * sell price at a representative quantity, and lets a super_admin set a flat
 * per-product margin override. Writes go through /api/admin/recompute-margin
 * (service role) because supplier_products writes are RLS-locked to the
 * service role — the browser client can read but not write this table.
 *
 * Conventions mirror AdminOrders (client search/filter/paginate) and
 * AdminOrderDetail (inline edit, hard re-fetch, alert() on error). Phase 2
 * of the admin margin editor.
 */

const PAGE_SIZE = 500;   // PostgREST page size for the load loop
const MAX_PAGES = 10;    // defensive cap (>> 1192 / 500)
const PER_PAGE = 20;     // table pagination, matches AdminOrders

const REP_QTY = 100;     // representative tier shown in the table
const PREVIEW_QTYS = [100, 250];

const gbpFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatGBP = (v) =>
  v == null || !Number.isFinite(Number(v)) ? '—' : gbpFormatter.format(Number(v));

// images / plain_images are jsonb arrays of URL strings (defensive against
// an object shape just in case).
const firstImage = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const first = arr[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object') return first.url || first.image_url || null;
  return null;
};
const thumbUrl = (p) => firstImage(p.plain_images) || firstImage(p.images) || null;

const truncate = (s, n) => {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

const AdminPricing = ({ user, adminRole }) => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [products, setProducts] = useState([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [overriddenOnly, setOverriddenOnly] = useState(false);
  const [includeRetired, setIncludeRetired] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Inline editor (one row open at a time)
  const [expandedCode, setExpandedCode] = useState(null);
  const [marginInput, setMarginInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(null); // code that just saved

  useEffect(() => {
    loadProducts();
  }, []);

  // Reset to page 1 whenever a filter changes (mirrors AdminOrders).
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, categoryFilter, overriddenOnly, includeRetired]);

  const loadProducts = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Scope: Laltex only. PGifts Direct's 25 mirror rows are excluded.
      const { data: supplierRow, error: supErr } = await supabase
        .from('suppliers')
        .select('id')
        .eq('slug', 'laltex')
        .single();
      if (supErr) throw supErr;
      const laltexId = supplierRow?.id;
      if (!laltexId) throw new Error('Laltex supplier row not found');

      // Defeat the PostgREST 1,000-row default cap with an explicit paged loop.
      const all = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await supabase
          .from('supplier_products')
          .select(
            'supplier_product_code,name,category,sub_category,minimum_order_qty,margin_pct_override,is_retired,product_pricing,plain_images,images',
          )
          .eq('supplier_id', laltexId)
          .order('supplier_product_code', { ascending: true })
          .range(from, to);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE_SIZE) break;
      }
      setProducts(all);
    } catch (err) {
      console.error('[AdminPricing] load error:', err);
      setLoadError(err.message || 'Failed to load products');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const categories = useMemo(() => {
    const set = new Set();
    for (const p of products) if (p.category) set.add(p.category);
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    let list = products;
    if (!includeRetired) list = list.filter((p) => !p.is_retired);
    if (overriddenOnly) list = list.filter((p) => p.margin_pct_override != null);
    if (categoryFilter !== 'all') list = list.filter((p) => p.category === categoryFilter);
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          (p.supplier_product_code || '').toLowerCase().includes(q) ||
          (p.name || '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [products, includeRetired, overriddenOnly, categoryFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageClamped = Math.min(currentPage, totalPages);
  const startIndex = (pageClamped - 1) * PER_PAGE;
  const paginated = filtered.slice(startIndex, startIndex + PER_PAGE);

  // ----- Editor -----
  const openEditor = (p) => {
    setExpandedCode(p.supplier_product_code);
    setMarginInput(
      p.margin_pct_override != null ? String(Math.round(Number(p.margin_pct_override) * 100)) : '',
    );
    setInputError('');
  };

  const closeEditor = () => {
    setExpandedCode(null);
    setMarginInput('');
    setInputError('');
  };

  const postRecompute = async (productCode, newPct) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('Your session expired — please sign in again.');

    const resp = await fetch('/api/admin/recompute-margin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ product_code: productCode, new_pct: newPct }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error || `Request failed (${resp.status})`);
    return json;
  };

  const finishSave = (code) => {
    // Clear the customer-facing product cache so the new margin shows up
    // immediately on the next category/product page view instead of after
    // the 5-min TTL. (AdminPricing's own list reads supplier_products
    // directly, so this is for the public pages, not this table.)
    invalidateProductCache(code);
    setSavedFlash(code);
    setTimeout(() => setSavedFlash(null), 2000);
    closeEditor();
    loadProducts(); // hard re-fetch, matches AdminOrderDetail
  };

  const handleSave = async (p) => {
    const trimmed = marginInput.trim();
    if (trimmed === '') {
      setInputError('Enter a whole number 0–99, or use Reset to default.');
      return;
    }
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0 || n >= 100) {
      setInputError('Margin must be a whole number between 0 and 99.');
      return;
    }
    setInputError('');
    setSaving(true);
    try {
      await postRecompute(p.supplier_product_code, n / 100);
      finishSave(p.supplier_product_code);
    } catch (err) {
      alert(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (p) => {
    setSaving(true);
    try {
      await postRecompute(p.supplier_product_code, null);
      finishSave(p.supplier_product_code);
    } catch (err) {
      alert(err.message || 'Failed to reset');
    } finally {
      setSaving(false);
    }
  };

  // Live preview for the open editor.
  const previewFor = (p) => {
    const trimmed = marginInput.trim();
    const n = Number(trimmed);
    const valid = trimmed !== '' && Number.isInteger(n) && n >= 0 && n < 100;
    return PREVIEW_QTYS.map((qty) => {
      const tier = findTierAtQty(p.product_pricing, qty);
      if (!valid || !tier || tier.is_poa || tier.price == null) {
        return { qty, value: null };
      }
      return { qty, value: tier.price * (1 + n / 100) };
    });
  };

  const renderMarginCell = (p) => {
    if (p.margin_pct_override == null) {
      return <span className="text-gray-400 italic">Default (schedule)</span>;
    }
    const pct = +(Number(p.margin_pct_override) * 100).toFixed(2);
    return (
      <span className="inline-flex px-2 py-0.5 text-xs font-semibold rounded bg-blue-50 text-blue-700">
        {pct}% override
      </span>
    );
  };

  return (
    <AdminLayout user={user} adminRole={adminRole} pageTitle="Pricing — Laltex Margin Overrides">
      {/* Header / filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by code or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Filters */}
          <div className="flex items-center flex-wrap gap-3">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              aria-label="Category filter"
            >
              <option value="all">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={overriddenOnly}
                onChange={(e) => setOverriddenOnly(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Overridden only
            </label>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={includeRetired}
                onChange={(e) => setIncludeRetired(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Include retired
            </label>
          </div>
        </div>

        <p className="text-sm text-gray-600 mt-4">
          Showing {filtered.length} {filtered.length === 1 ? 'product' : 'products'}
          {!loading && products.length > 0 && (
            <span className="text-gray-400"> of {products.length} Laltex products</span>
          )}
        </p>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="h-8 w-8 text-blue-600 animate-spin" />
          </div>
        ) : loadError ? (
          <div className="text-center py-12">
            <p className="text-red-600 font-medium">Could not load products</p>
            <p className="text-sm text-gray-500 mt-1">{loadError}</p>
            <button
              onClick={loadProducts}
              className="mt-4 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No products match the current filters</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-gray-600 border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-4 font-semibold" />
                    <th className="px-4 py-4 font-semibold">Code</th>
                    <th className="px-4 py-4 font-semibold">Name</th>
                    <th className="px-4 py-4 font-semibold">Category</th>
                    <th className="px-4 py-4 font-semibold text-right">MOQ</th>
                    <th className="px-4 py-4 font-semibold text-right">Raw @ {REP_QTY}</th>
                    <th className="px-4 py-4 font-semibold">Current margin</th>
                    <th className="px-4 py-4 font-semibold text-right">Sell @ {REP_QTY}</th>
                    <th className="px-4 py-4 font-semibold">Status</th>
                    <th className="px-4 py-4 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((p) => {
                    const tier = findTierAtQty(p.product_pricing, REP_QTY);
                    const isPoa = !!tier?.is_poa;
                    const rawVal = tier && !isPoa ? tier.price : null;
                    const sellVal = tier && !isPoa ? tier.sell_price ?? tier.price : null;
                    const isOpen = expandedCode === p.supplier_product_code;
                    const thumb = thumbUrl(p);

                    return (
                      <React.Fragment key={p.supplier_product_code}>
                        <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            {thumb ? (
                              <img
                                src={thumb}
                                alt=""
                                loading="lazy"
                                className="w-10 h-10 rounded object-contain bg-gray-50 border border-gray-200"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded bg-gray-100 border border-gray-200" />
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm font-mono text-gray-900">
                            {p.supplier_product_code}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">{truncate(p.name, 40)}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {p.category || '—'}
                            {p.sub_category && (
                              <span className="text-gray-400"> / {p.sub_category}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 text-right">
                            {p.minimum_order_qty ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 text-right">
                            {isPoa ? 'POA' : formatGBP(rawVal)}
                          </td>
                          <td className="px-4 py-3 text-sm">{renderMarginCell(p)}</td>
                          <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">
                            {isPoa ? 'POA' : formatGBP(sellVal)}
                          </td>
                          <td className="px-4 py-3">
                            {p.is_retired ? (
                              <span className="inline-flex px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-700">
                                Retired
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {savedFlash === p.supplier_product_code && (
                                <span className="text-xs text-green-600 font-medium">Saved ✓</span>
                              )}
                              <button
                                onClick={() => (isOpen ? closeEditor() : openEditor(p))}
                                className="text-blue-600 hover:text-blue-700 font-semibold text-sm"
                              >
                                {isOpen ? 'Close' : 'Edit'}
                              </button>
                            </div>
                          </td>
                        </tr>

                        {isOpen && (
                          <tr className="bg-blue-50/40 border-b border-gray-200">
                            <td colSpan={10} className="px-6 py-5">
                              <h3 className="text-sm font-bold text-gray-900 mb-3">
                                Edit margin for {p.supplier_product_code} — {truncate(p.name, 60)}
                              </h3>

                              <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                                {/* Input */}
                                <div className="w-full lg:w-64">
                                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                                    Margin override
                                  </label>
                                  <div className="relative">
                                    <input
                                      type="number"
                                      min="0"
                                      max="99"
                                      step="1"
                                      value={marginInput}
                                      onChange={(e) => {
                                        setMarginInput(e.target.value);
                                        if (inputError) setInputError('');
                                      }}
                                      placeholder="e.g. 25"
                                      className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                                      %
                                    </span>
                                  </div>
                                  {inputError && (
                                    <p className="text-xs text-red-600 mt-1">{inputError}</p>
                                  )}
                                  <p className="text-xs text-gray-500 mt-2">
                                    Leave applied as a flat % across all quantities for this product.
                                    Print and delivery share adjust automatically after save.
                                  </p>
                                </div>

                                {/* Preview */}
                                <div className="flex-1">
                                  <p className="text-xs font-semibold text-gray-600 mb-2">
                                    Preview (product price per unit)
                                  </p>
                                  <div className="flex flex-wrap gap-6">
                                    {previewFor(p).map(({ qty, value }) => (
                                      <div key={qty}>
                                        <p className="text-xs text-gray-500">at qty {qty}</p>
                                        <p className="text-lg font-bold text-gray-900">
                                          {formatGBP(value)}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                {/* Actions */}
                                <div className="flex flex-col gap-2 lg:w-44">
                                  <button
                                    onClick={() => handleSave(p)}
                                    disabled={saving}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                                  >
                                    {saving ? <Loader className="h-4 w-4 animate-spin" /> : 'Save'}
                                  </button>
                                  <button
                                    onClick={() => handleReset(p)}
                                    disabled={saving}
                                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-100 disabled:opacity-50"
                                  >
                                    Reset to default
                                  </button>
                                  <button
                                    onClick={closeEditor}
                                    disabled={saving}
                                    className="px-4 py-2 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-100 disabled:opacity-50"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Page {pageClamped} of {totalPages}
                </p>
                <div className="flex space-x-2">
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={pageClamped === 1}
                    className="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={pageClamped === totalPages}
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

export default AdminPricing;
