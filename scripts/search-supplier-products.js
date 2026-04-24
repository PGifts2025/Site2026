#!/usr/bin/env node
/**
 * search-supplier-products.js
 *
 * Proof-of-retrieval for the embedding pipeline: embed a free-text query
 * with the same model as the catalogue, then run a cosine-similarity
 * nearest-neighbour search against supplier_products.
 *
 * Usage:
 *   node scripts/search-supplier-products.js "insulated travel mug with custom print"
 *
 * The query embedding is generated fresh on every run. This is
 * deliberate — caching adds complexity and the cost per query is
 * negligible (~$0.00002 for a short query).
 *
 * Env required in site/.env:
 *   OPENAI_API_KEY
 *   SUPABASE_ACCESS_TOKEN
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import OpenAI from 'openai';

import {
  EMBEDDING_MODEL,
  generateEmbedding,
  vectorLiteral,
} from './lib/embedding.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PROJECT_REF = 'cbcevjhvgmxrxeeyldza';
const MGMT_SQL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function execSQL(sql, token) {
  const resp = await fetch(MGMT_SQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Supabase SQL ${resp.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function pad(s, n) {
  const str = String(s ?? '');
  return str.length >= n ? str.slice(0, n) : str + ' '.repeat(n - str.length);
}

async function main() {
  const query = process.argv.slice(2).join(' ').trim();
  if (!query) {
    console.error('Usage: node scripts/search-supplier-products.js "query text"');
    process.exit(1);
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!openaiKey || !supabaseToken) {
    console.error('[search] OPENAI_API_KEY or SUPABASE_ACCESS_TOKEN missing from site/.env');
    process.exit(1);
  }

  console.log(`[search] query: "${query}"`);
  console.log(`[search] model: ${EMBEDDING_MODEL}`);

  const openai = new OpenAI({ apiKey: openaiKey });
  const { embedding, tokensUsed } = await generateEmbedding(query, openai);
  console.log(`[search] query embedded (${tokensUsed} tokens)`);

  const vecLit = vectorLiteral(embedding).replace(/'/g, "''");
  const sql = `
SELECT
  supplier_product_code,
  name,
  category,
  sub_category,
  1 - (embedding <=> '${vecLit}'::vector) AS similarity
FROM supplier_products
WHERE embedding IS NOT NULL
ORDER BY embedding <=> '${vecLit}'::vector
LIMIT 10
`;
  const rows = await execSQL(sql, supabaseToken);
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('[search] no results (is anything embedded yet?)');
    process.exit(1);
  }

  // Tabular print
  console.log('');
  console.log(
    pad('rank', 5) +
      pad('similarity', 12) +
      pad('code', 12) +
      pad('category > sub_category', 40) +
      'name',
  );
  console.log('-'.repeat(5 + 12 + 12 + 40 + 24));
  rows.forEach((r, i) => {
    const sim = Number(r.similarity ?? 0).toFixed(4);
    const cat = `${r.category ?? ''} > ${r.sub_category ?? ''}`;
    console.log(
      pad(String(i + 1), 5) +
        pad(sim, 12) +
        pad(r.supplier_product_code, 12) +
        pad(cat, 40) +
        (r.name ?? ''),
    );
  });
  console.log('');
}

main().catch((err) => {
  console.error('[search] FAILED:', err.message);
  process.exit(1);
});
