/**
 * Core batch-sync logic for the Laltex catalogue.
 *
 * Exports:
 *   syncFullCatalogue({ ... }) — end-to-end sync run. Creates a
 *     sync_runs row, fetches /v1/products/list from Laltex, normalises
 *     every product, bulk-upserts into supplier_products in small
 *     batches, records per-product failures into sync_failures, and
 *     finalises the sync_runs row (completed | failed).
 *
 * Architecture notes:
 *
 * 1. DB access pattern:
 *    Writes go via Supabase PostgREST (/rest/v1/{table}) authenticated
 *    with the SUPABASE_SERVICE_ROLE_KEY. This is the correct tool for
 *    bulk DML in a serverless context. Sessions 1 + 2 used the
 *    Management API (PAT + /database/query) which is admin-tier and
 *    wrong for 10k UPSERTs. See CLAUDE.md §27 for the full split.
 *
 * 2. Blast radius on batch failure:
 *    PostgREST bulk UPSERT is atomic per batch — a single bad row
 *    fails the whole batch. We chunk into UPSERT_BATCH_SIZE rows
 *    (default 50). On batch failure, we fall back to single-row
 *    UPSERTs across the same chunk to isolate the bad rows. Happy
 *    path is still ~200 fast batched requests; pathological case is
 *    one chunk of N single-row retries.
 *
 * 3. "Inserted vs updated" counters:
 *    We snapshot existing supplier_product_code values BEFORE the
 *    UPSERT (one small SELECT), then compare after. Cheap.
 *
 * 4. last_synced_at discipline:
 *    Only set on successful UPSERT of a given row. Failed rows keep
 *    their previous value so stale-detection queries still work.
 *
 * 5. Continue-with-logging:
 *    Per-product failures land in sync_failures, the run keeps going.
 *    Only infra-level errors (Laltex network failure, auth, no response)
 *    mark sync_runs.status = 'failed'. A finally block ensures the row
 *    is never left at status = 'running'.
 */

import { normaliseProduct, unwrapFeedResponse } from './laltex-parser.js';

const LALTEX_BASE = 'https://auto.laltex.com/trade/api';
const LALTEX_LIST_PATH = '/v1/products/list';

// Batch size picked to balance request size vs per-failure blast radius.
// Products with full payload + raw_payload average ~15-40 KB of JSON;
// 50 rows/batch keeps each POST well under PostgREST's 16 MB default
// body cap and keeps bad-row isolation cost bounded.
const UPSERT_BATCH_SIZE = 50;

// How often to log progress from the upsert loop.
const PROGRESS_LOG_EVERY_BATCHES = 5;

// Max chars of raw payload to persist into sync_failures.raw_snippet
// when a failure fires — keeps the failures table from exploding on
// pathological products.
const RAW_SNIPPET_CHARS = 2000;

// ---------------------------------------------------------------------------
// PostgREST helpers
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

/**
 * Execute a PostgREST call and return the JSON body (or throw).
 */
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
// sync_runs lifecycle helpers
// ---------------------------------------------------------------------------

async function insertSyncRun({ supabaseUrl, serviceRoleKey, supplierId, runType, triggeredBy, metadata }) {
  const url = `${supabaseUrl}/rest/v1/sync_runs`;
  const rows = await pgRest('POST', url, serviceRoleKey, {
    body: [{
      supplier_id: supplierId,
      run_type: runType,
      status: 'running',
      triggered_by: triggeredBy,
      metadata: metadata ?? null,
    }],
    extraHeaders: { Prefer: 'return=representation' },
  });
  if (!Array.isArray(rows) || !rows[0]?.id) {
    throw new Error('Failed to create sync_runs row');
  }
  return rows[0].id;
}

async function finaliseSyncRun({ supabaseUrl, serviceRoleKey, runId, patch }) {
  const url = `${supabaseUrl}/rest/v1/sync_runs?id=eq.${encodeURIComponent(runId)}`;
  await pgRest('PATCH', url, serviceRoleKey, {
    body: patch,
    extraHeaders: { Prefer: 'return=minimal' },
  });
}

async function insertSyncFailures({ supabaseUrl, serviceRoleKey, rows }) {
  if (!rows.length) return;
  const url = `${supabaseUrl}/rest/v1/sync_failures`;
  try {
    await pgRest('POST', url, serviceRoleKey, {
      body: rows,
      extraHeaders: { Prefer: 'return=minimal' },
    });
  } catch (err) {
    // Never let the failure-logger itself abort the run. Just log and move on.
    console.error('[laltex-sync] WARNING: sync_failures insert failed:', err.message);
  }
}

function truncateRawSnippet(raw) {
  try {
    const s = JSON.stringify(raw);
    if (s.length <= RAW_SNIPPET_CHARS) return raw;
    return {
      __truncated: true,
      __original_chars: s.length,
      preview: s.slice(0, RAW_SNIPPET_CHARS),
    };
  } catch {
    return { __stringify_failed: true };
  }
}

// ---------------------------------------------------------------------------
// Supplier lookup
// ---------------------------------------------------------------------------

async function getLaltexSupplierId({ supabaseUrl, serviceRoleKey }) {
  const url = `${supabaseUrl}/rest/v1/suppliers?slug=eq.laltex&select=id`;
  const rows = await pgRest('GET', url, serviceRoleKey);
  if (!Array.isArray(rows) || !rows[0]?.id) {
    throw new Error("suppliers row for slug='laltex' not found");
  }
  return rows[0].id;
}

// Supabase PostgREST caps responses at 1000 rows server-side (not
// overridable by ?limit or Range). Paginate explicitly.
const EXISTING_CODES_PAGE_SIZE = 1000;

async function getExistingCodes({ supabaseUrl, serviceRoleKey, supplierId }) {
  const set = new Set();
  let offset = 0;
  /* eslint-disable no-await-in-loop */
  for (;;) {
    const url = `${supabaseUrl}/rest/v1/supplier_products` +
      `?supplier_id=eq.${supplierId}` +
      `&select=supplier_product_code` +
      `&order=supplier_product_code.asc` +
      `&limit=${EXISTING_CODES_PAGE_SIZE}` +
      `&offset=${offset}`;
    const page = await pgRest('GET', url, serviceRoleKey);
    if (!Array.isArray(page) || page.length === 0) break;
    for (const r of page) {
      if (r.supplier_product_code) set.add(r.supplier_product_code);
    }
    if (page.length < EXISTING_CODES_PAGE_SIZE) break;
    offset += EXISTING_CODES_PAGE_SIZE;
  }
  /* eslint-enable no-await-in-loop */
  return set;
}

// ---------------------------------------------------------------------------
// Laltex fetch
// ---------------------------------------------------------------------------

async function fetchCatalogue({ laltexApiKey, baseUrl = LALTEX_BASE, path = LALTEX_LIST_PATH }) {
  const url = `${baseUrl}${path}`;
  const started = Date.now();
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      API_KEY: laltexApiKey,
      Accept: 'application/json',
    },
  });
  const durationMs = Date.now() - started;
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Laltex ${url} -> ${resp.status} ${resp.statusText}: ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  const products = unwrapFeedResponse(data);
  return { products, feedDurationMs: durationMs };
}

// ---------------------------------------------------------------------------
// Upsert path — bulk with single-row fallback
// ---------------------------------------------------------------------------

/**
 * Upsert a single chunk of already-normalised rows.
 *
 * On failure, fall back to per-row upserts across the same chunk so
 * we isolate which row(s) the batch choked on. Returns an array of
 * failed rows (each: { row, error }).
 */
async function upsertChunk({ supabaseUrl, serviceRoleKey, supplierId, chunk }) {
  const upsertUrl = `${supabaseUrl}/rest/v1/supplier_products?on_conflict=supplier_id,supplier_product_code`;
  const now = new Date().toISOString();
  const withMeta = chunk.map((r) => ({ ...r, supplier_id: supplierId, last_synced_at: now }));

  // Try the batch first
  try {
    await pgRest('POST', upsertUrl, serviceRoleKey, {
      body: withMeta,
      extraHeaders: {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
    });
    return { ok: withMeta.length, failures: [] };
  } catch (batchErr) {
    // Batch failed. Isolate per-row so one bad product doesn't drop
    // the other ~49 in the chunk.
    console.warn(`[laltex-sync] batch of ${withMeta.length} failed — falling back to single-row: ${batchErr.message}`);
    let ok = 0;
    const failures = [];
    for (const r of withMeta) {
      try {
        await pgRest('POST', upsertUrl, serviceRoleKey, {
          body: [r],
          extraHeaders: {
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
        });
        ok += 1;
      } catch (rowErr) {
        failures.push({ row: r, error: rowErr.message });
      }
    }
    return { ok, failures };
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Run a full-catalogue sync.
 *
 * @param {object} opts
 * @param {string} opts.laltexApiKey         LALTEX_API_KEY
 * @param {string} opts.supabaseUrl          VITE_SUPABASE_URL (PostgREST base)
 * @param {string} opts.serviceRoleKey       SUPABASE_SERVICE_ROLE_KEY
 * @param {string} opts.triggeredBy          'cron' | 'manual' | 'cli'
 * @param {function(string)=} opts.progress  optional progress logger
 * @returns {Promise<{runId:string, fetched:number, inserted:number, updated:number, failed:number, durationMs:number, status:'completed'|'failed', errorMessage?:string}>}
 */
export async function syncFullCatalogue({
  laltexApiKey,
  supabaseUrl,
  serviceRoleKey,
  triggeredBy,
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

  // 1. Resolve supplier_id
  const supplierId = await getLaltexSupplierId({ supabaseUrl, serviceRoleKey });

  // 2. Open sync_runs row
  const runId = await insertSyncRun({
    supabaseUrl,
    serviceRoleKey,
    supplierId,
    runType: 'full_catalogue',
    triggeredBy,
    metadata: { batch_size: UPSERT_BATCH_SIZE, started_iso: new Date(runStart).toISOString() },
  });

  let status = 'failed';
  let errorMessage = null;
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let failed = 0;

  try {
    // 3. Fetch Laltex feed
    log(`[sync] run ${runId} — fetching Laltex /v1/products/list …`);
    const { products, feedDurationMs } = await fetchCatalogue({ laltexApiKey });
    fetched = products.length;
    log(`[sync] feed returned ${fetched} products in ${feedDurationMs} ms`);

    if (fetched === 0) {
      // Not a hard fail — Laltex could legitimately return []; but unusual. Record as completed with zeroes.
      status = 'completed';
      await finaliseSyncRun({
        supabaseUrl, serviceRoleKey, runId,
        patch: {
          status,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - runStart,
          products_fetched: 0,
          products_inserted: 0,
          products_updated: 0,
          products_failed: 0,
          metadata: { batch_size: UPSERT_BATCH_SIZE, feed_duration_ms: feedDurationMs },
        },
      });
      return { runId, fetched, inserted, updated, failed, durationMs: Date.now() - runStart, status };
    }

    // 4. Snapshot existing codes for inserted/updated counters
    const existingCodes = await getExistingCodes({ supabaseUrl, serviceRoleKey, supplierId });

    // 5. Normalise + bucket
    const rows = [];
    const failures = []; // { reason, supplier_product_code, error_message, raw_snippet }
    for (const raw of products) {
      const { row, parseErrors } = normaliseProduct(raw);

      // Log every parse soft error — but don't skip the row unless
      // normaliseProduct returned row=null (unusable product).
      for (const pe of parseErrors) {
        failures.push({
          sync_run_id: runId,
          supplier_product_code: row?.supplier_product_code ?? (raw?.ProductCode ?? null),
          reason: 'parse_error',
          error_message: `${pe.field}: ${pe.message}`,
          raw_snippet: truncateRawSnippet(raw),
        });
      }

      if (!row) {
        failed += 1;
        continue;
      }
      rows.push(row);
    }
    log(`[sync] normalised ${rows.length} rows, ${failures.length} parse errors`);

    // Persist parse errors now so they land even if later upserts throw
    // unexpectedly. sync_failures.raw_snippet is truncated per row.
    if (failures.length) {
      await insertSyncFailures({ supabaseUrl, serviceRoleKey, rows: failures });
    }

    // 6. Upsert in chunks
    const batches = [];
    for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) batches.push(rows.slice(i, i + UPSERT_BATCH_SIZE));
    log(`[sync] upserting ${rows.length} rows in ${batches.length} batches of up to ${UPSERT_BATCH_SIZE} …`);

    const upsertFailures = [];
    for (let i = 0; i < batches.length; i += 1) {
      const chunk = batches[i];
      /* eslint-disable no-await-in-loop */
      const { ok, failures: batchFailures } = await upsertChunk({
        supabaseUrl, serviceRoleKey, supplierId, chunk,
      });

      // Per-row counters only count OK rows. Failed rows stay with
      // their previous last_synced_at — by design.
      for (const r of chunk.slice(0, ok + batchFailures.length)) {
        if (!batchFailures.some((f) => f.row.supplier_product_code === r.supplier_product_code)) {
          if (existingCodes.has(r.supplier_product_code)) updated += 1;
          else inserted += 1;
        }
      }

      for (const bf of batchFailures) {
        failed += 1;
        upsertFailures.push({
          sync_run_id: runId,
          supplier_product_code: bf.row.supplier_product_code ?? null,
          reason: 'upsert_failed',
          error_message: bf.error?.slice(0, 1000) ?? 'unknown',
          raw_snippet: truncateRawSnippet(bf.row.raw_payload),
        });
      }

      if ((i + 1) % PROGRESS_LOG_EVERY_BATCHES === 0 || i + 1 === batches.length) {
        log(`[sync] batch ${i + 1}/${batches.length} done — inserted=${inserted} updated=${updated} failed=${failed}`);
      }
      /* eslint-enable no-await-in-loop */
    }

    if (upsertFailures.length) {
      await insertSyncFailures({ supabaseUrl, serviceRoleKey, rows: upsertFailures });
    }

    status = 'completed';
  } catch (err) {
    // Infra-level failure (Laltex network, auth, schema out-of-sync, etc.)
    errorMessage = err?.message ?? String(err);
    status = 'failed';
    console.error('[laltex-sync] run failed:', errorMessage);
  } finally {
    // 7. Finalise sync_runs row — always, never leave it at 'running'
    const durationMs = Date.now() - runStart;
    await finaliseSyncRun({
      supabaseUrl,
      serviceRoleKey,
      runId,
      patch: {
        status,
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        products_fetched: fetched,
        products_inserted: inserted,
        products_updated: updated,
        products_failed: failed,
        error_message: errorMessage,
      },
    }).catch((finalErr) => {
      // Absolute last-resort — if even finalising fails, still surface to stdout.
      console.error('[laltex-sync] WARNING: could not finalise sync_runs row:', finalErr.message);
    });
  }

  return {
    runId,
    fetched,
    inserted,
    updated,
    failed,
    durationMs: Date.now() - runStart,
    status,
    errorMessage: errorMessage ?? undefined,
  };
}
