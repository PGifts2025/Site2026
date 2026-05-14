/**
 * Read-only probe for session 9 Task 2 investigation.
 */
import { config } from 'dotenv';
config();

const PROJECT_REF = 'cbcevjhvgmxrxeeyldza';
const token = process.env.SUPABASE_ACCESS_TOKEN;

async function sql(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text}`);
  return JSON.parse(text);
}

// --- 1. AF0001 ---
console.log('=== 1. AF0001 (Apparel) ===');
const af = await sql(`
  SELECT supplier_product_code, name, category, sub_category, print_details
  FROM supplier_products WHERE supplier_product_code='AF0001' LIMIT 1;
`);
console.log(`name=${af[0]?.name} | ${af[0]?.category} > ${af[0]?.sub_category}`);
console.log('\nprint_details (normalised):');
console.log(JSON.stringify(af[0]?.print_details, null, 2));

// --- raw_payload.PrintDetails for AF0001 ---
console.log('\n--- raw_payload.PrintDetails for AF0001 (full) ---');
const afRaw = await sql(`
  SELECT raw_payload->'PrintDetails' AS print_details_raw
  FROM supplier_products WHERE supplier_product_code='AF0001' LIMIT 1;
`);
console.log(JSON.stringify(afRaw[0]?.print_details_raw, null, 2));

// --- 2. Comparison apparel/bag codes ---
console.log('\n\n=== 2. Comparison codes ===');
const candidates = await sql(`
  SELECT sp.supplier_product_code AS code, sp.name AS pname, sp.category, sp.sub_category
  FROM supplier_products sp
  JOIN suppliers s ON s.id = sp.supplier_id
  WHERE s.slug = 'laltex'
    AND sp.supplier_product_code <> 'AF0001'
    AND sp.category IN ('Clothing', 'Apparel', 'Workwear', 'Bags', 'Hi-Vis', 'Headwear')
  ORDER BY sp.supplier_product_code
  LIMIT 8;
`);
console.log('Candidates:', candidates.map(r => `${r.code}(${r.category})`).join(', '));

const picks = candidates.slice(0, 3).map(r => r.code);
for (const code of picks) {
  const rows = await sql(`
    SELECT supplier_product_code, name, category, sub_category, print_details,
           raw_payload->'PrintDetails' AS print_details_raw
    FROM supplier_products WHERE supplier_product_code='${code}' LIMIT 1;
  `);
  const r = rows[0];
  console.log(`\n--- ${r.supplier_product_code} (${r.category} > ${r.sub_category}) ---`);
  console.log('print_details (normalised, first 2 positions):');
  console.log(JSON.stringify((r.print_details || []).slice(0, 2), null, 2));
  console.log('raw_payload.PrintDetails (first 1 position):');
  console.log(JSON.stringify((r.print_details_raw || []).slice(0, 1), null, 2));
}

// --- 3. Corpus scan: multi-size = multiple print_details rows w/ same print_position ---
console.log('\n\n=== 3. Corpus-level multi-size scan ===');

// AF0001 positions × sizes summary
console.log('--- AF0001 positions x sizes summary ---');
const afSummary = await sql(`
  SELECT pd->>'print_position' AS print_position,
         pd->>'print_area' AS print_area,
         pd->>'print_type' AS print_type,
         pd->>'print_class' AS print_class,
         (pd->'default_print_option')::text AS is_default,
         pd->'print_price'->0->>'price' AS first_tier_price,
         pd->'print_price'->0->>'min_qty' AS first_tier_min_qty
  FROM supplier_products sp,
       LATERAL jsonb_array_elements(sp.print_details) AS pd
  WHERE sp.supplier_product_code = 'AF0001'
  ORDER BY pd->>'print_position', pd->>'print_area';
`);
console.log(JSON.stringify(afSummary, null, 2));

// Corpus frequency: how many products have ≥1 position with ≥2 sizes
console.log('\n--- Corpus: products with multi-size positions ---');
const corpusFreq = await sql(`
  WITH per_position AS (
    SELECT sp.supplier_product_code,
           sp.category,
           pd->>'print_position' AS pos,
           COUNT(*) AS sizes_at_position
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         LATERAL jsonb_array_elements(sp.print_details) AS pd
    WHERE s.slug = 'laltex'
      AND pd ? 'print_position'
    GROUP BY sp.supplier_product_code, sp.category, pd->>'print_position'
  ),
  per_product AS (
    SELECT supplier_product_code, category,
           MAX(sizes_at_position) AS max_sizes_per_position
    FROM per_position
    GROUP BY supplier_product_code, category
  )
  SELECT
    COUNT(*) FILTER (WHERE max_sizes_per_position > 1) AS multi_size_products,
    COUNT(*) FILTER (WHERE max_sizes_per_position = 1) AS single_size_products,
    COUNT(*) AS total_laltex_products_with_print_details
  FROM per_product;
`);
console.log(JSON.stringify(corpusFreq[0], null, 2));

// Category breakdown of multi-size products
const catFreq = await sql(`
  WITH per_position AS (
    SELECT sp.supplier_product_code, sp.category, pd->>'print_position' AS pos,
           COUNT(*) AS sizes_at_position
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         LATERAL jsonb_array_elements(sp.print_details) AS pd
    WHERE s.slug='laltex' AND pd ? 'print_position'
    GROUP BY sp.supplier_product_code, sp.category, pd->>'print_position'
  ),
  per_product AS (
    SELECT supplier_product_code, category, MAX(sizes_at_position) AS max_sizes
    FROM per_position GROUP BY supplier_product_code, category
  )
  SELECT category, COUNT(*) AS multi_size_count
  FROM per_product WHERE max_sizes > 1
  GROUP BY category ORDER BY multi_size_count DESC;
`);
console.log('\n--- Multi-size products by category ---');
console.log(JSON.stringify(catFreq, null, 2));

// Distribution of "how many sizes do multi-size positions typically have"
const distribution = await sql(`
  WITH per_position AS (
    SELECT sp.supplier_product_code, pd->>'print_position' AS pos,
           COUNT(*) AS sizes_at_position
    FROM supplier_products sp
    JOIN suppliers s ON s.id = sp.supplier_id,
         LATERAL jsonb_array_elements(sp.print_details) AS pd
    WHERE s.slug='laltex' AND pd ? 'print_position'
    GROUP BY sp.supplier_product_code, pd->>'print_position'
  )
  SELECT sizes_at_position, COUNT(*) AS positions_with_this_many_sizes
  FROM per_position
  GROUP BY sizes_at_position
  ORDER BY sizes_at_position;
`);
console.log('\n--- Distribution: positions by number of sizes ---');
console.log(JSON.stringify(distribution, null, 2));

// Are sizes always at the same coordinate or do they differ?
console.log('\n--- AF0001: do the print_area_coordinates differ across sizes at same position? ---');
const coordCheck = await sql(`
  SELECT pd->>'print_area' AS size,
         (pd->'print_area_coordinates'->0->>'x') AS first_coord_x,
         (pd->'print_area_coordinates'->0->>'y') AS first_coord_y,
         (pd->'print_area_coordinates'->0->>'width') AS first_coord_w,
         (pd->'print_area_coordinates'->0->>'height') AS first_coord_h,
         jsonb_array_length(pd->'print_area_coordinates') AS num_colour_coords
  FROM supplier_products sp,
       LATERAL jsonb_array_elements(sp.print_details) AS pd
  WHERE sp.supplier_product_code = 'AF0001'
  ORDER BY (pd->>'print_area');
`);
console.log(JSON.stringify(coordCheck, null, 2));
