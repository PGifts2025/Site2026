/**
 * POST /api/search-products — hybrid (vector + tsvector) catalogue search.
 *
 * Server-to-server only at this stage. Authorization header is
 * Bearer ${CRON_SECRET}; the AI Edge Function in session 5 will call
 * this with the secret. Public-facing exposure (if ever needed) gets
 * its own auth layer in a later session — out of scope here.
 *
 * Pipeline:
 *   1. Auth + env guard.
 *   2. Validate the JSON body.
 *   3. Embed `query` via OpenAI text-embedding-3-small (~5–10 tokens).
 *   4. Call rpc_search_supplier_products with embedding + filters.
 *      The RPC owns scoring (RRF + boosts), filtering, and staleness
 *      exclusion — parameterised, so no SQL-injection surface.
 *   5. For each result row, attach unit_price_at_quantity convenience
 *      field (when filters.quantity is provided).
 *   6. Return { results, query_metadata }.
 *
 * Scoring (mirrors rpc_search_supplier_products):
 *   base_rrf = 1/(60 + vector_rank) + 1/(60 + tsvector_rank)
 *   final   = base_rrf
 *             * (1.15 if is_core_product else 1.0)
 *             * (1.05 if supplier='pgifts-direct' else 1.0)
 *
 * Errors:
 *   401 auth missing/wrong
 *   400 validation failure
 *   500 OpenAI failure (returns { error_code: 'openai_error', message })
 *   500 Supabase failure
 *
 * Documented in CLAUDE.md §31.
 */

import OpenAI from 'openai';

import { EMBEDDING_MODEL, generateEmbedding, vectorLiteral } from '../scripts/lib/embedding.js';
import { checkAuthAndEnv, callRpc, findTierForQuantity } from '../scripts/lib/search-auth.js';
import { deliveryPerUnit } from '../scripts/lib/laltex-delivery.js';
import { scheduleMarginForTier } from '../scripts/lib/laltex-margin.js';

export const config = {
  maxDuration: 30, // seconds — query embed + RPC; typical is <2s.
};

// Constants surfaced for tuning. The RPC has its own copies (the
// authoritative ones for scoring); keep these in lockstep if you
// change the migration. These are documentation + reflected in the
// response metadata so a caller can see what produced the ranking.
// Mirror of the RPC's tunable constants. The RPC owns scoring; this
// is informational (returned in query_metadata so a caller can see
// what produced the ranking). Retuned 2026-05-11 — core 1.15 → 1.30
// per session 4b Query-C diagnostic.
const SCORING = Object.freeze({
  rrf_k: 60,
  core_multiplier: 1.30,
  house_multiplier: 1.05,
  house_supplier_slug: 'pgifts-direct',
  staleness_days: 14,
});

const MAX_QUERY_CHARS = 500;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateBody(body) {
  if (body == null || typeof body !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }

  const { query, filters } = body;
  if (typeof query !== 'string' || query.trim().length === 0) {
    return { ok: false, error: 'query (non-empty string) is required' };
  }
  if (query.length > MAX_QUERY_CHARS) {
    return { ok: false, error: `query exceeds ${MAX_QUERY_CHARS} chars` };
  }

  if (filters != null && (typeof filters !== 'object' || Array.isArray(filters))) {
    return { ok: false, error: 'filters must be an object' };
  }

  const f = filters || {};
  const out = {};

  // Strings
  for (const k of ['category', 'sub_category', 'supplierSlug', 'product_indicator']) {
    if (f[k] != null) {
      if (typeof f[k] !== 'string') return { ok: false, error: `${k} must be a string` };
      out[k] = f[k];
    }
  }

  // Integers
  for (const [k, kind] of [
    ['minOrderQuantity', 'int'],
    ['quantity', 'int'],
    ['maxLeadTimeDays', 'int'],
    ['limit', 'int'],
  ]) {
    if (f[k] != null) {
      const n = Number(f[k]);
      if (!Number.isInteger(n) || n < 0) {
        return { ok: false, error: `${k} must be a non-negative integer` };
      }
      out[k] = n;
    }
  }

  // Numerics
  if (f.maxUnitPrice != null) {
    const n = Number(f.maxUnitPrice);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'maxUnitPrice must be a non-negative number' };
    if (out.quantity == null) {
      return {
        ok: false,
        error: 'maxUnitPrice requires quantity (to pick the price tier to test)',
      };
    }
    out.maxUnitPrice = n;
  }

  // Booleans (defaulted later)
  for (const k of ['inStockOnly', 'expressOnly']) {
    if (f[k] != null) {
      if (typeof f[k] !== 'boolean') return { ok: false, error: `${k} must be boolean` };
      out[k] = f[k];
    }
  }

  // Apply defaults / clamps
  if (out.inStockOnly == null) out.inStockOnly = true;
  if (out.expressOnly == null) out.expressOnly = false;
  out.limit = Math.min(MAX_LIMIT, out.limit ?? DEFAULT_LIMIT);

  return { ok: true, query: query.trim(), filters: out };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = checkAuthAndEnv(req, { needsOpenAI: true });
  if (!gate.ok) return res.status(gate.status).json(gate.body);

  const { openaiKey, supabaseUrl, serviceRoleKey } = gate;

  // Vercel Node functions parse JSON bodies automatically; for local/curl
  // testing we accept a string body too.
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'body is not valid JSON' });
    }
  }

  const v = validateBody(body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const { query, filters } = v;

  const t0 = Date.now();

  // 1. Embed the query.
  let queryEmbedding;
  let tokensUsed = 0;
  try {
    const openai = new OpenAI({ apiKey: openaiKey });
    const out = await generateEmbedding(query, openai);
    queryEmbedding = out.embedding;
    tokensUsed = out.tokensUsed ?? 0;
  } catch (err) {
    console.error('[search-products] openai embed failed:', err?.message);
    return res.status(500).json({
      error: 'OpenAI embedding failed',
      error_code: 'openai_error',
      message: err?.message ?? String(err),
    });
  }
  const tEmbed = Date.now() - t0;

  // 2. Call the RPC. pgvector accepts the text-form literal on POST
  //    when the column is typed vector(N) on the function signature.
  const rpcBody = {
    query_embedding: vectorLiteral(queryEmbedding),
    query_text: query,
    p_category: filters.category ?? null,
    p_sub_category: filters.sub_category ?? null,
    p_supplier_slug: filters.supplierSlug ?? null,
    p_min_order_quantity: filters.minOrderQuantity ?? null,
    p_quantity: filters.quantity ?? null,
    p_max_unit_price: filters.maxUnitPrice ?? null,
    p_max_lead_time_days: filters.maxLeadTimeDays ?? null,
    p_in_stock_only: filters.inStockOnly,
    p_express_only: filters.expressOnly,
    p_product_indicator: filters.product_indicator ?? null,
    p_limit: filters.limit,
  };

  let rows;
  try {
    rows = await callRpc({
      supabaseUrl,
      serviceRoleKey,
      fn: 'rpc_search_supplier_products',
      body: rpcBody,
    });
  } catch (err) {
    console.error('[search-products] rpc failed:', err?.message);
    return res.status(500).json({
      error: 'Supabase RPC failed',
      error_code: 'supabase_error',
      message: err?.message ?? String(err),
    });
  }
  const tTotal = Date.now() - t0;

  // 3. Attach unit_price_at_quantity if a quantity was supplied.
  //
  // Customer-facing price: tier.sell_price (margin-applied at sync, NO
  // delivery) + UK STANDARD delivery share at the customer's actual qty,
  // with margin applied to the delivery share at the tier's rate.
  //
  // Transitional behaviour: rows that haven't been recomputed yet (no
  // sell_price field) fall back to raw tier.price so search results stay
  // populated during the deploy window. Once recompute-laltex-margins.js
  // has run, sell_price is always present.
  if (Array.isArray(rows) && filters.quantity != null) {
    const qty = filters.quantity;
    for (const r of rows) {
      const tier = findTierForQuantity(r.product_pricing, qty);
      if (!tier || tier.is_poa) {
        r.unit_price_at_quantity = null;
        r.unit_price_at_quantity_is_poa = !!tier?.is_poa;
        continue;
      }
      const sellNoDelivery = tier.sell_price != null
        ? Number(tier.sell_price)
        : Number(tier.price);
      const marginPct = Number.isFinite(Number(tier.margin_applied_pct))
        ? Number(tier.margin_applied_pct)
        : scheduleMarginForTier(qty, null);
      const dpu = deliveryPerUnit(r.shipping_charges, r.carton_qty, qty, 'ukstandard');
      const inclusive = sellNoDelivery + dpu * (1 + marginPct);
      r.unit_price_at_quantity = Number(inclusive.toFixed(4));
      r.unit_price_at_quantity_is_poa = false;
    }
  }

  // 4. Log + return.
  const topScore = rows?.[0]?.final_score ?? null;
  console.log(
    `[search-products] q="${query.slice(0, 60)}" results=${rows?.length ?? 0} top=${topScore?.toFixed?.(4) ?? 'n/a'} embed=${tEmbed}ms total=${tTotal}ms`,
  );

  return res.status(200).json({
    results: rows ?? [],
    query_metadata: {
      query,
      embedding_model: EMBEDDING_MODEL,
      embedding_tokens: tokensUsed,
      filters_applied: filters,
      scoring: SCORING,
      result_count: rows?.length ?? 0,
      embed_ms: tEmbed,
      total_ms: tTotal,
    },
  });
}
