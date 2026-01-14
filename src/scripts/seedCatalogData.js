/**
 * Seed Catalog Data Script
 *
 * Populates catalog tables from existing product_templates data
 *
 * Usage: node src/scripts/seedCatalogData.js
 * Or: Add button in admin panel to trigger this
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Error: Missing Supabase credentials in environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Category definitions
const CATEGORIES = [
  { name: 'Bags', slug: 'bags', description: 'Premium branded bags for your promotional needs' },
  { name: 'Cups', slug: 'cups', description: 'Custom branded cups and drinkware' },
  { name: 'Water Bottles', slug: 'water-bottles', description: 'Promotional water bottles and flasks' },
  { name: 'Clothing', slug: 'clothing', description: 'Branded apparel and workwear' },
  { name: 'Cables', slug: 'cables', description: 'Premium branded charging cables and accessories' },
  { name: 'Power', slug: 'power', description: 'Portable power banks and chargers' },
  { name: 'Hi Vis', slug: 'hi-vis', description: 'High visibility safety wear' },
  { name: 'Notebooks', slug: 'notebooks', description: 'Custom branded notebooks and stationery' },
  { name: 'Tea Towels', slug: 'tea-towels', description: 'Promotional tea towels and textiles' },
  { name: 'Pens & Writing', slug: 'pens-writing', description: 'Branded pens and writing instruments' },
  { name: 'Speakers', slug: 'speakers', description: 'Promotional speakers and audio' }
];

// Features by category
const CATEGORY_FEATURES = {
  'bags': [
    'Durable cotton material',
    'Large print area',
    'Reinforced handles',
    'Multiple colors available',
    'Eco-friendly materials',
    'Machine washable'
  ],
  'cups': [
    'Food-safe materials',
    'Dishwasher safe',
    'Insulated design',
    'Leak-proof lid',
    'Multiple sizes available',
    'BPA-free'
  ],
  'water-bottles': [
    'BPA-free materials',
    'Leak-proof design',
    'Easy to clean',
    'Multiple capacities',
    'Temperature retention',
    'Durable construction'
  ],
  'clothing': [
    'Premium quality fabric',
    'Multiple sizes available',
    'Professional finish',
    'Machine washable',
    'Color-fast dyes',
    'Comfortable fit'
  ],
  'cables': [
    'Fast charging support',
    'Premium materials',
    'Compact design',
    'Universal compatibility',
    'Durable construction',
    'Multiple connectors'
  ],
  'power': [
    'High capacity battery',
    'Fast charging support',
    'Multiple device charging',
    'LED indicators',
    'Compact & portable',
    'Safety certified'
  ],
  'hi-vis': [
    'High visibility materials',
    'EN ISO 20471 compliant',
    'Durable construction',
    'Reflective strips',
    'Multiple sizes',
    'Machine washable'
  ],
  'notebooks': [
    'Premium paper quality',
    'Durable binding',
    'Multiple page counts',
    'Customizable covers',
    'Eco-friendly options',
    'Professional finish'
  ],
  'tea-towels': [
    'Premium cotton fabric',
    'Large print area',
    'Machine washable',
    'Color-fast printing',
    'Durable hemming',
    'Multiple designs'
  ],
  'pens-writing': [
    'Smooth writing experience',
    'Premium ink quality',
    'Comfortable grip',
    'Multiple colors',
    'Refillable options',
    'Professional appearance'
  ],
  'speakers': [
    'Bluetooth connectivity',
    'Long battery life',
    'Compact design',
    'Clear sound quality',
    'Water resistant',
    'USB charging'
  ]
};

// Generate pricing tiers for a product
function generatePricingTiers(basePrice) {
  return [
    { min_quantity: 25, max_quantity: 49, price_per_unit: basePrice },
    { min_quantity: 50, max_quantity: 99, price_per_unit: (basePrice * 0.9).toFixed(2) },
    { min_quantity: 100, max_quantity: 249, price_per_unit: (basePrice * 0.8).toFixed(2) },
    { min_quantity: 250, max_quantity: 499, price_per_unit: (basePrice * 0.7).toFixed(2) },
    { min_quantity: 500, max_quantity: null, price_per_unit: (basePrice * 0.6).toFixed(2) }
  ];
}

// Generate random rating between 4.5 and 4.9
function generateRating() {
  return (Math.random() * 0.4 + 4.5).toFixed(1);
}

// Generate random review count between 50 and 500
function generateReviewCount() {
  return Math.floor(Math.random() * 450) + 50;
}

// Map product_templates category to catalog category
function mapCategory(templateCategory) {
  const mapping = {
    'Bags': 'bags',
    'Cups': 'cups',
    'Water Bottles': 'water-bottles',
    'Clothing': 'clothing',
    'Cables': 'cables',
    'Power': 'power',
    'Hi-Vis': 'hi-vis',
    'Notebooks': 'notebooks',
    'Tea Towels': 'tea-towels',
    'Pens': 'pens-writing',
    'Speakers': 'speakers'
  };

  return mapping[templateCategory] || 'bags';
}

// Generate subtitle based on product name and category
function generateSubtitle(name, categorySlug) {
  const subtitles = {
    'bags': 'Premium branded promotional bag',
    'cups': 'Custom branded drinkware',
    'water-bottles': 'Promotional water bottle',
    'clothing': 'Professional branded apparel',
    'cables': 'Premium charging solution',
    'power': 'Portable power bank',
    'hi-vis': 'High visibility safety wear',
    'notebooks': 'Custom branded notebook',
    'tea-towels': 'Promotional tea towel',
    'pens-writing': 'Quality writing instrument',
    'speakers': 'Bluetooth speaker'
  };

  return subtitles[categorySlug] || 'Premium promotional product';
}

// Assign badges to products
function assignBadge(index, name, categorySlug) {
  // First product in each category is Best Seller
  if (index === 0) return 'Best Seller';

  const lowerName = name.toLowerCase();

  // Eco-friendly badges
  if (lowerName.includes('eco') ||
      lowerName.includes('recycled') ||
      lowerName.includes('bio')) {
    return 'Eco-Friendly';
  }

  // Other badges
  if (lowerName.includes('premium')) return 'Premium';
  if (lowerName.includes('fast')) return 'Fast Charge';

  return null;
}

async function seedCategories() {
  console.log('\n=== Seeding Categories ===');

  for (const category of CATEGORIES) {
    const result = await supabase
      .from('catalog_categories')
      .upsert(category, { onConflict: 'slug' })
      .select();

    if (result.error) {
      console.error('Error inserting category ' + category.slug + ':', result.error);
    } else {
      console.log('✓ Inserted/Updated category: ' + category.name + ' (' + category.slug + ')');
    }
  }
}

async function seedProducts() {
  console.log('\n=== Seeding Products ===');

  // Fetch all product templates
  const templatesResult = await supabase
    .from('product_templates')
    .select('*')
    .order('created_at', { ascending: true });

  if (templatesResult.error) {
    console.error('Error fetching product templates:', templatesResult.error);
    return;
  }

  const templates = templatesResult.data;
  console.log('Found ' + templates.length + ' product templates');

  // Fetch categories to get their IDs
  const categoriesResult = await supabase
    .from('catalog_categories')
    .select('*');

  if (categoriesResult.error) {
    console.error('Error fetching categories:', categoriesResult.error);
    return;
  }

  const categories = categoriesResult.data;
  const categoryMap = {};
  categories.forEach(cat => {
    categoryMap[cat.slug] = cat.id;
  });

  // Group templates by category for badge assignment
  const templatesByCategory = {};
  templates.forEach(template => {
    const categorySlug = mapCategory(template.category);
    if (!templatesByCategory[categorySlug]) {
      templatesByCategory[categorySlug] = [];
    }
    templatesByCategory[categorySlug].push(template);
  });

  // Process each template
  for (const template of templates) {
    const categorySlug = mapCategory(template.category);
    const categoryId = categoryMap[categorySlug];

    if (!categoryId) {
      console.warn('Warning: No category found for ' + template.category);
      continue;
    }

    // Determine badge
    const categoryIndex = templatesByCategory[categorySlug].indexOf(template);
    const badge = assignBadge(categoryIndex, template.name, categorySlug);

    // Create catalog product
    const catalogProduct = {
      category_id: categoryId,
      name: template.name,
      slug: template.product_key,
      subtitle: generateSubtitle(template.name, categorySlug),
      description: 'Premium ' + template.name.toLowerCase() + ' perfect for promotional campaigns, corporate gifts, and brand awareness. Features high-quality materials and excellent print quality for your logo.',
      badge: badge,
      rating: parseFloat(generateRating()),
      review_count: generateReviewCount(),
      status: 'active',
      min_order_quantity: 25,
      product_key: template.product_key,
      designer_product_id: template.id
    };

    const productResult = await supabase
      .from('catalog_products')
      .upsert(catalogProduct, { onConflict: 'slug' })
      .select()
      .single();

    if (productResult.error) {
      console.error('Error inserting product ' + template.name + ':', productResult.error);
      continue;
    }

    const product = productResult.data;
    console.log('✓ Inserted/Updated product: ' + template.name);

    // Insert pricing tiers
    await seedPricingTiers(product.id, 4.50); // Base price, adjust as needed

    // Insert features
    await seedFeatures(product.id, categorySlug);

    // Insert images from variants
    await seedImages(product.id, template.id);

    // Insert colors from variants
    await seedColors(product.id, template.id);

    // Insert specifications
    await seedSpecifications(product.id, categorySlug);
  }
}

async function seedPricingTiers(productId, basePrice) {
  const tiers = generatePricingTiers(basePrice);

  for (const tier of tiers) {
    const result = await supabase
      .from('catalog_pricing_tiers')
      .upsert({
        product_id: productId,
        min_quantity: tier.min_quantity,
        max_quantity: tier.max_quantity,
        price_per_unit: parseFloat(tier.price_per_unit)
      }, { onConflict: 'product_id,min_quantity' });

    if (result.error) {
      console.error('  Error inserting pricing tier:', result.error);
    }
  }

  console.log('  ✓ Inserted ' + tiers.length + ' pricing tiers');
}

async function seedFeatures(productId, categorySlug) {
  const features = CATEGORY_FEATURES[categorySlug] || CATEGORY_FEATURES['bags'];

  for (let i = 0; i < features.length; i++) {
    const result = await supabase
      .from('catalog_product_features')
      .upsert({
        product_id: productId,
        feature_text: features[i],
        display_order: i
      }, { onConflict: 'product_id,feature_text' });

    if (result.error) {
      console.error('  Error inserting feature:', result.error);
    }
  }

  console.log('  ✓ Inserted ' + features.length + ' features');
}

async function seedImages(productId, templateId) {
  // Fetch variants for this template
  const variantsResult = await supabase
    .from('product_template_variants')
    .select('*')
    .eq('product_template_id', templateId)
    .limit(5);

  if (variantsResult.error || !variantsResult.data || variantsResult.data.length === 0) {
    console.log('  ! No variants found for product');
    return;
  }

  const variants = variantsResult.data;

  // Insert images from variants
  let imageCount = 0;
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    if (variant.template_url) {
      const result = await supabase
        .from('catalog_product_images')
        .upsert({
          product_id: productId,
          image_url: variant.template_url,
          thumbnail_url: variant.template_url,
          alt_text: 'Product image ' + (i + 1),
          is_primary: i === 0,
          display_order: i
        }, { onConflict: 'product_id,image_url' });

      if (!result.error) imageCount++;
    }
  }

  console.log('  ✓ Inserted ' + imageCount + ' images');
}

async function seedColors(productId, templateId) {
  // Fetch unique colors from variants
  const variantsResult = await supabase
    .from('product_template_variants')
    .select('color_name, color_code')
    .eq('product_template_id', templateId);

  if (variantsResult.error || !variantsResult.data || variantsResult.data.length === 0) {
    return;
  }

  const variants = variantsResult.data;

  // Get unique colors
  const uniqueColors = [];
  const seen = new Set();

  for (const variant of variants) {
    const key = variant.color_name + '-' + variant.color_code;
    if (!seen.has(key) && variant.color_name && variant.color_code) {
      seen.add(key);
      uniqueColors.push({
        color_name: variant.color_name,
        color_code: variant.color_code,
        hex_code: getHexForColor(variant.color_name)
      });
    }
  }

  // Insert colors
  for (let i = 0; i < uniqueColors.length; i++) {
    const color = uniqueColors[i];
    const result = await supabase
      .from('catalog_product_colors')
      .upsert({
        product_id: productId,
        color_name: color.color_name,
        color_code: color.color_code,
        hex_code: color.hex_code,
        is_available: true,
        display_order: i
      }, { onConflict: 'product_id,color_code' });

    if (result.error) {
      console.error('  Error inserting color:', result.error);
    }
  }

  console.log('  ✓ Inserted ' + uniqueColors.length + ' colors');
}

async function seedSpecifications(productId, categorySlug) {
  // Generic specifications based on category
  const specs = {
    'bags': {
      dimensions: '38cm x 42cm',
      material: 'Cotton',
      weight: '140g',
      print_area: '20cm x 25cm'
    },
    'cups': {
      capacity: '350ml',
      material: 'Ceramic',
      dimensions: '9cm diameter x 10cm height',
      dishwasher_safe: 'Yes'
    },
    'water-bottles': {
      capacity: '500ml',
      material: 'BPA-free plastic',
      dimensions: '21cm x 7cm diameter',
      weight: '120g'
    },
    'clothing': {
      material: '100% Cotton',
      sizes: 'S, M, L, XL, XXL',
      weight: '180gsm',
      fit: 'Regular'
    },
    'cables': {
      length: '13cm',
      connectors: 'USB-A, USB-C, Lightning',
      material: 'Recycled plastic',
      weight: '12g'
    }
  };

  const categorySpecs = specs[categorySlug] || specs['bags'];
  let order = 0;

  for (const key in categorySpecs) {
    const value = categorySpecs[key];
    const result = await supabase
      .from('catalog_product_specifications')
      .upsert({
        product_id: productId,
        spec_key: key,
        spec_value: value,
        display_order: order++
      }, { onConflict: 'product_id,spec_key' });

    if (result.error) {
      console.error('  Error inserting specification:', result.error);
    }
  }

  console.log('  ✓ Inserted ' + Object.keys(categorySpecs).length + ' specifications');
}

// Helper function to get hex color from color name
function getHexForColor(colorName) {
  const colorMap = {
    'Black': '#000000',
    'White': '#FFFFFF',
    'Red': '#FF0000',
    'Blue': '#0000FF',
    'Green': '#00FF00',
    'Yellow': '#FFFF00',
    'Orange': '#FFA500',
    'Purple': '#800080',
    'Pink': '#FFC0CB',
    'Grey': '#808080',
    'Gray': '#808080',
    'Brown': '#A52A2A',
    'Navy': '#000080',
    'Lime': '#00FF00',
    'Teal': '#008080',
    'Cyan': '#00FFFF',
    'Magenta': '#FF00FF'
  };

  return colorMap[colorName] || '#CCCCCC';
}

// Main execution
async function main() {
  console.log('==================================');
  console.log('   CATALOG DATA SEEDING SCRIPT    ');
  console.log('==================================');
  console.log('Connected to: ' + SUPABASE_URL);

  try {
    await seedCategories();
    await seedProducts();

    console.log('\n==================================');
    console.log('   ✓ SEEDING COMPLETED!          ');
    console.log('==================================\n');
  } catch (error) {
    console.error('\n!!! SEEDING FAILED !!!');
    console.error(error);
    process.exit(1);
  }
}

main();
