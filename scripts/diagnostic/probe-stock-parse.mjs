#!/usr/bin/env node
/**
 * Dry-run probe: fetch live Laltex stock for a few codes and run the parser.
 * NO database writes. Proves fetchStock + buildStockMap + FreeStock semantics
 * (>0 in, 0 out, -1 MTO) before the migration lands. Safe to run anytime.
 *
 *   node scripts/diagnostic/probe-stock-parse.mjs TF0101 MG0450 MG0192
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { fetchStock, buildStockMap } from '../lib/laltex-stock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const codes = process.argv.slice(2);
if (codes.length === 0) codes.push('TF0101', 'MG0450');

const laltexApiKey = process.env.LALTEX_API_KEY;
if (!laltexApiKey) { console.error('LALTEX_API_KEY missing in .env'); process.exit(1); }

for (const code of codes) {
  try {
    const arr = await fetchStock({ laltexApiKey, code });
    const { map, counts } = buildStockMap(arr);
    const sample = Object.entries(map).slice(0, 3);
    console.log(`\n${code}: ${counts.variants} variants — in=${counts.inStock} out=${counts.out} mto=${counts.mto}`);
    for (const [k, v] of sample) console.log(`   ${k} -> ${JSON.stringify(v)}`);
  } catch (err) {
    console.error(`${code}: FAILED — ${err.message}`);
  }
}
