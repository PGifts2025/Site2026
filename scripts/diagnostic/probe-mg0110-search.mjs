#!/usr/bin/env node
/**
 * Run rpc_search_supplier_products against several query shapes
 * to see whether MG0110 ranks in the results.
 *
 * Read-only. Uses SERVICE_ROLE_KEY for RPC + OPENAI_API_KEY for the
 * query embedding.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE || !OPENAI_KEY) {
  console.error('Missing env: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_KEY });

async function embed(text) {
  const r = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return r.data[0].embedding;
}

function vectorLiteral(v) {
  return '[' + v.join(',') + ']';
}

async function search(query, filters = {}) {
  const embedding = await embed(query);
  const body = {
    query_embedding: vectorLiteral(embedding),
    query_text: query,
    p_category: filters.category ?? null,
    p_sub_category: filters.sub_category ?? null,
    p_supplier_slug: filters.supplierSlug ?? null,
    p_min_order_quantity: filters.minOrderQuantity ?? null,
    p_quantity: filters.quantity ?? null,
    p_max_unit_price: filters.maxUnitPrice ?? null,
    p_max_lead_time_days: filters.maxLeadTimeDays ?? null,
    p_in_stock_only: filters.inStockOnly ?? true,
    p_express_only: filters.expressOnly ?? false,
    p_product_indicator: filters.product_indicator ?? null,
    p_limit: filters.limit ?? 25,
  };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_search_supplier_products`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`RPC ${r.status}: ${t.slice(0, 400)}`);
  return JSON.parse(t);
}

const queries = [
  { q: 'MG0110', label: 'by code (uppercase)' },
  { q: 'mg0110', label: 'by code (lowercase)' },
  { q: 'Polo 400ml Tumbler', label: 'by name (verbatim)' },
  { q: 'polo tumbler', label: 'by name partial (lowercase)' },
  { q: 'travel mug', label: 'by category-ish word' },
];

(async () => {
  for (const { q, label } of queries) {
    console.log(`\n=== Query: "${q}"  (${label}) ===`);
    try {
      const rows = await search(q, { limit: 25 });
      const idx = rows.findIndex((r) => r.supplier_product_code === 'MG0110');
      const top5 = rows.slice(0, 5).map((r, i) => `${i + 1}. ${r.supplier_product_code} (${r.name}) sim=${r.similarity?.toFixed?.(3)} ts=${r.tsvector_rank?.toFixed?.(3)} score=${r.final_score?.toFixed?.(5)}`);
      console.log('  rows returned:', rows.length);
      console.log('  MG0110 rank in top 25:', idx === -1 ? 'NOT FOUND' : `#${idx + 1}`);
      console.log('  top 5:\n  ' + top5.join('\n  '));
    } catch (e) {
      console.log('  ERROR:', e.message);
    }
  }
})();
