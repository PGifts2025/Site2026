
/**
 * Utility functions for print area management and validation
 */

/**
 * Validates print area configuration
 * @param {Object} printArea - Print area configuration object
 * @returns {Object} Validation result with isValid boolean and errors array
 */
export const validatePrintArea = (printArea) => {
  const errors = [];
  
  if (!printArea) {
    errors.push('Print area configuration is required');
    return { isValid: false, errors };
  }

  // Required fields
  const requiredFields = ['name', 'x', 'y', 'width', 'height'];
  requiredFields.forEach(field => {
    if (printArea[field] === undefined || printArea[field] === null) {
      errors.push(`${field} is required`);
    }
  });

  // Numeric validations
  const numericFields = ['x', 'y', 'width', 'height', 'maxWidth', 'maxHeight'];
  numericFields.forEach(field => {
    if (printArea[field] !== undefined && (isNaN(printArea[field]) || printArea[field] < 0)) {
      errors.push(`${field} must be a non-negative number`);
    }
  });

  // Size validations
  if (printArea.width && printArea.width <= 0) {
    errors.push('Width must be greater than 0');
  }
  if (printArea.height && printArea.height <= 0) {
    errors.push('Height must be greater than 0');
  }

  // Max size validations
  if (printArea.maxWidth && printArea.width && printArea.maxWidth < printArea.width) {
    errors.push('Max width cannot be less than width');
  }
  if (printArea.maxHeight && printArea.height && printArea.maxHeight < printArea.height) {
    errors.push('Max height cannot be less than height');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Normalizes print area configuration with default values
 * @param {Object} printArea - Print area configuration
 * @returns {Object} Normalized print area configuration
 */
export const normalizePrintArea = (printArea) => {
  if (!printArea) return null;

  return {
    name: printArea.name || 'Unnamed Area',
    x: Math.max(0, parseInt(printArea.x) || 0),
    y: Math.max(0, parseInt(printArea.y) || 0),
    width: Math.max(1, parseInt(printArea.width) || 100),
    height: Math.max(1, parseInt(printArea.height) || 100),
    maxWidth: parseInt(printArea.maxWidth) || parseInt(printArea.width) || 100,
    maxHeight: parseInt(printArea.maxHeight) || parseInt(printArea.height) || 100,
    ...printArea // Preserve any additional properties
  };
};

/**
 * Checks if a point is within a print area
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Object} printArea - Print area configuration
 * @returns {boolean} True if point is within the print area
 */
export const isPointInPrintArea = (x, y, printArea) => {
  if (!printArea) return false;
  
  return (
    x >= printArea.x &&
    x <= printArea.x + printArea.width &&
    y >= printArea.y &&
    y <= printArea.y + printArea.height
  );
};

/**
 * Checks if a rectangle overlaps with a print area
 * @param {Object} rect - Rectangle with x, y, width, height
 * @param {Object} printArea - Print area configuration
 * @returns {boolean} True if rectangle overlaps with print area
 */
export const isRectInPrintArea = (rect, printArea) => {
  if (!rect || !printArea) return false;

  return !(
    rect.x + rect.width < printArea.x ||
    rect.x > printArea.x + printArea.width ||
    rect.y + rect.height < printArea.y ||
    rect.y > printArea.y + printArea.height
  );
};

/**
 * Constrains a rectangle to fit within a print area
 * @param {Object} rect - Rectangle with x, y, width, height
 * @param {Object} printArea - Print area configuration
 * @returns {Object} Constrained rectangle
 */
export const constrainRectToPrintArea = (rect, printArea) => {
  if (!rect || !printArea) return rect;

  const constrainedRect = { ...rect };

  // Constrain position
  constrainedRect.x = Math.max(printArea.x, Math.min(rect.x, printArea.x + printArea.width - rect.width));
  constrainedRect.y = Math.max(printArea.y, Math.min(rect.y, printArea.y + printArea.height - rect.height));

  // Constrain size if it exceeds print area
  const maxWidth = printArea.x + printArea.width - constrainedRect.x;
  const maxHeight = printArea.y + printArea.height - constrainedRect.y;
  
  constrainedRect.width = Math.min(rect.width, maxWidth);
  constrainedRect.height = Math.min(rect.height, maxHeight);

  return constrainedRect;
};

/**
 * Calculates the optimal position for an object within a print area
 * @param {Object} objectSize - Object dimensions {width, height}
 * @param {Object} printArea - Print area configuration
 * @param {string} alignment - Alignment preference ('center', 'top-left', 'top-right', 'bottom-left', 'bottom-right')
 * @returns {Object} Optimal position {x, y}
 */
export const calculateOptimalPosition = (objectSize, printArea, alignment = 'center') => {
  if (!objectSize || !printArea) return { x: 0, y: 0 };

  const { width: objWidth, height: objHeight } = objectSize;
  const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = printArea;

  let x, y;

  switch (alignment) {
    case 'top-left':
      x = areaX;
      y = areaY;
      break;
    case 'top-right':
      x = areaX + areaWidth - objWidth;
      y = areaY;
      break;
    case 'bottom-left':
      x = areaX;
      y = areaY + areaHeight - objHeight;
      break;
    case 'bottom-right':
      x = areaX + areaWidth - objWidth;
      y = areaY + areaHeight - objHeight;
      break;
    case 'center':
    default:
      x = areaX + (areaWidth - objWidth) / 2;
      y = areaY + (areaHeight - objHeight) / 2;
      break;
  }

  // Ensure the position is within bounds
  x = Math.max(areaX, Math.min(x, areaX + areaWidth - objWidth));
  y = Math.max(areaY, Math.min(y, areaY + areaHeight - objHeight));

  return { x, y };
};

/**
 * Scales an object to fit within a print area while maintaining aspect ratio
 * @param {Object} objectSize - Object dimensions {width, height}
 * @param {Object} printArea - Print area configuration
 * @param {number} padding - Padding to maintain from edges (default: 10)
 * @returns {Object} Scaled dimensions {width, height, scale}
 */
export const scaleToFitPrintArea = (objectSize, printArea, padding = 10) => {
  if (!objectSize || !printArea) return objectSize;

  const { width: objWidth, height: objHeight } = objectSize;
  const availableWidth = printArea.width - (padding * 2);
  const availableHeight = printArea.height - (padding * 2);

  if (objWidth <= availableWidth && objHeight <= availableHeight) {
    return { ...objectSize, scale: 1 };
  }

  const scaleX = availableWidth / objWidth;
  const scaleY = availableHeight / objHeight;
  const scale = Math.min(scaleX, scaleY);

  return {
    width: objWidth * scale,
    height: objHeight * scale,
    scale
  };
};

/**
 * Generates a unique key for a print area
 * @param {string} name - Print area name
 * @param {Object} existingAreas - Existing print areas to check for conflicts
 * @returns {string} Unique key
 */
export const generatePrintAreaKey = (name, existingAreas = {}) => {
  let baseKey = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  let key = baseKey;
  let counter = 1;

  while (existingAreas[key]) {
    key = `${baseKey}_${counter}`;
    counter++;
  }

  return key;
};

/**
 * Exports print area configuration to JSON
 * @param {Object} printAreas - Print areas configuration
 * @param {string} productName - Product name for metadata
 * @returns {string} JSON string
 */
export const exportPrintAreasConfig = (printAreas, productName = 'Unknown') => {
  const config = {
    product: productName,
    printAreas,
    exportedAt: new Date().toISOString(),
    version: '1.0'
  };

  return JSON.stringify(config, null, 2);
};

/**
 * Imports and validates print area configuration from JSON
 * @param {string} jsonString - JSON configuration string
 * @returns {Object} Import result with success boolean, data, and errors
 */
export const importPrintAreasConfig = (jsonString) => {
  try {
    const config = JSON.parse(jsonString);
    
    if (!config.printAreas || typeof config.printAreas !== 'object') {
      return {
        success: false,
        errors: ['Invalid configuration: printAreas object not found']
      };
    }

    const errors = [];
    const validatedAreas = {};

    Object.entries(config.printAreas).forEach(([key, area]) => {
      const validation = validatePrintArea(area);
      if (validation.isValid) {
        validatedAreas[key] = normalizePrintArea(area);
      } else {
        errors.push(`Print area "${key}": ${validation.errors.join(', ')}`);
      }
    });

    return {
      success: errors.length === 0,
      data: {
        printAreas: validatedAreas,
        metadata: {
          product: config.product,
          exportedAt: config.exportedAt,
          version: config.version
        }
      },
      errors
    };
  } catch (error) {
    return {
      success: false,
      errors: [`Invalid JSON: ${error.message}`]
    };
  }
};

/**
 * Creates a default print area configuration for common product types
 * @param {string} productType - Type of product (tshirt, mug, bag, etc.)
 * @param {Object} canvasSize - Canvas dimensions {width, height}
 * @returns {Object} Default print areas configuration
 */
export const createDefaultPrintAreas = (productType, canvasSize = { width: 800, height: 800 }) => {
  const { width: canvasWidth, height: canvasHeight } = canvasSize;
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  const defaults = {
    tshirt: {
      front: {
        name: 'Front',
        x: centerX - 150,
        y: centerY - 175,
        width: 300,
        height: 350,
        maxWidth: 300,
        maxHeight: 350
      },
      back: {
        name: 'Back',
        x: centerX - 150,
        y: centerY - 175,
        width: 300,
        height: 350,
        maxWidth: 300,
        maxHeight: 350
      },
      left_chest: {
        name: 'Left Chest',
        x: centerX - 100,
        y: centerY - 100,
        width: 80,
        height: 80,
        maxWidth: 80,
        maxHeight: 80
      }
    },
    hoodie: {
      front: {
        name: 'Front',
        x: centerX - 150,
        y: centerY - 150,
        width: 300,
        height: 300,
        maxWidth: 300,
        maxHeight: 300
      },
      back: {
        name: 'Back',
        x: centerX - 150,
        y: centerY - 150,
        width: 300,
        height: 300,
        maxWidth: 300,
        maxHeight: 300
      }
    },
    bag: {
      front: {
        name: 'Front',
        x: centerX - 200,
        y: centerY - 200,
        width: 400,
        height: 400,
        maxWidth: 400,
        maxHeight: 400
      }
    },
    mug: {
      wrap: {
        name: 'Wrap Around',
        x: centerX - 250,
        y: centerY - 100,
        width: 500,
        height: 200,
        maxWidth: 500,
        maxHeight: 200
      }
    },
    cap: {
      front: {
        name: 'Front Panel',
        x: centerX - 100,
        y: centerY - 50,
        width: 200,
        height: 100,
        maxWidth: 200,
        maxHeight: 100
      }
    }
  };

  return defaults[productType] || {
    default: {
      name: 'Print Area',
      x: centerX - 150,
      y: centerY - 150,
      width: 300,
      height: 300,
      maxWidth: 300,
      maxHeight: 300
    }
  };
};
