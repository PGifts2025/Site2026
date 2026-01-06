/**
 * Supabase Service
 * 
 * This service provides all CRUD operations for the Print Area Configuration system.
 * It handles:
 * - Product template management
 * - Print area configuration
 * - Template image uploads to Supabase Storage
 * - Admin authentication checks
 */

import { createClient } from '@supabase/supabase-js';
import { supabaseConfig, isMockAuth } from '../config/supabase';

// Initialize Supabase client - singleton pattern
let supabaseClient = null;

/**
 * Get or initialize Supabase client (singleton)
 * This ensures only ONE client instance exists across the entire app
 */
export function getSupabaseClient() {
  // Return existing client if already created
  if (supabaseClient) {
    console.log('[getSupabaseClient] ♻️ Reusing existing client');
    return supabaseClient;
  }

  console.log('[getSupabaseClient] 🔧 Creating new client...');

  if (isMockAuth) {
    console.log('[getSupabaseClient] 🚫 Mock auth mode - returning null');
    return null;
  }

  const url = supabaseConfig.url || import.meta.env.VITE_SUPABASE_URL;
  const key = supabaseConfig.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase credentials: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY required');
  }

  console.log('[getSupabaseClient] URL:', url);
  console.log('[getSupabaseClient] Key length:', key.length);

  supabaseClient = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  console.log('[getSupabaseClient] ✅ Client created successfully');
  console.log('[getSupabaseClient] Client type:', typeof supabaseClient);
  console.log('[getSupabaseClient] Client has from():', typeof supabaseClient?.from === 'function');

  return supabaseClient;
}

// Initialize client immediately at module load for auth purposes
// This ensures AuthProvider and other components get the same instance
const supabase = isMockAuth ? null : getSupabaseClient();

// Export the singleton instance for direct use in auth contexts
export { supabase };

/**
 * Check if user is admin
 * @param {string} userId - User ID to check
 * @returns {Promise<boolean>} True if user is admin
 */
export const isUserAdmin = async (userId) => {
  if (isMockAuth) {
    // In mock mode, return true for testing
    return true;
  }

  if (!userId) return false;

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('auth.users')
      .select('raw_user_meta_data')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error checking admin status:', error);
      return false;
    }

    return data?.raw_user_meta_data?.is_admin === true;
  } catch (error) {
    console.error('Error in isUserAdmin:', error);
    return false;
  }
};

/**
 * Get current user's admin status
 * @returns {Promise<boolean>} True if current user is admin
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
    console.error('Error checking current user admin status:', error);
    return false;
  }
};

// =====================================================
// Product Template Operations
// =====================================================

// TEMPORARY TEST FUNCTION - bypasses RLS using service role
export async function testProductTemplatesWithServiceRole() {
  console.log('[TEST] Testing product_templates access with service role...');

  // Create a client with service role (bypasses RLS)
  const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    console.error('[TEST] No service role key found in .env');
    console.error('[TEST] Add VITE_SUPABASE_SERVICE_ROLE_KEY to .env file');
    return { data: null, error: new Error('No service role key') };
  }

  const testClient = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  console.log('[TEST] Service role client created');

  try {
    const result = await testClient
      .from('product_templates')
      .select('*');

    console.log('[TEST] ✅ Query completed!');
    console.log('[TEST] Result:', result);

    return result;

  } catch (err) {
    console.error('[TEST] ❌ Error:', err);
    return { data: null, error: err };
  }
}

/**
 * Get all product templates
 * @returns {Promise<Object>} Object with {data, error}
 */
export async function getProductTemplates() {
  console.log('[getProductTemplates] 🚀 Starting...');

  if (isMockAuth) {
    console.warn('[getProductTemplates] Mock auth mode - returning empty array');
    return { data: [], error: null };
  }

  const client = getSupabaseClient();
  console.log('[getProductTemplates] Client obtained');

  try {
    // Simplest possible query - no order, no nothing
    console.log('[getProductTemplates] About to query...');
    const { data, error } = await client.from('product_templates').select('*');
    console.log('[getProductTemplates] ✅ Query returned!', { data, error });

    return { data, error };
  } catch (err) {
    console.error('[getProductTemplates] Error:', err);
    return { data: null, error: err };
  }
}

/**
 * Get a single product template by product key
 * @param {string} productKey - Unique product key
 * @returns {Promise<Object|null>} Product template with print areas, or null if not found
 */
export const getProductTemplate = async (productKey) => {
  if (isMockAuth) {
    return null;
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('product_templates')
      .select(`
        *,
        print_areas (*)
      `)
      .eq('product_key', productKey)
      .single();

    if (error) {
      // If no rows found, return null instead of throwing
      if (error.code === 'PGRST116' || error.message.includes('no rows')) {
        console.log('[getProductTemplate] No template found for:', productKey);
        return null;
      }
      throw error;
    }
    return data;
  } catch (error) {
    console.error('Error fetching product template:', error);
    throw error;
  }
};

/**
 * Create a new product template
 * @param {Object} template - Product template data
 * @returns {Promise<Object>} Created template
 */
export const createProductTemplate = async (template) => {
  if (isMockAuth) {
    console.log('Mock mode: Would create product template:', template);
    return { id: 'mock-id', ...template };
  }

  try {
    const client = getSupabaseClient();
    const { data: { user } } = await client.auth.getUser();
    
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await client
      .from('product_templates')
      .insert({
        product_key: template.productKey,
        name: template.name,
        template_url: template.templateUrl,
        colors: template.colors || [],
        base_price: template.basePrice || 0,
        created_by: user.id
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating product template:', error);
    throw error;
  }
};

/**
 * Update a product template
 * @param {string} productKey - Product key to update
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated template
 */
export const updateProductTemplate = async (productKey, updates) => {
  if (isMockAuth) {
    console.log('Mock mode: Would update product template:', productKey, updates);
    return { product_key: productKey, ...updates };
  }

  try {
    const client = getSupabaseClient();
    
    // Use upsert to handle both insert and update cases
    const { data, error } = await client
      .from('product_templates')
      .upsert({
        product_key: productKey,
        name: updates.name,
        template_url: updates.templateUrl,
        colors: updates.colors,
        base_price: updates.basePrice,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'product_key',
        ignoreDuplicates: false
      })
      .select();

    if (error) throw error;
    
    // Return the first item if array is returned, otherwise return data
    return Array.isArray(data) && data.length > 0 ? data[0] : data;
  } catch (error) {
    console.error('Error updating product template:', error);
    throw error;
  }
};

/**
 * Delete a product template
 * @param {string} productKey - Product key to delete
 * @returns {Promise<void>}
 */
export const deleteProductTemplate = async (productKey) => {
  if (isMockAuth) {
    console.log('Mock mode: Would delete product template:', productKey);
    return;
  }

  try {
    const client = getSupabaseClient();
    const { error } = await client
      .from('product_templates')
      .delete()
      .eq('product_key', productKey);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting product template:', error);
    throw error;
  }
};

// =====================================================
// Print Area Operations
// =====================================================

/**
 * Get print areas for a product
 * @param {string} productTemplateId - Product template ID
 * @returns {Promise<Array>} Array of print areas
 */
export const getPrintAreas = async (productTemplateId) => {
  if (isMockAuth) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('print_areas')
      .select('*')
      .eq('product_template_id', productTemplateId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching print areas:', error);
    throw error;
  }
};

/**
 * Create a print area
 * @param {string} productTemplateId - Product template ID
 * @param {Object} printArea - Print area data
 * @returns {Promise<Object>} Created print area
 */
export const createPrintArea = async (productTemplateId, printArea) => {
  if (isMockAuth) {
    console.log('Mock mode: Would create print area:', printArea);
    return { id: 'mock-id', product_template_id: productTemplateId, ...printArea };
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('print_areas')
      .insert({
        product_template_id: productTemplateId,
        area_key: printArea.areaKey,
        name: printArea.name,
        x: printArea.x,
        y: printArea.y,
        width: printArea.width,
        height: printArea.height,
        max_width: printArea.maxWidth,
        max_height: printArea.maxHeight,
        shape: printArea.shape || 'rectangle'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating print area:', error);
    throw error;
  }
};

/**
 * Update a print area
 * @param {string} printAreaId - Print area ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated print area
 */
export const updatePrintArea = async (printAreaId, updates) => {
  if (isMockAuth) {
    console.log('Mock mode: Would update print area:', printAreaId, updates);
    return { id: printAreaId, ...updates };
  }

  try {
    const client = getSupabaseClient();
    const { data, error} = await client
      .from('print_areas')
      .update({
        name: updates.name,
        x: updates.x,
        y: updates.y,
        width: updates.width,
        height: updates.height,
        max_width: updates.maxWidth,
        max_height: updates.maxHeight,
        shape: updates.shape || 'rectangle'
      })
      .eq('id', printAreaId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating print area:', error);
    throw error;
  }
};

/**
 * Delete a print area
 * @param {string} printAreaId - Print area ID
 * @returns {Promise<void>}
 */
export const deletePrintArea = async (printAreaId) => {
  if (isMockAuth) {
    console.log('Mock mode: Would delete print area:', printAreaId);
    return;
  }

  try {
    const client = getSupabaseClient();
    const { error } = await client
      .from('print_areas')
      .delete()
      .eq('id', printAreaId);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting print area:', error);
    throw error;
  }
};

/**
 * Batch update print areas for a product
 * @param {string} productTemplateId - Product template ID
 * @param {Object} printAreasConfig - Print areas configuration (key-value pairs)
 * @returns {Promise<Array>} Updated print areas
 */
export const batchUpdatePrintAreas = async (productTemplateId, printAreasConfig) => {
  if (isMockAuth) {
    console.log('Mock mode: Would batch update print areas:', printAreasConfig);
    return Object.entries(printAreasConfig).map(([key, area]) => ({
      id: `mock-${key}`,
      product_template_id: productTemplateId,
      area_key: key,
      ...area
    }));
  }

  try {
    const client = getSupabaseClient();
    
    // Get existing print areas
    const { data: existingAreas, error: fetchError } = await client
      .from('print_areas')
      .select('*')
      .eq('product_template_id', productTemplateId);

    if (fetchError) throw fetchError;

    const existingAreasMap = new Map(
      (existingAreas || []).map(area => [area.area_key, area])
    );

    // Delete areas that are no longer in the config FIRST
    const configKeys = new Set(Object.keys(printAreasConfig));
    const areasToDelete = Array.from(existingAreasMap.values())
      .filter(area => !configKeys.has(area.area_key))
      .map(area => area.id);

    if (areasToDelete.length > 0) {
      console.log('[batchUpdatePrintAreas] Deleting print areas:', areasToDelete);
      const { error: deleteError } = await client
        .from('print_areas')
        .delete()
        .in('id', areasToDelete);
      
      if (deleteError) {
        console.error('[batchUpdatePrintAreas] Error deleting print areas:', deleteError);
        throw deleteError;
      }
    }

    // Now update/insert areas
    const operations = [];

    // Process each print area in the config
    for (const [areaKey, areaData] of Object.entries(printAreasConfig)) {
      const existingArea = existingAreasMap.get(areaKey);

      if (existingArea) {
        // Update existing area
        operations.push(
          client
            .from('print_areas')
            .update({
              name: areaData.name,
              x: areaData.x,
              y: areaData.y,
              width: areaData.width,
              height: areaData.height,
              max_width: areaData.maxWidth,
              max_height: areaData.maxHeight,
              shape: areaData.shape || 'rectangle'
            })
            .eq('id', existingArea.id)
            .select()
        );
      } else {
        // Create new area
        operations.push(
          client
            .from('print_areas')
            .insert({
              product_template_id: productTemplateId,
              area_key: areaKey,
              name: areaData.name,
              x: areaData.x,
              y: areaData.y,
              width: areaData.width,
              height: areaData.height,
              max_width: areaData.maxWidth,
              max_height: areaData.maxHeight,
              shape: areaData.shape || 'rectangle'
            })
            .select()
        );
      }
    }

    // Execute all update/insert operations
    if (operations.length > 0) {
      const results = await Promise.all(operations);
      
      // Check for errors
      const errors = results.filter(r => r.error);
      if (errors.length > 0) {
        console.error('[batchUpdatePrintAreas] Errors in operations:', errors);
        throw errors[0].error;
      }

      // Return all updated/created areas
      const updatedAreas = results
        .filter(r => r.data)
        .flatMap(r => Array.isArray(r.data) ? r.data : [r.data])
        .filter(area => area != null); // Filter out null values

      return updatedAreas;
    }

    return [];
  } catch (error) {
    console.error('Error batch updating print areas:', error);
    throw error;
  }
};

// =====================================================
// Product Template Variants Operations (Color + View Support)
// =====================================================

/**
 * Get all variants for a product template
 * @param {string} productTemplateId - Product template ID
 * @returns {Promise<Array>} Array of product variants
 */
export const getProductVariants = async (productTemplateId) => {
  if (isMockAuth) {
    return [];
  }

  try {
    const client = getSupabaseClient();

    console.log('[getProductVariants] Fetching variants for template:', productTemplateId);

    // Simplified query - no join to print_areas (will be fetched separately if needed)
    const { data, error } = await client
      .from('product_template_variants')
      .select('*')
      .eq('product_template_id', productTemplateId)
      .order('view_name', { ascending: true })
      .order('color_name', { ascending: true });

    if (error) {
      console.error('[getProductVariants] Error:', error);
      throw error;
    }

    console.log('[getProductVariants] Found', data?.length || 0, 'variants');

    return data || [];
  } catch (error) {
    console.error('[getProductVariants] Exception:', error);
    return [];
  }
};

/**
 * Get a specific variant by color and view
 * @param {string} productTemplateId - Product template ID
 * @param {string} colorCode - Color code (e.g., "#000000")
 * @param {string} viewName - View name (e.g., "front")
 * @returns {Promise<Object|null>} Variant or null if not found
 */
export const getProductVariant = async (productTemplateId, colorCode, viewName) => {
  if (isMockAuth) {
    return null;
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('product_template_variants')
      .select(`
        *,
        print_areas (*)
      `)
      .eq('product_template_id', productTemplateId)
      .eq('color_code', colorCode)
      .eq('view_name', viewName)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || error.message.includes('no rows')) {
        return null;
      }
      throw error;
    }
    return data;
  } catch (error) {
    console.error('Error fetching product variant:', error);
    throw error;
  }
};

/**
 * Create a product variant
 * @param {Object} variant - Variant data
 * @returns {Promise<Object>} Created variant
 */
export const createProductVariant = async (variant) => {
  if (isMockAuth) {
    console.log('Mock mode: Would create product variant:', variant);
    return { id: 'mock-variant-id', ...variant };
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('product_template_variants')
      .insert({
        product_template_id: variant.productTemplateId,
        color_name: variant.colorName,
        color_code: variant.colorCode,
        view_name: variant.viewName,
        template_url: variant.templateUrl
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating product variant:', error);
    throw error;
  }
};

/**
 * Update a product variant
 * @param {string} variantId - Variant ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated variant
 */
export const updateProductVariant = async (variantId, updates) => {
  if (isMockAuth) {
    console.log('Mock mode: Would update product variant:', variantId, updates);
    return { id: variantId, ...updates };
  }

  try {
    const client = getSupabaseClient();
    const updateData = {};
    
    if (updates.colorName) updateData.color_name = updates.colorName;
    if (updates.colorCode) updateData.color_code = updates.colorCode;
    if (updates.viewName) updateData.view_name = updates.viewName;
    if (updates.templateUrl) updateData.template_url = updates.templateUrl;

    const { data, error } = await client
      .from('product_template_variants')
      .update(updateData)
      .eq('id', variantId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating product variant:', error);
    throw error;
  }
};

/**
 * Delete a product variant
 * @param {string} variantId - Variant ID
 * @returns {Promise<void>}
 */
export const deleteProductVariant = async (variantId) => {
  if (isMockAuth) {
    console.log('Mock mode: Would delete product variant:', variantId);
    return;
  }

  try {
    const client = getSupabaseClient();
    const { error } = await client
      .from('product_template_variants')
      .delete()
      .eq('id', variantId);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting product variant:', error);
    throw error;
  }
};

/**
 * Upsert a product variant (create or update)
 * @param {string} productTemplateId - Product template ID
 * @param {string} colorCode - Color code
 * @param {string} viewName - View name
 * @param {Object} variantData - Variant data
 * @returns {Promise<Object>} Upserted variant
 */
export const upsertProductVariant = async (productTemplateId, colorCode, viewName, variantData) => {
  if (isMockAuth) {
    console.log('Mock mode: Would upsert product variant');
    return { id: 'mock-variant-id', ...variantData };
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('product_template_variants')
      .upsert({
        product_template_id: productTemplateId,
        color_code: colorCode,
        view_name: viewName,
        color_name: variantData.colorName,
        template_url: variantData.templateUrl
      }, {
        onConflict: 'product_template_id,color_code,view_name'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error upserting product variant:', error);
    throw error;
  }
};

// =====================================================
// Enhanced Print Area Operations (with Variant Support)
// =====================================================

/**
 * Get print areas for a specific variant
 * @param {string} variantId - Variant ID
 * @returns {Promise<Array>} Array of print areas
 */
export const getPrintAreasByVariant = async (variantId) => {
  if (isMockAuth) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('print_areas')
      .select('*')
      .eq('variant_id', variantId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching print areas by variant:', error);
    throw error;
  }
};

/**
 * Create print area for a variant
 * @param {string} variantId - Variant ID
 * @param {Object} printArea - Print area data
 * @returns {Promise<Object>} Created print area
 */
export const createPrintAreaForVariant = async (variantId, printArea) => {
  if (isMockAuth) {
    console.log('Mock mode: Would create print area for variant:', printArea);
    return { id: 'mock-id', variant_id: variantId, ...printArea };
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('print_areas')
      .insert({
        variant_id: variantId,
        area_key: printArea.areaKey,
        name: printArea.name,
        x: printArea.x,
        y: printArea.y,
        width: printArea.width,
        height: printArea.height,
        max_width: printArea.maxWidth,
        max_height: printArea.maxHeight,
        shape: printArea.shape || 'rectangle'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating print area for variant:', error);
    throw error;
  }
};

/**
 * Batch update print areas for a variant
 * @param {string} variantId - Variant ID
 * @param {Object} printAreasConfig - Print areas configuration
 * @returns {Promise<Array>} Updated print areas
 */
export const batchUpdatePrintAreasForVariant = async (variantId, printAreasConfig) => {
  if (isMockAuth) {
    console.log('Mock mode: Would batch update print areas for variant:', printAreasConfig);
    return Object.entries(printAreasConfig).map(([key, area]) => ({
      id: `mock-${key}`,
      variant_id: variantId,
      area_key: key,
      ...area
    }));
  }

  try {
    const client = getSupabaseClient();
    
    // Get existing print areas for this variant
    const { data: existingAreas, error: fetchError } = await client
      .from('print_areas')
      .select('*')
      .eq('variant_id', variantId);

    if (fetchError) throw fetchError;

    const existingAreasMap = new Map(
      (existingAreas || []).map(area => [area.area_key, area])
    );

    // Delete areas that are no longer in the config
    const configKeys = new Set(Object.keys(printAreasConfig));
    const areasToDelete = Array.from(existingAreasMap.values())
      .filter(area => !configKeys.has(area.area_key))
      .map(area => area.id);

    if (areasToDelete.length > 0) {
      const { error: deleteError } = await client
        .from('print_areas')
        .delete()
        .in('id', areasToDelete);
      
      if (deleteError) throw deleteError;
    }

    // Update/insert areas
    const operations = [];
    for (const [areaKey, areaData] of Object.entries(printAreasConfig)) {
      const existingArea = existingAreasMap.get(areaKey);

      if (existingArea) {
        operations.push(
          client
            .from('print_areas')
            .update({
              name: areaData.name,
              x: areaData.x,
              y: areaData.y,
              width: areaData.width,
              height: areaData.height,
              max_width: areaData.maxWidth,
              max_height: areaData.maxHeight,
              shape: areaData.shape || 'rectangle',
              width_mm: areaData.width_mm || null,
              height_mm: areaData.height_mm || null
            })
            .eq('id', existingArea.id)
            .select()
        );
      } else {
        operations.push(
          client
            .from('print_areas')
            .insert({
              variant_id: variantId,
              area_key: areaKey,
              name: areaData.name,
              x: areaData.x,
              y: areaData.y,
              width: areaData.width,
              height: areaData.height,
              max_width: areaData.maxWidth,
              max_height: areaData.maxHeight,
              shape: areaData.shape || 'rectangle',
              width_mm: areaData.width_mm || null,
              height_mm: areaData.height_mm || null
            })
            .select()
        );
      }
    }

    if (operations.length > 0) {
      const results = await Promise.all(operations);
      const errors = results.filter(r => r.error);
      if (errors.length > 0) throw errors[0].error;

      const updatedAreas = results
        .filter(r => r.data)
        .flatMap(r => Array.isArray(r.data) ? r.data : [r.data])
        .filter(area => area != null);

      return updatedAreas;
    }

    return [];
  } catch (error) {
    console.error('Error batch updating print areas for variant:', error);
    throw error;
  }
};

// =====================================================
// View-Based Print Area Operations (Multiple Areas Per View)
// =====================================================

/**
 * Get all print areas for a product and view (supports multiple areas per view)
 * @param {string} productTemplateId - Product template ID
 * @param {string} viewName - View name (front, back, etc.)
 * @returns {Promise<Array>} Array of print areas
 */
export const getPrintAreasByProductView = async (productTemplateId, viewName) => {
  if (isMockAuth) {
    console.log('Mock mode: Would fetch print areas for product+view:', productTemplateId, viewName);
    return [];
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('print_areas')
      .select('*')
      .eq('product_template_id', productTemplateId)
      .eq('area_key', viewName);

    if (error) throw error;
    console.log(`[getPrintAreasByProductView] Loaded ${data?.length || 0} print areas for ${viewName}`);
    return data || [];
  } catch (error) {
    console.error('Error fetching print areas by product+view:', error);
    throw error;
  }
};

/**
 * Get all print areas for a product (all views)
 * @param {string} productTemplateId - Product template ID
 * @returns {Promise<Object>} Print areas grouped by view name
 */
export const getAllPrintAreasByProduct = async (productTemplateId) => {
  if (isMockAuth) {
    return {};
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('print_areas')
      .select('*')
      .eq('product_template_id', productTemplateId)
      .order('area_key', { ascending: true });

    if (error) throw error;

    // Group by area_key
    const grouped = {};
    (data || []).forEach(area => {
      if (!grouped[area.area_key]) {
        grouped[area.area_key] = [];
      }
      grouped[area.area_key].push(area);
    });

    return grouped;
  } catch (error) {
    console.error('Error fetching all print areas:', error);
    throw error;
  }
};

/**
 * Create a new print area for a product+view
 * @param {string} productTemplateId - Product template ID
 * @param {string} viewName - View name (front, back, etc.)
 * @param {Object} printArea - Print area data
 * @returns {Promise<Object>} Created print area
 */
export const createPrintAreaForView = async (productTemplateId, viewName, printArea) => {
  if (isMockAuth) {
    console.log('Mock mode: Would create print area:', printArea);
    return { id: 'mock-id', product_template_id: productTemplateId, view_name: viewName, ...printArea };
  }

  try {
    const client = getSupabaseClient();
    const areaKey = printArea.areaKey || printArea.area_key || viewName;

    // Use upsert to prevent duplicates
    const { data, error} = await client
      .from('print_areas')
      .upsert({
        product_template_id: productTemplateId,
        area_key: areaKey,
        name: printArea.name,
        x: printArea.x,
        y: printArea.y,
        width: printArea.width,
        height: printArea.height,
        max_width: printArea.maxWidth || printArea.max_width,
        max_height: printArea.maxHeight || printArea.max_height,
        width_mm: printArea.width_mm || null,
        height_mm: printArea.height_mm || null,
        shape: printArea.shape || 'rectangle'
      }, {
        onConflict: 'product_template_id,area_key'  // Unique constraint
      })
      .select()
      .single();

    if (error) throw error;
    console.log('[createPrintAreaForView] Upserted print area:', data);
    return data;
  } catch (error) {
    console.error('Error upserting print area for view:', error);
    throw error;
  }
};

/**
 * Update an existing print area
 * @param {string} printAreaId - Print area ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated print area
 */
export const updatePrintAreaForView = async (printAreaId, updates) => {
  if (isMockAuth) {
    console.log('Mock mode: Would update print area:', printAreaId, updates);
    return { id: printAreaId, ...updates };
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('print_areas')
      .update({
        name: updates.name,
        x: updates.x,
        y: updates.y,
        width: updates.width,
        height: updates.height,
        max_width: updates.maxWidth || updates.max_width,
        max_height: updates.maxHeight || updates.max_height,
        width_mm: updates.width_mm,
        height_mm: updates.height_mm,
        shape: updates.shape
      })
      .eq('id', printAreaId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating print area:', error);
    throw error;
  }
};

/**
 * Delete a print area
 * @param {string} printAreaId - Print area ID
 * @returns {Promise<void>}
 */
export const deletePrintAreaForView = async (printAreaId) => {
  if (isMockAuth) {
    console.log('Mock mode: Would delete print area:', printAreaId);
    return;
  }

  try {
    const client = getSupabaseClient();
    const { error } = await client
      .from('print_areas')
      .delete()
      .eq('id', printAreaId);

    if (error) throw error;
    console.log('[deletePrintAreaForView] Deleted print area:', printAreaId);
  } catch (error) {
    console.error('Error deleting print area:', error);
    throw error;
  }
};

/**
 * Preset print area templates for common apparel configurations
 */
export const PRINT_AREA_PRESETS = {
  'center_chest': {
    name: 'Center Chest',
    area_key: 'center_chest',
    width: 300,
    height: 300,
    width_mm: 300,
    height_mm: 300,
    shape: 'rectangle',
    display_order: 0,
    is_required: true,
    description: 'Main chest print area - perfect for logos and designs'
  },
  'left_breast_pocket': {
    name: 'Left Breast Pocket',
    area_key: 'left_breast_pocket',
    width: 80,
    height: 80,
    width_mm: 80,
    height_mm: 80,
    shape: 'rectangle',
    display_order: 1,
    is_required: false,
    description: 'Small left pocket area - ideal for logos'
  },
  'right_breast_pocket': {
    name: 'Right Breast Pocket',
    area_key: 'right_breast_pocket',
    width: 80,
    height: 80,
    width_mm: 80,
    height_mm: 80,
    shape: 'rectangle',
    display_order: 2,
    is_required: false,
    description: 'Small right pocket area - ideal for logos'
  },
  'center_back': {
    name: 'Center Back',
    area_key: 'center_back',
    width: 300,
    height: 300,
    width_mm: 300,
    height_mm: 300,
    shape: 'rectangle',
    display_order: 0,
    is_required: false,
    description: 'Main back print area - perfect for large designs'
  },
  'left_sleeve': {
    name: 'Left Sleeve',
    area_key: 'left_sleeve',
    width: 100,
    height: 100,
    width_mm: 100,
    height_mm: 100,
    shape: 'rectangle',
    display_order: 3,
    is_required: false,
    description: 'Left sleeve area - optional accent print'
  },
  'right_sleeve': {
    name: 'Right Sleeve',
    area_key: 'right_sleeve',
    width: 100,
    height: 100,
    width_mm: 100,
    height_mm: 100,
    shape: 'rectangle',
    display_order: 4,
    is_required: false,
    description: 'Right sleeve area - optional accent print'
  },
  // Generic print areas for non-apparel products
  'front_print': {
    name: 'Front Print',
    area_key: 'front_print',
    width: 250,
    height: 250,
    width_mm: 250,
    height_mm: 250,
    shape: 'rectangle',
    display_order: 0,
    is_required: true,
    description: 'Main front print area - for bags, cups, and other products'
  },
  'back_print': {
    name: 'Back Print',
    area_key: 'back_print',
    width: 250,
    height: 250,
    width_mm: 250,
    height_mm: 250,
    shape: 'rectangle',
    display_order: 1,
    is_required: false,
    description: 'Back print area - for products with back surface'
  },
  'side_print': {
    name: 'Side Print',
    area_key: 'side_print',
    width: 150,
    height: 150,
    width_mm: 150,
    height_mm: 150,
    shape: 'rectangle',
    display_order: 2,
    is_required: false,
    description: 'Side print area - for bottle wraps or bag sides'
  },
  'top_print': {
    name: 'Top Print',
    area_key: 'top_print',
    width: 200,
    height: 200,
    width_mm: 200,
    height_mm: 200,
    shape: 'rectangle',
    display_order: 3,
    is_required: false,
    description: 'Top surface print area'
  },
  'bottom_print': {
    name: 'Bottom Print',
    area_key: 'bottom_print',
    width: 200,
    height: 200,
    width_mm: 200,
    height_mm: 200,
    shape: 'rectangle',
    display_order: 4,
    is_required: false,
    description: 'Bottom surface print area'
  }
};

// =====================================================
// Template Image Upload Operations
// =====================================================

/**
 * Upload a template image to Supabase Storage
 * @param {File} file - Image file to upload
 * @param {string} productKey - Product key for file naming
 * @returns {Promise<string>} Public URL of uploaded image
 */
export const uploadTemplateImage = async (file, productKey) => {
  if (isMockAuth) {
    console.log('Mock mode: Would upload template image:', file.name);
    return `/templates/${productKey}/template.png`;
  }

  try {
    const client = getSupabaseClient();
    
    // Generate unique filename
    const timestamp = Date.now();
    const fileExt = file.name.split('.').pop();
    const fileName = `${productKey}_${timestamp}.${fileExt}`;
    const filePath = `${productKey}/${fileName}`;

    // Upload to Supabase Storage
    const { error } = await client.storage
      .from('product-templates')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) throw error;

    // Get public URL
    const { data: { publicUrl } } = client.storage
      .from('product-templates')
      .getPublicUrl(filePath);

    return publicUrl;
  } catch (error) {
    console.error('Error uploading template image:', error);
    throw error;
  }
};

/**
 * Delete a template image from Supabase Storage
 * @param {string} imageUrl - URL of image to delete
 * @returns {Promise<void>}
 */
export const deleteTemplateImage = async (imageUrl) => {
  if (isMockAuth) {
    console.log('Mock mode: Would delete template image:', imageUrl);
    return;
  }

  try {
    const client = getSupabaseClient();
    
    // Extract file path from URL
    const urlParts = imageUrl.split('/product-templates/');
    if (urlParts.length < 2) {
      throw new Error('Invalid template image URL');
    }
    
    const filePath = urlParts[1];

    const { error } = await client.storage
      .from('product-templates')
      .remove([filePath]);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting template image:', error);
    throw error;
  }
};

/**
 * Replace template image (delete old, upload new)
 * @param {string} oldImageUrl - URL of old image
 * @param {File} newFile - New image file
 * @param {string} productKey - Product key
 * @returns {Promise<string>} Public URL of new image
 */
export const replaceTemplateImage = async (oldImageUrl, newFile, productKey) => {
  if (isMockAuth) {
    console.log('Mock mode: Would replace template image');
    return `/templates/${productKey}/template.png`;
  }

  try {
    // Upload new image first
    const newUrl = await uploadTemplateImage(newFile, productKey);
    
    // Delete old image if it exists and is a Supabase URL
    if (oldImageUrl && oldImageUrl.includes('supabase')) {
      try {
        await deleteTemplateImage(oldImageUrl);
      } catch (error) {
        console.warn('Failed to delete old image:', error);
        // Don't throw - new image is already uploaded
      }
    }

    return newUrl;
  } catch (error) {
    console.error('Error replacing template image:', error);
    throw error;
  }
};

// =====================================================
// Complete Configuration Operations
// =====================================================

/**
 * Save complete product configuration with variants (color + view support)
 * @param {string} productKey - Product key
 * @param {Object} config - Complete configuration
 * @param {string} colorCode - Color code for variant
 * @param {string} viewName - View name for variant
 * @returns {Promise<Object>} Saved configuration
 */
export const saveProductConfiguration = async (productKey, config, colorCode = null, viewName = 'front') => {
  if (isMockAuth) {
    console.log('Mock mode: Configuration saved!', {
      productKey,
      config,
      colorCode,
      viewName
    });
    return { productKey, ...config };
  }

  try {
    // Get or create product template
    let template = await getProductTemplate(productKey);
    
    if (!template) {
      // Create new template
      template = await createProductTemplate({
        productKey,
        name: config.name,
        templateUrl: config.template,
        colors: config.colors || [],
        basePrice: config.basePrice || 0
      });
    } else {
      // Update existing template
      template = await updateProductTemplate(productKey, {
        name: config.name,
        templateUrl: config.template,
        colors: config.colors,
        basePrice: config.basePrice
      });
    }

    // Save variant if color and view are specified
    if (colorCode) {
      // Upsert the variant
      const variant = await upsertProductVariant(
        template.id,
        colorCode,
        viewName,
        {
          colorName: colorCode, // Can be enhanced to have separate name
          templateUrl: config.template
        }
      );

      // Batch update print areas for this variant
      if (config.printAreas) {
        await batchUpdatePrintAreasForVariant(variant.id, config.printAreas);
      }
    } else {
      // Fallback: batch update print areas for template (backward compatibility)
      if (config.printAreas) {
        await batchUpdatePrintAreas(template.id, config.printAreas);
      }
    }

    // Return complete configuration
    return await getProductTemplate(productKey);
  } catch (error) {
    console.error('Error saving product configuration:', error);
    throw error;
  }
};

/**
 * Save variant-specific configuration
 * @param {string} productKey - Product key
 * @param {string} colorCode - Color code
 * @param {string} viewName - View name
 * @param {Object} variantConfig - Variant-specific configuration
 * @returns {Promise<Object>} Saved variant
 */
export const saveVariantConfiguration = async (productKey, colorCode, viewName, variantConfig) => {
  if (isMockAuth) {
    console.log('Mock mode: Variant configuration saved!', {
      productKey,
      colorCode,
      viewName,
      variantConfig
    });
    return { productKey, colorCode, viewName, ...variantConfig };
  }

  try {
    // Get product template
    const template = await getProductTemplate(productKey);
    if (!template) {
      throw new Error(`Product template not found: ${productKey}`);
    }

    // Upsert the variant
    const variant = await upsertProductVariant(
      template.id,
      colorCode,
      viewName,
      {
        colorName: variantConfig.colorName || colorCode,
        templateUrl: variantConfig.templateUrl
      }
    );

    // Batch update print areas for this variant
    if (variantConfig.printAreas) {
      await batchUpdatePrintAreasForVariant(variant.id, variantConfig.printAreas);
    }

    // Return complete variant with print areas
    return await getProductVariant(template.id, colorCode, viewName);
  } catch (error) {
    console.error('Error saving variant configuration:', error);
    throw error;
  }
};

/**
 * Load complete product configuration from Supabase
 * Includes support for color variations and multiple views
 * @param {string} productKey - Product key
 * @param {string} colorCode - Optional color code to load specific variant
 * @param {string} viewName - Optional view name to load specific variant
 * @returns {Promise<Object|null>} Product configuration or null if not found
 */
export const loadProductConfiguration = async (productKey, colorCode = null, viewName = 'front') => {
  if (isMockAuth) {
    console.log('Mock mode: Would load configuration for:', productKey, colorCode, viewName);
    return null;
  }

  try {
    const template = await getProductTemplate(productKey);
    
    if (!template) return null;

    // If color and view are specified, try to load variant-specific configuration
    if (colorCode && viewName) {
      const variant = await getProductVariant(template.id, colorCode, viewName);
      
      if (variant && variant.print_areas) {
        // Convert print areas array to object format for variant
        const printAreasObj = {};
        variant.print_areas.forEach(area => {
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

        return {
          name: template.name,
          template: variant.template_url,
          printAreas: printAreasObj,
          colors: template.colors,
          basePrice: template.base_price,
          currentColor: colorCode,
          currentView: viewName,
          variantId: variant.id
        };
      }
    }

    // Fallback: Load default configuration from template
    // Convert print areas array to object format
    const printAreasObj = {};
    if (template.print_areas) {
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

    return {
      name: template.name,
      template: template.template_url,
      printAreas: printAreasObj,
      colors: template.colors,
      basePrice: template.base_price
    };
  } catch (error) {
    console.error('Error loading product configuration:', error);
    throw error;
  }
};

/**
 * Load all variants for a product
 * @param {string} productKey - Product key
 * @returns {Promise<Object>} Object with variants grouped by color and view
 */
export const loadProductVariants = async (productKey) => {
  if (isMockAuth) {
    console.log('Mock mode: Would load variants for:', productKey);
    return { colors: {}, views: [] };
  }

  try {
    const template = await getProductTemplate(productKey);
    if (!template) return { colors: {}, views: [] };

    const variants = await getProductVariants(template.id);
    
    // Group variants by color and view
    const colorMap = {};
    const viewSet = new Set();

    variants.forEach(variant => {
      const colorCode = variant.color_code;
      const viewName = variant.view_name;

      if (!colorMap[colorCode]) {
        colorMap[colorCode] = {
          name: variant.color_name,
          code: colorCode,
          views: {}
        };
      }

      colorMap[colorCode].views[viewName] = {
        variantId: variant.id,
        templateUrl: variant.template_url,
        printAreas: variant.print_areas || []
      };

      viewSet.add(viewName);
    });

    return {
      colors: colorMap,
      views: Array.from(viewSet).sort(),
      availableColors: template.colors || []
    };
  } catch (error) {
    console.error('Error loading product variants:', error);
    throw error;
  }
};

// =====================================================
// User Design Operations (Design Persistence)
// =====================================================

/**
 * Get or generate session ID for anonymous users
 * @returns {string} Session ID
 */
export const getSessionId = () => {
  if (typeof window === 'undefined') return null;

  let sessionId = localStorage.getItem('design_session_id');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem('design_session_id', sessionId);
  }
  return sessionId;
};

/**
 * Generate thumbnail from Fabric.js canvas
 * @param {fabric.Canvas} canvas - Fabric.js canvas instance
 * @param {number} maxWidth - Maximum thumbnail width (default: 400)
 * @param {number} maxHeight - Maximum thumbnail height (default: 400)
 * @returns {Promise<Blob>} Thumbnail image as blob
 */
export const generateDesignThumbnail = async (canvas, maxWidth = 400, maxHeight = 400) => {
  if (!canvas) {
    throw new Error('Canvas is required to generate thumbnail');
  }

  try {
    // Get canvas dimensions
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    // Calculate scale to fit within max dimensions
    const scale = Math.min(maxWidth / canvasWidth, maxHeight / canvasHeight, 1);

    // Generate data URL with scaling
    const dataURL = canvas.toDataURL({
      format: 'png',
      quality: 0.8,
      multiplier: scale
    });

    // Convert data URL to blob
    const response = await fetch(dataURL);
    const blob = await response.blob();

    return blob;
  } catch (error) {
    console.error('Error generating design thumbnail:', error);
    throw error;
  }
};

/**
 * Save user design to database
 * @param {Object} designData - Design data
 * @param {Object} designData.canvas - Fabric.js canvas instance
 * @param {string} designData.productTemplateId - Product template ID
 * @param {string} designData.variantId - Product variant ID (optional)
 * @param {string} designData.viewName - View name (front, back, etc.)
 * @param {string} designData.designName - Design name (default: 'Untitled Design')
 * @param {boolean} designData.isPublic - Whether design is public (default: false)
 * @returns {Promise<Object>} Saved design with ID and thumbnail URL
 */
export const saveUserDesign = async (designData) => {
  if (isMockAuth) {
    console.log('Mock mode: Would save design:', designData.designName);
    return { id: 'mock-design-id', thumbnail_url: '/mock-thumbnail.png' };
  }

  try {
    const client = getSupabaseClient();
    const { data: { user } } = await client.auth.getUser();

    // Get user_id or session_id
    const userId = user?.id || null;
    const sessionId = userId ? null : getSessionId();

    if (!userId && !sessionId) {
      throw new Error('Unable to identify user or session');
    }

    // Validate required fields
    if (!designData.canvas) {
      throw new Error('Canvas is required');
    }
    if (!designData.productTemplateId) {
      throw new Error('Product template ID is required');
    }

    // Get canvas JSON
    const canvasJSON = designData.canvas.toJSON(['id', 'name', 'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY', 'lockRotation', 'selectable']);

    // Generate thumbnail
    let thumbnailUrl = null;
    try {
      const thumbnailBlob = await generateDesignThumbnail(designData.canvas);

      // Upload thumbnail to storage
      const fileName = `design-${Date.now()}.png`;
      const filePath = `design-thumbnails/${fileName}`;

      const { error: uploadError } = await client.storage
        .from('catalog-images')
        .upload(filePath, thumbnailBlob, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.warn('Failed to upload thumbnail:', uploadError);
      } else {
        const { data: { publicUrl } } = client.storage
          .from('catalog-images')
          .getPublicUrl(filePath);

        thumbnailUrl = publicUrl;
      }
    } catch (thumbError) {
      console.warn('Failed to generate/upload thumbnail:', thumbError);
      // Continue without thumbnail
    }

    // Insert design into database
    const { data, error } = await client
      .from('user_designs')
      .insert({
        user_id: userId,
        session_id: sessionId,
        product_template_id: designData.productTemplateId,
        variant_id: designData.variantId || null,
        design_name: designData.designName || 'Untitled Design',
        design_data: canvasJSON,
        thumbnail_url: thumbnailUrl,
        view_name: designData.viewName || null,
        is_public: designData.isPublic || false
      })
      .select()
      .single();

    if (error) throw error;

    console.log('Design saved successfully:', data.id);
    return data;
  } catch (error) {
    console.error('Error saving design:', error);
    throw error;
  }
};

/**
 * Get user's designs
 * @param {string} userId - User ID (optional, will use current user if not provided)
 * @param {string} sessionId - Session ID (optional, will use current session if not provided)
 * @returns {Promise<Array>} Array of user designs
 */
export const getUserDesigns = async (userId = null, sessionId = null) => {
  if (isMockAuth) {
    return [];
  }

  try {
    const client = getSupabaseClient();

    // Determine user_id or session_id
    let queryUserId = userId;
    let querySessionId = sessionId;

    if (!queryUserId && !querySessionId) {
      const { data: { user } } = await client.auth.getUser();
      queryUserId = user?.id || null;
      querySessionId = queryUserId ? null : getSessionId();
    }

    // Build query
    let query = client
      .from('user_designs')
      .select(`
        *,
        product_template:product_templates(
          id,
          product_key,
          name
        ),
        variant:product_template_variants(
          id,
          color_name,
          color_code,
          view_name
        )
      `)
      .order('updated_at', { ascending: false });

    // Filter by user_id or session_id
    if (queryUserId) {
      query = query.eq('user_id', queryUserId);
    } else if (querySessionId) {
      query = query.eq('session_id', querySessionId);
    } else {
      return []; // No identifier available
    }

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching user designs:', error);
    throw error;
  }
};

/**
 * Get a specific design by ID
 * @param {string} designId - Design ID
 * @returns {Promise<Object|null>} Design data or null
 */
export const getUserDesign = async (designId) => {
  if (isMockAuth) {
    return null;
  }

  try {
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('user_designs')
      .select(`
        *,
        product_template:product_templates(
          id,
          product_key,
          name
        ),
        variant:product_template_variants(
          id,
          color_name,
          color_code,
          view_name,
          template_url
        )
      `)
      .eq('id', designId)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || error.message.includes('no rows')) {
        return null;
      }
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error fetching design:', error);
    throw error;
  }
};

/**
 * Update an existing design
 * @param {string} designId - Design ID
 * @param {Object} designData - Design data to update
 * @param {Object} designData.canvas - Fabric.js canvas instance (optional)
 * @param {string} designData.designName - Design name (optional)
 * @param {boolean} designData.isPublic - Whether design is public (optional)
 * @returns {Promise<Object>} Updated design
 */
export const updateUserDesign = async (designId, designData) => {
  if (isMockAuth) {
    console.log('Mock mode: Would update design:', designId);
    return { id: designId, ...designData };
  }

  try {
    const client = getSupabaseClient();

    const updateData = {};

    // Update design name if provided
    if (designData.designName !== undefined) {
      updateData.design_name = designData.designName;
    }

    // Update public flag if provided
    if (designData.isPublic !== undefined) {
      updateData.is_public = designData.isPublic;
    }

    // Update canvas data if provided
    if (designData.canvas) {
      const canvasJSON = designData.canvas.toJSON(['id', 'name', 'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY', 'lockRotation', 'selectable']);
      updateData.design_data = canvasJSON;

      // Generate new thumbnail
      try {
        const thumbnailBlob = await generateDesignThumbnail(designData.canvas);

        // Delete old thumbnail if exists
        const { data: existingDesign } = await client
          .from('user_designs')
          .select('thumbnail_url')
          .eq('id', designId)
          .single();

        if (existingDesign?.thumbnail_url) {
          const oldPath = existingDesign.thumbnail_url.split('/catalog-images/')[1];
          if (oldPath) {
            await client.storage
              .from('catalog-images')
              .remove([oldPath]);
          }
        }

        // Upload new thumbnail
        const fileName = `design-${Date.now()}.png`;
        const filePath = `design-thumbnails/${fileName}`;

        const { error: uploadError } = await client.storage
          .from('catalog-images')
          .upload(filePath, thumbnailBlob, {
            cacheControl: '3600',
            upsert: false
          });

        if (!uploadError) {
          const { data: { publicUrl } } = client.storage
            .from('catalog-images')
            .getPublicUrl(filePath);

          updateData.thumbnail_url = publicUrl;
        }
      } catch (thumbError) {
        console.warn('Failed to update thumbnail:', thumbError);
      }
    }

    // Update design in database
    const { data, error } = await client
      .from('user_designs')
      .update(updateData)
      .eq('id', designId)
      .select()
      .single();

    if (error) throw error;

    console.log('Design updated successfully:', designId);
    return data;
  } catch (error) {
    console.error('Error updating design:', error);
    throw error;
  }
};

/**
 * Delete a design
 * @param {string} designId - Design ID
 * @returns {Promise<void>}
 */
export const deleteUserDesign = async (designId) => {
  if (isMockAuth) {
    console.log('Mock mode: Would delete design:', designId);
    return;
  }

  try {
    const client = getSupabaseClient();

    // Get design to find thumbnail URL
    const { data: design } = await client
      .from('user_designs')
      .select('thumbnail_url')
      .eq('id', designId)
      .single();

    // Delete thumbnail from storage
    if (design?.thumbnail_url) {
      const filePath = design.thumbnail_url.split('/catalog-images/')[1];
      if (filePath) {
        await client.storage
          .from('catalog-images')
          .remove([filePath]);
      }
    }

    // Delete design from database
    const { error } = await client
      .from('user_designs')
      .delete()
      .eq('id', designId);

    if (error) throw error;

    console.log('Design deleted successfully:', designId);
  } catch (error) {
    console.error('Error deleting design:', error);
    throw error;
  }
};

/**
 * Migrate anonymous designs to user account
 * @param {string} sessionId - Session ID to migrate
 * @param {string} userId - User ID to migrate to
 * @returns {Promise<number>} Number of designs migrated
 */
export const migrateSessionDesignsToUser = async (sessionId, userId) => {
  if (isMockAuth) {
    console.log('Mock mode: Would migrate designs from session to user');
    return 0;
  }

  try {
    const client = getSupabaseClient();

    const { data, error } = await client.rpc('migrate_session_designs_to_user', {
      p_session_id: sessionId,
      p_user_id: userId
    });

    if (error) throw error;

    console.log(`Migrated ${data} designs from session to user`);
    return data;
  } catch (error) {
    console.error('Error migrating session designs:', error);
    throw error;
  }
};

// ============================================================
// COLOR MANAGEMENT
// Functions for managing apparel colors and product-color assignments
// ============================================================

/**
 * Get all apparel colors from the database
 * @returns {Promise<{data: Array, error: Error}>} All apparel colors
 */
export async function getApparelColors() {
  const client = getSupabaseClient();

  try {
    console.log('[getApparelColors] Fetching all apparel colors...');

    const { data, error } = await client
      .from('apparel_colors')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[getApparelColors] Error:', error);
      return { data: null, error };
    }

    console.log('[getApparelColors] ✅ Fetched', data?.length || 0, 'colors');
    return { data, error: null };
  } catch (err) {
    console.error('[getApparelColors] Exception:', err);
    return { data: null, error: err };
  }
}

/**
 * Get assigned colors for a specific product
 * @param {string} productId - Product template ID
 * @returns {Promise<{data: Array, error: Error}>} Product colors with full color details
 */
export async function getProductColors(productId) {
  const client = getSupabaseClient();

  try {
    console.log('[getProductColors] Fetching colors for product:', productId);

    const { data, error } = await client
      .from('product_template_colors')
      .select(`
        *,
        apparel_colors:apparel_color_id (*)
      `)
      .eq('product_template_id', productId)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[getProductColors] Error:', error);
      return { data: null, error };
    }

    console.log('[getProductColors] ✅ Fetched', data?.length || 0, 'assigned colors');
    return { data, error: null };
  } catch (err) {
    console.error('[getProductColors] Exception:', err);
    return { data: null, error: err };
  }
}

/**
 * Assign a color to a product
 * @param {string} productId - Product template ID
 * @param {string} colorId - Apparel color ID
 * @returns {Promise<{data: Object, error: Error}>} Created assignment
 */
export async function assignColorToProduct(productId, colorId) {
  const client = getSupabaseClient();

  try {
    console.log('[assignColorToProduct] Assigning color', colorId, 'to product', productId);

    const { data, error } = await client
      .from('product_template_colors')
      .insert({
        product_template_id: productId,
        apparel_color_id: colorId,
        is_available: true
      })
      .select()
      .single();

    if (error) {
      console.error('[assignColorToProduct] Error:', error);
      return { data: null, error };
    }

    console.log('[assignColorToProduct] ✅ Color assigned successfully');
    return { data, error: null };
  } catch (err) {
    console.error('[assignColorToProduct] Exception:', err);
    return { data: null, error: err };
  }
}

/**
 * Remove a color assignment from a product
 * @param {string} productId - Product template ID
 * @param {string} colorId - Apparel color ID
 * @returns {Promise<{data: Object, error: Error}>} Deleted assignment
 */
export async function removeColorFromProduct(productId, colorId) {
  const client = getSupabaseClient();

  try {
    console.log('[removeColorFromProduct] Removing color', colorId, 'from product', productId);

    const { data, error } = await client
      .from('product_template_colors')
      .delete()
      .eq('product_template_id', productId)
      .eq('apparel_color_id', colorId)
      .select()
      .single();

    if (error) {
      console.error('[removeColorFromProduct] Error:', error);
      return { data: null, error };
    }

    console.log('[removeColorFromProduct] ✅ Color removed successfully');
    return { data, error: null };
  } catch (err) {
    console.error('[removeColorFromProduct] Exception:', err);
    return { data: null, error: err };
  }
}

/**
 * Upload a color-specific product photo
 * @param {string} productId - Product template ID
 * @param {string} colorId - Apparel color ID
 * @param {string} view - View name ('front' or 'back')
 * @param {File} file - Image file to upload
 * @param {string} productKey - Product key for folder structure
 * @param {string} colorName - Color name for filename
 * @returns {Promise<{data: Object, error: Error}>} Updated assignment with photo URL
 */
export async function uploadColorPhoto(productId, colorId, view, file, productKey, colorName) {
  const client = getSupabaseClient();

  try {
    console.log('[uploadColorPhoto] Uploading', view, 'photo for product', productId, 'color', colorId);

    // Detect file extension to preserve format (PNG for transparency!)
    const fileExt = file.name.split('.').pop().toLowerCase();
    const extension = fileExt === 'png' ? 'png' : 'jpg';

    // CRITICAL FIX: Create FLAT storage path to match Designer expectations
    // Designer expects: product-key/color-name-view.png (NOT nested folders!)
    // Example: t-shirts/black-front.png (NOT t-shirts/black/front.png)
    // Example: t-shirts/white-front.png (NOT t-shirts/default/front.png)
    const sanitizedColorName = colorName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const fileName = `${sanitizedColorName}-${view}.${extension}`;
    const storagePath = `${productKey}/${fileName}`;

    console.log('[uploadColorPhoto] Storage path:', storagePath, {
      productKey,
      colorName,
      sanitizedColorName,
      fileName,
      view,
      fileType: file.type,
      extension: extension,
      preservesTransparency: extension === 'png'
    });

    // Upload file to storage
    const { data: uploadData, error: uploadError } = await client.storage
      .from('product-templates')
      .upload(storagePath, file, {
        upsert: true,
        contentType: file.type
      });

    if (uploadError) {
      console.error('[uploadColorPhoto] Upload error:', uploadError);
      return { data: null, error: uploadError };
    }

    console.log('[uploadColorPhoto] ✅ File uploaded to storage');

    // Get public URL
    const { data: urlData } = client.storage
      .from('product-templates')
      .getPublicUrl(storagePath);

    const photoUrl = urlData.publicUrl;
    console.log('[uploadColorPhoto] Public URL:', photoUrl);

    // Update product_template_colors record
    const updateData = view === 'front'
      ? { front_photo_url: photoUrl, has_front_photo: true }
      : { back_photo_url: photoUrl, has_back_photo: true };

    const { data: updateResult, error: updateError } = await client
      .from('product_template_colors')
      .update(updateData)
      .eq('product_template_id', productId)
      .eq('apparel_color_id', colorId)
      .select()
      .single();

    if (updateError) {
      console.error('[uploadColorPhoto] Update error:', updateError);
      return { data: null, error: updateError };
    }

    console.log('[uploadColorPhoto] ✅ Database record updated');
    return { data: updateResult, error: null };
  } catch (err) {
    console.error('[uploadColorPhoto] Exception:', err);
    return { data: null, error: err };
  }
}

/**
 * Upload an overlay image (cords, collars, pockets, buttons, etc.)
 * @param {string} productKey - Product key for folder structure
 * @param {string} colorName - Color name for filename
 * @param {string} view - View name ('front' or 'back')
 * @param {string} overlayType - Overlay type (e.g., 'cord', 'collar', 'pocket', 'button')
 * @param {File} file - Image file to upload (should be PNG with transparency)
 * @returns {Promise<{data: {url: string, path: string}, error: Error}>} Upload result with public URL
 */
export async function uploadOverlayImage(productKey, colorName, view, overlayType, file) {
  const client = getSupabaseClient();

  try {
    console.log('[uploadOverlayImage] Uploading overlay:', {
      productKey,
      colorName,
      view,
      overlayType,
      fileName: file.name,
      fileType: file.type
    });

    // Validate file is PNG (overlays need transparency)
    const fileExt = file.name.split('.').pop().toLowerCase();
    if (fileExt !== 'png' && file.type !== 'image/png') {
      console.warn('[uploadOverlayImage] Warning: Overlay should be PNG for transparency');
    }

    // Create storage path: product-key/color-view-overlayType.png
    // Example: hoodie/black-front-cord.png
    const sanitizedColorName = colorName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const sanitizedOverlayType = overlayType.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const fileName = `${sanitizedColorName}-${view}-${sanitizedOverlayType}.png`;
    const storagePath = `${productKey}/${fileName}`;

    console.log('[uploadOverlayImage] Storage path:', storagePath);

    // Upload file to storage
    const { data: uploadData, error: uploadError } = await client.storage
      .from('product-templates')
      .upload(storagePath, file, {
        upsert: true,
        contentType: 'image/png'
      });

    if (uploadError) {
      console.error('[uploadOverlayImage] Upload error:', uploadError);
      return { data: null, error: uploadError };
    }

    console.log('[uploadOverlayImage] ✅ File uploaded to storage');

    // Get public URL
    const { data: urlData } = client.storage
      .from('product-templates')
      .getPublicUrl(storagePath);

    const publicUrl = urlData.publicUrl;
    console.log('[uploadOverlayImage] Public URL:', publicUrl);

    return {
      data: {
        url: publicUrl,
        path: storagePath,
        fileName: fileName
      },
      error: null
    };
  } catch (err) {
    console.error('[uploadOverlayImage] Exception:', err);
    return { data: null, error: err };
  }
}

/**
 * Delete an overlay image from storage
 * @param {string} storagePath - Path to the file in storage (e.g., 'hoodie/black-front-cord.png')
 * @returns {Promise<{data: any, error: Error}>} Delete result
 */
export async function deleteOverlayImage(storagePath) {
  const client = getSupabaseClient();

  try {
    console.log('[deleteOverlayImage] Deleting overlay:', storagePath);

    const { data, error } = await client.storage
      .from('product-templates')
      .remove([storagePath]);

    if (error) {
      console.error('[deleteOverlayImage] Delete error:', error);
      return { data: null, error };
    }

    console.log('[deleteOverlayImage] ✅ Overlay deleted');
    return { data, error: null };
  } catch (err) {
    console.error('[deleteOverlayImage] Exception:', err);
    return { data: null, error: err };
  }
}

/**
 * List all overlay images for a product
 * @param {string} productKey - Product key (folder name)
 * @returns {Promise<{data: Array, error: Error}>} List of overlay files
 */
export async function listOverlayImages(productKey) {
  const client = getSupabaseClient();

  try {
    console.log('[listOverlayImages] Listing overlays for:', productKey);

    const { data, error } = await client.storage
      .from('product-templates')
      .list(productKey);

    if (error) {
      console.error('[listOverlayImages] Error:', error);
      return { data: null, error };
    }

    // Filter for overlay files (contain overlay type in name)
    // Pattern: {color}-{view}-{overlayType}.png
    const overlayFiles = data.filter(file => {
      const parts = file.name.split('-');
      // Overlay files have at least 3 parts: color, view, overlayType.png
      return parts.length >= 3 && file.name.endsWith('.png');
    });

    console.log('[listOverlayImages] Found', overlayFiles.length, 'overlay files');
    return { data: overlayFiles, error: null };
  } catch (err) {
    console.error('[listOverlayImages] Exception:', err);
    return { data: null, error: err };
  }
}

/**
 * Clean up old incorrectly-named color photo files from storage
 * Removes files with timestamp-based names or nested folder structure
 * @param {string} productKey - Product key (e.g., 't-shirts')
 * @returns {Promise<{deletedCount: number, error: Error}>} Number of deleted files
 */
export async function cleanupOldColorPhotos(productKey) {
  const client = getSupabaseClient();

  try {
    console.log('[cleanupOldColorPhotos] Scanning for old files in:', productKey);

    // List all files in the product folder
    const { data: files, error: listError } = await client.storage
      .from('product-templates')
      .list(productKey, {
        limit: 1000,
        sortBy: { column: 'name', order: 'asc' }
      });

    if (listError) {
      console.error('[cleanupOldColorPhotos] List error:', listError);
      return { deletedCount: 0, error: listError };
    }

    if (!files || files.length === 0) {
      console.log('[cleanupOldColorPhotos] No files found');
      return { deletedCount: 0, error: null };
    }

    console.log('[cleanupOldColorPhotos] Found', files.length, 'files');

    // Identify files to delete (timestamp-based or nested folders)
    const filesToDelete = [];
    for (const file of files) {
      // Check if file has incorrect naming patterns
      const hasTimestamp = /\d{10,}/.test(file.name); // Unix timestamp
      const hasVariant = file.name.includes('variant-');
      const isFolder = file.id === null; // Folders have no id in Supabase

      // Correct format: color-name-view.png (e.g., black-front.png, white-back.png)
      const correctFormat = /^[a-z0-9-]+-(?:front|back)\.(?:png|jpg)$/.test(file.name);

      if (isFolder || hasTimestamp || hasVariant || !correctFormat) {
        filesToDelete.push(file.name);
        console.log('[cleanupOldColorPhotos] Marking for deletion:', file.name, {
          isFolder,
          hasTimestamp,
          hasVariant,
          correctFormat
        });
      }
    }

    if (filesToDelete.length === 0) {
      console.log('[cleanupOldColorPhotos] ✅ No old files to clean up');
      return { deletedCount: 0, error: null };
    }

    console.log('[cleanupOldColorPhotos] Deleting', filesToDelete.length, 'files...');

    // Delete files
    const pathsToDelete = filesToDelete.map(name => `${productKey}/${name}`);
    const { data: deleteData, error: deleteError } = await client.storage
      .from('product-templates')
      .remove(pathsToDelete);

    if (deleteError) {
      console.error('[cleanupOldColorPhotos] Delete error:', deleteError);
      return { deletedCount: 0, error: deleteError };
    }

    console.log('[cleanupOldColorPhotos] ✅ Deleted', filesToDelete.length, 'old files');
    return { deletedCount: filesToDelete.length, error: null };

  } catch (err) {
    console.error('[cleanupOldColorPhotos] Exception:', err);
    return { deletedCount: 0, error: err };
  }
}

/**
 * Assign multiple colors to a product at once
 * @param {string} productId - Product template ID
 * @param {Array<string>} colorIds - Array of apparel color IDs
 * @returns {Promise<{data: Array, error: Error}>} Created assignments
 */
export async function assignMultipleColors(productId, colorIds) {
  const client = getSupabaseClient();

  try {
    console.log('[assignMultipleColors] Assigning', colorIds.length, 'colors to product', productId);

    const assignments = colorIds.map(colorId => ({
      product_template_id: productId,
      apparel_color_id: colorId,
      is_available: true
    }));

    const { data, error } = await client
      .from('product_template_colors')
      .insert(assignments)
      .select();

    if (error) {
      console.error('[assignMultipleColors] Error:', error);
      return { data: null, error };
    }

    console.log('[assignMultipleColors] ✅ Assigned', data?.length || 0, 'colors');
    return { data, error: null };
  } catch (err) {
    console.error('[assignMultipleColors] Exception:', err);
    return { data: null, error: err };
  }
}

/**
 * Get the 20 most popular colors for quick assignment
 * @returns {Promise<{data: Array, error: Error}>} Standard color set
 */
export async function getStandardColorSet() {
  const client = getSupabaseClient();

  try {
    console.log('[getStandardColorSet] Fetching standard color set...');

    // Get the most popular basics, blues, reds, and greens (20 total)
    const { data, error } = await client
      .from('apparel_colors')
      .select('*')
      .eq('is_active', true)
      .in('color_family', ['Basics', 'Blues', 'Reds', 'Greens'])
      .order('sort_order', { ascending: true })
      .limit(20);

    if (error) {
      console.error('[getStandardColorSet] Error:', error);
      return { data: null, error };
    }

    console.log('[getStandardColorSet] ✅ Fetched', data?.length || 0, 'standard colors');
    return { data, error: null };
  } catch (err) {
    console.error('[getStandardColorSet] Exception:', err);
    return { data: null, error: err };
  }
}

/**
 * Copy color assignments from one product to another
 * @param {string} sourceProductId - Source product template ID
 * @param {string} targetProductId - Target product template ID
 * @returns {Promise<{data: Array, error: Error}>} Created assignments
 */
export async function copyColorsFromProduct(sourceProductId, targetProductId) {
  const client = getSupabaseClient();

  try {
    console.log('[copyColorsFromProduct] Copying colors from', sourceProductId, 'to', targetProductId);

    // Get source product colors
    const { data: sourceColors, error: fetchError } = await client
      .from('product_template_colors')
      .select('apparel_color_id, sort_order')
      .eq('product_template_id', sourceProductId);

    if (fetchError) {
      console.error('[copyColorsFromProduct] Fetch error:', fetchError);
      return { data: null, error: fetchError };
    }

    if (!sourceColors || sourceColors.length === 0) {
      console.log('[copyColorsFromProduct] No colors to copy');
      return { data: [], error: null };
    }

    // Create assignments for target product
    const assignments = sourceColors.map(sc => ({
      product_template_id: targetProductId,
      apparel_color_id: sc.apparel_color_id,
      is_available: true,
      sort_order: sc.sort_order
    }));

    const { data, error } = await client
      .from('product_template_colors')
      .insert(assignments)
      .select();

    if (error) {
      console.error('[copyColorsFromProduct] Insert error:', error);
      return { data: null, error };
    }

    console.log('[copyColorsFromProduct] ✅ Copied', data?.length || 0, 'colors');
    return { data, error: null };
  } catch (err) {
    console.error('[copyColorsFromProduct] Exception:', err);
    return { data: null, error: err };
  }
}

export default {
  // Admin
  isUserAdmin,
  isCurrentUserAdmin,

  // Product Templates
  getProductTemplates,
  getProductTemplate,
  createProductTemplate,
  updateProductTemplate,
  deleteProductTemplate,
  
  // Product Template Variants (Color + View Support)
  getProductVariants,
  getProductVariant,
  createProductVariant,
  updateProductVariant,
  deleteProductVariant,
  upsertProductVariant,
  
  // Print Areas
  getPrintAreas,
  createPrintArea,
  updatePrintArea,
  deletePrintArea,
  batchUpdatePrintAreas,
  
  // Print Areas (with Variant Support)
  getPrintAreasByVariant,
  createPrintAreaForVariant,
  batchUpdatePrintAreasForVariant,

  // Print Areas (View-Based, Multiple Per View)
  getPrintAreasByProductView,
  getAllPrintAreasByProduct,
  createPrintAreaForView,
  updatePrintAreaForView,
  deletePrintAreaForView,
  PRINT_AREA_PRESETS,

  // Template Images
  uploadTemplateImage,
  deleteTemplateImage,
  replaceTemplateImage,
  
  // Complete Configuration
  saveProductConfiguration,
  saveVariantConfiguration,
  loadProductConfiguration,
  loadProductVariants,

  // User Design Operations
  getSessionId,
  generateDesignThumbnail,
  saveUserDesign,
  getUserDesigns,
  getUserDesign,
  updateUserDesign,
  deleteUserDesign,
  migrateSessionDesignsToUser,

  // Color Management
  getApparelColors,
  getProductColors,
  assignColorToProduct,
  removeColorFromProduct,
  uploadColorPhoto,
  assignMultipleColors,
  getStandardColorSet,
  copyColorsFromProduct,

  // Overlay Management
  uploadOverlayImage,
  deleteOverlayImage,
  listOverlayImages
};
