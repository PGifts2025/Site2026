/**
 * Product Catalog Data Seeding Utility
 *
 * This script populates the catalog with initial data extracted from existing product pages.
 * It's idempotent - safe to run multiple times without creating duplicates.
 *
 * Usage:
 *   import { seedAllProducts, clearCatalogData } from './utils/seedCatalogData';
 *
 *   // Seed all data
 *   await seedAllProducts();
 *
 *   // DANGEROUS: Clear all catalog data
 *   await clearCatalogData();
 */

import { getSupabaseClient } from '../services/productCatalogService';

// Get Supabase client
const getClient = () => {
  return getSupabaseClient();
};

// =====================================================
// CATEGORY SEEDING
// =====================================================

/**
 * Seed all catalog categories
 * @returns {Promise<Array>} Array of created/existing categories
 */
export const seedCategories = async () => {
  console.log('\n📁 Seeding categories...');

  const categories = [
    { name: 'Cups', slug: 'cups', icon: '☕', sort_order: 1 },
    { name: 'Water Bottles', slug: 'water-bottles', icon: '🍼', sort_order: 2 },
    { name: 'Bags', slug: 'bags', icon: '👜', sort_order: 3 },
    { name: 'Clothing', slug: 'clothing', icon: '👕', sort_order: 4 },
    { name: 'Hi Vis', slug: 'hi-vis', icon: '🦺', sort_order: 5 },
    { name: 'Cables', slug: 'cables', icon: '🔌', sort_order: 6 },
    { name: 'Power', slug: 'power', icon: '🔋', sort_order: 7 },
    { name: 'Speakers', slug: 'speakers', icon: '🔊', sort_order: 8 },
    { name: 'Pens & Writing', slug: 'pens', icon: '✒️', sort_order: 9 },
    { name: 'Notebooks', slug: 'notebooks', icon: '📓', sort_order: 10 },
    { name: 'Tea Towels', slug: 'tea-towels', icon: '🍽️', sort_order: 11 }
  ];

  const client = getClient();
  const results = [];

  for (const category of categories) {
    try {
      // Check if category already exists
      const { data: existing, error: checkError } = await client
        .from('catalog_categories')
        .select('id, name, slug')
        .eq('slug', category.slug)
        .single();

      if (existing && !checkError) {
        console.log(`  ✓ Category "${category.name}" already exists (${category.slug})`);
        results.push(existing);
        continue;
      }

      // Insert new category
      const { data, error } = await client
        .from('catalog_categories')
        .insert({
          name: category.name,
          slug: category.slug,
          icon: category.icon,
          sort_order: category.sort_order,
          is_active: true
        })
        .select()
        .single();

      if (error) {
        console.error(`  ✗ Failed to create category "${category.name}":`, error.message);
        continue;
      }

      console.log(`  ✓ Created category "${category.name}" (${category.slug})`);
      results.push(data);
    } catch (error) {
      console.error(`  ✗ Error processing category "${category.name}":`, error.message);
    }
  }

  console.log(`\n✅ Categories seeded: ${results.length}/${categories.length}`);
  return results;
};

// =====================================================
// BAGS PRODUCT SEEDING
// =====================================================

/**
 * Seed the "5oz Cotton Bag" product with all related data
 * Data extracted from Bags.jsx
 * @returns {Promise<Object|null>} Created/existing product
 */
export const seedBagsProduct = async () => {
  console.log('\n👜 Seeding Bags product...');

  const client = getClient();

  // Product data extracted from Bags.jsx (corrected description)
  const productData = {
    name: '5oz Cotton Bag',
    slug: '5oz-cotton-bag',
    subtitle: 'Eco-friendly cotton tote with custom printing',
    description: 'Perfect for promotional events, trade shows, and retail. Made from 100% natural cotton with reinforced handles for durability. Ideal for corporate gifts and branded merchandise.',
    rating: 4.8,
    review_count: 2847,
    badge: 'Best Seller',
    status: 'draft',
    is_featured: true,
    is_customizable: false,  // TODO: Set to true and link to designer product when ready
    min_order_quantity: 25,
    designer_product_id: null  // TODO: Link to bag designer template
  };

  const colors = [
    { color_code: 'midnight', color_name: 'Midnight Black', hex_value: '#1a1a1a', sort_order: 1 },
    { color_code: 'steel', color_name: 'Brushed Steel', hex_value: '#c0c0c0', sort_order: 2 },
    { color_code: 'navy', color_name: 'Navy Blue', hex_value: '#1e3a8a', sort_order: 3 },
    { color_code: 'forest', color_name: 'Forest Green', hex_value: '#166534', sort_order: 4 },
    { color_code: 'crimson', color_name: 'Crimson Red', hex_value: '#dc2626', sort_order: 5 }
  ];

  const pricingTiers = [
    { min_quantity: 25, max_quantity: 49, price_per_unit: 24.99, is_popular: false },
    { min_quantity: 50, max_quantity: 99, price_per_unit: 19.99, is_popular: true },
    { min_quantity: 100, max_quantity: 249, price_per_unit: 16.99, is_popular: false },
    { min_quantity: 250, max_quantity: 499, price_per_unit: 14.99, is_popular: false },
    { min_quantity: 500, max_quantity: 999, price_per_unit: 12.99, is_popular: false },
    { min_quantity: 1000, max_quantity: null, price_per_unit: 10.99, is_popular: false }
  ];

  const features = [
    '100% natural cotton',
    'Reinforced handles',
    'Large print area',
    'Eco-friendly material',
    'Machine washable',
    'Durable construction'
  ];

  const specifications = {
    material: '100% Cotton',
    weight: '140g',
    dimensions: '38cm W x 42cm H',
    handleLength: '25cm',
    printArea: '25cm x 20cm',
    capacity: '10 litres'
  };

  try {
    // Get Bags category
    const { data: category, error: categoryError } = await client
      .from('catalog_categories')
      .select('id')
      .eq('slug', 'bags')
      .single();

    if (categoryError || !category) {
      console.error('  ✗ Bags category not found. Run seedCategories() first.');
      return null;
    }

    // Check if product already exists
    const { data: existingProduct, error: checkError } = await client
      .from('catalog_products')
      .select('id, name, slug')
      .eq('slug', productData.slug)
      .single();

    let product = existingProduct;

    if (existingProduct && !checkError) {
      console.log(`  ✓ Product "${productData.name}" already exists (${productData.slug})`);
    } else {
      // Create product
      const { data, error } = await client
        .from('catalog_products')
        .insert({
          ...productData,
          category_id: category.id
        })
        .select()
        .single();

      if (error) {
        console.error('  ✗ Failed to create product:', error.message);
        return null;
      }

      product = data;
      console.log(`  ✓ Created product "${productData.name}"`);
    }

    // Seed colors
    console.log('  📝 Seeding colors...');
    for (const color of colors) {
      const { data: existingColor } = await client
        .from('catalog_product_colors')
        .select('id')
        .eq('catalog_product_id', product.id)
        .eq('color_code', color.color_code)
        .single();

      if (existingColor) {
        console.log(`    ✓ Color "${color.color_name}" already exists`);
        continue;
      }

      const { error } = await client
        .from('catalog_product_colors')
        .insert({
          catalog_product_id: product.id,
          ...color,
          is_active: true
        });

      if (error) {
        console.error(`    ✗ Failed to create color "${color.color_name}":`, error.message);
      } else {
        console.log(`    ✓ Created color "${color.color_name}"`);
      }
    }

    // Seed pricing tiers
    console.log('  💰 Seeding pricing tiers...');
    for (const tier of pricingTiers) {
      const { data: existingTier } = await client
        .from('catalog_pricing_tiers')
        .select('id')
        .eq('catalog_product_id', product.id)
        .eq('min_quantity', tier.min_quantity)
        .single();

      if (existingTier) {
        console.log(`    ✓ Pricing tier ${tier.min_quantity}+ already exists`);
        continue;
      }

      const { error } = await client
        .from('catalog_pricing_tiers')
        .insert({
          catalog_product_id: product.id,
          ...tier
        });

      if (error) {
        console.error(`    ✗ Failed to create pricing tier ${tier.min_quantity}+:`, error.message);
      } else {
        console.log(`    ✓ Created pricing tier ${tier.min_quantity}+ @ £${tier.price_per_unit}`);
      }
    }

    // Seed features
    console.log('  ⭐ Seeding features...');
    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      const { data: existingFeature } = await client
        .from('catalog_product_features')
        .select('id')
        .eq('catalog_product_id', product.id)
        .eq('feature_text', feature)
        .single();

      if (existingFeature) {
        console.log(`    ✓ Feature "${feature}" already exists`);
        continue;
      }

      const { error } = await client
        .from('catalog_product_features')
        .insert({
          catalog_product_id: product.id,
          feature_text: feature,
          sort_order: i
        });

      if (error) {
        console.error(`    ✗ Failed to create feature "${feature}":`, error.message);
      } else {
        console.log(`    ✓ Created feature "${feature}"`);
      }
    }

    // Seed specifications
    console.log('  📋 Seeding specifications...');
    const { data: existingSpecs } = await client
      .from('catalog_product_specifications')
      .select('id')
      .eq('catalog_product_id', product.id)
      .single();

    if (existingSpecs) {
      console.log('    ✓ Specifications already exist');
    } else {
      const { error } = await client
        .from('catalog_product_specifications')
        .insert({
          catalog_product_id: product.id,
          specifications: specifications
        });

      if (error) {
        console.error('    ✗ Failed to create specifications:', error.message);
      } else {
        console.log('    ✓ Created specifications');
      }
    }

    // Seed placeholder images
    console.log('  🖼️  Seeding placeholder images...');
    for (let i = 1; i <= 4; i++) {
      const { data: existingImage } = await client
        .from('catalog_product_images')
        .select('id')
        .eq('catalog_product_id', product.id)
        .eq('sort_order', i - 1)
        .single();

      if (existingImage) {
        console.log(`    ✓ Image ${i} already exists`);
        continue;
      }

      const { error } = await client
        .from('catalog_product_images')
        .insert({
          catalog_product_id: product.id,
          image_url: `/placeholder/bags/5oz-cotton-bag-${i}.jpg`,
          thumbnail_url: `/placeholder/bags/5oz-cotton-bag-${i}-thumb.jpg`,
          medium_url: `/placeholder/bags/5oz-cotton-bag-${i}-medium.jpg`,
          large_url: `/placeholder/bags/5oz-cotton-bag-${i}-large.jpg`,
          alt_text: `5oz Cotton Bag - View ${i}`,
          image_type: i === 1 ? 'main' : 'gallery',
          sort_order: i - 1,
          is_primary: i === 1
        });

      if (error) {
        console.error(`    ✗ Failed to create image ${i}:`, error.message);
      } else {
        console.log(`    ✓ Created placeholder image ${i}`);
      }
    }

    console.log('\n✅ Bags product seeded successfully!');
    return product;
  } catch (error) {
    console.error('  ✗ Error seeding Bags product:', error.message);
    return null;
  }
};

// =====================================================
// CUPS PRODUCT SEEDING
// =====================================================

/**
 * Seed the "Premium Vacuum Flask" product with all related data
 * Data extracted from Cups.jsx
 * @returns {Promise<Object|null>} Created/existing product
 */
export const seedCupsProduct = async () => {
  console.log('\n☕ Seeding Cups product...');

  const client = getClient();

  // Product data extracted from Cups.jsx
  const productData = {
    name: 'Premium Vacuum Flask',
    slug: 'premium-vacuum-flask',
    subtitle: 'Double-walled stainless steel with custom branding',
    description: 'Experience premium quality with our flagship vacuum flask. Perfect for corporate gifts, events, and promotional campaigns. Keeps beverages hot or cold for up to 24 hours.',
    rating: 4.8,
    review_count: 2847,
    badge: 'Best Seller',
    status: 'draft',
    is_featured: true,
    is_customizable: false,
    min_order_quantity: 25,
    designer_product_id: null
  };

  const colors = [
    { color_code: 'midnight', color_name: 'Midnight Black', hex_value: '#1a1a1a', sort_order: 1 },
    { color_code: 'steel', color_name: 'Brushed Steel', hex_value: '#c0c0c0', sort_order: 2 },
    { color_code: 'navy', color_name: 'Navy Blue', hex_value: '#1e3a8a', sort_order: 3 },
    { color_code: 'forest', color_name: 'Forest Green', hex_value: '#166534', sort_order: 4 },
    { color_code: 'crimson', color_name: 'Crimson Red', hex_value: '#dc2626', sort_order: 5 }
  ];

  const pricingTiers = [
    { min_quantity: 25, max_quantity: 49, price_per_unit: 24.99, is_popular: false },
    { min_quantity: 50, max_quantity: 99, price_per_unit: 19.99, is_popular: true },
    { min_quantity: 100, max_quantity: 249, price_per_unit: 16.99, is_popular: false },
    { min_quantity: 250, max_quantity: 499, price_per_unit: 14.99, is_popular: false },
    { min_quantity: 500, max_quantity: 999, price_per_unit: 12.99, is_popular: false },
    { min_quantity: 1000, max_quantity: null, price_per_unit: 10.99, is_popular: false }
  ];

  const features = [
    '24-hour hot/cold retention',
    'Premium 304 stainless steel',
    'Leak-proof design',
    'BPA & PVC free',
    'Laser engraving included',
    'Gift box packaging'
  ];

  const specifications = {
    capacity: '500ml',
    material: 'Stainless Steel 304',
    dimensions: '26cm H x 7cm W',
    weight: '350g',
    printArea: '40mm x 15mm',
    retention: '24 hours hot/cold'
  };

  try {
    // Get Cups category
    const { data: category, error: categoryError } = await client
      .from('catalog_categories')
      .select('id')
      .eq('slug', 'cups')
      .single();

    if (categoryError || !category) {
      console.error('  ✗ Cups category not found. Run seedCategories() first.');
      return null;
    }

    // Check if product already exists
    const { data: existingProduct, error: checkError } = await client
      .from('catalog_products')
      .select('id, name, slug')
      .eq('slug', productData.slug)
      .single();

    let product = existingProduct;

    if (existingProduct && !checkError) {
      console.log(`  ✓ Product "${productData.name}" already exists (${productData.slug})`);
    } else {
      // Create product
      const { data, error } = await client
        .from('catalog_products')
        .insert({
          ...productData,
          category_id: category.id
        })
        .select()
        .single();

      if (error) {
        console.error('  ✗ Failed to create product:', error.message);
        return null;
      }

      product = data;
      console.log(`  ✓ Created product "${productData.name}"`);
    }

    // Seed colors
    console.log('  📝 Seeding colors...');
    for (const color of colors) {
      const { data: existingColor } = await client
        .from('catalog_product_colors')
        .select('id')
        .eq('catalog_product_id', product.id)
        .eq('color_code', color.color_code)
        .single();

      if (existingColor) {
        console.log(`    ✓ Color "${color.color_name}" already exists`);
        continue;
      }

      const { error } = await client
        .from('catalog_product_colors')
        .insert({
          catalog_product_id: product.id,
          ...color,
          is_active: true
        });

      if (error) {
        console.error(`    ✗ Failed to create color "${color.color_name}":`, error.message);
      } else {
        console.log(`    ✓ Created color "${color.color_name}"`);
      }
    }

    // Seed pricing tiers
    console.log('  💰 Seeding pricing tiers...');
    for (const tier of pricingTiers) {
      const { data: existingTier } = await client
        .from('catalog_pricing_tiers')
        .select('id')
        .eq('catalog_product_id', product.id)
        .eq('min_quantity', tier.min_quantity)
        .single();

      if (existingTier) {
        console.log(`    ✓ Pricing tier ${tier.min_quantity}+ already exists`);
        continue;
      }

      const { error } = await client
        .from('catalog_pricing_tiers')
        .insert({
          catalog_product_id: product.id,
          ...tier
        });

      if (error) {
        console.error(`    ✗ Failed to create pricing tier ${tier.min_quantity}+:`, error.message);
      } else {
        console.log(`    ✓ Created pricing tier ${tier.min_quantity}+ @ £${tier.price_per_unit}`);
      }
    }

    // Seed features
    console.log('  ⭐ Seeding features...');
    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      const { data: existingFeature } = await client
        .from('catalog_product_features')
        .select('id')
        .eq('catalog_product_id', product.id)
        .eq('feature_text', feature)
        .single();

      if (existingFeature) {
        console.log(`    ✓ Feature "${feature}" already exists`);
        continue;
      }

      const { error } = await client
        .from('catalog_product_features')
        .insert({
          catalog_product_id: product.id,
          feature_text: feature,
          sort_order: i
        });

      if (error) {
        console.error(`    ✗ Failed to create feature "${feature}":`, error.message);
      } else {
        console.log(`    ✓ Created feature "${feature}"`);
      }
    }

    // Seed specifications
    console.log('  📋 Seeding specifications...');
    const { data: existingSpecs } = await client
      .from('catalog_product_specifications')
      .select('id')
      .eq('catalog_product_id', product.id)
      .single();

    if (existingSpecs) {
      console.log('    ✓ Specifications already exist');
    } else {
      const { error } = await client
        .from('catalog_product_specifications')
        .insert({
          catalog_product_id: product.id,
          specifications: specifications
        });

      if (error) {
        console.error('    ✗ Failed to create specifications:', error.message);
      } else {
        console.log('    ✓ Created specifications');
      }
    }

    // Seed placeholder images
    console.log('  🖼️  Seeding placeholder images...');
    for (let i = 1; i <= 4; i++) {
      const { data: existingImage } = await client
        .from('catalog_product_images')
        .select('id')
        .eq('catalog_product_id', product.id)
        .eq('sort_order', i - 1)
        .single();

      if (existingImage) {
        console.log(`    ✓ Image ${i} already exists`);
        continue;
      }

      const { error } = await client
        .from('catalog_product_images')
        .insert({
          catalog_product_id: product.id,
          image_url: `/placeholder/cups/premium-vacuum-flask-${i}.jpg`,
          thumbnail_url: `/placeholder/cups/premium-vacuum-flask-${i}-thumb.jpg`,
          medium_url: `/placeholder/cups/premium-vacuum-flask-${i}-medium.jpg`,
          large_url: `/placeholder/cups/premium-vacuum-flask-${i}-large.jpg`,
          alt_text: `Premium Vacuum Flask - View ${i}`,
          image_type: i === 1 ? 'main' : 'gallery',
          sort_order: i - 1,
          is_primary: i === 1
        });

      if (error) {
        console.error(`    ✗ Failed to create image ${i}:`, error.message);
      } else {
        console.log(`    ✓ Created placeholder image ${i}`);
      }
    }

    console.log('\n✅ Cups product seeded successfully!');
    return product;
  } catch (error) {
    console.error('  ✗ Error seeding Cups product:', error.message);
    return null;
  }
};

// =====================================================
// MASTER SEEDING FUNCTION
// =====================================================

/**
 * Seed all catalog data in correct order
 * @returns {Promise<Object>} Summary of seeding results
 */
export const seedAllProducts = async () => {
  console.log('\n🌱 ========================================');
  console.log('🌱 PRODUCT CATALOG DATA SEEDING STARTED');
  console.log('🌱 ========================================\n');

  const startTime = Date.now();
  const results = {
    categories: null,
    bagsProduct: null,
    cupsProduct: null,
    errors: []
  };

  try {
    // Step 1: Seed categories
    results.categories = await seedCategories();

    // Step 2: Seed Bags product
    results.bagsProduct = await seedBagsProduct();

    // Step 3: Seed Cups product
    results.cupsProduct = await seedCupsProduct();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n🌱 ========================================');
    console.log('🌱 SEEDING COMPLETE!');
    console.log('🌱 ========================================');
    console.log(`\n⏱️  Time taken: ${duration}s`);
    console.log('\n📊 Summary:');
    console.log(`  - Categories: ${results.categories?.length || 0}/11`);
    console.log(`  - Bags product: ${results.bagsProduct ? '✓' : '✗'}`);
    console.log(`  - Cups product: ${results.cupsProduct ? '✓' : '✗'}`);

    console.log('\n💡 Next steps:');
    console.log('  1. Review seeded data in Supabase dashboard');
    console.log('  2. Upload real product images to catalog-images bucket');
    console.log('  3. Update image URLs in catalog_product_images table');
    console.log('  4. Link products to designer templates (update designer_product_id)');
    console.log('  5. Publish products (change status from draft to active)');
    console.log('  6. Test product pages with real data\n');

    return results;
  } catch (error) {
    console.error('\n❌ Fatal error during seeding:', error);
    results.errors.push(error.message);
    throw error;
  }
};

// =====================================================
// CLEAR DATA FUNCTION (DANGEROUS!)
// =====================================================

/**
 * ⚠️  DANGEROUS: Clear all catalog data
 * This will delete ALL products, categories, and related data.
 * Use with extreme caution - only for development resets.
 *
 * @param {boolean} confirm - Must pass true to confirm deletion
 * @returns {Promise<void>}
 */
export const clearCatalogData = async (confirm = false) => {
  if (!confirm) {
    console.error('\n❌ clearCatalogData() requires explicit confirmation!');
    console.error('Usage: clearCatalogData(true)');
    console.error('\n⚠️  WARNING: This will delete ALL catalog data!');
    return;
  }

  console.log('\n🗑️  ========================================');
  console.log('🗑️  CLEARING ALL CATALOG DATA...');
  console.log('🗑️  ========================================\n');

  const client = getClient();
  const tables = [
    'catalog_product_specifications',
    'catalog_product_features',
    'catalog_pricing_tiers',
    'catalog_product_images',
    'catalog_product_colors',
    'catalog_products',
    'catalog_categories'
  ];

  for (const table of tables) {
    try {
      const { error } = await client
        .from(table)
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all except impossible UUID

      if (error) {
        console.error(`  ✗ Failed to clear ${table}:`, error.message);
      } else {
        console.log(`  ✓ Cleared ${table}`);
      }
    } catch (error) {
      console.error(`  ✗ Error clearing ${table}:`, error.message);
    }
  }

  console.log('\n✅ All catalog data cleared!\n');
  console.log('💡 Run seedAllProducts() to repopulate data.\n');
};

// =====================================================
// EXPORT ALL FUNCTIONS
// =====================================================

export default {
  seedCategories,
  seedBagsProduct,
  seedCupsProduct,
  seedAllProducts,
  clearCatalogData
};
