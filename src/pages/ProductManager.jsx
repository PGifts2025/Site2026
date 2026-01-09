import React, { useState, useRef, useEffect } from 'react';
import { fabric } from 'fabric';
import { useNavigate } from 'react-router-dom';
import {
  Save,
  X,
  Plus,
  Trash2,
  Upload,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Move,
  Edit,
  Copy,
  Loader,
  CheckCircle,
  AlertCircle,
  Package,
  Palette,
  Eye,
  Grid,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import {
  getProductTemplates,
  createProductTemplate,
  updateProductTemplate,
  deleteProductTemplate,
  upsertProductVariant,
  batchUpdatePrintAreasForVariant,
  uploadTemplateImage,
  isCurrentUserAdmin,
  getApparelColors,
  getProductColors,
  assignColorToProduct,
  removeColorFromProduct,
  uploadColorPhoto,
  assignMultipleColors,
  getStandardColorSet,
  copyColorsFromProduct,
  uploadOverlayImage,
  deleteOverlayImage,
  listOverlayImages,
  supabase,
  PRINT_AREA_PRESETS,
  getPrintAreasByProductView,
  createPrintAreaForView,
  deletePrintAreaForView
} from '../services/supabaseService';
import { compressImage, needsCompression, getImageDimensions } from '../utils/imageCompression';

const PRODUCT_CATEGORIES = [
  'Bags', 'Cups', 'Water Bottles', 'Clothing', 'Hi Vis',
  'Cables', 'Power', 'Speakers', 'Pens', 'Notebooks', 'Tea Towels'
];

const PRODUCT_TYPES = [
  'All Products',
  'T-Shirts',
  'Polo Shirts',
  'Hoodies',
  'Sweatshirts',
  'Bags',
  'Cups'
];

// Updated to only include physical views that require separate images
// Left/Right breast pockets are now PRINT AREAS on the front view, not separate views
const AVAILABLE_VIEWS = ['front', 'back', 'top'];
const STANDARD_TEMPLATE_SIZE = { width: 800, height: 1200 }; // Standard size for all templates

// Overlay types for product customization (cords, collars, pockets, etc.)
const OVERLAY_TYPES = [
  { value: 'cord', label: 'Cord/String', description: 'Hoodie cords, drawstrings' },
  { value: 'collar', label: 'Collar', description: 'Polo collars, shirt collars' },
  { value: 'pocket', label: 'Pocket', description: 'Pocket flaps, breast pockets' },
  { value: 'button', label: 'Buttons', description: 'Button details' },
  { value: 'zipper', label: 'Zipper', description: 'Zipper details' },
  { value: 'cuff', label: 'Cuff', description: 'Sleeve cuffs' },
  { value: 'custom', label: 'Custom', description: 'Custom overlay element' }
];

/**
 * Resizes an image file to standard template dimensions
 * CRITICAL: Preserves PNG transparency for proper color overlay system
 * @param {File} file - The image file to resize
 * @returns {Promise<Blob>} - Resized image as a blob
 */
const resizeImage = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Create canvas at standard size
        const canvas = document.createElement('canvas');
        canvas.width = STANDARD_TEMPLATE_SIZE.width;
        canvas.height = STANDARD_TEMPLATE_SIZE.height;

        // CRITICAL: Enable alpha channel to preserve transparency
        const ctx = canvas.getContext('2d', { alpha: true });

        // CRITICAL: DO NOT fill with background color!
        // This was destroying transparency - removed these lines:
        // ctx.fillStyle = 'white';
        // ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Calculate scaling to fit image proportionally
        const scale = Math.min(
          STANDARD_TEMPLATE_SIZE.width / img.width,
          STANDARD_TEMPLATE_SIZE.height / img.height
        );

        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;
        const x = (STANDARD_TEMPLATE_SIZE.width - scaledWidth) / 2;
        const y = (STANDARD_TEMPLATE_SIZE.height - scaledHeight) / 2;

        console.log('[ProductManager] Image resized with transparency preserved:', {
          originalSize: { width: img.width, height: img.height },
          standardSize: STANDARD_TEMPLATE_SIZE,
          scale: scale,
          scaledSize: { width: scaledWidth, height: scaledHeight },
          position: { x, y },
          preservesAlpha: true
        });

        // Draw image centered on canvas (transparency preserved)
        ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

        // Convert to PNG blob with full quality to preserve transparency
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob from canvas'));
          }
        }, 'image/png', 1.0); // Use 1.0 quality for PNG
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
};

const ProductManager = () => {
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);

  // Authentication
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // UI State
  const [currentStep, setCurrentStep] = useState(1);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'edit'
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // Product List
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productTypeFilter, setProductTypeFilter] = useState('All Products');

  // Color Management
  const [showColorModal, setShowColorModal] = useState(false);
  const [currentColorProduct, setCurrentColorProduct] = useState(null);
  const [allColors, setAllColors] = useState([]);
  const [assignedColors, setAssignedColors] = useState([]);
  const [loadingColors, setLoadingColors] = useState(false);
  const [expandedColorFamilies, setExpandedColorFamilies] = useState(['Basics']);
  const [uploadingPhoto, setUploadingPhoto] = useState(null);
  const [showCopyColorsModal, setShowCopyColorsModal] = useState(false);

  // Overlay Management
  const [overlays, setOverlays] = useState([]); // List of existing overlays for current product
  const [loadingOverlays, setLoadingOverlays] = useState(false);
  const [uploadingOverlay, setUploadingOverlay] = useState(null);
  const [showOverlaySection, setShowOverlaySection] = useState(false); // Toggle overlay section visibility
  const [selectedOverlayType, setSelectedOverlayType] = useState('cord');
  const [selectedOverlayView, setSelectedOverlayView] = useState('front');
  const [selectedOverlayColor, setSelectedOverlayColor] = useState(null);

  // Product Data (Step 1)
  const [productName, setProductName] = useState('');
  const [productKey, setProductKey] = useState('');
  const [category, setCategory] = useState('Bags');
  const [basePrice, setBasePrice] = useState('');
  const [minOrderQty, setMinOrderQty] = useState('50');
  const [description, setDescription] = useState('');

  // Color Variants (Step 2)
  const [colorVariants, setColorVariants] = useState([
    { id: 1, name: '', colorCode: '#000000', templateUrl: null, uploadedFile: null, views: ['front'] }
  ]);
  const [uploadingColor, setUploadingColor] = useState(null);
  const [expandedVariants, setExpandedVariants] = useState([1]);

  // Current Editing Context (Step 3)
  const [currentVariantIndex, setCurrentVariantIndex] = useState(0);
  const [currentView, setCurrentView] = useState('front');

  // Print Areas (Step 4)
  const [printAreas, setPrintAreas] = useState({});
  const [selectedPrintArea, setSelectedPrintArea] = useState(null);
  const [showGrid, setShowGrid] = useState(true);
  const [gridSize, setGridSize] = useState(20);
  const [newAreaName, setNewAreaName] = useState('');
  const [showNewAreaDialog, setShowNewAreaDialog] = useState(false);
  const [selectedShape, setSelectedShape] = useState('rectangle');
  const [selectedPreset, setSelectedPreset] = useState('custom');
  const [configuredViews, setConfiguredViews] = useState([]);

  // Edit Mode
  const [editingProductId, setEditingProductId] = useState(null);

  // Check admin access
  useEffect(() => {
    const checkAdmin = async () => {
      setCheckingAuth(true);
      try {
        const adminStatus = await isCurrentUserAdmin();
        setIsAdmin(adminStatus);
        if (!adminStatus) {
          showMessage('error', 'Access denied. Admin privileges required.');
          setTimeout(() => navigate('/'), 2000);
        }
      } catch (error) {
        console.error('Error checking admin:', error);
        setIsAdmin(false);
      } finally {
        setCheckingAuth(false);
      }
    };

    checkAdmin();
  }, [navigate]);

  // Load products when in list view
  useEffect(() => {
    if (viewMode === 'list' && isAdmin) {
      loadProducts();
    }
  }, [viewMode, isAdmin]);

  // Initialize canvas
  const initCanvas = React.useCallback((canvasElement) => {
    if (canvasElement && !fabricCanvasRef.current) {
      const fabricCanvas = new fabric.Canvas(canvasElement, {
        width: 800,
        height: 800,
        backgroundColor: '#f8f9fa',
        selection: true
      });

      fabricCanvas.on('object:modified', (e) => {
        const obj = e.target;
        if (!fabricCanvas || obj.type !== 'printArea') return;

        const key = obj.printAreaKey;
        const variantKey = `${currentVariantIndex}_${currentView}`;
        const shapeType = obj.printAreaShape || 'rectangle';

        let updatedArea;

        // Get template image scale FIRST
        const templateImage = fabricCanvas.getObjects().find(o => o.id === 'productTemplate');
        const currentScale = templateImage ? templateImage.scaleX : 1;

        if (shapeType === 'circle') {
          const screenRadius = Math.round((obj.radius || 50) * obj.scaleX);
          const screenX = Math.round(obj.left);
          const screenY = Math.round(obj.top);

          // Calculate canvas offset to get coordinates relative to IMAGE
          const imageActualWidth = templateImage.width * templateImage.scaleX;
          const imageActualHeight = templateImage.height * templateImage.scaleY;
          const canvasOffsetX = (fabricCanvas.width - imageActualWidth) / 2;
          const canvasOffsetY = (fabricCanvas.height - imageActualHeight) / 2;

          // Get position relative to IMAGE (not canvas)
          const circleLeft = screenX - canvasOffsetX;
          const circleTop = screenY - canvasOffsetY;

          // Unscale back to original image dimensions
          const unscaledRadius = Math.round(screenRadius / currentScale);
          const unscaledX = Math.round(circleLeft / currentScale);
          const unscaledY = Math.round(circleTop / currentScale);

          updatedArea = {
            name: obj.printAreaName,
            x: unscaledX,
            y: unscaledY,
            width: unscaledRadius * 2,
            height: unscaledRadius * 2,
            radius: unscaledRadius,
            maxWidth: unscaledRadius * 2,
            maxHeight: unscaledRadius * 2,
            shape: 'circle'
          };
          obj.set({ scaleX: 1, scaleY: 1, radius: screenRadius });

          console.log('=== SAVING PRINT AREA (CIRCLE) ===');
          console.log('Canvas coords:', { x: screenX, y: screenY, radius: screenRadius });
          console.log('Canvas offset:', { x: canvasOffsetX, y: canvasOffsetY });
          console.log('Image-relative coords (scaled):', { x: circleLeft, y: circleTop });
          console.log('Image scale:', currentScale);
          console.log('Unscaled coords (saved):', { x: unscaledX, y: unscaledY, radius: unscaledRadius });
          console.log('===================================');
        } else if (shapeType === 'ellipse') {
          const screenRx = Math.round((obj.rx || 50) * obj.scaleX);
          const screenRy = Math.round((obj.ry || 50) * obj.scaleY);
          const screenX = Math.round(obj.left);
          const screenY = Math.round(obj.top);

          // Calculate canvas offset to get coordinates relative to IMAGE
          const imageActualWidth = templateImage.width * templateImage.scaleX;
          const imageActualHeight = templateImage.height * templateImage.scaleY;
          const canvasOffsetX = (fabricCanvas.width - imageActualWidth) / 2;
          const canvasOffsetY = (fabricCanvas.height - imageActualHeight) / 2;

          // Get position relative to IMAGE (not canvas)
          const ellipseLeft = screenX - canvasOffsetX;
          const ellipseTop = screenY - canvasOffsetY;

          // Unscale back to original image dimensions
          const unscaledRx = Math.round(screenRx / currentScale);
          const unscaledRy = Math.round(screenRy / currentScale);
          const unscaledX = Math.round(ellipseLeft / currentScale);
          const unscaledY = Math.round(ellipseTop / currentScale);

          updatedArea = {
            name: obj.printAreaName,
            x: unscaledX,
            y: unscaledY,
            width: unscaledRx * 2,
            height: unscaledRy * 2,
            rx: unscaledRx,
            ry: unscaledRy,
            maxWidth: unscaledRx * 2,
            maxHeight: unscaledRy * 2,
            shape: 'ellipse'
          };
          obj.set({ scaleX: 1, scaleY: 1, rx: screenRx, ry: screenRy });

          console.log('=== SAVING PRINT AREA (ELLIPSE) ===');
          console.log('Canvas coords:', { x: screenX, y: screenY, rx: screenRx, ry: screenRy });
          console.log('Canvas offset:', { x: canvasOffsetX, y: canvasOffsetY });
          console.log('Image-relative coords (scaled):', { x: ellipseLeft, y: ellipseTop });
          console.log('Image scale:', currentScale);
          console.log('Unscaled coords (saved):', { x: unscaledX, y: unscaledY, rx: unscaledRx, ry: unscaledRy });
          console.log('====================================');
        } else {
          // Calculate screen coordinates (what we see on canvas)
          const screenX = Math.round(obj.left);
          const screenY = Math.round(obj.top);
          const screenWidth = Math.round(obj.width * obj.scaleX);
          const screenHeight = Math.round(obj.height * obj.scaleY);

          // CRITICAL FIX: Calculate canvas offset to get coordinates relative to IMAGE
          const imageActualWidth = templateImage.width * templateImage.scaleX;
          const imageActualHeight = templateImage.height * templateImage.scaleY;
          const canvasOffsetX = (fabricCanvas.width - imageActualWidth) / 2;
          const canvasOffsetY = (fabricCanvas.height - imageActualHeight) / 2;

          // Get rectangle position relative to IMAGE (not canvas)
          const rectLeft = screenX - canvasOffsetX;
          const rectTop = screenY - canvasOffsetY;

          // Now unscale to get coordinates for full-size image
          updatedArea = {
            name: obj.printAreaName,
            x: Math.round(rectLeft / currentScale),
            y: Math.round(rectTop / currentScale),
            width: Math.round(screenWidth / currentScale),
            height: Math.round(screenHeight / currentScale),
            maxWidth: Math.round(screenWidth / currentScale),
            maxHeight: Math.round(screenHeight / currentScale),
            shape: 'rectangle'
          };
          obj.set({ scaleX: 1, scaleY: 1, width: screenWidth, height: screenHeight });
        }

        // Calculate template dimensions for logging (templateImage and currentScale already declared above)
        const templateDimensions = templateImage
          ? { width: Math.round(templateImage.width * templateImage.scaleX), height: Math.round(templateImage.height * templateImage.scaleY) }
          : { width: 'unknown', height: 'unknown' };

        // Diagnostic logging
        console.log('=== SAVING PRINT AREA (RECTANGLE) ===');
        console.log('Print Area Name:', obj.printAreaName);
        console.log('Canvas Coordinates:', {
          x: Math.round(obj.left),
          y: Math.round(obj.top),
          width: Math.round(obj.width * obj.scaleX),
          height: Math.round(obj.height * obj.scaleY)
        });

        // Calculate offset info for logging
        const imageActualWidth = templateImage.width * templateImage.scaleX;
        const imageActualHeight = templateImage.height * templateImage.scaleY;
        const logCanvasOffsetX = (fabricCanvas.width - imageActualWidth) / 2;
        const logCanvasOffsetY = (fabricCanvas.height - imageActualHeight) / 2;
        const logRectLeft = Math.round(obj.left) - logCanvasOffsetX;
        const logRectTop = Math.round(obj.top) - logCanvasOffsetY;

        console.log('Canvas offset:', { x: logCanvasOffsetX, y: logCanvasOffsetY });
        console.log('Image actual size:', { width: imageActualWidth, height: imageActualHeight });
        console.log('Canvas size:', { width: fabricCanvas.width, height: fabricCanvas.height });
        console.log('Image-relative coords (scaled):', { x: logRectLeft, y: logRectTop });
        console.log('Current image scale:', currentScale);
        console.log('Unscaled Coordinates (saved to DB):', {
          x: updatedArea.x,
          y: updatedArea.y,
          width: updatedArea.width,
          height: updatedArea.height
        });
        console.log('Template natural dimensions:', templateImage ? { width: templateImage.width, height: templateImage.height } : 'unknown');
        console.log('Template scaled dimensions:', templateDimensions);
        console.log('======================================');

        setPrintAreas(prev => ({
          ...prev,
          [variantKey]: {
            ...(prev[variantKey] || {}),
            [key]: updatedArea
          }
        }));

        // Update label
        const label = fabricCanvas.getObjects().find(o => o.id === `printAreaLabel_${key}`);
        if (label) {
          label.set({ left: obj.left + 5, top: obj.top - 25 });
        }

        fabricCanvas.renderAll();
      });

      fabricCanvas.on('object:moving', (e) => {
        const obj = e.target;
        if (!fabricCanvas || obj.type !== 'printArea') return;

        const key = obj.printAreaKey;
        const label = fabricCanvas.getObjects().find(o => o.id === `printAreaLabel_${key}`);
        if (label) {
          label.set({ left: obj.left + 5, top: obj.top - 25 });
        }

        fabricCanvas.renderAll();
      });

      fabricCanvas.on('selection:created', (e) => {
        if (e.selected[0]?.type === 'printArea') {
          setSelectedPrintArea(e.selected[0].printAreaKey);
        }
      });
      fabricCanvas.on('selection:cleared', () => setSelectedPrintArea(null));

      fabricCanvasRef.current = fabricCanvas;
    } else if (!canvasElement && fabricCanvasRef.current) {
      fabricCanvasRef.current.dispose();
      fabricCanvasRef.current = null;
    }
  }, [currentVariantIndex, currentView]);

  // Helper functions
  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), type === 'success' ? 4000 : 8000);
  };

  const generateProductKey = (name) => {
    return name.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  };

  // Product List Operations
  const loadProducts = async () => {
    setLoadingProducts(true);
    try {
      const { data, error } = await getProductTemplates();

      if (error) {
        console.error('Error loading products:', error);
        showMessage('error', 'Failed to load products');
        setProducts([]);
        return;
      }

      setProducts(data || []);
    } catch (error) {
      console.error('Error loading products:', error);
      showMessage('error', 'Failed to load products');
      setProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  };

  const startNewProduct = () => {
    // Reset all state
    setProductName('');
    setProductKey('');
    setCategory('Bags');
    setBasePrice('');
    setMinOrderQty('50');
    setDescription('');
    setColorVariants([
      { id: 1, name: '', colorCode: '#000000', templateUrl: null, uploadedFile: null, views: ['front'] }
    ]);
    setPrintAreas({});
    setConfiguredViews([]);
    setCurrentStep(1);
    setEditingProductId(null);
    setViewMode('edit');
  };

  const editProduct = async (product) => {
    // Load product data into form
    setEditingProductId(product.id);
    setProductName(product.name);
    setProductKey(product.product_key);
    setCategory(product.category || 'Bags');
    setBasePrice(product.base_price?.toString() || '');
    setMinOrderQty(product.minimum_order_quantity?.toString() || '50');
    setDescription(product.description || '');

    // Load variants
    // TODO: Load variants from database
    setColorVariants([
      { id: 1, name: '', colorCode: '#000000', templateUrl: product.template_url, uploadedFile: null, views: ['front'] }
    ]);

    setCurrentStep(1);
    setViewMode('edit');
  };

  const cloneProduct = (product) => {
    setEditingProductId(null);
    setProductName(product.name + ' (Copy)');
    setProductKey(product.product_key + '-copy');
    setCategory(product.category || 'Bags');
    setBasePrice(product.base_price?.toString() || '');
    setMinOrderQty(product.minimum_order_quantity?.toString() || '50');
    setDescription(product.description || '');
    setColorVariants([
      { id: 1, name: '', colorCode: '#000000', templateUrl: product.template_url, uploadedFile: null, views: ['front'] }
    ]);
    setCurrentStep(1);
    setViewMode('edit');
  };

  const deleteProduct = async (product) => {
    if (!confirm(`Delete product "${product.name}"? This action cannot be undone.`)) {
      return;
    }

    setLoading(true);
    try {
      await deleteProductTemplate(product.product_key);
      showMessage('success', 'Product deleted successfully');
      loadProducts();
    } catch (error) {
      console.error('Error deleting product:', error);
      showMessage('error', 'Failed to delete product');
    } finally {
      setLoading(false);
    }
  };

  // Color Variant Operations
  const addColorVariant = () => {
    const newId = Math.max(...colorVariants.map(v => v.id), 0) + 1;
    setColorVariants([
      ...colorVariants,
      { id: newId, name: '', colorCode: '#000000', templateUrl: null, uploadedFile: null, views: ['front'] }
    ]);
    setExpandedVariants([...expandedVariants, newId]);
  };

  const removeColorVariant = (id) => {
    if (colorVariants.length === 1) {
      showMessage('error', 'At least one color variant is required');
      return;
    }
    setColorVariants(colorVariants.filter(v => v.id !== id));
    setExpandedVariants(expandedVariants.filter(vid => vid !== id));
  };

  const updateColorVariant = async (id, field, value) => {
    if (field === 'colorCode') {
      console.log('[ColorPicker] Color changed:', value);
    }

    // Find the variant being updated
    const variant = colorVariants.find(v => v.id === id);

    // Update local state
    setColorVariants(colorVariants.map(v =>
      v.id === id ? { ...v, [field]: value } : v
    ));

    // If updating color code and editing existing product with uploaded images, update database
    if (field === 'colorCode' && editingProductId && variant) {
      const hasUploadedImages = variant.viewUrls && Object.keys(variant.viewUrls).length > 0;

      if (hasUploadedImages) {
        console.log('[ColorPicker] Updating database with new color:', value);

        try {
          // Update all view records for this color variant
          const { error } = await supabase
            .from('product_template_variants')
            .update({ color_code: value })
            .eq('product_template_id', editingProductId)
            .eq('color_name', variant.name);

          if (error) {
            console.error('[ColorPicker] Failed to update database:', error);
            showMessage('warning', `Color updated locally but database update failed: ${error.message}`);
          } else {
            console.log('[ColorPicker] ✅ Database updated with color:', value);
            showMessage('success', 'Color updated successfully');
          }
        } catch (err) {
          console.error('[ColorPicker] Database update error:', err);
        }
      }
    }
  };

  const toggleView = (variantId, view) => {
    setColorVariants(colorVariants.map(v => {
      if (v.id === variantId) {
        const views = v.views.includes(view)
          ? v.views.filter(vw => vw !== view)
          : [...v.views, view];
        return { ...v, views: views.length > 0 ? views : ['front'] };
      }
      return v;
    }));
  };

  // UPDATED: Upload with folder structure naming (product-key/color-view.png)
  const handleColorImageUpload = async (variantId, view, file) => {
    if (!file) return;

    const variant = colorVariants.find(v => v.id === variantId);
    if (!variant || !variant.name) {
      showMessage('error', 'Please enter a color name before uploading');
      return;
    }

    const tempKey = productKey || generateProductKey(productName);
    if (!tempKey) {
      showMessage('error', 'Product key is required');
      return;
    }

    const uploadKey = `${variantId}-${view}`;
    console.log('[Upload] Starting upload:', {
      variantId,
      colorName: variant.name,
      colorCode: variant.colorCode,
      view,
      productKey: tempKey,
      fileName: file.name,
      size: `${(file.size / 1024).toFixed(2)} KB`
    });
    console.log('[Upload] Using color code:', variant.colorCode);

    setUploadingColor(uploadKey);
    try {
      // Validate image dimensions
      const dimensions = await getImageDimensions(file);
      console.log('[Upload] Image dimensions:', dimensions);

      // Check if aspect ratio matches standard (800x1200 = 0.667)
      const uploadedRatio = dimensions.width / dimensions.height;
      const standardRatio = STANDARD_TEMPLATE_SIZE.width / STANDARD_TEMPLATE_SIZE.height;
      const ratioDiff = Math.abs(uploadedRatio - standardRatio);

      if (ratioDiff > 0.1) {
        console.warn('[Upload] ⚠️ Aspect ratio mismatch:', {
          uploaded: `${dimensions.width}x${dimensions.height} (${uploadedRatio.toFixed(2)})`,
          standard: `${STANDARD_TEMPLATE_SIZE.width}x${STANDARD_TEMPLATE_SIZE.height} (${standardRatio.toFixed(2)})`
        });
        showMessage('warning', `Image aspect ratio (${uploadedRatio.toFixed(2)}) differs from standard (${standardRatio.toFixed(2)}). Image may appear distorted.`);
      }

      // Compress image if needed (preserves PNG transparency)
      let fileToUpload = file;
      if (needsCompression(file, 500)) {
        console.log('[Upload] Compressing image...');
        fileToUpload = await compressImage(file, {
          maxWidth: 2000,
          maxHeight: 2000
        });
        console.log('[Upload] Compressed:', {
          newSize: `${(fileToUpload.size / 1024).toFixed(2)} KB`,
          savings: `${((1 - fileToUpload.size / file.size) * 100).toFixed(1)}%`
        });
      }

      // Build folder structure path: product-key/color-view.png
      const sanitizedColorName = variant.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const sanitizedView = view.toLowerCase();
      const fileExt = fileToUpload.name.split('.').pop().toLowerCase();
      const extension = fileExt === 'png' ? 'png' : 'jpg';
      const fileName = `${sanitizedColorName}-${sanitizedView}.${extension}`;
      const storagePath = `${tempKey}/${fileName}`;

      console.log('[Upload] Using folder structure:', storagePath);

      // Upload to Supabase storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('product-templates')
        .upload(storagePath, fileToUpload, {
          upsert: true,
          contentType: fileToUpload.type
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('product-templates')
        .getPublicUrl(storagePath);

      const imageUrl = urlData.publicUrl;
      console.log('[Upload] ✅ Uploaded successfully:', imageUrl);

      // If editing existing product, insert variant into database immediately
      if (editingProductId) {
        console.log('[Upload] Inserting variant into database...', {
          productId: editingProductId,
          colorName: variant.name,
          viewName: view
        });

        try {
          // First check if it already exists
          const { data: existing } = await supabase
            .from('product_template_variants')
            .select('id')
            .eq('product_template_id', editingProductId)
            .eq('color_name', variant.name)
            .eq('view_name', view)
            .maybeSingle();

          console.log('[Upload] Existing record check:', existing ? 'FOUND' : 'NOT FOUND', existing);

          let dbError = null;

          if (existing) {
            // Update existing record
            const updateData = {
              template_url: imageUrl,
              color_code: variant.colorCode || '#000000'
            };
            console.log('[Upload] Updating with data:', updateData);
            const { error } = await supabase
              .from('product_template_variants')
              .update(updateData)
              .eq('id', existing.id);
            dbError = error;
            if (!error) console.log('[Upload] ✅ Updated existing variant in database');
          } else {
            // Insert new record
            const insertData = {
              product_template_id: editingProductId,
              color_name: variant.name,
              color_code: variant.colorCode || '#000000',
              view_name: view,
              template_url: imageUrl
            };
            console.log('[Upload] Inserting with data:', insertData);
            const { error } = await supabase
              .from('product_template_variants')
              .insert(insertData);
            dbError = error;
            if (!error) console.log('[Upload] ✅ Inserted new variant into database');
          }

          if (dbError) {
            console.error('[Upload] ❌ Database save failed:', JSON.stringify(dbError, null, 2));
            showMessage('warning', `Image uploaded but database update failed: ${dbError.message}`);
          } else {
            console.log('[Upload] ✅ Saved to database:', variant.name, view);
          }
        } catch (dbErr) {
          console.error('[Upload] Database error:', dbErr);
        }
      } else {
        console.log('[Upload] Skipping database insert (new product - will be saved on final save)');
      }

      // Update variant with view-specific URL
      setColorVariants(prev => prev.map(v => {
        if (v.id === variantId) {
          const viewUrls = v.viewUrls || {};
          return {
            ...v,
            viewUrls: { ...viewUrls, [view]: imageUrl },
            // Keep templateUrl for backward compatibility (use first view)
            templateUrl: imageUrl,
            uploadTimestamp: Date.now()
          };
        }
        return v;
      }));

      showMessage('success', `${view} image uploaded successfully`);
    } catch (error) {
      console.error('[Upload] Error:', error);
      showMessage('error', `Failed to upload image: ${error.message}`);
    } finally {
      setUploadingColor(null);
    }
  };

  const toggleVariantExpanded = (variantId) => {
    setExpandedVariants(prev =>
      prev.includes(variantId)
        ? prev.filter(id => id !== variantId)
        : [...prev, variantId]
    );
  };

  // Color Management Operations
  const openColorManagement = async (product) => {
    setCurrentColorProduct(product);
    setShowColorModal(true);
    setLoadingColors(true);

    try {
      // Load all available colors
      const { data: colorsData, error: colorsError } = await getApparelColors();
      if (colorsError) throw colorsError;
      setAllColors(colorsData || []);

      // Load currently assigned colors
      const { data: assignedData, error: assignedError} = await getProductColors(product.id);
      if (assignedError) throw assignedError;
      setAssignedColors(assignedData || []);

      // Load overlays for this product
      // Note: This will be called after setting currentColorProduct
      setTimeout(() => loadOverlays(), 100);
    } catch (error) {
      console.error('Error loading colors:', error);
      showMessage('error', 'Failed to load colors');
    } finally {
      setLoadingColors(false);
    }
  };

  const closeColorManagement = () => {
    setShowColorModal(false);
    setCurrentColorProduct(null);
    setAllColors([]);
    setAssignedColors([]);
  };

  const toggleColorFamily = (family) => {
    setExpandedColorFamilies(prev =>
      prev.includes(family)
        ? prev.filter(f => f !== family)
        : [...prev, family]
    );
  };

  const isColorAssigned = (colorId) => {
    return assignedColors.some(ac => ac.apparel_color_id === colorId);
  };

  const handleColorToggle = async (color) => {
    if (!currentColorProduct) return;

    try {
      if (isColorAssigned(color.id)) {
        // Remove color
        const { error } = await removeColorFromProduct(currentColorProduct.id, color.id);
        if (error) throw error;
        setAssignedColors(prev => prev.filter(ac => ac.apparel_color_id !== color.id));
        showMessage('success', `Removed ${color.color_name}`);
      } else {
        // Add color
        const { data, error } = await assignColorToProduct(currentColorProduct.id, color.id);
        if (error) throw error;
        setAssignedColors(prev => [...prev, { ...data, apparel_colors: color }]);
        showMessage('success', `Added ${color.color_name}`);
      }
    } catch (error) {
      console.error('Error toggling color:', error);
      showMessage('error', `Failed to update color: ${error.message}`);
    }
  };

  const handleSelectAllColors = async (family) => {
    if (!currentColorProduct) return;

    const familyColors = allColors.filter(c => c.color_family === family);
    const unassignedColors = familyColors.filter(c => !isColorAssigned(c.id));

    if (unassignedColors.length === 0) {
      showMessage('info', 'All colors in this family are already assigned');
      return;
    }

    try {
      const colorIds = unassignedColors.map(c => c.id);
      const { data, error } = await assignMultipleColors(currentColorProduct.id, colorIds);
      if (error) throw error;

      const newAssignments = data.map((assignment, index) => ({
        ...assignment,
        apparel_colors: unassignedColors[index]
      }));
      setAssignedColors(prev => [...prev, ...newAssignments]);
      showMessage('success', `Added ${unassignedColors.length} colors`);
    } catch (error) {
      console.error('Error assigning colors:', error);
      showMessage('error', `Failed to assign colors: ${error.message}`);
    }
  };

  const handleDeselectAllColors = async (family) => {
    if (!currentColorProduct) return;

    const familyColorIds = allColors.filter(c => c.color_family === family).map(c => c.id);
    const assignedFamilyColors = assignedColors.filter(ac =>
      familyColorIds.includes(ac.apparel_color_id)
    );

    if (assignedFamilyColors.length === 0) {
      showMessage('info', 'No colors in this family are assigned');
      return;
    }

    try {
      for (const assignment of assignedFamilyColors) {
        await removeColorFromProduct(currentColorProduct.id, assignment.apparel_color_id);
      }
      setAssignedColors(prev =>
        prev.filter(ac => !familyColorIds.includes(ac.apparel_color_id))
      );
      showMessage('success', `Removed ${assignedFamilyColors.length} colors`);
    } catch (error) {
      console.error('Error removing colors:', error);
      showMessage('error', `Failed to remove colors: ${error.message}`);
    }
  };

  const handleQuickAssignStandard = async () => {
    if (!currentColorProduct) return;

    try {
      const { data: standardColors, error } = await getStandardColorSet();
      if (error) throw error;

      const unassignedColors = standardColors.filter(c => !isColorAssigned(c.id));
      if (unassignedColors.length === 0) {
        showMessage('info', 'All standard colors are already assigned');
        return;
      }

      const colorIds = unassignedColors.map(c => c.id);
      const { data: assignments, error: assignError } = await assignMultipleColors(currentColorProduct.id, colorIds);
      if (assignError) throw assignError;

      const newAssignments = assignments.map((assignment, index) => ({
        ...assignment,
        apparel_colors: unassignedColors[index]
      }));
      setAssignedColors(prev => [...prev, ...newAssignments]);
      showMessage('success', `Added ${unassignedColors.length} standard colors`);
    } catch (error) {
      console.error('Error assigning standard colors:', error);
      showMessage('error', `Failed to assign standard colors: ${error.message}`);
    }
  };

  const handleCopyColors = async (sourceProductId) => {
    if (!currentColorProduct) return;

    try {
      const { data, error } = await copyColorsFromProduct(sourceProductId, currentColorProduct.id);
      if (error) throw error;

      // Reload assigned colors
      const { data: updatedColors, error: reloadError } = await getProductColors(currentColorProduct.id);
      if (reloadError) throw reloadError;
      setAssignedColors(updatedColors || []);

      showMessage('success', `Copied ${data.length} colors`);
      setShowCopyColorsModal(false);
    } catch (error) {
      console.error('Error copying colors:', error);
      showMessage('error', `Failed to copy colors: ${error.message}`);
    }
  };

  const handlePhotoUpload = async (colorId, colorName, view, file) => {
    if (!currentColorProduct || !file) return;

    setUploadingPhoto(`${colorId}-${view}`);
    try {
      console.log('[ProductManager] Uploading photo:', {
        colorName,
        view,
        originalSize: `${(file.size / 1024).toFixed(2)} KB`
      });

      // Compress image if needed (max 2000px width)
      // CRITICAL: Preserves PNG transparency by auto-detecting format
      let fileToUpload = file;
      if (needsCompression(file, 500)) {
        console.log('[ProductManager] Compressing image before upload...');
        console.log('[ProductManager] File type:', file.type, '(will preserve format)');
        fileToUpload = await compressImage(file, {
          maxWidth: 2000,
          maxHeight: 2000
          // Note: quality and outputFormat auto-detected by compressImage
          // PNG: quality=1.0, format='image/png' (preserves transparency)
          // JPEG: quality=0.9, format='image/jpeg' (standard compression)
        });
        console.log('[ProductManager] Compression complete:', {
          newSize: `${(fileToUpload.size / 1024).toFixed(2)} KB`,
          savings: `${((1 - fileToUpload.size / file.size) * 100).toFixed(1)}%`,
          finalType: fileToUpload.type
        });
      }

      const { data, error } = await uploadColorPhoto(
        currentColorProduct.id,
        colorId,
        view,
        fileToUpload,
        currentColorProduct.product_key,
        colorName
      );
      if (error) throw error;

      // Update assigned colors with new photo info
      setAssignedColors(prev =>
        prev.map(ac =>
          ac.apparel_color_id === colorId ? data : ac
        )
      );
      showMessage('success', `${view} photo uploaded successfully`);
    } catch (error) {
      console.error('Error uploading photo:', error);
      showMessage('error', `Failed to upload photo: ${error.message}`);
    } finally {
      setUploadingPhoto(null);
    }
  };

  // Load overlays for the current product
  const loadOverlays = async () => {
    if (!currentColorProduct) return;

    setLoadingOverlays(true);
    try {
      const { data, error } = await listOverlayImages(currentColorProduct.product_key);
      if (error) throw error;

      // Parse overlay filenames to extract details
      const parsedOverlays = data.map(file => {
        // Pattern: {color}-{view}-{overlayType}.png
        const nameParts = file.name.replace('.png', '').split('-');
        const overlayType = nameParts.slice(2).join('-'); // Everything after color-view

        return {
          name: file.name,
          color: nameParts[0],
          view: nameParts[1],
          overlayType: overlayType,
          url: `${supabase.storage.from('product-templates').getPublicUrl(currentColorProduct.product_key + '/' + file.name).data.publicUrl}`,
          path: `${currentColorProduct.product_key}/${file.name}`,
          size: file.metadata?.size,
          createdAt: file.created_at
        };
      });

      setOverlays(parsedOverlays);
      console.log('[ProductManager] Loaded', parsedOverlays.length, 'overlays');
    } catch (error) {
      console.error('Error loading overlays:', error);
      showMessage('error', `Failed to load overlays: ${error.message}`);
    } finally {
      setLoadingOverlays(false);
    }
  };

  // Handle overlay upload
  const handleOverlayUpload = async (file) => {
    if (!currentColorProduct || !selectedOverlayColor || !file) {
      showMessage('error', 'Please select a color, view, and overlay type');
      return;
    }

    const colorName = allColors.find(c => c.id === selectedOverlayColor)?.color_name;
    if (!colorName) {
      showMessage('error', 'Color not found');
      return;
    }

    setUploadingOverlay(`${selectedOverlayColor}-${selectedOverlayView}-${selectedOverlayType}`);
    try {
      console.log('[ProductManager] Uploading overlay:', {
        productKey: currentColorProduct.product_key,
        colorName,
        view: selectedOverlayView,
        overlayType: selectedOverlayType,
        originalSize: `${(file.size / 1024).toFixed(2)} KB`
      });

      // Validate file is PNG
      if (!file.type.includes('png')) {
        showMessage('warning', 'Overlay images should be PNG format for transparency');
      }

      // Compress if needed
      let fileToUpload = file;
      if (needsCompression(file, 500)) {
        console.log('[ProductManager] Compressing overlay image...');
        fileToUpload = await compressImage(file, {
          maxWidth: 2000,
          maxHeight: 2000
        });
        console.log('[ProductManager] Compression complete:', {
          newSize: `${(fileToUpload.size / 1024).toFixed(2)} KB`,
          savings: `${((1 - fileToUpload.size / file.size) * 100).toFixed(1)}%`
        });
      }

      const { data, error } = await uploadOverlayImage(
        currentColorProduct.product_key,
        colorName,
        selectedOverlayView,
        selectedOverlayType,
        fileToUpload
      );
      if (error) throw error;

      showMessage('success', `Overlay uploaded successfully`);

      // Reload overlays
      await loadOverlays();
    } catch (error) {
      console.error('Error uploading overlay:', error);
      showMessage('error', `Failed to upload overlay: ${error.message}`);
    } finally {
      setUploadingOverlay(null);
    }
  };

  // Handle overlay deletion
  const handleDeleteOverlay = async (overlayPath) => {
    if (!confirm('Are you sure you want to delete this overlay?')) return;

    try {
      const { error } = await deleteOverlayImage(overlayPath);
      if (error) throw error;

      showMessage('success', 'Overlay deleted successfully');

      // Reload overlays
      await loadOverlays();
    } catch (error) {
      console.error('Error deleting overlay:', error);
      showMessage('error', `Failed to delete overlay: ${error.message}`);
    }
  };

  const getFilteredProducts = () => {
    if (productTypeFilter === 'All Products') {
      return products;
    }
    return products.filter(p =>
      p.name.toLowerCase().includes(productTypeFilter.toLowerCase().replace('-', ' '))
    );
  };

  // Canvas Operations
  const loadTemplateOnCanvas = (templateUrl) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !templateUrl) {
      console.log('[Canvas] Cannot load template:', { canvas: !!canvas, templateUrl });
      return;
    }

    // Verify canvas context is available
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('[Canvas] Canvas context is null, cannot render');
      showMessage('error', 'Canvas not ready. Please try again.');
      return;
    }

    console.log('[Canvas] Loading template:', templateUrl);
    console.log('[Canvas] Canvas element:', canvas.getElement());
    console.log('[Canvas] Canvas context:', ctx);

    canvas.clear();

    fabric.Image.fromURL(templateUrl, (img) => {
      // Re-check canvas still exists when callback fires
      const currentCanvas = fabricCanvasRef.current;
      if (!currentCanvas) {
        console.error('[Canvas] Canvas disposed before image loaded');
        return;
      }

      if (img && img._element) {
        console.log('[Canvas] Image loaded successfully:', img.width, 'x', img.height);

        try {
          const CANVAS_WIDTH = 800;
          const CANVAS_HEIGHT = 800;
          const scale = Math.min(CANVAS_WIDTH / img.width, CANVAS_HEIGHT / img.height);
          img.scale(scale);

          const scaledWidth = img.width * scale;
          const scaledHeight = img.height * scale;
          const centerX = (CANVAS_WIDTH - scaledWidth) / 2;
          const centerY = (CANVAS_HEIGHT - scaledHeight) / 2;

          // Diagnostic logging
          console.log('=== PRODUCT MANAGER IMAGE DIAGNOSTICS ===');
          console.log('Template URL:', templateUrl);
          console.log('Natural image size:', img.width, 'x', img.height);
          console.log('Canvas size:', CANVAS_WIDTH, 'x', CANVAS_HEIGHT);
          console.log('Scale factor:', scale);
          console.log('Scaled image size:', scaledWidth, 'x', scaledHeight);
          console.log('Image position:', { left: centerX, top: centerY });
          console.log('==========================================');

          img.set({
            left: centerX,
            top: centerY,
            selectable: false,
            evented: false,
            id: 'productTemplate'
          });

          currentCanvas.add(img);
          currentCanvas.sendToBack(img);
          loadPrintAreasOnCanvas();
          updateGridOverlay();
          currentCanvas.renderAll();
          console.log('[Canvas] Template rendered on canvas');
        } catch (error) {
          console.error('[Canvas] Error rendering image:', error);
          showMessage('error', `Failed to render template: ${error.message}`);
        }
      } else {
        console.error('[Canvas] Failed to load image - invalid image data');
        showMessage('error', 'Failed to load template image');
      }
    }, { crossOrigin: 'anonymous' });
  };

  const loadPrintAreasOnCanvas = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // Remove existing print areas
    const existing = canvas.getObjects().filter(obj =>
      obj.type === 'printArea' || obj.type === 'printAreaLabel'
    );
    existing.forEach(obj => canvas.remove(obj));

    // Get template image scale
    const templateImage = canvas.getObjects().find(o => o.id === 'productTemplate');
    const currentScale = templateImage ? templateImage.scaleX : 1;

    // Calculate canvas offset
    const imageActualWidth = templateImage.width * templateImage.scaleX;
    const imageActualHeight = templateImage.height * templateImage.scaleY;
    const canvasOffsetX = (canvas.width - imageActualWidth) / 2;
    const canvasOffsetY = (canvas.height - imageActualHeight) / 2;

    console.log('[ProductManager] Loading print areas with scale:', currentScale);
    console.log('[ProductManager] Canvas offset:', { x: canvasOffsetX, y: canvasOffsetY });

    // Get print areas for current variant and view
    const variantKey = `${currentVariantIndex}_${currentView}`;
    const areas = printAreas[variantKey] || {};

    Object.entries(areas).forEach(([key, area]) => {
      // CRITICAL FIX: Scale coordinates UP and ADD canvas offset
      // 1. Scale up from full image size to scaled image size
      // 2. Add canvas offset to position correctly on canvas
      const scaledX = Math.round(area.x * currentScale) + canvasOffsetX;
      const scaledY = Math.round(area.y * currentScale) + canvasOffsetY;

      console.log('[ProductManager] Loading print area:', area.name, {
        dbCoords: { x: area.x, y: area.y },
        scale: currentScale,
        imageRelativeCoords: { x: Math.round(area.x * currentScale), y: Math.round(area.y * currentScale) },
        canvasOffset: { x: canvasOffsetX, y: canvasOffsetY },
        finalCanvasCoords: { x: scaledX, y: scaledY }
      });

      let shape;

      // Create shape based on area.shape
      if (area.shape === 'circle') {
        const scaledRadius = Math.round((area.radius || area.width / 2) * currentScale);
        shape = new fabric.Circle({
          left: scaledX,
          top: scaledY,
          radius: scaledRadius,
          fill: 'rgba(59, 130, 246, 0.2)',
          stroke: '#3b82f6',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          cornerColor: '#3b82f6',
          cornerSize: 8,
          id: `printArea_${key}`,
          type: 'printArea',
          printAreaKey: key,
          printAreaName: area.name,
          printAreaShape: 'circle'
        });
      } else if (area.shape === 'ellipse') {
        const scaledRx = Math.round((area.rx || area.width / 2) * currentScale);
        const scaledRy = Math.round((area.ry || area.height / 2) * currentScale);
        shape = new fabric.Ellipse({
          left: scaledX,
          top: scaledY,
          rx: scaledRx,
          ry: scaledRy,
          fill: 'rgba(59, 130, 246, 0.2)',
          stroke: '#3b82f6',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          cornerColor: '#3b82f6',
          cornerSize: 8,
          id: `printArea_${key}`,
          type: 'printArea',
          printAreaKey: key,
          printAreaName: area.name,
          printAreaShape: 'ellipse'
        });
      } else {
        // Default to rectangle
        const scaledWidth = Math.round(area.width * currentScale);
        const scaledHeight = Math.round(area.height * currentScale);
        shape = new fabric.Rect({
          left: scaledX,
          top: scaledY,
          width: scaledWidth,
          height: scaledHeight,
          fill: 'rgba(59, 130, 246, 0.2)',
          stroke: '#3b82f6',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          cornerColor: '#3b82f6',
          cornerSize: 8,
          id: `printArea_${key}`,
          type: 'printArea',
          printAreaKey: key,
          printAreaName: area.name,
          printAreaShape: 'rectangle'
        });
      }

      const label = new fabric.Text(area.name, {
        left: scaledX + 5,
        top: scaledY - 25,
        fontSize: 14,
        fill: '#3b82f6',
        fontWeight: 'bold',
        selectable: false,
        evented: false,
        id: `printAreaLabel_${key}`,
        type: 'printAreaLabel'
      });

      canvas.add(shape);
      canvas.add(label);
    });

    canvas.renderAll();
  };

  const handlePrintAreaMoving = (e) => {
    const obj = e.target;
    const canvas = fabricCanvasRef.current;
    if (!canvas || obj.type !== 'printArea') return;

    const key = obj.printAreaKey;
    const label = canvas.getObjects().find(o => o.id === `printAreaLabel_${key}`);
    if (label) {
      label.set({ left: obj.left + 5, top: obj.top - 25 });
    }

    canvas.renderAll();
  };

  const handlePrintAreaModified = (e) => {
    const obj = e.target;
    const canvas = fabricCanvasRef.current;
    if (!canvas || obj.type !== 'printArea') return;

    const key = obj.printAreaKey;
    const variantKey = `${currentVariantIndex}_${currentView}`;

    const updatedArea = {
      name: obj.printAreaName,
      x: Math.round(obj.left),
      y: Math.round(obj.top),
      width: Math.round(obj.width * obj.scaleX),
      height: Math.round(obj.height * obj.scaleY),
      maxWidth: Math.round(obj.width * obj.scaleX),
      maxHeight: Math.round(obj.height * obj.scaleY),
      shape: 'rectangle'
    };

    setPrintAreas(prev => ({
      ...prev,
      [variantKey]: {
        ...(prev[variantKey] || {}),
        [key]: updatedArea
      }
    }));

    // Reset scale
    obj.set({ scaleX: 1, scaleY: 1, width: updatedArea.width, height: updatedArea.height });

    // Update label
    const label = canvas.getObjects().find(o => o.id === `printAreaLabel_${key}`);
    if (label) {
      label.set({ left: obj.left + 5, top: obj.top - 25 });
    }

    canvas.renderAll();
  };

  const nudgePrintArea = (direction, distance = 1) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const activeObject = canvas.getActiveObject();
    if (!activeObject || activeObject.type !== 'printArea') return;

    const currentLeft = activeObject.left || 0;
    const currentTop = activeObject.top || 0;

    switch (direction) {
      case 'up':
        activeObject.set('top', currentTop - distance);
        break;
      case 'down':
        activeObject.set('top', currentTop + distance);
        break;
      case 'left':
        activeObject.set('left', currentLeft - distance);
        break;
      case 'right':
        activeObject.set('left', currentLeft + distance);
        break;
      case 'up-left':
        activeObject.set({
          left: currentLeft - distance,
          top: currentTop - distance
        });
        break;
      case 'up-right':
        activeObject.set({
          left: currentLeft + distance,
          top: currentTop - distance
        });
        break;
      case 'down-left':
        activeObject.set({
          left: currentLeft - distance,
          top: currentTop + distance
        });
        break;
      case 'down-right':
        activeObject.set({
          left: currentLeft + distance,
          top: currentTop + distance
        });
        break;
    }

    activeObject.setCoords();
    canvas.renderAll();

    // Update the print area data
    const variantKey = `${currentVariantIndex}_${currentView}`;
    const printAreaKey = activeObject.printAreaKey;

    if (printAreas[variantKey]?.[printAreaKey]) {
      const updatedPrintArea = { ...printAreas[variantKey][printAreaKey] };
      updatedPrintArea.x = Math.round(activeObject.left);
      updatedPrintArea.y = Math.round(activeObject.top);

      setPrintAreas({
        ...printAreas,
        [variantKey]: {
          ...printAreas[variantKey],
          [printAreaKey]: updatedPrintArea
        }
      });
    }
  };

  const addPrintArea = () => {
    if (!newAreaName.trim()) {
      showMessage('error', 'Please enter a print area name');
      return;
    }

    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      console.error('[Print Area] Canvas not available');
      return;
    }

    const variantKey = `${currentVariantIndex}_${currentView}`;
    const key = newAreaName.toLowerCase().replace(/\s+/g, '_');

    if (printAreas[variantKey]?.[key]) {
      showMessage('error', 'Print area with this name already exists');
      return;
    }

    console.log('[Print Area] Creating shape:', selectedShape);
    console.log('[Print Area] Canvas objects before add:', canvas.getObjects().length);

    // Create Fabric.js shape object
    let shape;
    let newArea;

    if (selectedShape === 'circle') {
      shape = new fabric.Circle({
        left: 300,
        top: 300,
        radius: 100,
        fill: 'rgba(59, 130, 246, 0.2)',
        stroke: '#3b82f6',
        strokeWidth: 2,
        strokeDashArray: [5, 5],
        cornerColor: '#3b82f6',
        cornerSize: 12,
        transparentCorners: false,
        hasControls: true,
        hasBorders: true,
        lockRotation: true,
        id: `printArea_${key}`,
        type: 'printArea',
        printAreaKey: key,
        printAreaName: newAreaName,
        printAreaShape: 'circle'
      });

      newArea = {
        name: newAreaName,
        x: 300,
        y: 300,
        width: 200,
        height: 200,
        radius: 100,
        maxWidth: 200,
        maxHeight: 200,
        shape: 'circle'
      };
    } else if (selectedShape === 'ellipse') {
      shape = new fabric.Ellipse({
        left: 250,
        top: 300,
        rx: 150,
        ry: 100,
        fill: 'rgba(59, 130, 246, 0.2)',
        stroke: '#3b82f6',
        strokeWidth: 2,
        strokeDashArray: [5, 5],
        cornerColor: '#3b82f6',
        cornerSize: 12,
        transparentCorners: false,
        hasControls: true,
        hasBorders: true,
        lockRotation: true,
        id: `printArea_${key}`,
        type: 'printArea',
        printAreaKey: key,
        printAreaName: newAreaName,
        printAreaShape: 'ellipse'
      });

      newArea = {
        name: newAreaName,
        x: 250,
        y: 300,
        width: 300,
        height: 200,
        rx: 150,
        ry: 100,
        maxWidth: 300,
        maxHeight: 200,
        shape: 'ellipse'
      };
    } else {
      // Use preset dimensions if a preset is selected
      let rectLeft = 200;
      let rectTop = 200;
      let rectWidth = 200;
      let rectHeight = 200;
      let width_mm = null;
      let height_mm = null;

      if (selectedPreset !== 'custom' && PRINT_AREA_PRESETS[selectedPreset]) {
        const preset = PRINT_AREA_PRESETS[selectedPreset];
        rectWidth = preset.width;
        rectHeight = preset.height;
        width_mm = preset.width_mm;
        height_mm = preset.height_mm;

        // Position based on preset type
        const centerX = 400; // Canvas center
        const centerY = 400;

        switch (selectedPreset) {
          // Apparel print areas
          case 'center_chest':
          case 'center_back':
            rectLeft = centerX - rectWidth / 2;
            rectTop = centerY - rectHeight / 2;
            break;
          case 'left_breast_pocket':
            rectLeft = 150;
            rectTop = 100;
            break;
          case 'right_breast_pocket':
            rectLeft = 570;
            rectTop = 100;
            break;
          case 'left_sleeve':
            rectLeft = 50;
            rectTop = 300;
            break;
          case 'right_sleeve':
            rectLeft = 650;
            rectTop = 300;
            break;
          // Generic print areas (centered)
          case 'front_print':
          case 'back_print':
          case 'top_print':
          case 'bottom_print':
            rectLeft = centerX - rectWidth / 2;
            rectTop = centerY - rectHeight / 2;
            break;
          case 'side_print':
            rectLeft = centerX - rectWidth / 2 + 100;
            rectTop = centerY - rectHeight / 2;
            break;
          default:
            rectLeft = centerX - rectWidth / 2;
            rectTop = centerY - rectHeight / 2;
        }
      }

      shape = new fabric.Rect({
        left: rectLeft,
        top: rectTop,
        width: rectWidth,
        height: rectHeight,
        fill: 'rgba(59, 130, 246, 0.2)',
        stroke: '#3b82f6',
        strokeWidth: 2,
        strokeDashArray: [5, 5],
        cornerColor: '#3b82f6',
        cornerSize: 12,
        transparentCorners: false,
        hasControls: true,
        hasBorders: true,
        lockRotation: true,
        id: `printArea_${key}`,
        type: 'printArea',
        printAreaKey: key,
        printAreaName: newAreaName,
        printAreaShape: 'rectangle'
      });

      newArea = {
        name: newAreaName,
        x: rectLeft,
        y: rectTop,
        width: rectWidth,
        height: rectHeight,
        maxWidth: rectWidth,
        maxHeight: rectHeight,
        width_mm: width_mm,
        height_mm: height_mm,
        shape: 'rectangle'
      };
    }

    // Add label
    const label = new fabric.Text(newAreaName, {
      left: newArea.x + 5,
      top: newArea.y - 25,
      fontSize: 14,
      fill: '#3b82f6',
      fontWeight: 'bold',
      selectable: false,
      evented: false,
      id: `printAreaLabel_${key}`,
      type: 'printAreaLabel'
    });

    // Add to canvas
    canvas.add(shape);
    canvas.add(label);
    canvas.setActiveObject(shape);
    canvas.renderAll();

    console.log('[Print Area] Canvas objects after add:', canvas.getObjects().length);
    console.log('[Print Area] Shape added:', shape);

    // Get template image info for diagnostics
    const templateImage = canvas.getObjects().find(o => o.id === 'productTemplate');
    const currentScale = templateImage ? templateImage.scaleX : 1;

    // CRITICAL FIX: Account for canvas offset, then unscale
    // Calculate canvas offset
    const imageActualWidth = templateImage.width * templateImage.scaleX;
    const imageActualHeight = templateImage.height * templateImage.scaleY;
    const canvasOffsetX = (canvas.width - imageActualWidth) / 2;
    const canvasOffsetY = (canvas.height - imageActualHeight) / 2;

    // Subtract canvas offset to get image-relative coordinates
    const imageRelativeX = newArea.x - canvasOffsetX;
    const imageRelativeY = newArea.y - canvasOffsetY;

    // Now unscale to get coordinates for full-size image
    const unscaledArea = {
      ...newArea,
      x: Math.round(imageRelativeX / currentScale),
      y: Math.round(imageRelativeY / currentScale),
      width: Math.round(newArea.width / currentScale),
      height: Math.round(newArea.height / currentScale),
      maxWidth: Math.round((newArea.maxWidth || newArea.width) / currentScale),
      maxHeight: Math.round((newArea.maxHeight || newArea.height) / currentScale),
      width_mm: null,
      height_mm: null
    };

    // For circles and ellipses, also unscale radius values
    if (selectedShape === 'circle' && newArea.radius) {
      unscaledArea.radius = Math.round(newArea.radius / currentScale);
    } else if (selectedShape === 'ellipse' && newArea.rx && newArea.ry) {
      unscaledArea.rx = Math.round(newArea.rx / currentScale);
      unscaledArea.ry = Math.round(newArea.ry / currentScale);
    }

    // Diagnostic logging for initial creation
    console.log('=== CREATING NEW PRINT AREA ===');
    console.log('Print Area Name:', newAreaName);
    console.log('Canvas Coordinates:', { x: newArea.x, y: newArea.y, width: newArea.width, height: newArea.height });
    console.log('Canvas offset:', { x: canvasOffsetX, y: canvasOffsetY });
    console.log('Image-relative coords (scaled):', { x: imageRelativeX, y: imageRelativeY });
    console.log('Shape Type:', selectedShape);
    console.log('Current image scale:', currentScale);
    console.log('Unscaled Coordinates (saved to state):', {
      x: unscaledArea.x,
      y: unscaledArea.y,
      width: unscaledArea.width,
      height: unscaledArea.height
    });
    console.log('Template natural size:', templateImage ? { width: templateImage.width, height: templateImage.height } : 'unknown');
    console.log('================================');

    // Update state with UNSCALED coordinates
    setPrintAreas(prev => ({
      ...prev,
      [variantKey]: {
        ...(prev[variantKey] || {}),
        [key]: unscaledArea
      }
    }));

    setNewAreaName('');
    setSelectedPreset('custom');
    setShowNewAreaDialog(false);
  };

  const deletePrintArea = (key) => {
    const variantKey = `${currentVariantIndex}_${currentView}`;
    const areas = { ...(printAreas[variantKey] || {}) };
    delete areas[key];

    setPrintAreas(prev => ({
      ...prev,
      [variantKey]: areas
    }));

    // Remove from canvas
    const canvas = fabricCanvasRef.current;
    if (canvas) {
      const rect = canvas.getObjects().find(obj => obj.id === `printArea_${key}`);
      const label = canvas.getObjects().find(obj => obj.id === `printAreaLabel_${key}`);
      if (rect) canvas.remove(rect);
      if (label) canvas.remove(label);
      canvas.renderAll();
    }
  };

  const handleCopyToAllColors = () => {
    // Get current print areas for the selected variant and view
    const currentKey = `${currentVariantIndex}_${currentView}`;
    const currentPrintAreas = printAreas[currentKey] || {};
    const printAreasArray = Object.entries(currentPrintAreas);

    if (printAreasArray.length === 0) {
      alert('No print areas to copy! Draw a print area first.');
      return;
    }

    // Find all other color variants (different indices, same view)
    const targetVariants = [];
    for (let i = 0; i < colorVariants.length; i++) {
      if (i !== currentVariantIndex) {
        // Check if this variant has the current view configured
        const variant = colorVariants[i];
        if (variant.views && variant.views.includes(currentView)) {
          targetVariants.push(i);
        }
      }
    }

    if (targetVariants.length === 0) {
      alert(`No other color variants found with "${currentView}" view configured.`);
      return;
    }

    // Confirm with user
    const confirmMsg = `Copy ${printAreasArray.length} print area(s) from ${colorVariants[currentVariantIndex].name} (${currentView}) to ${targetVariants.length} other color variant(s)?`;
    if (!confirm(confirmMsg)) {
      return;
    }

    // Copy print areas to each target variant
    const updatedPrintAreas = { ...printAreas };
    let copiedCount = 0;

    for (const targetIndex of targetVariants) {
      const targetKey = `${targetIndex}_${currentView}`;

      // Deep copy the print areas
      const copiedAreas = {};
      for (const [key, area] of printAreasArray) {
        copiedAreas[key] = {
          name: area.name,
          x: area.x,
          y: area.y,
          width: area.width,
          height: area.height,
          maxWidth: area.maxWidth,
          maxHeight: area.maxHeight,
          shape: area.shape || 'rectangle',
          areaKey: area.areaKey || key,
          width_mm: area.width_mm || null,
          height_mm: area.height_mm || null
        };
      }

      updatedPrintAreas[targetKey] = copiedAreas;
      copiedCount++;
    }

    // Update state
    setPrintAreas(updatedPrintAreas);

    // Mark this view as configured for all target variants
    const updatedConfiguredViews = [...configuredViews];
    for (const targetIndex of targetVariants) {
      const viewKey = `${targetIndex}_${currentView}`;
      if (!updatedConfiguredViews.includes(viewKey)) {
        updatedConfiguredViews.push(viewKey);
      }
    }
    setConfiguredViews(updatedConfiguredViews);

    alert(`✅ Copied ${printAreasArray.length} print area(s) to ${copiedCount} color variant(s)!`);
  };

  const updateGridOverlay = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // Remove existing grid
    const existing = canvas.getObjects().filter(obj => obj.id === 'gridOverlay');
    existing.forEach(grid => canvas.remove(grid));

    if (!showGrid) return;

    // Add grid lines
    for (let i = 0; i <= 800; i += gridSize) {
      const vLine = new fabric.Line([i, 0, i, 800], {
        stroke: '#e5e7eb',
        strokeWidth: 1,
        selectable: false,
        evented: false,
        id: 'gridOverlay'
      });
      const hLine = new fabric.Line([0, i, 800, i], {
        stroke: '#e5e7eb',
        strokeWidth: 1,
        selectable: false,
        evented: false,
        id: 'gridOverlay'
      });
      canvas.add(vLine);
      canvas.add(hLine);
      canvas.sendToBack(vLine);
      canvas.sendToBack(hLine);
    }

    canvas.renderAll();
  };

  /**
   * Get template URL from Supabase folder structure for print area configuration
   * Tries WHITE template first (apparel), then falls back to selected color variant (generic products)
   * @param {string} productKey - Product key (e.g., 't-shirts')
   * @param {string} view - View name ('front', 'back', etc.)
   * @param {Array} variants - Color variants array (for fallback)
   * @param {number} variantIndex - Currently selected variant index
   * @returns {Promise<string|null>} Public URL to template image
   */
  const getConfigTemplateUrl = async (productKey, view, variants = [], variantIndex = 0) => {
    if (!productKey) return null;

    // Try 1: Load white template (for apparel products)
    const whiteFileName = `white-${view}.png`;
    const whitePath = `${productKey}/${whiteFileName}`;

    console.log('[Config Template] Trying white template:', whitePath);

    const { data: whiteData } = supabase.storage
      .from('product-templates')
      .getPublicUrl(whitePath);

    // Check if white template exists
    try {
      const response = await fetch(whiteData.publicUrl, { method: 'HEAD' });
      if (response.ok) {
        console.log('[Config Template] ✅ Using white template:', whiteData.publicUrl);
        return whiteData.publicUrl;
      }
    } catch (e) {
      console.log('[Config Template] White template not found, trying fallback...');
    }

    // Try 2: Fallback to selected color variant (for generic products like bags)
    if (variants && variants.length > 0 && variantIndex < variants.length) {
      const selectedVariant = variants[variantIndex];

      // Try using viewUrls first (if available)
      if (selectedVariant.viewUrls && selectedVariant.viewUrls[view]) {
        console.log('[Config Template] ✅ Using variant viewUrl:', selectedVariant.viewUrls[view]);
        return selectedVariant.viewUrls[view];
      }

      // Build URL from variant name
      if (selectedVariant.name) {
        const variantFileName = `${selectedVariant.name.toLowerCase().replace(/\s+/g, '-')}-${view}.png`;
        const variantPath = `${productKey}/${variantFileName}`;

        const { data: variantData } = supabase.storage
          .from('product-templates')
          .getPublicUrl(variantPath);

        console.log('[Config Template] ✅ Using variant template:', variantData.publicUrl);
        return variantData.publicUrl;
      }
    }

    console.warn('[Config Template] ❌ No template found for:', productKey, view);
    return null;
  };

  // Load template when variant or view changes
  useEffect(() => {
    const loadTemplate = async () => {
      if (currentStep === 3 && fabricCanvasRef.current && productKey) {
        // Try white template first, fallback to selected color variant
        const templateUrl = await getConfigTemplateUrl(productKey, currentView, colorVariants, currentVariantIndex);

        if (templateUrl) {
          console.log('[Config] Loading template for view:', currentView, 'variant:', currentVariantIndex);
          loadTemplateOnCanvas(templateUrl);
        } else {
          console.warn('[Config] No template URL available for:', productKey, currentView);
        }
      }
    };

    loadTemplate();
  }, [currentStep, currentView, productKey, colorVariants, currentVariantIndex]);

  // Update grid when settings change
  useEffect(() => {
    if (fabricCanvasRef.current) {
      updateGridOverlay();
    }
  }, [showGrid, gridSize]);

  // Navigation
  const canGoNext = () => {
    if (currentStep === 1) {
      return productName && productKey && basePrice;
    }
    if (currentStep === 2) {
      // Check that each variant has a name, color code, and at least one view uploaded
      return colorVariants.every(v =>
        v.name &&
        v.colorCode &&
        (v.viewUrls?.front || v.viewUrls?.back || v.viewUrls?.top)
      );
    }
    return true;
  };

  const goToStep = (step) => {
    if (step > currentStep && !canGoNext()) {
      showMessage('error', 'Please complete current step before proceeding');
      return;
    }
    setCurrentStep(step);
  };

  // Mark current view as configured
  const markCurrentViewAsConfigured = async () => {
    console.log('═══ SAVE PRINT AREAS (Save This View) ═══');

    const currentVariant = colorVariants[currentVariantIndex];
    const viewKey = `${currentVariant.id}_${currentView}`;

    // Get print areas for current view
    const variantKey = `${currentVariantIndex}_${currentView}`;
    const areas = printAreas[variantKey] || {};
    const areasArray = Object.entries(areas).map(([key, area]) => ({
      name: area.name,
      area_key: key,
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      max_width: area.maxWidth || area.width,
      max_height: area.maxHeight || area.height,
      width_mm: area.width_mm,
      height_mm: area.height_mm,
      shape: area.shape || 'rectangle'
    }));

    console.log('Product Key:', productKey);
    console.log('Current View:', currentView);
    console.log('Print Areas to Save:', areasArray);

    if (areasArray.length === 0) {
      showMessage('warning', 'No print areas defined for this view');
      console.log('═══ SAVE SKIPPED (no print areas) ═══');
      return;
    }

    // We need a product ID to save. If editing, we have it. If new, we need to create product first.
    if (!editingProductId) {
      showMessage('warning', 'Please save the product first before saving print areas');
      console.log('═══ SAVE SKIPPED (no product ID) ═══');
      return;
    }

    try {
      console.log('[markCurrentViewAsConfigured] Saving print areas for product:', editingProductId);

      // Delete existing print areas for this product THAT MATCH THE AREA_KEYS WE'RE ABOUT TO INSERT
      // This is safer than deleting by view since area_key contains the specific area identifier
      const areaKeysToDelete = areasArray.map(a => a.area_key);
      console.log('[markCurrentViewAsConfigured] Deleting areas with keys:', areaKeysToDelete);

      for (const areaKey of areaKeysToDelete) {
        const { error: deleteError } = await supabase
          .from('print_areas')
          .delete()
          .eq('product_template_id', editingProductId)
          .eq('area_key', areaKey);

        if (deleteError) {
          console.error('[markCurrentViewAsConfigured] Delete error for area_key', areaKey, ':', deleteError);
        }
      }

      console.log('[markCurrentViewAsConfigured] ✅ Deleted old print areas');

      // Insert new print areas using createPrintAreaForView
      for (const area of areasArray) {
        const result = await createPrintAreaForView(editingProductId, currentView, area);
        console.log('[markCurrentViewAsConfigured] Inserted print area:', area.name, 'with area_key:', area.area_key);
      }

      console.log('[markCurrentViewAsConfigured] ✅ All', areasArray.length, 'print areas saved successfully');

      if (!configuredViews.includes(viewKey)) {
        setConfiguredViews(prev => [...prev, viewKey]);
      }

      showMessage('success', `Print areas saved for ${currentVariant.name} - ${currentView}`);
      console.log('═══ SAVE COMPLETE ═══');

    } catch (error) {
      console.error('[markCurrentViewAsConfigured] Save error:', error);
      showMessage('error', `Failed to save print areas: ${error.message}`);
      console.log('═══ SAVE FAILED ═══');
    }
  };

  // Save Product Info (Step 1 only)
  const handleSaveProductInfo = async () => {
    try {
      setSaving(true);

      console.log('[handleSaveProductInfo] Saving:', {
        minOrderQty,
        parsed: parseInt(minOrderQty, 10)
      });

      const { data, error } = await supabase
        .from('product_templates')
        .update({
          name: productName,
          product_key: productKey,
          category: category,
          base_price: parseFloat(basePrice),
          minimum_order_quantity: parseInt(minOrderQty, 10),
          description: description
        })
        .eq('id', editingProductId);

      if (error) throw error;
      showMessage('success', 'Product info saved successfully!');
      console.log('[handleSaveProductInfo] Save successful');
    } catch (error) {
      console.error('Error saving product info:', error);
      showMessage('error', `Failed to save product info: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Save Colors (Step 2 only)
  const handleSaveColors = async () => {
    try {
      setSaving(true);
      // Delete existing colors
      await supabase
        .from('product_colors')
        .delete()
        .eq('product_template_id', editingProductId);

      // Insert new colors
      const colorInserts = assignedColors.map(color => ({
        product_template_id: editingProductId,
        apparel_color_id: color.id
      }));

      if (colorInserts.length > 0) {
        const { error } = await supabase
          .from('product_colors')
          .insert(colorInserts);

        if (error) throw error;
      }
      showMessage('success', 'Colors saved successfully!');
    } catch (error) {
      console.error('Error saving colors:', error);
      showMessage('error', `Failed to save colors: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Save Print Areas (Step 3 only)
  const handleSavePrintAreas = async () => {
    try {
      setSaving(true);
      // Delete existing print areas
      await supabase
        .from('print_areas')
        .delete()
        .eq('product_template_id', editingProductId);

      // Convert printAreas object to array and insert new print areas
      const printAreasArray = Object.entries(printAreas).flatMap(([view, areas]) => {
        // Ensure areas is always an array (it might be an object)
        const areasArray = Array.isArray(areas) ? areas : (areas ? [areas] : []);
        return areasArray.map(area => ({
          product_template_id: editingProductId,
          area_key: area.area_key,
          name: area.name,
          x: area.x,
          y: area.y,
          width: area.width,
          height: area.height,
          max_width: area.max_width,
          max_height: area.max_height,
          shape: area.shape,
          width_mm: area.width_mm,
          height_mm: area.height_mm
        }));
      });

      if (printAreasArray.length > 0) {
        const { error } = await supabase
          .from('print_areas')
          .insert(printAreasArray);

        if (error) throw error;
      }

      showMessage('success', 'Print areas saved successfully!');
    } catch (error) {
      console.error('Error saving print areas:', error);
      showMessage('error', `Failed to save print areas: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Save Product
  const saveProduct = async () => {
    setSaving(true);
    try {
      // Step 1: Create/Update product template
      const productData = {
        productKey,
        name: productName,
        templateUrl: colorVariants[0]?.templateUrl || '',
        colors: colorVariants.map(v => v.colorCode),
        basePrice: parseFloat(basePrice),
        category,
        description,
        minOrderQty: parseInt(minOrderQty)
      };

      let template;
      if (editingProductId) {
        template = await updateProductTemplate(productKey, productData);
      } else {
        template = await createProductTemplate(productData);
      }

      console.log('Product template saved:', template);

      // Step 2: Save color variants with views and print areas
      console.log('[saveProduct] Step 2: Saving variants and print areas');

      for (const variant of colorVariants) {
        for (const view of variant.views) {
          // Get view-specific URL if available, fallback to general templateUrl
          const viewSpecificUrl = variant.viewUrls?.[view] || variant.templateUrl;

          // Upsert variant
          const variantData = await upsertProductVariant(
            template.id,
            variant.colorCode,
            view,
            {
              colorName: variant.name,
              templateUrl: viewSpecificUrl  // Use view-specific URL
            }
          );

          console.log('[saveProduct] Variant saved:', variantData, 'URL:', viewSpecificUrl);
        }
      }

      // Step 3: Save print areas (view-based, not variant-based)
      console.log('═══ STEP 3: SAVING PRINT AREAS ═══');

      // CRITICAL: Delete ALL existing print areas for this product FIRST
      console.log('[saveProduct] Deleting ALL existing print areas for product:', template.id);

      const { data: existingAreas, error: checkError } = await supabase
        .from('print_areas')
        .select('id')
        .eq('product_template_id', template.id);

      console.log('[saveProduct] Found', existingAreas?.length || 0, 'existing print areas');

      const { error: deleteAllError } = await supabase
        .from('print_areas')
        .delete()
        .eq('product_template_id', template.id);

      if (deleteAllError) {
        console.error('[saveProduct] Delete ALL error:', deleteAllError);
      } else {
        console.log('[saveProduct] ✅ Deleted all old print areas');
      }

      // Collect all unique views that have print areas
      const viewsToSave = new Set();
      for (const variantKey in printAreas) {
        const [variantIndex, view] = variantKey.split('_');
        viewsToSave.add(view);
      }

      console.log('[saveProduct] Views with print areas:', Array.from(viewsToSave));

      let totalPrintAreasInserted = 0;

      // Save print areas for each view
      for (const view of viewsToSave) {
        // Get print areas for this view (from first variant that has them)
        let areas = null;
        for (const variantKey in printAreas) {
          if (variantKey.endsWith(`_${view}`)) {
            areas = printAreas[variantKey];
            break;
          }
        }

        if (areas && Object.keys(areas).length > 0) {
          console.log(`[saveProduct] Saving ${Object.keys(areas).length} print areas for view:`, view);

          // Insert new print areas
          for (const [key, area] of Object.entries(areas)) {
            const areaData = {
              name: area.name,
              area_key: key,
              x: area.x,
              y: area.y,
              width: area.width,
              height: area.height,
              max_width: area.maxWidth || area.width,
              max_height: area.maxHeight || area.height,
              width_mm: area.width_mm,
              height_mm: area.height_mm,
              shape: area.shape || 'rectangle'
            };

            const result = await createPrintAreaForView(template.id, view, areaData);
            totalPrintAreasInserted++;
            console.log('[saveProduct] Inserted print area:', area.name, 'with area_key:', key);
          }

          console.log(`[saveProduct] ✅ Saved ${Object.keys(areas).length} print areas for view: ${view}`);
        }
      }

      console.log('═══ PRINT AREAS SAVE COMPLETE ═══');
      console.log('[saveProduct] Total print areas inserted:', totalPrintAreasInserted);
      console.log('═══════════════════════════════════');

      showMessage('success', 'Product saved successfully!');
      setTimeout(() => {
        setViewMode('list');
        loadProducts();
      }, 1500);

    } catch (error) {
      console.error('Error saving product:', error);
      showMessage('error', `Failed to save product: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Render functions
  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-gray-600">Checking permissions...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-lg p-8 max-w-md text-center shadow-lg">
          <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
          <p className="text-gray-600">Admin privileges required</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-4">
              <Package className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Product Manager</h1>
                <p className="text-sm text-gray-600">
                  {viewMode === 'list' ? 'Manage your product catalog' : 'Create/Edit Product'}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {viewMode === 'edit' && (
                <button
                  onClick={() => setViewMode('list')}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 flex items-center space-x-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back to List</span>
                </button>
              )}
              {viewMode === 'list' && (
                <button
                  onClick={startNewProduct}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center space-x-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>New Product</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Message Banner */}
      {message && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className={`flex items-center space-x-2 p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            {message.type === 'success' ? (
              <CheckCircle className="w-5 h-5" />
            ) : (
              <AlertCircle className="w-5 h-5" />
            )}
            <span className="font-medium">{message.text}</span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {viewMode === 'list' ? (
          // PRODUCT LIST VIEW
          <div>
            {/* Product Type Filter */}
            {products.length > 0 && (
              <div className="mb-6 flex items-center space-x-4">
                <label className="text-sm font-medium text-gray-700">Filter by type:</label>
                <select
                  value={productTypeFilter}
                  onChange={(e) => setProductTypeFilter(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {PRODUCT_TYPES.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                <span className="text-sm text-gray-600">
                  Showing {getFilteredProducts().length} of {products.length} products
                </span>
              </div>
            )}

            {loadingProducts ? (
              <div className="text-center py-12">
                <Loader className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
                <p className="text-gray-600">Loading products...</p>
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-12">
                <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-900 mb-2">No products yet</h3>
                <p className="text-gray-600 mb-6">Create your first product to get started</p>
                <button
                  onClick={startNewProduct}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 inline-flex items-center space-x-2"
                >
                  <Plus className="w-5 h-5" />
                  <span>Create Product</span>
                </button>
              </div>
            ) : getFilteredProducts().length === 0 ? (
              <div className="text-center py-12">
                <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-900 mb-2">No products match this filter</h3>
                <p className="text-gray-600 mb-6">Try selecting a different product type</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {getFilteredProducts().map(product => (
                  <div key={product.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    {/* Product Image */}
                    <div className="h-48 bg-gray-100 flex items-center justify-center">
                      {product.template_url ? (
                        <img
                          src={product.template_url}
                          alt={product.name}
                          className="max-h-full max-w-full object-contain p-4"
                        />
                      ) : (
                        <Package className="w-16 h-16 text-gray-400" />
                      )}
                    </div>

                    {/* Product Info */}
                    <div className="p-4">
                      <h3 className="font-semibold text-lg mb-1">{product.name}</h3>
                      <p className="text-sm text-gray-600 mb-2">{product.product_key}</p>
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded">
                          {product.category || 'Uncategorized'}
                        </span>
                        <span className="font-semibold text-gray-900">
                          ${product.base_price}
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="flex space-x-2 mb-2">
                        <button
                          onClick={() => editProduct(product)}
                          className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center justify-center space-x-1 text-sm"
                        >
                          <Edit className="w-4 h-4" />
                          <span>Edit</span>
                        </button>
                        <button
                          onClick={() => cloneProduct(product)}
                          className="flex-1 px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center justify-center space-x-1 text-sm"
                        >
                          <Copy className="w-4 h-4" />
                          <span>Clone</span>
                        </button>
                        <button
                          onClick={() => deleteProduct(product)}
                          className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 flex items-center justify-center text-sm"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Color Management */}
                      <button
                        onClick={() => openColorManagement(product)}
                        className="w-full px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center justify-center space-x-2 text-sm"
                      >
                        <Palette className="w-4 h-4" />
                        <span>Manage Colors</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          // EDIT VIEW - Multi-step wizard
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            {/* Step Progress */}
            <div className="border-b border-gray-200 px-8 py-6">
              <div className="flex items-center justify-between max-w-3xl mx-auto">
                {[
                  { num: 1, title: 'Product Info' },
                  { num: 2, title: 'Color Variants' },
                  { num: 3, title: 'Print Areas' }
                ].map(step => (
                  <div key={step.num} className="flex items-center">
                    <button
                      onClick={() => goToStep(step.num)}
                      className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                        currentStep === step.num
                          ? 'bg-blue-600 text-white'
                          : currentStep > step.num
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      {currentStep > step.num ? <CheckCircle className="w-5 h-5" /> : step.num}
                    </button>
                    <span className={`ml-2 text-sm font-medium ${
                      currentStep >= step.num ? 'text-gray-900' : 'text-gray-500'
                    }`}>
                      {step.title}
                    </span>
                    {step.num < 3 && (
                      <div className={`w-20 h-0.5 mx-4 ${
                        currentStep > step.num ? 'bg-green-600' : 'bg-gray-300'
                      }`} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Step Content */}
            <div className="p-8">
              {/* STEP 1: Product Info */}
              {currentStep === 1 && (
                <div className="max-w-2xl mx-auto space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold mb-2">Product Information</h2>
                    <p className="text-gray-600">Basic details about your product</p>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Product Name *
                      </label>
                      <input
                        type="text"
                        value={productName}
                        onChange={(e) => {
                          setProductName(e.target.value);
                          if (!editingProductId) {
                            setProductKey(generateProductKey(e.target.value));
                          }
                        }}
                        placeholder="e.g., 5oz Cotton Tote Bag"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Product Key (URL-friendly) *
                      </label>
                      <input
                        type="text"
                        value={productKey}
                        onChange={(e) => setProductKey(e.target.value)}
                        placeholder="e.g., 5oz-cotton-tote-bag"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                        disabled={!!editingProductId}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Category *
                      </label>
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        {PRODUCT_CATEGORIES.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Base Price ($) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={basePrice}
                        onChange={(e) => setBasePrice(e.target.value)}
                        placeholder="9.99"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Minimum Order Quantity
                      </label>
                      <input
                        type="number"
                        value={minOrderQty}
                        onChange={(e) => setMinOrderQty(e.target.value)}
                        placeholder="50"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Description
                      </label>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={4}
                        placeholder="Product description..."
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: Color Variants */}
              {currentStep === 2 && (
                <div className="max-w-4xl mx-auto space-y-6">
                  <div className="flex justify-between items-center">
                    <div>
                      <h2 className="text-2xl font-bold mb-2">Color Variants</h2>
                      <p className="text-gray-600">Add colors and upload template images</p>
                    </div>
                    <button
                      onClick={addColorVariant}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add Color</span>
                    </button>
                  </div>

                  <div className="space-y-4">
                    {colorVariants.map((variant, index) => (
                      <div key={variant.id} className="border border-gray-200 rounded-lg overflow-hidden">
                        {/* Variant Header */}
                        <div
                          onClick={() => toggleVariantExpanded(variant.id)}
                          className="flex items-center justify-between p-4 bg-gray-50 cursor-pointer hover:bg-gray-100"
                        >
                          <div className="flex items-center space-x-4">
                            <div
                              className="w-10 h-10 rounded-lg border-2 border-gray-300"
                              style={{ backgroundColor: variant.colorCode }}
                            />
                            <div>
                              <div className="font-semibold">
                                {variant.name || `Color ${index + 1}`}
                              </div>
                              <div className="text-sm text-gray-600 space-x-2">
                                <span>{variant.colorCode}</span>
                                <span>•</span>
                                <span>{variant.views.length} view(s)</span>
                                {(variant.viewUrls?.front || variant.viewUrls?.back) && (
                                  <>
                                    <span>•</span>
                                    <span className="text-green-600">
                                      {variant.viewUrls?.front && variant.viewUrls?.back
                                        ? 'Front & Back uploaded'
                                        : variant.viewUrls?.front
                                        ? 'Front uploaded'
                                        : 'Back uploaded'}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            {expandedVariants.includes(variant.id) ? (
                              <ChevronUp className="w-5 h-5 text-gray-600" />
                            ) : (
                              <ChevronDown className="w-5 h-5 text-gray-600" />
                            )}
                          </div>
                        </div>

                        {/* Variant Details */}
                        {expandedVariants.includes(variant.id) && (
                          <div className="p-4 border-t border-gray-200 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Color Name *
                                </label>
                                <input
                                  type="text"
                                  value={variant.name}
                                  onChange={(e) => updateColorVariant(variant.id, 'name', e.target.value)}
                                  placeholder="e.g., Black, Navy, Red"
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                              </div>

                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Color Code *
                                </label>
                                <div className="flex space-x-2">
                                  <input
                                    type="color"
                                    value={variant.colorCode}
                                    onChange={(e) => updateColorVariant(variant.id, 'colorCode', e.target.value)}
                                    className="w-16 h-10 border border-gray-300 rounded cursor-pointer"
                                  />
                                  <input
                                    type="text"
                                    value={variant.colorCode}
                                    onChange={(e) => updateColorVariant(variant.id, 'colorCode', e.target.value)}
                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Template Images - View Specific */}
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Template Images *
                              </label>
                              <div className="grid grid-cols-2 gap-4">
                                {variant.views.map(view => (
                                  <div key={view}>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                      {view.charAt(0).toUpperCase() + view.slice(1)} View
                                    </label>
                                    {variant.viewUrls?.[view] ? (
                                      <div className="relative group">
                                        <img
                                          src={variant.viewUrls[view]}
                                          alt={`${view} view`}
                                          className="w-full h-32 object-contain border border-gray-300 rounded-lg bg-gray-50"
                                        />
                                        <label className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity rounded-lg">
                                          <Upload className="w-5 h-5 text-white" />
                                          <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(e) => {
                                              const file = e.target.files?.[0];
                                              if (file) handleColorImageUpload(variant.id, view, file);
                                            }}
                                          />
                                        </label>
                                      </div>
                                    ) : (
                                      <label className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-500 hover:bg-blue-50">
                                        {uploadingColor === `${variant.id}-${view}` ? (
                                          <Loader className="w-5 h-5 animate-spin text-blue-600" />
                                        ) : (
                                          <>
                                            <Upload className="w-5 h-5 text-gray-400" />
                                            <span className="text-xs text-gray-500 mt-1">Upload {view.charAt(0).toUpperCase() + view.slice(1)}</span>
                                          </>
                                        )}
                                        <input
                                          type="file"
                                          accept="image/*"
                                          className="hidden"
                                          onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) handleColorImageUpload(variant.id, view, file);
                                          }}
                                        />
                                      </label>
                                    )}
                                  </div>
                                ))}
                              </div>
                              <p className="text-xs text-gray-500 mt-2">
                                Upload PNG with transparency for best results. Max 5MB.
                              </p>
                            </div>

                            {/* Available Views */}
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Available Views *
                              </label>
                              <div className="flex flex-wrap gap-2">
                                {AVAILABLE_VIEWS.map(view => (
                                  <button
                                    key={view}
                                    onClick={() => toggleView(variant.id, view)}
                                    className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                                      variant.views.includes(view)
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'bg-white text-gray-700 border-gray-300 hover:border-blue-600'
                                    }`}
                                  >
                                    {view.charAt(0).toUpperCase() + view.slice(1)}
                                  </button>
                                ))}
                              </div>
                              <p className="text-xs text-gray-500 mt-2">
                                Select which views are available for this color
                              </p>
                            </div>

                            {/* Remove Button */}
                            {colorVariants.length > 1 && (
                              <div className="pt-4 border-t border-gray-200">
                                <button
                                  onClick={() => removeColorVariant(variant.id)}
                                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center space-x-2"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  <span>Remove This Color</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* STEP 3: Print Areas */}
              {currentStep === 3 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold mb-2">Configure Print Areas</h2>
                    <p className="text-gray-600">Define designable areas for each color and view</p>
                  </div>

                  {/* Progress Indicator */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-blue-900">Configuration Progress</h3>
                      <span className="text-sm text-blue-700">
                        {configuredViews.length} of {colorVariants.flatMap(v => v.views.map(view => `${v.id}_${view}`)).length} configured
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {colorVariants.map(variant =>
                        variant.views.map(view => {
                          const viewKey = `${variant.id}_${view}`;
                          const isConfigured = configuredViews.includes(viewKey);
                          const isCurrent = variant.id === colorVariants[currentVariantIndex].id && view === currentView;
                          return (
                            <span
                              key={viewKey}
                              className={`px-3 py-1 rounded-full text-xs font-medium ${
                                isCurrent
                                  ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                                  : isConfigured
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-gray-200 text-gray-600'
                              }`}
                            >
                              {variant.name} - {view.charAt(0).toUpperCase() + view.slice(1)}
                              {isConfigured && ' ✓'}
                              {isCurrent && ' (current)'}
                            </span>
                          );
                        })
                      )}
                    </div>
                    <p className="text-xs text-blue-700 mt-2">
                      Configure print areas for each view, then click "Finish & Save Product" when done.
                    </p>
                  </div>

                  {/* Variant & View Selector */}
                  <div className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Color Variant
                      </label>
                      <select
                        value={currentVariantIndex}
                        onChange={(e) => {
                          setCurrentVariantIndex(parseInt(e.target.value));
                          setCurrentView(colorVariants[parseInt(e.target.value)].views[0]);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      >
                        {colorVariants.map((variant, index) => (
                          <option key={variant.id} value={index}>
                            {variant.name} ({variant.colorCode})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        View
                      </label>
                      <select
                        value={currentView}
                        onChange={(e) => setCurrentView(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      >
                        {colorVariants[currentVariantIndex]?.views.map(view => (
                          <option key={view} value={view}>
                            {view.charAt(0).toUpperCase() + view.slice(1)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Canvas & Controls */}
                  <div className="flex gap-6">
                    {/* Left Panel - Print Area List */}
                    <div className="w-80 space-y-4">
                      {/* Grid Controls */}
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <h3 className="font-semibold mb-3 flex items-center">
                          <Grid className="w-4 h-4 mr-2" />
                          Grid Settings
                        </h3>
                        <div className="space-y-3">
                          <label className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              checked={showGrid}
                              onChange={(e) => setShowGrid(e.target.checked)}
                              className="rounded"
                            />
                            <span className="text-sm">Show Grid</span>
                          </label>
                          <div>
                            <label className="block text-sm text-gray-700 mb-1">
                              Grid Size: {gridSize}px
                            </label>
                            <input
                              type="range"
                              min="10"
                              max="50"
                              value={gridSize}
                              onChange={(e) => setGridSize(parseInt(e.target.value))}
                              className="w-full"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Print Areas List */}
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <div className="flex justify-between items-center mb-3">
                          <h3 className="font-semibold">Print Areas</h3>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setShowNewAreaDialog(true)}
                              className="p-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                              title="Add new print area"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                            <button
                              onClick={handleCopyToAllColors}
                              className="px-3 py-1 bg-purple-600 text-white text-xs rounded hover:bg-purple-700 flex items-center gap-1"
                              title="Copy current print areas to all other colors (same view)"
                            >
                              <Copy className="w-3 h-3" />
                              Copy to All Colors
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          {Object.entries(printAreas[`${currentVariantIndex}_${currentView}`] || {}).map(([key, area]) => (
                            <div
                              key={key}
                              className={`p-3 border rounded-lg ${
                                selectedPrintArea === key ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                              }`}
                            >
                              <div className="flex justify-between items-start mb-2">
                                <div className="flex-1">
                                  <h4 className="font-medium text-sm">{area.name}</h4>
                                  <div className="text-xs text-gray-500 mt-1">
                                    <div>Pos: ({area.x}, {area.y})</div>
                                    <div>Size: {area.width} × {area.height} px</div>
                                  </div>
                                </div>
                                <button
                                  onClick={() => deletePrintArea(key)}
                                  className="text-red-600 hover:text-red-800 p-1"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>

                              {/* Physical Dimensions in MM */}
                              <div className="pt-2 border-t border-gray-200">
                                <label className="text-xs font-medium text-gray-700 mb-1 block">
                                  Physical Dimensions (mm)
                                </label>
                                <div className="flex gap-2">
                                  <input
                                    type="number"
                                    step="0.1"
                                    placeholder="Width"
                                    value={area.width_mm || ''}
                                    onChange={(e) => {
                                      const variantKey = `${currentVariantIndex}_${currentView}`;
                                      setPrintAreas(prev => ({
                                        ...prev,
                                        [variantKey]: {
                                          ...(prev[variantKey] || {}),
                                          [key]: {
                                            ...area,
                                            width_mm: e.target.value ? parseFloat(e.target.value) : null
                                          }
                                        }
                                      }));
                                    }}
                                    className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                                  />
                                  <span className="text-xs text-gray-500 self-center">×</span>
                                  <input
                                    type="number"
                                    step="0.1"
                                    placeholder="Height"
                                    value={area.height_mm || ''}
                                    onChange={(e) => {
                                      const variantKey = `${currentVariantIndex}_${currentView}`;
                                      setPrintAreas(prev => ({
                                        ...prev,
                                        [variantKey]: {
                                          ...(prev[variantKey] || {}),
                                          [key]: {
                                            ...area,
                                            height_mm: e.target.value ? parseFloat(e.target.value) : null
                                          }
                                        }
                                      }));
                                    }}
                                    className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                                  />
                                </div>
                              </div>
                            </div>
                          ))}

                          {Object.keys(printAreas[`${currentVariantIndex}_${currentView}`] || {}).length === 0 && (
                            <div className="text-center py-6 text-gray-500 text-sm">
                              No print areas yet
                              <br />
                              Click + to add one
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Canvas */}
                    <div className="flex-1">
                      <div className="flex items-start space-x-4">
                        <div className="border border-gray-200 rounded-lg bg-white p-4 inline-block">
                          <canvas ref={initCanvas} width="800" height="800" />
                        </div>

                        {/* Nudge Controls */}
                        <div className="border border-gray-200 rounded-lg bg-white p-3">
                          <h5 className="text-xs font-medium text-gray-700 mb-2">Nudge (1px)</h5>
                          <div className="grid grid-cols-3 gap-1">
                            {/* Top row */}
                            <button
                              onClick={() => nudgePrintArea('up-left')}
                              className="flex items-center justify-center p-2 bg-gray-500 text-white rounded hover:bg-gray-600 text-xs"
                              title="Nudge up-left"
                            >
                              ↖
                            </button>
                            <button
                              onClick={() => nudgePrintArea('up')}
                              className="flex items-center justify-center p-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                              title="Nudge up"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => nudgePrintArea('up-right')}
                              className="flex items-center justify-center p-2 bg-gray-500 text-white rounded hover:bg-gray-600 text-xs"
                              title="Nudge up-right"
                            >
                              ↗
                            </button>

                            {/* Middle row */}
                            <button
                              onClick={() => nudgePrintArea('left')}
                              className="flex items-center justify-center p-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                              title="Nudge left"
                            >
                              <ArrowLeft className="w-3 h-3" />
                            </button>
                            <div className="flex items-center justify-center p-2 bg-gray-200 rounded">
                              <Move className="w-3 h-3 text-gray-400" />
                            </div>
                            <button
                              onClick={() => nudgePrintArea('right')}
                              className="flex items-center justify-center p-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                              title="Nudge right"
                            >
                              <ArrowRight className="w-3 h-3" />
                            </button>

                            {/* Bottom row */}
                            <button
                              onClick={() => nudgePrintArea('down-left')}
                              className="flex items-center justify-center p-2 bg-gray-500 text-white rounded hover:bg-gray-600 text-xs"
                              title="Nudge down-left"
                            >
                              ↙
                            </button>
                            <button
                              onClick={() => nudgePrintArea('down')}
                              className="flex items-center justify-center p-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                              title="Nudge down"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => nudgePrintArea('down-right')}
                              className="flex items-center justify-center p-2 bg-gray-500 text-white rounded hover:bg-gray-600 text-xs"
                              title="Nudge down-right"
                            >
                              ↘
                            </button>
                          </div>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 mt-2">
                        Drag rectangles to position, resize using corner handles. Use nudge controls for pixel-perfect positioning.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Navigation Footer */}
            <div className="border-t border-gray-200 px-8 py-4 bg-gray-50 flex justify-between">
              <button
                onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
                disabled={currentStep === 1}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Previous</span>
              </button>

              {currentStep < 3 ? (
                <div className="flex space-x-3">
                  {/* Save button for current step */}
                  {currentStep === 1 && editingProductId && (
                    <button
                      onClick={handleSaveProductInfo}
                      disabled={saving}
                      className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                    >
                      {saving ? (
                        <>
                          <Loader className="w-4 h-4 animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          <span>Save Product Info</span>
                        </>
                      )}
                    </button>
                  )}
                  {currentStep === 2 && editingProductId && (
                    <button
                      onClick={handleSaveColors}
                      disabled={saving}
                      className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                    >
                      {saving ? (
                        <>
                          <Loader className="w-4 h-4 animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          <span>Save Colors</span>
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => setCurrentStep(currentStep + 1)}
                    disabled={!canGoNext()}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    <span>Next</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex space-x-3">
                  <button
                    onClick={markCurrentViewAsConfigured}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span>Save This View</span>
                  </button>
                  {editingProductId && (
                    <button
                      onClick={handleSavePrintAreas}
                      disabled={saving}
                      className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                    >
                      {saving ? (
                        <>
                          <Loader className="w-4 h-4 animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          <span>Save Print Areas</span>
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={saveProduct}
                    disabled={saving}
                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    {saving ? (
                      <>
                        <Loader className="w-4 h-4 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        <span>Finish & Save Product</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* New Print Area Dialog */}
      {showNewAreaDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Add Print Area</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Print Area Type
                </label>
                <select
                  value={selectedPreset}
                  onChange={(e) => {
                    setSelectedPreset(e.target.value);
                    if (e.target.value !== 'custom') {
                      const preset = PRINT_AREA_PRESETS[e.target.value];
                      setNewAreaName(preset.name);
                      setSelectedShape(preset.shape);
                    } else {
                      setNewAreaName('');
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="custom">Custom Size</option>
                  <optgroup label="────── APPAREL ──────">
                    <option value="center_chest">Center Chest (300×300mm)</option>
                    <option value="left_breast_pocket">Left Breast Pocket (80×80mm)</option>
                    <option value="right_breast_pocket">Right Breast Pocket (80×80mm)</option>
                    <option value="left_sleeve">Left Sleeve (100×100mm)</option>
                    <option value="right_sleeve">Right Sleeve (100×100mm)</option>
                    <option value="center_back">Center Back (300×300mm)</option>
                  </optgroup>
                  <optgroup label="────── GENERIC PRODUCTS ──────">
                    <option value="front_print">Front Print Area (250×250mm)</option>
                    <option value="back_print">Back Print Area (250×250mm)</option>
                    <option value="side_print">Side Print Area (150×150mm)</option>
                    <option value="top_print">Top Print Area (200×200mm)</option>
                    <option value="bottom_print">Bottom Print Area (200×200mm)</option>
                  </optgroup>
                </select>
                {selectedPreset !== 'custom' && (
                  <p className="text-xs text-gray-500 mt-1">
                    {PRINT_AREA_PRESETS[selectedPreset]?.description}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Shape
                </label>
                <select
                  value={selectedShape}
                  onChange={(e) => setSelectedShape(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="rectangle">Rectangle</option>
                  <option value="circle">Circle</option>
                  <option value="ellipse">Ellipse</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Area Name
                </label>
                <input
                  type="text"
                  value={newAreaName}
                  onChange={(e) => setNewAreaName(e.target.value)}
                  placeholder="e.g., Front Center, Left Chest"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  disabled={selectedPreset !== 'custom'}
                />
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => {
                    setShowNewAreaDialog(false);
                    setNewAreaName('');
                    setSelectedPreset('custom');
                  }}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  onClick={addPrintArea}
                  disabled={!newAreaName.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Add Area
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Color Management Modal */}
      {showColorModal && currentColorProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Manage Colors</h2>
                <p className="text-sm text-gray-600 mt-1">{currentColorProduct.name}</p>
              </div>
              <button
                onClick={closeColorManagement}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Quick Actions */}
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex items-center space-x-3">
              <button
                onClick={handleQuickAssignStandard}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2 text-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Quick Assign Standard Set</span>
              </button>
              <button
                onClick={() => setShowCopyColorsModal(true)}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2 text-sm"
              >
                <Copy className="w-4 h-4" />
                <span>Copy Colors From...</span>
              </button>
              <div className="flex-1"></div>
              <span className="text-sm text-gray-600">
                {assignedColors.length} colors assigned
              </span>
            </div>

            {/* Modal Body - Scrollable */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {loadingColors ? (
                <div className="text-center py-12">
                  <Loader className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
                  <p className="text-gray-600">Loading colors...</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Group colors by family */}
                  {['Basics', 'Blues', 'Reds', 'Pinks', 'Greens', 'Yellows', 'Oranges', 'Purples', 'Browns', 'Heathers'].map(family => {
                    const familyColors = allColors.filter(c => c.color_family === family);
                    if (familyColors.length === 0) return null;

                    const isExpanded = expandedColorFamilies.includes(family);
                    const assignedCount = familyColors.filter(c => isColorAssigned(c.id)).length;

                    return (
                      <div key={family} className="border border-gray-200 rounded-lg overflow-hidden">
                        {/* Family Header */}
                        <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
                          <button
                            onClick={() => toggleColorFamily(family)}
                            className="flex items-center space-x-2 flex-1 text-left"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-5 h-5 text-gray-500" />
                            ) : (
                              <ChevronDown className="w-5 h-5 text-gray-500" />
                            )}
                            <span className="font-semibold text-gray-900">{family}</span>
                            <span className="text-sm text-gray-600">
                              ({assignedCount}/{familyColors.length} assigned)
                            </span>
                          </button>
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleSelectAllColors(family)}
                              className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-sm hover:bg-blue-200"
                            >
                              Select All
                            </button>
                            <button
                              onClick={() => handleDeselectAllColors(family)}
                              className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200"
                            >
                              Deselect All
                            </button>
                          </div>
                        </div>

                        {/* Colors Grid */}
                        {isExpanded && (
                          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            {familyColors.map(color => {
                              const assigned = isColorAssigned(color.id);
                              const assignment = assignedColors.find(ac => ac.apparel_color_id === color.id);

                              return (
                                <div
                                  key={color.id}
                                  className={`border-2 rounded-lg p-3 ${
                                    assigned ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                                  }`}
                                >
                                  <div className="flex items-center space-x-3">
                                    {/* Color Swatch */}
                                    <div
                                      className="w-10 h-10 rounded-full border-2 border-gray-300 flex-shrink-0"
                                      style={{ backgroundColor: color.hex_code }}
                                    ></div>

                                    {/* Color Info */}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center space-x-2">
                                        <input
                                          type="checkbox"
                                          checked={assigned}
                                          onChange={() => handleColorToggle(color)}
                                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                        />
                                        <span className="font-medium text-gray-900 truncate">
                                          {color.color_name}
                                        </span>
                                      </div>
                                      <div className="text-xs text-gray-500 mt-1">
                                        {color.pantone_code && (
                                          <span className="mr-2">{color.pantone_code}</span>
                                        )}
                                        <span>{color.hex_code}</span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Photo Upload (if assigned) */}
                                  {assigned && assignment && (
                                    <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                                      <div className="grid grid-cols-2 gap-2">
                                        {/* Front Photo */}
                                        <div>
                                          <label className="block text-xs font-medium text-gray-700 mb-1">
                                            Front View
                                          </label>
                                          {assignment.has_front_photo ? (
                                            <div className="relative group">
                                              <img
                                                src={assignment.front_photo_url}
                                                alt="Front"
                                                className="w-full h-20 object-cover rounded border"
                                              />
                                              <label className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                                                <Upload className="w-5 h-5 text-white" />
                                                <input
                                                  type="file"
                                                  accept="image/*"
                                                  className="hidden"
                                                  onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) handlePhotoUpload(color.id, color.color_name, 'front', file);
                                                  }}
                                                />
                                              </label>
                                            </div>
                                          ) : (
                                            <label className="flex flex-col items-center justify-center h-20 border-2 border-dashed border-gray-300 rounded cursor-pointer hover:border-blue-500 hover:bg-blue-50">
                                              {uploadingPhoto === `${color.id}-front` ? (
                                                <Loader className="w-5 h-5 animate-spin text-blue-600" />
                                              ) : (
                                                <>
                                                  <Upload className="w-5 h-5 text-gray-400" />
                                                  <span className="text-xs text-gray-500 mt-1">Upload</span>
                                                </>
                                              )}
                                              <input
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                onChange={(e) => {
                                                  const file = e.target.files?.[0];
                                                  if (file) handlePhotoUpload(color.id, color.color_name, 'front', file);
                                                }}
                                              />
                                            </label>
                                          )}
                                        </div>

                                        {/* Back Photo */}
                                        <div>
                                          <label className="block text-xs font-medium text-gray-700 mb-1">
                                            Back View
                                          </label>
                                          {assignment.has_back_photo ? (
                                            <div className="relative group">
                                              <img
                                                src={assignment.back_photo_url}
                                                alt="Back"
                                                className="w-full h-20 object-cover rounded border"
                                              />
                                              <label className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                                                <Upload className="w-5 h-5 text-white" />
                                                <input
                                                  type="file"
                                                  accept="image/*"
                                                  className="hidden"
                                                  onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) handlePhotoUpload(color.id, color.color_name, 'back', file);
                                                  }}
                                                />
                                              </label>
                                            </div>
                                          ) : (
                                            <label className="flex flex-col items-center justify-center h-20 border-2 border-dashed border-gray-300 rounded cursor-pointer hover:border-blue-500 hover:bg-blue-50">
                                              {uploadingPhoto === `${color.id}-back` ? (
                                                <Loader className="w-5 h-5 animate-spin text-blue-600" />
                                              ) : (
                                                <>
                                                  <Upload className="w-5 h-5 text-gray-400" />
                                                  <span className="text-xs text-gray-500 mt-1">Upload</span>
                                                </>
                                              )}
                                              <input
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                onChange={(e) => {
                                                  const file = e.target.files?.[0];
                                                  if (file) handlePhotoUpload(color.id, color.color_name, 'back', file);
                                                }}
                                              />
                                            </label>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Overlay Management Section */}
              <div className="mt-6 border-t border-gray-200 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Overlay Images</h3>
                    <p className="text-sm text-gray-600">Upload overlay elements like cords, collars, pockets, etc.</p>
                  </div>
                  <button
                    onClick={() => setShowOverlaySection(!showOverlaySection)}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center space-x-2 text-sm"
                  >
                    {showOverlaySection ? (
                      <>
                        <ChevronUp className="w-4 h-4" />
                        <span>Hide Overlays</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4" />
                        <span>Show Overlays ({overlays.length})</span>
                      </>
                    )}
                  </button>
                </div>

                {showOverlaySection && (
                  <div className="space-y-4">
                    {/* Upload Section */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">Upload New Overlay</h4>
                      <div className="grid grid-cols-4 gap-3">
                        {/* Color Selection */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Color</label>
                          <select
                            value={selectedOverlayColor || ''}
                            onChange={(e) => setSelectedOverlayColor(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">Select color...</option>
                            {assignedColors.map(assignment => {
                              const color = allColors.find(c => c.id === assignment.apparel_color_id);
                              return color ? (
                                <option key={color.id} value={color.id}>
                                  {color.color_name}
                                </option>
                              ) : null;
                            })}
                          </select>
                        </div>

                        {/* View Selection */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">View</label>
                          <select
                            value={selectedOverlayView}
                            onChange={(e) => setSelectedOverlayView(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {AVAILABLE_VIEWS.map(view => (
                              <option key={view} value={view}>{view}</option>
                            ))}
                          </select>
                        </div>

                        {/* Overlay Type Selection */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Overlay Type</label>
                          <select
                            value={selectedOverlayType}
                            onChange={(e) => setSelectedOverlayType(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {OVERLAY_TYPES.map(type => (
                              <option key={type.value} value={type.value} title={type.description}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Upload Button */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">File</label>
                          <label className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md cursor-pointer flex items-center justify-center text-sm transition-colors">
                            <Upload className="w-4 h-4 mr-2" />
                            Upload PNG
                            <input
                              type="file"
                              accept="image/png"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleOverlayUpload(file);
                              }}
                              disabled={!selectedOverlayColor || uploadingOverlay}
                            />
                          </label>
                        </div>
                      </div>

                      {uploadingOverlay && (
                        <div className="mt-3 flex items-center text-sm text-blue-600">
                          <Loader className="w-4 h-4 animate-spin mr-2" />
                          Uploading overlay...
                        </div>
                      )}
                    </div>

                    {/* Existing Overlays */}
                    {loadingOverlays ? (
                      <div className="text-center py-8">
                        <Loader className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
                        <p className="text-sm text-gray-600">Loading overlays...</p>
                      </div>
                    ) : overlays.length === 0 ? (
                      <div className="text-center py-8 bg-gray-50 rounded-lg">
                        <Package className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                        <p className="text-sm text-gray-600">No overlays uploaded yet</p>
                      </div>
                    ) : (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900 mb-3">Existing Overlays</h4>
                        <div className="grid grid-cols-2 gap-3">
                          {overlays.map((overlay, index) => (
                            <div key={index} className="border border-gray-200 rounded-lg p-3 hover:shadow-md transition-shadow">
                              <div className="flex items-start space-x-3">
                                {/* Preview */}
                                <div className="w-20 h-20 bg-gray-100 rounded-md flex-shrink-0 overflow-hidden">
                                  <img
                                    src={overlay.url}
                                    alt={overlay.name}
                                    className="w-full h-full object-contain"
                                  />
                                </div>

                                {/* Details */}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-900 truncate">{overlay.name}</p>
                                  <div className="mt-1 space-y-1">
                                    <p className="text-xs text-gray-600">
                                      <span className="font-medium">Color:</span> {overlay.color}
                                    </p>
                                    <p className="text-xs text-gray-600">
                                      <span className="font-medium">View:</span> {overlay.view}
                                    </p>
                                    <p className="text-xs text-gray-600">
                                      <span className="font-medium">Type:</span> {overlay.overlayType}
                                    </p>
                                  </div>
                                  <button
                                    onClick={() => handleDeleteOverlay(overlay.path)}
                                    className="mt-2 text-xs text-red-600 hover:text-red-800 flex items-center"
                                  >
                                    <Trash2 className="w-3 h-3 mr-1" />
                                    Delete
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={closeColorManagement}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy Colors Modal */}
      {showCopyColorsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Copy Colors From Product</h3>
              <button
                onClick={() => setShowCopyColorsModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-4 max-h-96 overflow-y-auto">
              {products.filter(p => p.id !== currentColorProduct?.id).length === 0 ? (
                <p className="text-center text-gray-600 py-8">No other products available</p>
              ) : (
                <div className="space-y-2">
                  {products.filter(p => p.id !== currentColorProduct?.id).map(product => (
                    <button
                      key={product.id}
                      onClick={() => handleCopyColors(product.id)}
                      className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-500 transition-colors"
                    >
                      <div className="font-medium text-gray-900">{product.name}</div>
                      <div className="text-sm text-gray-600">{product.product_key}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowCopyColorsModal(false)}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductManager;
