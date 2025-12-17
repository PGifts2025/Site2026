

import React, { useState, useRef, useEffect } from 'react';
import { fabric } from 'fabric';
import { jsPDF } from 'jspdf';
import { createClient } from '@supabase/supabase-js';
import { supabaseConfig, isMockAuth } from '../config/supabase';
import { createMockSupabase } from '../utils/mockAuth';
import enhancedProductCatalog from '../config/enhancedProductCatalog.json';
import PrintAreaAdmin from '../components/PrintAreaAdmin';
import PrintAreaOverlay from '../components/PrintAreaOverlay';
import PrintAreaSelector from '../components/PrintAreaSelector';
import { usePrintAreas } from '../hooks/usePrintAreas';
import { getValidatedProducts } from '../utils/productUtils';
import { 
  validatePrintArea, 
  constrainRectToPrintArea, 
  calculateOptimalPosition,
  scaleToFitPrintArea 
} from '../utils/printAreaHelpers';
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
  Settings,
  Grid,
  Maximize2,
  AlertTriangle
} from 'lucide-react';

// Initialize Supabase or mock auth
const supabase = isMockAuth 
  ? createMockSupabase() 
  : createClient(supabaseConfig.url, supabaseConfig.anonKey);

// Helper function to convert categorized products to flat product map
const convertCatalogToProductMap = (catalog) => {
  const productMap = {};
  catalog.categories.forEach(category => {
    category.products.forEach(product => {
      productMap[product.key] = {
        name: product.name,
        template: product.template,
        printAreas: product.printAreas,
        colors: product.colors,
        basePrice: product.basePrice,
        category: category.name
      };
    });
  });
  return productMap;
};

const EnhancedDesigner = () => {
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const [canvas, setCanvas] = useState(null);
  const [availableProducts, setAvailableProducts] = useState({});
  const [productsLoading, setProductsLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState('5oz-cotton-bag'); // Start with 5oz Cotton Bag from catalog
  const [selectedColor, setSelectedColor] = useState('#ffffff');
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [watermarkVisible, setWatermarkVisible] = useState(true);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [showPrintAreaAdmin, setShowPrintAreaAdmin] = useState(false);
  const [isAdmin, setIsAdmin] = useState(true); // For demo purposes
  const [showConstraintWarning, setShowConstraintWarning] = useState(false);
  const [constraintWarningMessage, setConstraintWarningMessage] = useState('');

  // Use the print areas hook with filtered products
  const {
    printAreas,
    selectedPrintArea,
    showOverlay,
    overlaySettings,
    setSelectedPrintArea,
    setPrintAreas,
    toggleOverlay,
    getCurrentPrintArea,
    validateObjectInPrintArea,
    constrainObjectToPrintArea,
    getPrintAreaStats,
    availablePrintAreas,
    hasPrintAreas
  } = usePrintAreas(availableProducts, selectedProduct);

  // Get current product configuration
  const currentProduct = availableProducts[selectedProduct];
  const currentPrintArea = getCurrentPrintArea();

  // Load available products on component mount
  useEffect(() => {
    const loadProducts = async () => {
      setProductsLoading(true);
      try {
        // Import Supabase service
        const { loadProductConfiguration } = await import('../services/supabaseService');
        
        // Convert the enhanced catalog to flat product map
        const enhancedProducts = convertCatalogToProductMap(enhancedProductCatalog);
        
        // Validate the enhanced products
        const validatedProducts = await getValidatedProducts(enhancedProducts);
        const mergedProducts = { ...validatedProducts };
        
        // Try to load each product from Supabase and merge with local config
        console.log('[EnhancedDesigner] Loading products from Supabase...');
        for (const productKey of Object.keys(validatedProducts)) {
          try {
            const supabaseConfig = await loadProductConfiguration(productKey);
            if (supabaseConfig && supabaseConfig.printAreas && Object.keys(supabaseConfig.printAreas).length > 0) {
              // Merge Supabase config with local config, prioritizing Supabase
              console.log(`[EnhancedDesigner] ✓ Loaded ${productKey} from Supabase with ${Object.keys(supabaseConfig.printAreas).length} print areas`);
              mergedProducts[productKey] = {
                ...validatedProducts[productKey],
                ...supabaseConfig
              };
            } else {
              console.log(`[EnhancedDesigner] Using local config for ${productKey} (no Supabase data)`);
            }
          } catch (error) {
            console.warn(`[EnhancedDesigner] Could not load ${productKey} from Supabase, using local config:`, error.message);
            // Keep the validated local config
          }
        }
        
        setAvailableProducts(mergedProducts);
        console.log('[EnhancedDesigner] Final available products:', Object.keys(mergedProducts));
        
        // If the currently selected product is not available, select the first available one
        if (!mergedProducts[selectedProduct]) {
          const availableKeys = Object.keys(mergedProducts);
          if (availableKeys.length > 0) {
            setSelectedProduct(availableKeys[0]);
          }
        }
      } catch (error) {
        console.error('Error loading products:', error);
        // Fallback to enhanced catalog if validation fails
        const fallbackProducts = convertCatalogToProductMap(enhancedProductCatalog);
        setAvailableProducts(fallbackProducts);
      } finally {
        setProductsLoading(false);
      }
    };

    loadProducts();
  }, []);

  // Handle object movement validation
  const handleObjectMoving = (e) => {
    const obj = e.target;
    if (obj.id === 'printAreaOverlay' || obj.type === 'printAreaOverlay') return;

    if (currentPrintArea && !validateObjectInPrintArea(obj)) {
      setConstraintWarningMessage(`Object is outside the ${currentPrintArea.name} print area`);
      setShowConstraintWarning(true);
      setTimeout(() => setShowConstraintWarning(false), 3000);
    }
  };

  // Handle object scaling validation
  const handleObjectScaling = (e) => {
    const obj = e.target;
    if (obj.id === 'printAreaOverlay' || obj.type === 'printAreaOverlay') return;

    if (currentPrintArea) {
      const objBounds = obj.getBoundingRect();
      const maxWidth = currentPrintArea.maxWidth || currentPrintArea.width;
      const maxHeight = currentPrintArea.maxHeight || currentPrintArea.height;

      if (objBounds.width > maxWidth || objBounds.height > maxHeight) {
        setConstraintWarningMessage(`Object exceeds maximum size for ${currentPrintArea.name}`);
        setShowConstraintWarning(true);
        setTimeout(() => setShowConstraintWarning(false), 3000);
      }
    }
  };

  // Handle object modification (snap to print area if needed)
  const handleObjectModified = (e) => {
    const obj = e.target;
    if (obj.id === 'printAreaOverlay' || obj.type === 'printAreaOverlay') return;

    if (currentPrintArea && !validateObjectInPrintArea(obj)) {
      constrainObjectToPrintArea(obj);
      canvas.renderAll();
    }
  };

  // Handle object addition (position optimally in print area)
  const handleObjectAdded = (e) => {
    const obj = e.target;
    if (obj.id === 'printAreaOverlay' || obj.type === 'printAreaOverlay' || obj.id === 'productTemplate') return;

    if (currentPrintArea) {
      const objBounds = obj.getBoundingRect();
      const optimalPosition = calculateOptimalPosition(
        { width: objBounds.width, height: objBounds.height },
        currentPrintArea,
        'center'
      );

      obj.set({
        left: optimalPosition.x + (obj.left - objBounds.left),
        top: optimalPosition.y + (obj.top - objBounds.top)
      });

      canvas.renderAll();
    }
  };

  const loadProductTemplate = async () => {
    if (!canvas || !currentProduct) return;

    setTemplateLoaded(false);
    
    try {
      // Check if canvas is properly initialized
      if (!canvas || typeof canvas.add !== 'function') {
        console.warn('Canvas not properly initialized, retrying...');
        setTimeout(loadProductTemplate, 100);
        return;
      }

      // Clear canvas safely - Fabric.js has a clear() method
      try {
        if (canvas && canvas.clear) {
          canvas.clear();
        } else if (canvas && canvas.getObjects) {
          // Alternative clearing method for fabric.js
          const objects = canvas.getObjects().slice(); // Create copy to avoid mutation during iteration
          objects.forEach(obj => canvas.remove(obj));
        }
      } catch (clearError) {
        console.warn('Canvas clear failed, using alternative method:', clearError);
        // Fallback: remove all objects individually
        if (canvas && canvas.getObjects) {
          const objects = canvas.getObjects().slice();
          objects.forEach(obj => {
            try {
              canvas.remove(obj);
            } catch (removeError) {
              console.warn('Failed to remove object:', removeError);
            }
          });
        }
      }
      
      // Load template image
      const templateUrl = currentProduct.template;
      console.log(`Loading template for ${selectedProduct}:`, templateUrl);
      console.log('Full template URL:', templateUrl);
      console.log('Current product:', currentProduct);
      
      // Fix template path - ensure it starts with proper path
      // In Vite, public folder files are served from root, so /templates/bag/template.png is correct
      const fixedTemplateUrl = templateUrl.startsWith('/') ? templateUrl : `/${templateUrl}`;
      console.log('Fixed template URL:', fixedTemplateUrl);
      
      // Create a new Image object to test if the file loads
      const testImg = new Image();
      testImg.onload = () => {
        console.log('Test image loaded successfully, proceeding with fabric.Image.fromURL');
        
        // Now load with fabric.js - don't use crossOrigin for local files
        fabric.Image.fromURL(fixedTemplateUrl, (img) => {
          console.log('Image.fromURL callback called with img:', img);
          console.log('Canvas state:', canvas);
          
          if (img && img._element && canvas) {
            console.log('Image loaded successfully, dimensions:', img.width, 'x', img.height);
            
            // Scale image to fit canvas while maintaining aspect ratio
            const scale = Math.min(800 / img.width, 800 / img.height);
            img.scale(scale);
            
            // Calculate centered position
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;
            const centerX = (800 - scaledWidth) / 2;
            const centerY = (800 - scaledHeight) / 2;
            
            img.set({
              left: centerX,
              top: centerY,
              selectable: false,
              evented: false,
              excludeFromExport: false,
              id: 'productTemplate'
            });
            
            canvas.add(img);
            canvas.sendToBack(img);
            
            // Apply color tint if needed (for products that support color changes)
            if (selectedColor !== '#ffffff' && currentProduct.colors.includes(selectedColor)) {
              img.set('fill', selectedColor);
            }
            
            setTemplateLoaded(true);
            console.log(`Template loaded successfully for ${selectedProduct}`);
            canvas.renderAll();
          } else {
            console.error('Failed to load template image - img:', img, 'canvas:', canvas);
            console.error('Template URL that failed:', fixedTemplateUrl);
            // Create a fallback template if image fails to load
            createFallbackTemplate();
          }
        });
      };
      
      testImg.onerror = (error) => {
        console.error('Test image failed to load:', error);
        console.error('Failed URL:', fixedTemplateUrl);
        console.error('This might be a 404 or CORS issue');
        createFallbackTemplate();
      };
      
      // Set the source to trigger loading
      testImg.src = fixedTemplateUrl;
      
    } catch (error) {
      console.error('Error loading template:', error);
      createFallbackTemplate();
    }
  };

  const createFallbackTemplate = () => {
    if (!canvas || !currentProduct) return;
    
    try {
      // Create a simple colored rectangle as fallback template (centered)
      const templateWidth = 600;
      const templateHeight = 600;
      const centerX = (800 - templateWidth) / 2;
      const centerY = (800 - templateHeight) / 2;
      
      const fallbackTemplate = new fabric.Rect({
        left: centerX,
        top: centerY,
        width: templateWidth,
        height: templateHeight,
        fill: selectedColor || '#f0f0f0',
        stroke: '#cccccc',
        strokeWidth: 2,
        selectable: false,
        evented: false,
        excludeFromExport: false,
        id: 'productTemplate'
      });
      
      canvas.add(fallbackTemplate);
      canvas.sendToBack(fallbackTemplate);
      
      // Add product name text as visual indicator (centered)
      const productLabel = new fabric.Text(`${currentProduct.name} Template`, {
        left: 400,
        top: centerY + 20,
        fontSize: 24,
        fill: '#666666',
        textAlign: 'center',
        originX: 'center',
        selectable: false,
        evented: false,
        excludeFromExport: true,
        id: 'productLabel'
      });
      
      canvas.add(productLabel);
      setTemplateLoaded(true);
      console.log(`Fallback template created for ${selectedProduct}`);
      canvas.renderAll();
    } catch (fallbackError) {
      console.error('Failed to create fallback template:', fallbackError);
      setTemplateLoaded(true);
    }
  };

  // Initialize canvas
  useEffect(() => {
    if (canvasRef.current && !canvas) {
      const fabricCanvas = new fabric.Canvas(canvasRef.current, {
        width: 800,
        height: 800,
        backgroundColor: '#f8f9fa'
      });

      // Add event listeners for print area validation
      fabricCanvas.on('object:moving', handleObjectMoving);
      fabricCanvas.on('object:scaling', handleObjectScaling);
      fabricCanvas.on('object:modified', handleObjectModified);
      fabricCanvas.on('object:added', handleObjectAdded);

      setCanvas(fabricCanvas);

      return () => {
        fabricCanvas.dispose();
      };
    }
  }, []);

  // Load product template when product or color changes
  useEffect(() => {
    if (canvas && currentProduct && !productsLoading) {
      loadProductTemplate();
    }
  }, [canvas, selectedProduct, selectedColor, currentProduct, productsLoading]);

  // Check user authentication
  useEffect(() => {
    const checkUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setUser(user);
      } catch (error) {
        console.error('Error checking user:', error);
      }
    };

    checkUser();

    // Fixed: In Supabase v2, onAuthStateChange returns the subscription directly
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
      if (event === 'SIGNED_IN') {
        setShowAuth(false);
      }
    });

    return () => {
      if (subscription && typeof subscription.unsubscribe === 'function') {
        subscription.unsubscribe();
      }
    };
  }, []);

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
    if (!canvas || !currentPrintArea) return;

    const text = new fabric.IText('Your Text Here', {
      left: currentPrintArea.x + currentPrintArea.width / 2,
      top: currentPrintArea.y + currentPrintArea.height / 2,
      fontFamily: 'Arial',
      fontSize: 24,
      fill: '#000000',
      originX: 'center',
      originY: 'center'
    });

    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
  };

  const addShape = (shapeType) => {
    if (!canvas || !currentPrintArea) return;

    let shape;
    const centerX = currentPrintArea.x + currentPrintArea.width / 2;
    const centerY = currentPrintArea.y + currentPrintArea.height / 2;

    if (shapeType === 'rectangle') {
      shape = new fabric.Rect({
        left: centerX,
        top: centerY,
        width: 100,
        height: 60,
        fill: '#ff0000',
        originX: 'center',
        originY: 'center'
      });
    } else if (shapeType === 'circle') {
      shape = new fabric.Circle({
        left: centerX,
        top: centerY,
        radius: 50,
        fill: '#00ff00',
        originX: 'center',
        originY: 'center'
      });
    }

    if (shape) {
      canvas.add(shape);
      canvas.setActiveObject(shape);
      canvas.renderAll();
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file || !canvas || !currentPrintArea) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      fabric.Image.fromURL(event.target.result, (img) => {
        // Scale image to fit within print area
        const scaledSize = scaleToFitPrintArea(
          { width: img.width, height: img.height },
          currentPrintArea,
          20 // 20px padding
        );
        
        img.scale(scaledSize.scale);

        const optimalPosition = calculateOptimalPosition(
          { width: scaledSize.width, height: scaledSize.height },
          currentPrintArea,
          'center'
        );

        img.set({
          left: optimalPosition.x,
          top: optimalPosition.y,
          originX: 'left',
          originY: 'top'
        });

        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.renderAll();
      });
    };
    reader.readAsDataURL(file);
  };

  const deleteSelected = () => {
    if (!canvas) return;
    const activeObjects = canvas.getActiveObjects();
    activeObjects.forEach(obj => {
      if (obj.id !== 'printAreaOverlay' && obj.type !== 'printAreaOverlay' && obj.id !== 'productTemplate') {
        canvas.remove(obj);
      }
    });
    canvas.discardActiveObject();
    canvas.renderAll();
  };

  const rotateSelected = (direction) => {
    if (!canvas) return;
    const activeObject = canvas.getActiveObject();
    if (activeObject && activeObject.id !== 'printAreaOverlay' && activeObject.type !== 'printAreaOverlay') {
      const currentAngle = activeObject.angle || 0;
      activeObject.rotate(currentAngle + (direction === 'left' ? -15 : 15));
      canvas.renderAll();
    }
  };

  const exportDesign = () => {
    if (!canvas) return;

    // Hide print area overlay for export
    const overlayElements = canvas.getObjects().filter(obj => 
      obj.type === 'printAreaOverlay' || obj.id === 'printAreaOverlay'
    );
    overlayElements.forEach(element => element.set('visible', false));

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
    overlayElements.forEach(element => element.set('visible', true));
    if (watermark) {
      watermark.set('visible', watermarkVisible);
    }
    canvas.renderAll();
  };

  const exportPDF = () => {
    if (!canvas) return;

    // Hide overlays for export
    const overlayElements = canvas.getObjects().filter(obj => 
      obj.type === 'printAreaOverlay' || obj.id === 'printAreaOverlay'
    );
    overlayElements.forEach(element => element.set('visible', false));

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
    overlayElements.forEach(element => element.set('visible', true));
    if (watermark) watermark.set('visible', watermarkVisible);
    canvas.renderAll();
  };

  const saveDesign = async () => {
    if (!canvas || !user) {
      alert('Please sign in to save your design');
      return;
    }

    try {
      const designData = {
        canvas_data: JSON.stringify(canvas.toJSON()),
        product_type: selectedProduct,
        product_color: selectedColor,
        print_area: selectedPrintArea,
        user_id: user.id,
        created_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('designs')
        .insert([designData]);

      if (error) throw error;
      alert('Design saved successfully!');
    } catch (error) {
      console.error('Error saving design:', error);
      alert('Error saving design. Please try again.');
    }
  };

  const handleSaveConfiguration = (productKey, updatedProduct) => {
    // Configuration is already saved to Supabase by PrintAreaAdmin component
    // This callback is just to update local state and close the modal
    console.log('[EnhancedDesigner] Configuration saved for', productKey);
    
    // Update local products config if needed
    setAvailableProducts(prev => ({
      ...prev,
      [productKey]: updatedProduct
    }));
    
    // Close the Print Area Admin modal
    setShowPrintAreaAdmin(false);
  };

  const fitToArea = () => {
    if (!canvas || !currentPrintArea) return;

    const activeObject = canvas.getActiveObject();
    if (!activeObject || activeObject.id === 'printAreaOverlay' || activeObject.type === 'printAreaOverlay') return;

    const objBounds = activeObject.getBoundingRect();
    const scaledSize = scaleToFitPrintArea(
      { width: objBounds.width, height: objBounds.height },
      currentPrintArea,
      10
    );

    const optimalPosition = calculateOptimalPosition(
      { width: scaledSize.width, height: scaledSize.height },
      currentPrintArea,
      'center'
    );

    activeObject.scale(scaledSize.scale);
    activeObject.set({
      left: optimalPosition.x + (activeObject.left - objBounds.left),
      top: optimalPosition.y + (activeObject.top - objBounds.top)
    });

    canvas.renderAll();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">Enhanced Design Studio</h1>
            
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

      {/* Constraint Warning */}
      {showConstraintWarning && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-40 bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-2 rounded-lg shadow-lg flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4" />
          <span>{constraintWarningMessage}</span>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Left Sidebar - Product Selection */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm p-6 space-y-6">
              <h3 className="text-lg font-semibold">Product Configuration</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Product
                  </label>
                  {productsLoading ? (
                    <div className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500">
                      Loading products...
                    </div>
                  ) : (
                    <select
                      value={selectedProduct}
                      onChange={(e) => setSelectedProduct(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={Object.keys(availableProducts).length === 0}
                    >
                      {Object.keys(availableProducts).length === 0 ? (
                        <option value="">No products available</option>
                      ) : (
                        // Render products grouped by categories
                        enhancedProductCatalog.categories.map((category) => (
                          <optgroup key={category.name} label={category.name}>
                            {category.products
                              .filter(product => availableProducts[product.key]) // Only show available products
                              .map((product) => (
                                <option key={product.key} value={product.key}>
                                  {product.name}
                                </option>
                              ))
                            }
                          </optgroup>
                        ))
                      )}
                    </select>
                  )}
                  {!productsLoading && Object.keys(availableProducts).length === 0 && (
                    <p className="text-sm text-red-600 mt-1">
                      No products with valid templates found. Please check your template files.
                    </p>
                  )}
                </div>

                {currentProduct && currentProduct.colors.length > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Color
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {currentProduct.colors.map((color) => (
                        <button
                          key={color}
                          onClick={() => setSelectedColor(color)}
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

                {/* Enhanced Print Area Selector */}
                <PrintAreaSelector
                  printAreas={printAreas}
                  selectedArea={selectedPrintArea}
                  onAreaChange={setSelectedPrintArea}
                  showOverlay={showOverlay}
                  onToggleOverlay={toggleOverlay}
                  onOpenAdmin={() => setShowPrintAreaAdmin(true)}
                  isAdmin={isAdmin}
                />

                {/* Print Area Stats */}
                {currentPrintArea && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Current Print Area</h4>
                    <div className="text-xs text-gray-600 space-y-1">
                      <div>Name: {currentPrintArea.name}</div>
                      <div>Size: {currentPrintArea.width} × {currentPrintArea.height}px</div>
                      <div>Position: ({currentPrintArea.x}, {currentPrintArea.y})</div>
                      <div>Max Size: {currentPrintArea.maxWidth || currentPrintArea.width} × {currentPrintArea.maxHeight || currentPrintArea.height}px</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Center - Canvas */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Design Canvas</h3>
                <div className="flex items-center space-x-2">
                  <div className="text-sm text-gray-500">
                    {templateLoaded ? 'Template Loaded' : 'Loading Template...'}
                  </div>
                  {hasPrintAreas && (
                    <div className={`text-xs px-2 py-1 rounded ${
                      showOverlay ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {showOverlay ? 'Guides On' : 'Guides Off'}
                    </div>
                  )}
                </div>
              </div>
              
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <canvas ref={canvasRef} />
                {/* Print Area Overlay Component */}
                <PrintAreaOverlay
                  canvas={canvas}
                  printArea={currentPrintArea}
                  visible={showOverlay}
                  interactive={false}
                  color={overlaySettings.color}
                  opacity={overlaySettings.opacity}
                  strokeWidth={overlaySettings.strokeWidth}
                  dashArray={overlaySettings.dashArray}
                />
              </div>
            </div>
          </div>

          {/* Right Sidebar - Tools */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-semibold mb-4">Design Tools</h3>
              
              <div className="space-y-4">
                {/* Add Elements */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Add Elements</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={addText}
                      disabled={!hasPrintAreas}
                      className="flex items-center justify-center space-x-1 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Type className="w-4 h-4" />
                      <span>Text</span>
                    </button>
                    
                    <button
                      onClick={() => addShape('rectangle')}
                      disabled={!hasPrintAreas}
                      className="flex items-center justify-center space-x-1 px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Square className="w-4 h-4" />
                      <span>Rect</span>
                    </button>
                    
                    <button
                      onClick={() => addShape('circle')}
                      disabled={!hasPrintAreas}
                      className="flex items-center justify-center space-x-1 px-3 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Circle className="w-4 h-4" />
                      <span>Circle</span>
                    </button>
                    
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!hasPrintAreas}
                      className="flex items-center justify-center space-x-1 px-3 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
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

                {/* Transform Tools */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Transform</h4>
                  <div className="grid grid-cols-2 gap-2">
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
                      onClick={fitToArea}
                      disabled={!currentPrintArea}
                      className="flex items-center justify-center px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </button>
                    
                    <button
                      onClick={deleteSelected}
                      className="flex items-center justify-center px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
                    
                    <button
                      onClick={saveDesign}
                      className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                    >
                      <Save className="w-4 h-4" />
                      <span>Save Design</span>
                    </button>
                  </div>
                </div>

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

      {/* Print Area Admin Modal */}
      {showPrintAreaAdmin && (
        <PrintAreaAdmin
          selectedProduct={selectedProduct}
          productsConfig={availableProducts}
          onSaveConfiguration={handleSaveConfiguration}
          onClose={() => setShowPrintAreaAdmin(false)}
        />
      )}

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
    </div>
  );
};

export default EnhancedDesigner;
