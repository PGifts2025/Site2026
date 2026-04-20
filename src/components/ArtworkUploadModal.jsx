import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, FileImage, Trash2, CheckCircle, AlertCircle, Loader, Info } from 'lucide-react';
import { uploadOrderArtwork, getOrderArtwork, deleteOrderArtwork, getArtworkSignedUrl } from '../services/supabaseService';

const ACCEPTED_TYPES = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/tiff': 'TIFF',
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

// Image MIME types we can preview directly via a signed URL.
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'image/tiff']);

// Returns a small badge descriptor for non-image formats, or null for
// types that should fall through to the generic file icon.
const getFileTypeBadge = (mime) => {
  if (mime === 'application/pdf') return { label: 'PDF', cls: 'bg-red-100 text-red-700' };
  if (mime === 'application/postscript' || mime === 'image/x-eps') return { label: 'EPS', cls: 'bg-purple-100 text-purple-700' };
  if (mime === 'application/illustrator') return { label: 'AI', cls: 'bg-orange-100 text-orange-700' };
  return null;
};

const ArtworkUploadModal = ({ order, user, onClose, onUploaded }) => {
  const [existingArtwork, setExistingArtwork] = useState([]);
  const [loadingArtwork, setLoadingArtwork] = useState(true);
  // Map artwork.id → signed URL for image previews. Populated async after
  // the artwork list loads so the modal doesn't wait on Supabase.
  const [thumbnails, setThumbnails] = useState({});
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  // Colour spec — mandatory per upload. '' means unselected; must be set
  // before a file can be accepted. Pantone additionally requires text.
  const [colourType, setColourType] = useState('');
  const [pantoneText, setPantoneText] = useState('');
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

  // Fetch signed URLs for image-type artwork so we can render thumbnails.
  // Non-blocking: each URL lands in `thumbnails` as it arrives.
  useEffect(() => {
    if (!existingArtwork.length) return;
    let cancelled = false;
    existingArtwork
      .filter(a => IMAGE_MIME_TYPES.has(a.file_type))
      .forEach(async (a) => {
        const { data, error } = await getArtworkSignedUrl(a.file_url, 3600);
        if (cancelled || error || !data?.signedUrl) return;
        setThumbnails(prev => ({ ...prev, [a.id]: data.signedUrl }));
      });
    return () => { cancelled = true; };
  }, [existingArtwork]);

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

    // Colour spec is mandatory for new uploads.
    if (!colourType) {
      setUploadError('Please specify your colour type before uploading.');
      return;
    }
    if (colourType === 'Pantone' && !pantoneText.trim()) {
      setUploadError('Please enter your Pantone colour reference(s).');
      return;
    }

    const notes = colourType === 'Pantone'
      ? `Pantone: ${pantoneText.trim()}`
      : 'CMYK';

    setUploadError(null);
    setUploadSuccess(false);
    setUploading(true);
    setUploadProgress(10);

    // Simulate progress while uploading
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => Math.min(prev + 15, 85));
    }, 400);

    const { data, error } = await uploadOrderArtwork(order.id, user.id, file, notes);

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
  }, [uploading, order.id, user.id, onUploaded, colourType, pantoneText]);

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
    setDeleting(true);
    const { error } = await deleteOrderArtwork(artwork.id, artwork.file_url, order.id);
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

  // Render via portal to document.body so the modal escapes any parent
  // stacking context (sticky header, sidebar wrapper, etc.). z-[200] sits
  // above the sidebar (z-[101]) and both headers (z-[100] / z-30).
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
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
                accept=".pdf,.eps,.ai,.svg,.png,.jpg,.jpeg,.tif,.tiff"
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
                    PDF, EPS, AI, SVG, PNG, JPG, TIFF — max 50 MB
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

          {/* Colour Specification — mandatory before new uploads */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Colour Specification</h3>
            <div className="space-y-3 p-4 border border-gray-200 rounded-xl">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="colourType"
                  value="CMYK"
                  checked={colourType === 'CMYK'}
                  onChange={() => setColourType('CMYK')}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">CMYK</p>
                  <p className="text-xs text-gray-500">Use the colours exactly as they appear in my artwork file.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="colourType"
                  value="Pantone"
                  checked={colourType === 'Pantone'}
                  onChange={() => setColourType('Pantone')}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">Pantone</p>
                  <p className="text-xs text-gray-500">I'll specify exact Pantone colour reference(s).</p>
                  {colourType === 'Pantone' && (
                    <input
                      type="text"
                      value={pantoneText}
                      onChange={(e) => setPantoneText(e.target.value)}
                      placeholder="e.g. PMS 286C, PMS 032C"
                      className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  )}
                </div>
              </label>
            </div>
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
                    {(() => {
                      const thumbUrl = thumbnails[artwork.id];
                      const badge = getFileTypeBadge(artwork.file_type);
                      if (thumbUrl) {
                        return (
                          <img
                            src={thumbUrl}
                            alt={artwork.file_name}
                            className="flex-shrink-0 w-16 h-16 rounded-md object-contain bg-gray-50 border border-gray-200"
                            onError={() => setThumbnails(prev => {
                              const next = { ...prev };
                              delete next[artwork.id];
                              return next;
                            })}
                          />
                        );
                      }
                      if (badge) {
                        return (
                          <div className={`flex-shrink-0 w-16 h-16 rounded-md flex items-center justify-center font-bold text-sm ${badge.cls}`}>
                            {badge.label}
                          </div>
                        );
                      }
                      return (
                        <div className="flex-shrink-0 w-16 h-16 bg-gray-100 rounded-md flex items-center justify-center">
                          <FileImage className="h-6 w-6 text-gray-400" />
                        </div>
                      );
                    })()}

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{artwork.file_name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-gray-500">{formatFileSize(artwork.file_size)}</span>
                        <span className="text-xs text-gray-400">•</span>
                        <span className="text-xs text-gray-500">{formatDate(artwork.uploaded_at)}</span>
                      </div>
                      {artwork.notes && (
                        <p className="text-xs text-gray-500 mt-1 italic">{artwork.notes}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${artworkStatusClass[artwork.status] || 'bg-gray-100 text-gray-700'}`}>
                        {artworkStatusLabel[artwork.status] || artwork.status}
                      </span>

                      <button
                        type="button"
                        onClick={async () => {
                          const { data, error } = await getArtworkSignedUrl(artwork.file_url);
                          if (error || !data?.signedUrl) {
                            alert('Could not open file. Please try again.');
                            return;
                          }
                          window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
                        }}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors cursor-pointer"
                      >
                        View
                      </button>

                      {artwork.status === 'uploaded' && (
                        deleteConfirmId === artwork.id ? (
                          <div className="flex items-center gap-1 text-xs">
                            <span className="text-gray-600">Delete?</span>
                            <button
                              type="button"
                              onClick={() => handleDelete(artwork)}
                              disabled={deleting}
                              className="px-2 py-1 text-red-600 hover:text-red-800 font-medium hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                            >
                              {deleting ? <Loader className="h-4 w-4 animate-spin" /> : 'Yes'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(null)}
                              disabled={deleting}
                              className="px-2 py-1 text-gray-500 hover:text-gray-700 font-medium hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(artwork.id)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

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
    </div>,
    document.body
  );
};

export default ArtworkUploadModal;
