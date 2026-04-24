#!/usr/bin/env node
/**
 * embed-supplier-product.js
 *
 * Generates and persists an OpenAI embedding for ONE supplier_products
 * row, keyed by supplier_product_code.
 *
 * Usage:
 *   node scripts/embed-supplier-product.js MG0192
 *
 * Idempotency:
 *   If the row already has a non-null embedding AND the current source
 *   text hashes to the existing embedding_source_hash, the OpenAI API
 *   call is SKIPPED. Prints "unchanged, skip" and exits 0.
 *
 * Env required in site/.env:
 *   OPENAI_API_KEY         — restricted, embeddings-only key
 *   SUPABASE_ACCESS_TOKEN  — PAT for Management API SQL endpoint
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import OpenAI from 'openai';

import {
  EMBEDDING_MODEL,
  EMBEDDING_DIMS,
  buildEmbeddingSourceText,
  hashSourceText,
  generateEmbedding,
  estimateEmbeddingCost,
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

function sqlQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

async function main() {
  const code = process.argv[2];
  if (!code) {
    console.error('Usage: node scripts/embed-supplier-product.js <PRODUCT_CODE>');
    process.exit(1);
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!openaiKey) {
    console.error('[embed] OPENAI_API_KEY missing from site/.env');
    process.exit(1);
  }
  if (!supabaseToken) {
    console.error('[embed] SUPABASE_ACCESS_TOKEN missing from site/.env');
    process.exit(1);
  }

  const keyTail = openaiKey.length >= 4 ? openaiKey.slice(-4) : '****';
  console.log(`[embed] code=${code} model=${EMBEDDING_MODEL} (openai key ...${keyTail})`);

  // Fetch the row. We only need the fields that feed into the source
  // text, plus the existing hash + embedding IS NULL flag.
  const rows = await execSQL(
    `SELECT
       supplier_product_code,
       name,
       category,
       sub_category,
       description,
       web_description,
       keywords,
       material,
       available_colours,
       embedding_source_hash,
       (embedding IS NOT NULL) AS has_embedding
     FROM supplier_products
     WHERE supplier_product_code = ${sqlQuote(code)}
     LIMIT 1`,
    supabaseToken,
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    console.error(`[embed] no supplier_products row for ${code} — has session 1 sync run for this code?`);
    process.exit(1);
  }

  const sourceText = buildEmbeddingSourceText(row);
  const newHash = hashSourceText(sourceText);

  // Idempotency gate: BEFORE any OpenAI call.
  if (row.has_embedding && row.embedding_source_hash === newHash) {
    console.log('[embed] source text unchanged — skip (no OpenAI call made)');
    console.log(`[embed] summary:`);
    console.log(`  code                  : ${row.supplier_product_code}`);
    console.log(`  name                  : ${row.name}`);
    console.log(`  source_text_length    : ${sourceText.length}`);
    console.log(`  source_hash (first 8) : ${newHash.slice(0, 8)}`);
    console.log(`  result                : unchanged, skip`);
    return;
  }

  // Fresh embed
  const openai = new OpenAI({ apiKey: openaiKey });
  const { embedding, tokensUsed, model } = await generateEmbedding(sourceText, openai);

  const cost = estimateEmbeddingCost(tokensUsed);

  // Persist. Vector goes as a pgvector text literal; hash is SQL-quoted.
  const vecLit = vectorLiteral(embedding).replace(/'/g, "''");
  const sql = `
UPDATE supplier_products
   SET embedding = '${vecLit}'::vector,
       embedding_source_hash = ${sqlQuote(newHash)},
       embedded_at = NOW()
 WHERE supplier_product_code = ${sqlQuote(code)}
 RETURNING supplier_product_code, embedded_at
`;
  const updated = await execSQL(sql, supabaseToken);
  const updatedRow = Array.isArray(updated) ? updated[0] : null;
  if (!updatedRow) throw new Error('UPDATE returned no row — race condition or deleted between SELECT and UPDATE?');

  console.log('[embed] saved.');
  console.log('[embed] summary:');
  console.log(`  code                  : ${updatedRow.supplier_product_code}`);
  console.log(`  name                  : ${row.name}`);
  console.log(`  source_text_length    : ${sourceText.length}`);
  console.log(`  source_hash (first 8) : ${newHash.slice(0, 8)}`);
  console.log(`  embedding_dims        : ${embedding.length} (expected ${EMBEDDING_DIMS})`);
  console.log(`  model                 : ${model}`);
  console.log(`  tokens_used           : ${tokensUsed}`);
  console.log(`  api_cost_estimate     : $${cost.usd.toFixed(6)} (~${cost.pence.toFixed(4)}p)`);
  console.log(`  embedded_at           : ${updatedRow.embedded_at}`);
}

main().catch((err) => {
  console.error('[embed] FAILED:', err.message);
  process.exit(1);
});
