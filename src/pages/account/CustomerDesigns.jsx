import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Palette, Edit2, Copy, Trash2, FileText, Loader, AlertCircle } from 'lucide-react';
import CustomerLayout from '../../components/customer/CustomerLayout';
import { supabase, deleteUserDesign } from '../../services/supabaseService';

const CustomerDesigns = ({ user }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [designs, setDesigns] = useState([]);
  const [editingNameId, setEditingNameId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    fetchDesigns();
  }, [user]);

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
      minute: '2-digit'
    });
  };

  const formatProductName = (productKey) => {
    if (!productKey) return 'Unknown Product';
    return productKey
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

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

      // Update local state
      setDesigns(designs.map(d =>
        d.id === designId ? { ...d, design_name: editingName.trim() } : d
      ));

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

  const handleDuplicate = async (design) => {
    try {
      const { error } = await supabase
        .from('user_designs')
        .insert({
          user_id: user.id,
          product_template_id: design.product_template_id,
          variant_id: design.variant_id,
          design_name: `${design.design_name} (Copy)`,
          design_data: design.design_data,
          thumbnail_url: design.thumbnail_url,
          view_name: design.view_name,
          product_key: design.product_key,
          color_code: design.color_code,
          color_name: design.color_name,
          print_area: design.print_area,
          is_public: false
        });

      if (error) throw error;

      // Refresh designs list
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

      // Update local state
      setDesigns(designs.filter(d => d.id !== designId));
    } catch (error) {
      console.error('[CustomerDesigns] Error deleting:', error);
      alert('Failed to delete design. Please try again.');
    }
  };

  const handleAddToQuote = (design) => {
    // TODO: Implement add to quote functionality
    alert('Add to Quote feature coming soon!');
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
          {designs.map((design) => (
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
                <p className="text-sm text-gray-600 mb-2">
                  {formatProductName(design.product_key)}
                </p>

                {/* Color */}
                {design.color_name && (
                  <div className="flex items-center space-x-2 mb-2">
                    <div
                      className="w-5 h-5 rounded-full border border-gray-300"
                      style={{ backgroundColor: design.color_code || '#fff' }}
                    />
                    <span className="text-sm text-gray-600">{design.color_name}</span>
                  </div>
                )}

                {/* View & Print Area */}
                {(design.view_name || design.print_area) && (
                  <p className="text-xs text-gray-500 mb-3">
                    {design.view_name && <span>{design.view_name}</span>}
                    {design.view_name && design.print_area && <span> • </span>}
                    {design.print_area && <span>{design.print_area}</span>}
                  </p>
                )}

                {/* Last Modified */}
                <p className="text-xs text-gray-500 mb-4">
                  Modified {formatDate(design.updated_at)}
                </p>

                {/* Actions */}
                <div className="space-y-2">
                  {/* Edit Button */}
                  <Link
                    to={`/designer?design=${design.id}`}
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
          ))}
        </div>
      )}
    </CustomerLayout>
  );
};

export default CustomerDesigns;
