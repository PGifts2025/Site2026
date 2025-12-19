
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { fabric } from 'fabric';
import { jsPDF } from 'jspdf';
import { isMockAuth } from '../config/supabase';
import { createMockSupabase } from '../utils/mockAuth';
import productsConfig from '../config/products.json';
import { applyColorOverlay, needsColorOverlay, getOptimalIntensity } from '../utils/colorOverlay';
import { cacheColoredImage, getCachedImage } from '../utils/imageCache';
import { useCart } from '../context/CartContext';
import {
  getProductTemplates,
  getPrintAreasByProductView,
  saveUserDesign,
  getUserDesigns,
  getUserDesign,
  updateUserDesign,
  deleteUserDesign,
  migrateSessionDesignsToUser,
  getSessionId,
  testProductTemplatesWithServiceRole,
  getProductColors,
  supabase as supabaseClient
} from '../services/supabaseService';
import {
  Upload,
  Download,
  RotateCcw,
  RotateCw,
  Trash2,
  Move,
  Square,
  Circle,
  Type,
  Palette,
  User,
  LogIn,
  LogOut,
  Eye,
  EyeOff,
  Save,
  FileImage,
  FileText,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  FolderOpen,
  Edit2,
  Plus,
  X,
  Loader,
  ShoppingCart
} from 'lucide-react';

// Use shared Supabase client from supabaseService (singleton pattern)
const supabase = isMockAuth ? createMockSupabase() : supabaseClient;

const Designer = () => {
  const canvasRef = useRef(null);
  const canvasContainerRef = useRef(null);
  const fileInputRef = useRef(null);
  const canvasReady = useRef(false);
  const renderingRef = useRef(false);
  const [canvas, setCanvas] = useState(null);
  const [canvasSize, setCanvasSize] = useState(800);
  const [selectedProduct, setSelectedProduct] = useState('tshirt');
  const [selectedColor, setSelectedColor] = useState('#ffffff');
  const [selectedView, setSelectedView] = useState('front'); // Actual view loaded ('front' or 'back')
  const [selectedViewButton, setSelectedViewButton] = useState('front'); // Which button is active ('front', 'left', 'right', 'back')
  const [activePrintArea, setActivePrintArea] = useState('Center Chest'); // Which print area is active
  const [printAreasVisible, setPrintAreasVisible] = useState(true); // Whether print areas are visible (toggle with double-click)
  const [printArea, setPrintArea] = useState('front');
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [watermarkVisible, setWatermarkVisible] = useState(true);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [templateRendering, setTemplateRendering] = useState(false);

  // Database products
  const [products, setProducts] = useState({});
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [useDatabase, setUseDatabase] = useState(true);

  // Product Colors from Database
  const [productColors, setProductColors] = useState([]);

  // Cart functionality
  const { addToCart, openCart } = useCart();
  const [loadingColors, setLoadingColors] = useState(false);
  const [changingColor, setChangingColor] = useState(false); // Loading state for color changes
  const [selectedColorId, setSelectedColorId] = useState(null);
  const [currentColorData, setCurrentColorData] = useState(null);
  const [currentVariant, setCurrentVariant] = useState(null);
  const [printAreas, setPrintAreas] = useState([]);
  const [printAreasLoaded, setPrintAreasLoaded] = useState(false);  // Track if print areas have loaded from DB
  const [imageScale, setImageScale] = useState(1);  // Track template image scale
  const [showPrintAreaGuide, setShowPrintAreaGuide] = useState(true);  // Toggle print area guide visibility
  const [userDesigns, setUserDesigns] = useState({});  // Track designs per product-color-view combination

  // Zoom controls
  const [zoomLevel, setZoomLevel] = useState(1.0);  // 1.0 = 100%
  const MIN_ZOOM = 0.5;   // 50%
  const MAX_ZOOM = 2.0;   // 200%
  const ZOOM_STEP = 0.1;  // 10% per step

  // Save position status
  const [saveStatus, setSaveStatus] = useState(null);

  // Text editing controls
  const [textColor, setTextColor] = useState('#000000');
  const [textFont, setTextFont] = useState('Arial');
  const [textAlign, setTextAlign] = useState('left');
  const [selectedObject, setSelectedObject] = useState(null);

  // Design persistence state
  // TEMPORARILY DISABLED: Design persistence features (Prompt 2.7)
  // These will be re-enabled after fixing the infinite remount loop
  // const [savedDesigns, setSavedDesigns] = useState([]);
  // const [loadingDesigns, setLoadingDesigns] = useState(false);
  // const [showSaveModal, setShowSaveModal] = useState(false);
  // const [showMyDesigns, setShowMyDesigns] = useState(false);
  // const [designName, setDesignName] = useState('');
  // const [savingDesign, setSavingDesign] = useState(false);
  // const [saveStatus, setSaveStatus] = useState(''); // 'saving', 'saved', 'error'
  // const [currentDesignId, setCurrentDesignId] = useState(null); // Track if editing existing design
  // const [showMigratePrompt, setShowMigratePrompt] = useState(false);
  // const [anonymousDesignCount, setAnonymousDesignCount] = useState(0);

  // Get current product configuration (from database or JSON fallback)
  // Use useMemo to stabilize the object reference and prevent infinite re-renders
  const currentProduct = useMemo(() => {
    return useDatabase && products[selectedProduct]
      ? products[selectedProduct]
      : productsConfig[selectedProduct];
  }, [useDatabase, products, selectedProduct]);

  const currentPrintArea = useMemo(() => {
    return currentProduct?.printAreas?.[printArea] || Object.values(currentProduct?.printAreas || {})[0];
  }, [currentProduct, printArea]);

  // Debug: Monitor products state changes
  useEffect(() => {
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║ [Designer] 🔍 PRODUCTS STATE CHANGED              ║');
    console.log('╠═══════════════════════════════════════════════════╣');
    console.log('║ Products count:', Object.keys(products).length);
    console.log('║ Product keys:', Object.keys(products));
    console.log('║ useDatabase:', useDatabase);
    console.log('║ loadingProducts:', loadingProducts);
    console.log('║ selectedProduct:', selectedProduct);
    console.log('╚═══════════════════════════════════════════════════╝');
  }, [products]);

  // Debug: Monitor useDatabase state changes
  useEffect(() => {
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║ [Designer] 🔄 useDatabase STATE CHANGED           ║');
    console.log('╠═══════════════════════════════════════════════════╣');
    console.log('║ useDatabase:', useDatabase);
    console.log('║ Products count:', Object.keys(products).length);
    console.log('╚═══════════════════════════════════════════════════╝');
  }, [useDatabase]);

  // Debug: Monitor overall Designer state
  useEffect(() => {
    console.log('═══ DESIGNER STATE ═══');
    console.log('Selected Product:', selectedProduct, currentProduct?.name || 'N/A');
    console.log('Product Colors:', productColors?.length || 0);
    console.log('Selected Color:', currentColorData?.color_name || 'N/A');
    console.log('Selected View:', selectedView);
    console.log('Print Areas Loaded:', printAreasLoaded, 'Count:', printAreas?.length || 0);
    console.log('══════════════════════');
  }, [selectedProduct, productColors, currentColorData, selectedView, printAreas, printAreasLoaded]);

  // Load products from database
  useEffect(() => {
    const loadProductsFromDatabase = async () => {
      console.log('═══════════════════════════════════════════════════');
      console.log('[Designer] 🔄 STARTING loadProductsFromDatabase()');
      console.log('[Designer] Current state:', {
        loadingProducts,
        useDatabase,
        productsCount: Object.keys(products).length
      });
      console.log('═══════════════════════════════════════════════════');

      // TEMPORARY TEST - Testing service role access
      console.log('[Designer] 🧪 Testing service role access...');
      const testResult = await testProductTemplatesWithServiceRole();
      console.log('[Designer] 🧪 Test result:', testResult);

      setLoadingProducts(true);
      try {
        console.log('[Designer] 📡 Calling getProductTemplates()...');
        const { data: templates, error } = await getProductTemplates();

        console.log('[Designer] 📥 RAW RESPONSE from getProductTemplates():');
        console.log('  - Error:', error?.message);
        console.log('  - Type:', typeof templates);
        console.log('  - Is Array:', Array.isArray(templates));
        console.log('  - Length:', templates?.length);
        console.log('  - Full data:', JSON.stringify(templates, null, 2));

        if (error || !templates || templates.length === 0) {
          console.error('[Designer] ❌ No products in database, using JSON fallback');
          if (error) console.error('[Designer] Error details:', error);
          console.log('[Designer] Fallback to productsConfig:', Object.keys(productsConfig));
          setUseDatabase(false);
          setLoadingProducts(false);
          return;
        }

        console.log(`[Designer] ✅ Loaded ${templates.length} templates from database`);
        console.log('[Designer] Template details:');
        templates.forEach((t, idx) => {
          console.log(`  ${idx + 1}. ${t.name} (key: ${t.product_key}, id: ${t.id})`);
        });

        // Convert templates to Designer format
        const productsMap = {};
        console.log('[Designer] 🔧 Converting templates to Designer format...');

        for (const template of templates) {
          console.log(`\n[Designer] Processing template: ${template.product_key}`);

          // Create product structure WITHOUT loading variants
          // Colors will be loaded separately via getProductColors
          const productData = {
            id: template.id,
            product_key: template.product_key,
            name: template.name,
            template: template.template_url,
            basePrice: template.base_price,
            colors: [], // Will be populated from product_template_colors
            description: template.description,
            minOrderQty: template.min_order_qty
          };

          console.log(`[Designer]   Created product structure:`, productData);
          productsMap[template.product_key] = productData;
          console.log(`[Designer]   ✅ Added to productsMap with key: "${template.product_key}"`);
        }

        console.log('\n═══════════════════════════════════════════════════');
        console.log('[Designer] 🎉 FINAL PRODUCTS MAP:');
        console.log('[Designer] Product keys:', Object.keys(productsMap));
        console.log('[Designer] Product count:', Object.keys(productsMap).length);
        console.log('[Designer] Full productsMap:', JSON.stringify(productsMap, null, 2));
        console.log('═══════════════════════════════════════════════════\n');

        console.log('[Designer] 📝 Setting state...');
        console.log('[Designer]   - setProducts(productsMap) with', Object.keys(productsMap).length, 'products');
        setProducts(productsMap);

        console.log('[Designer]   - setUseDatabase(true)');
        setUseDatabase(true);

        // Set first product as selected if available
        const firstKey = Object.keys(productsMap)[0];
        console.log('[Designer] 🎯 Setting initial product selection...');
        console.log('[Designer]   - First product key:', firstKey);

        if (firstKey) {
          console.log('[Designer]   - setSelectedProduct:', firstKey);
          setSelectedProduct(firstKey);

          const firstProduct = productsMap[firstKey];
          console.log('[Designer]   - First product data:', firstProduct);

          // Colors will be loaded separately via getProductColors effect
          console.log('[Designer]   - Colors will be loaded separately via useEffect');

          // Set default view to 'front'
          console.log('[Designer]   - setSelectedView: front (default)');
          setSelectedView('front');
          console.log('[Designer] ✅ Initial selection complete:', {
            view: 'front',
            product: firstProduct.name
          });
        }

        console.log('[Designer] ✅ setLoadingProducts(false)');
        setLoadingProducts(false);

        console.log('\n═══════════════════════════════════════════════════');
        console.log('[Designer] 🎊 LOAD COMPLETE!');
        console.log('[Designer] Final state should be:');
        console.log('  - useDatabase: true');
        console.log('  - products:', Object.keys(productsMap).length, 'items');
        console.log('  - loadingProducts: false');
        console.log('═══════════════════════════════════════════════════\n');

      } catch (error) {
        console.error('\n═══════════════════════════════════════════════════');
        console.error('[Designer] ❌ ERROR loading products from database:');
        console.error('[Designer] Error type:', error.constructor.name);
        console.error('[Designer] Error message:', error.message);
        console.error('[Designer] Error stack:', error.stack);
        console.error('═══════════════════════════════════════════════════\n');
        setUseDatabase(false);
        setLoadingProducts(false);
      }
    };

    loadProductsFromDatabase();
  }, []);

  // Load product colors from database when product changes
  useEffect(() => {
    const loadColorsForProduct = async (productId) => {
      console.log('[loadColorsForProduct] Loading for product ID:', productId);

      try {
        // STEP 1: Try loading from product_template_colors (APPAREL products)
        const { data: apparelData, error: apparelError } = await supabase
          .from('product_template_colors')
          .select(`
            id,
            product_template_id,
            apparel_color_id,
            apparel_colors!inner (
              id,
              color_name,
              hex_code
            )
          `)
          .eq('product_template_id', productId)
          .not('apparel_color_id', 'is', null);

        if (apparelError) {
          console.error('[loadColorsForProduct] Apparel query error:', apparelError);
          throw apparelError;
        }

        console.log('[loadColorsForProduct] Apparel data:', apparelData);

        // If apparel colors found, use them
        if (apparelData && apparelData.length > 0) {
          console.log('[loadColorsForProduct] ✓ Found APPAREL colors');

          // Map to simple color objects
          const colors = apparelData.map(ptc => {
            if (!ptc.apparel_colors) {
              console.warn('[loadColorsForProduct] Missing apparel_colors for:', ptc);
              return null;
            }
            return {
              id: ptc.apparel_colors.id,
              color_name: ptc.apparel_colors.color_name,
              hex_code: ptc.apparel_colors.hex_code,
              is_apparel: true // Mark as apparel product
            };
          });

          // Validate colors
          const validColors = colors.filter(color => {
            const isValid = color && color.id && color.color_name && color.hex_code;
            if (!isValid) {
              console.warn('[loadColorsForProduct] ⚠️ Invalid apparel color:', color);
            }
            return isValid;
          });

          console.log('[loadColorsForProduct] ✅ Validated', validColors.length, 'apparel colors');
          return validColors;
        }

        // STEP 2: No apparel colors, try loading from product_template_variants (GENERIC products)
        console.log('[loadColorsForProduct] No apparel colors, checking product_template_variants...');

        const { data: variantData, error: variantError } = await supabase
          .from('product_template_variants')
          .select('id, color_name, color_code, view_name, template_url')
          .eq('product_template_id', productId);

        if (variantError) {
          console.error('[loadColorsForProduct] Variant query error:', variantError);
          throw variantError;
        }

        console.log('[loadColorsForProduct] Variant data:', variantData);

        if (!variantData || variantData.length === 0) {
          console.warn('[loadColorsForProduct] No colors found in either table');
          return [];
        }

        console.log('[loadColorsForProduct] ✓ Found GENERIC product variants');

        // Group variants by color (each color has multiple views)
        const colorMap = new Map();
        variantData.forEach(variant => {
          if (!colorMap.has(variant.color_code)) {
            colorMap.set(variant.color_code, {
              id: variant.color_code, // Use color_code as unique ID for variants
              color_name: variant.color_name,
              hex_code: variant.color_code,
              is_apparel: false, // Mark as generic product
              variants: []
            });
          }
          // Store all view variants for this color
          colorMap.get(variant.color_code).variants.push({
            view_name: variant.view_name,
            template_url: variant.template_url
          });
        });

        const genericColors = Array.from(colorMap.values());
        console.log('[loadColorsForProduct] ✅ Loaded', genericColors.length, 'generic colors with variants');

        return genericColors;

      } catch (err) {
        console.error('[loadColorsForProduct] Exception:', err);
        return [];
      }
    };

    const loadProductColorsFromDatabase = async () => {
      if (!useDatabase || !currentProduct || !currentProduct.id) {
        console.log('[Designer] Skipping color load - not using database or no product');
        return;
      }

      console.log('[Designer] Loading colors for product:', currentProduct.id, currentProduct.name);
      setLoadingColors(true);

      try {
        const colors = await loadColorsForProduct(currentProduct.id);

        if (colors.length > 0) {
          setProductColors(colors);

          // Set white as default
          const whiteColor = colors.find(c =>
            c.color_name.toLowerCase() === 'white'
          );

          if (whiteColor) {
            setSelectedColorId(whiteColor.id);
            setCurrentColorData(whiteColor);
            setSelectedColor(whiteColor.hex_code);
            console.log('[Designer] ✅ Selected WHITE color:', whiteColor.color_name);
          } else {
            // Fallback to first color
            setSelectedColorId(colors[0].id);
            setCurrentColorData(colors[0]);
            setSelectedColor(colors[0].hex_code);
            console.log('[Designer] ⚠️ White not found, selected first color:', colors[0].color_name);
          }
        } else {
          console.warn('[Designer] ⚠️ No colors loaded');
          setProductColors([]);
        }
      } catch (error) {
        console.error('[Designer] Exception loading product colors:', error);
        setProductColors([]);
      } finally {
        setLoadingColors(false);
      }
    };

    loadProductColorsFromDatabase();
  }, [useDatabase, currentProduct?.id]);

  // Calculate responsive canvas size based on container width
  useEffect(() => {
    const updateCanvasSize = () => {
      // Use a default size if container not available yet
      if (!canvasContainerRef.current) {
        console.log('[Designer] Container ref not available yet, using default size 800');
        const isMobile = window.innerWidth < 768;
        const defaultSize = isMobile ? 600 : 800;
        setCanvasSize(defaultSize);
        return;
      }

      const containerWidth = canvasContainerRef.current.clientWidth;
      const isMobile = window.innerWidth < 768;

      // On mobile, use container width minus padding
      // On desktop, use max 800px
      let newSize;
      if (isMobile) {
        newSize = Math.min(containerWidth - 40, 600); // Max 600px on mobile with padding
      } else {
        newSize = Math.min(containerWidth - 40, 800); // Max 800px on desktop
      }

      console.log('[Designer] Calculated canvas size:', {
        containerWidth,
        isMobile,
        newSize
      });

      setCanvasSize(newSize);
    };

    // Use setTimeout to ensure DOM is ready
    const timer = setTimeout(updateCanvasSize, 0);
    window.addEventListener('resize', updateCanvasSize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, []);

  // Initialize canvas - ONLY ONCE on mount
  useEffect(() => {
    console.log('[Designer] Component mounted - Initializing canvas');
    console.log('[Designer] Canvas size for initialization:', canvasSize);

    // Clear any saved designs from previous sessions
    console.log('[Designer] Clearing saved designs from localStorage');
    localStorage.removeItem('userDesigns');

    if (!canvasRef.current) {
      console.error('[Designer] Canvas ref not available');
      return;
    }

    if (canvasSize === 0) {
      console.error('[Designer] Canvas size not calculated yet, waiting...');
      return;
    }

    console.log('[Designer] Canvas element found:', canvasRef.current);

    // Verify canvas element has proper dimensions
    const canvasEl = canvasRef.current;
    console.log('[Designer] Canvas dimensions:', {
      width: canvasEl.width,
      height: canvasEl.height,
      clientWidth: canvasEl.clientWidth,
      clientHeight: canvasEl.clientHeight
    });

    // Check if 2D context is available
    const ctx = canvasEl.getContext('2d');
    if (!ctx) {
      console.error('[Designer] Cannot get 2D context from canvas');
      return;
    }
    console.log('[Designer] Canvas 2D context available');

    try {
      const fabricCanvas = new fabric.Canvas(canvasRef.current, {
        width: canvasSize,
        height: canvasSize,
        backgroundColor: '#f8f9fa',
        selection: true
      });

      console.log('[Designer] Fabric canvas created successfully');
      console.log('[Designer] Canvas size:', fabricCanvas.width, 'x', fabricCanvas.height);
      setCanvas(fabricCanvas);
      canvasReady.current = true;

      // ONLY dispose on component UNMOUNT (when user leaves page)
      return () => {
        console.log('[Designer] Component unmounting, disposing canvas');
        canvasReady.current = false;
        fabricCanvas.dispose();
      };
    } catch (error) {
      console.error('[Designer] Error initializing Fabric canvas:', error);
    }
  }, [canvasSize]); // Re-initialize when canvas size changes

  // Mouse wheel zoom listener
  useEffect(() => {
    if (!canvas) return;

    const handleWheel = (opt) => {
      const delta = opt.e.deltaY;
      let zoom = canvas.getZoom();

      console.log('[MouseWheel] Current zoom:', zoom, 'Delta:', delta);

      // Zoom in/out based on wheel direction
      zoom *= 0.999 ** delta;

      // Clamp zoom level
      zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

      console.log('[MouseWheel] New zoom:', zoom);

      // CRITICAL FIX: Zoom centered on canvas center, not mouse position
      // This keeps the design centered and prevents shifting
      const center = new fabric.Point(
        canvas.width / 2,
        canvas.height / 2
      );

      canvas.zoomToPoint(center, zoom);

      setZoomLevel(zoom);

      opt.e.preventDefault();
      opt.e.stopPropagation();
    };

    canvas.on('mouse:wheel', handleWheel);

    return () => {
      canvas.off('mouse:wheel', handleWheel);
    };
  }, [canvas, MIN_ZOOM, MAX_ZOOM]);

  // REMOVED: Auto-save functionality - now using manual "Save Position" button
  // Users have explicit control over when to save their designs
  /*
  useEffect(() => {
    if (!canvas) return;

    const handleObjectModified = () => {
      console.log('[Canvas] Object modified - auto-saving');
      saveCurrentDesigns();
    };

    const handleObjectAdded = (e) => {
      const obj = e.target;
      const isTemplate = obj.type === 'image' && !obj.name && !obj.id;
      const isPrintArea = obj.name && (
        obj.name.includes('print-area') ||
        obj.name.includes('guide') ||
        obj.name.includes('label')
      );

      if (!isTemplate && !isPrintArea) {
        console.log('[Canvas] User object added - auto-saving');
        saveCurrentDesigns();
      }
    };

    const handleObjectRemoved = (e) => {
      const obj = e.target;
      const isTemplate = obj.type === 'image' && !obj.name && !obj.id;
      const isPrintArea = obj.name && (
        obj.name.includes('print-area') ||
        obj.name.includes('guide') ||
        obj.name.includes('label')
      );

      if (!isTemplate && !isPrintArea) {
        console.log('[Canvas] User object removed - auto-saving');
        saveCurrentDesigns();
      }
    };

    canvas.on('object:modified', handleObjectModified);
    canvas.on('object:added', handleObjectAdded);
    canvas.on('object:removed', handleObjectRemoved);

    return () => {
      canvas.off('object:modified', handleObjectModified);
      canvas.off('object:added', handleObjectAdded);
      canvas.off('object:removed', handleObjectRemoved);
    };
  }, [canvas, selectedProduct, currentColorData, selectedView]);
  */

  // Load variant-specific data when color/view changes
  useEffect(() => {
    const loadVariantData = async () => {
      console.log('[Designer] loadVariantData triggered:', {
        useDatabase,
        hasCurrentProduct: !!currentProduct,
        selectedColor,
        selectedView,
        selectedProduct
      });

      if (!useDatabase || !currentProduct || !selectedView) {
        console.log('[Designer] loadVariantData early return - missing required data:', {
          useDatabase,
          hasCurrentProduct: !!currentProduct,
          selectedView
        });
        return;
      }

      // Reset print areas loaded state when starting to load new data
      console.log('[Designer] Setting printAreasLoaded = false (loading started)');
      setPrintAreasLoaded(false);

      // Clear active print area while loading to force re-render
      setActivePrintArea(null);

      try {
        console.log('[Designer] Loading print areas for:', {
          product: selectedProduct,
          view: selectedView
        });

        // Load print areas for this product+view (supports multiple areas per view)
        if (currentProduct.id) {
          console.log('═══ LOADING PRINT AREAS ═══');
          console.log('Product ID:', currentProduct.id);
          console.log('Product Key:', currentProduct.product_key);
          console.log('Product Name:', currentProduct.name);
          console.log('Current view:', selectedView);
          console.log('Table: print_areas');
          console.log('Query: SELECT * FROM print_areas WHERE product_template_id =', currentProduct.id);

          // Load ALL print areas for this product
          const { data: allAreas, error: checkError } = await supabase
            .from('print_areas')
            .select('*')
            .eq('product_template_id', currentProduct.id);

          console.log('Query error:', checkError);
          console.log('Query returned:', allAreas?.length || 0, 'print areas');
          console.log('Print areas data (full):', JSON.stringify(allAreas, null, 2));

          if (allAreas && allAreas.length > 0) {
            console.log('Area keys found:', allAreas.map(a => a.area_key));
            console.log('Area names found:', allAreas.map(a => a.name));
            console.log('Detailed area info:');
            allAreas.forEach((area, idx) => {
              console.log(`  [${idx}] ${area.name}:`, {
                area_key: area.area_key,
                x: area.x,
                y: area.y,
                width: area.width,
                height: area.height,
                shape: area.shape
              });
            });
          }

          if (checkError) {
            console.error('[loadPrintAreasForView] ❌ Query error:', checkError);
          }

          // Map area_key to views (client-side filtering)
          const viewMapping = {
            // Apparel print areas
            'center_chest': 'front',
            'left_breast_pocket': 'front',
            'right_breast_pocket': 'front',
            'left_sleeve': 'front',
            'right_sleeve': 'front',
            'center_back': 'back',
            // Generic print areas (for non-apparel products)
            'front_print': 'front',
            'back_print': 'back',
            'side_print': 'front',
            'top_print': 'front',
            'bottom_print': 'back',
            // Legacy mappings
            'front': 'front',
            'back': 'back',
            'left': 'left',
            'right': 'right'
          };

          console.log('View mapping:', viewMapping);

          // Filter for current view based on area_key mapping
          const areas = allAreas?.filter(area => {
            const mappedView = viewMapping[area.area_key] || area.area_key;
            const matches = mappedView === selectedView;
            console.log(`  Filtering ${area.area_key}: mapped to '${mappedView}', current view '${selectedView}', matches: ${matches}`);
            return matches;
          }) || [];

          console.log('[loadPrintAreasForView] ✅ Found', areas?.length || 0, 'print areas for view:', selectedView);
          console.log('[loadPrintAreasForView] Filtered print areas:', areas);
          console.log('═══════════════════════════');

          // Convert print areas to Designer format
          const printAreasMap = {};
          if (areas && areas.length > 0) {
            areas.forEach(area => {
              const key = area.area_key || area.name.toLowerCase().replace(/\s+/g, '_');
              printAreasMap[key] = {
                name: area.name,
                x: area.x,
                y: area.y,
                width: area.width,
                height: area.height,
                maxWidth: area.max_width || area.width,
                maxHeight: area.max_height || area.height,
                shape: area.shape || 'rectangle'
              };
            });

            // Update current product's print areas immutably
            if (currentProduct) {
              // Update products state immutably
              setProducts(prevProducts => ({
                ...prevProducts,
                [selectedProduct]: {
                  ...prevProducts[selectedProduct],
                  printAreas: printAreasMap
                }
              }));

              setPrintAreas(areas);
              console.log('[Designer] ✅ Setting printAreasLoaded = true (print areas loaded successfully, count:', areas.length, ')');
              setPrintAreasLoaded(true);  // Mark print areas as successfully loaded

              // Set first print area as active
              const firstKey = Object.keys(printAreasMap)[0];
              if (firstKey) {
                setPrintArea(firstKey);
                // CRITICAL FIX: Also set activePrintArea to the NAME (not key)
                const firstName = printAreasMap[firstKey].name;
                console.log('[Designer] Setting active print area to:', firstName);
                setActivePrintArea(firstName);
              }
            }
          } else {
            // No print areas found, but still mark as loaded to avoid infinite disabled state
            console.log('[Designer] ⚠️ Setting printAreasLoaded = true (no print areas found)');
            setPrintAreasLoaded(true);
          }
        } else {
          // No product ID, mark as loaded
          console.log('[Designer] ⚠️ Setting printAreasLoaded = true (no product ID)');
          setPrintAreasLoaded(true);
        }
      } catch (error) {
        console.error('[Designer] Error loading variant data:', error);
        // Even on error, mark as loaded to avoid buttons staying disabled forever
        console.log('[Designer] ⚠️ Setting printAreasLoaded = true (error occurred)');
        setPrintAreasLoaded(true);
      }
    };

    loadVariantData();
  }, [selectedProduct, selectedView, useDatabase]); // FIXED: Removed selectedColor - only reload on product/view change

  // Debug: Monitor printAreasLoaded state changes
  useEffect(() => {
    console.log('[Designer] 🔵 printAreasLoaded state changed:', printAreasLoaded);
  }, [printAreasLoaded]);

  // Load product template when product or view changes (NOT color - color handled separately)
  useEffect(() => {
    if (canvas && canvasReady.current && currentProduct) {
      console.log('[Designer] TEMPLATE LOAD EFFECT TRIGGERED:', {
        selectedProduct,
        selectedView,
        timestamp: Date.now()
      });

      loadProductTemplate();
    }
  }, [selectedProduct, selectedView]); // Load template when product or view changes

  // DEDICATED COLOR CHANGE EFFECT - Only updates template image, never touches print areas
  // Supports BOTH apparel (color overlay) and generic (direct variant images) products
  useEffect(() => {
    // Skip if dependencies not ready
    if (!canvas || !canvasReady.current || !currentProduct || !selectedColorId || !currentColorData) {
      return;
    }

    console.log('[Color Change Effect] ═══════════════════════════════════');
    console.log('[Color Change Effect] Color changed to:', currentColorData.color_name);
    console.log('[Color Change Effect] Is Apparel:', currentColorData.is_apparel);
    console.log('[Color Change Effect] Print areas loaded:', printAreasLoaded);
    console.log('[Color Change Effect] Will NOT change printAreasLoaded state');
    console.log('[Color Change Effect] Will ONLY update canvas image');

    // This effect is ONLY for swapping the image - never touches print area state!
    // Print areas are managed separately and should remain visible
    // NOTE: Don't block templateRendering here - updateCanvasImage handles state properly
    // Supports BOTH apparel (color overlay) and generic (direct variant) products

    const updateColorOnly = async () => {
      try {
        const productKey = currentProduct.product_key || selectedProduct;

        if (!productKey) {
          console.error('[Color Change Effect] No product key available');
          return;
        }

        let imageUrl;

        // GENERIC PRODUCT: Load direct variant image
        if (currentColorData.is_apparel === false && currentColorData.variants) {
          console.log('[Color Change Effect] 🎯 GENERIC product - loading variant image');

          // Find the variant for the current view
          const variant = currentColorData.variants.find(v => v.view_name === selectedView);

          if (!variant) {
            console.error('[Color Change Effect] ❌ No variant found for view:', selectedView);
            console.log('[Color Change Effect] Available variants:', currentColorData.variants.map(v => v.view_name));
            return;
          }

          console.log('[Color Change Effect] ✅ Using variant image:', variant.template_url);
          imageUrl = variant.template_url;

        } else {
          // APPAREL PRODUCT: Use photo or color overlay
          console.log('[Color Change Effect] 👕 APPAREL product - checking for uploaded photo...');

          // Check if uploaded photo exists for this color
          const photoUrl = await getColorPhotoUrl(
            productKey,
            currentColorData.color_name,
            selectedView
          );

          if (photoUrl) {
            // Use actual uploaded photo
            console.log('[Color Change Effect] ✅ Using uploaded photo');
            imageUrl = photoUrl;
          } else {
            // Generate overlay from white template
            console.log('[Color Change Effect] 🎨 Generating color overlay');

            const whitePhotoUrl = await getColorPhotoUrl(
              productKey,
              'White',
              selectedView
            );

            if (!whitePhotoUrl) {
              console.error('[Color Change Effect] ❌ No white template available');
              return;
            }

            imageUrl = await applyStrongColorOverlay(whitePhotoUrl, currentColorData.hex_code);
          }
        }

        if (imageUrl) {
          // Update ONLY the canvas image - print areas preserved
          console.log('[Color Change Effect] Updating canvas image...');
          await updateCanvasImage(imageUrl);
          console.log('[Color Change Effect] ✅ Color change complete, print areas preserved');
        }

      } catch (err) {
        console.error('[Color Change Effect] Error:', err);
      }
    };

    updateColorOnly();

    console.log('[Color Change Effect] ═══════════════════════════════════');

  }, [selectedColorId, currentColorData, selectedView]); // Color-specific dependencies only

  // Update print area when selection changes
  // DISABLED: This was calling the old updatePrintAreaOverlay function
  // useEffect(() => {
  //   if (canvas && canvasReady.current && currentPrintArea) {
  //     updatePrintAreaOverlay();
  //   }
  // }, [printArea, selectedProduct]);

  // Print areas are now handled by renderPrintAreaOverlays useEffect

  // Add watermark if user not logged in
  useEffect(() => {
    if (!canvas || !canvasReady.current) return;

    // Remove existing watermark
    const existingWatermark = canvas.getObjects().find(obj => obj.id === 'watermark');
    if (existingWatermark) {
      canvas.remove(existingWatermark);
    }

    // Add watermark only if user is not logged in
    if (!user) {
      const watermark = new fabric.Text('promogifts.co', {
        left: canvas.width / 2,
        top: canvas.height - 40,
        fontSize: 24,
        fontWeight: 'bold',
        fill: 'rgba(0, 0, 0, 0.3)',
        selectable: false,
        evented: false,
        id: 'watermark',
        visible: watermarkVisible,
        excludeFromExport: false, // Include in export for non-logged-in users
        originX: 'center',
        originY: 'center'
      });

      canvas.add(watermark);
      canvas.bringToFront(watermark);

      // Guard renderAll call
      try {
        if (canvas.getContext && canvas.getContext()) {
          canvas.renderAll();
        }
      } catch (error) {
        console.error('[Designer] Error rendering watermark:', error);
      }
    }
  }, [user, watermarkVisible]); // Removed canvas from dependencies

  // Debug: Monitor userDesigns state changes
  useEffect(() => {
    const variants = Object.keys(userDesigns);
    console.log('[Designer] 📦 User designs state updated. Variants with designs:', variants);
    variants.forEach(key => {
      console.log(`  - ${key}: ${userDesigns[key].length} objects`);
    });
  }, [userDesigns]);

  // DIAGNOSTIC CODE REMOVED - was causing console errors for non-existent products

  // Track selection changes and update text controls
  useEffect(() => {
    if (!canvas) return;

    const handleSelectionCreated = (e) => {
      const obj = e.selected[0];
      setSelectedObject(obj);

      // Update text controls if text is selected
      if (obj && obj.type === 'i-text') {
        setTextColor(obj.fill || '#000000');
        setTextFont(obj.fontFamily || 'Arial');
        setTextAlign(obj.textAlign || 'left');
      }
    };

    const handleSelectionUpdated = (e) => {
      const obj = e.selected[0];
      setSelectedObject(obj);

      // Update text controls if text is selected
      if (obj && obj.type === 'i-text') {
        setTextColor(obj.fill || '#000000');
        setTextFont(obj.fontFamily || 'Arial');
        setTextAlign(obj.textAlign || 'left');
      }
    };

    const handleSelectionCleared = () => {
      setSelectedObject(null);
    };

    canvas.on('selection:created', handleSelectionCreated);
    canvas.on('selection:updated', handleSelectionUpdated);
    canvas.on('selection:cleared', handleSelectionCleared);

    return () => {
      canvas.off('selection:created', handleSelectionCreated);
      canvas.off('selection:updated', handleSelectionUpdated);
      canvas.off('selection:cleared', handleSelectionCleared);
    };
  }, [canvas]);

  // Render print area overlays when print areas load
  useEffect(() => {
    console.log('[RENDER] ═══ RENDER EFFECT TRIGGERED ═══');
    console.log('[RENDER] Canvas exists:', !!canvas);
    console.log('[RENDER] Canvas ready:', canvasReady.current);
    console.log('[RENDER] Print areas count:', printAreas?.length || 0);
    console.log('[RENDER] Active print area:', activePrintArea);
    console.log('[RENDER] Already rendering:', renderingRef.current);

    // Exit if already rendering
    if (renderingRef.current) {
      console.log('[RENDER] ❌ Already rendering, skipping duplicate render');
      return;
    }

    // Exit if canvas not ready
    if (!canvas || !canvasReady.current) {
      console.log('[RENDER] ❌ Not ready: Canvas not initialized');
      return;
    }

    // Exit if template is currently loading/rendering
    if (templateRendering) {
      console.log('[RENDER] ⏳ Template is loading, waiting...');
      return;
    }

    // Exit if no print areas loaded yet
    if (!printAreas || printAreas.length === 0) {
      console.log('[RENDER] ❌ Not ready: No print areas data');
      if (canvas) {
        clearPrintAreaGuides();
      }
      return;
    }

    // CRITICAL FIX: Check if active print area exists in loaded data BEFORE any operations
    console.log('[RENDER] Checking for active print area in loaded data...');
    console.log('[RENDER] Available print areas:', printAreas?.map(a => a.name));
    console.log('[RENDER] Looking for:', activePrintArea);

    const activePrintAreaData = printAreas.find(area => area.name === activePrintArea);

    if (!activePrintAreaData) {
      console.log('[RENDER] ❌ Active print area not found in loaded data');
      console.log('[RENDER] Looking for:', activePrintArea);
      console.log('[RENDER] Available areas:', printAreas?.map(a => a.name));

      // If we have print areas but active one doesn't exist, try to set the first one
      if (printAreas && printAreas.length > 0) {
        const firstArea = printAreas[0];
        console.log('[RENDER] Auto-selecting first available area:', firstArea.name);
        setActivePrintArea(firstArea.name);
      }

      return; // Exit early, effect will re-run with new active print area
    }

    console.log('[RENDER] ✅ Active print area found:', activePrintAreaData.name);
    console.log('[RENDER] ✅ All checks passed - proceeding with render');

    // Now safe to proceed with rendering
    // CRITICAL: Clear old guides FIRST
    clearPrintAreaGuides();

    // If guides are hidden or print areas are explicitly hidden, stop here after clearing
    if (!showPrintAreaGuide || !printAreasVisible) {
      console.log('[RENDER] Print areas hidden - not rendering');
      return;
    }

    // Set rendering flag
    renderingRef.current = true;

    // Render only the active print area
    const area = activePrintAreaData;
    let overlay;

    // Apply image scale to all coordinates and dimensions
    const scaledX = area.x * imageScale;
    const scaledY = area.y * imageScale;
    const scaledWidth = area.width * imageScale;
    const scaledHeight = area.height * imageScale;

    // CRITICAL FIX: Get actual template image position for proper alignment
    const templateImg = canvas.getObjects().find(obj =>
      obj.name === 'template-image' || obj.id === 'template-image'
    );

    // CRITICAL: Exit early if template not loaded yet
    if (!templateImg) {
      console.log('[RENDER] ⏳ Template image not loaded yet - deferring print area render');
      renderingRef.current = false;
      return;
    }

    // Use template's actual position as offset
    const canvasOffsetX = templateImg.left || 0;
    const canvasOffsetY = templateImg.top || 0;
    console.log('[RENDER] ✅ Template image found - using position:', { x: canvasOffsetX, y: canvasOffsetY });

    console.log('=== [DESIGNER] RENDERING ACTIVE PRINT AREA ===');
    console.log('Print Area Name:', area.name);
    console.log('DB Coords:', { x: area.x, y: area.y, width: area.width, height: area.height });
    console.log('Scaled Coords:', { x: scaledX, y: scaledY, width: scaledWidth, height: scaledHeight });
    console.log('Canvas offset X:', canvasOffsetX);
    console.log('Canvas offset Y:', canvasOffsetY);
    console.log('=======================================');

    // Always use active styling since we're only showing the active area
    const strokeColor = '#3b82f6'; // Blue
    const strokeWidth = 3; // Thick
    const fillOpacity = 0.15; // Visible

    if (area.shape === 'circle') {
      overlay = new fabric.Circle({
        left: scaledX + canvasOffsetX,
        top: scaledY + canvasOffsetY,
        radius: scaledWidth / 2,
        fill: `rgba(59, 130, 246, ${fillOpacity})`,
        stroke: strokeColor,
        strokeWidth: strokeWidth,
        strokeDashArray: [5, 5],
        selectable: false,
        evented: false,
        isPrintAreaGuide: true,
        name: `print-area-guide-${area.name}`,
        id: `print-area-guide-${area.name}`,
        hoverCursor: 'default',
        excludeFromExport: true
      });
    } else if (area.shape === 'ellipse') {
      overlay = new fabric.Ellipse({
        left: scaledX + canvasOffsetX,
        top: scaledY + canvasOffsetY,
        rx: scaledWidth / 2,
        ry: scaledHeight / 2,
        fill: `rgba(59, 130, 246, ${fillOpacity})`,
        stroke: strokeColor,
        strokeWidth: strokeWidth,
        strokeDashArray: [5, 5],
        selectable: false,
        evented: false,
        isPrintAreaGuide: true,
        name: `print-area-guide-${area.name}`,
        id: `print-area-guide-${area.name}`,
        hoverCursor: 'default',
        excludeFromExport: true
      });
    } else {
      // Default to rectangle
      overlay = new fabric.Rect({
        left: scaledX + canvasOffsetX,
        top: scaledY + canvasOffsetY,
        width: scaledWidth,
        height: scaledHeight,
        fill: `rgba(59, 130, 246, ${fillOpacity})`,
        stroke: strokeColor,
        strokeWidth: strokeWidth,
        strokeDashArray: [5, 5],
        selectable: false,
        evented: false,
        isPrintAreaGuide: true,
        name: `print-area-guide-${area.name}`,
        id: `print-area-guide-${area.name}`,
        hoverCursor: 'default',
        excludeFromExport: true
      });
    }

    if (overlay) {
      console.log('[Designer] Created overlay for:', area.name);

      // Add to canvas
      canvas.add(overlay);

      // Create label - show MM dimensions if available, otherwise show pixels
      console.log('[RENDER] Print area dimensions:', {
        name: area.name,
        width_mm: area.width_mm,
        height_mm: area.height_mm,
        width: area.width,
        height: area.height
      });

      const widthDisplay = area.width_mm ? `${area.width_mm}mm` : `${area.width}px`;
      const heightDisplay = area.height_mm ? `${area.height_mm}mm` : `${area.height}px`;

      const labelText = `${area.name}\nMax size: ${widthDisplay} × ${heightDisplay}`;

      console.log('[RENDER] Label text:', labelText);

      const label = new fabric.Text(labelText, {
        left: scaledX + canvasOffsetX,
        top: scaledY + canvasOffsetY - 35,
        fontSize: 12,
        fill: '#3b82f6',
        fontFamily: 'Arial',
        selectable: false,
        evented: false,
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        name: `print-area-label-${area.name}`,
        id: `print-area-label-${area.name}`
      });

      console.log('[Designer] Created label for:', area.name);

      canvas.add(label);
      canvas.bringToFront(label);
    }

    // Guard renderAll call
    try {
      if (canvas && canvas.getContext && canvas.getContext()) {
        canvas.renderAll();
        console.log('[Designer] ✅ Rendered active print area:', area.name);
      }
    } catch (error) {
      console.error('[Designer] Error during renderAll in print area render:', error);
    }

    renderingRef.current = false;
  }, [printAreas, imageScale, showPrintAreaGuide, activePrintArea, printAreasVisible, templateRendering]); // Trigger when relevant state changes

  // Track print area guide visibility changes
  useEffect(() => {
    console.log('[Designer] Print area guide visibility changed to:', showPrintAreaGuide);
  }, [showPrintAreaGuide]);

  // Force render of first print area when print areas first load
  useEffect(() => {
    console.log('[Designer] 🎬 Initial render effect triggered');
    console.log('[Designer] printAreasLoaded:', printAreasLoaded);
    console.log('[Designer] printAreas count:', printAreas?.length);
    console.log('[Designer] canvas ready:', !!canvas && canvasReady.current);

    // Only trigger once when print areas first become available
    if (printAreasLoaded && printAreas && printAreas.length > 0 && canvas && canvasReady.current) {
      console.log('[Designer] 🚀 Forcing initial print area render');

      // Find the first print area for current view
      const firstPrintArea = printAreas[0];

      if (firstPrintArea && firstPrintArea.name) {
        console.log('[Designer] Setting initial active print area to:', firstPrintArea.name);

        // Set as active - this will trigger the main rendering effect
        setActivePrintArea(firstPrintArea.name);
        setPrintAreasVisible(true);
      }
    }
  }, [printAreasLoaded, canvas, canvasReady.current]); // Only trigger when these change

  // Constrain objects to print area
  useEffect(() => {
    if (!canvas || !canvasReady.current) return;

    // Get fresh print area data from printAreas array
    const printArea = printAreas && printAreas.length > 0 ? printAreas[0] : null;
    if (!printArea) {
      console.log('[Designer] No print area available for constraints');
      return;
    }

    console.log('[Designer] Setting up print area constraints with fresh data:', {
      printArea: printArea.name,
      imageScale: imageScale
    });

    const constrainToPrintArea = (obj) => {
      // Skip watermark, overlays, and template image
      if (obj.id === 'watermark' || obj.id === 'printAreaOverlay' ||
          obj.isPrintAreaGuide || obj.selectable === false) {
        return;
      }

      // Get object bounding box
      const objBounds = obj.getBoundingRect(true, true);

      // Scale print area coordinates to match canvas display
      const scaledX = printArea.x * imageScale;
      const scaledY = printArea.y * imageScale;
      const scaledWidth = printArea.width * imageScale;
      const scaledHeight = printArea.height * imageScale;

      // FIX: Get actual template image position for proper alignment
      const templateImg = canvas.getObjects().find(obj =>
        obj.name === 'template-image' || obj.id === 'template-image'
      );

      // Exit if template not loaded yet
      if (!templateImg) {
        console.log('[constrainToPrintArea] Template not loaded yet, skipping constraints');
        return;
      }

      // Use template's actual position as offset
      const canvasOffsetX = templateImg.left || 0;
      const canvasOffsetY = templateImg.top || 0;

      // Calculate scaled print area bounds on canvas
      const printLeft = scaledX + canvasOffsetX;
      const printTop = scaledY + canvasOffsetY;
      const printRight = printLeft + scaledWidth;
      const printBottom = printTop + scaledHeight;

      // Check if object is too large for print area
      const maxScaledWidth = scaledWidth;
      const maxScaledHeight = scaledHeight;

      if (objBounds.width > maxScaledWidth || objBounds.height > maxScaledHeight) {
        console.warn('[Designer] Object exceeds print area maximum size');
        // Optionally scale down to fit
        const scaleX = maxScaledWidth / objBounds.width;
        const scaleY = maxScaledHeight / objBounds.height;
        const scale = Math.min(scaleX, scaleY, 1);

        if (scale < 1) {
          obj.scale(obj.scaleX * scale);
          console.log('[Designer] Object scaled to fit print area');
        }
      }

      // Constrain position to stay within print area
      const objLeft = objBounds.left;
      const objTop = objBounds.top;
      const objRight = objLeft + objBounds.width;
      const objBottom = objTop + objBounds.height;

      let newLeft = obj.left;
      let newTop = obj.top;

      // Constrain horizontal position
      if (objLeft < printLeft) {
        newLeft = obj.left + (printLeft - objLeft);
      } else if (objRight > printRight) {
        newLeft = obj.left - (objRight - printRight);
      }

      // Constrain vertical position
      if (objTop < printTop) {
        newTop = obj.top + (printTop - objTop);
      } else if (objBottom > printBottom) {
        newTop = obj.top - (objBottom - printBottom);
      }

      // Apply constrained position
      if (newLeft !== obj.left || newTop !== obj.top) {
        obj.set({
          left: newLeft,
          top: newTop
        });
        obj.setCoords();
        console.log('[Designer] Object position constrained to print area bounds');
      }
    };

    // Add event listeners for object movement and scaling
    const handleObjectMoving = (e) => {
      constrainToPrintArea(e.target);
      canvas.renderAll();
    };

    const handleObjectScaling = (e) => {
      constrainToPrintArea(e.target);
      canvas.renderAll();
    };

    const handleObjectRotating = (e) => {
      constrainToPrintArea(e.target);
      canvas.renderAll();
    };

    canvas.on('object:moving', handleObjectMoving);
    canvas.on('object:scaling', handleObjectScaling);
    canvas.on('object:rotating', handleObjectRotating);

    // Cleanup event listeners
    return () => {
      canvas.off('object:moving', handleObjectMoving);
      canvas.off('object:scaling', handleObjectScaling);
      canvas.off('object:rotating', handleObjectRotating);
    };
  }, [canvas, printAreas, imageScale]); // Re-attach when canvas, print areas, or scale changes

  // Save current user designs before switching variants
  /**
   * CRITICAL: Check if an uploaded photo exists in storage (DIRECT STORAGE CHECK)
   * @param {Object|string} product - Product object or product key string
   * @param {string} colorName - Color name (e.g., 'Black', 'Carolina Blue')
   * @param {string} view - View name ('front' or 'back')
   * @returns {Promise<string|null>} Photo URL if exists, null otherwise
   */
  const getColorPhotoUrl = async (product, colorName, view) => {
    // Handle both product object and string key
    let productKey;
    if (typeof product === 'string') {
      productKey = product;
    } else {
      // Try different possible field names
      productKey = product?.product_key || product?.key || product?.name || product?.slug;
    }

    if (!productKey) {
      console.error('[getColorPhotoUrl] ❌ No product key found! Product:', product);
      console.error('[DEBUG] Available keys:', product ? Object.keys(product) : 'product is null/undefined');
      return null;
    }

    console.log('[getColorPhotoUrl] Using product key:', productKey);

    // Construct the expected storage path
    const sanitizedColorName = colorName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const fileName = `${sanitizedColorName}-${view}.png`;
    const path = `${productKey}/${fileName}`;

    console.log('[getColorPhotoUrl] Checking for photo:', path);

    try {
      // Check if file exists in storage
      const { data, error } = await supabase.storage
        .from('product-templates')
        .list(productKey, {
          search: fileName
        });

      if (error) {
        console.error('[getColorPhotoUrl] Error checking storage:', error);
        return null;
      }

      if (data && data.length > 0) {
        // File exists! Get public URL
        const { data: urlData } = supabase.storage
          .from('product-templates')
          .getPublicUrl(path);

        console.log('[getColorPhotoUrl] ✅ Photo found:', urlData.publicUrl);
        return urlData.publicUrl;
      }

      console.log('[getColorPhotoUrl] ⚠️ No photo found, will use overlay');
      return null;

    } catch (err) {
      console.error('[getColorPhotoUrl] Exception:', err);
      return null;
    }
  };

  /**
   * Check if an uploaded photo exists for the selected color and view (DATABASE FALLBACK)
   * @param {string} productId - Product template ID
   * @param {string} colorId - Apparel color ID
   * @param {string} view - View name ('front' or 'back')
   * @returns {string|null} Photo URL if exists, null otherwise
   */
  const checkIfPhotoExists = (productId, colorId, view) => {
    if (!useDatabase || !productColors.length || !colorId) {
      return null;
    }

    const colorAssignment = productColors.find(c => c.apparel_color_id === colorId);
    if (!colorAssignment) {
      return null;
    }

    if (view === 'front' && colorAssignment.has_front_photo && colorAssignment.front_photo_url) {
      console.log('[Designer] ✅ Photo exists for', colorAssignment.apparel_colors?.color_name, 'front');
      return colorAssignment.front_photo_url;
    }

    if (view === 'back' && colorAssignment.has_back_photo && colorAssignment.back_photo_url) {
      console.log('[Designer] ✅ Photo exists for', colorAssignment.apparel_colors?.color_name, 'back');
      return colorAssignment.back_photo_url;
    }

    console.log('[Designer] ℹ️ No photo for', colorAssignment.apparel_colors?.color_name, view, '- will use overlay');
    return null;
  };

  /**
   * REUSABLE HELPER: Sanitize color name for file paths
   */
  const sanitizeColorName = (colorName) => {
    return colorName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  };

  /**
   * Get default print area when none are defined in database
   * @returns {Object} Default print area configuration
   */
  const getDefaultPrintArea = () => {
    // Map current view to appropriate area_key
    const viewToAreaKey = {
      'front': 'center_chest',
      'back': 'center_back',
      'left': 'left',
      'right': 'right'
    };

    return {
      area_key: viewToAreaKey[selectedView] || 'center_chest',
      name: 'Center Chest',
      x: 250,
      y: 200,
      width: 300,
      height: 300,
      shape: 'rectangle'
    };
  };

  /**
   * Apply color overlay to image with maximum vibrancy
   * @param {string} imageUrl - URL of white/light template
   * @param {string} hexColor - Target hex color
   * @returns {Promise<string>} Blob URL of colored image
   */
  const applyColorOverlaySimple = async (imageUrl, hexColor) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: true });

        canvas.width = img.width;
        canvas.height = img.height;

        // Draw original white template
        ctx.drawImage(img, 0, 0);

        // Get pixel data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Parse hex color to RGB
        const r = parseInt(hexColor.slice(1, 3), 16);
        const g = parseInt(hexColor.slice(3, 5), 16);
        const b = parseInt(hexColor.slice(5, 7), 16);

        console.log('[applyColorOverlay] Target color RGB:', r, g, b);
        console.log('[applyColorOverlay] Hex:', hexColor);

        // Apply color to each pixel with HIGH INTENSITY
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];

          // Only process non-transparent pixels
          if (alpha > 10) {
            // Get luminosity using proper RGB to luminance formula
            const luminosity = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;

            // Apply target color scaled by luminosity
            const coloredR = r * luminosity;
            const coloredG = g * luminosity;
            const coloredB = b * luminosity;

            // Blend with original at VERY HIGH intensity (95%)
            const intensity = 0.95;

            data[i] = coloredR * intensity + data[i] * (1 - intensity);       // Red
            data[i + 1] = coloredG * intensity + data[i + 1] * (1 - intensity); // Green
            data[i + 2] = coloredB * intensity + data[i + 2] * (1 - intensity); // Blue
            // Alpha unchanged
          }
        }

        // Put modified data back
        ctx.putImageData(imageData, 0, 0);

        // Convert to blob URL
        canvas.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          console.log('[applyColorOverlay] ✅ Overlay complete');
          resolve(url);
        }, 'image/png');
      };

      img.onerror = (err) => {
        console.error('[applyColorOverlay] Failed to load image:', err);
        reject(err);
      };

      img.src = imageUrl;
    });
  };

  /**
   * Update canvas background image without clearing print areas
   * CRITICAL: Properly removes old template before adding new one
   * @param {string} imageUrl - URL of new image to load
   */
  /**
   * Save current user designs to localStorage
   * @returns {Array} Array of serialized design objects
   */
  const saveCurrentDesigns = (printAreaNameOverride = null) => {
    if (!canvas) {
      console.log('[saveCurrentDesigns] ❌ No canvas');
      return [];
    }

    // Use override if provided, otherwise use current state
    const printAreaToSave = printAreaNameOverride || activePrintArea;

    if (!printAreaToSave) {
      console.log('[saveCurrentDesigns] ❌ No print area specified');
      return [];
    }

    console.log('[saveCurrentDesigns] Starting save for:', printAreaToSave);
    console.log('[saveCurrentDesigns] (Override provided:', printAreaNameOverride, ')');

    // Get all objects
    const allObjects = canvas.getObjects();
    console.log('[saveCurrentDesigns] Total canvas objects:', allObjects.length);

    // Filter user objects
    const userObjects = allObjects.filter(obj => {
      const isUserObject = obj.name === 'user-image' || obj.name === 'user-text';
      if (isUserObject) {
        console.log('[saveCurrentDesigns] Found user object:', obj.type, obj.name, obj.id);
      }
      return isUserObject;
    });

    console.log('[saveCurrentDesigns] User objects to save:', userObjects.length);

    // Build variant key using the print area we're saving for
    const printAreaKey = printAreaToSave.toLowerCase().replace(/\s+/g, '-');
    const colorName = currentColorData?.color_name?.toLowerCase().replace(/\s+/g, '-') || 'default';
    const variantKey = `${selectedProduct}-${colorName}-${selectedView}-${printAreaKey}`;

    console.log('[saveCurrentDesigns] Saving to key:', variantKey);

    if (userObjects.length === 0) {
      console.log('[saveCurrentDesigns] No designs to save');

      // Still save empty array to clear this print area
      try {
        const allDesigns = JSON.parse(localStorage.getItem('userDesigns') || '{}');
        delete allDesigns[variantKey];
        localStorage.setItem('userDesigns', JSON.stringify(allDesigns));
        console.log('[saveCurrentDesigns] Cleared designs for:', variantKey);
      } catch (err) {
        console.error('[saveCurrentDesigns] Error clearing:', err);
      }

      return [];
    }

    // Serialize designs to JSON with ALL positioning properties
    const designs = userObjects.map(obj => {
      const json = obj.toJSON([
        'name',
        'selectable',
        'evented',
        'id',
        'src',
        'left',
        'top',
        'scaleX',
        'scaleY',
        'angle',
        'flipX',
        'flipY',
        'originX',
        'originY',
        'width',
        'height'
      ]);

      console.log('[saveCurrentDesigns] Serialized design:', {
        type: json.type,
        id: json.id,
        position: { left: json.left, top: json.top },
        scale: { x: json.scaleX, y: json.scaleY },
        angle: json.angle
      });

      return json;
    });

    // Save to localStorage
    try {
      const allDesigns = JSON.parse(localStorage.getItem('userDesigns') || '{}');
      allDesigns[variantKey] = designs;
      localStorage.setItem('userDesigns', JSON.stringify(allDesigns));
      console.log('[saveCurrentDesigns] ✅ Saved successfully');
      console.log('[saveCurrentDesigns] All saved designs:', Object.keys(allDesigns));
    } catch (err) {
      console.error('[saveCurrentDesigns] ❌ Save failed:', err);
    }

    return designs;
  };

  /**
   * Restore user designs for a specific print area
   * @param {string} printAreaName - Name of the print area (e.g., 'Center Chest')
   */
  const restoreDesignsForPrintArea = async (printAreaName) => {
    if (!canvas || !printAreaName) {
      console.log('[restoreDesignsForPrintArea] No canvas or print area');
      return;
    }

    console.log('[restoreDesignsForPrintArea] ═══════════════════════════════');
    console.log('[restoreDesignsForPrintArea] Restoring for:', printAreaName);

    // Build variant key
    const colorName = currentColorData?.color_name || 'unknown';
    const printAreaKey = printAreaName.toLowerCase().replace(/\s+/g, '-');
    const variantKey = `${selectedProduct}-${colorName.toLowerCase().replace(/\s+/g, '-')}-${selectedView}-${printAreaKey}`;

    console.log('[restoreDesignsForPrintArea] Loading from key:', variantKey);

    // Clear existing user objects
    const existingUserObjects = canvas.getObjects().filter(obj =>
      obj.name === 'user-image' || obj.name === 'user-text'
    );
    console.log('[restoreDesignsForPrintArea] Clearing', existingUserObjects.length, 'existing user objects');
    existingUserObjects.forEach(obj => canvas.remove(obj));

    try {
      const allDesigns = JSON.parse(localStorage.getItem('userDesigns') || '{}');
      console.log('[restoreDesignsForPrintArea] Available keys:', Object.keys(allDesigns));

      const designs = allDesigns[variantKey];

      if (!designs || designs.length === 0) {
        console.log('[restoreDesignsForPrintArea] ❌ No saved designs for this print area');
        canvas.renderAll();
        console.log('[restoreDesignsForPrintArea] ═══════════════════════════════');
        return;
      }

      console.log('[restoreDesignsForPrintArea] Found', designs.length, 'saved designs');

      // Restore each design
      let restoredCount = 0;

      for (const design of designs) {
        console.log('[restoreDesignsForPrintArea] Restoring design:', {
          type: design.type,
          id: design.id,
          savedPosition: { left: design.left, top: design.top },
          savedScale: { x: design.scaleX, y: design.scaleY }
        });

        if (design.type === 'image') {
          await new Promise((resolve) => {
            fabric.Image.fromURL(design.src, (img) => {
              if (!img) {
                console.error('[restoreDesignsForPrintArea] Failed to load image');
                resolve();
                return;
              }

              // Set ALL properties from saved design
              img.set({
                left: design.left,
                top: design.top,
                scaleX: design.scaleX,
                scaleY: design.scaleY,
                angle: design.angle || 0,
                flipX: design.flipX || false,
                flipY: design.flipY || false,
                originX: design.originX || 'left',
                originY: design.originY || 'top',
                selectable: true,
                evented: true,
                name: 'user-image',
                id: design.id || 'img-' + Date.now()
              });

              console.log('[restoreDesignsForPrintArea] Image restored to position:', {
                left: img.left,
                top: img.top,
                scale: { x: img.scaleX, y: img.scaleY }
              });

              canvas.add(img);
              restoredCount++;
              resolve();
            }, { crossOrigin: 'anonymous' });
          });
        } else if (design.type === 'i-text' || design.type === 'text') {
          const text = new fabric.IText(design.text, {
            left: design.left,
            top: design.top,
            fontSize: design.fontSize,
            fontFamily: design.fontFamily,
            fill: design.fill,
            angle: design.angle || 0,
            scaleX: design.scaleX || 1,
            scaleY: design.scaleY || 1,
            originX: design.originX || 'left',
            originY: design.originY || 'top',
            selectable: true,
            evented: true,
            name: 'user-text',
            id: design.id || 'text-' + Date.now()
          });

          console.log('[restoreDesignsForPrintArea] Text restored to position:', {
            left: text.left,
            top: text.top
          });

          canvas.add(text);
          restoredCount++;
        }
      }

      canvas.renderAll();
      console.log('[restoreDesignsForPrintArea] ✅ Restored', restoredCount, 'designs');
      console.log('[restoreDesignsForPrintArea] ═══════════════════════════════');

    } catch (err) {
      console.error('[restoreDesignsForPrintArea] Error:', err);
      console.log('[restoreDesignsForPrintArea] ═══════════════════════════════');
    }
  };

  /**
   * Restore user designs from localStorage (old function - kept for compatibility)
   * @param {string} variantKey - Key for the variant (productKey-color-view)
   */
  const restoreDesigns = async (variantKey) => {
    console.log('[restoreDesigns] Attempting to restore for:', variantKey);

    if (!canvas) {
      console.log('[restoreDesigns] No canvas available');
      return;
    }

    try {
      // Load from localStorage
      const allDesigns = JSON.parse(localStorage.getItem('userDesigns') || '{}');
      const designs = allDesigns[variantKey];

      if (!designs || designs.length === 0) {
        console.log('[restoreDesigns] No saved designs for this variant');
        return;
      }

      console.log('[restoreDesigns] Found', designs.length, 'saved designs');

      // Remove any existing user objects first
      const existingUserObjects = canvas.getObjects().filter(obj => {
        // Template images have no name or empty name
        const isTemplate = obj.type === 'image' && (!obj.name || obj.name === '');

        // Print area objects have specific names
        const isPrintArea = obj.name && (
          obj.name.includes('print-area') ||
          obj.name.includes('guide') ||
          obj.name.includes('label')
        );

        // Watermark
        const isWatermark = obj.id === 'watermark';

        // User objects have specific names
        const isUserObject = (obj.name === 'user-image') ||
                            (obj.name === 'user-text') ||
                            (obj.name && !isPrintArea && !isTemplate && !isWatermark);

        return isUserObject;
      });

      console.log('[restoreDesigns] Removing', existingUserObjects.length, 'existing user objects');
      existingUserObjects.forEach(obj => canvas.remove(obj));

      // Restore each design
      let restoredCount = 0;

      for (const design of designs) {
        if (design.type === 'image') {
          // Restore image
          await new Promise((resolve) => {
            fabric.Image.fromURL(design.src, (img) => {
              if (!img) {
                console.error('[restoreDesigns] Failed to load image:', design.src);
                resolve();
                return;
              }

              img.set({
                left: design.left,
                top: design.top,
                scaleX: design.scaleX,
                scaleY: design.scaleY,
                angle: design.angle,
                selectable: true,
                evented: true,
                name: design.name || 'user-image',  // Preserve or set name
                id: design.id || 'img-' + Date.now()  // Preserve or set ID
              });

              canvas.add(img);
              restoredCount++;
              resolve();
            }, { crossOrigin: 'anonymous' });
          });
        } else if (design.type === 'text' || design.type === 'i-text') {
          // Restore text
          const text = new fabric.IText(design.text, {
            left: design.left,
            top: design.top,
            fontSize: design.fontSize,
            fontFamily: design.fontFamily,
            fill: design.fill,
            angle: design.angle,
            scaleX: design.scaleX,
            scaleY: design.scaleY,
            selectable: true,
            evented: true,
            name: design.name || 'user-text',  // Preserve or set name
            id: design.id || 'text-' + Date.now()  // Preserve or set ID
          });

          canvas.add(text);
          restoredCount++;
        }
      }

      canvas.renderAll();
      console.log('[restoreDesigns] ✅ Restored', restoredCount, 'designs');

    } catch (err) {
      console.error('[restoreDesigns] Failed to restore:', err);
    }
  };

  const updateCanvasImage = async (imageUrl) => {
    if (!canvas) {
      console.error('[updateCanvasImage] No canvas available');
      return;
    }

    setTemplateRendering(true); // Block render during image swap
    console.log('[updateCanvasImage] Loading new image:', imageUrl);

    // REMOVED: Auto-save before template change - use manual "Save Position" button
    // saveCurrentDesigns();

    return new Promise((resolve, reject) => {
      // Get all current objects for debugging
      const allObjects = canvas.getObjects();
      console.log('[updateCanvasImage] Current objects before change:', allObjects.length);

      // Find ALL image objects that could be templates
      const existingTemplates = allObjects.filter(obj => {
        // Keep user images and print area guides
        if (obj.name && (
          obj.name.startsWith('user-') ||
          obj.name.startsWith('print-area-')
        )) {
          return false;
        }

        // Remove all other images (these are old templates)
        return obj.type === 'image';
      });

      console.log('[updateCanvasImage] Found', existingTemplates.length, 'template image(s) to remove');

      // Store print area objects
      const printAreaObjects = allObjects.filter(obj =>
        obj.name && (
          obj.name.includes('print-area') ||
          obj.name.includes('guide') ||
          obj.name.includes('label')
        )
      );
      console.log('[updateCanvasImage] Preserving', printAreaObjects.length, 'print area objects');

      // REMOVE ALL OLD TEMPLATE IMAGES FIRST
      existingTemplates.forEach(template => {
        console.log('[updateCanvasImage] Removing old template image');
        canvas.remove(template);
      });

      fabric.Image.fromURL(imageUrl, (newImg) => {
        if (!newImg) {
          console.error('[updateCanvasImage] Failed to load image');
          setTemplateRendering(false);
          reject(new Error('Failed to load image'));
          return;
        }

        // CRITICAL FIX: Always calculate proper centering (don't use old position)
        const canvasWidth = canvas.width || 800;
        const canvasHeight = canvas.height || 800;

        // Calculate scale to fit within canvas (use 90% to match loadImageToCanvas)
        const scale = Math.min(
          canvasWidth / newImg.width,
          canvasHeight / newImg.height
        ) * 0.9;

        // Calculate scaled dimensions
        const scaledWidth = newImg.width * scale;
        const scaledHeight = newImg.height * scale;

        // Calculate center position
        const centerX = (canvasWidth - scaledWidth) / 2;
        const centerY = (canvasHeight - scaledHeight) / 2;

        console.log('[updateCanvasImage] Centering image:', {
          canvasSize: { width: canvasWidth, height: canvasHeight },
          imageSize: { width: newImg.width, height: newImg.height },
          scale: scale.toFixed(3),
          scaledSize: { width: scaledWidth.toFixed(0), height: scaledHeight.toFixed(0) },
          position: { x: centerX.toFixed(0), y: centerY.toFixed(0) }
        });

        // Set image properties with centering
        // IMPORTANT: Always use same origin point for consistency
        newImg.set({
          left: centerX,
          top: centerY,
          scaleX: scale,
          scaleY: scale,
          originX: 'left',
          originY: 'top',
          selectable: false,
          evented: false,
          name: 'template-image',
          id: 'template-image'
        });

        console.log('[updateCanvasImage] Template positioned at:', {
          left: newImg.left,
          top: newImg.top,
          origin: { x: newImg.originX, y: newImg.originY }
        });

        // Add new image as object (NOT background)
        canvas.add(newImg);

        // CRITICAL: Send to back so print areas stay on top
        newImg.sendToBack();

        // Update image scale for print area calculations
        setImageScale(scale);

        // Bring print areas to front to ensure visibility
        printAreaObjects.forEach(obj => {
          obj.bringToFront();
        });

        canvas.renderAll();

        console.log('[updateCanvasImage] ✅ Template replaced successfully (centered)');
        console.log('[updateCanvasImage] Final object count:', canvas.getObjects().length);

        // STEP 2: Restore designs for current print area AFTER new template is loaded
        console.log('[updateCanvasImage] Restoring designs for print area:', activePrintArea);

        // Use setTimeout to ensure template is fully rendered before restoring
        setTimeout(async () => {
          if (activePrintArea) {
            await restoreDesignsForPrintArea(activePrintArea);
          }

          // Clear template rendering state
          setTemplateRendering(false);
          console.log('[updateCanvasImage] ✅ Template rendering complete');

          resolve();
        }, 100);
      }, {
        crossOrigin: 'anonymous'
      });
    });
  };

  /**
   * Apply STRONG color overlay with 95% intensity for vibrant colors
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

      img.onerror = (err) => {
        console.error('[StrongOverlay] Failed to load image:', err);
        reject(err);
      };

      img.src = imageUrl;
    });
  };

  /**
   * CRITICAL: Handle color change with proper photo detection
   * Supports BOTH apparel (color overlay) and generic (direct variant images) products
   * @param {Object} selectedColor - Color object with color_name, hex_code, etc.
   */
  const handleColorChange = async (selectedColor) => {
    console.log('═══════════════════════════════════');
    console.log('[handleColorChange] Color selected:', selectedColor.color_name);
    console.log('[handleColorChange] Hex:', selectedColor.hex_code);
    console.log('[handleColorChange] Product:', currentProduct?.product_key || selectedProduct);
    console.log('[handleColorChange] View:', selectedView);
    console.log('[handleColorChange] Is Apparel:', selectedColor.is_apparel);
    console.log('[DEBUG] currentProduct full object:', currentProduct);
    console.log('[DEBUG] Available keys:', currentProduct ? Object.keys(currentProduct) : 'none');

    setCurrentColorData(selectedColor);
    setChangingColor(true);

    try {
      // Get product key - use currentProduct or fallback to selectedProduct state
      const productKey = currentProduct?.product_key || selectedProduct;

      if (!productKey) {
        console.error('[handleColorChange] ❌ Cannot determine product key');
        setChangingColor(false);
        return;
      }

      // GENERIC PRODUCT: Load direct variant image
      if (selectedColor.is_apparel === false && selectedColor.variants) {
        console.log('[handleColorChange] 🎯 GENERIC product - loading variant image directly');

        // Find the variant for the current view
        const variant = selectedColor.variants.find(v => v.view_name === selectedView);

        if (!variant) {
          console.error('[handleColorChange] ❌ No variant found for view:', selectedView);
          console.log('[handleColorChange] Available variants:', selectedColor.variants.map(v => v.view_name));
          setChangingColor(false);
          return;
        }

        console.log('[handleColorChange] ✅ Loading variant image:', variant.template_url);
        await updateCanvasImage(variant.template_url);
        setChangingColor(false);
        return;
      }

      // APPAREL PRODUCT: Use color overlay system
      console.log('[handleColorChange] 👕 APPAREL product - using color overlay system');

      // STEP 1: Check if we have an uploaded photo for this color
      const photoUrl = await getColorPhotoUrl(
        productKey,
        selectedColor.color_name,
        selectedView
      );

      if (photoUrl) {
        // Use actual uploaded photo
        console.log('[handleColorChange] ✅ Loading uploaded photo');
        await updateCanvasImage(photoUrl);
        setChangingColor(false);
        return;
      }

      // STEP 2: No photo exists, generate color overlay
      console.log('[handleColorChange] 🎨 Generating color overlay');

      // Get WHITE template as base
      const whitePhotoUrl = await getColorPhotoUrl(
        productKey,
        'White',
        selectedView
      );

      if (!whitePhotoUrl) {
        console.error('[handleColorChange] ❌ No white template found!');
        setChangingColor(false);
        return;
      }

      // Apply color overlay with STRONG intensity (95%)
      console.log('[handleColorChange] Applying', selectedColor.color_name, 'overlay to white template');
      const coloredImageUrl = await applyStrongColorOverlay(whitePhotoUrl, selectedColor.hex_code);

      // Load colored image
      await updateCanvasImage(coloredImageUrl);

    } catch (err) {
      console.error('[handleColorChange] ❌ Error:', err);
    } finally {
      setChangingColor(false);
    }

    console.log('═══════════════════════════════════');
  };

  const loadProductTemplate = async () => {
    if (!canvas || !canvasReady.current || !currentProduct) {
      console.warn('[Designer] Canvas not ready for template loading');
      return;
    }

    console.log('[Designer] Loading template for product:', selectedProduct);

    // Clear old print areas immediately
    clearPrintAreaGuides();

    setTemplateLoaded(false);
    setTemplateRendering(true); // Block print area rendering during template load
    setChangingColor(true); // Show loading state during color change

    try {
      // Verify canvas context is available before clearing
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.error('[Designer] Canvas context is null, cannot render');
        setTemplateLoaded(true);
        setChangingColor(false);
        return;
      }

      // ============================================================
      // PRIORITY FALLBACK SYSTEM FOR COLOR PHOTOS
      // ============================================================
      // 1. Check if actual color-specific photo exists → Use it
      // 2. Check if cached overlay exists → Use it
      // 3. Generate overlay from default template → Cache it
      // 4. Fallback to variant/product template
      // ============================================================

      let templateUrl;
      let source = 'product-default';
      let needsOverlay = false;
      let defaultTemplateUrl = null;

      // STEP 1: Check for folder-structure photo (productKey/color-view.png)
      if (!templateUrl && useDatabase && currentProduct && currentColorData) {
        const folderPhotoUrl = await getColorPhotoUrl(currentProduct, currentColorData.color_name, selectedView);
        if (folderPhotoUrl) {
          templateUrl = folderPhotoUrl;
          source = 'folder-structure';
          console.log('[Designer] ✅ Using folder structure photo:', templateUrl);
        }
      }

      // STEP 2: Check for actual color-specific photo from database
      if (!templateUrl && useDatabase && selectedColorId && productColors.length > 0) {
        const colorAssignment = productColors.find(c => c.apparel_color_id === selectedColorId);
        if (colorAssignment) {
          if (selectedView === 'front' && colorAssignment.has_front_photo && colorAssignment.front_photo_url) {
            templateUrl = colorAssignment.front_photo_url;
            source = 'color-specific-photo-db';
            console.log('[Designer] ✅ Using actual color photo from database');
          } else if (selectedView === 'back' && colorAssignment.has_back_photo && colorAssignment.back_photo_url) {
            templateUrl = colorAssignment.back_photo_url;
            source = 'color-specific-photo-db';
            console.log('[Designer] ✅ Using actual color photo from database');
          }
        }
      }

      // STEP 3: If no actual photo, check for cached overlay
      if (!templateUrl && useDatabase && currentProduct.id && selectedColorId) {
        const cachedUrl = getCachedImage(currentProduct.id, selectedColorId, selectedView);
        if (cachedUrl) {
          templateUrl = cachedUrl;
          source = 'cached-overlay';
          console.log('[Designer] ✅ Using cached color overlay');
        }
      }

      // STEP 4: If no cache, prepare to generate overlay
      if (!templateUrl && currentColorData && needsColorOverlay(currentColorData.hex_code)) {
        // Build path for white/neutral base template
        const whiteImagePath = `${currentProduct.product_key}/white-${selectedView}.png`;
        const { data: whiteUrlData } = supabase.storage
          .from('product-templates')
          .getPublicUrl(whiteImagePath);

        defaultTemplateUrl = whiteUrlData.publicUrl;
        needsOverlay = true;
        source = 'generated-overlay';
        console.log('[Designer] 🎨 Will generate color overlay from white template:', whiteImagePath);
      }

      // STEP 5: Fallback to white template
      if (!templateUrl && !needsOverlay) {
        // Build path dynamically using white color
        const whiteImagePath = `${currentProduct.product_key}/white-${selectedView}.png`;
        const { data: whiteUrlData } = supabase.storage
          .from('product-templates')
          .getPublicUrl(whiteImagePath);

        templateUrl = whiteUrlData.publicUrl;
        source = 'white-template-fallback';
        console.log('[Designer] ⚠️ Using white template fallback:', whiteImagePath);
      }

      console.log('[Designer] Template loading strategy:', {
        url: templateUrl || defaultTemplateUrl,
        source: source,
        needsOverlay: needsOverlay,
        selectedView: selectedView,
        selectedColor: selectedColor,
        selectedColorId: selectedColorId,
        hexCode: currentColorData?.hex_code,
        colorName: currentColorData?.color_name
      });

      // REMOVED: Auto-save before clearing - use manual "Save Position" button
      // saveCurrentDesigns();

      // Clear canvas
      canvas.clear();

      // ============================================================
      // GENERATE COLOR OVERLAY IF NEEDED
      // ============================================================
      const loadImageToCanvas = async (finalUrl) => {
        fabric.Image.fromURL(finalUrl, (img) => {
        // Re-check canvas still exists when callback fires
        const currentCanvas = canvas;
        if (!currentCanvas) {
          console.error('[Designer] Canvas disposed before image loaded');
          setTemplateRendering(false);
          return;
        }

        if (img && img._element) {
          console.log('[Designer] Image loaded successfully');

          try {
            // Calculate scale factor to fit canvas while maintaining aspect ratio
            const canvasWidth = currentCanvas.width;
            const canvasHeight = currentCanvas.height;
            const originalWidth = img.width;
            const originalHeight = img.height;

            console.log('[Designer] Canvas dimensions:', canvasWidth, 'x', canvasHeight);

            // Use 90% of canvas space for larger appearance (instead of 100%)
            const maxWidth = canvasWidth * 0.9;  // 90% of canvas width
            const maxHeight = canvasHeight * 0.9;  // 90% of canvas height

            const scale = Math.min(
              maxWidth / originalWidth,
              maxHeight / originalHeight
            );

            // Calculate scaled dimensions
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;

            // Center the image on canvas
            const left = (canvasWidth - scaledWidth) / 2;
            const top = (canvasHeight - scaledHeight) / 2;

            // Log scale information for debugging
            console.log('[Designer] Template scaling:', {
              originalWidth: img.width,
              originalHeight: img.height,
              canvasWidth: canvasWidth,
              canvasHeight: canvasHeight,
              maxWidth: maxWidth,
              maxHeight: maxHeight,
              scale: scale,
              scaledWidth: scaledWidth,
              scaledHeight: scaledHeight,
              centerPosition: { left, top },
              percentageOfCanvas: '90%'
            });

            // Store scale factor in state for print area calculations
            setImageScale(scale);

            // IMPORTANT: Always use same origin point for consistency
            img.set({
              scaleX: scale,
              scaleY: scale,
              left: left,
              top: top,
              originX: 'left',
              originY: 'top',
              selectable: false,
              evented: false,
              excludeFromExport: false,
              name: 'template-image',
              id: 'template-image'
            });

            console.log('[Designer] Template positioned at:', {
              left: img.left,
              top: img.top,
              origin: { x: img.originX, y: img.originY },
              scaledSize: { width: scaledWidth, height: scaledHeight }
            });

            currentCanvas.add(img);
            currentCanvas.sendToBack(img);

            // Apply color tint if needed (for products that support color changes)
            if (selectedColor !== '#ffffff' && currentProduct.colors.includes(selectedColor)) {
              img.set('fill', selectedColor);
            }

            setTemplateLoaded(true);
            setTemplateRendering(false); // Allow print area rendering
            setChangingColor(false); // Loading complete
            updatePrintAreaOverlay();
            currentCanvas.renderAll();
            console.log('[Designer] Template rendered successfully with scale:', scale);
            setTemplateRendering(false);
            console.log('[Designer] ✅ Template rendering state cleared');

            // Restore user designs for current print area
            console.log('[Designer] Template loaded, restoring designs for:', activePrintArea);
            if (activePrintArea && printAreasVisible) {
              restoreDesignsForPrintArea(activePrintArea);
            }

          } catch (error) {
            console.error('[Designer] Error rendering image:', error);
            setTemplateLoaded(true);
            setTemplateRendering(false);
            setChangingColor(false);
          }
        } else {
          console.error('[Designer] Failed to load image - invalid image data');
          setTemplateLoaded(true);
          setTemplateRendering(false);
          setChangingColor(false);
        }
        }, {
          crossOrigin: 'anonymous'
        });
      };

      // ============================================================
      // EXECUTE LOADING STRATEGY
      // ============================================================
      try {
        if (needsOverlay && defaultTemplateUrl && currentColorData) {
          // Generate color overlay
          console.log('[Designer] 🎨 Generating color overlay...');
          console.log('[Designer] Default template:', defaultTemplateUrl);
          console.log('[Designer] Target color:', currentColorData.hex_code, currentColorData.color_name);

          const intensity = getOptimalIntensity(currentColorData.hex_code);
          console.log('[Designer] Optimal intensity:', intensity);

          try {
            const overlayDataUrl = await applyColorOverlay(
              defaultTemplateUrl,
              currentColorData.hex_code,
              {
                intensity: intensity,
                outputFormat: 'dataUrl'
              }
            );

            console.log('[Designer] ✅ Color overlay generated successfully');

            // Cache the result
            if (currentProduct.id && selectedColorId) {
              const cached = cacheColoredImage(
                currentProduct.id,
                selectedColorId,
                selectedView,
                overlayDataUrl
              );
              if (cached) {
                console.log('[Designer] ✅ Overlay cached for future use');
              }
            }

            // Load the overlay to canvas
            await loadImageToCanvas(overlayDataUrl);
          } catch (overlayError) {
            console.error('[Designer] Error generating overlay, falling back to default:', overlayError);
            // Fallback to default template
            await loadImageToCanvas(defaultTemplateUrl);
          }
        } else if (templateUrl) {
          // Use direct URL (actual photo or cached)
          await loadImageToCanvas(templateUrl);
        } else {
          console.error('[Designer] No template URL available');
          setTemplateLoaded(true);
          setTemplateRendering(false);
          setChangingColor(false);
        }
      } catch (error) {
        console.error('[Designer] Error in loading strategy:', error);
        setTemplateLoaded(true);
        setTemplateRendering(false);
        setChangingColor(false);
      }

    } catch (error) {
      console.error('[Designer] Error loading template:', error);
      setTemplateLoaded(true); // Still allow design even if template fails
      setTemplateRendering(false);
      setChangingColor(false);
    }
  };

  const clearPrintAreaGuides = () => {
    // CRITICAL: Check canvas and context are valid before any operations
    if (!canvas) {
      console.log('[Designer] Cannot clear - no canvas');
      return;
    }

    // Check if canvas has a valid context
    try {
      const ctx = canvas.getContext();
      if (!ctx) {
        console.log('[Designer] Cannot clear - canvas context is null');
        return;
      }
    } catch (error) {
      console.error('[Designer] Error checking canvas context:', error);
      return;
    }

    // Check if canvas is disposed
    if (!canvas.getObjects) {
      console.log('[Designer] Cannot clear - canvas appears disposed');
      return;
    }

    const allObjects = canvas.getObjects();
    console.log('[Designer] Clearing guides - total objects:', allObjects.length);

    allObjects.forEach((obj, idx) => {
      const name = obj.name || obj.get('name') || '';
      const id = obj.id || obj.get('id') || '';
      console.log(`[Designer] Object ${idx}:`, {
        type: obj.type,
        name: name,
        id: id,
        stroke: obj.stroke,
        strokeDashArray: obj.strokeDashArray
      });
    });

    // Catch ALL possible print area variations:
    const guidesToRemove = allObjects.filter(obj => {
      const name = (obj.name || obj.get('name') || '').toLowerCase();
      const id = (obj.id || obj.get('id') || '').toLowerCase();

      // Check for any of these conditions:
      const hasGuideId = id.includes('printarea') || id.includes('overlay') ||
                         id.includes('print-area') || id.includes('print_area');
      const hasGuideName = name.includes('print') || name.includes('area') ||
                           name.includes('guide') || name.includes('overlay') ||
                           name.includes('label');

      // Check for dashed blue stroke (any shade of blue)
      const hasBlueDashedStroke = obj.stroke &&
                                  (obj.stroke.includes('#007bff') ||
                                   obj.stroke.includes('#3b82f6') ||
                                   obj.stroke.includes('blue')) &&
                                  obj.strokeDashArray &&
                                  obj.strokeDashArray.length > 0;

      // Check if it's a rectangle with specific characteristics
      const looksLikePrintArea = obj.type === 'rect' &&
                                 obj.strokeDashArray &&
                                 !obj.selectable;

      return hasGuideId || hasGuideName || hasBlueDashedStroke || looksLikePrintArea;
    });

    console.log('[Designer] Removing', guidesToRemove.length, 'guide objects');

    guidesToRemove.forEach((obj, idx) => {
      console.log(`[Designer] Removing:`, {
        name: obj.name || 'unnamed',
        id: obj.id || 'no-id',
        type: obj.type
      });
      canvas.remove(obj);
    });

    // CRITICAL: Verify canvas is still valid before renderAll
    try {
      const ctx = canvas.getContext();
      if (ctx && canvas.renderAll) {
        canvas.renderAll();
      } else {
        console.log('[Designer] Skipping renderAll - canvas context invalid');
      }
    } catch (error) {
      console.error('[Designer] Error during renderAll in clearPrintAreaGuides:', error);
    }
  };

  /**
   * Manual save button handler
   */
  const handleSavePosition = () => {
    console.log('═══════════════════════════════════');
    console.log('[handleSavePosition] Save button clicked');
    console.log('[handleSavePosition] Active print area:', activePrintArea);
    console.log('[handleSavePosition] Print areas visible:', printAreasVisible);

    // Check if there's an active print area
    if (!activePrintArea || !printAreasVisible) {
      console.log('[handleSavePosition] ❌ No active print area');
      setSaveStatus({
        type: 'error',
        message: '⚠️ Please select a print area first'
      });
      setTimeout(() => setSaveStatus(null), 3000);
      return;
    }

    // Check if this print area already has saved designs
    const printAreaKey = activePrintArea.toLowerCase().replace(/\s+/g, '-');
    const colorName = currentColorData?.color_name?.toLowerCase().replace(/\s+/g, '-') || 'default';
    const variantKey = `${selectedProduct}-${colorName}-${selectedView}-${printAreaKey}`;

    let isUpdate = false;
    try {
      const allDesigns = JSON.parse(localStorage.getItem('userDesigns') || '{}');
      isUpdate = !!allDesigns[variantKey];
      console.log('[handleSavePosition] Is update:', isUpdate, 'for key:', variantKey);
    } catch (err) {
      console.error('[handleSavePosition] Error checking existing:', err);
    }

    // Save designs
    console.log('[handleSavePosition] Calling saveCurrentDesigns...');
    const designs = saveCurrentDesigns();

    console.log('[handleSavePosition] Saved', designs.length, 'designs');

    // Show feedback with appropriate action word
    if (designs.length > 0) {
      const action = isUpdate ? 'Updated' : 'Saved';
      setSaveStatus({
        type: 'success',
        message: `✓ ${action} ${designs.length} design(s) to ${activePrintArea}`
      });
      console.log(`[handleSavePosition] ✅ ${action}!`);
    } else {
      setSaveStatus({
        type: 'success',
        message: `✓ Position saved (no designs)`
      });
      console.log('[handleSavePosition] ✅ Saved empty state');
    }

    // Clear status after 3 seconds
    setTimeout(() => {
      setSaveStatus(null);
    }, 3000);

    console.log('═══════════════════════════════════');
  };

  /**
   * Add current design to shopping cart
   */
  const handleAddToCart = () => {
    console.log('[handleAddToCart] Adding design to cart');

    if (!canvas || !currentProduct) {
      setSaveStatus({
        type: 'error',
        message: '⚠️ No design to add'
      });
      setTimeout(() => setSaveStatus(null), 3000);
      return;
    }

    try {
      // Capture current design as Fabric.js JSON
      const designData = canvas.toJSON(['id', 'name', 'selectable', 'evented']);

      // Generate preview thumbnail (smaller for cart)
      const previewImage = canvas.toDataURL({
        format: 'png',
        quality: 0.8,
        multiplier: 0.3 // Smaller thumbnail
      });

      // Create cart item
      const cartItem = {
        product_template_id: currentProduct.id,
        product_name: currentProduct.name,
        product_key: selectedProduct,
        color: selectedColor,
        color_name: currentColorData?.color_name || 'Unknown',
        view: selectedView,
        print_area: activePrintArea,
        design_data: designData,
        preview_image: previewImage,
        quantity: 1,
        price: currentProduct.base_price || 19.99
      };

      // Add to cart
      addToCart(cartItem);

      // Show success message
      setSaveStatus({
        type: 'success',
        message: '✓ Added to cart!'
      });
      setTimeout(() => setSaveStatus(null), 3000);

      // Open cart panel
      setTimeout(() => openCart(), 500);

      console.log('[handleAddToCart] Successfully added to cart');
    } catch (error) {
      console.error('[handleAddToCart] Error:', error);
      setSaveStatus({
        type: 'error',
        message: '⚠️ Failed to add to cart'
      });
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  /**
   * Get the number of designs saved for a specific print area
   * @param {string} printAreaName - Name of the print area
   * @returns {number} Number of designs
   */
  const getPrintAreaDesignCount = (printAreaName) => {
    try {
      const allDesigns = JSON.parse(localStorage.getItem('userDesigns') || '{}');
      const colorName = currentColorData?.color_name || 'unknown';
      const printAreaKey = printAreaName.toLowerCase().replace(/\s+/g, '-');
      const variantKey = `${selectedProduct}-${colorName.toLowerCase().replace(/\s+/g, '-')}-${selectedView}-${printAreaKey}`;

      const designs = allDesigns[variantKey] || [];
      return designs.length;
    } catch {
      return 0;
    }
  };

  const handleViewClick = async (buttonPressed, event) => {
    console.log('═══════════════════════════════════');
    console.log('[handleViewClick] Button pressed:', buttonPressed);

    // Map buttons to specific print area names
    const buttonToPrintAreaMap = {
      'front': 'Center Chest',
      'left': 'Left Breast Pocket',
      'right': 'Right Breast Pocket',
      'back': 'Center Back'
    };

    const targetPrintArea = buttonToPrintAreaMap[buttonPressed];
    console.log('[handleViewClick] Target print area:', targetPrintArea);
    console.log('[handleViewClick] Current print area:', activePrintArea);

    // STEP 1: Check for double-click (same button clicked twice)
    if (activePrintArea === targetPrintArea && printAreasVisible) {
      console.log('[handleViewClick] Double-click detected - hiding print areas');
      setPrintAreasVisible(false);

      // Clear user designs from canvas when hiding
      if (canvas) {
        const userObjects = canvas.getObjects().filter(obj =>
          obj.name === 'user-image' || obj.name === 'user-text'
        );
        console.log('[handleViewClick] Clearing', userObjects.length, 'user objects from canvas');
        userObjects.forEach(obj => canvas.remove(obj));
        canvas.renderAll();
      }

      console.log('═══════════════════════════════════');
      return;
    }

    // STEP 2: Determine which view to load (front or back)
    const viewToLoad = buttonPressed === 'back' ? 'back' : 'front';
    const viewChanging = selectedView !== viewToLoad;

    console.log('[handleViewClick] View changing:', viewChanging, '(', selectedView, '->', viewToLoad, ')');

    // STEP 3: Update state
    console.log('[handleViewClick] Setting active print area to:', targetPrintArea);
    setActivePrintArea(targetPrintArea);
    setPrintAreasVisible(true);
    setSelectedViewButton(buttonPressed);

    // STEP 4: If NOT changing views, restore designs immediately
    if (!viewChanging && canvas) {
      console.log('[handleViewClick] Same view - restoring designs immediately');
      await restoreDesignsForPrintArea(targetPrintArea);
    } else {
      console.log('[handleViewClick] View changing - designs will restore after template loads');

      // Mark template as rendering
      setTemplateRendering(true);

      // Change view (this triggers template load)
      setSelectedView(viewToLoad);

      // FIX: Force print area visibility after view changes (especially for back view)
      setTimeout(() => {
        console.log('[handleViewClick] setTimeout: Forcing print area visibility for:', targetPrintArea);
        setPrintAreasVisible(true);
        setActivePrintArea(targetPrintArea);
      }, 100); // Small delay to ensure view change completes

      // Template load will handle: setTemplateRendering(false) + restore designs
    }

    console.log('═══════════════════════════════════');
  };

  const handleViewDoubleClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    console.log('[Designer] ✨ DOUBLE CLICK DETECTED ✨');
    setShowPrintAreaGuide(prev => {
      const newValue = !prev;
      console.log('[Designer] Toggling print area guide visibility to:', newValue);
      return newValue;
    });
  };

  // Zoom handler functions
  const applyZoom = (zoom) => {
    if (!canvas) return;

    console.log('[applyZoom] Applying zoom:', zoom);

    // Zoom centered on canvas center to prevent shifting
    const center = new fabric.Point(
      canvas.width / 2,
      canvas.height / 2
    );

    canvas.zoomToPoint(center, zoom);
    canvas.renderAll();
  };

  const handleZoomIn = () => {
    setZoomLevel(prev => {
      const newZoom = Math.min(prev + ZOOM_STEP, MAX_ZOOM);
      console.log('[Zoom] Zoom In:', newZoom);
      applyZoom(newZoom);
      return newZoom;
    });
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => {
      const newZoom = Math.max(prev - ZOOM_STEP, MIN_ZOOM);
      console.log('[Zoom] Zoom Out:', newZoom);
      applyZoom(newZoom);
      return newZoom;
    });
  };

  const handleZoomReset = () => {
    console.log('[Zoom] Reset to 100%');
    setZoomLevel(1.0);
    applyZoom(1.0);
  };

  const updatePrintAreaOverlay = () => {
    console.log('[Designer] DISABLED - using renderPrintAreaOverlays instead');
    return; // Exit early, don't do anything

    // OLD CODE BELOW - DISABLED TO PREVENT CONFLICTS
    // This function was creating overlays with #007bff (bootstrap blue)
    // which conflicted with the new renderPrintAreaOverlays function
    // that uses #3b82f6 (tailwind blue)

    /*
    if (!canvas || !canvasReady.current || !currentPrintArea) {
      console.warn('[Designer] Canvas not ready for overlay update');
      return;
    }

    // Check canvas context is valid
    const context = canvas.getContext('2d');
    if (!context) {
      console.error('[Designer] Canvas context invalid');
      return;
    }

    console.log('[Designer] Updating print area overlay');

    // Remove existing print area overlay
    const existingOverlay = canvas.getObjects().find(obj => obj.id === 'printAreaOverlay');
    if (existingOverlay) {
      canvas.remove(existingOverlay);
    }

    // Create print area overlay
    const overlay = new fabric.Rect({
      left: currentPrintArea.x,
      top: currentPrintArea.y,
      width: currentPrintArea.width,
      height: currentPrintArea.height,
      fill: 'rgba(0, 123, 255, 0.1)',
      stroke: '#007bff',
      strokeWidth: 2,
      strokeDashArray: [5, 5],
      selectable: false,
      evented: false,
      excludeFromExport: true,
      id: 'printAreaOverlay'
    });

    canvas.add(overlay);

    // Move overlay to front by removing and re-adding it
    try {
      canvas.remove(overlay);
      canvas.add(overlay);
    } catch (error) {
      console.warn('Could not move overlay to front:', error);
    }

    canvas.renderAll();
    */
  };

  // Check user authentication
  useEffect(() => {
    const checkUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setUser(user);

        // TEMPORARILY DISABLED: Check for anonymous designs on mount
        // if (!user) {
        //   const sessionId = getSessionId();
        //   const anonymousDesigns = await getUserDesigns(null, sessionId);
        //   if (anonymousDesigns && anonymousDesigns.length > 0) {
        //     setAnonymousDesignCount(anonymousDesigns.length);
        //   }
        // }
      } catch (error) {
        console.error('Error checking user:', error);
      }
    };

    checkUser();

    // Fixed: In Supabase v2, onAuthStateChange returns the subscription directly
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const newUser = session?.user || null;
      setUser(newUser);

      if (event === 'SIGNED_IN') {
        setShowAuth(false);

        // TEMPORARILY DISABLED: Check for anonymous designs to migrate
        // const sessionId = getSessionId();
        // const anonymousDesigns = await getUserDesigns(null, sessionId);
        // if (anonymousDesigns && anonymousDesigns.length > 0) {
        //   setAnonymousDesignCount(anonymousDesigns.length);
        //   setShowMigratePrompt(true);
        // }

        // TEMPORARILY DISABLED: Load user's designs
        // loadUserDesigns();
      } else if (event === 'SIGNED_OUT') {
        // TEMPORARILY DISABLED: Design persistence
        // setSavedDesigns([]);
        // setCurrentDesignId(null);
        // Check for anonymous designs
        // const sessionId = getSessionId();
        // const anonymousDesigns = await getUserDesigns(null, sessionId);
        // if (anonymousDesigns && anonymousDesigns.length > 0) {
        //   setAnonymousDesignCount(anonymousDesigns.length);
        // }
      }
    });

    return () => {
      if (subscription && typeof subscription.unsubscribe === 'function') {
        subscription.unsubscribe();
      }
    };
  }, []);

  // TEMPORARILY DISABLED: Load user's saved designs
  // const loadUserDesigns = async () => {
  //   setLoadingDesigns(true);
  //   try {
  //     const userId = user?.id || null;
  //     const sessionId = !userId ? getSessionId() : null;

  //     console.log('[Designer] Loading designs for:', { userId, sessionId });
  //     const designs = await getUserDesigns(userId, sessionId);

  //     if (designs) {
  //       setSavedDesigns(designs);
  //       console.log('[Designer] Loaded', designs.length, 'saved designs');
  //     }
  //   } catch (error) {
  //     console.error('[Designer] Error loading designs:', error);
  //   } finally {
  //     setLoadingDesigns(false);
  //   }
  // };

  // TEMPORARILY DISABLED: Load designs when user changes
  // useEffect(() => {
  //   if (user) {
  //     loadUserDesigns();
  //   } else {
  //     // Load anonymous designs
  //     loadUserDesigns();
  //   }
  // }, [user]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        alert('Check your email for the confirmation link!');
      }
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const addText = () => {
    console.log('[Designer] addText called:', {
      hasCanvas: !!canvas,
      hasCurrentPrintArea: !!currentPrintArea,
      printAreasLoaded,
      printAreasCount: printAreas.length
    });

    if (!canvas || !currentPrintArea) {
      console.warn('[Designer] addText blocked - missing canvas or print area');
      return;
    }

    const text = new fabric.IText('Your Text Here', {
      left: currentPrintArea.x + currentPrintArea.width / 2,
      top: currentPrintArea.y + currentPrintArea.height / 2,
      fontFamily: textFont,
      fontSize: 24,
      fill: textColor,
      textAlign: textAlign,
      originX: 'center',
      originY: 'center',
      selectable: true,
      evented: true,
      name: 'user-text',  // Mark as user text
      id: 'text-' + Date.now()  // Unique ID
    });

    console.log('[Designer] Text marked as user-text with ID:', text.id);

    canvas.add(text);
    canvas.setActiveObject(text);

    canvas.renderAll();

    console.log('[Designer] ✅ Text added successfully with name:', text.name);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) {
      console.log('[Designer] No file selected');
      return;
    }

    if (!canvas) {
      console.error('[Designer] Canvas not ready');
      return;
    }

    console.log('[Designer] Image selected:', file.name, file.type, file.size);

    // Get print area - use first print area if currentPrintArea is not set
    let printArea = currentPrintArea || (printAreas && printAreas[0]);

    // If no print areas defined, use default and warn
    if (!printArea) {
      console.warn('[Designer] No print areas defined, using default print area');
      printArea = getDefaultPrintArea();

      // Update state to include the default print area
      if (printAreas.length === 0) {
        setPrintAreas([printArea]);
        setPrintAreasLoaded(true);
      }
    }

    console.log('[Designer] Using print area:', printArea.name);

    const reader = new FileReader();
    reader.onerror = (error) => {
      console.error('[Designer] File read error:', error);
      alert('Failed to read image file. Please try again.');
    };

    reader.onload = (event) => {
      console.log('[Designer] File loaded, creating fabric image...');

      // Add timestamp to make URL unique (allows uploading same image multiple times)
      const uniqueUrl = event.target.result + '#t=' + Date.now();

      fabric.Image.fromURL(uniqueUrl, (img) => {
        if (!img || !img._element) {
          console.error('[Designer] Failed to create fabric image');
          alert('Failed to load image. Please try a different file.');
          return;
        }

        console.log('[Designer] Image loaded:', img.width, 'x', img.height);

        // Scale image to fit within print area (use 50% of print area for initial size)
        const printAreaScaled = printArea.width * imageScale;
        const printAreaHeight = printArea.height * imageScale;
        const maxWidth = printAreaScaled * 0.5;
        const maxHeight = printAreaHeight * 0.5;

        const scale = Math.min(maxWidth / img.width, maxHeight / img.height);
        console.log('[Designer] Scaling image by:', scale);

        img.scale(scale);

        // Position in center of canvas
        img.set({
          left: canvas.width / 2,
          top: canvas.height / 2,
          originX: 'center',
          originY: 'center',
          selectable: true,
          evented: true,
          name: 'user-image',  // Mark as user image
          id: 'img-' + Date.now()  // Unique ID
        });

        console.log('[Designer] Adding image to canvas at:', img.left, img.top);
        console.log('[Designer] Image marked as user-image with ID:', img.id);

        canvas.add(img);
        canvas.setActiveObject(img);

        canvas.renderAll();

        console.log('[Designer] ✅ Image added successfully with name:', img.name);

        // Clear the file input so same file can be uploaded again
        e.target.value = '';
      }, { crossOrigin: 'anonymous' });
    };

    reader.readAsDataURL(file);
  };

  const deleteSelected = () => {
    if (!canvas) return;
    const activeObjects = canvas.getActiveObjects();
    activeObjects.forEach(obj => {
      if (obj.id !== 'printAreaOverlay') {
        canvas.remove(obj);
      }
    });
    canvas.discardActiveObject();
    canvas.renderAll();
  };

  const rotateSelected = (direction) => {
    if (!canvas) return;
    const activeObject = canvas.getActiveObject();
    if (activeObject && activeObject.id !== 'printAreaOverlay') {
      const currentAngle = activeObject.angle || 0;
      activeObject.rotate(currentAngle + (direction === 'left' ? -15 : 15));
      canvas.renderAll();
    }
  };

  const nudgeSelected = (direction, distance = 1) => {
    if (!canvas) return;
    const activeObject = canvas.getActiveObject();
    if (!activeObject || activeObject.id === 'printAreaOverlay') return;

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
  };

  // Keyboard shortcuts for nudging
  useEffect(() => {
    if (!canvas) return;

    const handleKeyDown = (e) => {
      // Only handle arrow keys when an object is selected
      const activeObject = canvas.getActiveObject();
      if (!activeObject || activeObject.id === 'printAreaOverlay') return;

      // Check if user is typing in a text field
      if (activeObject.type === 'i-text' && activeObject.isEditing) return;

      // Prevent default for arrow keys
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();

        // Determine distance: 10px with Shift, 1px without
        const distance = e.shiftKey ? 10 : 1;

        // Call nudgeSelected with appropriate direction
        switch (e.key) {
          case 'ArrowUp':
            nudgeSelected('up', distance);
            break;
          case 'ArrowDown':
            nudgeSelected('down', distance);
            break;
          case 'ArrowLeft':
            nudgeSelected('left', distance);
            break;
          case 'ArrowRight':
            nudgeSelected('right', distance);
            break;
        }
      }
    };

    // Add event listener to window
    window.addEventListener('keydown', handleKeyDown);

    // Cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [canvas]);

  const exportDesign = () => {
    if (!canvas) return;

    // Hide print area overlay for export
    const overlay = canvas.getObjects().find(obj => obj.id === 'printAreaOverlay');
    if (overlay) {
      overlay.set('visible', false);
    }

    // Hide watermark if needed
    const watermark = canvas.getObjects().find(obj => obj.id === 'watermark');
    if (watermark && !watermarkVisible) {
      watermark.set('visible', false);
    }

    canvas.renderAll();

    // Export as image
    const dataURL = canvas.toDataURL({
      format: 'png',
      quality: 1,
      multiplier: 1
    });

    // Create download link
    const link = document.createElement('a');
    link.download = `${currentProduct.name.toLowerCase().replace(/\s+/g, '-')}-design.png`;
    link.href = dataURL;
    link.click();

    // Restore overlay visibility
    if (overlay) {
      overlay.set('visible', true);
    }
    if (watermark) {
      watermark.set('visible', watermarkVisible);
    }
    canvas.renderAll();
  };

  const exportPDF = () => {
    if (!canvas) return;

    // Hide overlays for export
    const overlay = canvas.getObjects().find(obj => obj.id === 'printAreaOverlay');
    if (overlay) overlay.set('visible', false);

    const watermark = canvas.getObjects().find(obj => obj.id === 'watermark');
    if (watermark && !watermarkVisible) watermark.set('visible', false);

    canvas.renderAll();

    // Create PDF
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const imgData = canvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 10, 10, 190, 190);
    pdf.save(`${currentProduct.name.toLowerCase().replace(/\s+/g, '-')}-design.pdf`);

    // Restore visibility
    if (overlay) overlay.set('visible', true);
    if (watermark) watermark.set('visible', watermarkVisible);
    canvas.renderAll();
  };

  // TEMPORARILY DISABLED: Design persistence functions
  // const saveDesign = async () => {
  //   if (!canvas) {
  //     alert('Canvas not ready');
  //     return;
  //   }

  //   // Show save modal to get design name
  //   setShowSaveModal(true);
  // };

  // const handleSaveDesign = async () => {
  //   if (!canvas) {
  //     alert('Canvas not ready');
  //     return;
  //   }

  //   if (!designName.trim()) {
  //     alert('Please enter a design name');
  //     return;
  //   }

  //   setSavingDesign(true);
  //   setSaveStatus('saving');

  //   try {
  //     const userId = user?.id || null;
  //     const sessionId = !userId ? getSessionId() : null;

  //     console.log('[Designer] Saving design:', {
  //       name: designName,
  //       userId,
  //       sessionId,
  //       product: selectedProduct,
  //       color: selectedColor,
  //       view: selectedView
  //     });

  //     const designData = {
  //       canvas,
  //       designName: designName.trim(),
  //       productTemplateId: currentProduct.id,
  //       variantId: currentVariant?.variantId || null,
  //       viewName: selectedView,
  //       isPublic: false
  //     };

  //     if (currentDesignId) {
  //       // Update existing design
  //       console.log('[Designer] Updating existing design:', currentDesignId);
  //       const result = await updateUserDesign(currentDesignId, designData);
  //       if (result) {
  //         setSaveStatus('saved');
  //         console.log('[Designer] Design updated successfully');
  //         setTimeout(() => setSaveStatus(''), 2000);
  //         setShowSaveModal(false);
  //         loadUserDesigns(); // Reload designs list
  //       } else {
  //         throw new Error('Failed to update design');
  //       }
  //     } else {
  //       // Save new design
  //       const result = await saveUserDesign(designData);
  //       if (result) {
  //         setSaveStatus('saved');
  //         setCurrentDesignId(result.id); // Track design ID for future updates
  //         console.log('[Designer] Design saved successfully with ID:', result.id);
  //         setTimeout(() => setSaveStatus(''), 2000);
  //         setShowSaveModal(false);
  //         loadUserDesigns(); // Reload designs list
  //       } else {
  //         throw new Error('Failed to save design');
  //       }
  //     }
  //   } catch (error) {
  //     console.error('[Designer] Error saving design:', error);
  //     setSaveStatus('error');
  //     alert('Error saving design. Please try again.');
  //     setTimeout(() => setSaveStatus(''), 3000);
  //   } finally {
  //     setSavingDesign(false);
  //   }
  // };

  // const handleLoadDesign = async (designId) => {
  //   if (!canvas) {
  //     alert('Canvas not ready');
  //     return;
  //   }

  //   try {
  //     console.log('[Designer] Loading design:', designId);
  //     const design = await getUserDesign(designId);

  //     if (!design) {
  //       alert('Design not found');
  //       return;
  //     }

  //     console.log('[Designer] Design loaded:', design);

  //     // Load the design's canvas data
  //     if (design.design_data) {
  //       canvas.loadFromJSON(design.design_data, () => {
  //         canvas.renderAll();
  //         console.log('[Designer] Canvas loaded from design');
  //       });
  //     }

  //     // Set current design tracking
  //     setCurrentDesignId(design.id);
  //     setDesignName(design.design_name);

  //     // Update product/color/view if different
  //     if (design.product_template && design.product_template.product_key !== selectedProduct) {
  //       setSelectedProduct(design.product_template.product_key);
  //     }
  //     if (design.variant && design.variant.color_name) {
  //       // Find color code from variant
  //       const productData = products[design.product_template.product_key];
  //       if (productData && productData.colorVariants) {
  //         const colorEntry = Object.entries(productData.colorVariants).find(
  //           ([code, data]) => data.colorName === design.variant.color_name
  //         );
  //         if (colorEntry) {
  //           setSelectedColor(colorEntry[0]);
  //         }
  //       }
  //     }
  //     if (design.view_name && design.view_name !== selectedView) {
  //       setSelectedView(design.view_name);
  //     }

  //     setShowMyDesigns(false);
  //     alert('Design loaded successfully!');
  //   } catch (error) {
  //     console.error('[Designer] Error loading design:', error);
  //     alert('Error loading design. Please try again.');
  //   }
  // };

  // const handleDeleteDesign = async (designId) => {
  //   if (!confirm('Are you sure you want to delete this design? This cannot be undone.')) {
  //     return;
  //   }

  //   try {
  //     console.log('[Designer] Deleting design:', designId);
  //     const result = await deleteUserDesign(designId);

  //     if (result) {
  //       console.log('[Designer] Design deleted successfully');
  //       loadUserDesigns(); // Reload designs list

  //       // Clear current design if it was the one deleted
  //       if (currentDesignId === designId) {
  //         setCurrentDesignId(null);
  //         setDesignName('');
  //       }

  //       alert('Design deleted successfully');
  //     } else {
  //       throw new Error('Failed to delete design');
  //     }
  //   } catch (error) {
  //     console.error('[Designer] Error deleting design:', error);
  //     alert('Error deleting design. Please try again.');
  //   }
  // };

  // const handleMigrateDesigns = async () => {
  //   try {
  //     const sessionId = getSessionId();
  //     const userId = user?.id;

  //     if (!userId) {
  //       alert('You must be logged in to migrate designs');
  //       return;
  //     }

  //     console.log('[Designer] Migrating designs from session:', sessionId, 'to user:', userId);
  //     const count = await migrateSessionDesignsToUser(sessionId, userId);

  //     if (count > 0) {
  //       console.log('[Designer] Migrated', count, 'designs');
  //       alert(`Successfully migrated ${count} design(s) to your account!`);
  //       setShowMigratePrompt(false);
  //       setAnonymousDesignCount(0);
  //       loadUserDesigns(); // Reload to show migrated designs
  //     } else {
  //       alert('No designs to migrate');
  //       setShowMigratePrompt(false);
  //     }
  //   } catch (error) {
  //     console.error('[Designer] Error migrating designs:', error);
  //     alert('Error migrating designs. Please try again.');
  //   }
  // };

  // Get available print areas for current product
  const availablePrintAreas = (currentProduct && currentProduct.printAreas) ? Object.keys(currentProduct.printAreas) : [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">Design Studio</h1>
            
            <div className="flex items-center space-x-4">
              {user ? (
                <div className="flex items-center space-x-2">
                  <User className="w-5 h-5" />
                  <span className="text-sm text-gray-600">{user.email}</span>
                  <button
                    onClick={handleSignOut}
                    className="flex items-center space-x-1 px-3 py-1 text-sm text-red-600 hover:text-red-800"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAuth(true)}
                  className="flex items-center space-x-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Sign In</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left Sidebar - Product Selection + Color + Print Location */}
          <div className="w-full lg:w-80 flex-shrink-0 order-1 lg:order-none space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-semibold mb-4">Product</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Product
                  </label>
                  {loadingProducts ? (
                    <div className="text-sm text-gray-500">Loading products...</div>
                  ) : (
                    <>
                      <select
                        value={selectedProduct}
                        onChange={(e) => {
                          console.log('[Designer] Dropdown changed to:', e.target.value);
                          setSelectedProduct(e.target.value);
                          const newProduct = useDatabase ? products[e.target.value] : productsConfig[e.target.value];
                          // Set default view to 'front' when product changes
                          setSelectedView('front');
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {useDatabase
                          ? Object.entries(products).map(([key, product]) => {
                              console.log('[Designer] Rendering dropdown option:', key, product.name);
                              return (
                                <option key={key} value={key}>
                                  {product.name} - ${product.basePrice}
                                </option>
                              );
                            })
                          : Object.entries(productsConfig).map(([key, product]) => (
                              <option key={key} value={key}>
                                {product.name} - ${product.basePrice}
                              </option>
                            ))
                        }
                      </select>

                      {/* DEBUG INFO */}
                      <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                        <p className="font-bold text-yellow-900">🐛 DEBUG INFO:</p>
                        <p className="text-yellow-800">• useDatabase: <span className="font-mono">{String(useDatabase)}</span></p>
                        <p className="text-yellow-800">• loadingProducts: <span className="font-mono">{String(loadingProducts)}</span></p>
                        <p className="text-yellow-800">• products count: <span className="font-mono">{Object.keys(products).length}</span></p>
                        <p className="text-yellow-800">• product keys: <span className="font-mono">{Object.keys(products).join(', ') || 'none'}</span></p>
                        <p className="text-yellow-800">• selectedProduct: <span className="font-mono">{selectedProduct}</span></p>
                        <p className="text-yellow-800">• productsConfig keys: <span className="font-mono">{Object.keys(productsConfig).join(', ')}</span></p>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-yellow-900 font-medium">View full products object</summary>
                          <pre className="mt-1 p-2 bg-white rounded overflow-auto max-h-40 text-xs">
                            {JSON.stringify(products, null, 2)}
                          </pre>
                        </details>
                      </div>
                    </>
                  )}
                </div>

                {/* Database-Driven Color Selector */}
                {useDatabase && productColors.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Color {loadingColors && <span className="text-xs text-gray-500">(loading...)</span>}
                      {changingColor && <span className="text-xs text-blue-600">(changing color...)</span>}
                    </label>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {productColors && productColors
                        .filter(color => color && color.hex_code && color.color_name)
                        .map((color, index) => {
                          const isSelected = selectedColorId === color.id;
                          return (
                            <button
                              key={color.id || index}
                              onClick={() => {
                                console.log('[Color Swatch] Color selected:', color.color_name);

                                // Update state - the dedicated color change useEffect will handle image update
                                setSelectedColorId(color.id);
                                setCurrentColorData(color);
                                setSelectedColor(color.hex_code);

                                // NOTE: No need to call handleColorChange - the useEffect handles it automatically
                              }}
                              disabled={changingColor}
                              className={`w-9 h-9 rounded-full border-3 ${
                                isSelected ? 'border-blue-600 ring-2 ring-blue-300' : 'border-gray-300'
                              } ${changingColor ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-400'} transition-all`}
                              style={{ backgroundColor: color.hex_code }}
                              title={color.color_name}
                            />
                          );
                        })}
                    </div>

                    {/* Selected Color Info */}
                    {currentColorData && (
                      <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded border border-gray-200">
                        <div className="font-medium text-gray-900">{currentColorData.color_name}</div>
                        {currentColorData.pantone_code && (
                          <div className="text-xs">{currentColorData.pantone_code}</div>
                        )}
                        <div className="text-xs">{currentColorData.hex_code}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Fallback: JSON Config Colors */}
                {(!useDatabase || productColors.length === 0) && currentProduct && currentProduct.colors.length > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Color
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {currentProduct.colors.map((color) => (
                        <button
                          key={color}
                          onClick={() => {
                            setSelectedColor(color);
                            // Colors are independent of views in the new system
                          }}
                          className={`w-8 h-8 rounded-full border-2 ${
                            selectedColor === color ? 'border-blue-500' : 'border-gray-300'
                          }`}
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* View Selector - Show Front/Left/Right/Back buttons */}
                {useDatabase && currentProduct && (() => {
                  // Determine which views have print areas available
                  const viewMapping = {
                    'center_chest': 'front',
                    'left_breast_pocket': 'left',
                    'right_breast_pocket': 'right',
                    'left_sleeve': 'left',
                    'right_sleeve': 'right',
                    'center_back': 'back',
                    'front_print': 'front',
                    'back_print': 'back',
                    'left_print': 'left',
                    'right_print': 'right',
                    'side_print': 'front',
                    'top_print': 'front',
                    'bottom_print': 'back',
                    'front': 'front',
                    'back': 'back',
                    'left': 'left',
                    'right': 'right'
                  };

                  const availableViews = printAreas?.map(area =>
                    viewMapping[area.area_key] || area.view_name || 'front'
                  ) || [];
                  const uniqueViews = [...new Set(availableViews)];

                  const hasFront = uniqueViews.includes('front');
                  const hasLeft = uniqueViews.includes('left');
                  const hasRight = uniqueViews.includes('right');
                  const hasBack = uniqueViews.includes('back');

                  return (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Print Location
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {/* Front button */}
                        <button
                          onClick={() => hasFront && handleViewClick('front')}
                          disabled={!hasFront}
                          className={`px-3 py-2 rounded-md border-2 text-sm font-medium flex items-center gap-2 transition-all ${
                            !hasFront
                              ? 'opacity-40 cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
                              : activePrintArea === 'Center Chest' && printAreasVisible
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                          }`}
                          title={hasFront ? "Center Chest - Click twice to hide" : "No front print area available"}
                        >
                          <span>Front</span>
                          {hasFront && getPrintAreaDesignCount('Center Chest') > 0 && (
                            <span className="inline-block bg-blue-500 text-white text-xs font-bold rounded-full px-2 py-0.5 min-w-[20px] text-center">
                              {getPrintAreaDesignCount('Center Chest')}
                            </span>
                          )}
                        </button>

                        {/* Left button */}
                        <button
                          onClick={() => hasLeft && handleViewClick('left')}
                          disabled={!hasLeft}
                          className={`px-3 py-2 rounded-md border-2 text-sm font-medium flex items-center gap-2 transition-all ${
                            !hasLeft
                              ? 'opacity-40 cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
                              : activePrintArea === 'Left Breast Pocket' && printAreasVisible
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                          }`}
                          title={hasLeft ? "Left Breast Pocket - Click twice to hide" : "No left print area available"}
                        >
                          <span>Left</span>
                          {hasLeft && getPrintAreaDesignCount('Left Breast Pocket') > 0 && (
                            <span className="inline-block bg-blue-500 text-white text-xs font-bold rounded-full px-2 py-0.5 min-w-[20px] text-center">
                              {getPrintAreaDesignCount('Left Breast Pocket')}
                            </span>
                          )}
                        </button>

                        {/* Right button */}
                        <button
                          onClick={() => hasRight && handleViewClick('right')}
                          disabled={!hasRight}
                          className={`px-3 py-2 rounded-md border-2 text-sm font-medium flex items-center gap-2 transition-all ${
                            !hasRight
                              ? 'opacity-40 cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
                              : activePrintArea === 'Right Breast Pocket' && printAreasVisible
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                          }`}
                          title={hasRight ? "Right Breast Pocket - Click twice to hide" : "No right print area available"}
                        >
                          <span>Right</span>
                          {hasRight && getPrintAreaDesignCount('Right Breast Pocket') > 0 && (
                            <span className="inline-block bg-blue-500 text-white text-xs font-bold rounded-full px-2 py-0.5 min-w-[20px] text-center">
                              {getPrintAreaDesignCount('Right Breast Pocket')}
                            </span>
                          )}
                        </button>

                        {/* Back button */}
                        <button
                          onClick={() => hasBack && handleViewClick('back')}
                          disabled={!hasBack}
                          className={`px-3 py-2 rounded-md border-2 text-sm font-medium flex items-center gap-2 transition-all ${
                            !hasBack
                              ? 'opacity-40 cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
                              : activePrintArea === 'Center Back' && printAreasVisible
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                          }`}
                          title={hasBack ? "Center Back - Click twice to hide" : "No back print area available"}
                        >
                          <span>Back</span>
                          {hasBack && getPrintAreaDesignCount('Center Back') > 0 && (
                            <span className="inline-block bg-blue-500 text-white text-xs font-bold rounded-full px-2 py-0.5 min-w-[20px] text-center">
                              {getPrintAreaDesignCount('Center Back')}
                            </span>
                          )}
                        </button>
                      </div>
                      <p className="text-sm text-blue-600 font-medium mt-2 bg-blue-50 p-2 rounded">
                        💡 Tip: Each print area has its own independent designs. Click a button to switch areas. Badges show design count per area.
                      </p>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Zoom Controls - Mobile order-2, Desktop right sidebar */}
          <div className="w-full lg:w-72 flex-shrink-0 order-2 lg:order-last">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Zoom: {Math.round(zoomLevel * 100)}%
                  </label>
                  <div className="flex gap-2 items-center justify-center">
                    <button
                      onClick={handleZoomOut}
                      disabled={zoomLevel <= MIN_ZOOM}
                      className="flex items-center justify-center w-9 h-9 border border-gray-300 bg-white rounded-md cursor-pointer transition-all hover:bg-gray-100 hover:border-blue-500 hover:text-blue-500 active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Zoom Out (Mouse Wheel)"
                    >
                      <svg width="20" height="20" viewBox="0 0 20 20">
                        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" fill="none"/>
                        <line x1="6" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                    </button>

                    <button
                      onClick={handleZoomReset}
                      className="flex items-center justify-center w-9 h-9 border border-gray-300 bg-white rounded-md cursor-pointer transition-all hover:bg-gray-100 hover:border-blue-500 hover:text-blue-500 active:translate-y-0"
                      title="Reset Zoom (100%)"
                    >
                      <span className="text-xs font-bold">100%</span>
                    </button>

                    <button
                      onClick={handleZoomIn}
                      disabled={zoomLevel >= MAX_ZOOM}
                      className="flex items-center justify-center w-9 h-9 border border-gray-300 bg-white rounded-md cursor-pointer transition-all hover:bg-gray-100 hover:border-blue-500 hover:text-blue-500 active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Zoom In (Mouse Wheel)"
                    >
                      <svg width="20" height="20" viewBox="0 0 20 20">
                        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" fill="none"/>
                        <line x1="6" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="2"/>
                        <line x1="10" y1="6" x2="10" y2="14" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                    </button>
                  </div>
                  <p className="text-xs text-gray-600 text-center mt-2 italic">
                    💡 Use mouse wheel to zoom
                  </p>
                </div>
            </div>
          </div>

          {/* Canvas Area - Mobile order-3, Desktop center (flex-1) */}
          <div className="w-full lg:flex-1 order-3 lg:order-2">
            <div className="bg-gray-100 rounded-lg p-2 sm:p-4 lg:p-8">
              <div className="bg-white shadow-lg rounded-lg p-2 sm:p-4 w-full h-full">
                {/* Card Header with Title and Action Buttons */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-2 sm:mb-4 gap-2">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-base sm:text-lg font-semibold">Design Canvas</h3>
                    <div className="text-xs sm:text-sm text-gray-500">
                      {templateLoaded ? 'Template Loaded' : 'Loading Template...'}
                    </div>
                  </div>

                  {/* Save & Cart Buttons - Compact in Header */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSavePosition}
                      className="px-2 py-1.5 sm:px-3 sm:py-2 bg-blue-500 text-white font-semibold text-xs rounded-md shadow hover:bg-blue-600 transition-all flex items-center gap-1.5"
                      title="Save current designs for this print area"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                        <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
                      </svg>
                      <span>Save</span>
                    </button>

                    <button
                      onClick={handleAddToCart}
                      className="px-2 py-1.5 sm:px-3 sm:py-2 bg-green-500 text-white font-semibold text-xs rounded-md shadow hover:bg-green-600 transition-all flex items-center gap-1.5"
                      title="Add design to shopping cart"
                    >
                      <ShoppingCart className="w-3 h-3" />
                      <span>Cart</span>
                    </button>

                    {/* Save feedback indicator */}
                    {saveStatus && (
                      <span
                        className={`text-xs font-semibold animate-fade-in ${
                          saveStatus.type === 'success' ? 'text-green-500' : 'text-red-500'
                        }`}
                      >
                        {saveStatus.message}
                      </span>
                    )}
                  </div>
                </div>

                {/* Canvas with responsive sizing */}
                <div ref={canvasContainerRef} className="w-full overflow-auto">
                  <canvas
                    ref={canvasRef}
                    width={canvasSize}
                    height={canvasSize}
                    className="max-w-full h-auto"
                    style={{ display: 'block', margin: '0 auto' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Tools Section - Mobile order-4, Desktop right sidebar */}
          <div className="w-full lg:w-72 flex-shrink-0 order-4 lg:order-last">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-semibold mb-4">Tools</h3>
              
              <div className="space-y-4">
                {/* Add Elements */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Add Elements</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={addText}
                      disabled={!printAreasLoaded}
                      title={!printAreasLoaded ? "Loading print areas..." : "Add text to design"}
                      className={`flex items-center justify-center space-x-1 px-3 py-2 rounded-md text-sm ${
                        printAreasLoaded
                          ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
                          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      <Type className="w-4 h-4" />
                      <span>Text</span>
                    </button>

                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!printAreasLoaded}
                      title={!printAreasLoaded ? "Loading print areas..." : "Add image to design"}
                      className={`flex items-center justify-center space-x-1 px-3 py-2 rounded-md text-sm ${
                        printAreasLoaded
                          ? 'bg-orange-600 text-white hover:bg-orange-700 cursor-pointer'
                          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      <Upload className="w-4 h-4" />
                      <span>Image</span>
                    </button>
                  </div>
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </div>

                {/* Text Options */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Text Options</h4>

                  {/* Font Dropdown */}
                  <div className="mb-3">
                    <label className="block text-xs text-gray-600 mb-1">Font</label>
                    <select
                      value={textFont}
                      onChange={(e) => {
                        const newFont = e.target.value;
                        setTextFont(newFont);
                        // Update selected text in real-time
                        if (selectedObject && selectedObject.type === 'i-text') {
                          selectedObject.set('fontFamily', newFont);
                          canvas.renderAll();
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="Arial">Arial</option>
                      <option value="Helvetica">Helvetica</option>
                      <option value="Times New Roman">Times New Roman</option>
                      <option value="Georgia">Georgia</option>
                      <option value="Courier New">Courier New</option>
                      <option value="Verdana">Verdana</option>
                      <option value="Impact">Impact</option>
                      <option value="Comic Sans MS">Comic Sans MS</option>
                      <option value="Trebuchet MS">Trebuchet MS</option>
                    </select>
                  </div>

                  {/* Color Picker */}
                  <div className="mb-3">
                    <label className="block text-xs text-gray-600 mb-1">Color</label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={textColor}
                        onChange={(e) => {
                          const newColor = e.target.value;
                          setTextColor(newColor);
                          // Update selected text in real-time
                          if (selectedObject && selectedObject.type === 'i-text') {
                            selectedObject.set('fill', newColor);
                            canvas.renderAll();
                          }
                        }}
                        className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                      />
                      <input
                        type="text"
                        value={textColor}
                        onChange={(e) => {
                          const newColor = e.target.value;
                          setTextColor(newColor);
                          // Update selected text in real-time
                          if (selectedObject && selectedObject.type === 'i-text') {
                            selectedObject.set('fill', newColor);
                            canvas.renderAll();
                          }
                        }}
                        placeholder="#000000"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                      />
                    </div>
                  </div>

                  {/* Text Alignment */}
                  <div className="mb-3">
                    <label className="block text-xs text-gray-600 mb-1">Alignment</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => {
                          setTextAlign('left');
                          // Update selected text in real-time
                          if (selectedObject && selectedObject.type === 'i-text') {
                            selectedObject.set('textAlign', 'left');
                            canvas.renderAll();
                          }
                        }}
                        className={`flex items-center justify-center px-3 py-2 rounded-md border-2 ${
                          textAlign === 'left'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                        }`}
                      >
                        <AlignLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setTextAlign('center');
                          // Update selected text in real-time
                          if (selectedObject && selectedObject.type === 'i-text') {
                            selectedObject.set('textAlign', 'center');
                            canvas.renderAll();
                          }
                        }}
                        className={`flex items-center justify-center px-3 py-2 rounded-md border-2 ${
                          textAlign === 'center'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                        }`}
                      >
                        <AlignCenter className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setTextAlign('right');
                          // Update selected text in real-time
                          if (selectedObject && selectedObject.type === 'i-text') {
                            selectedObject.set('textAlign', 'right');
                            canvas.renderAll();
                          }
                        }}
                        className={`flex items-center justify-center px-3 py-2 rounded-md border-2 ${
                          textAlign === 'right'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                        }`}
                      >
                        <AlignRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Transform Tools */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Transform</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => rotateSelected('left')}
                      className="flex items-center justify-center px-3 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => rotateSelected('right')}
                      className="flex items-center justify-center px-3 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                    >
                      <RotateCw className="w-4 h-4" />
                    </button>

                    <button
                      onClick={deleteSelected}
                      className="flex items-center justify-center px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Nudge Controls */}
                  <div className="mt-4">
                    <h5 className="text-xs font-medium text-gray-600 mb-2">Nudge (1px)</h5>
                    <div className="grid grid-cols-3 gap-1">
                      {/* Top row */}
                      <button
                        onClick={() => nudgeSelected('up-left')}
                        className="flex items-center justify-center p-2 bg-gray-500 text-white rounded hover:bg-gray-600 text-xs"
                        title="Nudge up-left"
                      >
                        ↖
                      </button>
                      <button
                        onClick={() => nudgeSelected('up')}
                        className="flex items-center justify-center p-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                        title="Nudge up"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => nudgeSelected('up-right')}
                        className="flex items-center justify-center p-2 bg-gray-500 text-white rounded hover:bg-gray-600 text-xs"
                        title="Nudge up-right"
                      >
                        ↗
                      </button>

                      {/* Middle row */}
                      <button
                        onClick={() => nudgeSelected('left')}
                        className="flex items-center justify-center p-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                        title="Nudge left"
                      >
                        <ArrowLeft className="w-3 h-3" />
                      </button>
                      <div className="flex items-center justify-center p-2 bg-gray-200 rounded">
                        <Move className="w-3 h-3 text-gray-400" />
                      </div>
                      <button
                        onClick={() => nudgeSelected('right')}
                        className="flex items-center justify-center p-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                        title="Nudge right"
                      >
                        <ArrowRight className="w-3 h-3" />
                      </button>

                      {/* Bottom row */}
                      <button
                        onClick={() => nudgeSelected('down-left')}
                        className="flex items-center justify-center p-2 bg-gray-500 text-white rounded hover:bg-gray-600 text-xs"
                        title="Nudge down-left"
                      >
                        ↙
                      </button>
                      <button
                        onClick={() => nudgeSelected('down')}
                        className="flex items-center justify-center p-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                        title="Nudge down"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => nudgeSelected('down-right')}
                        className="flex items-center justify-center p-2 bg-gray-500 text-white rounded hover:bg-gray-600 text-xs"
                        title="Nudge down-right"
                      >
                        ↘
                      </button>
                    </div>
                  </div>
                </div>

                {/* Export Tools */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Export</h4>
                  <div className="space-y-2">
                    <button
                      onClick={exportDesign}
                      className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                      <FileImage className="w-4 h-4" />
                      <span>Export PNG</span>
                    </button>
                    
                    <button
                      onClick={exportPDF}
                      className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                    >
                      <FileText className="w-4 h-4" />
                      <span>Export PDF</span>
                    </button>
                    
                    {/* TEMPORARILY DISABLED: Save Design Button */}
                    {/* <button
                      onClick={saveDesign}
                      disabled={savingDesign}
                      className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {savingDesign ? (
                        <>
                          <Loader className="w-4 h-4 animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : saveStatus === 'saved' ? (
                        <>
                          <Save className="w-4 h-4" />
                          <span>Saved!</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          <span>Save Design</span>
                        </>
                      )}
                    </button> */}
                  </div>
                </div>

                {/* TEMPORARILY DISABLED: My Designs */}
                {/* <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">My Designs</h4>
                  <button
                    onClick={() => setShowMyDesigns(true)}
                    className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>My Designs ({savedDesigns.length})</span>
                  </button>
                  {!user && anonymousDesignCount > 0 && (
                    <p className="text-xs text-orange-600 mt-2 p-2 bg-orange-50 rounded">
                      ⚠️ Sign in to save permanently ({anonymousDesignCount} design{anonymousDesignCount > 1 ? 's' : ''} will be lost)
                    </p>
                  )}
                </div> */}

                {/* Watermark Toggle */}
                <div>
                  <button
                    onClick={() => setWatermarkVisible(!watermarkVisible)}
                    className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                  >
                    {watermarkVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    <span>{watermarkVisible ? 'Hide' : 'Show'} Watermark</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Auth Modal */}
      {showAuth && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">
                {authMode === 'login' ? 'Sign In' : 'Sign Up'}
              </h2>
              <button
                onClick={() => setShowAuth(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleAuth} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Loading...' : (authMode === 'login' ? 'Sign In' : 'Sign Up')}
              </button>
            </form>

            <div className="mt-4 text-center">
              <button
                onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
                className="text-blue-600 hover:text-blue-800 text-sm"
              >
                {authMode === 'login'
                  ? "Don't have an account? Sign up"
                  : "Already have an account? Sign in"
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
        TEMPORARILY DISABLED: Design Persistence Modals (Prompt 2.7)

        The following UI components have been removed to fix infinite remount loop:
        - Save Design Modal
        - My Designs Modal
        - Migrate Designs Prompt

        These will be re-implemented properly in a future update.
        See git history or PROJECT_HANDOVER_COMPLETE.md for the original code.
      */}
    </div>
  );
};

export default Designer;
