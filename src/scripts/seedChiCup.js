/**
 * Seed Chi Cup Product to Catalog
 *
 * Adds the Chi Cup to the catalog database with full product details,
 * pricing tiers, colors, features, specifications, and images.
 *
 * Usage: node src/scripts/seedChiCup.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || (!SUPABASE_ANON_KEY && !SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('❌ Error: Missing Supabase credentials in environment variables');
  console.error('   Need either VITE_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Use service role key if available (bypasses RLS), otherwise use anon key
const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, supabaseKey);

if (SUPABASE_SERVICE_ROLE_KEY) {
  console.log('🔑 Using SERVICE ROLE key (bypasses RLS)');
} else {
  console.log('⚠️  Using ANON key - RLS policies apply (may need admin authentication)');
}

// Chi Cup Product Data
const CHI_CUP_DATA = {
  name: 'Chi Cup',
  slug: 'chi-cup',
  subtitle: 'Premium insulated travel cup with full-wrap branding',
  description: 'The Chi Cup is a premium double-walled insulated travel cup featuring a sleek tapered design perfect for full-wrap custom branding. Its cone-shaped body provides a large, continuous print area ideal for detailed logos, patterns, and promotional designs. Features a secure leak-proof lid with silicone seal, keeping drinks hot for up to 4 hours or cold for up to 8 hours.',
  badge: 'Best Seller',
  rating: 4.8,
  review_count: 342,
  is_featured: true,
  is_customizable: true,
  status: 'active',
  min_order_quantity: 25
};

// Pricing Tiers
const PRICING_TIERS = [
  { min_quantity: 25, max_quantity: 49, price_per_unit: 8.99 },
  { min_quantity: 50, max_quantity: 99, price_per_unit: 7.49 },
  { min_quantity: 100, max_quantity: 249, price_per_unit: 6.49 },
  { min_quantity: 250, max_quantity: 499, price_per_unit: 5.49 },
  { min_quantity: 500, max_quantity: 999, price_per_unit: 4.99 },
  { min_quantity: 1000, max_quantity: null, price_per_unit: 4.49 }
];

// Features
const FEATURES = [
  'Double-walled insulation',
  'Full-wrap print area',
  'Leak-proof lid with silicone seal',
  'BPA & PVC free',
  'Food-grade materials',
  'Dishwasher safe',
  '450ml capacity',
  'Gift box packaging available'
];

// Specifications (JSONB format)
const SPECIFICATIONS = {
  'Capacity': '450ml',
  'Material': 'Double-walled stainless steel',
  'Height': '180mm',
  'Diameter (top)': '85mm',
  'Diameter (bottom)': '65mm',
  'Weight': '280g',
  'Insulation': 'Hot 4hrs / Cold 8hrs',
  'Print Method': 'Full-wrap sublimation',
  'Print Area': '360° wrap around cup body',
  'Lid Material': 'BPA-free plastic with silicone seal'
};

/**
 * Get or create the Cups category
 */
async function ensureCupsCategory() {
  console.log('\n📂 Ensuring Cups category exists...');

  // Check if category exists
  const { data: existingCategory, error: fetchError } = await supabase
    .from('catalog_categories')
    .select('*')
    .eq('slug', 'cups')
    .single();

  if (existingCategory) {
    console.log('✓ Cups category found:', existingCategory.name, '(ID:', existingCategory.id + ')');
    return existingCategory.id;
  }

  // Create category if it doesn't exist
  const { data: newCategory, error: insertError } = await supabase
    .from('catalog_categories')
    .insert({
      name: 'Cups',
      slug: 'cups',
      description: 'Custom branded cups and drinkware',
      icon: '☕',
      sort_order: 1,
      is_active: true
    })
    .select()
    .single();

  if (insertError) {
    throw new Error('Failed to create Cups category: ' + insertError.message);
  }

  console.log('✓ Created Cups category (ID:', newCategory.id + ')');
  return newCategory.id;
}

/**
 * Get the Chi Cup product template ID
 */
async function getChiCupTemplateId() {
  console.log('\n🔍 Looking up Chi Cup product template...');

  const { data, error } = await supabase
    .from('product_templates')
    .select('id, product_key, name')
    .eq('product_key', 'chi-cup')
    .single();

  if (error || !data) {
    throw new Error('Chi Cup template not found in product_templates. Please ensure it exists.');
  }

  console.log('✓ Found Chi Cup template:', data.name, '(ID:', data.id + ')');
  return data.id;
}

/**
 * Get colors from product template variants
 */
async function getChiCupColors(templateId) {
  console.log('\n🎨 Fetching Chi Cup colors from variants...');

  const { data: variants, error } = await supabase
    .from('product_template_variants')
    .select('color_name, color_code')
    .eq('product_template_id', templateId);

  if (error) {
    console.warn('⚠️  Could not fetch variants:', error.message);
    // Return default colors
    return [
      { color_name: 'White', color_code: '#FFFFFF', hex_code: '#FFFFFF' },
      { color_name: 'Black', color_code: '#000000', hex_code: '#000000' }
    ];
  }

  // Get unique colors
  const uniqueColors = [];
  const seen = new Set();

  for (const variant of variants) {
    const key = variant.color_name + '-' + variant.color_code;
    if (!seen.has(key) && variant.color_name && variant.color_code) {
      seen.add(key);
      // color_code is the hex value in this table
      uniqueColors.push({
        color_name: variant.color_name,
        color_code: variant.color_code.toLowerCase().replace('#', ''), // Store code without #
        hex_code: variant.color_code // color_code IS the hex value
      });
    }
  }

  if (uniqueColors.length === 0) {
    // Fallback to default colors
    uniqueColors.push(
      { color_name: 'White', color_code: 'ffffff', hex_code: '#FFFFFF' },
      { color_name: 'Black', color_code: '000000', hex_code: '#000000' }
    );
  }

  console.log('✓ Found', uniqueColors.length, 'colors:', uniqueColors.map(c => c.color_name).join(', '));
  return uniqueColors;
}

/**
 * Get image URLs from product template variants
 */
async function getChiCupImages(templateId) {
  console.log('\n🖼️  Fetching Chi Cup images from variants...');

  const { data: variants, error } = await supabase
    .from('product_template_variants')
    .select('template_url, view_name, color_name')
    .eq('product_template_id', templateId)
    .order('color_name', { ascending: true })
    .order('view_name', { ascending: true });

  if (error || !variants || variants.length === 0) {
    console.warn('⚠️  Could not fetch variant images:', error?.message);
    // Return default image
    return [{
      image_url: 'https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/chi-cup/white-front.png',
      alt_text: 'Chi Cup - White',
      is_primary: true,
      image_type: 'main'
    }];
  }

  const images = [];
  let isPrimary = true;

  for (const variant of variants) {
    if (variant.template_url) {
      images.push({
        image_url: variant.template_url,
        thumbnail_url: variant.template_url,
        alt_text: `Chi Cup - ${variant.color_name} ${variant.view_name || ''}`.trim(),
        is_primary: isPrimary,
        image_type: variant.view_name === 'front' ? 'main' : 'gallery'
      });
      isPrimary = false; // Only first image is primary
    }
  }

  console.log('✓ Found', images.length, 'product images');
  return images;
}

/**
 * Create or update the Chi Cup catalog product
 */
async function seedChiCupProduct() {
  console.log('\n==================================');
  console.log('   CHI CUP CATALOG SEEDING');
  console.log('==================================');
  console.log('Connected to:', SUPABASE_URL);

  try {
    // Step 1: Ensure Cups category exists
    const categoryId = await ensureCupsCategory();

    // Step 2: Get Chi Cup template ID
    const templateId = await getChiCupTemplateId();

    // Step 3: Get colors and images
    const colors = await getChiCupColors(templateId);
    const images = await getChiCupImages(templateId);

    // Step 4: Insert/Update Chi Cup product
    console.log('\n📦 Creating/updating Chi Cup catalog product...');

    const productData = {
      ...CHI_CUP_DATA,
      category_id: categoryId,
      designer_product_id: templateId,
      published_at: new Date().toISOString()
    };

    const { data: product, error: productError } = await supabase
      .from('catalog_products')
      .upsert(productData, { onConflict: 'slug' })
      .select()
      .single();

    if (productError) {
      throw new Error('Failed to create product: ' + productError.message);
    }

    console.log('✓ Created/updated Chi Cup product (ID:', product.id + ')');

    // Step 5: Insert pricing tiers
    console.log('\n💰 Inserting pricing tiers...');

    for (const tier of PRICING_TIERS) {
      const { error } = await supabase
        .from('catalog_pricing_tiers')
        .upsert({
          catalog_product_id: product.id,
          min_quantity: tier.min_quantity,
          max_quantity: tier.max_quantity,
          price_per_unit: tier.price_per_unit,
          is_popular: tier.min_quantity === 100 // Mark 100-249 tier as popular
        }, { onConflict: 'catalog_product_id,min_quantity' });

      if (error) {
        console.error('  ❌ Error inserting tier', tier.min_quantity + '-' + tier.max_quantity + ':', error.message);
      } else {
        console.log('  ✓ Tier', tier.min_quantity + '-' + (tier.max_quantity || '∞') + ':', '£' + tier.price_per_unit);
      }
    }

    // Step 6: Insert features
    console.log('\n✨ Inserting product features...');

    for (let i = 0; i < FEATURES.length; i++) {
      const { error } = await supabase
        .from('catalog_product_features')
        .upsert({
          catalog_product_id: product.id,
          feature_text: FEATURES[i],
          sort_order: i
        }, { onConflict: 'catalog_product_id,feature_text' });

      if (error) {
        console.error('  ❌ Error inserting feature:', error.message);
      } else {
        console.log('  ✓', FEATURES[i]);
      }
    }

    // Step 7: Insert specifications
    console.log('\n📋 Inserting product specifications...');

    const { error: specsError } = await supabase
      .from('catalog_product_specifications')
      .upsert({
        catalog_product_id: product.id,
        specifications: SPECIFICATIONS
      }, { onConflict: 'catalog_product_id' });

    if (specsError) {
      console.error('  ❌ Error inserting specifications:', specsError.message);
    } else {
      console.log('  ✓ Inserted', Object.keys(SPECIFICATIONS).length, 'specifications');
    }

    // Step 8: Insert colors
    console.log('\n🎨 Inserting product colors...');

    for (let i = 0; i < colors.length; i++) {
      const color = colors[i];
      const { error } = await supabase
        .from('catalog_product_colors')
        .upsert({
          catalog_product_id: product.id,
          color_name: color.color_name,
          color_code: color.color_code,
          hex_value: color.hex_code,
          is_active: true,
          sort_order: i
        }, { onConflict: 'catalog_product_id,color_code' });

      if (error) {
        console.error('  ❌ Error inserting color', color.color_name + ':', error.message);
      } else {
        console.log('  ✓', color.color_name, '(' + color.hex_code + ')');
      }
    }

    // Step 9: Insert images
    console.log('\n🖼️  Inserting product images...');

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const { error } = await supabase
        .from('catalog_product_images')
        .upsert({
          catalog_product_id: product.id,
          image_url: image.image_url,
          thumbnail_url: image.thumbnail_url || image.image_url,
          alt_text: image.alt_text,
          is_primary: image.is_primary,
          image_type: image.image_type,
          sort_order: i
        }, { onConflict: 'catalog_product_id,image_url' });

      if (error) {
        console.error('  ❌ Error inserting image:', error.message);
      } else {
        console.log('  ✓', image.alt_text, image.is_primary ? '(PRIMARY)' : '');
      }
    }

    console.log('\n==================================');
    console.log('   ✅ CHI CUP SEEDING COMPLETE!');
    console.log('==================================');
    console.log('\n📍 Product available at:');
    console.log('   - Category page: /cups');
    console.log('   - Product page: /cups/chi-cup');
    console.log('   - Designer: /designer (select Chi Cup)');
    console.log('\n');

  } catch (error) {
    console.error('\n❌ SEEDING FAILED!');
    console.error(error.message);
    console.error(error);
    process.exit(1);
  }
}

/**
 * Helper: Get default hex color for color name
 */
function getDefaultHexForColor(colorName) {
  const colorMap = {
    'White': '#FFFFFF',
    'Black': '#000000',
    'Red': '#DC2626',
    'Blue': '#2563EB',
    'Green': '#16A34A',
    'Yellow': '#EAB308',
    'Orange': '#EA580C',
    'Purple': '#9333EA',
    'Pink': '#EC4899',
    'Grey': '#6B7280',
    'Gray': '#6B7280',
    'Brown': '#92400E',
    'Navy': '#1E3A8A',
    'Lime': '#84CC16',
    'Teal': '#14B8A6',
    'Cyan': '#06B6D4'
  };

  return colorMap[colorName] || '#CCCCCC';
}

// Run the script
seedChiCupProduct();
