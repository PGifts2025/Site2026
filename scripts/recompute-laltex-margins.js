#!/usr/bin/env node
/**
 * recompute-laltex-margins.js
 *
 * Re-applies margins to existing supplier_products rows without re-fetching
 * the Laltex feed. Used to:
 *   1. Backfill sell_price after the Stage 1 deploy (CLAUDE.md §46).
 *   2. Refresh a single row after an admin changes its margin_pct_override.
 *   3. Bring stale rows forward when the default schedule changes.
 *
 * Per CLAUDE.md §46 / decision B1-A: this script writes sell_price for
 * product_pricing[] and print_details[].print_price[]. It does NOT bake
 * delivery into sell_price — delivery is a read-time concern, computed
 * at every consumer site using scripts/lib/laltex-delivery.js.
 *
 * Modes:
 *   node scripts/recompute-laltex-margins.js
 *     → every Laltex row in supplier_products
 *
 *   node scripts/recompute-laltex-margins.js CODE [CODE …]
 *     → only the named codes (case-sensitive — Laltex SKUs are uppercase,
 *       PGifts Direct slugs are lowercase per CLAUDE.md §33)
 *
 *   node scripts/recompute-laltex-margins.js --stale-only
 *     → rows whose margin_default_schedule_version is missing or
 *       below the current DEFAULT_SCHEDULE_VERSION
 *
 * Requires in site/.env:
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { applyMarginsInPlace, DEFAULT_SCHEDULE_VERSION } from './lib/laltex-margin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// PostgREST 1000-row cap — paginate explicitly (CLAUDE.md §28.1).
const PAGE_SIZE = 500;

function pgRestHeaders(serviceRoleKey, extra = {}) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
}

async function pgRest(method, url, serviceRoleKey, { body, extraHeaders } = {}) {
  const resp = await fetch(url, {
    method,
    headers: pgRestHeaders(serviceRoleKey, extraHeaders),
    body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`PostgREST ${method} ${url.split('?')[0]} -> ${resp.status}: ${text.slice(0, 500)}`);
  }
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const codes = [];
  let staleOnly = false;
  for (const a of args) {
    if (a === '--stale-only') { staleOnly = true; continue; }
    if (a.startsWith('--')) continue; // ignore unknown flags
    codes.push(a);
  }
  return { codes, staleOnly };
}

async function fetchRows({ supabaseUrl, serviceRoleKey, supplierId, codes, staleOnly }) {
  const rows = [];
  // If specific codes were requested, hit them directly (small N, no
  // pagination needed). Otherwise scan the whole supplier with paging.
  if (codes.length > 0) {
    // PostgREST `in.(a,b,c)` filter — values must be comma-separated.
    // Quote each value to handle edge characters defensively.
    const list = codes
      .map((c) => `"${String(c).replace(/"/g, '\\"')}"`)
      .join(',');
    const url = `${supabaseUrl}/rest/v1/supplier_products` +
      `?supplier_id=eq.${supplierId}` +
      `&supplier_product_code=in.(${encodeURIComponent(list)})` +
      `&select=id,supplier_product_code,product_pricing,print_details,margin_pct_override,margin_default_schedule_version`;
    const page = await pgRest('GET', url, serviceRoleKey);
    if (Array.isArray(page)) rows.push(...page);
    return rows;
  }

  let offset = 0;
  /* eslint-disable no-await-in-loop */
  for (;;) {
    const staleFilter = staleOnly
      ? `&or=(margin_default_schedule_version.is.null,margin_default_schedule_version.lt.${DEFAULT_SCHEDULE_VERSION})`
      : '';
    const url = `${supabaseUrl}/rest/v1/supplier_products` +
      `?supplier_id=eq.${supplierId}` +
      `&select=id,supplier_product_code,product_pricing,print_details,margin_pct_override,margin_default_schedule_version` +
      `&order=supplier_product_code.asc` +
      `&limit=${PAGE_SIZE}` +
      `&offset=${offset}` +
      staleFilter;
    const page = await pgRest('GET', url, serviceRoleKey);
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  /* eslint-enable no-await-in-loop */
  return rows;
}

async function getLaltexSupplierId({ supabaseUrl, serviceRoleKey }) {
  const url = `${supabaseUrl}/rest/v1/suppliers?slug=eq.laltex&select=id`;
  const rows = await pgRest('GET', url, serviceRoleKey);
  if (!Array.isArray(rows) || !rows[0]?.id) {
    throw new Error("suppliers row for slug='laltex' not found");
  }
  return rows[0].id;
}

async function patchRow({ supabaseUrl, serviceRoleKey, id, patch }) {
  const url = `${supabaseUrl}/rest/v1/supplier_products?id=eq.${encodeURIComponent(id)}`;
  await pgRest('PATCH', url, serviceRoleKey, {
    body: patch,
    extraHeaders: { Prefer: 'return=minimal' },
  });
}

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[recompute] Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in site/.env');
    process.exit(1);
  }

  const { codes, staleOnly } = parseArgs(process.argv);
  const mode = codes.length > 0 ? `codes(${codes.length})` : (staleOnly ? 'stale-only' : 'all-laltex');
  console.log(`[recompute] mode=${mode} DEFAULT_SCHEDULE_VERSION=${DEFAULT_SCHEDULE_VERSION}`);

  const supplierId = await getLaltexSupplierId({ supabaseUrl, serviceRoleKey });
  const rows = await fetchRows({ supabaseUrl, serviceRoleKey, supplierId, codes, staleOnly });
  console.log(`[recompute] fetched ${rows.length} rows`);
  if (rows.length === 0) {
    console.log('[recompute] nothing to do');
    return;
  }

  const nowIso = new Date().toISOString();
  let ok = 0;
  let failed = 0;
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const productPricing = Array.isArray(row.product_pricing) ? row.product_pricing : [];
    const printDetails = Array.isArray(row.print_details) ? row.print_details : [];
    const overridePct = row.margin_pct_override != null ? Number(row.margin_pct_override) : null;
    try {
      applyMarginsInPlace({ productPricing, printDetails, overridePct });
      await patchRow({
        supabaseUrl,
        serviceRoleKey,
        id: row.id,
        patch: {
          product_pricing: productPricing,
          print_details: printDetails,
          margin_default_schedule_version: DEFAULT_SCHEDULE_VERSION,
          margin_last_applied_at: nowIso,
        },
      });
      ok += 1;
    } catch (err) {
      failed += 1;
      console.error(`[recompute] ${row.supplier_product_code}: FAILED — ${err.message}`);
    }
    if ((i + 1) % 50 === 0 || i + 1 === rows.length) {
      console.log(`[recompute] ${i + 1}/${rows.length} done — ok=${ok} failed=${failed}`);
    }
  }
  /* eslint-enable no-await-in-loop */

  console.log(`[recompute] complete: ok=${ok} failed=${failed}`);
  if (failed > 0) process.exit(2);
}

main().catch((err) => {
  console.error('[recompute] FATAL:', err.message);
  process.exit(1);
});
