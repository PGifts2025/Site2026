/**
 * POST /api/find-alternatives — vector-only nearest-neighbour search
 * over supplier_products, anchored on a known product's stored
 * embedding (no OpenAI call needed).
 *
 * Same Bearer ${CRON_SECRET} auth as /api/search-products. The AI
 * Edge Function (session 5) calls this when a customer asks "what
 * else is like this product" or when the chosen product is OOS and
 * we want to offer near-substitutes.
 *
 * Behavior:
 *   - 401 on auth missing/wrong
 *   - 400 on validation failure (missing supplier_product_code, etc.)
 *   - 404 when the source product doesn't exist or has no embedding
 *   - 200 + alternatives:[] when source exists but nothing nearby
 *     passes the in-stock / staleness filters
 *
 * Scoring (mirrors rpc_find_alternatives):
 *   final = similarity
 *           * (1.15 if is_core_product else 1.0)
 *           * (1.05 if supplier='pgifts-direct' else 1.0)
 *
 * Documented in CLAUDE.md §31.
 */

import { checkAuthAndEnv, callRpc } from '../scripts/lib/search-auth.js';

export const config = {
  maxDuration: 30,
};

const SCORING = Object.freeze({
  core_multiplier: 1.15,
  house_multiplier: 1.05,
  house_supplier_slug: 'pgifts-direct',
  staleness_days: 14,
});

const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 5;

function validateBody(body) {
  if (body == null || typeof body !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const { supplier_product_code, limit, excludeOutOfStock } = body;

  if (typeof supplier_product_code !== 'string' || supplier_product_code.trim().length === 0) {
    return { ok: false, error: 'supplier_product_code (non-empty string) is required' };
  }

  let outLimit = DEFAULT_LIMIT;
  if (limit != null) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1) {
      return { ok: false, error: 'limit must be a positive integer' };
    }
    outLimit = Math.min(MAX_LIMIT, n);
  }

  let outExclude = true;
  if (excludeOutOfStock != null) {
    if (typeof excludeOutOfStock !== 'boolean') {
      return { ok: false, error: 'excludeOutOfStock must be boolean' };
    }
    outExclude = excludeOutOfStock;
  }

  return {
    ok: true,
    supplier_product_code: supplier_product_code.trim(),
    limit: outLimit,
    excludeOutOfStock: outExclude,
  };
}

// Verify the source product exists (and has an embedding) before
// calling the RPC. The RPC returns 0 rows on "not found" OR on "no
// neighbours passed filters" — we want to distinguish 404 from 200-empty.
//
// supplier_product_code is stored case-sensitively in Postgres (CLAUDE.md
// §33): Laltex SKUs UPPERCASE, PGifts Direct slugs lowercase. PostgREST
// `eq.` is case-sensitive. Callers (including the AI model) may send the
// code in any case. Mirror the codebase idiom in getSupplierProductByCode
// (productCatalogService.js): try as-given, fall back to uppercase. The
// returned row carries the canonical stored code so the downstream RPC
// (which uses case-sensitive `=` internally) receives the correct case.
async function fetchSourceByExactCase({ supabaseUrl, serviceRoleKey, code }) {
  const url =
    `${supabaseUrl}/rest/v1/supplier_products` +
    `?supplier_product_code=eq.${encodeURIComponent(code)}` +
    `&select=id,supplier_product_code,name,category,sub_category,supplier_id,suppliers!inner(slug),embedding_source_hash,embedded_at` +
    `&limit=1`;
  const resp = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: 'application/json',
    },
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`PostgREST source lookup -> ${resp.status}: ${text.slice(0, 300)}`);
  const rows = JSON.parse(text);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function lookupSourceProduct({ supabaseUrl, serviceRoleKey, code }) {
  const asGiven = await fetchSourceByExactCase({ supabaseUrl, serviceRoleKey, code });
  if (asGiven) return asGiven;
  const upper = code.toUpperCase();
  if (upper === code) return null;
  return await fetchSourceByExactCase({ supabaseUrl, serviceRoleKey, code: upper });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = checkAuthAndEnv(req, { needsOpenAI: false });
  if (!gate.ok) return res.status(gate.status).json(gate.body);
  const { supabaseUrl, serviceRoleKey } = gate;

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

  const t0 = Date.now();

  // 1. Source lookup. 404 cleanly if not found OR unembedded.
  let source;
  try {
    source = await lookupSourceProduct({
      supabaseUrl,
      serviceRoleKey,
      code: v.supplier_product_code,
    });
  } catch (err) {
    console.error('[find-alternatives] source lookup failed:', err?.message);
    return res.status(500).json({
      error: 'Supabase lookup failed',
      error_code: 'supabase_error',
      message: err?.message ?? String(err),
    });
  }
  if (!source) {
    return res.status(404).json({
      error: 'supplier_product_code not found',
      supplier_product_code: v.supplier_product_code,
    });
  }
  if (!source.embedded_at) {
    return res.status(404).json({
      error: 'source product has no embedding yet',
      supplier_product_code: v.supplier_product_code,
    });
  }

  // 2. Call RPC. Pass the CANONICAL stored code from the resolved source
  //    row, not the user-provided case. The RPC's internal WHERE clause
  //    uses case-sensitive `=` (CLAUDE.md §33); passing the wrong case
  //    here would silently return zero neighbours.
  const canonicalCode = source.supplier_product_code;
  let rows;
  try {
    rows = await callRpc({
      supabaseUrl,
      serviceRoleKey,
      fn: 'rpc_find_alternatives',
      body: {
        p_supplier_product_code: canonicalCode,
        p_exclude_out_of_stock: v.excludeOutOfStock,
        p_limit: v.limit,
      },
    });
  } catch (err) {
    console.error('[find-alternatives] rpc failed:', err?.message);
    return res.status(500).json({
      error: 'Supabase RPC failed',
      error_code: 'supabase_error',
      message: err?.message ?? String(err),
    });
  }

  const tTotal = Date.now() - t0;
  console.log(
    `[find-alternatives] code=${v.supplier_product_code} canonical=${canonicalCode} alts=${rows?.length ?? 0} total=${tTotal}ms`,
  );

  return res.status(200).json({
    source_product: {
      supplier_product_code: source.supplier_product_code,
      name: source.name,
      category: source.category,
      sub_category: source.sub_category,
      supplier: source.suppliers?.slug ?? null,
    },
    alternatives: rows ?? [],
    query_metadata: {
      filters_applied: {
        excludeOutOfStock: v.excludeOutOfStock,
        limit: v.limit,
      },
      scoring: SCORING,
      result_count: rows?.length ?? 0,
      total_ms: tTotal,
    },
  });
}
