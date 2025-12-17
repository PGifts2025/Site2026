
// File validation utilities for the design tool

export const SUPPORTED_FORMATS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'application/postscript': '.ai',
  'application/x-coreldraw': '.cdr'
};

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const validateFile = (file) => {
  const errors = [];

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    errors.push(`File size must be less than ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }

  // Check file type
  if (!SUPPORTED_FORMATS[file.type]) {
    errors.push('Unsupported file format. Please use PNG, JPEG, SVG, PDF, AI, or Corel Draw files.');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const getFileExtension = (filename) => {
  return filename.slice((filename.lastIndexOf('.') - 1 >>> 0) + 2);
};

export const isImageFile = (file) => {
  return file.type.startsWith('image/');
};

export const isSVGFile = (file) => {
  return file.type === 'image/svg+xml';
};

export const isPDFFile = (file) => {
  return file.type === 'application/pdf';
};

// Print production validation
export const validateForPrint = (canvas) => {
  const warnings = [];
  const errors = [];

  // Check resolution (minimum 300 DPI equivalent)
  const minWidth = 1200; // pixels for 4 inch at 300 DPI
  const minHeight = 1200;

  if (canvas.width < minWidth || canvas.height < minHeight) {
    warnings.push('Low resolution detected. For best print quality, use images at least 1200x1200 pixels.');
  }

  // Check for text objects that might be too small
  const objects = canvas.getObjects();
  objects.forEach((obj, index) => {
    if (obj.type === 'text' || obj.type === 'i-text') {
      const fontSize = obj.fontSize * (obj.scaleY || 1);
      if (fontSize < 8) {
        warnings.push(`Text object ${index + 1} may be too small for printing (${fontSize.toFixed(1)}pt). Minimum recommended: 8pt.`);
      }
    }
  });

  // Check for objects outside print area
  const printAreaGuide = objects.find(obj => obj.id === 'print-area-guide');
  if (printAreaGuide) {
    objects.forEach((obj, index) => {
      if (obj.id !== 'print-area-guide' && obj.id !== 'watermark') {
        const objBounds = obj.getBoundingRect();
        const guideBounds = printAreaGuide.getBoundingRect();

        if (objBounds.left < guideBounds.left ||
            objBounds.top < guideBounds.top ||
            objBounds.left + objBounds.width > guideBounds.left + guideBounds.width ||
            objBounds.top + objBounds.height > guideBounds.top + guideBounds.height) {
          warnings.push(`Object ${index + 1} extends outside the print area and may be cropped.`);
        }
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};
