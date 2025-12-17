
import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook for managing print areas in the design system
 * Provides functionality for loading, updating, and managing print area configurations
 */
export const usePrintAreas = (productsConfig, selectedProduct) => {
  const [printAreas, setPrintAreas] = useState({});
  const [selectedPrintArea, setSelectedPrintArea] = useState(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [overlaySettings, setOverlaySettings] = useState({
    color: '#007bff',
    opacity: 0.1,
    strokeWidth: 2,
    dashArray: [5, 5]
  });

  // Load print areas when product changes
  useEffect(() => {
    if (selectedProduct && productsConfig[selectedProduct]) {
      const product = productsConfig[selectedProduct];
      const areas = product.printAreas || {};
      setPrintAreas(areas);
      
      // Set default selected area
      const areaKeys = Object.keys(areas);
      if (areaKeys.length > 0) {
        setSelectedPrintArea(areaKeys[0]);
      } else {
        setSelectedPrintArea(null);
      }
    } else {
      setPrintAreas({});
      setSelectedPrintArea(null);
    }
  }, [selectedProduct, productsConfig]);

  // Get current print area
  const getCurrentPrintArea = useCallback(() => {
    if (!selectedPrintArea || !printAreas[selectedPrintArea]) {
      return null;
    }
    return printAreas[selectedPrintArea];
  }, [selectedPrintArea, printAreas]);

  // Update print area configuration
  const updatePrintArea = useCallback((areaKey, updates) => {
    setPrintAreas(prev => ({
      ...prev,
      [areaKey]: {
        ...prev[areaKey],
        ...updates
      }
    }));
  }, []);

  // Add new print area
  const addPrintArea = useCallback((areaKey, areaConfig) => {
    setPrintAreas(prev => ({
      ...prev,
      [areaKey]: areaConfig
    }));
  }, []);

  // Remove print area
  const removePrintArea = useCallback((areaKey) => {
    setPrintAreas(prev => {
      const newAreas = { ...prev };
      delete newAreas[areaKey];
      return newAreas;
    });
    
    // Update selected area if the removed area was selected
    if (selectedPrintArea === areaKey) {
      const remainingKeys = Object.keys(printAreas).filter(key => key !== areaKey);
      setSelectedPrintArea(remainingKeys.length > 0 ? remainingKeys[0] : null);
    }
  }, [selectedPrintArea, printAreas]);

  // Toggle overlay visibility
  const toggleOverlay = useCallback(() => {
    setShowOverlay(prev => !prev);
  }, []);

  // Update overlay settings
  const updateOverlaySettings = useCallback((settings) => {
    setOverlaySettings(prev => ({
      ...prev,
      ...settings
    }));
  }, []);

  // Validate if an object fits within the current print area
  const validateObjectInPrintArea = useCallback((object) => {
    const currentArea = getCurrentPrintArea();
    if (!currentArea || !object) return true;

    const objBounds = object.getBoundingRect();
    const areaLeft = currentArea.x;
    const areaTop = currentArea.y;
    const areaRight = currentArea.x + currentArea.width;
    const areaBottom = currentArea.y + currentArea.height;

    return (
      objBounds.left >= areaLeft &&
      objBounds.top >= areaTop &&
      objBounds.left + objBounds.width <= areaRight &&
      objBounds.top + objBounds.height <= areaBottom
    );
  }, [getCurrentPrintArea]);

  // Constrain object to print area
  const constrainObjectToPrintArea = useCallback((object) => {
    const currentArea = getCurrentPrintArea();
    if (!currentArea || !object) return;

    const objBounds = object.getBoundingRect();
    const areaLeft = currentArea.x;
    const areaTop = currentArea.y;
    const areaRight = currentArea.x + currentArea.width;
    const areaBottom = currentArea.y + currentArea.height;

    let newLeft = object.left;
    let newTop = object.top;

    // Constrain position
    if (objBounds.left < areaLeft) {
      newLeft = areaLeft + (object.left - objBounds.left);
    }
    if (objBounds.top < areaTop) {
      newTop = areaTop + (object.top - objBounds.top);
    }
    if (objBounds.left + objBounds.width > areaRight) {
      newLeft = areaRight - objBounds.width + (object.left - objBounds.left);
    }
    if (objBounds.top + objBounds.height > areaBottom) {
      newTop = areaBottom - objBounds.height + (object.top - objBounds.top);
    }

    object.set({
      left: newLeft,
      top: newTop
    });
  }, [getCurrentPrintArea]);

  // Get print area statistics
  const getPrintAreaStats = useCallback(() => {
    const currentArea = getCurrentPrintArea();
    if (!currentArea) return null;

    return {
      name: currentArea.name,
      position: { x: currentArea.x, y: currentArea.y },
      size: { width: currentArea.width, height: currentArea.height },
      maxSize: { 
        width: currentArea.maxWidth || currentArea.width, 
        height: currentArea.maxHeight || currentArea.height 
      },
      area: currentArea.width * currentArea.height,
      aspectRatio: (currentArea.width / currentArea.height).toFixed(2)
    };
  }, [getCurrentPrintArea]);

  return {
    // State
    printAreas,
    selectedPrintArea,
    showOverlay,
    overlaySettings,
    
    // Actions
    setSelectedPrintArea,
    setPrintAreas,
    updatePrintArea,
    addPrintArea,
    removePrintArea,
    toggleOverlay,
    updateOverlaySettings,
    
    // Computed values
    getCurrentPrintArea,
    getPrintAreaStats,
    
    // Validation
    validateObjectInPrintArea,
    constrainObjectToPrintArea,
    
    // Utilities
    availablePrintAreas: Object.keys(printAreas),
    hasPrintAreas: Object.keys(printAreas).length > 0,
    hasMultiplePrintAreas: Object.keys(printAreas).length > 1
  };
};

export default usePrintAreas;
