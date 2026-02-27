/**
 * ProductDetailPage Component
 *
 * Reusable product detail page component that displays catalog products.
 * Fetches data from the catalog database and handles all product display logic.
 *
 * Usage:
 *   <ProductDetailPage productSlug="5oz-cotton-bag" />
 *
 * @param {string} productSlug - Required - The product slug to fetch from database
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Star,
  Heart,
  Share2,
  ShoppingCart,
  Check,
  Zap,
  Shield,
  Truck,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Plus,
  Minus,
  X,
  AlertCircle,
  Loader,
  Palette
} from 'lucide-react';
import {
  getCatalogProductBySlug,
  calculatePriceForQuantity,
  checkProductCustomizable,
  getDesignerUrl,
  getProductPrintPricing
} from '../services/productCatalogService';

// Helper constants and functions for apparel size selector
const APPAREL_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

// Print position labels (clothing model) — sliced by max_print_positions
const ALL_POSITION_LABELS = ['Front', 'Back', 'Left Breast', 'Right Breast', 'Right Arm'];
// Colour count options for each print position dropdown
const COLOUR_OPTIONS = ['None', '1 col', '2 col', '3 col', '4 col', '5 col', '6 col'];
const isApparelProduct = (product) => {
  if (!product) return false;
  const apparelSlugs = ['hoodie', 't-shirts', 'polo', 'sweatshirts'];
  return apparelSlugs.includes(product.slug);
};

const ProductDetailPage = ({ productSlug }) => {
  const navigate = useNavigate();

  /**
   * Apply STRONG color overlay with 95% intensity for vibrant colors
   * Copied from Designer.jsx for consistent color rendering
   * @param {string} imageUrl - URL of white/light template
   * @param {string} hexColor - Target hex color
   * @returns {Promise<string>} Blob URL of colored image
   */
  const applyStrongColorOverlay = async (imageUrl, hexColor) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: true });

        canvas.width = img.width;
        canvas.height = img.height;

        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Parse target color
        const targetR = parseInt(hexColor.slice(1, 3), 16);
        const targetG = parseInt(hexColor.slice(3, 5), 16);
        const targetB = parseInt(hexColor.slice(5, 7), 16);

        console.log('[StrongOverlay] Target RGB:', targetR, targetG, targetB);

        // MUCH MORE AGGRESSIVE COLOR APPLICATION (95% intensity)
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];

          if (alpha > 10) {
            // Calculate luminosity (brightness)
            const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;

            // Apply color at 95% intensity (much stronger!)
            const intensity = 0.95;

            // Blend original with target color
            data[i] = targetR * lum * intensity + data[i] * (1 - intensity);
            data[i + 1] = targetG * lum * intensity + data[i + 1] * (1 - intensity);
            data[i + 2] = targetB * lum * intensity + data[i + 2] * (1 - intensity);
          }
        }

        ctx.putImageData(imageData, 0, 0);

        canvas.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          console.log('[StrongOverlay] ✅ Strong overlay complete (95% intensity)');
          resolve(url);
        }, 'image/png');
      };

      img.onerror = reject;
      img.src = imageUrl;
    });
  };

  // UI State
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(48);
  const [quantityInput, setQuantityInput] = useState('48'); // Display value for input
  const [activeTab, setActiveTab] = useState('details');
  const [isLiked, setIsLiked] = useState(false);
  const [animatePrice, setAnimatePrice] = useState(false);

  // Color Overlay State (for apparel products)
  const [overlayImageUrl, setOverlayImageUrl] = useState(null);
  const [isApplyingOverlay, setIsApplyingOverlay] = useState(false);

  // Gallery Viewing State
  const [viewingGallery, setViewingGallery] = useState(false);
  const [selectedGalleryImage, setSelectedGalleryImage] = useState(null);
  const [selectedGalleryIndex, setSelectedGalleryIndex] = useState(null);

  // Color Swatches State
  const [colorsExpanded, setColorsExpanded] = useState(false);

  // Data State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [product, setProduct] = useState(null);
  const [pricingTiers, setPricingTiers] = useState([]);
  const [colors, setColors] = useState([]);
  const [images, setImages] = useState([]);
  const [galleryImages, setGalleryImages] = useState([]);
  const [productImages, setProductImages] = useState([]);
  const [features, setFeatures] = useState([]);
  const [specifications, setSpecifications] = useState({});
  const [currentPrice, setCurrentPrice] = useState(null);
  // Print pricing state
  const [printPricingData, setPrintPricingData] = useState([]);
  // Clothing model: { 'Front': '1 col', 'Back': 'None', ... }
  const [printPositions, setPrintPositions] = useState({});
  // Flat model: whether second position is toggled on
  const [secondPosition, setSecondPosition] = useState(false);
  // Coverage model: selected coverage type
  const [coverageType, setCoverageType] = useState('front_only');

  // Multi-color selections for apparel (replaces simple sizeQuantities)
  const [colorSelections, setColorSelections] = useState([
    {
      id: 1,
      colorId: null,
      colorName: '',
      colorHex: '',
      sizes: { S: 0, M: 0, L: 0, XL: 0, XXL: 0 }
    }
  ]);
  const [nextColorId, setNextColorId] = useState(2);
  const [showAllColors, setShowAllColors] = useState(false);

  // Clothing model: colour order rows (id, colorId, colorName, colorCode, sizes)
  const [colorOrderRows, setColorOrderRows] = useState([
    { id: 1, colorId: null, colorName: '', colorCode: '', sizes: { S: 0, M: 0, L: 0, XL: 0, XXL: 0 } }
  ]);
  const [nextColorOrderId, setNextColorOrderId] = useState(2);

  // Get available colors (exclude already selected ones)
  const getAvailableColors = (currentSelectionId) => {
    const selectedColorIds = colorSelections
      .filter(sel => sel.id !== currentSelectionId && sel.colorId && sel.colorId !== '')
      .map(sel => sel.colorId);  // These are UUID strings

    console.log('[Available Colors] Selected color IDs:', selectedColorIds);
    console.log('[Available Colors] All color IDs:', colors.map(c => c.id));

    return colors.filter(color => !selectedColorIds.includes(color.id));
  };

  // Calculate subtotal for a single color row
  const getColorSubtotal = (selection) => {
    return Object.values(selection.sizes).reduce((sum, qty) => sum + qty, 0);
  };

  // Check if can add more colors
  const canAddMoreColors = () => {
    const usedColors = colorSelections.filter(sel => sel.colorId).length;
    return usedColors < colors.length;
  };

  // Check if a row has any quantities entered
  const hasQuantities = (selection) => {
    return Object.values(selection.sizes).some(qty => qty > 0);
  };

  // Total units across all colour order rows and sizes (clothing model)
  const getRowSubtotal = (row) => Object.values(row.sizes || {}).reduce((sum, v) => sum + (v || 0), 0);
  const clothingTotalQty = colorOrderRows.reduce((sum, r) => sum + getRowSubtotal(r), 0);

  // Check if order meets minimum quantity
  const isOrderValid = () => {
    if (product?.pricing_model === 'clothing') {
      return clothingTotalQty >= 25;
    }
    return quantity >= (product?.min_order_quantity || 0);
  };

  /**
   * Validate required props
   */
  useEffect(() => {
    if (!productSlug) {
      setError('Product slug is required');
      setLoading(false);
    }
  }, [productSlug]);

  // Debug: Log when colors are loaded from database
  useEffect(() => {
    if (colors && colors.length > 0) {
      console.log('[ProductDetail] Product colors loaded:', colors.length);
      console.log('[ProductDetail] Sample color:', colors[0]);
      console.log('[ProductDetail] Color ID type:', typeof colors[0]?.id);
      console.log('[ProductDetail] All color IDs:', colors.map(c => c.id));
    }
  }, [colors]);

  /**
   * Load product data from database
   */
  const loadProductData = async () => {
    if (!productSlug) return;

    setLoading(true);
    setError(null);

    try {
      const data = await getCatalogProductBySlug(productSlug);

      if (!data) {
        setError(`Product "${productSlug}" not found. Please make sure the product has been seeded.`);
        setLoading(false);
        return;
      }

      // Set product data
      setProduct(data);
      setPricingTiers(data.pricing || []);
      setColors(data.colors || []);
      setImages(data.images || []);
      setFeatures(data.features?.map(f => f.feature_text) || []);
      setSpecifications(data.specifications?.specifications || {});

      // Separate gallery images from product images
      const gallery = (data.images || [])
        .filter(img => img.image_type === 'gallery')
        .sort((a, b) => a.sort_order - b.sort_order);

      const productImgs = (data.images || [])
        .filter(img => img.image_type === 'main' || img.image_type === 'product' || !img.image_type);

      setGalleryImages(gallery);
      setProductImages(productImgs);

      console.log('[ProductDetail] Gallery images:', gallery.length);
      console.log('[ProductDetail] Product images:', productImgs.length);
      console.log('[ProductDetail] All images:', data.images || []);

      // Set initial selected color - WHITE for apparel, first color for others
      const apparelSlugs = ['hoodie', 't-shirts', 'polo', 'sweatshirts'];
      const isApparel = data.category?.slug === 'clothing' || apparelSlugs.includes(data.slug);

      if (data.colors && data.colors.length > 0) {
        if (isApparel) {
          // For apparel, default to WHITE color
          const whiteColor = data.colors.find(c =>
            c.color_name?.toLowerCase() === 'white' ||
            c.color_code?.toLowerCase() === 'white'
          );

          if (whiteColor) {
            console.log('[ProductDetail] 🎯 APPAREL: Setting white as default color');
            setSelectedColor(whiteColor.color_code);

            // Set white template URL directly (no overlay needed for white)
            const whiteTemplateUrl = `https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/${data.slug}/white-front.png`;
            console.log('[ProductDetail] 🎯 Setting white template URL:', whiteTemplateUrl);
            setOverlayImageUrl(whiteTemplateUrl);
          } else {
            console.log('[ProductDetail] ⚠️ White color not found, using first color');
            setSelectedColor(data.colors[0].color_code);
          }
        } else {
          // For non-apparel, use first color
          console.log('[ProductDetail] Non-apparel: Setting first color');
          setSelectedColor(data.colors[0].color_code);
        }
      }

      // Set initial quantity to min order quantity
      if (data.min_order_quantity) {
        setQuantity(data.min_order_quantity);
        setQuantityInput(data.min_order_quantity.toString());
      }

      // Initialise colour order rows with the default colour (White for apparel, first otherwise)
      if (data.pricing_model === 'clothing' && data.colors && data.colors.length > 0) {
        const apparelSlugs = ['hoodie', 't-shirts', 'polo', 'sweatshirts'];
        const isApparel = data.category?.slug === 'clothing' || apparelSlugs.includes(data.slug);
        let defaultColor = data.colors[0];
        if (isApparel) {
          const whiteColor = data.colors.find(c =>
            c.color_name?.toLowerCase() === 'white' || c.color_code?.toLowerCase() === 'white'
          );
          if (whiteColor) defaultColor = whiteColor;
        }
        setColorOrderRows([{
          id: 1,
          colorId: defaultColor.id,
          colorName: defaultColor.color_name || '',
          colorCode: defaultColor.color_code || '',
          sizes: { S: 0, M: 0, L: 0, XL: 0, XXL: 0 }
        }]);
        setNextColorOrderId(2);
      }

      // Load print pricing data (falls back to [] gracefully if table doesn't exist yet)
      try {
        const printData = await getProductPrintPricing(data.id);
        setPrintPricingData(printData);
        console.log('[PrintPricing] Loaded', printData.length, 'rows for product', data.id);

        // Initialise print position selectors for clothing model
        if (data.pricing_model === 'clothing') {
          const labels = ALL_POSITION_LABELS.slice(0, data.max_print_positions || 4);
          const initial = {};
          labels.forEach((lbl, i) => { initial[lbl] = i === 0 ? '1 col' : 'None'; });
          setPrintPositions(initial);
          console.log('[PrintPricing] Initial positions:', initial);
        }
      } catch (printErr) {
        console.warn('[PrintPricing] Could not load print pricing (table may not exist yet):', printErr.message);
      }

      setLoading(false);
    } catch (err) {
      console.error('Error loading product data:', err);
      setError('Failed to load product data. Please try again.');
      setLoading(false);
    }
  };

  /**
   * Calculate current price based on quantity
   */
  const updatePrice = async () => {
    if (!product) return;

    try {
      const priceInfo = await calculatePriceForQuantity(product.id, quantity);
      setCurrentPrice(priceInfo);
    } catch (err) {
      console.error('Error calculating price:', err);
    }
  };

  // Load product data on mount or when productSlug changes
  useEffect(() => {
    loadProductData();
  }, [productSlug]);

  // Update price when quantity or print selections change
  useEffect(() => {
    if (product) {
      updatePrice();
    }
  }, [quantity, product, colorSelections, printPositions, secondPosition, coverageType, selectedColor, colorOrderRows]);

  // Animate price changes (quantity, colour switch, or order row update)
  useEffect(() => {
    setAnimatePrice(true);
    const timer = setTimeout(() => setAnimatePrice(false), 300);
    return () => clearTimeout(timer);
  }, [quantity, selectedColor, colorOrderRows]);

  // Reset image selection when color changes
  useEffect(() => {
    setSelectedImage(0);
  }, [selectedColor]);

  // Sync quantityInput when quantity changes (from +/- buttons)
  useEffect(() => {
    setQuantityInput(quantity.toString());
  }, [quantity]);

  /**
   * Handle quantity change from +/- buttons
   */
  const handleQuantityChange = (value) => {
    const minQty = product?.min_order_quantity || 25;
    const newQuantity = Math.max(minQty, Math.min(10000, value));
    setQuantity(newQuantity);
  };

  /**
   * Handle manual input change - allow any value while typing
   */
  const handleQuantityInputChange = (e) => {
    setQuantityInput(e.target.value); // Allow any input while typing
  };

  /**
   * Handle blur - validate and enforce minimum
   */
  const handleQuantityBlur = () => {
    const value = parseInt(quantityInput, 10);
    const minQty = product?.min_order_quantity || 25;

    if (isNaN(value) || value < minQty) {
      setQuantity(minQty);
      setQuantityInput(minQty.toString());
    } else {
      const validValue = Math.min(10000, value);
      setQuantity(validValue);
      setQuantityInput(validValue.toString());
    }
  };

  /**
   * Handle Enter key - same as blur
   */
  const handleQuantityKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.target.blur(); // Trigger blur to validate
    }
  };

  /**
   * Handle size quantity change for apparel products
   */
  const handleSizeQuantityChange = (size, value) => {
    const qty = value === '' ? 0 : Math.max(0, parseInt(value) || 0);
    setSizeQuantities(prev => ({
      ...prev,
      [size]: qty
    }));
  };

  /**
   * Handle size quantity blur - validate input
   */
  const handleSizeQuantityBlur = (size, value) => {
    const qty = value === '' ? 0 : Math.max(0, parseInt(value) || 0);
    setSizeQuantities(prev => ({
      ...prev,
      [size]: qty
    }));
  };

  // Handle color selection for a row
  const handleColorSelectRow = (selectionId, colorId) => {
    console.log('[Color Select] Selection ID:', selectionId, 'Color ID:', colorId);
    console.log('[Color Select] Color ID type:', typeof colorId);

    // Keep colorId as string - UUIDs are strings, don't use parseInt!
    const selectedColor = colors.find(c => c.id === colorId);

    console.log('[Color Select] Found color:', selectedColor);
    console.log('[Color Select] Available colors:', colors.map(c => ({ id: c.id, name: c.color_name })));

    if (!selectedColor) {
      console.error('[Color Select] Color not found! colorId:', colorId);
      console.error('[Color Select] Available color IDs:', colors.map(c => c.id));
      return;
    }

    setColorSelections(prev => {
      const updated = prev.map(sel =>
        sel.id === selectionId
          ? {
              ...sel,
              colorId: colorId,  // Keep as string (UUID)
              colorName: selectedColor.color_name || '',
              colorHex: selectedColor.hex_value || selectedColor.color_code || ''
            }
          : sel
      );
      console.log('[Color Select] Updated selections:', updated);
      return updated;
    });
  };

  // Handle size quantity change for a specific color row
  const handleColorSizeChange = (selectionId, size, value) => {
    const numValue = value === '' ? 0 : Math.max(0, parseInt(value) || 0);
    setColorSelections(prev => prev.map(sel =>
      sel.id === selectionId
        ? { ...sel, sizes: { ...sel.sizes, [size]: numValue } }
        : sel
    ));
  };

  // Add new color row
  const handleAddColor = () => {
    if (!canAddMoreColors()) return;

    setColorSelections(prev => [...prev, {
      id: nextColorId,
      colorId: null,
      colorName: '',
      colorHex: '',
      sizes: { S: 0, M: 0, L: 0, XL: 0, XXL: 0 }
    }]);
    setNextColorId(prev => prev + 1);
  };

  // Remove color row
  const handleRemoveColor = (selectionId) => {
    if (colorSelections.length <= 1) {
      setColorSelections([{
        id: nextColorId,
        colorId: null,
        colorName: '',
        colorHex: '',
        sizes: { S: 0, M: 0, L: 0, XL: 0, XXL: 0 }
      }]);
      setNextColorId(prev => prev + 1);
      return;
    }
    setColorSelections(prev => prev.filter(sel => sel.id !== selectionId));
  };

  // Handle print position colour count change (clothing model)
  const handlePositionChange = (label, value) => {
    setPrintPositions(prev => ({ ...prev, [label]: value }));
  };

  // Colour order row handlers (clothing model)
  const handleColorOrderColorChange = (rowId, colorCode) => {
    const colorObj = colors.find(c => c.color_code === colorCode);
    setColorOrderRows(prev => prev.map(row =>
      row.id === rowId
        ? { ...row, colorId: colorObj?.id || null, colorName: colorObj?.color_name || '', colorCode }
        : row
    ));
  };

  const handleColorOrderSizeChange = (rowId, size, value) => {
    const qty = Math.max(0, parseInt(value) || 0);
    setColorOrderRows(prev => prev.map(row =>
      row.id === rowId ? { ...row, sizes: { ...row.sizes, [size]: qty } } : row
    ));
  };

  const handleColorOrderAdd = () => {
    const usedCodes = colorOrderRows.map(r => r.colorCode).filter(Boolean);
    const nextColor = colors.find(c => !usedCodes.includes(c.color_code));
    setColorOrderRows(prev => [...prev, {
      id: nextColorOrderId,
      colorId: nextColor?.id || null,
      colorName: nextColor?.color_name || '',
      colorCode: nextColor?.color_code || '',
      sizes: { S: 0, M: 0, L: 0, XL: 0, XXL: 0 }
    }]);
    setNextColorOrderId(prev => prev + 1);
  };

  const handleColorOrderRemove = (rowId) => {
    if (colorOrderRows.length <= 1) {
      setColorOrderRows([{
        id: nextColorOrderId, colorId: null, colorName: '', colorCode: '',
        sizes: { S: 0, M: 0, L: 0, XL: 0, XXL: 0 }
      }]);
      setNextColorOrderId(prev => prev + 1);
      return;
    }
    setColorOrderRows(prev => prev.filter(row => row.id !== rowId));
  };

  // Handle clicking a color swatch in Available Colors section
  const handleColorSwatchClick = (color) => {
    console.log('[Color Swatch Click] Color:', color.color_name, 'ID:', color.id);

    // Update the selected color for image display
    setSelectedColor(color.color_code);

    // Trigger color overlay for apparel
    if (isApparelProduct(product)) {
      handleColorSelect(color.color_code);
    }

    // If first color row has no color selected, auto-fill it
    if (colorSelections.length > 0 && !colorSelections[0].colorId) {
      console.log('[Color Swatch Click] Auto-filling first row with color ID:', color.id);
      handleColorSelectRow(colorSelections[0].id, color.id);  // Pass UUID string directly
    }
  };

  /**
   * Get current pricing tier for display
   */
  const getCurrentTier = () => {
    if (!pricingTiers || pricingTiers.length === 0) {
      return { price_per_unit: 0 };
    }

    return pricingTiers.find(tier =>
      quantity >= tier.min_quantity && (tier.max_quantity === null || quantity <= tier.max_quantity)
    ) || pricingTiers[0];
  };

  /**
   * Handle customize button click
   */
  const handleCustomize = () => {
    if (product?.designer_product?.product_key) {
      const url = getDesignerUrl(
        product.designer_product.product_key,
        selectedColor,
        'front'
      );
      navigate(url);
    }
  };

  /**
   * Get selected color object
   */
  const getSelectedColorObj = () => {
    return colors.find(c => c.color_code === selectedColor) || colors[0] || {};
  };

  /**
   * Check if product is apparel (needs color overlay)
   */
  const isApparelProduct = () => {
    if (!product) return false;

    const apparelSlugs = ['hoodie', 't-shirts', 'polo', 'sweatshirts'];
    return product.category?.slug === 'clothing' || apparelSlugs.includes(product.slug);
  };

  /**
   * Get white template URL for apparel products
   */
  const getWhiteTemplateUrl = (slug) => {
    // White templates follow pattern: product-templates/{slug}/white-front.png
    return `https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/${slug}/white-front.png`;
  };

  /**
   * Handle gallery thumbnail click
   */
  const handleGalleryClick = (image, index) => {
    setViewingGallery(true);
    setSelectedGalleryImage(image.medium_url || image.image_url);
    setSelectedGalleryIndex(index);
    console.log('[ProductDetail] Viewing gallery image:', image.alt_text || index);
  };

  /**
   * Handle color selection - applies overlay for apparel, filters images for generic products
   */
  const handleColorSelect = async (colorCode) => {
    console.log('[handleColorSelect] 🎨 Color changed to:', colorCode);
    setSelectedColor(colorCode);

    // Reset gallery view when color is selected
    setViewingGallery(false);
    setSelectedGalleryImage(null);
    setSelectedGalleryIndex(null);

    // Find the color object
    const selectedColorObj = colors.find(c => c.color_code === colorCode);
    if (!selectedColorObj) {
      console.log('[handleColorSelect] ⚠️ Color not found:', colorCode);
      return;
    }

    console.log('[handleColorSelect] Color object:', selectedColorObj.color_name, selectedColorObj.hex_value);

    // Check if this is an apparel product
    if (isApparelProduct() && selectedColorObj.hex_value) {
      const whiteTemplateUrl = getWhiteTemplateUrl(product.slug);

      // Check if selected color is white - skip overlay for white
      const isWhite = selectedColorObj.color_name?.toLowerCase() === 'white' ||
                     selectedColorObj.color_code?.toLowerCase() === 'white';

      if (isWhite) {
        console.log('[handleColorSelect] ✅ WHITE selected - using template directly');
        console.log('[handleColorSelect] White template URL:', whiteTemplateUrl);
        setOverlayImageUrl(whiteTemplateUrl);
        setIsApplyingOverlay(false);
        return;
      }

      // For non-white colors, apply overlay
      setIsApplyingOverlay(true);
      setOverlayImageUrl(null); // Clear previous overlay

      try {
        console.log('[ProductDetail] Applying color overlay:', {
          color: selectedColorObj.color_name,
          hex: selectedColorObj.hex_value,
          template: whiteTemplateUrl
        });

        // Apply strong color overlay (same as Designer)
        const coloredImageUrl = await applyStrongColorOverlay(
          whiteTemplateUrl,
          selectedColorObj.hex_value
        );

        setOverlayImageUrl(coloredImageUrl);

        console.log('[ProductDetail] ✅ Color overlay applied successfully');
      } catch (error) {
        console.error('[ProductDetail] Failed to apply color overlay:', error);
        // Fallback: clear overlay and show default image
        setOverlayImageUrl(null);
      } finally {
        setIsApplyingOverlay(false);
      }
    } else {
      // Non-apparel: clear overlay (existing image filtering logic will handle it)
      setOverlayImageUrl(null);
      setIsApplyingOverlay(false);
    }
  };

  /**
   * Get placeholder emoji based on category
   */
  const getPlaceholderEmoji = () => {
    if (!product?.category) return '📦';

    const categorySlug = product.category.slug;
    const emojiMap = {
      'bags': '👜',
      'cups': '☕',
      'water-bottles': '🍼',
      'clothing': '👕',
      'hi-vis': '🦺',
      'cables': '🔌',
      'power': '🔋',
      'speakers': '🔊',
      'pens': '✒️',
      'notebooks': '📓',
      'tea-towels': '🍽️'
    };

    return emojiMap[categorySlug] || '📦';
  };

  /**
   * Get images filtered by selected color
   * Returns color-specific images if available, otherwise returns all images
   */
  const getFilteredImages = () => {
    if (!images || images.length === 0) return [];

    const selectedColorObj = getSelectedColorObj();
    if (!selectedColorObj?.id) return images;

    // Filter images for the selected color
    const colorImages = images.filter(img => img.color_id === selectedColorObj.id);

    // If color-specific images exist, use them; otherwise fall back to all images
    return colorImages.length > 0 ? colorImages : images;
  };

  const currentTier = getCurrentTier();
  // For clothing, use sum of colour order rows (fall back to quantity for tier preview when no rows filled)
  const totalQuantity = product?.pricing_model === 'clothing'
    ? (clothingTotalQty > 0 ? clothingTotalQty : quantity)
    : quantity;
  const totalPrice = currentPrice ? currentPrice.total.toFixed(2) : (currentTier.price_per_unit * totalQuantity).toFixed(2);
  const isCustomizable = product ? checkProductCustomizable(product) : false;

  // Helper: get active print position labels based on max_print_positions
  const getPrintPositionLabels = () => {
    const count = product?.max_print_positions || 4;
    return ALL_POSITION_LABELS.slice(0, count);
  };

  // Determine colour_variant for print pricing lookup.
  // Check both color_code and color_name (case-insensitive) so 'White', 'WHITE', 'white' all match.
  // 'natural' explicitly uses 'coloured' pricing.
  const selectedColorObj = colors.find(c => c.color_code === selectedColor) || colors[0] || {};
  const isWhiteColour =
    selectedColorObj?.color_code?.toLowerCase() === 'white' ||
    selectedColorObj?.color_name?.toLowerCase() === 'white';
  const colourVariant = isWhiteColour ? 'white' : 'coloured';

  console.log(
    `[ColourVariant] color_code="${selectedColor}" color_name="${selectedColorObj?.color_name}" → variant="${colourVariant}"`
  );

  // Filter print pricing rows to only those matching the current colour variant
  const activePrintPricing = printPricingData.filter(p => p.colour_variant === colourVariant);
  console.log(`[ColourVariant] activePrintPricing rows: ${activePrintPricing.length} (total: ${printPricingData.length})`);

  // Helper: find matching print pricing row by quantity, colour_count, and variant (already filtered)
  const findPrintRow = (colCount, qty) =>
    activePrintPricing.find(p =>
      p.colour_count === colCount &&
      p.print_cost_per_position !== null &&
      (p.min_quantity == null || qty >= p.min_quantity) &&
      (p.max_quantity == null || qty <= p.max_quantity)
    );

  // Helper: find garment cost row for a given qty (garment_cost same across colour_counts for that tier)
  const findGarmentRow = (qty) =>
    activePrintPricing.find(p =>
      p.garment_cost != null &&
      (p.min_quantity == null || qty >= p.min_quantity) &&
      (p.max_quantity == null || qty <= p.max_quantity)
    );

  // Determine colour_variant for a specific colour code (used in blended price calculation)
  const getRowVariant = (colorCode) => {
    if (!colorCode) return 'coloured';
    const colorObj = colors.find(c => c.color_code === colorCode);
    const isWhite = colorObj?.color_code?.toLowerCase() === 'white' || colorObj?.color_name?.toLowerCase() === 'white';
    return isWhite ? 'white' : 'coloured';
  };

  // Calculate weighted-average price across all colour order rows (clothing model only)
  // Each row uses its own white/coloured variant pricing for garment cost + print cost
  const getClothingBlendedPrice = () => {
    const rowsWithQty = colorOrderRows.filter(r => getRowSubtotal(r) > 0 && r.colorCode);
    if (rowsWithQty.length === 0) return null;
    const totalQty = rowsWithQty.reduce((sum, r) => sum + getRowSubtotal(r), 0);
    if (totalQty === 0) return null;

    let weightedSum = 0;
    rowsWithQty.forEach(row => {
      const rowSubtotal = getRowSubtotal(row);
      const variant = getRowVariant(row.colorCode);
      const variantRows = printPricingData.filter(p => p.colour_variant === variant);
      if (variantRows.length === 0) return;

      const garmentRow = variantRows.find(p =>
        p.garment_cost != null &&
        (p.min_quantity == null || totalQty >= p.min_quantity) &&
        (p.max_quantity == null || totalQty <= p.max_quantity)
      );
      const garmentCost = parseFloat(garmentRow?.garment_cost ?? 0);

      let printCost = 0;
      Object.entries(printPositions).forEach(([, colOpt]) => {
        if (colOpt === 'None') return;
        const colCount = parseInt(colOpt);
        const printRow = variantRows.find(p =>
          p.colour_count === colCount &&
          p.print_cost_per_position != null &&
          (p.min_quantity == null || totalQty >= p.min_quantity) &&
          (p.max_quantity == null || totalQty <= p.max_quantity)
        );
        printCost += parseFloat(printRow?.print_cost_per_position ?? 0);
      });

      const rowPrice = garmentCost + printCost;
      console.log(`[BlendedPrice] ${row.colorName} (${variant}) × ${rowSubtotal} @ £${rowPrice.toFixed(2)}`);
      weightedSum += rowPrice * rowSubtotal;
    });

    const blended = weightedSum / totalQty;
    console.log(`[BlendedPrice] Weighted avg: £${blended.toFixed(2)} (${totalQty} units)`);
    return blended;
  };

  // Calculate effective price per unit including print costs
  const getEffectivePricePerUnit = () => {
    // Fallback to tier price when no print pricing data exists for this product
    const tierBase = parseFloat(currentPrice?.price_per_unit || currentTier.price_per_unit) || 0;

    if (!product || activePrintPricing.length === 0) {
      if (printPricingData.length > 0) {
        console.log(`[PrintCost] variant="${colourVariant}" — no rows matched, falling back to tier price £${tierBase}`);
      }
      return tierBase;
    }

    if (product.pricing_model === 'clothing') {
      // Use weighted-average blended price when colour order rows have quantities filled in
      const blended = getClothingBlendedPrice();
      if (blended !== null) return blended;

      // Single-colour fallback: use the currently selected swatch variant
      const garmentRow = findGarmentRow(totalQuantity);
      const garmentCost = parseFloat(garmentRow?.garment_cost ?? 0);

      let totalPrintCost = 0;
      Object.entries(printPositions).forEach(([pos, colOpt]) => {
        if (colOpt === 'None') return;
        const colCount = parseInt(colOpt);
        const printRow = findPrintRow(colCount, totalQuantity);
        const printCost = parseFloat(printRow?.print_cost_per_position ?? 0);
        console.log(
          `[PrintCost] ${pos} ${colOpt} col | matched row: qty=${printRow?.min_quantity}-${printRow?.max_quantity ?? '∞'} variant=${colourVariant} → print £${printCost}`
        );
        totalPrintCost += printCost;
      });

      const total = garmentCost + totalPrintCost;
      console.log(
        `[PrintCost] TOTAL: garment £${garmentCost} + print £${totalPrintCost} = £${total.toFixed(2)}` +
        ` (qty=${totalQuantity}, variant="${colourVariant}")`
      );
      return total;
    }

    if (product.pricing_model === 'flat' && (product.max_print_positions || 1) >= 2 && secondPosition) {
      const row = activePrintPricing.find(p => p.extra_position_price != null);
      console.log(`[PrintCost] Extra position → £${row?.extra_position_price ?? 0}`);
      return tierBase + parseFloat(row?.extra_position_price ?? 0);
    }

    if (product.pricing_model === 'coverage') {
      const row = activePrintPricing.find(p => p.coverage_type === coverageType);
      console.log(`[PrintCost] Coverage ${coverageType} → £${row?.coverage_price_per_unit ?? tierBase}`);
      return row ? parseFloat(row.coverage_price_per_unit) : tierBase;
    }

    return tierBase;
  };

  const effectivePricePerUnit = getEffectivePricePerUnit();
  const effectiveTotalPrice = (effectivePricePerUnit * totalQuantity).toFixed(2);

  // Build breakdown string for clothing model
  const getPrintBreakdown = () => {
    if (product?.pricing_model !== 'clothing') return null;
    const parts = Object.entries(printPositions)
      .filter(([, v]) => v !== 'None')
      .map(([pos, col]) => `${pos} (${col})`);
    return parts.length ? parts.join(' + ') : null;
  };
  const filteredImages = getFilteredImages();

  // Loading State
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <Loader className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600 text-lg">Loading product data...</p>
        </div>
      </div>
    );
  }

  // Error State
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Error Loading Product</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={loadProductData}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
          <p className="text-sm text-gray-500 mt-4">
            Need to seed data? Visit <a href="/admin/seed-data" className="text-blue-600 hover:underline">/admin/seed-data</a>
          </p>
        </div>
      </div>
    );
  }

  // No product data
  if (!product) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Product not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate(-1)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <h1 className="text-xl font-bold text-gray-900">Back to Products</h1>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setIsLiked(!isLiked)}
                className={`p-3 rounded-full transition-all duration-300 ${
                  isLiked
                    ? 'bg-red-500 text-white shadow-lg shadow-red-500/25'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <Heart className={`h-5 w-5 ${isLiked ? 'fill-current' : ''}`} />
              </button>
              <button className="p-3 bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200 transition-colors">
                <Share2 className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8">
        <div className="flex flex-col lg:grid lg:grid-cols-12 lg:gap-8 gap-4">

          {/* Product Images */}
          <div className="lg:col-span-5 w-full">
            <div className="lg:sticky lg:top-24">
              {/* Badge */}
              {product.badge && (
                <div className="absolute top-4 left-4 z-10">
                  <span className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-4 py-2 rounded-full text-sm font-bold shadow-lg">
                    {product.badge}
                  </span>
                </div>
              )}

              {/* Main Image */}
              <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-3xl p-12 mb-6 aspect-square flex items-center justify-center relative overflow-hidden group max-h-[50vh] lg:max-h-none">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>

                {/* Priority: Gallery image > Color overlay > Filtered product images > Placeholder */}
                {viewingGallery && selectedGalleryImage ? (
                  <img
                    src={selectedGalleryImage}
                    alt={`${product.name} - Gallery`}
                    className="max-w-full max-h-full object-contain transform transition-all duration-700 group-hover:scale-110 relative z-10"
                  />
                ) : overlayImageUrl ? (
                  <img
                    src={overlayImageUrl}
                    alt={`${product.name} - ${getSelectedColorObj().color_name}`}
                    className="max-w-full max-h-full object-contain transform transition-all duration-700 group-hover:scale-110 relative z-10"
                  />
                ) : filteredImages.length > 0 && filteredImages[selectedImage]?.image_url ? (
                  <img
                    src={filteredImages[selectedImage].medium_url || filteredImages[selectedImage].image_url}
                    alt={filteredImages[selectedImage].alt_text || product.name}
                    className="max-w-full max-h-full object-contain transform transition-all duration-700 group-hover:scale-110 relative z-10"
                  />
                ) : (
                  <div className="text-9xl transform transition-all duration-700 group-hover:scale-110 group-hover:rotate-12 relative z-10" style={{ color: getSelectedColorObj().hex_value || '#1a1a1a' }}>
                    {getPlaceholderEmoji()}
                  </div>
                )}

                {/* Loading overlay while applying color */}
                {isApplyingOverlay && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm z-20">
                    <div className="text-center">
                      <Loader className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-2" />
                      <p className="text-sm text-gray-600 font-medium">Applying color...</p>
                    </div>
                  </div>
                )}

                {/* Floating elements for visual appeal */}
                <div className="absolute top-8 right-8 w-4 h-4 bg-blue-400 rounded-full opacity-30 animate-pulse"></div>
                <div className="absolute bottom-12 left-8 w-6 h-6 bg-purple-400 rounded-full opacity-20 animate-bounce" style={{ animationDelay: '1s' }}></div>
              </div>

              {/* Gallery Thumbnails - Only show actual gallery images */}
              {galleryImages.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Gallery</h4>
                  <div className="flex space-x-4 overflow-x-auto pb-2 lg:overflow-x-visible">
                    {/* Gallery Image Thumbnails - show up to 4 images */}
                    {galleryImages.slice(0, 4).map((image, index) => (
                      <button
                        key={image.id || index}
                        onClick={() => handleGalleryClick(image, index)}
                        className={`flex-1 aspect-square bg-gray-100 rounded-xl p-4 border-2 transition-all duration-300 ${
                          viewingGallery && selectedGalleryIndex === index
                            ? 'border-blue-500 shadow-lg shadow-blue-500/25 ring-2 ring-blue-500 ring-offset-2'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                        title={image.alt_text || `Gallery ${index + 1}`}
                      >
                        {image.thumbnail_url || image.image_url ? (
                          <img
                            src={image.thumbnail_url || image.image_url}
                            alt={image.alt_text || `Gallery ${index + 1}`}
                            className="w-full h-full object-cover rounded"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-2xl">
                            📷
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Customize Button (if customizable) */}
              {isCustomizable && (
                <div className="mt-6 bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl p-6 border border-purple-200/50 shadow-lg">
                  <div className="flex items-center space-x-3 mb-4">
                    <div className="bg-gradient-to-r from-purple-500 to-pink-500 w-10 h-10 rounded-lg flex items-center justify-center">
                      <Palette className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900">Customize This Product</h3>
                      <p className="text-sm text-gray-600">Add your logo & design</p>
                    </div>
                  </div>

                  <button
                    onClick={handleCustomize}
                    className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 px-4 rounded-lg font-semibold hover:from-purple-600 hover:to-pink-600 transition-all duration-300 shadow-md hover:shadow-lg transform hover:scale-105"
                  >
                    Open Designer
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Product Info */}
          <div className="lg:col-span-4 w-full space-y-8">

            {/* Basic Info */}
            <div>
              <h1 className="text-2xl lg:text-4xl font-bold text-gray-900 mb-2">{product.name}</h1>
              {product.subtitle && <p className="text-xl text-gray-600 mb-4">{product.subtitle}</p>}

              {/* Rating */}
              {product.rating > 0 && (
                <div className="flex items-center space-x-4 mb-6">
                  <div className="flex items-center space-x-1">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className={`h-5 w-5 ${i < Math.floor(product.rating) ? 'text-yellow-400 fill-current' : 'text-gray-300'}`} />
                    ))}
                    <span className="ml-2 text-lg font-semibold text-gray-900">{product.rating}</span>
                  </div>
                  {product.review_count > 0 && (
                    <span className="text-gray-500">({product.review_count.toLocaleString()} reviews)</span>
                  )}
                </div>
              )}

              {product.description && <p className="text-gray-700 leading-relaxed">{product.description}</p>}
            </div>

            {/* Color Selection - Hide for apparel products */}
            {!isApparelProduct(product) && colors.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Choose Color</h3>
                <div className="flex flex-wrap gap-3">
                  {(() => {
                    const MAX_COLORS_COLLAPSED = 12; // 2 rows of 6
                    const hasMoreColors = colors.length > MAX_COLORS_COLLAPSED;
                    const visibleColors = colorsExpanded
                      ? colors
                      : colors.slice(0, MAX_COLORS_COLLAPSED);

                    return visibleColors.map((color) => (
                      <button
                        key={color.id}
                        onClick={() => handleColorSelect(color.color_code)}
                        disabled={isApplyingOverlay}
                        className={`relative w-12 h-12 rounded-full border-2 transition-all duration-300 flex items-center justify-center ${
                          selectedColor === color.color_code
                            ? 'border-gray-900 shadow-lg scale-110 ring-2 ring-blue-500 ring-offset-2'
                            : 'border-gray-300 hover:border-gray-400 hover:scale-105'
                        } ${isApplyingOverlay ? 'opacity-50 cursor-not-allowed' : ''}`}
                        style={{ backgroundColor: color.hex_value }}
                        title={color.color_name}
                      >
                        {selectedColor === color.color_code && (
                          <Check className="h-6 w-6 text-white drop-shadow-lg" strokeWidth={3} />
                        )}
                      </button>
                    ));
                  })()}
                </div>

                {/* See more/less colors button */}
                {(() => {
                  const MAX_COLORS_COLLAPSED = 12;
                  const hasMoreColors = colors.length > MAX_COLORS_COLLAPSED;

                  if (hasMoreColors) {
                    return (
                      <button
                        onClick={() => setColorsExpanded(!colorsExpanded)}
                        className="text-sm text-blue-600 hover:text-blue-800 mt-3 flex items-center gap-1 font-medium transition-colors"
                      >
                        {colorsExpanded ? (
                          <>
                            See less colors
                            <ChevronUp className="w-4 h-4" />
                          </>
                        ) : (
                          <>
                            See more colors ({colors.length - MAX_COLORS_COLLAPSED} more)
                            <ChevronDown className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    );
                  }
                  return null;
                })()}

                <p className="text-sm text-gray-600 mt-3 font-medium">
                  Selected: <span className="text-gray-900">{getSelectedColorObj().color_name || 'N/A'}</span>
                  {isApplyingOverlay && <span className="ml-2 text-blue-600">(Applying color...)</span>}
                </p>
              </div>
            )}

            {/* For apparel, show available colors as reference */}
            {isApparelProduct(product) && colors.length > 0 && (
              <div className='mb-6'>
                <h3 className='text-sm font-medium text-gray-700 mb-3'>Available Colors</h3>
                <div className='flex flex-wrap gap-2'>
                  {(showAllColors ? colors : colors.slice(0, 12)).map(color => (
                    <button
                      key={color.id}
                      onClick={() => handleColorSwatchClick(color)}
                      className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 hover:shadow-md
                        ${selectedColor === color.color_code
                          ? 'border-blue-500 ring-2 ring-blue-200'
                          : 'border-gray-300 hover:border-gray-400'}`}
                      style={{ backgroundColor: color.hex_value || color.color_code }}
                      title={color.color_name}
                    />
                  ))}
                </div>

                {/* See more / Show less toggle */}
                {colors.length > 12 && (
                  <button
                    onClick={() => setShowAllColors(!showAllColors)}
                    className='text-sm text-blue-600 hover:text-blue-800 mt-2 flex items-center gap-1'
                  >
                    {showAllColors ? 'Show less' : `See more colors (${colors.length - 12} more)`}
                    <svg
                      className={`w-4 h-4 transition-transform ${showAllColors ? 'rotate-180' : ''}`}
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M19 9l-7 7-7-7' />
                    </svg>
                  </button>
                )}

                {/* Selected color name */}
                {selectedColor && (
                  <p className='text-sm text-gray-600 mt-2'>
                    Selected: <span className='font-medium'>{getSelectedColorObj().color_name}</span>
                  </p>
                )}
              </div>
            )}

            {/* Features */}
            {features.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Key Features</h3>
                <div className="grid grid-cols-2 gap-3">
                  {features.map((feature, index) => (
                    <div key={index} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                      <Check className="h-5 w-5 text-green-500 flex-shrink-0" />
                      <span className="text-sm text-gray-700">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tabs */}
            <div>
              <div className="flex space-x-1 mb-6 bg-gray-100 p-1 rounded-lg">
                {['details', 'specs'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all duration-300 ${
                      activeTab === tab
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {tab === 'details' ? 'Product Details' : 'Specifications'}
                  </button>
                ))}
              </div>

              {activeTab === 'details' && (
                <div className="space-y-4">
                  <div className="flex items-center space-x-3 p-4 bg-blue-50 rounded-lg">
                    <Zap className="h-6 w-6 text-blue-500" />
                    <div>
                      <h4 className="font-semibold text-gray-900">Premium Quality</h4>
                      <p className="text-sm text-gray-600">Durable construction with excellent craftsmanship</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 p-4 bg-green-50 rounded-lg">
                    <Shield className="h-6 w-6 text-green-500" />
                    <div>
                      <h4 className="font-semibold text-gray-900">Eco-Friendly</h4>
                      <p className="text-sm text-gray-600">Made from sustainable materials</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 p-4 bg-purple-50 rounded-lg">
                    <Truck className="h-6 w-6 text-purple-500" />
                    <div>
                      <h4 className="font-semibold text-gray-900">Free Delivery</h4>
                      <p className="text-sm text-gray-600">Express delivery on orders over £250</p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'specs' && (
                <div className="space-y-3">
                  {Object.keys(specifications).length > 0 ? (
                    Object.entries(specifications).map(([key, value]) => (
                      <div key={key} className="flex justify-between py-3 border-b border-gray-100 last:border-0">
                        <span className="text-gray-600 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                        <span className="font-semibold text-gray-900">{value}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-gray-500 text-center py-4">No specifications available</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Pricing Panel */}
          <div className="lg:col-span-3 w-full">
            <div className="lg:sticky lg:top-24">
              <div className="bg-white rounded-3xl shadow-xl border border-gray-200/50 overflow-hidden">

                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-blue-700 p-6 text-white">
                  <h3 className="text-xl font-bold mb-2">Configure & Quote</h3>
                  <p className="text-blue-100 text-sm">Bulk pricing available</p>
                </div>

                <div className="p-4 lg:p-6 space-y-6">

                  {/* Quantity / Colour Order Selector */}
                  {product.pricing_model === 'clothing' ? (
                    /* Clothing: inline colour + size inputs per row */
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Configure Your Order</label>

                      <div className="space-y-3">
                        {colorOrderRows.map((row) => {
                          const rowSubtotal = getRowSubtotal(row);
                          const rowColorObj = colors.find(c => c.color_code === row.colorCode);
                          const dotColor = rowColorObj?.hex_value || '#e5e7eb';
                          return (
                            <div key={row.id}>
                              {/* Line 1: colour dot + dropdown + delete */}
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-3 h-3 rounded-full flex-shrink-0 border border-gray-300"
                                  style={{ backgroundColor: dotColor }}
                                />
                                <select
                                  value={row.colorCode || ''}
                                  onChange={(e) => handleColorOrderColorChange(row.id, e.target.value)}
                                  className="flex-1 border border-gray-300 rounded-lg py-1.5 px-2 text-sm focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                                >
                                  {colors.map(c => (
                                    <option key={c.id} value={c.color_code}>{c.color_name}</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => handleColorOrderRemove(row.id)}
                                  className="w-6 h-6 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                                  title="Remove row"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              {/* Line 2: size inputs with labels above each, centred */}
                              <div className="mt-1.5 pl-5 flex items-end justify-center gap-3">
                                {APPAREL_SIZES.map(size => (
                                  <div key={size} className="flex flex-col items-center gap-0.5">
                                    <span className="text-[10px] font-medium text-gray-400">{size}</span>
                                    <input
                                      type="number"
                                      min="0"
                                      value={row.sizes[size] || ''}
                                      onChange={(e) => handleColorOrderSizeChange(row.id, size, e.target.value)}
                                      placeholder="0"
                                      className="w-9 h-8 text-center border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <button
                        onClick={handleColorOrderAdd}
                        className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Another Colour
                      </button>

                      <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-700">Combined Total</span>
                        <span className={`text-2xl font-bold ${clothingTotalQty >= 25 ? 'text-green-600' : 'text-gray-900'}`}>
                          {clothingTotalQty} <span className="text-sm font-medium">units</span>
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Minimum order: 25 units combined</p>
                    </div>
                  ) : (
                    /* Standard quantity +/- for all other products */
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-3">Quantity</label>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleQuantityChange(quantity - 1)}
                          className="w-9 h-9 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors border border-gray-200"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <input
                          type="text"
                          value={quantityInput}
                          onChange={handleQuantityInputChange}
                          onBlur={handleQuantityBlur}
                          onKeyDown={handleQuantityKeyDown}
                          className="w-20 h-9 text-center border border-gray-300 rounded-lg font-semibold text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder={product?.min_order_quantity?.toString() || '25'}
                        />
                        <button
                          onClick={() => handleQuantityChange(quantity + 1)}
                          className="w-9 h-9 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors border border-gray-200"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 mt-2 text-center">Minimum order: {product?.min_order_quantity || 25} units</p>
                    </div>
                  )}

                  {/* CLOTHING MODEL: Print Positions — always shown for clothing products */}
                  {product.pricing_model === 'clothing' && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-3">Print Positions</h4>
                      <div className="space-y-2">
                        {getPrintPositionLabels().map((label) => (
                          <div key={label} className="flex items-center justify-between gap-2">
                            <span className="text-sm text-gray-600 w-24 flex-shrink-0">{label}</span>
                            <select
                              value={printPositions[label] || 'None'}
                              onChange={(e) => handlePositionChange(label, e.target.value)}
                              className="flex-1 border border-gray-300 rounded-lg py-1.5 px-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                              {COLOUR_OPTIONS.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* FLAT / COVERAGE models: only shown when print pricing data exists in DB */}
                  {printPricingData.length > 0 && (
                    <>
                      {/* FLAT MODEL: optional second position checkbox */}
                      {product.pricing_model === 'flat' && (product.max_print_positions || 1) >= 2 && (
                        <div>
                          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-gray-200 hover:border-blue-300 transition-colors">
                            <input
                              type="checkbox"
                              checked={secondPosition}
                              onChange={(e) => setSecondPosition(e.target.checked)}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <div>
                              <span className="text-sm font-medium text-gray-700">Add second position</span>
                              <span className="text-sm text-gray-500 ml-1">(Front &amp; Back)</span>
                            </div>
                          </label>
                        </div>
                      )}

                      {/* COVERAGE MODEL: radio buttons */}
                      {product.pricing_model === 'coverage' && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-700 mb-3">Coverage</h4>
                          <div className="space-y-2">
                            {[
                              { value: 'front_only', label: 'Front Only' },
                              { value: 'front_back', label: 'Front & Back' },
                              { value: 'full_wrap', label: 'Full Wrap' },
                            ].map(({ value, label }) => (
                              <label key={value} className="flex items-center gap-3 cursor-pointer">
                                <input
                                  type="radio"
                                  name="coverage_type"
                                  value={value}
                                  checked={coverageType === value}
                                  onChange={() => setCoverageType(value)}
                                  className="w-4 h-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm text-gray-700">{label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Price Display */}
                  <div className="text-center p-6 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl">
                    <div className="mb-2">
                      <span className="text-sm text-gray-600">Price per unit</span>
                    </div>
                    <div className={`text-3xl font-bold text-blue-600 transition-all duration-300 ${animatePrice ? 'scale-110' : 'scale-100'}`}>
                      £{effectivePricePerUnit.toFixed(2)}
                    </div>
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Total:</span>
                        <span className="text-2xl font-bold text-gray-900">£{effectiveTotalPrice}</span>
                      </div>
                      {/* Print breakdown for clothing model */}
                      {getPrintBreakdown() && (
                        <p className="text-xs text-gray-500 mt-2 text-center">{getPrintBreakdown()}</p>
                      )}
                      {/* Colour/quantity breakdown for clothing model */}
                      {product?.pricing_model === 'clothing' && (() => {
                        const parts = colorOrderRows
                          .filter(r => getRowSubtotal(r) > 0 && r.colorName)
                          .map(r => `${r.colorName} x ${getRowSubtotal(r)}`);
                        return parts.length > 0
                          ? <p className="text-xs text-gray-500 mt-1 text-center">{parts.join(' + ')}</p>
                          : null;
                      })()}
                    </div>
                  </div>


                  {/* Action Buttons */}
                  <div className="space-y-3">
                    <button
                      disabled={!isOrderValid()}
                      className={`w-full py-4 rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 flex items-center justify-center space-x-2 ${
                        !isOrderValid()
                          ? 'bg-gray-300 cursor-not-allowed text-gray-500'
                          : 'bg-gradient-to-r from-blue-600 via-purple-600 to-blue-700 text-white hover:from-blue-700 hover:via-purple-700 hover:to-blue-800'
                      }`}
                    >
                      <ShoppingCart className="h-5 w-5" />
                      <span>{!isOrderValid()
                        ? `Add ${(product?.pricing_model === 'clothing' ? 25 : (product?.min_order_quantity || 25)) - (product?.pricing_model === 'clothing' ? clothingTotalQty : totalQuantity)} more units`
                        : 'Add to Quote'}</span>
                    </button>

                    <button className="w-full border-2 border-gray-300 text-gray-700 py-4 rounded-xl font-semibold hover:border-gray-400 hover:bg-gray-50 transition-all duration-300">
                      Request Sample
                    </button>
                  </div>

                  {/* Trust Badges */}
                  <div className="pt-4 border-t border-gray-200">
                    <div className="grid grid-cols-2 gap-4 text-center">
                      <div>
                        <div className="text-2xl mb-1">🚚</div>
                        <div className="text-xs text-gray-600 font-medium">Free Delivery</div>
                      </div>
                      <div>
                        <div className="text-2xl mb-1">⭐</div>
                        <div className="text-xs text-gray-600 font-medium">5-Star Rated</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact Card */}
              <div className="mt-6 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl p-6 text-white">
                <h4 className="font-bold text-lg mb-2">Need Help?</h4>
                <p className="text-gray-300 text-sm mb-4">Speak to our promotional experts</p>
                <button className="w-full bg-white text-gray-900 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-colors">
                  📞 Call Now: 01844 600900
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetailPage;
