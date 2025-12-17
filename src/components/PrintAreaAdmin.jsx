
import React, { useState, useRef, useEffect } from 'react';
import { fabric } from 'fabric';
import { 
  Save, 
  Plus, 
  Trash2,
  Download,
  Upload,
  Grid,
  AlertCircle,
  CheckCircle,
  Loader,
  Settings,
  RotateCw
} from 'lucide-react';
import { useAuth } from './AuthProvider';
import { supabaseConfig } from '../config/supabase';
import { 
  saveProductConfiguration,
  saveVariantConfiguration,
  loadProductConfiguration, 
  loadProductVariants,
  getProductVariant,
  uploadTemplateImage, 
  replaceTemplateImage,
  isCurrentUserAdmin,
  getProductTemplate
} from '../services/supabaseService';

/**
 * Print Area Admin Component
 * 
 * Enhanced with Supabase Backend Persistence:
 * - Automatically loads the product template from Supabase or products.json
 * - Saves all configuration changes to Supabase database
 * - Supports template image uploads to Supabase Storage
 * - Admin-only access with proper authentication checks
 * - Real-time persistence with loading states and error handling
 */
const PrintAreaAdmin = ({ 
  selectedProduct, 
  productsConfig, 
  onSaveConfiguration,
  onClose 
}) => {
  const { user } = useAuth();
  const fileInputRef = useRef(null);
  const templateUploadRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const [canvas, setCanvas] = useState(null);
  const [currentProduct, setCurrentProduct] = useState(null);
  const [printAreas, setPrintAreas] = useState({});
  const [selectedPrintArea, setSelectedPrintArea] = useState(null);
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridSize, setGridSize] = useState(20);
  const [newAreaName, setNewAreaName] = useState('');
  const [newAreaShape, setNewAreaShape] = useState('rectangle');
  const [showNewAreaDialog, setShowNewAreaDialog] = useState(false);
  
  // Color and View support states
  const [selectedColor, setSelectedColor] = useState(null);
  const [selectedView, setSelectedView] = useState('front');
  const [availableViews, setAvailableViews] = useState(['front']);
  const [availableColors, setAvailableColors] = useState([]);
  const [currentVariantId, setCurrentVariantId] = useState(null);
  
  // Backend persistence states
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [lastSaved, setLastSaved] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCheckLoading, setAdminCheckLoading] = useState(true);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [availableTemplates, setAvailableTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Check if user is admin
  useEffect(() => {
    const checkAdmin = async () => {
      setAdminCheckLoading(true);
      try {
        const adminStatus = await isCurrentUserAdmin();
        console.log('[PrintAreaAdmin] Admin check result:', adminStatus);
        setIsAdmin(adminStatus);
      } catch (error) {
        console.error('[PrintAreaAdmin] Error checking admin status:', error);
        setIsAdmin(false);
      } finally {
        setAdminCheckLoading(false);
      }
    };

    // Always run the admin check - it will handle the mock auth case internally
    checkAdmin();
  }, [user]);

  // Callback ref to initialize canvas when element is mounted
  const canvasRef = React.useCallback((canvasElement) => {
    console.log('[PrintAreaAdmin] Canvas callback ref called - canvasElement:', canvasElement, 'current canvas:', canvas);
    
    if (canvasElement && !fabricCanvasRef.current) {
      console.log('[PrintAreaAdmin] Creating new Fabric canvas');
      try {
        const fabricCanvas = new fabric.Canvas(canvasElement, {
          width: 800,
          height: 800,
          backgroundColor: '#f8f9fa',
          selection: true
        });

        console.log('[PrintAreaAdmin] Fabric canvas created:', fabricCanvas);

        // Enable object controls
        fabricCanvas.on('object:modified', handleObjectModified);
        fabricCanvas.on('object:moving', handleObjectMoving);
        fabricCanvas.on('object:selected', handleObjectSelected);
        fabricCanvas.on('selection:cleared', handleSelectionCleared);
        
        // Add mouse up handler to ensure objects are released
        fabricCanvas.on('mouse:up', handleMouseUp);

        fabricCanvasRef.current = fabricCanvas;
        setCanvas(fabricCanvas);
        console.log('[PrintAreaAdmin] Canvas state set');
      } catch (error) {
        console.error('[PrintAreaAdmin] Error creating Fabric canvas:', error);
      }
    } else if (!canvasElement && fabricCanvasRef.current) {
      // Cleanup when element is unmounted
      console.log('[PrintAreaAdmin] Disposing canvas');
      const fabricCanvas = fabricCanvasRef.current;
      
      // Remove all event listeners before disposing
      fabricCanvas.off('object:modified', handleObjectModified);
      fabricCanvas.off('object:moving', handleObjectMoving);
      fabricCanvas.off('object:selected', handleObjectSelected);
      fabricCanvas.off('selection:cleared', handleSelectionCleared);
      fabricCanvas.off('mouse:up', handleMouseUp);
      
      fabricCanvas.dispose();
      fabricCanvasRef.current = null;
      setCanvas(null);
    }
  }, []); // Empty dependency array - callback doesn't change

  // Load product when selected - initialize colors and views
  useEffect(() => {
    const loadProductData = async () => {
      if (!selectedProduct) return;
      
      setIsLoading(true);
      try {
        // Load product configuration (without variant-specific data first)
        let productConfig;
        const supabaseConfig = await loadProductConfiguration(selectedProduct);
        
        if (supabaseConfig) {
          console.log('[PrintAreaAdmin] Loaded base configuration from Supabase:', supabaseConfig);
          productConfig = supabaseConfig;
        } else if (productsConfig && productsConfig[selectedProduct]) {
          // Fallback to products.json
          console.log('[PrintAreaAdmin] Using configuration from products.json');
          productConfig = productsConfig[selectedProduct];
        }

        if (productConfig) {
          // Set available colors
          const colors = productConfig.colors || ['#FFFFFF'];
          setAvailableColors(colors);
          
          // Set default color if not already set
          if (!selectedColor && colors.length > 0) {
            setSelectedColor(colors[0]);
          }

          // Load variant data to determine available views
          try {
            const variants = await loadProductVariants(selectedProduct);
            if (variants && variants.views && variants.views.length > 0) {
              setAvailableViews(variants.views);
              console.log('[PrintAreaAdmin] Available views:', variants.views);
            } else {
              setAvailableViews(['front']);
            }
          } catch (err) {
            console.warn('[PrintAreaAdmin] Could not load variants, using default views:', err);
            setAvailableViews(['front']);
          }

          setCurrentProduct(productConfig);
        }
      } catch (error) {
        console.error('[PrintAreaAdmin] Error loading product data:', error);
        // Fallback to products.json on error
        if (productsConfig && productsConfig[selectedProduct]) {
          const product = productsConfig[selectedProduct];
          const colors = product.colors || ['#FFFFFF'];
          setAvailableColors(colors);
          if (!selectedColor) setSelectedColor(colors[0]);
          setAvailableViews(['front']);
          setCurrentProduct(product);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadProductData();
  }, [selectedProduct, productsConfig]);

  // Load variant-specific configuration when color or view changes
  useEffect(() => {
    const loadVariantData = async () => {
      if (!selectedProduct || !selectedColor || !selectedView || !currentProduct) return;

      console.log('[PrintAreaAdmin] Loading variant data for:', { selectedProduct, selectedColor, selectedView });
      
      try {
        // Try to load variant-specific configuration
        const variantConfig = await loadProductConfiguration(selectedProduct, selectedColor, selectedView);
        
        if (variantConfig && variantConfig.variantId) {
          console.log('[PrintAreaAdmin] Loaded variant configuration:', variantConfig);
          setCurrentVariantId(variantConfig.variantId);
          setPrintAreas({ ...variantConfig.printAreas });
          
          // Update template URL if different
          if (variantConfig.template !== currentProduct.template) {
            setCurrentProduct(prev => ({
              ...prev,
              template: variantConfig.template,
              _uploadTimestamp: Date.now()
            }));
          }
        } else {
          // No variant found, use base product configuration
          console.log('[PrintAreaAdmin] No variant found, using base configuration');
          setCurrentVariantId(null);
          if (currentProduct.printAreas) {
            setPrintAreas({ ...currentProduct.printAreas });
          } else {
            setPrintAreas({});
          }
        }
      } catch (error) {
        console.error('[PrintAreaAdmin] Error loading variant data:', error);
        // Fallback to base product print areas
        if (currentProduct && currentProduct.printAreas) {
          setPrintAreas({ ...currentProduct.printAreas });
        }
      }
    };

    loadVariantData();
  }, [selectedProduct, selectedColor, selectedView, currentProduct?.name]);

  // Track previous template URL to prevent unnecessary reloads
  const prevTemplateRef = useRef(null);

  // Load product into canvas when data and canvas are ready
  useEffect(() => {
    if (canvas && currentProduct) {
      const currentTemplateUrl = currentProduct.template || '';
      const prevTemplateUrl = prevTemplateRef.current || '';
      
      // Only reload if template URL actually changed
      if (currentTemplateUrl !== prevTemplateUrl) {
        console.log('[PrintAreaAdmin] Template URL changed, reloading product');
        console.log('  Previous:', prevTemplateUrl);
        console.log('  Current:', currentTemplateUrl);
        
        // Update ref before loading
        prevTemplateRef.current = currentTemplateUrl;
        
        // Add a small delay to ensure canvas is fully ready
        const timeoutId = setTimeout(() => {
          loadProduct();
        }, 100);
        
        return () => clearTimeout(timeoutId);
      } else {
        console.log('[PrintAreaAdmin] Template URL unchanged, skipping reload');
      }
    }
  }, [canvas, currentProduct?.template]); // Only depend on template URL, not entire currentProduct object

  // Update grid visibility
  useEffect(() => {
    if (canvas) {
      updateGridOverlay();
    }
  }, [canvas, showGrid, gridSize]);

  // Add keyboard navigation for fine-tuning print area positions
  useEffect(() => {
    if (!canvas) return;

    const handleKeyDown = (e) => {
      const activeObject = canvas.getActiveObject();
      if (!activeObject || activeObject.type !== 'printArea') return;

      // Prevent default arrow key behavior (scrolling)
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
      }

      const nudgeAmount = e.shiftKey ? 10 : 1; // Hold Shift for 10px nudge
      let moved = false;

      switch (e.key) {
        case 'ArrowUp':
          activeObject.top -= nudgeAmount;
          moved = true;
          break;
        case 'ArrowDown':
          activeObject.top += nudgeAmount;
          moved = true;
          break;
        case 'ArrowLeft':
          activeObject.left -= nudgeAmount;
          moved = true;
          break;
        case 'ArrowRight':
          activeObject.left += nudgeAmount;
          moved = true;
          break;
      }

      if (moved) {
        activeObject.setCoords();
        canvas.renderAll();
        
        // Update the print areas state
        handleObjectModified({ target: activeObject });
        
        console.log('[PrintAreaAdmin] Nudged print area with arrow keys:', {
          key: e.key,
          amount: nudgeAmount,
          position: { left: activeObject.left, top: activeObject.top }
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [canvas]);

  const loadProduct = async () => {
    console.log('[PrintAreaAdmin] loadProduct called - canvas:', canvas, 'currentProduct:', currentProduct);
    if (!canvas || !currentProduct) {
      console.log('[PrintAreaAdmin] loadProduct early return - missing canvas or product');
      return;
    }

    // Use currentProduct state instead of productsConfig prop
    // This ensures we use the latest data, including newly uploaded template URLs
    console.log('[PrintAreaAdmin] Using current product:', currentProduct);

    // Clear canvas completely
    console.log('[PrintAreaAdmin] Clearing canvas');
    canvas.clear();
    canvas.renderAll();

    // Load template image
    if (currentProduct.template) {
      // Fix template path - ensure it starts with proper path
      // In Vite, public folder files are served from root
      // For Supabase URLs, use them as-is
      const templateUrl = currentProduct.template;
      const fixedTemplateUrl = templateUrl.startsWith('http') ? templateUrl : 
                               (templateUrl.startsWith('/') ? templateUrl : `/${templateUrl}`);
      
      // Add aggressive cache-busting parameter to force reload of new images
      // Use a more robust cache-busting approach
      const timestamp = currentProduct._uploadTimestamp || Date.now();
      const cacheBustedUrl = fixedTemplateUrl.includes('?') 
        ? `${fixedTemplateUrl}&_cb=${timestamp}`
        : `${fixedTemplateUrl}?_cb=${timestamp}`;
      
      console.log('[PrintAreaAdmin] Loading template with cache-busting:', cacheBustedUrl);
      
      // Create a new Image object first to test loading and handle errors better
      const testImg = new Image();
      testImg.crossOrigin = 'anonymous'; // For Supabase images
      
      testImg.onload = () => {
        console.log('[PrintAreaAdmin] Test image loaded successfully, proceeding with Fabric.js');
        
        // Now load with Fabric.js
        fabric.Image.fromURL(cacheBustedUrl, (img) => {
          console.log('[PrintAreaAdmin] Image.fromURL callback - img:', img);
          if (img && img._element) {
            console.log('[PrintAreaAdmin] Template loaded successfully, dimensions:', img.width, 'x', img.height);
            
            // Scale image to fit canvas while maintaining aspect ratio
            const scale = Math.min(800 / img.width, 800 / img.height);
            img.scale(scale);
            
            // Calculate centered position
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;
            const centerX = (800 - scaledWidth) / 2;
            const centerY = (800 - scaledHeight) / 2;
            
            console.log('[PrintAreaAdmin] Image scale:', scale, 'position:', centerX, centerY);
            
            img.set({
              left: centerX,
              top: centerY,
              selectable: false,
              evented: false,
              excludeFromExport: true,
              id: 'productTemplate'
            });
            
            console.log('[PrintAreaAdmin] Adding image to canvas');
            canvas.add(img);
            canvas.sendToBack(img);
            
            console.log('[PrintAreaAdmin] Canvas objects after add:', canvas.getObjects().length);
            
            // Load existing print areas AFTER template is loaded
            setTimeout(() => {
              loadPrintAreas();
              updateGridOverlay();
              console.log('[PrintAreaAdmin] Calling canvas.renderAll() after loading print areas');
              canvas.renderAll();
            }, 50);
          } else {
            console.error('[PrintAreaAdmin] Failed to load template image - img:', img);
            // Still load print areas even if template fails
            loadPrintAreas();
            updateGridOverlay();
            canvas.renderAll();
          }
        }, { crossOrigin: 'anonymous' });
      };
      
      testImg.onerror = (error) => {
        console.error('[PrintAreaAdmin] Failed to load template image:', error);
        console.error('[PrintAreaAdmin] URL that failed:', cacheBustedUrl);
        setSaveMessage({ 
          type: 'error', 
          text: 'Failed to load template image. Please check the URL and try again.' 
        });
        // Still load print areas even if template fails
        loadPrintAreas();
        updateGridOverlay();
        canvas.renderAll();
      };
      
      // Trigger the image load
      testImg.src = cacheBustedUrl;
    } else {
      console.log('[PrintAreaAdmin] No template URL in product config');
      loadPrintAreas();
      updateGridOverlay();
      canvas.renderAll();
    }
  };

  const loadPrintAreas = () => {
    if (!canvas || !printAreas) {
      console.log('[PrintAreaAdmin] loadPrintAreas early return - canvas:', canvas, 'printAreas:', printAreas);
      return;
    }

    console.log('[PrintAreaAdmin] Loading print areas:', Object.keys(printAreas));

    // Remove existing print area objects and labels
    const existingAreas = canvas.getObjects().filter(obj => 
      obj.type === 'printArea' || obj.type === 'printAreaLabel'
    );
    existingAreas.forEach(area => canvas.remove(area));

    // Add print areas as editable shapes (rectangles, circles, or ellipses)
    Object.entries(printAreas).forEach(([key, area]) => {
      console.log('[PrintAreaAdmin] Creating print area:', key, area);
      
      let shape;
      const shapeType = area.shape || 'rectangle';
      
      if (shapeType === 'circle' || shapeType === 'ellipse') {
        // Create circle or ellipse
        const radiusX = area.width / 2;
        const radiusY = area.height / 2;
        shape = new fabric.Ellipse({
          left: area.x,
          top: area.y,
          rx: radiusX,
          ry: radiusY,
          fill: 'rgba(59, 130, 246, 0.2)',
          stroke: '#3b82f6',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          cornerColor: '#3b82f6',
          cornerSize: 8,
          transparentCorners: false,
          id: `printArea_${key}`,
          type: 'printArea',
          printAreaKey: key,
          printAreaName: area.name,
          printAreaShape: shapeType
        });
      } else {
        // Create rectangle (default)
        shape = new fabric.Rect({
          left: area.x,
          top: area.y,
          width: area.width,
          height: area.height,
          fill: 'rgba(59, 130, 246, 0.2)',
          stroke: '#3b82f6',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          cornerColor: '#3b82f6',
          cornerSize: 8,
          transparentCorners: false,
          id: `printArea_${key}`,
          type: 'printArea',
          printAreaKey: key,
          printAreaName: area.name,
          printAreaShape: shapeType
        });
      }

      // Add label
      const label = new fabric.Text(area.name, {
        left: area.x + 5,
        top: area.y - 25,
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

  const updateGridOverlay = () => {
    if (!canvas) return;

    // Remove existing grid
    const existingGrid = canvas.getObjects().filter(obj => obj.id === 'gridOverlay');
    existingGrid.forEach(grid => canvas.remove(grid));

    if (!showGrid) return;

    const gridLines = [];
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    // Vertical lines
    for (let i = 0; i <= canvasWidth; i += gridSize) {
      const line = new fabric.Line([i, 0, i, canvasHeight], {
        stroke: '#e5e7eb',
        strokeWidth: 1,
        selectable: false,
        evented: false,
        id: 'gridOverlay',
        excludeFromExport: true
      });
      gridLines.push(line);
    }

    // Horizontal lines
    for (let i = 0; i <= canvasHeight; i += gridSize) {
      const line = new fabric.Line([0, i, canvasWidth, i], {
        stroke: '#e5e7eb',
        strokeWidth: 1,
        selectable: false,
        evented: false,
        id: 'gridOverlay',
        excludeFromExport: true
      });
      gridLines.push(line);
    }

    gridLines.forEach(line => {
      canvas.add(line);
      canvas.sendToBack(line);
    });

    canvas.renderAll();
  };

  const handleObjectMoving = (e) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    
    const obj = e.target;
    if (obj.type === 'printArea') {
      const key = obj.printAreaKey;
      
      // Update label position during move
      const label = fabricCanvas.getObjects().find(o => o.id === `printAreaLabel_${key}`);
      if (label) {
        label.set({
          left: obj.left + 5,
          top: obj.top - 25
        });
      }
      
      // Apply snap to grid if enabled
      if (snapToGrid) {
        obj.set({
          left: Math.round(obj.left / gridSize) * gridSize,
          top: Math.round(obj.top / gridSize) * gridSize
        });
      }
      
      // Render the canvas to show the label moving with the rectangle
      fabricCanvas.renderAll();
    }
  };

  const handleObjectModified = (e) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    
    const obj = e.target;
    if (obj.type === 'printArea') {
      const key = obj.printAreaKey;
      const existingArea = printAreas[key];
      const shapeType = obj.printAreaShape || existingArea?.shape || 'rectangle';
      
      // Calculate dimensions based on shape type
      let width, height;
      if (shapeType === 'circle' || shapeType === 'ellipse') {
        // For ellipses, width/height are diameter (2 * radius)
        width = Math.round(obj.rx * 2 * obj.scaleX);
        height = Math.round(obj.ry * 2 * obj.scaleY);
      } else {
        // For rectangles
        width = Math.round(obj.width * obj.scaleX);
        height = Math.round(obj.height * obj.scaleY);
      }
      
      // Preserve ALL existing properties, especially the name and shape
      const newArea = {
        ...existingArea,
        name: existingArea?.name || obj.printAreaName || key, // Explicitly preserve name
        shape: shapeType, // Preserve shape
        x: Math.round(obj.left),
        y: Math.round(obj.top),
        width: width,
        height: height,
        maxWidth: width,
        maxHeight: height
      };
      
      console.log('[PrintAreaAdmin] Updating print area:', key, 'with name:', newArea.name, 'shape:', newArea.shape);

      setPrintAreas(prev => ({
        ...prev,
        [key]: newArea
      }));

      // Update label position
      const label = fabricCanvas.getObjects().find(o => o.id === `printAreaLabel_${key}`);
      if (label) {
        label.set({
          left: obj.left + 5,
          top: obj.top - 25
        });
      }

      // Reset scale to prevent compound scaling
      if (shapeType === 'circle' || shapeType === 'ellipse') {
        obj.set({
          scaleX: 1,
          scaleY: 1,
          rx: width / 2,
          ry: height / 2
        });
      } else {
        obj.set({
          scaleX: 1,
          scaleY: 1,
          width: width,
          height: height
        });
      }

      fabricCanvas.renderAll();
    }
  };

  const handleMouseUp = (e) => {
    // Ensure any active object is properly released
    const fabricCanvas = fabricCanvasRef.current;
    if (fabricCanvas) {
      const activeObject = fabricCanvas.getActiveObject();
      if (activeObject && activeObject.type === 'printArea') {
        // Force a re-render to ensure the object is in the correct state
        fabricCanvas.renderAll();
      }
    }
  };

  const handleObjectSelected = (e) => {
    const obj = e.target;
    if (obj.type === 'printArea') {
      setSelectedPrintArea(obj.printAreaKey);
    }
  };

  const handleSelectionCleared = () => {
    setSelectedPrintArea(null);
  };

  const addNewPrintArea = () => {
    if (!newAreaName.trim() || !canvas) return;

    const key = newAreaName.toLowerCase().replace(/\s+/g, '_');
    if (printAreas[key]) {
      alert('Print area with this name already exists');
      return;
    }

    const newArea = {
      name: newAreaName,
      x: 200,
      y: 200,
      width: 200,
      height: 200,
      maxWidth: 200,
      maxHeight: 200,
      shape: newAreaShape
    };

    console.log('[PrintAreaAdmin] Adding new print area:', key, newArea);

    // Update state FIRST - this is the critical change!
    // By updating state first, we ensure that when loadPrintAreas is called,
    // it has the complete set of areas to render
    setPrintAreas(prevAreas => {
      const updatedAreas = {
        ...prevAreas,
        [key]: newArea
      };
      
      // Reload all print areas after state update completes
      // Use requestAnimationFrame to ensure state has been committed
      requestAnimationFrame(() => {
        // Remove all existing print area objects and labels
        const existingAreas = canvas.getObjects().filter(obj => 
          obj.type === 'printArea' || obj.type === 'printAreaLabel'
        );
        existingAreas.forEach(area => canvas.remove(area));
        
        // Render all print areas including the new one
        Object.entries(updatedAreas).forEach(([areaKey, area]) => {
          let shape;
          const shapeType = area.shape || 'rectangle';
          
          if (shapeType === 'circle' || shapeType === 'ellipse') {
            // Create circle or ellipse
            const radiusX = area.width / 2;
            const radiusY = area.height / 2;
            shape = new fabric.Ellipse({
              left: area.x,
              top: area.y,
              rx: radiusX,
              ry: radiusY,
              fill: 'rgba(59, 130, 246, 0.2)',
              stroke: '#3b82f6',
              strokeWidth: 2,
              strokeDashArray: [5, 5],
              cornerColor: '#3b82f6',
              cornerSize: 8,
              transparentCorners: false,
              id: `printArea_${areaKey}`,
              type: 'printArea',
              printAreaKey: areaKey,
              printAreaName: area.name,
              printAreaShape: shapeType
            });
          } else {
            // Create rectangle (default)
            shape = new fabric.Rect({
              left: area.x,
              top: area.y,
              width: area.width,
              height: area.height,
              fill: 'rgba(59, 130, 246, 0.2)',
              stroke: '#3b82f6',
              strokeWidth: 2,
              strokeDashArray: [5, 5],
              cornerColor: '#3b82f6',
              cornerSize: 8,
              transparentCorners: false,
              id: `printArea_${areaKey}`,
              type: 'printArea',
              printAreaKey: areaKey,
              printAreaName: area.name,
              printAreaShape: shapeType
            });
          }

          const label = new fabric.Text(area.name, {
            left: area.x + 5,
            top: area.y - 25,
            fontSize: 14,
            fill: '#3b82f6',
            fontWeight: 'bold',
            selectable: false,
            evented: false,
            id: `printAreaLabel_${areaKey}`,
            type: 'printAreaLabel'
          });

          canvas.add(shape);
          canvas.add(label);
        });
        
        canvas.renderAll();
        console.log('[PrintAreaAdmin] All print areas re-rendered including new area:', key);
      });
      
      return updatedAreas;
    });

    setNewAreaName('');
    setNewAreaShape('rectangle');
    setShowNewAreaDialog(false);
  };

  const deletePrintArea = (key) => {
    if (!confirm(`Are you sure you want to delete the "${printAreas[key].name}" print area?`)) {
      return;
    }

    const newPrintAreas = { ...printAreas };
    delete newPrintAreas[key];
    setPrintAreas(newPrintAreas);

    // Remove from canvas
    const fabricCanvas = fabricCanvasRef.current;
    if (fabricCanvas) {
      const rect = fabricCanvas.getObjects().find(obj => obj.id === `printArea_${key}`);
      const label = fabricCanvas.getObjects().find(obj => obj.id === `printAreaLabel_${key}`);
      
      if (rect) fabricCanvas.remove(rect);
      if (label) fabricCanvas.remove(label);
      
      fabricCanvas.renderAll();
    }
  };

  const saveConfiguration = async () => {
    if (!currentProduct || !selectedProduct) {
      setSaveMessage({ type: 'error', text: 'No product selected to save.' });
      return;
    }
    
    if (!selectedColor) {
      setSaveMessage({ type: 'error', text: 'Please select a color variant to save.' });
      return;
    }

    if (!selectedView) {
      setSaveMessage({ type: 'error', text: 'Please select a view to save.' });
      return;
    }
    
    if (!isAdmin) {
      setSaveMessage({ type: 'error', text: 'Only administrators can save configurations.' });
      return;
    }

    setIsSaving(true);
    setSaveMessage({ type: 'info', text: `Saving configuration for ${selectedColor} - ${selectedView} view...` });

    try {
      const variantConfig = {
        colorName: selectedColor,
        templateUrl: currentProduct.template,
        printAreas: printAreas
      };

      console.log('[PrintAreaAdmin] Saving variant configuration to Supabase:', {
        productKey: selectedProduct,
        color: selectedColor,
        view: selectedView,
        printAreasCount: Object.keys(printAreas).length,
        database: supabaseConfig.url
      });

      // Save variant-specific configuration
      const result = await saveVariantConfiguration(
        selectedProduct,
        selectedColor,
        selectedView,
        variantConfig
      );
      
      console.log('[PrintAreaAdmin] ✓ Successfully saved variant to Supabase database:', result);

      // Also call the parent callback if provided
      if (onSaveConfiguration) {
        const updatedProduct = {
          name: currentProduct.name,
          template: currentProduct.template,
          printAreas: printAreas,
          colors: currentProduct.colors,
          basePrice: currentProduct.basePrice
        };
        onSaveConfiguration(selectedProduct, updatedProduct);
      }

      // Show detailed success message
      const now = new Date();
      const timestamp = now.toLocaleTimeString();
      setLastSaved(now);
      
      setSaveMessage({ 
        type: 'success', 
        text: `✓ Configuration saved! Product: "${currentProduct.name}", Color: ${selectedColor}, View: ${selectedView}, Print Areas: ${Object.keys(printAreas).length}, Saved at: ${timestamp}` 
      });

      // Update variant ID if returned
      if (result && result.id) {
        setCurrentVariantId(result.id);
      }

      // Clear success message after 12 seconds
      setTimeout(() => setSaveMessage(null), 12000);
    } catch (error) {
      console.error('[PrintAreaAdmin] ✗ Error saving to Supabase:', error);
      
      // Provide detailed error message
      let errorMessage = '✗ Failed to save to Supabase database. ';
      if (error.message) {
        errorMessage += `Error: ${error.message}. `;
      }
      if (error.code) {
        errorMessage += `Code: ${error.code}. `;
      }
      errorMessage += 'Check browser console for full details.';
      
      setSaveMessage({ 
        type: 'error', 
        text: errorMessage
      });
    } finally {
      setIsSaving(false);
    }
  };

  const exportConfiguration = () => {
    if (!currentProduct || !printAreas) return;

    const config = {
      product: selectedProduct,
      printAreas: printAreas,
      exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedProduct}-print-areas.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleTemplateUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!isAdmin) {
      setSaveMessage({ type: 'error', text: 'Only administrators can upload templates.' });
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setSaveMessage({ type: 'error', text: 'Please select an image file.' });
      return;
    }

    setIsUploading(true);
    setSaveMessage({ type: 'info', text: 'Uploading template image...' });

    try {
      // Upload to Supabase Storage
      let templateUrl;
      if (currentProduct && currentProduct.template) {
        // Replace existing template
        templateUrl = await replaceTemplateImage(
          currentProduct.template,
          file,
          selectedProduct
        );
      } else {
        // Upload new template
        templateUrl = await uploadTemplateImage(file, selectedProduct);
      }

      console.log('[PrintAreaAdmin] Template uploaded, new URL:', templateUrl);

      // Save to database first to ensure persistence
      const updatedProduct = {
        ...currentProduct,
        template: templateUrl,
        printAreas: printAreas  // Include current print areas
      };
      
      try {
        await saveProductConfiguration(selectedProduct, updatedProduct);
        console.log('[PrintAreaAdmin] Template URL saved to database');
      } catch (saveError) {
        console.warn('[PrintAreaAdmin] Failed to save template URL to database:', saveError);
        // Don't throw - the template is uploaded and will work in current session
      }

      // Update local state to trigger canvas refresh
      // Adding a timestamp to force React to detect the change
      const newProduct = {
        ...updatedProduct,
        _uploadTimestamp: Date.now()  // Force state change detection
      };
      
      // Update the prevTemplateRef to ensure the useEffect detects the change
      prevTemplateRef.current = null;  // Reset to force reload
      
      setCurrentProduct(newProduct);

      // Clear the file input to allow re-uploading the same file if needed
      if (e.target) {
        e.target.value = '';
      }

      setSaveMessage({ 
        type: 'success', 
        text: '✓ Template image uploaded successfully! Refreshing canvas...' 
      });
      
      // Clear message after canvas has time to refresh
      setTimeout(() => setSaveMessage(null), 4000);
    } catch (error) {
      console.error('[PrintAreaAdmin] Error uploading template:', error);
      setSaveMessage({ 
        type: 'error', 
        text: `✗ Failed to upload template: ${error.message || 'Unknown error'}` 
      });
    } finally {
      setIsUploading(false);
    }
  };

  const importConfiguration = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const config = JSON.parse(event.target.result);
        if (config.printAreas) {
          console.log('[PrintAreaAdmin] Importing configuration:', config.printAreas);
          setPrintAreas(config.printAreas);
          
          // Reload print areas after a short delay to ensure state is updated
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              loadPrintAreas();
            });
          });
        }
      } catch {
        alert('Invalid configuration file');
      }
    };
    reader.readAsText(file);
  };

  // Template Management Functions
  const loadAvailableTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const { getProductTemplates } = await import('../services/supabaseService');
      const templates = await getProductTemplates();
      
      console.log('[PrintAreaAdmin] Loaded templates:', templates);
      setAvailableTemplates(templates);
    } catch (error) {
      console.error('[PrintAreaAdmin] Error loading templates:', error);
      setSaveMessage({ 
        type: 'error', 
        text: `Failed to load templates: ${error.message}` 
      });
    } finally {
      setLoadingTemplates(false);
    }
  };

  const loadTemplateForEditing = async (template) => {
    try {
      console.log('[PrintAreaAdmin] Loading template for editing:', template);
      
      // Close the template manager
      setShowTemplateManager(false);
      
      // Convert print areas array to object format
      const printAreasObj = {};
      if (template.print_areas && Array.isArray(template.print_areas)) {
        template.print_areas.forEach(area => {
          printAreasObj[area.area_key] = {
            name: area.name,
            x: area.x,
            y: area.y,
            width: area.width,
            height: area.height,
            maxWidth: area.max_width,
            maxHeight: area.max_height,
            shape: area.shape || 'rectangle'
          };
        });
      }
      
      // Update current product state
      const updatedProduct = {
        name: template.name,
        template: template.template_url,
        printAreas: printAreasObj,
        colors: template.colors || [],
        basePrice: template.base_price || 0
      };
      
      setCurrentProduct(updatedProduct);
      setPrintAreas(printAreasObj);
      
      // Wait for state to update, then reload canvas
      setTimeout(() => {
        loadProduct();
      }, 100);
      
      setSaveMessage({ 
        type: 'success', 
        text: `Template "${template.name}" loaded for editing` 
      });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      console.error('[PrintAreaAdmin] Error loading template for editing:', error);
      setSaveMessage({ 
        type: 'error', 
        text: `Failed to load template: ${error.message}` 
      });
    }
  };

  const deleteTemplate = async (template) => {
    if (!confirm(`Are you sure you want to delete the template "${template.name}"? This will also delete all associated print areas. This action cannot be undone.`)) {
      return;
    }

    try {
      const { deleteProductTemplate } = await import('../services/supabaseService');
      await deleteProductTemplate(template.product_key);
      
      console.log('[PrintAreaAdmin] Deleted template:', template.product_key);
      
      // Reload templates list
      await loadAvailableTemplates();
      
      setSaveMessage({ 
        type: 'success', 
        text: `Template "${template.name}" deleted successfully` 
      });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      console.error('[PrintAreaAdmin] Error deleting template:', error);
      setSaveMessage({ 
        type: 'error', 
        text: `Failed to delete template: ${error.message}` 
      });
    }
  };

  // Load templates when manager is opened
  useEffect(() => {
    if (showTemplateManager) {
      loadAvailableTemplates();
    }
  }, [showTemplateManager]);

  // Admin check loading
  if (adminCheckLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4 text-center">
          <Loader className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
          <h2 className="text-xl font-bold mb-2">Checking Access</h2>
          <p className="text-gray-600">Verifying administrator permissions...</p>
        </div>
      </div>
    );
  }

  // Non-admin message
  if (!isAdmin) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
          <div className="flex items-center justify-center mb-4 text-red-600">
            <AlertCircle className="w-12 h-12" />
          </div>
          <h2 className="text-2xl font-bold mb-4 text-center">Access Denied</h2>
          <p className="text-gray-600 text-center mb-6">
            You must be an administrator to access the Print Area Configuration panel.
          </p>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // Loading product data
  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4 text-center">
          <Loader className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
          <h2 className="text-xl font-bold mb-2">Loading Product</h2>
          <p className="text-gray-600">Please wait...</p>
        </div>
      </div>
    );
  }

  if (!selectedProduct || !currentProduct) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
          <h2 className="text-2xl font-bold mb-4">Print Area Admin</h2>
          <p className="text-gray-600">Please select a product to configure print areas.</p>
          <button
            onClick={onClose}
            className="mt-4 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-7xl" style={{ height: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div className="p-6 border-b flex-shrink-0">
          <div className="flex justify-between items-center mb-3">
            <div>
              <h2 className="text-2xl font-bold">Print Area Configuration</h2>
              <p className="text-gray-600 mb-2">Product: {currentProduct.name}</p>
              
              {/* Color and View Selectors */}
              <div className="flex items-center space-x-4 mt-3">
                {/* Color Selector */}
                {availableColors.length > 0 && (
                  <div className="flex items-center space-x-2">
                    <label className="text-sm font-medium text-gray-700">Color:</label>
                    <select
                      value={selectedColor || ''}
                      onChange={(e) => setSelectedColor(e.target.value)}
                      className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {availableColors.map(color => (
                        <option key={color} value={color}>
                          {color}
                        </option>
                      ))}
                    </select>
                    {/* Color preview */}
                    <div 
                      className="w-6 h-6 rounded border-2 border-gray-300"
                      style={{ backgroundColor: selectedColor }}
                      title={selectedColor}
                    />
                  </div>
                )}
                
                {/* View Selector */}
                {availableViews.length > 1 && (
                  <div className="flex items-center space-x-2">
                    <label className="text-sm font-medium text-gray-700">View:</label>
                    <select
                      value={selectedView}
                      onChange={(e) => setSelectedView(e.target.value)}
                      className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {availableViews.map(view => (
                        <option key={view} value={view}>
                          {view.charAt(0).toUpperCase() + view.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              
              {lastSaved && (
                <p className="text-sm text-green-600 mt-2 flex items-center">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Last saved: {lastSaved.toLocaleTimeString()}
                </p>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => templateUploadRef.current?.click()}
                disabled={isUploading}
                className="flex items-center space-x-1 px-3 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Upload Product Template Image"
              >
                {isUploading ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                <span>Template</span>
              </button>
              <button
                onClick={exportConfiguration}
                className="flex items-center space-x-1 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                <Download className="w-4 h-4" />
                <span>Export</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center space-x-1 px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                <Upload className="w-4 h-4" />
                <span>Import</span>
              </button>
              <button
                onClick={() => setShowTemplateManager(true)}
                className="flex items-center space-x-1 px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                title="Manage Templates"
              >
                <Settings className="w-4 h-4" />
                <span>Manage</span>
              </button>
              <button
                onClick={saveConfiguration}
                disabled={isSaving}
                className="flex items-center space-x-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Save</span>
                  </>
                )}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </div>
          
          {/* Save Message */}
          {saveMessage && (
            <div className={`flex items-center space-x-2 p-3 rounded-md ${
              saveMessage.type === 'success' 
                ? 'bg-green-50 text-green-800 border border-green-200' 
                : saveMessage.type === 'info'
                ? 'bg-blue-50 text-blue-800 border border-blue-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {saveMessage.type === 'success' ? (
                <CheckCircle className="w-5 h-5" />
              ) : saveMessage.type === 'info' ? (
                <Loader className="w-5 h-5 animate-spin" />
              ) : (
                <AlertCircle className="w-5 h-5" />
              )}
              <span className="font-medium">{saveMessage.text}</span>
            </div>
          )}
        </div>

        <div className="flex overflow-hidden" style={{ flex: 1, minHeight: 0 }}>
          {/* Left Sidebar - Controls */}
          <div className="w-80 border-r p-6 overflow-y-auto flex-shrink-0">
            <div className="space-y-6">
              {/* Grid Controls */}
              <div>
                <h3 className="text-lg font-semibold mb-3">Grid & Guides</h3>
                <div className="space-y-3">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={showGrid}
                      onChange={(e) => setShowGrid(e.target.checked)}
                      className="rounded"
                    />
                    <Grid className="w-4 h-4" />
                    <span>Show Grid</span>
                  </label>
                  
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={snapToGrid}
                      onChange={(e) => setSnapToGrid(e.target.checked)}
                      className="rounded"
                    />
                    <span>Snap to Grid</span>
                  </label>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
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
              <div>
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-lg font-semibold">Print Areas</h3>
                  <button
                    onClick={() => setShowNewAreaDialog(true)}
                    className="flex items-center space-x-1 px-2 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add</span>
                  </button>
                </div>
                
                <div className="space-y-2">
                  {Object.entries(printAreas).map(([key, area]) => (
                    <div
                      key={key}
                      className={`p-3 border rounded-lg ${
                        selectedPrintArea === key ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h4 className="font-medium">{area.name}</h4>
                          <div className="text-xs text-gray-500 mt-1">
                            <div>Position: {area.x}, {area.y}</div>
                            <div>Size: {area.width} × {area.height}</div>
                          </div>
                        </div>
                        <button
                          onClick={() => deletePrintArea(key)}
                          className="text-red-600 hover:text-red-800 p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Selected Area Details */}
              {selectedPrintArea && printAreas[selectedPrintArea] && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">Area Details</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Name
                      </label>
                      <input
                        type="text"
                        value={printAreas[selectedPrintArea].name}
                        onChange={(e) => {
                          setPrintAreas(prev => ({
                            ...prev,
                            [selectedPrintArea]: {
                              ...prev[selectedPrintArea],
                              name: e.target.value
                            }
                          }));
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">X</label>
                        <input
                          type="number"
                          value={printAreas[selectedPrintArea].x}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 0;
                            setPrintAreas(prev => ({
                              ...prev,
                              [selectedPrintArea]: {
                                ...prev[selectedPrintArea],
                                x: value
                              }
                            }));
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Y</label>
                        <input
                          type="number"
                          value={printAreas[selectedPrintArea].y}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 0;
                            setPrintAreas(prev => ({
                              ...prev,
                              [selectedPrintArea]: {
                                ...prev[selectedPrintArea],
                                y: value
                              }
                            }));
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Width</label>
                        <input
                          type="number"
                          value={printAreas[selectedPrintArea].width}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 0;
                            setPrintAreas(prev => ({
                              ...prev,
                              [selectedPrintArea]: {
                                ...prev[selectedPrintArea],
                                width: value,
                                maxWidth: value
                              }
                            }));
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Height</label>
                        <input
                          type="number"
                          value={printAreas[selectedPrintArea].height}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 0;
                            setPrintAreas(prev => ({
                              ...prev,
                              [selectedPrintArea]: {
                                ...prev[selectedPrintArea],
                                height: value,
                                maxHeight: value
                              }
                            }));
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Center - Canvas */}
          <div className="p-6 overflow-auto" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div className="flex justify-between items-center mb-4 flex-shrink-0">
              <h3 className="text-lg font-semibold">Visual Configuration</h3>
              <div className="text-sm text-gray-500">
                Drag and resize the blue rectangles to configure print areas
              </div>
            </div>
            
            <div className="border border-gray-200 rounded-lg bg-white p-4 flex-shrink-0" style={{ width: '800px', height: '800px' }}>
              <canvas ref={canvasRef} width="800" height="800" />
            </div>
          </div>
        </div>

        {/* New Area Dialog */}
        {showNewAreaDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold mb-4">Add New Print Area</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Area Name
                  </label>
                  <input
                    type="text"
                    value={newAreaName}
                    onChange={(e) => setNewAreaName(e.target.value)}
                    placeholder="e.g., Left Chest, Back, Sleeve"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Shape
                  </label>
                  <select
                    value={newAreaShape}
                    onChange={(e) => setNewAreaShape(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="rectangle">Rectangle</option>
                    <option value="circle">Circle</option>
                    <option value="ellipse">Ellipse</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {newAreaShape === 'rectangle' && 'Rectangular print area for standard designs'}
                    {newAreaShape === 'circle' && 'Perfect circle print area (width = height)'}
                    {newAreaShape === 'ellipse' && 'Oval/elliptical print area (adjustable width and height)'}
                  </p>
                </div>
                <div className="flex justify-end space-x-2">
                  <button
                    onClick={() => {
                      setShowNewAreaDialog(false);
                      setNewAreaName('');
                      setNewAreaShape('rectangle');
                    }}
                    className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={addNewPrintArea}
                    disabled={!newAreaName.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    Add Area
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Template Manager Modal */}
        {showTemplateManager && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg w-full max-w-4xl max-h-[80vh] flex flex-col mx-4">
              {/* Header */}
              <div className="p-6 border-b flex-shrink-0">
                <div className="flex justify-between items-center">
                  <h3 className="text-xl font-bold">Manage Templates</h3>
                  <button
                    onClick={() => setShowTemplateManager(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <span className="text-2xl">&times;</span>
                  </button>
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  View, edit, and delete existing product templates
                </p>
              </div>

              {/* Content */}
              <div className="p-6 overflow-y-auto flex-1">
                {loadingTemplates ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader className="w-8 h-8 animate-spin text-blue-600" />
                    <span className="ml-2 text-gray-600">Loading templates...</span>
                  </div>
                ) : availableTemplates.length === 0 ? (
                  <div className="text-center py-12">
                    <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">No templates found in the database.</p>
                    <p className="text-sm text-gray-500 mt-2">
                      Create a new template by configuring a product and saving it.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {availableTemplates.map((template) => (
                      <div
                        key={template.id}
                        className="border border-gray-200 rounded-lg p-4 hover:border-blue-500 transition-colors"
                      >
                        {/* Template Image */}
                        {template.template_url && (
                          <div className="mb-3 h-32 bg-gray-100 rounded overflow-hidden">
                            <img
                              src={template.template_url}
                              alt={template.name}
                              className="w-full h-full object-contain"
                              onError={(e) => {
                                e.target.style.display = 'none';
                                e.target.parentElement.innerHTML = '<div class="flex items-center justify-center h-full text-gray-400">No preview</div>';
                              }}
                            />
                          </div>
                        )}

                        {/* Template Info */}
                        <h4 className="font-semibold text-lg mb-2">{template.name}</h4>
                        <div className="text-sm text-gray-600 space-y-1 mb-3">
                          <div>Product Key: <span className="font-mono bg-gray-100 px-1 rounded">{template.product_key}</span></div>
                          <div>Print Areas: {template.print_areas?.length || 0}</div>
                          <div>Base Price: ${template.base_price}</div>
                          <div className="text-xs text-gray-500">
                            Created: {new Date(template.created_at).toLocaleDateString()}
                          </div>
                        </div>

                        {/* Print Areas List */}
                        {template.print_areas && template.print_areas.length > 0 && (
                          <div className="mb-3">
                            <div className="text-xs font-medium text-gray-700 mb-1">Print Areas:</div>
                            <div className="flex flex-wrap gap-1">
                              {template.print_areas.map((area, idx) => (
                                <span
                                  key={idx}
                                  className="inline-block text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded"
                                >
                                  {area.name} ({area.shape || 'rect'})
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex space-x-2">
                          <button
                            onClick={() => loadTemplateForEditing(template)}
                            className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
                          >
                            <Settings className="w-4 h-4" />
                            <span>Edit</span>
                          </button>
                          <button
                            onClick={() => deleteTemplate(template)}
                            className="flex items-center justify-center px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-6 border-t flex-shrink-0">
                <div className="flex justify-between items-center">
                  <button
                    onClick={loadAvailableTemplates}
                    disabled={loadingTemplates}
                    className="flex items-center space-x-1 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50"
                  >
                    <RotateCw className={`w-4 h-4 ${loadingTemplates ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                  <button
                    onClick={() => setShowTemplateManager(false)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={importConfiguration}
          className="hidden"
        />
        <input
          ref={templateUploadRef}
          type="file"
          accept="image/*"
          onChange={handleTemplateUpload}
          className="hidden"
        />
      </div>
    </div>
  );
};

export default PrintAreaAdmin;
