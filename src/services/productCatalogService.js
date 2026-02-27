/**
 * Product Catalog Service
 *
 * This service provides all CRUD operations for the Product Catalog system.
 * It handles:
 * - Product catalog management with draft/active/archived workflow
 * - Category management
 * - Volume-based pricing calculations
 * - Product colors and image management (with size variants)
 * - Product features and specifications
 * - Integration with Designer system for customizable products
 * - Status-based access control (public sees only 'active', admins see all)
 */

import { isMockAuth } from '../config/supabase';
import { getSupabaseClient as getSharedClient } from './supabaseService';

/**
 * Get or initialize Supabase client (uses shared singleton from supabaseService)
 */
export const getSupabaseClient = () => {
  if (isMockAuth) {
    return null;
  }
  return getSharedClient();
};

/**
 * Check if current user is admin
 * @returns {Promise<boolean>} True if user is admin
 */
export const isCurrentUserAdmin = async () => {
  if (isMockAuth) {
    return true;
  }

  try {
    const client = getSupabaseClient();
    const { data: { user } } = await client.auth.getUser();

    if (!user) return false;

    return user.user_metadata?.is_admin === true ||
           user.raw_user_meta_data?.is_admin === true;
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
};

/**
 * Get Supabase storage URL for catalog images
 * @returns {string} Base URL for catalog images
 */
export const getCatalogImageBaseUrl = () => {
  if (isMockAuth) {
    return '/mock-storage/catalog-images';
  }
  return `${supabaseConfig.url}/storage/v1/object/public/catalog-images`;
};

// =====================================================
// PRODUCTS OPERATIONS
// =====================================================

/**
 * Get catalog products with optional filters
 * @param {Object} filters - Filter options
 * @param {string} filters.category - Category slug to filter by
 * @param {boolean} filters.featured - Filter for featured products only
 * @param {string} filters.status - Status filter ('draft'|'active'|'archived') - admin only
 * @param {string} filters.search - Search term for product name/description
 * @param {boolean} filters.customizable - Filter for customizable products only
 * @returns {Promise<Array>} Array of catalog products
 */
export const getCatalogProducts = async (filters = {}) => {
  if (isMockAuth) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    const isAdmin = await isCurrentUserAdmin();

    let query = client
      .from('catalog_products')
      .select(`
        *,
        category:catalog_categories(id, name, slug, icon),
        images:catalog_product_images(
          id, image_url, thumbnail_url, medium_url, large_url,
          alt_text, is_primary, sort_order
        )
      `)
      .order('created_at', { ascending: false });

    // Status filtering: public only sees active, admins can specify
    if (!isAdmin) {
      query = query.eq('status', 'active');
    } else if (filters.status) {
      query = query.eq('status', filters.status);
    }

    // Category filter
    if (filters.category) {
      const { data: category } = await client
        .from('catalog_categories')
        .select('id')
        .eq('slug', filters.category)
        .single();

      if (category) {
        query = query.eq('category_id', category.id);
      }
    }

    // Featured filter
    if (filters.featured) {
      query = query.eq('is_featured', true);
    }

    // Customizable filter
    if (filters.customizable) {
      query = query.eq('is_customizable', true).not('designer_product_id', 'is', null);
    }

    // Search filter
    if (filters.search) {
      query = query.or(`name.ilike.%${filters.search}%,description.ilike.%${filters.search}%`);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching catalog products:', error);
    throw error;
  }
};

/**
 * Get a single catalog product by slug with ALL related data
 * @param {string} slug - Product slug
 * @returns {Promise<Object|null>} Complete product with all relations, or null if not found
 */
export const getCatalogProductBySlug = async (slug) => {
  if (isMockAuth) {
    return null;
  }

  try {
    const client = getSupabaseClient();
    const isAdmin = await isCurrentUserAdmin();

    let query = client
      .from('catalog_products')
      .select(`
        *,
        category:catalog_categories(
          id, name, slug, icon, description
        ),
        colors:catalog_product_colors(
          id, color_code, color_name, hex_value,
          swatch_image_url, sort_order, is_active
        ),
        images:catalog_product_images(
          id, color_id, image_url, thumbnail_url, medium_url, large_url,
          alt_text, image_type, sort_order, is_primary
        ),
        pricing:catalog_pricing_tiers(
          id, min_quantity, max_quantity, price_per_unit,
          is_popular, effective_from, effective_to
        ),
        features:catalog_product_features(
          id, feature_text, icon, sort_order
        ),
        specifications:catalog_product_specifications(
          id, specifications
        ),
        designer_product:product_templates(
          id, product_key, name, base_price
        )
      `)
      .eq('slug', slug);

    // Status filtering
    if (!isAdmin) {
      query = query.eq('status', 'active');
    }

    const { data, error } = await query.single();

    if (error) {
      // If no rows found, return null
      if (error.code === 'PGRST116' || error.message.includes('no rows')) {
        return null;
      }
      throw error;
    }

    // Filter active colors for non-admin users
    if (!isAdmin && data?.colors) {
      data.colors = data.colors.filter(color => color.is_active);
    }

    // Sort data
    if (data?.colors) {
      data.colors.sort((a, b) => a.sort_order - b.sort_order);
    }
    if (data?.images) {
      data.images.sort((a, b) => a.sort_order - b.sort_order);
    }
    if (data?.pricing) {
      data.pricing.sort((a, b) => a.min_quantity - b.min_quantity);
    }
    if (data?.features) {
      data.features.sort((a, b) => a.sort_order - b.sort_order);
    }

    return data;
  } catch (error) {
    console.error('Error fetching catalog product by slug:', error);
    throw error;
  }
};

/**
 * Get catalog products by category
 * @param {string} categorySlug - Category slug
 * @returns {Promise<Array>} Array of products in category
 */
export const getCatalogProductsByCategory = async (categorySlug) => {
  return getCatalogProducts({ category: categorySlug });
};

/**
 * Create a new catalog product (Admin only)
 * @param {Object} productData - Product data
 * @returns {Promise<Object>} Created product
 */
export const createCatalogProduct = async (productData) => {
  if (isMockAuth) {
    console.log('Mock mode: Would create catalog product:', productData);
    return { id: 'mock-id', ...productData };
  }

  try {
    const client = getSupabaseClient();
    const isAdmin = await isCurrentUserAdmin();

    if (!isAdmin) {
      throw new Error('Unauthorized: Admin access required');
    }

    const { data, error } = await client
      .from('catalog_products')
      .insert({
        category_id: productData.category_id,
        name: productData.name,
        slug: productData.slug,
        subtitle: productData.subtitle,
        description: productData.description,
        rating: productData.rating || 0,
        review_count: productData.review_count || 0,
        badge: productData.badge,
        is_featured: productData.is_featured || false,
        is_customizable: productData.is_customizable || false,
        status: productData.status || 'draft',
        min_order_quantity: productData.min_order_quantity || 25,
        designer_product_id: productData.designer_product_id,
        meta_title: productData.meta_title,
        meta_description: productData.meta_description
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating catalog product:', error);
    throw error;
  }
};

/**
 * Update a catalog product (Admin only)
 * @param {string} id - Product ID
 * @param {Object} productData - Fields to update
 * @returns {Promise<Object>} Updated product
 */
export const updateCatalogProduct = async (id, productData) => {
  if (isMockAuth) {
    console.log('Mock mode: Would update catalog product:', id, productData);
    return { id, ...productData };
  }

  try {
    const client = getSupabaseClient();
    const isAdmin = await isCurrentUserAdmin();

    if (!isAdmin) {
      throw new Error('Unauthorized: Admin access required');
    }

    const updateData = {};

    // Only include provided fields
    if (productData.category_id !== undefined) updateData.category_id = productData.category_id;
    if (productData.name !== undefined) updateData.name = productData.name;
    if (productData.slug !== undefined) updateData.slug = productData.slug;
    if (productData.subtitle !== undefined) updateData.subtitle = productData.subtitle;
    if (productData.description !== undefined) updateData.description = productData.description;
    if (productData.rating !== undefined) updateData.rating = productData.rating;
    if (productData.review_count !== undefined) updateData.review_count = productData.review_count;
    if (productData.badge !== undefined) updateData.badge = productData.badge;
    if (productData.is_featured !== undefined) updateData.is_featured = productData.is_featured;
    if (productData.is_customizable !== undefined) updateData.is_customizable = productData.is_customizable;
    if (productData.status !== undefined) updateData.status = productData.status;
    if (productData.min_order_quantity !== undefined) updateData.min_order_quantity = productData.min_order_quantity;
    if (productData.designer_product_id !== undefined) updateData.designer_product_id = productData.designer_product_id;
    if (productData.meta_title !== undefined) updateData.meta_title = productData.meta_title;
    if (productData.meta_description !== undefined) updateData.meta_description = productData.meta_description;

    const { data, error } = await client
      .from('catalog_products')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating catalog product:', error);
    throw error;
  }
};

/**
 * Delete (archive) a catalog product (Admin only)
 * Sets status to 'archived' instead of hard delete
 * @param {string} id - Product ID
 * @returns {Promise<Object>} Archived product
 */
export const deleteCatalogProduct = async (id) => {
  if (isMockAuth) {
    console.log('Mock mode: Would archive catalog product:', id);
    return { id, status: 'archived' };
  }

  try {
    const client = getSupabaseClient();
    const isAdmin = await isCurrentUserAdmin();

    if (!isAdmin) {
      throw new Error('Unauthorized: Admin access required');
    }

    const { data, error } = await client
      .from('catalog_products')
      .update({ status: 'archived' })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error archiving catalog product:', error);
    throw error;
  }
};

/**
 * Publish a catalog product (Admin only)
 * Changes status from 'draft' to 'active', sets published_at timestamp automatically via trigger
 * @param {string} id - Product ID
 * @returns {Promise<Object>} Published product
 */
export const publishCatalogProduct = async (id) => {
  if (isMockAuth) {
    console.log('Mock mode: Would publish catalog product:', id);
    return { id, status: 'active', published_at: new Date().toISOString() };
  }

  try {
    const client = getSupabaseClient();
    const isAdmin = await isCurrentUserAdmin();

    if (!isAdmin) {
      throw new Error('Unauthorized: Admin access required');
    }

    const { data, error } = await client
      .from('catalog_products')
      .update({ status: 'active' })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error publishing catalog product:', error);
    throw error;
  }
};

/**
 * Archive a catalog product (Admin only)
 * Changes status to 'archived', preserves data
 * @param {string} id - Product ID
 * @returns {Promise<Object>} Archived product
 */
export const archiveCatalogProduct = async (id) => {
  return deleteCatalogProduct(id); // Same as delete (soft delete)
};

// =====================================================
// CATEGORIES OPERATIONS
// =====================================================

/**
 * Get all active catalog categories
 * @returns {Promise<Array>} Array of active categories
 */
export const getCatalogCategories = async () => {
  if (isMockAuth) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('catalog_categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching catalog categories:', error);
    throw error;
  }
};

/**
 * Get a catalog category by slug with products
 * @param {string} slug - Category slug
 * @returns {Promise<Object|null>} Category with products, or null if not found
 */
export const getCatalogCategoryBySlug = async (slug) => {
  if (isMockAuth) {
    return null;
  }

  try {
    const client = getSupabaseClient();
    const isAdmin = await isCurrentUserAdmin();

    // Get category
    const { data: category, error: categoryError } = await client
      .from('catalog_categories')
      .select('*')
      .eq('slug', slug)
      .single();

    if (categoryError) {
      if (categoryError.code === 'PGRST116' || categoryError.message.includes('no rows')) {
        return null;
      }
      throw categoryError;
    }

    // Get products in this category
    let productsQuery = client
      .from('catalog_products')
      .select(`
        *,
        images:catalog_product_images(
          id, image_url, thumbnail_url, medium_url, large_url,
          alt_text, is_primary, sort_order
        )
      `)
      .eq('category_id', category.id);

    // Status filtering
    if (!isAdmin) {
      productsQuery = productsQuery.eq('status', 'active');
    }

    const { data: products, error: productsError } = await productsQuery;

    if (productsError) throw productsError;

    return {
      ...category,
      products: products || []
    };
  } catch (error) {
    console.error('Error fetching catalog category by slug:', error);
    throw error;
  }
};

// =====================================================
// PRICING OPERATIONS
// =====================================================

/**
 * Get current pricing tiers for a product
 * @param {string} productId - Product ID
 * @returns {Promise<Array>} Array of pricing tiers
 */
export const getProductPricingTiers = async (productId) => {
  if (isMockAuth) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    const now = new Date().toISOString();

    const { data, error } = await client
      .from('catalog_pricing_tiers')
      .select('*')
      .eq('catalog_product_id', productId)
      .lte('effective_from', now)
      .or(`effective_to.is.null,effective_to.gt.${now}`)
      .order('min_quantity', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching product pricing tiers:', error);
    throw error;
  }
};

/**
 * Calculate price for a specific quantity
 * @param {string} productId - Product ID
 * @param {number} quantity - Order quantity
 * @returns {Promise<Object|null>} Tier info with price, or null if no tier found
 */
export const calculatePriceForQuantity = async (productId, quantity) => {
  if (isMockAuth) {
    return { price_per_unit: 10.00, quantity, total: quantity * 10.00 };
  }

  try {
    const tiers = await getProductPricingTiers(productId);

    if (!tiers || tiers.length === 0) {
      return null;
    }

    // Find matching tier
    const matchingTier = tiers.find(tier => {
      const meetsMin = quantity >= tier.min_quantity;
      const meetsMax = tier.max_quantity === null || quantity <= tier.max_quantity;
      return meetsMin && meetsMax;
    });

    if (!matchingTier) {
      // Use highest tier if quantity exceeds all tiers
      const highestTier = tiers[tiers.length - 1];
      return {
        ...highestTier,
        quantity,
        total: parseFloat(highestTier.price_per_unit) * quantity
      };
    }

    return {
      ...matchingTier,
      quantity,
      total: parseFloat(matchingTier.price_per_unit) * quantity
    };
  } catch (error) {
    console.error('Error calculating price for quantity:', error);
    throw error;
  }
};

// =====================================================
// COLORS & IMAGES OPERATIONS
// =====================================================

/**
 * Get available colors for a product
 * @param {string} productId - Product ID
 * @returns {Promise<Array>} Array of colors
 */
export const getProductColors = async (productId) => {
  if (isMockAuth) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    const isAdmin = await isCurrentUserAdmin();

    let query = client
      .from('catalog_product_colors')
      .select('*')
      .eq('catalog_product_id', productId)
      .order('sort_order', { ascending: true });

    // Non-admin users only see active colors
    if (!isAdmin) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching product colors:', error);
    throw error;
  }
};

/**
 * Get images for a product/color combination (all size variants)
 * @param {string} productId - Product ID
 * @param {string} colorId - Optional color ID to filter images
 * @returns {Promise<Array>} Array of images with size variants
 */
export const getProductImages = async (productId, colorId = null) => {
  if (isMockAuth) {
    return [];
  }

  try {
    const client = getSupabaseClient();

    let query = client
      .from('catalog_product_images')
      .select('*')
      .eq('catalog_product_id', productId)
      .order('sort_order', { ascending: true });

    if (colorId) {
      query = query.eq('color_id', colorId);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching product images:', error);
    throw error;
  }
};

/**
 * Upload a product image to catalog-images bucket (Admin only)
 * Note: This uploads the original image only. Size variants should be generated
 * by a separate image processing service or manually uploaded.
 *
 * @param {File} file - Image file to upload
 * @param {string} productSlug - Product slug for folder organization
 * @param {string} imageType - Image type ('main'|'gallery'|'lifestyle'|'detail')
 * @param {string} colorId - Optional color ID this image belongs to
 * @returns {Promise<Object>} Object with URLs for all sizes (original only, others null)
 */
export const uploadProductImage = async (file, productSlug, imageType = 'gallery', colorId = null) => {
  if (isMockAuth) {
    console.log('Mock mode: Would upload product image:', file.name);
    return {
      original: `/mock-storage/catalog-images/products/${productSlug}/original/${file.name}`,
      thumbnail: null,
      medium: null,
      large: null
    };
  }

  try {
    const client = getSupabaseClient();
    const isAdmin = await isCurrentUserAdmin();

    if (!isAdmin) {
      throw new Error('Unauthorized: Admin access required');
    }

    // Generate unique filename
    const timestamp = Date.now();
    const fileExt = file.name.split('.').pop();
    const fileName = `${imageType}_${timestamp}.${fileExt}`;

    // Upload to products/{slug}/original/ folder
    const filePath = `products/${productSlug}/original/${fileName}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await client.storage
      .from('catalog-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: { publicUrl } } = client.storage
      .from('catalog-images')
      .getPublicUrl(filePath);

    // Return URLs (size variants should be generated separately)
    return {
      original: publicUrl,
      thumbnail: null,  // To be generated by image processing service
      medium: null,     // To be generated by image processing service
      large: null       // To be generated by image processing service
    };
  } catch (error) {
    console.error('Error uploading product image:', error);
    throw error;
  }
};

/**
 * Delete a product image from storage (Admin only)
 * @param {string} imageUrl - URL of image to delete
 * @returns {Promise<void>}
 */
export const deleteProductImage = async (imageUrl) => {
  if (isMockAuth) {
    console.log('Mock mode: Would delete product image:', imageUrl);
    return;
  }

  try {
    const client = getSupabaseClient();
    const isAdmin = await isCurrentUserAdmin();

    if (!isAdmin) {
      throw new Error('Unauthorized: Admin access required');
    }

    // Extract file path from URL
    const urlParts = imageUrl.split('/catalog-images/');
    if (urlParts.length < 2) {
      throw new Error('Invalid catalog image URL');
    }

    const filePath = urlParts[1];

    const { error } = await client.storage
      .from('catalog-images')
      .remove([filePath]);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting product image:', error);
    throw error;
  }
};

// =====================================================
// FEATURES & SPECIFICATIONS OPERATIONS
// =====================================================

/**
 * Get product features
 * @param {string} productId - Product ID
 * @returns {Promise<Array>} Array of features
 */
export const getProductFeatures = async (productId) => {
  if (isMockAuth) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('catalog_product_features')
      .select('*')
      .eq('catalog_product_id', productId)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching product features:', error);
    throw error;
  }
};

/**
 * Get product specifications (JSONB)
 * @param {string} productId - Product ID
 * @returns {Promise<Object|null>} Specifications object or null
 */
export const getProductSpecifications = async (productId) => {
  if (isMockAuth) {
    return null;
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('catalog_product_specifications')
      .select('specifications')
      .eq('catalog_product_id', productId)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || error.message.includes('no rows')) {
        return null;
      }
      throw error;
    }

    return data?.specifications || null;
  } catch (error) {
    console.error('Error fetching product specifications:', error);
    throw error;
  }
};

// =====================================================
// DESIGNER INTEGRATION OPERATIONS
// =====================================================

/**
 * Check if a product is customizable
 * @param {Object} product - Product object
 * @returns {boolean} True if product can be customized in Designer
 */
export const checkProductCustomizable = (product) => {
  if (!product) return false;
  return product.is_customizable === true && product.designer_product_id !== null;
};

/**
 * Get linked designer product for a catalog product
 * @param {string} catalogProductId - Catalog product ID
 * @returns {Promise<Object|null>} Designer product or null
 */
export const getDesignerProductForCatalogProduct = async (catalogProductId) => {
  if (isMockAuth) {
    return null;
  }

  try {
    const client = getSupabaseClient();

    // Get catalog product with designer product link
    const { data: catalogProduct, error: catalogError } = await client
      .from('catalog_products')
      .select(`
        designer_product_id,
        designer_product:product_templates(
          id,
          product_key,
          name,
          base_price,
          colors,
          variants:product_template_variants(
            id,
            color_name,
            color_code,
            view_name,
            template_url
          )
        )
      `)
      .eq('id', catalogProductId)
      .single();

    if (catalogError) {
      if (catalogError.code === 'PGRST116' || catalogError.message.includes('no rows')) {
        return null;
      }
      throw catalogError;
    }

    return catalogProduct?.designer_product || null;
  } catch (error) {
    console.error('Error fetching designer product for catalog product:', error);
    throw error;
  }
};

/**
 * Get designer product key for a catalog product (for URL linking)
 * @param {string} catalogProductId - Catalog product ID
 * @returns {Promise<string|null>} Designer product_key or null
 */
export const getDesignerProductKey = async (catalogProductId) => {
  if (isMockAuth) {
    return null;
  }

  try {
    const designerProduct = await getDesignerProductForCatalogProduct(catalogProductId);
    return designerProduct?.product_key || null;
  } catch (error) {
    console.error('Error fetching designer product key:', error);
    throw error;
  }
};

/**
 * Get catalog product URL for Designer integration
 * Helper function to construct the Designer URL with product parameter
 * @param {string} productKey - Designer product_key
 * @param {string} color - Optional color code
 * @param {string} view - Optional view name
 * @returns {string} Designer URL with query parameters
 */
export const getDesignerUrl = (productKey, color = null, view = null) => {
  let url = `/designer?product=${productKey}`;
  if (color) url += `&color=${color}`;
  if (view) url += `&view=${view}`;
  return url;
};

/**
 * Get print pricing data for a product
 * Used by ProductDetailPage to show position/colour/coverage selectors and calculate print costs.
 * @param {string} productId - Catalog product UUID
 * @returns {Promise<Array>} Array of print pricing rows
 */
export const getProductPrintPricing = async (productId) => {
  if (isMockAuth) return [];

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('catalog_print_pricing')
      .select('*')
      .eq('catalog_product_id', productId);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching print pricing:', error);
    return [];
  }
};

// =====================================================
// EXPORT ALL FUNCTIONS
// =====================================================

export default {
  // Client & Admin
  getSupabaseClient,
  isCurrentUserAdmin,
  getCatalogImageBaseUrl,

  // Products
  getCatalogProducts,
  getCatalogProductBySlug,
  getCatalogProductsByCategory,
  createCatalogProduct,
  updateCatalogProduct,
  deleteCatalogProduct,
  publishCatalogProduct,
  archiveCatalogProduct,

  // Categories
  getCatalogCategories,
  getCatalogCategoryBySlug,

  // Pricing
  getProductPricingTiers,
  calculatePriceForQuantity,
  getProductPrintPricing,

  // Colors & Images
  getProductColors,
  getProductImages,
  uploadProductImage,
  deleteProductImage,

  // Features & Specifications
  getProductFeatures,
  getProductSpecifications,

  // Designer Integration
  checkProductCustomizable,
  getDesignerProductForCatalogProduct,
  getDesignerProductKey,
  getDesignerUrl
};
