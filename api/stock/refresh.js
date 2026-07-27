/**
 * POST /api/stock/refresh — on-view stock refresh for ONE Laltex product.
 *
 * WHY THIS EXISTS
 * ---------------
 * A daily catalogue-wide cron polls 1,194 products so that a handful get
 * looked at. This inverts that: stock is refreshed for the products people
 * actually open, at the moment they open them. The data is seconds old rather
 * than hours, at a fraction of the API calls.
 *
 * The daily cron STAYS. It is the baseline that guarantees every product has
 * stock (so a page is never empty on first load) and covers products nobody
 * views. The two are complementary.
 *
 * SECURITY / COST BRAKES
 *   * The Laltex API key is server-side only and never reaches the browser.
 *   * Only known, non-retired Laltex product codes are accepted. Anything else
 *     is rejected WITHOUT an upstream call.
 *   * A freshness gate runs server-side BEFORE the upstream call, so repeated
 *     views of the same product within the window cost nothing upstream.
 *   * UPDATE-only write (shared with the cron): never inserts into
 *     supplier_products.
 *   * No job_runs row is written — those are for batch runs.
 *
 * Request:  { "code": "TF0101" }
 * Response: 200 { code, status: 'refreshed'|'fresh', stock, stock_checked_at }
 *           400 malformed body / code
 *           404 unknown code (not a known non-retired Laltex product)
 *           405 non-POST
 *           502 upstream/database failure (client keeps showing stored stock)
 */

import { refreshProductStock } from '../../scripts/lib/laltex-stock.js';

export const config = { maxDuration: 30 };

// Laltex product codes are short alphanumerics (e.g. TF0101, MG0192, TPC950601).
// This is a cheap shape guard; the authoritative check is the DB lookup inside
// refreshProductStock, which rejects anything not in the catalogue.
const CODE_SHAPE = /^[A-Za-z0-9._-]{2,32}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Malformed JSON body' }); }
  }
  const code = body?.code;
  if (typeof code !== 'string' || !CODE_SHAPE.test(code.trim())) {
    return res.status(400).json({ error: 'Invalid product code' });
  }

  const laltexApiKey = process.env.LALTEX_API_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [];
  if (!laltexApiKey) missing.push('LALTEX_API_KEY');
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    return res.status(500).json({ error: 'Missing required env vars', missing });
  }

  try {
    const result = await refreshProductStock({
      laltexApiKey,
      supabaseUrl,
      serviceRoleKey,
      code: code.trim(),
    });

    if (result.status === 'unknown_code') {
      // Not a known non-retired Laltex product — no upstream call was made.
      return res.status(404).json({ error: 'Unknown product code' });
    }
    if (result.status === 'not_found') {
      // Known to Laltex but no matching row to update; a data mismatch, not a
      // client error. The page keeps its stored stock.
      console.warn(`[stock/refresh] ${code}: upstream ok but no supplier_products row updated`);
      return res.status(200).json({ code, status: 'not_found', stock: null, stock_checked_at: null });
    }
    return res.status(200).json({
      code,
      status: result.status, // 'refreshed' | 'fresh'
      stock: result.stock ?? null,
      stock_checked_at: result.stockCheckedAt ?? null,
    });
  } catch (err) {
    // Never surface as an error the client must act on: the page keeps showing
    // stored stock. Log for diagnosis.
    console.error(`[stock/refresh] ${code} failed:`, err?.message ?? err);
    return res.status(502).json({ error: 'Stock refresh failed' });
  }
}
