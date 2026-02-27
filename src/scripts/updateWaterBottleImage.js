// ============================================
// UPDATE WATER BOTTLE PRIMARY IMAGE
// ============================================
// This script updates the water bottle product's primary image
// to use the white-front.png image from Supabase storage
//
// Usage: node src/scripts/updateWaterBottleImage.js
// ============================================

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Error: Missing Supabase credentials in .env file');
  console.error('Required: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

// Use service role key if available (bypasses RLS), otherwise use anon key
const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, supabaseKey);

console.log('==================================');
console.log('  UPDATE WATER BOTTLE IMAGE');
console.log('==================================');
console.log('Connected to:', SUPABASE_URL);
console.log('Using:', SUPABASE_SERVICE_ROLE_KEY ? 'Service Role Key (bypasses RLS)' : 'Anon Key');
console.log('');

const WHITE_FRONT_IMAGE_URL = 'https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/water-bottle/white-front.png';

async function updateWaterBottleImage() {
  try {
    // Step 1: Find the water bottle product
    console.log('1. Finding water bottle product...');
    const { data: product, error: productError } = await supabase
      .from('catalog_products')
      .select('id, name, slug')
      .eq('slug', 'water-bottle')
      .single();

    if (productError) {
      console.error('❌ Error finding product:', productError.message);
      return;
    }

    if (!product) {
      console.error('❌ Water bottle product not found');
      return;
    }

    console.log('✓ Found product:', product.name, `(${product.slug})`);
    console.log('  Product ID:', product.id);
    console.log('');

    // Step 2: Set all existing images to non-primary
    console.log('2. Resetting all images to non-primary...');
    const { error: resetError } = await supabase
      .from('catalog_product_images')
      .update({ is_primary: false })
      .eq('product_id', product.id);

    if (resetError) {
      console.error('❌ Error resetting images:', resetError.message);
      return;
    }

    console.log('✓ All images set to non-primary');
    console.log('');

    // Step 3: Check if white-front image already exists
    console.log('3. Checking if white-front.png exists...');
    const { data: existingImage, error: checkError } = await supabase
      .from('catalog_product_images')
      .select('*')
      .eq('product_id', product.id)
      .eq('image_url', WHITE_FRONT_IMAGE_URL)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 = not found, which is okay
      console.error('❌ Error checking for existing image:', checkError.message);
      return;
    }

    if (existingImage) {
      // Image exists, update it to primary
      console.log('✓ Image exists, setting as primary...');
      const { error: updateError } = await supabase
        .from('catalog_product_images')
        .update({
          is_primary: true,
          display_order: 0
        })
        .eq('product_id', product.id)
        .eq('image_url', WHITE_FRONT_IMAGE_URL);

      if (updateError) {
        console.error('❌ Error updating image:', updateError.message);
        return;
      }

      console.log('✓ Updated existing image to primary');
    } else {
      // Image doesn't exist, insert it
      console.log('→ Image not found, inserting new image...');
      const { error: insertError } = await supabase
        .from('catalog_product_images')
        .insert({
          product_id: product.id,
          image_url: WHITE_FRONT_IMAGE_URL,
          thumbnail_url: WHITE_FRONT_IMAGE_URL,
          alt_text: 'Water Bottle - White Front View',
          image_type: 'main',
          is_primary: true,
          display_order: 0
        });

      if (insertError) {
        console.error('❌ Error inserting image:', insertError.message);
        return;
      }

      console.log('✓ Inserted new image as primary');
    }

    console.log('');

    // Step 4: Verify the update
    console.log('4. Verifying update...');
    const { data: images, error: verifyError } = await supabase
      .from('catalog_product_images')
      .select('*')
      .eq('product_id', product.id)
      .order('is_primary', { ascending: false })
      .order('display_order', { ascending: true });

    if (verifyError) {
      console.error('❌ Error verifying:', verifyError.message);
      return;
    }

    console.log('✓ Current images for water bottle:');
    images.forEach((img, index) => {
      const isPrimary = img.is_primary ? '⭐ PRIMARY' : '';
      const filename = img.image_url.split('/').pop();
      console.log(`  ${index + 1}. ${filename} ${isPrimary}`);
      console.log(`     Order: ${img.display_order}`);
    });

    console.log('');
    console.log('==================================');
    console.log('  ✓ UPDATE COMPLETED!');
    console.log('==================================');
    console.log('');
    console.log('The water bottle at /water-bottles should now display white-front.png');

  } catch (error) {
    console.error('');
    console.error('!!! UPDATE FAILED !!!');
    console.error(error);
    process.exit(1);
  }
}

// Run the update
updateWaterBottleImage();
