import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Upload, FileImage, Trash2, CheckCircle, AlertCircle, Loader, Info } from 'lucide-react';
import { uploadOrderArtwork, getOrderArtwork, deleteOrderArtwork } from '../services/supabaseService';

const ACCEPTED_TYPES = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  'image/svg+xml': 'SVG',
  'application/pdf': 'PDF',
  'application/postscript': 'EPS/AI',
  'image/x-eps': 'EPS',
  'application/illustrator': 'AI',
};
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const formatFileSize = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

const formatDate = (dateString) => {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
};

const ArtworkUploadModal = ({ order, user, onClose, onUploaded }) => {
  const [existingArtwork, setExistingArtwork] = useState([]);
  const [loadingArtwork, setLoadingArtwork] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadExistingArtwork();
  }, [order.id]);

  // Trap focus / close on Escape
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const loadExistingArtwork = async () => {
    setLoadingArtwork(true);
    const { data } = await getOrderArtwork(order.id);
    setExistingArtwork(data || []);
    setLoadingArtwork(false);
  };

  const validateFile = (file) => {
    if (!ACCEPTED_TYPES[file.type]) {
      return `File type not supported. Please upload ${Object.values(ACCEPTED_TYPES).join(', ')}.`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File is too large (${formatFileSize(file.size)}). Maximum size is 50 MB.`;
    }
    return null;
  };

  const handleFiles = useCallback(async (files) => {
    if (uploading) return;
    const file = files[0];
    if (!file) return;

    const validationError = validateFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setUploadError(null);
    setUploadSuccess(false);
    setUploading(true);
    setUploadProgress(10);

    // Simulate progress while uploading
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => Math.min(prev + 15, 85));
    }, 400);

    const { data, error } = await uploadOrderArtwork(order.id, user.id, file);

    clearInterval(progressInterval);
    setUploadProgress(100);
    setUploading(false);

    if (error) {
      setUploadError(error.message || 'Upload failed. Please try again.');
    } else {
      setUploadSuccess(true);
      await loadExistingArtwork();
      onUploaded?.();
      // Clear success after a moment
      setTimeout(() => setUploadProgress(0), 800);
    }
  }, [uploading, order.id, user.id, onUploaded]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleFileInput = (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  };

  const handleDelete = async (artwork) => {
    if (deleteConfirmId !== artwork.id) {
      setDeleteConfirmId(artwork.id);
      return;
    }
    setDeleting(true);
    const { error } = await deleteOrderArtwork(artwork.id, artwork.file_url);
    setDeleting(false);
    setDeleteConfirmId(null);
    if (!error) {
      await loadExistingArtwork();
      onUploaded?.();
    }
  };

  const artworkStatusLabel = {
    uploaded: 'Uploaded',
    approved: 'Approved',
    rejected: 'Rejected',
    needs_changes: 'Needs Changes',
  };

  const artworkStatusClass = {
    uploaded: 'bg-blue-100 text-blue-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    needs_changes: 'bg-orange-100 text-orange-800',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Artwork Upload</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Order #{order.order_number || order.id.slice(0, 8)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Artwork Spec Panel */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-900 space-y-1">
                <p className="font-semibold">Artwork Requirements</p>
                <ul className="list-disc list-inside space-y-0.5 text-blue-800">
                  <li>Accepted formats: PDF, EPS, AI, SVG, PNG, JPG</li>
                  <li>Preferred: vector formats (PDF, EPS, AI, SVG) for best print quality</li>
                  <li>Minimum resolution for raster images: 300 DPI at print size</li>
                  <li>Maximum file size: 50 MB</li>
                  <li>Colours: CMYK or Pantone preferred for accurate colour matching</li>
                </ul>
                <p className="text-blue-700 mt-2">
                  Our team will review your artwork and contact you if any adjustments are needed before production.
                </p>
              </div>
            </div>
          </div>

          {/* Drop Zone */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Upload New File</h3>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => !uploading && fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
                ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}
                ${uploading ? 'pointer-events-none opacity-75' : ''}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.eps,.ai,.svg,.png,.jpg,.jpeg,.gif,.webp"
                onChange={handleFileInput}
                className="hidden"
              />

              {uploading ? (
                <div className="space-y-3">
                  <Loader className="h-10 w-10 text-blue-500 mx-auto animate-spin" />
                  <p className="text-sm font-medium text-gray-700">Uploading…</p>
                  <div className="w-full bg-gray-200 rounded-full h-2 max-w-xs mx-auto">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <Upload className="h-10 w-10 text-gray-400 mx-auto" />
                  <div>
                    <p className="text-sm font-semibold text-gray-700">
                      Drag & drop your artwork here
                    </p>
                    <p className="text-xs text-gray-500 mt-1">or click to browse files</p>
                  </div>
                  <p className="text-xs text-gray-400">
                    PDF, EPS, AI, SVG, PNG, JPG — max 50 MB
                  </p>
                </div>
              )}
            </div>

            {/* Upload feedback */}
            {uploadError && (
              <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{uploadError}</p>
              </div>
            )}
            {uploadSuccess && (
              <div className="mt-3 flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <p className="text-sm text-green-700 font-medium">Artwork uploaded successfully!</p>
              </div>
            )}
          </div>

          {/* Existing Artwork */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Uploaded Files</h3>
            {loadingArtwork ? (
              <div className="flex items-center justify-center py-6">
                <Loader className="h-6 w-6 text-blue-500 animate-spin" />
              </div>
            ) : existingArtwork.length === 0 ? (
              <div className="text-center py-6 text-sm text-gray-500 border border-gray-200 rounded-xl bg-gray-50">
                No artwork uploaded yet.
              </div>
            ) : (
              <div className="space-y-3">
                {existingArtwork.map((artwork) => (
                  <div
                    key={artwork.id}
                    className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-shrink-0 w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                      <FileImage className="h-5 w-5 text-gray-400" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{artwork.file_name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-gray-500">{formatFileSize(artwork.file_size)}</span>
                        <span className="text-xs text-gray-400">•</span>
                        <span className="text-xs text-gray-500">{formatDate(artwork.uploaded_at)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${artworkStatusClass[artwork.status] || 'bg-gray-100 text-gray-700'}`}>
                        {artworkStatusLabel[artwork.status] || artwork.status}
                      </span>

                      <a
                        href={artwork.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                      >
                        View
                      </a>

                      {artwork.status === 'uploaded' && (
                        <button
                          onClick={() => handleDelete(artwork)}
                          disabled={deleting}
                          className={`p-1.5 rounded-lg transition-colors ${
                            deleteConfirmId === artwork.id
                              ? 'bg-red-100 text-red-600 hover:bg-red-200'
                              : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                          }`}
                          title={deleteConfirmId === artwork.id ? 'Click again to confirm delete' : 'Delete'}
                        >
                          {deleting && deleteConfirmId === artwork.id
                            ? <Loader className="h-4 w-4 animate-spin" />
                            : <Trash2 className="h-4 w-4" />
                          }
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes from team */}
          {existingArtwork.some(a => a.notes) && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-amber-900 mb-2">Notes from our team</h4>
              {existingArtwork.filter(a => a.notes).map(a => (
                <div key={a.id} className="text-sm text-amber-800">
                  <span className="font-medium">{a.file_name}:</span> {a.notes}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ArtworkUploadModal;
