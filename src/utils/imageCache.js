/**
 * Image Cache Utility
 *
 * Manages caching of generated colored product images in localStorage
 * to reduce processing time on repeat visits.
 */

const CACHE_PREFIX = 'pgifts_color_overlay_';
const CACHE_VERSION = 'v1';
const CACHE_EXPIRY_DAYS = 7;

/**
 * Generate a versioned cache key
 * @param {string} productId - Product template ID
 * @param {string} colorId - Apparel color ID
 * @param {string} view - View name
 * @returns {string} Cache key
 */
function getCacheKey(productId, colorId, view) {
  return `${CACHE_PREFIX}${CACHE_VERSION}_${productId}_${colorId}_${view}`;
}

/**
 * Generate a metadata key for cache entry
 * @param {string} cacheKey - Cache key
 * @returns {string} Metadata key
 */
function getMetadataKey(cacheKey) {
  return `${cacheKey}_meta`;
}

/**
 * Check if localStorage is available
 * @returns {boolean} True if localStorage is available
 */
function isLocalStorageAvailable() {
  try {
    const test = '__localStorage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get current timestamp in milliseconds
 * @returns {number} Current timestamp
 */
function getCurrentTimestamp() {
  return Date.now();
}

/**
 * Check if a cache entry is expired
 * @param {number} timestamp - Cache timestamp
 * @param {number} expiryDays - Expiry duration in days
 * @returns {boolean} True if expired
 */
function isExpired(timestamp, expiryDays = CACHE_EXPIRY_DAYS) {
  const expiryMs = expiryDays * 24 * 60 * 60 * 1000;
  return (getCurrentTimestamp() - timestamp) > expiryMs;
}

/**
 * Store a colored image in cache
 * @param {string} productId - Product template ID
 * @param {string} colorId - Apparel color ID
 * @param {string} view - View name
 * @param {string} dataUrl - Image as data URL
 * @returns {boolean} True if successfully cached
 */
export function cacheColoredImage(productId, colorId, view, dataUrl) {
  if (!isLocalStorageAvailable()) {
    console.warn('[ImageCache] localStorage not available');
    return false;
  }

  try {
    const cacheKey = getCacheKey(productId, colorId, view);
    const metadataKey = getMetadataKey(cacheKey);

    // Store image data
    localStorage.setItem(cacheKey, dataUrl);

    // Store metadata
    const metadata = {
      productId,
      colorId,
      view,
      timestamp: getCurrentTimestamp(),
      size: dataUrl.length
    };
    localStorage.setItem(metadataKey, JSON.stringify(metadata));

    console.log('[ImageCache] ✅ Cached image:', {
      cacheKey,
      size: `${(dataUrl.length / 1024).toFixed(2)} KB`,
      expiresIn: `${CACHE_EXPIRY_DAYS} days`
    });

    return true;
  } catch (error) {
    // Handle quota exceeded error
    if (error.name === 'QuotaExceededError') {
      console.warn('[ImageCache] Storage quota exceeded, clearing old entries');
      clearOldestEntries(5);
      // Try again after clearing
      try {
        const cacheKey = getCacheKey(productId, colorId, view);
        localStorage.setItem(cacheKey, dataUrl);
        return true;
      } catch (retryError) {
        console.error('[ImageCache] Failed to cache after clearing:', retryError);
        return false;
      }
    }
    console.error('[ImageCache] Error caching image:', error);
    return false;
  }
}

/**
 * Retrieve a colored image from cache
 * @param {string} productId - Product template ID
 * @param {string} colorId - Apparel color ID
 * @param {string} view - View name
 * @returns {string|null} Cached data URL or null if not found/expired
 */
export function getCachedImage(productId, colorId, view) {
  if (!isLocalStorageAvailable()) {
    return null;
  }

  try {
    const cacheKey = getCacheKey(productId, colorId, view);
    const metadataKey = getMetadataKey(cacheKey);

    // Check if entry exists
    const dataUrl = localStorage.getItem(cacheKey);
    const metadataStr = localStorage.getItem(metadataKey);

    if (!dataUrl || !metadataStr) {
      console.log('[ImageCache] Cache miss:', cacheKey);
      return null;
    }

    // Parse metadata
    const metadata = JSON.parse(metadataStr);

    // Check if expired
    if (isExpired(metadata.timestamp)) {
      console.log('[ImageCache] Cache expired:', cacheKey);
      // Remove expired entry
      localStorage.removeItem(cacheKey);
      localStorage.removeItem(metadataKey);
      return null;
    }

    console.log('[ImageCache] ✅ Cache hit:', {
      cacheKey,
      age: `${Math.floor((getCurrentTimestamp() - metadata.timestamp) / (1000 * 60 * 60))}h`,
      size: `${(dataUrl.length / 1024).toFixed(2)} KB`
    });

    return dataUrl;
  } catch (error) {
    console.error('[ImageCache] Error retrieving cached image:', error);
    return null;
  }
}

/**
 * Clear a specific cached image
 * @param {string} productId - Product template ID
 * @param {string} colorId - Apparel color ID
 * @param {string} view - View name
 * @returns {boolean} True if successfully cleared
 */
export function clearCachedImage(productId, colorId, view) {
  if (!isLocalStorageAvailable()) {
    return false;
  }

  try {
    const cacheKey = getCacheKey(productId, colorId, view);
    const metadataKey = getMetadataKey(cacheKey);

    localStorage.removeItem(cacheKey);
    localStorage.removeItem(metadataKey);

    console.log('[ImageCache] Cleared cache entry:', cacheKey);
    return true;
  } catch (error) {
    console.error('[ImageCache] Error clearing cached image:', error);
    return false;
  }
}

/**
 * Clear all cached colored images
 * @returns {number} Number of entries cleared
 */
export function clearAllCachedImages() {
  if (!isLocalStorageAvailable()) {
    return 0;
  }

  try {
    let count = 0;
    const keys = Object.keys(localStorage);

    for (const key of keys) {
      if (key.startsWith(CACHE_PREFIX)) {
        localStorage.removeItem(key);
        count++;
      }
    }

    console.log('[ImageCache] Cleared all cache entries:', count);
    return count;
  } catch (error) {
    console.error('[ImageCache] Error clearing all cached images:', error);
    return 0;
  }
}

/**
 * Clear expired cache entries
 * @returns {number} Number of entries cleared
 */
export function clearExpiredEntries() {
  if (!isLocalStorageAvailable()) {
    return 0;
  }

  try {
    let count = 0;
    const keys = Object.keys(localStorage);

    for (const key of keys) {
      if (key.startsWith(CACHE_PREFIX) && key.endsWith('_meta')) {
        const metadataStr = localStorage.getItem(key);
        if (metadataStr) {
          const metadata = JSON.parse(metadataStr);
          if (isExpired(metadata.timestamp)) {
            // Remove both metadata and data
            const dataKey = key.replace('_meta', '');
            localStorage.removeItem(dataKey);
            localStorage.removeItem(key);
            count++;
          }
        }
      }
    }

    if (count > 0) {
      console.log('[ImageCache] Cleared expired entries:', count);
    }
    return count;
  } catch (error) {
    console.error('[ImageCache] Error clearing expired entries:', error);
    return 0;
  }
}

/**
 * Clear the oldest N cache entries
 * @param {number} count - Number of entries to clear
 * @returns {number} Number of entries cleared
 */
export function clearOldestEntries(count = 5) {
  if (!isLocalStorageAvailable()) {
    return 0;
  }

  try {
    const entries = [];
    const keys = Object.keys(localStorage);

    // Collect all cache entries with metadata
    for (const key of keys) {
      if (key.startsWith(CACHE_PREFIX) && key.endsWith('_meta')) {
        const metadataStr = localStorage.getItem(key);
        if (metadataStr) {
          const metadata = JSON.parse(metadataStr);
          entries.push({
            metaKey: key,
            dataKey: key.replace('_meta', ''),
            timestamp: metadata.timestamp
          });
        }
      }
    }

    // Sort by timestamp (oldest first)
    entries.sort((a, b) => a.timestamp - b.timestamp);

    // Remove oldest entries
    const toRemove = entries.slice(0, Math.min(count, entries.length));
    for (const entry of toRemove) {
      localStorage.removeItem(entry.dataKey);
      localStorage.removeItem(entry.metaKey);
    }

    console.log('[ImageCache] Cleared oldest entries:', toRemove.length);
    return toRemove.length;
  } catch (error) {
    console.error('[ImageCache] Error clearing oldest entries:', error);
    return 0;
  }
}

/**
 * Get cache statistics
 * @returns {Object} Cache statistics
 */
export function getCacheStats() {
  if (!isLocalStorageAvailable()) {
    return {
      available: false,
      totalEntries: 0,
      totalSize: 0,
      oldestEntry: null,
      newestEntry: null
    };
  }

  try {
    let totalEntries = 0;
    let totalSize = 0;
    let oldestTimestamp = Infinity;
    let newestTimestamp = 0;

    const keys = Object.keys(localStorage);

    for (const key of keys) {
      if (key.startsWith(CACHE_PREFIX) && !key.endsWith('_meta')) {
        totalEntries++;
        const data = localStorage.getItem(key);
        if (data) {
          totalSize += data.length;
        }

        // Get timestamp from metadata
        const metadataStr = localStorage.getItem(`${key}_meta`);
        if (metadataStr) {
          const metadata = JSON.parse(metadataStr);
          oldestTimestamp = Math.min(oldestTimestamp, metadata.timestamp);
          newestTimestamp = Math.max(newestTimestamp, metadata.timestamp);
        }
      }
    }

    return {
      available: true,
      totalEntries,
      totalSize,
      totalSizeKB: (totalSize / 1024).toFixed(2),
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      oldestEntry: oldestTimestamp === Infinity ? null : new Date(oldestTimestamp),
      newestEntry: newestTimestamp === 0 ? null : new Date(newestTimestamp),
      expiryDays: CACHE_EXPIRY_DAYS
    };
  } catch (error) {
    console.error('[ImageCache] Error getting cache stats:', error);
    return {
      available: false,
      totalEntries: 0,
      totalSize: 0,
      error: error.message
    };
  }
}

// Auto-clear expired entries on module load
if (typeof window !== 'undefined') {
  // Run on load
  setTimeout(() => {
    clearExpiredEntries();
  }, 1000);
}

export default {
  cacheColoredImage,
  getCachedImage,
  clearCachedImage,
  clearAllCachedImages,
  clearExpiredEntries,
  clearOldestEntries,
  getCacheStats
};
