/**
 * Laltex live-stock refresh.
 *
 * Exports:
 *   syncStock({ ... }) — one end-to-end stock run. Creates a job_runs row
 *     with job_type='stock', reads every non-retired Laltex supplier_product
 *     code, calls GET /trade/api/stocks/{code} for each (one call returns all
 *     that product's colour x size variants), builds an item_code -> stock map,
 *     UPSERTs ONLY the { stock, stock_checked_at } columns onto the row, records
 *     per-product failures into job_failures, and finalises the job_runs row.
 *
 * Design (see audit-laltex-stock-availability.md §5 + CLAUDE.md §27):
 *
 *  1. Separate cron from product sync. Stock is volatile (hourly); the product
 *     sync is nightly. A stock-endpoint outage must never block the product
 *     sync and vice-versa. Same observability tables, distinct job_type.
 *
 *  2. Endpoint shape. GET /trade/api/stocks/{code} — NO /v1/. Returns a bare
 *     JSON array of stock objects, one per variant, keyed by ProductCode which
 *     is byte-identical to our stored items[].item_code (120/120 join verified
 *     in the audit). No working bulk-all endpoint, so one call per product.
 *
 *  3. FreeStock semantics (DO NOT get these wrong):
 *       FreeStock  >  0  -> in stock (that many)
 *       FreeStock === 0  -> out of stock now (check due_ins for an ETA)
 *       FreeStock === -1 -> Made To Order: available on a longer lead time.
 *                           NEVER "out of stock". Stored as { mto: true }.
 *
 *  4. Continue-with-logging. A single product's fetch/upsert failure lands in
 *     job_failures and the run keeps going. A failed product keeps its PREVIOUS
 *     stock + stock_checked_at (we simply skip its UPSERT) so retrieval never
 *     breaks on a partial run. Only an infra-level error (can't resolve the
 *     supplier, can't open the job_runs row) fails the whole run.
 *
 *  5. Bulk-write discipline. Writes go via PostgREST + SUPABASE_SERVICE_ROLE_KEY
 *     (CLAUDE.md §27.2), merge-duplicates so only the two stock columns change.
 */

const LALTEX_BASE = 'https://auto.laltex.com/trade/api';
// NOTE: the stock endpoint has NO /v1/ prefix (unlike products). This was the
// PR #81 step-0 mistake. See the audit for the 404-vs-200 evidence.
const STOCK_PATH = (code) => `/stocks/${encodeURIComponent(code)}`;

// How many stock fetches to run at once. ~1194 products at ~130 ms/call on
// Vercel (prod latency ~1.7x local, CLAUDE.md §28.2): concurrency 8 finishes
// in well under a minute, comfortably inside the 300 s function budget.
const DEFAULT_CONCURRENCY = 8;

// Page size for the code-list read (PostgREST caps at 1000, CLAUDE.md §28.1).
const CODES_PAGE_SIZE = 1000;

// Cap of raw snippet chars persisted into job_failures.raw_snippet.
const RAW_SNIPPET_CHARS = 2000;

// ---------------------------------------------------------------------------
// PostgREST helpers (same shape as laltex-sync.js)
// ---------------------------------------------------------------------------

function ensureEnv(name, value) {
  if (!value || typeof value !== 'string') {
    throw new Error(`${name} is required`);
  }
  return value;
}

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
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// job_runs lifecycle (job_type='stock')
// ---------------------------------------------------------------------------

async function insertJobRun({ supabaseUrl, serviceRoleKey, supplierId, triggeredBy, metadata }) {
  const url = `${supabaseUrl}/rest/v1/job_runs`;
  const rows = await pgRest('POST', url, serviceRoleKey, {
    body: [{
      supplier_id: supplierId,
      run_type: 'full_stock',
      status: 'running',
      triggered_by: triggeredBy,
      job_type: 'stock',
      metadata: metadata ?? null,
    }],
    extraHeaders: { Prefer: 'return=representation' },
  });
  if (!Array.isArray(rows) || !rows[0]?.id) {
    throw new Error('Failed to create job_runs row');
  }
  return rows[0].id;
}

async function finaliseJobRun({ supabaseUrl, serviceRoleKey, runId, patch }) {
  const url = `${supabaseUrl}/rest/v1/job_runs?id=eq.${encodeURIComponent(runId)}`;
  await pgRest('PATCH', url, serviceRoleKey, {
    body: patch,
    extraHeaders: { Prefer: 'return=minimal' },
  });
}

async function insertJobFailures({ supabaseUrl, serviceRoleKey, rows }) {
  if (!rows.length) return;
  const url = `${supabaseUrl}/rest/v1/job_failures`;
  try {
    await pgRest('POST', url, serviceRoleKey, {
      body: rows,
      extraHeaders: { Prefer: 'return=minimal' },
    });
  } catch (err) {
    console.error('[laltex-stock] WARNING: job_failures insert failed:', err.message);
  }
}

function truncateRawSnippet(raw) {
  try {
    const s = JSON.stringify(raw);
    if (s.length <= RAW_SNIPPET_CHARS) return raw;
    return { __truncated: true, __original_chars: s.length, preview: s.slice(0, RAW_SNIPPET_CHARS) };
  } catch {
    return { __stringify_failed: true };
  }
}

// ---------------------------------------------------------------------------
// Supplier + code list
// ---------------------------------------------------------------------------

async function getLaltexSupplierId({ supabaseUrl, serviceRoleKey }) {
  const url = `${supabaseUrl}/rest/v1/suppliers?slug=eq.laltex&select=id`;
  const rows = await pgRest('GET', url, serviceRoleKey);
  if (!Array.isArray(rows) || !rows[0]?.id) {
    throw new Error("suppliers row for slug='laltex' not found");
  }
  return rows[0].id;
}

// Every non-retired Laltex product code. Retired rows (CLAUDE.md §51) never
// display, so refreshing their stock would waste calls; a reappearing product
// gets stock on the next run after the nightly sync clears is_retired.
async function getStockableCodes({ supabaseUrl, serviceRoleKey, supplierId }) {
  const codes = [];
  let offset = 0;
  /* eslint-disable no-await-in-loop */
  for (;;) {
    const url = `${supabaseUrl}/rest/v1/supplier_products` +
      `?supplier_id=eq.${supplierId}` +
      `&is_retired=eq.false` +
      `&select=supplier_product_code` +
      `&order=supplier_product_code.asc` +
      `&limit=${CODES_PAGE_SIZE}` +
      `&offset=${offset}`;
    const page = await pgRest('GET', url, serviceRoleKey);
    if (!Array.isArray(page) || page.length === 0) break;
    for (const r of page) {
      if (r.supplier_product_code) codes.push(r.supplier_product_code);
    }
    if (page.length < CODES_PAGE_SIZE) break;
    offset += CODES_PAGE_SIZE;
  }
  /* eslint-enable no-await-in-loop */
  return codes;
}

// ---------------------------------------------------------------------------
// Laltex stock fetch + parse
// ---------------------------------------------------------------------------

export async function fetchStock({ laltexApiKey, code, baseUrl = LALTEX_BASE }) {
  const url = `${baseUrl}${STOCK_PATH(code)}`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: { API_KEY: laltexApiKey, Accept: 'application/json' },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Laltex stocks/${code} -> ${resp.status} ${resp.statusText}: ${body.slice(0, 200)}`);
  }
  const text = await resp.text();
  if (!text) return []; // some products legitimately return an empty body
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Laltex stocks/${code}: non-JSON body`);
  }
  // Live API returns a bare array; the PDF sample wraps in { value: [...] }.
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.value)) return data.value;
  return [];
}

/**
 * Build the { item_code -> { free, mto?, due_ins? } } map for one product's
 * variant array. Returns { map, counts } where counts feeds run metadata.
 */
export function buildStockMap(stockArray) {
  const map = {};
  const counts = { variants: 0, inStock: 0, out: 0, mto: 0 };
  for (const obj of stockArray) {
    const itemCode = obj?.ProductCode;
    if (!itemCode) continue;
    const raw = Number(obj?.FreeStock);
    const free = Number.isFinite(raw) ? raw : 0;
    const mto = free === -1;
    const entry = { free };
    if (mto) entry.mto = true;
    const dueIns = Array.isArray(obj?.DueIns)
      ? obj.DueIns
          .map((d) => ({ qty: Number(d?.DueInQty) || 0, eta: d?.DueInETA || null }))
          .filter((d) => d.qty > 0 || d.eta)
      : [];
    if (dueIns.length) entry.due_ins = dueIns;
    map[itemCode] = entry;
    counts.variants += 1;
    if (mto) counts.mto += 1;
    else if (free > 0) counts.inStock += 1;
    else counts.out += 1;
  }
  return { map, counts };
}

async function upsertStock({ supabaseUrl, serviceRoleKey, supplierId, code, map, nowIso }) {
  const url = `${supabaseUrl}/rest/v1/supplier_products?on_conflict=supplier_id,supplier_product_code`;
  await pgRest('POST', url, serviceRoleKey, {
    // Only these four keys: the two stock columns + the conflict target.
    // merge-duplicates leaves every other column on the row untouched.
    body: [{
      supplier_id: supplierId,
      supplier_product_code: code,
      stock: map,
      stock_checked_at: nowIso,
    }],
    extraHeaders: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
}

// ---------------------------------------------------------------------------
// Bounded-concurrency worker pool
// ---------------------------------------------------------------------------

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const size = Math.max(1, Math.min(concurrency, items.length || 1));
  const runners = Array.from({ length: size }, async () => {
    /* eslint-disable no-await-in-loop */
    for (;;) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) break;
      await worker(items[idx], idx);
    }
    /* eslint-enable no-await-in-loop */
  });
  await Promise.all(runners);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Refresh live stock for the whole Laltex pool.
 *
 * @param {object} opts
 * @param {string} opts.laltexApiKey      LALTEX_API_KEY
 * @param {string} opts.supabaseUrl       VITE_SUPABASE_URL (PostgREST base)
 * @param {string} opts.serviceRoleKey    SUPABASE_SERVICE_ROLE_KEY
 * @param {string} opts.triggeredBy       'cron' | 'manual' | 'cli'
 * @param {number=} opts.concurrency      parallel fetches (default 8)
 * @param {function(string)=} opts.progress
 * @returns {Promise<{runId, fetched, updated, failed, durationMs, status, errorMessage?}>}
 */
export async function syncStock({
  laltexApiKey,
  supabaseUrl,
  serviceRoleKey,
  triggeredBy,
  concurrency = DEFAULT_CONCURRENCY,
  progress,
}) {
  ensureEnv('laltexApiKey', laltexApiKey);
  ensureEnv('supabaseUrl', supabaseUrl);
  ensureEnv('serviceRoleKey', serviceRoleKey);
  ensureEnv('triggeredBy', triggeredBy);

  const log = (msg) => {
    if (typeof progress === 'function') progress(msg);
    else console.log(msg);
  };

  const runStart = Date.now();
  const supplierId = await getLaltexSupplierId({ supabaseUrl, serviceRoleKey });
  const runId = await insertJobRun({
    supabaseUrl,
    serviceRoleKey,
    supplierId,
    triggeredBy,
    metadata: { concurrency, started_iso: new Date(runStart).toISOString() },
  });

  let status = 'failed';
  let errorMessage = null;
  let fetched = 0;
  let updated = 0;
  let failed = 0;
  const totals = { variants: 0, inStock: 0, out: 0, mto: 0 };
  const failedCodes = [];

  try {
    const codes = await getStockableCodes({ supabaseUrl, serviceRoleKey, supplierId });
    fetched = codes.length;
    log(`[stock] run ${runId} — ${fetched} products to refresh (concurrency ${concurrency})`);

    if (fetched === 0) {
      status = 'completed';
      return { runId, fetched, updated, failed, durationMs: Date.now() - runStart, status };
    }

    const nowIso = new Date().toISOString();
    const failures = [];
    let done = 0;

    await runPool(codes, concurrency, async (code) => {
      try {
        const arr = await fetchStock({ laltexApiKey, code });
        const { map, counts } = buildStockMap(arr);
        await upsertStock({ supabaseUrl, serviceRoleKey, supplierId, code, map, nowIso });
        updated += 1;
        totals.variants += counts.variants;
        totals.inStock += counts.inStock;
        totals.out += counts.out;
        totals.mto += counts.mto;
      } catch (err) {
        // Per-product failure: log + count, keep going. The row keeps its
        // previous stock + stock_checked_at (we simply skipped the UPSERT).
        failed += 1;
        failedCodes.push(code);
        failures.push({
          job_run_id: runId,
          supplier_product_code: code,
          reason: err?.message?.includes('PostgREST') ? 'stock_upsert_failed' : 'stock_fetch_failed',
          error_message: err?.message?.slice(0, 1000) ?? 'unknown',
          raw_snippet: truncateRawSnippet({ code }),
        });
      } finally {
        done += 1;
        if (done % 200 === 0 || done === codes.length) {
          log(`[stock] ${done}/${codes.length} — updated=${updated} failed=${failed}`);
        }
      }
    });

    if (failures.length) {
      await insertJobFailures({ supabaseUrl, serviceRoleKey, rows: failures });
    }

    // A run is 'completed' as long as it ran to the end. Even an all-failed
    // run is 'completed' at the job level (the failures are logged per-code);
    // only infra errors flip status='failed'. This matches the sync module.
    status = 'completed';
    log(`[stock] done — updated=${updated} failed=${failed} variants=${totals.variants} ` +
        `(in=${totals.inStock} out=${totals.out} mto=${totals.mto})`);
  } catch (err) {
    errorMessage = err?.message ?? String(err);
    status = 'failed';
    console.error('[laltex-stock] run failed:', errorMessage);
  } finally {
    const durationMs = Date.now() - runStart;
    await finaliseJobRun({
      supabaseUrl,
      serviceRoleKey,
      runId,
      patch: {
        status,
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        products_fetched: fetched,
        products_inserted: 0,
        products_updated: updated,
        products_failed: failed,
        error_message: errorMessage,
        metadata: {
          concurrency,
          variants_total: totals.variants,
          variants_in_stock: totals.inStock,
          variants_out: totals.out,
          variants_mto: totals.mto,
          // A bounded sample of failing codes so the run row is self-diagnosing
          // without a job_failures join. Full list is in job_failures.
          failed_codes_sample: failedCodes.slice(0, 50),
        },
      },
    }).catch((finalErr) => {
      console.error('[laltex-stock] WARNING: could not finalise job_runs row:', finalErr.message);
    });
  }

  return {
    runId,
    fetched,
    updated,
    failed,
    durationMs: Date.now() - runStart,
    status,
    errorMessage: errorMessage ?? undefined,
  };
}
