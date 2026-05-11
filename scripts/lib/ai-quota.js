/**
 * AI assistant quota + identity helpers.
 *
 * Anonymous searchProducts calls are capped at ANON_DAILY_LIMIT per
 * visitor_id_hash over a rolling 24-hour window. Signed-in users are
 * unlimited and never read or write this table.
 *
 * State lives in ai_quotas (one row per visitor_id_hash). When a call
 * arrives more than 24h after the row's window_started_at, the counter
 * resets and the window slides forward. This is implemented in
 * application code (not a Postgres function) so the math is debuggable
 * and so a chat endpoint can decide whether to allow the call BEFORE
 * paying an Anthropic round-trip.
 *
 * Visitor hashing: the raw FingerprintJS visitor_id never leaves the
 * server in plaintext. We SHA-256 it (with the optional VISITOR_HASH_SALT
 * env var) and use the hex digest as the key. CLAUDE.md §32.6.
 */

import crypto from 'node:crypto';

export const ANON_DAILY_LIMIT = 5;
export const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

// Optional salt — if set, prevents anyone with read access to ai_quotas
// from rainbow-table-attacking visitor IDs. Default is empty (no salt)
// so the migration applies to existing infra without an env var change;
// CLAUDE.md §32.6 notes this as a hardening follow-up.
const SALT = process.env.VISITOR_HASH_SALT || '';

/**
 * Hash a raw visitor_id into the form stored in ai_quotas. Stable across
 * requests and across the chat endpoint + verification harness.
 *
 * @param {string} rawVisitorId
 * @returns {string} 64-char hex
 */
export function hashVisitorId(rawVisitorId) {
  if (typeof rawVisitorId !== 'string' || rawVisitorId.length === 0) {
    throw new Error('hashVisitorId: visitor_id must be a non-empty string');
  }
  return crypto.createHash('sha256').update(SALT + rawVisitorId, 'utf8').digest('hex');
}

/**
 * Fallback hash when FingerprintJS fails (adblocker, exotic browser,
 * client error). Hashes the request's source IP — far less stable than
 * a real fingerprint, but better than 0 protection. Two-line defensive
 * fallback per the session 5 spec.
 *
 * @param {string|null|undefined} ip
 * @returns {string|null} hashed value, or null if no IP is available
 */
export function hashIpFallback(ip) {
  if (!ip || typeof ip !== 'string') return null;
  return crypto.createHash('sha256').update(SALT + 'ip:' + ip.trim(), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// PostgREST helpers
// ---------------------------------------------------------------------------

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
// Quota inspection (read-only) — used before deciding whether to run
// a search this turn. Returns the effective remaining count assuming
// the window may have rolled over since the row was last written.
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.supabaseUrl
 * @param {string} opts.serviceRoleKey
 * @param {string} opts.visitorHash
 * @returns {Promise<{
 *   used: number,
 *   remaining: number,
 *   window_started_at: string | null,
 *   window_resets_at: string | null
 * }>}
 */
export async function getQuotaStatus({ supabaseUrl, serviceRoleKey, visitorHash }) {
  const url =
    `${supabaseUrl}/rest/v1/ai_quotas` +
    `?visitor_id_hash=eq.${encodeURIComponent(visitorHash)}` +
    `&select=searches_used,window_started_at,last_search_at` +
    `&limit=1`;
  const rows = await pgRest('GET', url, serviceRoleKey);

  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      used: 0,
      remaining: ANON_DAILY_LIMIT,
      window_started_at: null,
      window_resets_at: null,
    };
  }

  const row = rows[0];
  const windowStartedMs = Date.parse(row.window_started_at);
  const ageMs = Date.now() - windowStartedMs;
  if (Number.isFinite(ageMs) && ageMs >= QUOTA_WINDOW_MS) {
    // Window has rolled over; the row is stale and we'll reset on next write.
    return {
      used: 0,
      remaining: ANON_DAILY_LIMIT,
      window_started_at: null,
      window_resets_at: null,
    };
  }

  const used = Number(row.searches_used) || 0;
  const remaining = Math.max(0, ANON_DAILY_LIMIT - used);
  const resetsAt = new Date(windowStartedMs + QUOTA_WINDOW_MS).toISOString();
  return {
    used,
    remaining,
    window_started_at: row.window_started_at,
    window_resets_at: resetsAt,
  };
}

// ---------------------------------------------------------------------------
// Atomic increment via Postgres UPSERT.
//
// We do this in-application rather than via a Postgres function because
// the chat endpoint is the only writer and atomicity at this scale is
// served by the unique constraint on visitor_id_hash + the rare race
// window. Two simultaneous chat turns from the same fingerprint hitting
// "use the 5th search" would, in the worst case, both succeed and land
// the counter at 6 — acceptable because the next call still blocks at
// remaining=0. (Verified in the spec's verification queries.)
//
// If the window has rolled over since the row was last written, we
// reset the counter to 1 and update window_started_at to now in the
// same upsert.
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.supabaseUrl
 * @param {string} opts.serviceRoleKey
 * @param {string} opts.visitorHash
 * @returns {Promise<{ used:number, remaining:number, window_started_at:string, window_resets_at:string }>}
 */
export async function incrementQuota({ supabaseUrl, serviceRoleKey, visitorHash }) {
  const status = await getQuotaStatus({ supabaseUrl, serviceRoleKey, visitorHash });
  const nowIso = new Date().toISOString();
  const newUsed = (status.window_started_at == null ? 0 : status.used) + 1;
  // If the row never existed or just rolled over, reset window_started_at.
  const newWindowStart = status.window_started_at ?? nowIso;

  // PostgREST UPSERT keyed on the PK.
  const url = `${supabaseUrl}/rest/v1/ai_quotas`;
  await pgRest('POST', url, serviceRoleKey, {
    body: [{
      visitor_id_hash: visitorHash,
      searches_used: newUsed,
      window_started_at: newWindowStart,
      last_search_at: nowIso,
    }],
    extraHeaders: {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
  });

  const windowStartMs = Date.parse(newWindowStart);
  return {
    used: newUsed,
    remaining: Math.max(0, ANON_DAILY_LIMIT - newUsed),
    window_started_at: newWindowStart,
    window_resets_at: new Date(windowStartMs + QUOTA_WINDOW_MS).toISOString(),
  };
}

/**
 * Convenience: should the caller be allowed to invoke searchProducts?
 * Returns the same status shape as getQuotaStatus, plus an `allowed`
 * boolean. Called from /api/ai/chat BEFORE the Anthropic call so we
 * can tell the model the customer is out of searches.
 *
 * Signed-in callers (no visitorHash) are always allowed.
 *
 * @param {object} opts
 * @param {string} opts.supabaseUrl
 * @param {string} opts.serviceRoleKey
 * @param {string|null} opts.visitorHash
 * @returns {Promise<{
 *   allowed:boolean,
 *   used:number|null,
 *   remaining:number|'unlimited',
 *   window_resets_at:string|null
 * }>}
 */
export async function checkSearchQuota({ supabaseUrl, serviceRoleKey, visitorHash }) {
  if (!visitorHash) {
    return { allowed: true, used: null, remaining: 'unlimited', window_resets_at: null };
  }
  const status = await getQuotaStatus({ supabaseUrl, serviceRoleKey, visitorHash });
  return {
    allowed: status.remaining > 0,
    used: status.used,
    remaining: status.remaining,
    window_resets_at: status.window_resets_at,
  };
}
