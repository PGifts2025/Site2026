/**
 * Shared auth + env-guard helper for /api/search-products and
 * /api/find-alternatives.
 *
 * Both endpoints accept Bearer ${CRON_SECRET} (same shared secret
 * as the cron routes). They're server-to-server only at this stage
 * — the AI Edge Function in session 5 calls them with the secret.
 * A future public-facing layer would add its own auth on top; this
 * one is intentionally minimal.
 *
 * Returns one of:
 *   { ok: true,  openaiKey, supabaseUrl, serviceRoleKey }
 *   { ok: false, status, body }
 *
 * Caller pattern:
 *   const gate = checkAuthAndEnv(req, { needsOpenAI: true });
 *   if (!gate.ok) return res.status(gate.status).json(gate.body);
 *   const { openaiKey, supabaseUrl, serviceRoleKey } = gate;
 */

export function checkAuthAndEnv(req, { needsOpenAI = false } = {}) {
  // 1. Auth — strictly Bearer ${CRON_SECRET}. Same pattern as the
  //    sync/embed crons (CLAUDE.md §27.6); rotation rotates everything
  //    together.
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected) {
    return {
      ok: false,
      status: 500,
      body: { error: 'CRON_SECRET not configured' },
    };
  }
  if (req.headers?.authorization !== expected) {
    return { ok: false, status: 401, body: { error: 'Unauthorized' } };
  }

  // 2. Required env. needsOpenAI is false for /api/find-alternatives
  //    because that endpoint uses the source product's stored
  //    embedding — no OpenAI call.
  const openaiKey = process.env.OPENAI_API_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing = [];
  if (needsOpenAI && !openaiKey) missing.push('OPENAI_API_KEY');
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    return {
      ok: false,
      status: 500,
      body: { error: 'Missing required env vars', missing },
    };
  }

  return { ok: true, openaiKey, supabaseUrl, serviceRoleKey };
}

/**
 * Fetch helper for PostgREST RPC calls. Throws on non-2xx with a
 * short error preview so the wrapper can surface a clean 500.
 */
export async function callRpc({ supabaseUrl, serviceRoleKey, fn, body }) {
  const url = `${supabaseUrl}/rest/v1/rpc/${fn}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`PostgREST rpc/${fn} -> ${resp.status}: ${text.slice(0, 500)}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Given a parsed product_pricing array and a target quantity, find the
 * first tier whose [min_qty, max_qty] range contains the qty. Returns
 * the tier or null.
 *
 * Tier shape (from laltex-parser.js parseProductPricing):
 *   { min_qty, max_qty, price, is_poa, note }
 *
 * Used by /api/search-products to attach unit_price_at_quantity to
 * each result row so callers don't have to re-find the bracket.
 */
export function findTierForQuantity(productPricing, quantity) {
  if (!Array.isArray(productPricing) || quantity == null) return null;
  for (const tier of productPricing) {
    const lo = Number(tier?.min_qty ?? 0);
    const hi = tier?.max_qty == null ? Infinity : Number(tier.max_qty);
    if (quantity >= lo && quantity <= hi) return tier;
  }
  return null;
}
