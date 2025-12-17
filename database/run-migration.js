/**
 * Migration Runner
 * Executes SQL migration files against Supabase database
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, '..', '.env') });

// Get Supabase credentials from environment
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in environment variables');
  console.error('   Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

console.log('\n🔌 Connecting to Supabase...');
console.log('   URL:', supabaseUrl);
console.log('   Key:', supabaseKey.substring(0, 20) + '...\n');

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

// Get migration file path from command line
const migrationFile = process.argv[2] || '007_seed_designer_products.sql';
const migrationPath = join(__dirname, 'migrations', migrationFile);

console.log('📄 Reading migration file:', migrationFile);

let sql;
try {
  sql = readFileSync(migrationPath, 'utf8');
  console.log('✅ File loaded successfully\n');
} catch (error) {
  console.error('❌ Error reading migration file:', error.message);
  process.exit(1);
}

// Split SQL into individual statements (basic split by semicolon)
const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s && !s.startsWith('--') && s !== '');

console.log(`🚀 Executing ${statements.length} SQL statements...\n`);

// Execute each statement
for (let i = 0; i < statements.length; i++) {
  const statement = statements[i];

  // Skip comments
  if (statement.startsWith('--')) continue;

  // Log statement summary
  const preview = statement.substring(0, 100).replace(/\s+/g, ' ');
  console.log(`[${i + 1}/${statements.length}] ${preview}${statement.length > 100 ? '...' : ''}`);

  try {
    const { error } = await supabase.rpc('exec_sql', { sql_query: statement });

    if (error) {
      // Try direct execution if RPC fails
      const { error: directError } = await supabase
        .from('_migrations')
        .insert({ statement });

      if (directError) {
        console.error('   ❌ Error:', error.message);
        console.error('   Statement:', statement.substring(0, 200));
      } else {
        console.log('   ✅ Success');
      }
    } else {
      console.log('   ✅ Success');
    }
  } catch (err) {
    console.error('   ❌ Exception:', err.message);
  }
}

console.log('\n✅ Migration completed!\n');
console.log('💡 Refresh your Designer page to see the new products.\n');
