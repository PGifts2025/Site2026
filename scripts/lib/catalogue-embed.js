/**
 * Core batch-embed logic for the supplier_products catalogue.
 *
 * Exports:
 *   embedCatalogue({ ... }) — end-to-end embed run. Creates a
 *     job_runs row with job_type='embed' (supplier_id NULL — embed
 *     is supplier-agnostic, see CLAUDE.md §27), reads supplier_products
 *     across every supplier, computes source-text hashes via session 2
 *     helpers, skips rows whose hash matches the stored
 *     embedding_source_hash, issues a single batched
 *     OpenAI embeddings.create call for the rows that need updating,
 *     writes the resulting vectors back row-by-row, and finalises
 *     the job_runs row (completed | failed).
 *
 * Architecture notes:
 *
 * 1. Hash gate is invariant, not optimisation:
 *    OpenAI is NEVER called for rows whose current source text
 *    hashes to the stored embedding_source_hash. This is the
 *    cost-control mechanism documented in CLAUDE.md §26.10.3 and
 *    §26.10.7 — do not bypass it.
 *
 * 2. Supplier-agnostic:
 *    Session 3b scoped this module to supplier_id='laltex' because
 *    that was the only supplier. Session 4a added pgifts-direct,
 *    and session 4a.1 (this file) makes the embed span every row
 *    of supplier_products. Hash gating is what makes a wide read
 *    safe — unchanged rows still skip the API call.
 *
 *    Sync remains per-supplier (one cron per supplier feed); see
 *    laltex-sync.js for the parallel sync code path.
 *
 * 3. Single batch OpenAI call:
 *    text-embedding-3-small accepts up to 2048 inputs per call.
 *    The combined catalogue is ~1217 products today (1192 Laltex +
 *    25 PGifts Direct), so a complete rebuild still fits in one
 *    call. No chunking needed at current scale. If the catalogue
 *    ever exceeds ~2000 rows, extend this module to chunk in
 *    slices of OPENAI_BATCH_MAX_INPUTS.
 *
 * 4. DB access is PostgREST + service_role:
 *    Same pattern as session 3a laltex-sync.js. Reads are
 *    paginated (guard against the 1000-row cap — CLAUDE.md §28.1).
 *    Writes are per-row UPDATE via PostgREST PATCH keyed on id.
 *    Sequential updates are fine at sub-2k scale.
 *
 * 5. Continue-with-logging:
 *    If the OpenAI batch call fails, the whole run is 'failed'
 *    (a batch call is atomic — nothing partial to log).
 *    If an individual per-row UPDATE fails, that row goes to
 *    job_failures and the remaining rows still get written.
 *    try/finally ensures job_runs never stays 'running'.
 *
 * 6. Source recipe coupling:
 *    buildEmbeddingSourceText() lives in scripts/lib/embedding.js
 *    (session 2). A change there will flip every row's hash on the
 *    next run → every row re-embeds. That's deliberate; see
 *    CLAUDE.md §26.10.7.
 */

import OpenAI from 'openai';

import {
  EMBEDDING_MODEL,
  EMBEDDING_DIMS,
  buildEmbeddingSourceText,
  hashSourceText,
  estimateEmbeddingCost,
  vectorLiteral,
} from './embedding.js';

// Supabase PostgREST caps responses at 1000 rows server-side, even
// with service_role + ?limit=. See CLAUDE.md §28.1.
const SUPPLIER_PRODUCTS_PAGE_SIZE = 1000;

// OpenAI text-embedding-3-small accepts 2048 inputs per call. The
// combined catalogue is ~1217, so one batch is enough today. Chunk
// only if we cross this in future.
const OPENAI_BATCH_MAX_INPUTS = 2048;

// Fields we need off each supplier_products row to build source text
// and decide whether to re-embed. id is essential — it's the write key.
const SUPPLIER_PRODUCTS_SELECT =
  'id,supplier_product_code,name,category,sub_category,description,web_description,keywords,material,available_colours,embedding_source_hash,embedding';

// ---------------------------------------------------------------------------
// PostgREST helpers — match session 3a laltex-sync.js for style parity
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
// job_runs lifecycle helpers (job_type='embed', supplier_id NULL)
// ---------------------------------------------------------------------------

async function insertJobRun({ supabaseUrl, serviceRoleKey, runType, triggeredBy, metadata }) {
  const url = `${supabaseUrl}/rest/v1/job_runs`;
  const rows = await pgRest('POST', url, serviceRoleKey, {
    body: [{
      supplier_id: null,        // embed spans every supplier — see §27 / §26.11
      run_type: runType,
      status: 'running',
      triggered_by: triggeredBy,
      job_type: 'embed',
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
    console.error('[catalogue-embed] WARNING: job_failures insert failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Rows — read every supplier_products row, paginated past the 1000-row cap
// ---------------------------------------------------------------------------

async function fetchAllSupplierProducts({ supabaseUrl, serviceRoleKey }) {
  const out = [];
  let offset = 0;
  /* eslint-disable no-await-in-loop */
  for (;;) {
    const url =
      `${supabaseUrl}/rest/v1/supplier_products` +
      `?select=${SUPPLIER_PRODUCTS_SELECT}` +
      `&order=id.asc` +
      `&limit=${SUPPLIER_PRODUCTS_PAGE_SIZE}` +
      `&offset=${offset}`;
    const page = await pgRest('GET', url, serviceRoleKey);
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < SUPPLIER_PRODUCTS_PAGE_SIZE) break;
    offset += SUPPLIER_PRODUCTS_PAGE_SIZE;
  }
  /* eslint-enable no-await-in-loop */
  return out;
}

// ---------------------------------------------------------------------------
// Per-row update — writes embedding + hash + embedded_at
// ---------------------------------------------------------------------------

async function updateEmbedding({ supabaseUrl, serviceRoleKey, id, embedding, sourceHash }) {
  const vecLit = vectorLiteral(embedding);
  const url = `${supabaseUrl}/rest/v1/supplier_products?id=eq.${encodeURIComponent(id)}`;
  await pgRest('PATCH', url, serviceRoleKey, {
    body: {
      embedding: vecLit,               // pgvector accepts its text form via PostgREST
      embedding_source_hash: sourceHash,
      embedded_at: new Date().toISOString(),
    },
    extraHeaders: { Prefer: 'return=minimal' },
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Run a full-catalogue embed across every supplier.
 *
 * @param {object} opts
 * @param {string} opts.openaiKey         OPENAI_API_KEY
 * @param {string} opts.supabaseUrl       VITE_SUPABASE_URL
 * @param {string} opts.serviceRoleKey    SUPABASE_SERVICE_ROLE_KEY
 * @param {string} opts.triggeredBy       'cron' | 'manual' | 'cli'
 * @param {function(string)=} opts.progress
 * @returns {Promise<{
 *   runId:string,
 *   considered:number,
 *   embedRequested:number,
 *   embedSkipped:number,
 *   updated:number,
 *   failed:number,
 *   tokensUsed:number,
 *   costUsd:number,
 *   durationMs:number,
 *   status:'completed'|'failed',
 *   errorMessage?:string
 * }>}
 */
export async function embedCatalogue({
  openaiKey,
  supabaseUrl,
  serviceRoleKey,
  triggeredBy,
  progress,
}) {
  ensureEnv('openaiKey', openaiKey);
  ensureEnv('supabaseUrl', supabaseUrl);
  ensureEnv('serviceRoleKey', serviceRoleKey);
  ensureEnv('triggeredBy', triggeredBy);

  const log = (msg) => {
    if (typeof progress === 'function') progress(msg);
    else console.log(msg);
  };

  const runStart = Date.now();

  // 1. Open job_runs row (job_type='embed', supplier_id=NULL)
  const runId = await insertJobRun({
    supabaseUrl,
    serviceRoleKey,
    runType: 'full_catalogue',
    triggeredBy,
    metadata: { model: EMBEDDING_MODEL, dims: EMBEDDING_DIMS, started_iso: new Date(runStart).toISOString() },
  });

  let status = 'failed';
  let errorMessage = null;
  let considered = 0;
  let embedRequested = 0;
  let embedSkipped = 0;
  let updated = 0;
  let failed = 0;
  let tokensUsed = 0;
  let costUsd = 0;

  try {
    // 2. Pull all supplier_products rows (paginated, every supplier)
    log(`[embed] run ${runId} — reading supplier_products …`);
    const rows = await fetchAllSupplierProducts({ supabaseUrl, serviceRoleKey });
    considered = rows.length;
    log(`[embed] considering ${considered} rows`);

    if (considered === 0) {
      status = 'completed';
      return {
        runId, considered, embedRequested, embedSkipped,
        updated, failed, tokensUsed, costUsd,
        durationMs: Date.now() - runStart, status,
      };
    }

    // 3. Partition into skip vs embed
    const toEmbed = []; // { id, code, sourceText, hash }
    for (const r of rows) {
      const sourceText = buildEmbeddingSourceText(r);
      if (!sourceText) {
        // No usable source text at all; skip and log a failure row so it's visible.
        failed += 1;
        await insertJobFailures({
          supabaseUrl, serviceRoleKey, rows: [{
            job_run_id: runId,
            supplier_product_code: r.supplier_product_code ?? null,
            reason: 'empty_source_text',
            error_message: 'buildEmbeddingSourceText produced empty string',
          }],
        });
        continue;
      }
      const hash = hashSourceText(sourceText);
      const hasEmbedding = r.embedding != null && r.embedding !== '';
      if (hasEmbedding && r.embedding_source_hash === hash) {
        embedSkipped += 1;
        continue;
      }
      toEmbed.push({ id: r.id, code: r.supplier_product_code, sourceText, hash });
    }
    embedRequested = toEmbed.length;
    log(`[embed] ${embedSkipped} unchanged, ${embedRequested} to embed, ${failed} already failed pre-API`);

    // 4. Nothing to do? Finish clean.
    if (embedRequested === 0) {
      status = 'completed';
      return {
        runId, considered, embedRequested, embedSkipped,
        updated, failed, tokensUsed, costUsd,
        durationMs: Date.now() - runStart, status,
      };
    }

    // 5. Issue the OpenAI batch call
    if (embedRequested > OPENAI_BATCH_MAX_INPUTS) {
      // Chunking is not implemented at current scale — we're below the limit.
      // If this ever fires, either chunk here or raise: the throw makes the
      // failure surface explicit rather than silently half-embedding.
      throw new Error(
        `embedRequested=${embedRequested} exceeds OpenAI batch limit ${OPENAI_BATCH_MAX_INPUTS}; chunking not yet implemented (extend catalogue-embed.js)`,
      );
    }
    log(`[embed] OpenAI embeddings.create — ${embedRequested} inputs, model=${EMBEDDING_MODEL}`);
    const openai = new OpenAI({ apiKey: openaiKey });
    const resp = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: toEmbed.map((t) => t.sourceText),
      encoding_format: 'float',
    });
    if (!Array.isArray(resp?.data) || resp.data.length !== embedRequested) {
      throw new Error(
        `OpenAI returned ${resp?.data?.length ?? '?'} embeddings for ${embedRequested} inputs`,
      );
    }
    tokensUsed = resp?.usage?.total_tokens ?? 0;
    const cost = estimateEmbeddingCost(tokensUsed);
    costUsd = Number(cost.usd.toFixed(6));
    log(`[embed] OpenAI ok — tokens_used=${tokensUsed}, cost ≈ $${costUsd.toFixed(6)} (~${cost.pence.toFixed(4)}p)`);

    // 6. Write back per-row (sequential at sub-2k scale)
    const updateFailures = [];
    for (let i = 0; i < toEmbed.length; i += 1) {
      const target = toEmbed[i];
      const vec = resp.data[i]?.embedding;
      if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMS) {
        updateFailures.push({
          job_run_id: runId,
          supplier_product_code: target.code ?? null,
          reason: 'bad_embedding_shape',
          error_message: `expected ${EMBEDDING_DIMS} dims, got ${Array.isArray(vec) ? vec.length : typeof vec}`,
        });
        continue;
      }
      /* eslint-disable no-await-in-loop */
      try {
        await updateEmbedding({
          supabaseUrl, serviceRoleKey,
          id: target.id,
          embedding: vec,
          sourceHash: target.hash,
        });
        updated += 1;
      } catch (rowErr) {
        updateFailures.push({
          job_run_id: runId,
          supplier_product_code: target.code ?? null,
          reason: 'embed_update_failed',
          error_message: rowErr?.message?.slice(0, 1000) ?? 'unknown',
        });
      }
      /* eslint-enable no-await-in-loop */
      if ((i + 1) % 100 === 0 || i + 1 === toEmbed.length) {
        log(`[embed] wrote ${i + 1}/${toEmbed.length} — updated=${updated} failed=${updateFailures.length}`);
      }
    }

    failed += updateFailures.length;
    if (updateFailures.length) {
      await insertJobFailures({ supabaseUrl, serviceRoleKey, rows: updateFailures });
    }

    status = 'completed';
  } catch (err) {
    errorMessage = err?.message ?? String(err);
    status = 'failed';
    console.error('[catalogue-embed] run failed:', errorMessage);
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
        products_fetched: considered,
        products_updated: updated,
        products_failed: failed,
        error_message: errorMessage,
        metadata: {
          model: EMBEDDING_MODEL,
          dims: EMBEDDING_DIMS,
          embed_requested: embedRequested,
          embed_skipped_unchanged: embedSkipped,
          openai_tokens_used: tokensUsed,
          openai_cost_usd: costUsd,
        },
      },
    }).catch((finalErr) => {
      console.error('[catalogue-embed] WARNING: could not finalise job_runs row:', finalErr.message);
    });
  }

  return {
    runId,
    considered,
    embedRequested,
    embedSkipped,
    updated,
    failed,
    tokensUsed,
    costUsd,
    durationMs: Date.now() - runStart,
    status,
    errorMessage: errorMessage ?? undefined,
  };
}
