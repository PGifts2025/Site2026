import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Palette, Edit2, Copy, Trash2, FileText, Loader } from 'lucide-react';
import CustomerLayout from '../../components/customer/CustomerLayout';
import { supabase, deleteUserDesign } from '../../services/supabaseService';
import { createQuoteFromDesign } from '../../services/quoteService';
import {
  getCatalogProductBySlug,
  getSupplierProductByCode,
  normaliseProduct,
} from '../../services/productCatalogService';
import { prettyPrintArea } from '../../utils/printAreaFormat';

// v1 (catalog) designs have product_key populated; v2 (Laltex /
// supplier) designs have supplier_product_code populated. Never both,
// by convention — see CLAUDE.md §41.
const isLaltexDesign = (design) => !!design?.supplier_product_code;

const formatSlugAsName = (slug) =>
  (slug || '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const CustomerDesigns = ({ user }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [designs, setDesigns] = useState([]);
  const [productCache, setProductCache] = useState({});
  const [editingNameId, setEditingNameId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    fetchDesigns();
  }, [user]);

  // Resolve product info for the designs that just loaded. v1 designs
  // look up via catalog slug; v2 via supplier code. Lookups run in
  // parallel; one entry per unique key. The cache is additive across
  // refreshes so duplicating a design doesn't refetch products.
  useEffect(() => {
    if (designs.length === 0) return;
    let cancelled = false;
    (async () => {
      const v1Slugs = new Set();
      const v2Codes = new Set();
      for (const d of designs) {
        if (isLaltexDesign(d)) {
          if (!productCache[`v2:${d.supplier_product_code}`]) {
            v2Codes.add(d.supplier_product_code);
          }
        } else if (d.product_key) {
          if (!productCache[`v1:${d.product_key}`]) {
            v1Slugs.add(d.product_key);
          }
        }
      }
      if (v1Slugs.size === 0 && v2Codes.size === 0) return;

      const v1Entries = await Promise.all(
        [...v1Slugs].map(async (slug) => {
          try {
            const product = await getCatalogProductBySlug(slug);
            return [`v1:${slug}`, product || null];
          } catch (err) {
            console.warn('[CustomerDesigns] catalog lookup failed:', slug, err);
            return [`v1:${slug}`, null];
          }
        }),
      );
      const v2Entries = await Promise.all(
        [...v2Codes].map(async (code) => {
          try {
            const row = await getSupplierProductByCode(code);
            if (!row) return [`v2:${code}`, null];
            const supplierSlug = row.supplier?.slug || 'laltex';
            return [`v2:${code}`, normaliseProduct(row, supplierSlug)];
          } catch (err) {
            console.warn('[CustomerDesigns] supplier lookup failed:', code, err);
            return [`v2:${code}`, null];
          }
        }),
      );

      if (cancelled) return;
      setProductCache((prev) => ({
        ...prev,
        ...Object.fromEntries([...v1Entries, ...v2Entries]),
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [designs]);

  const fetchDesigns = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('user_designs')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      setDesigns(data || []);
    } catch (error) {
      console.error('[CustomerDesigns] Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const resolveProductLabel = (design) => {
    if (isLaltexDesign(design)) {
      const product = productCache[`v2:${design.supplier_product_code}`];
      return product?.name || design.supplier_product_code;
    }
    const product = productCache[`v1:${design.product_key}`];
    return product?.name || formatSlugAsName(design.product_key) || 'Untitled Product';
  };

  // For v2 designs only: find the matching colour entry on the
  // normalised Laltex product so we can render a real image thumbnail
  // (color_code is a supplier code like "MG0192AM", NOT a hex value).
  const resolveLaltexColourImage = (design) => {
    if (!isLaltexDesign(design) || !design.color_code) return null;
    const product = productCache[`v2:${design.supplier_product_code}`];
    const match = product?.colours?.find((c) => c.code === design.color_code);
    return match?.images?.[0] || null;
  };

  const editUrlFor = (design) =>
    isLaltexDesign(design)
      ? `/design/${encodeURIComponent(design.supplier_product_code)}?design=${design.id}`
      : `/designer?design=${design.id}`;

  const handleEditName = (design) => {
    setEditingNameId(design.id);
    setEditingName(design.design_name);
  };

  const handleSaveName = async (designId) => {
    if (!editingName.trim()) {
      alert('Design name cannot be empty');
      return;
    }

    try {
      setSavingName(true);

      const { error } = await supabase
        .from('user_designs')
        .update({ design_name: editingName.trim() })
        .eq('id', designId);

      if (error) throw error;

      setDesigns(
        designs.map((d) =>
          d.id === designId ? { ...d, design_name: editingName.trim() } : d,
        ),
      );

      setEditingNameId(null);
      setEditingName('');
    } catch (error) {
      console.error('[CustomerDesigns] Error updating name:', error);
      alert('Failed to update design name. Please try again.');
    } finally {
      setSavingName(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingNameId(null);
    setEditingName('');
  };

  // Builds a new user_designs row from the source. Critical: only emit
  // columns that actually exist on the table (CLAUDE.md §40) and
  // preserve whichever of product_key / supplier_product_code is set
  // so the duplicate stays the same flavour (v1 or v2).
  const handleDuplicate = async (design) => {
    try {
      const insert = {
        user_id: user.id,
        design_name: `${design.design_name || 'Untitled'} (Copy)`,
        design_data: design.design_data,
        thumbnail_url: design.thumbnail_url,
        color_code: design.color_code,
        color_name: design.color_name,
        print_area: design.print_area,
      };
      if (isLaltexDesign(design)) {
        insert.supplier_product_code = design.supplier_product_code;
      } else {
        insert.product_id = design.product_id || null;
        insert.product_key = design.product_key || null;
      }
      const { error } = await supabase.from('user_designs').insert(insert);
      if (error) throw error;
      fetchDesigns();
    } catch (error) {
      console.error('[CustomerDesigns] Error duplicating:', error);
      alert('Failed to duplicate design. Please try again.');
    }
  };

  const handleDelete = async (designId, designName) => {
    if (!confirm(`Are you sure you want to delete "${designName}"? This cannot be undone.`)) {
      return;
    }

    try {
      await deleteUserDesign(designId);
      setDesigns(designs.filter((d) => d.id !== designId));
    } catch (error) {
      console.error('[CustomerDesigns] Error deleting:', error);
      alert('Failed to delete design. Please try again.');
    }
  };

  // v1 designs: existing quote flow (clothing redirect or quotes-table
  // insert via createQuoteFromDesign). v2 / Laltex designs: route the
  // customer to the LaltexProductView for that supplier code, where
  // the existing Add-to-Quote button handles quantity + position config.
  // A future session may pre-load the saved design into that view; for
  // now the design stays in My Designs and the customer configures qty
  // on the product page.
  const handleAddToQuote = async (design) => {
    if (isLaltexDesign(design)) {
      navigate(`/products/${encodeURIComponent(design.supplier_product_code)}`);
      return;
    }
    const result = await createQuoteFromDesign({ design, user });
    if (result.error) {
      alert(result.error);
      return;
    }
    navigate(result.redirect, { state: { flash: 'Quote created — ready to pay' } });
  };

  return (
    <CustomerLayout user={user} pageTitle="My Designs">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Designs</h1>
          <p className="text-gray-600 mt-1">Manage your saved designs</p>
        </div>
        <Link
          to="/designer"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold flex items-center space-x-2"
        >
          <Palette className="h-5 w-5" />
          <span>Create New Design</span>
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader className="h-12 w-12 text-blue-600 animate-spin" />
        </div>
      ) : designs.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <Palette className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No saved designs yet</h3>
          <p className="text-gray-600 mb-6">Start creating your custom products today!</p>
          <Link
            to="/designer"
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
          >
            Start Creating
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {designs.map((design) => {
            const laltex = isLaltexDesign(design);
            const productLabel = resolveProductLabel(design);
            const laltexColourImage = resolveLaltexColourImage(design);
            return (
              <div
                key={design.id}
                className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Thumbnail */}
                <div className="aspect-square bg-gray-200 relative">
                  {design.thumbnail_url ? (
                    <img
                      src={design.thumbnail_url}
                      alt={design.design_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Palette className="h-16 w-16 text-gray-400" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-4">
                  {/* Design Name - Editable */}
                  {editingNameId === design.id ? (
                    <div className="mb-3">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        autoFocus
                      />
                      <div className="flex space-x-2 mt-2">
                        <button
                          onClick={() => handleSaveName(design.id)}
                          disabled={savingName}
                          className="flex-1 px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
                        >
                          {savingName ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          disabled={savingName}
                          className="flex-1 px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="font-semibold text-gray-900 flex-1 mr-2">
                        {design.design_name || 'Untitled Design'}
                      </h3>
                      <button
                        onClick={() => handleEditName(design)}
                        className="text-gray-400 hover:text-gray-600"
                        title="Edit name"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {/* Product Info */}
                  <p className="text-sm text-gray-600 mb-2">{productLabel}</p>

                  {/* Colour */}
                  {design.color_name && (
                    <div className="flex items-center space-x-2 mb-2">
                      {laltex ? (
                        laltexColourImage ? (
                          <img
                            src={laltexColourImage}
                            alt={design.color_name}
                            className="w-5 h-5 rounded-full object-cover border border-gray-300"
                          />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-gray-200 border border-gray-300" />
                        )
                      ) : (
                        <div
                          className="w-5 h-5 rounded-full border border-gray-300"
                          style={{ backgroundColor: design.color_code || '#fff' }}
                        />
                      )}
                      <span className="text-sm text-gray-600">{design.color_name}</span>
                    </div>
                  )}

                  {/* Print area */}
                  {design.print_area && (
                    <p className="text-xs text-gray-500 mb-3">{prettyPrintArea(design.print_area)}</p>
                  )}

                  {/* Last Modified */}
                  <p className="text-xs text-gray-500 mb-4">
                    Modified {formatDate(design.updated_at)}
                  </p>

                  {/* Actions */}
                  <div className="space-y-2">
                    {/* Edit Button */}
                    <Link
                      to={editUrlFor(design)}
                      className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold"
                    >
                      <Palette className="h-4 w-4" />
                      <span>Edit</span>
                    </Link>

                    {/* Secondary Actions */}
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => handleDuplicate(design)}
                        className="flex items-center justify-center px-2 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-xs"
                        title="Duplicate"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleAddToQuote(design)}
                        className="flex items-center justify-center px-2 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-xs"
                        title="Add to Quote"
                      >
                        <FileText className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(design.id, design.design_name)}
                        className="flex items-center justify-center px-2 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors text-xs"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CustomerLayout>
  );
};

export default CustomerDesigns;
