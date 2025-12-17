/**
 * Image Compression Utility
 *
 * Compress and resize images before upload to reduce storage and bandwidth
 */

/**
 * Compress an image file
 * CRITICAL: Preserves PNG transparency for proper color overlay system
 * @param {File} file - Image file to compress
 * @param {Object} options - Compression options
 * @param {number} options.maxWidth - Maximum width in pixels (default: 2000)
 * @param {number} options.maxHeight - Maximum height in pixels (default: 2000)
 * @param {number} options.quality - Quality 0-1 (default: 0.9 for JPEG, 1.0 for PNG)
 * @param {string} options.outputFormat - Output format 'image/jpeg' or 'image/png' (default: auto-detect from file)
 * @returns {Promise<File>} Compressed image file
 */
export async function compressImage(file, options = {}) {
  // Auto-detect format from file type - CRITICAL for preserving PNG transparency
  const isPNG = file.type === 'image/png';

  const {
    maxWidth = 2000,
    maxHeight = 2000,
    quality = isPNG ? 1.0 : 0.9, // PNG: full quality to preserve transparency, JPEG: 90%
    outputFormat = file.type // Preserve original format by default
  } = options;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        try {
          // Calculate new dimensions
          let width = img.width;
          let height = img.height;

          if (width > maxWidth || height > maxHeight) {
            const aspectRatio = width / height;

            if (width > height) {
              width = maxWidth;
              height = width / aspectRatio;
            } else {
              height = maxHeight;
              width = height * aspectRatio;
            }
          }

          console.log('[ImageCompression] Original size:', img.width, 'x', img.height);
          console.log('[ImageCompression] New size:', Math.round(width), 'x', Math.round(height));
          console.log('[ImageCompression] Format:', outputFormat, '(PNG transparency:', isPNG, ')');

          // Create canvas
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          // CRITICAL: Enable alpha channel to preserve PNG transparency
          const ctx = canvas.getContext('2d', { alpha: true });

          if (!ctx) {
            throw new Error('Failed to get canvas context');
          }

          // Draw resized image (transparency preserved if PNG)
          ctx.drawImage(img, 0, 0, width, height);

          // Convert to blob
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Failed to create blob'));
                return;
              }

              // Create File from Blob
              const compressedFile = new File([blob], file.name, {
                type: outputFormat,
                lastModified: Date.now()
              });

              const originalSizeKB = (file.size / 1024).toFixed(2);
              const compressedSizeKB = (compressedFile.size / 1024).toFixed(2);
              const savings = ((1 - compressedFile.size / file.size) * 100).toFixed(1);

              console.log('[ImageCompression] ✅ Compression complete:', {
                originalSize: `${originalSizeKB} KB`,
                compressedSize: `${compressedSizeKB} KB`,
                savings: `${savings}%`
              });

              resolve(compressedFile);
            },
            outputFormat,
            quality
          );
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };

      img.src = e.target.result;
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Check if an image needs compression
 * @param {File} file - Image file to check
 * @param {number} maxSizeKB - Maximum size in KB (default: 500)
 * @returns {boolean} True if file exceeds size limit
 */
export function needsCompression(file, maxSizeKB = 500) {
  const sizeKB = file.size / 1024;
  return sizeKB > maxSizeKB;
}

/**
 * Get image dimensions from file
 * @param {File} file - Image file
 * @returns {Promise<{width: number, height: number}>} Image dimensions
 */
export function getImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        resolve({
          width: img.width,
          height: img.height
        });
      };

      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };

      img.src = e.target.result;
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsDataURL(file);
  });
}

export default {
  compressImage,
  needsCompression,
  getImageDimensions
};
