/**
 * POST /api/admin/recompute-margin — admin-only Laltex margin override editor backend.
 *
 * supplier_products writes are service-role-only by RLS, so the admin browser
 * client cannot write the override directly (unlike orders). This route holds
 * the service-role key and is the only write path for margin_pct_override.
 *
 * Pipeline:
 *   1. CORS / OPTIONS / method guard.
 *   2. Env guard.
 *   3. Auth (two-step):
 *        a. Resolve caller from the Authorization Bearer Supabase JWT
 *           (GET /auth/v1/user, anon key) — 401 if invalid.
 *        b. Confirm the caller is an active super_admin in team_members
 *           (service role) — 403 otherwise.
 *   4. Validate { product_code: string, new_pct: number in [0,1) | null }.
 *   5. Read the Laltex supplier_products row (404 if not found / not Laltex).
 *   6. Recompute sell_price via applyMarginsInPlace (scripts/lib/laltex-margin.js
 *      — single source of truth; do NOT duplicate the margin math).
 *   7. PATCH supplier_products (product_pricing, print_details, override,
 *      margin_last_applied_at, schedule version).
 *   8. Append margin_override_history (non-fatal on failure — logged).
 *   9. Return the updated row so the client can refresh without re-fetching.
 *
 * Mirrors the conventions in api/ai/chat.js (Bearer JWT verify via
 * /auth/v1/user) and api/search-products.js (service-role PostgREST fetch).
 * Documented for Phase 2 of the admin margin editor.
 */

/* global process */
import { applyMarginsInPlace, DEFAULT_SCHEDULE_VERSION } from '../../scripts/lib/laltex-margin.js';

export const config = {
  maxDuration: 30, // seconds — one read + one write + one history insert; typically <2s.
};

const ALLOW_METHODS = 'POST, OPTIONS';

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers?.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Vary', 'Origin');
}

// Verify a Supabase session token server-side without the JWKS dance.
// Same pattern as api/ai/chat.js resolveUserFromBearer.
async function resolveUserFromBearer({ supabaseUrl, anonKey, bearerToken }) {
  const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${bearerToken}`,
    },
  });
  if (!resp.ok) return null;
  try {
    const json = await resp.json();
    return json?.id ? json : null;
  } catch {
    return null;
  }
}

// Service-role PostgREST fetch. Throws on non-2xx with a short preview.
async function pgRest(method, supabaseUrl, path, serviceRoleKey, { body, extraHeaders } = {}) {
  const resp = await fetch(`${supabaseUrl}/rest/v1${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...extraHeaders,
    },
    body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`PostgREST ${method} ${path.split('?')[0]} -> ${resp.status}: ${text.slice(0, 500)}`);
  }
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

// new_pct is a DECIMAL override in [0, 1) (0.22 = 22%), or null to reset to
// the default schedule. Range mirrors the DB CHECK on margin_pct_override.
function validatePct(value) {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: 'new_pct must be a number in [0, 1) or null' };
  }
  if (value < 0 || value >= 1) {
    return { ok: false, error: 'new_pct must be a decimal in [0, 1) — e.g. 0.22 for 22%' };
  }
  return { ok: true, value };
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', ALLOW_METHODS);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Env (project uses VITE_-prefixed names; accept bare names as fallback) ---
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [];
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!anonKey) missing.push('VITE_SUPABASE_ANON_KEY');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) return res.status(500).json({ error: 'Missing required env vars', missing });

  // --- Auth step 1: resolve caller from Bearer JWT ---
  const authHeader = req.headers?.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!bearerToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });

  const caller = await resolveUserFromBearer({ supabaseUrl, anonKey, bearerToken });
  if (!caller?.id) return res.status(401).json({ error: 'Invalid or expired session' });

  // --- Auth step 2: confirm active super_admin via team_members (service role) ---
  let teamRows;
  try {
    teamRows = await pgRest(
      'GET',
      supabaseUrl,
      `/team_members?user_id=eq.${encodeURIComponent(caller.id)}&is_active=eq.true&select=role`,
      serviceRoleKey,
    );
  } catch (e) {
    console.error('[recompute-margin] team_members lookup failed:', e.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
  const isSuperAdmin = Array.isArray(teamRows) && teamRows.some((r) => r.role === 'super_admin');
  if (!isSuperAdmin) return res.status(403).json({ error: 'Forbidden — super_admin role required' });

  // --- Body parse + validation ---
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'body is not valid JSON' }); }
  }
  if (body == null || typeof body !== 'object') {
    return res.status(400).json({ error: 'body must be a JSON object' });
  }

  const productCode = body.product_code;
  if (typeof productCode !== 'string' || productCode.trim().length === 0) {
    return res.status(400).json({ error: 'product_code (non-empty string) is required' });
  }
  if (!('new_pct' in body)) {
    return res.status(400).json({ error: 'new_pct is required (number in [0, 1) or null)' });
  }
  const pctCheck = validatePct(body.new_pct);
  if (!pctCheck.ok) return res.status(400).json({ error: pctCheck.error });
  const newPct = pctCheck.value;

  // --- Identify the Laltex supplier (scope guard — PGifts Direct excluded) ---
  let laltexId = null;
  try {
    const suppliers = await pgRest('GET', supabaseUrl, '/suppliers?slug=eq.laltex&select=id', serviceRoleKey);
    laltexId = Array.isArray(suppliers) && suppliers[0]?.id ? suppliers[0].id : null;
  } catch (e) {
    console.error('[recompute-margin] supplier lookup failed:', e.message);
    return res.status(500).json({ error: 'Supplier lookup failed' });
  }
  if (!laltexId) return res.status(500).json({ error: "Laltex supplier row not found" });

  // --- Read the row (must be a Laltex product) ---
  let rows;
  try {
    rows = await pgRest(
      'GET',
      supabaseUrl,
      `/supplier_products?supplier_product_code=eq.${encodeURIComponent(productCode)}` +
        `&supplier_id=eq.${encodeURIComponent(laltexId)}` +
        `&select=id,supplier_product_code,product_pricing,print_details,margin_pct_override`,
      serviceRoleKey,
    );
  } catch (e) {
    console.error('[recompute-margin] product lookup failed:', e.message);
    return res.status(500).json({ error: 'Product lookup failed' });
  }
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return res.status(404).json({ error: `Laltex product not found: ${productCode}` });

  const oldPct = row.margin_pct_override != null ? Number(row.margin_pct_override) : null;
  const productPricing = Array.isArray(row.product_pricing) ? row.product_pricing : [];
  const printDetails = Array.isArray(row.print_details) ? row.print_details : [];

  // --- Recompute sell_price (single source of truth: laltex-margin.js) ---
  try {
    applyMarginsInPlace({ productPricing, printDetails, overridePct: newPct });
  } catch (e) {
    console.error('[recompute-margin] applyMarginsInPlace failed:', e.message);
    return res.status(500).json({ error: `Margin recompute failed: ${e.message}` });
  }

  const nowIso = new Date().toISOString();

  // --- Write supplier_products (PostgREST has no cross-call transaction; the
  //     UPDATE is the authoritative write, the history INSERT is best-effort) ---
  try {
    await pgRest(
      'PATCH',
      supabaseUrl,
      `/supplier_products?id=eq.${encodeURIComponent(row.id)}`,
      serviceRoleKey,
      {
        body: {
          product_pricing: productPricing,
          print_details: printDetails,
          margin_pct_override: newPct,
          margin_last_applied_at: nowIso,
          margin_default_schedule_version: DEFAULT_SCHEDULE_VERSION,
        },
        extraHeaders: { Prefer: 'return=minimal' },
      },
    );
  } catch (e) {
    console.error('[recompute-margin] supplier_products update failed:', e.message);
    return res.status(500).json({ error: `Failed to update product: ${e.message}` });
  }

  // --- Append audit history (non-catastrophic on failure) ---
  try {
    await pgRest('POST', supabaseUrl, '/margin_override_history', serviceRoleKey, {
      body: {
        supplier_product_code: row.supplier_product_code,
        old_pct: oldPct,
        new_pct: newPct,
        changed_by: caller.id,
      },
      extraHeaders: { Prefer: 'return=minimal' },
    });
  } catch (e) {
    console.error('[recompute-margin] history insert failed (non-fatal):', e.message);
  }

  return res.status(200).json({
    ok: true,
    product_code: row.supplier_product_code,
    margin_pct_override: newPct,
    product_pricing: productPricing,
    print_details: printDetails,
    margin_last_applied_at: nowIso,
  });
}
