/**
 * Hard per-IP rate limit for the AI chat endpoint.
 *
 * This is the cost backstop. Unlike the anonymous searchProducts quota
 * (ai_quotas), it does NOT depend on any client-supplied identifier: it keys
 * on the request's source IP and applies to EVERY request to /api/ai/chat,
 * anonymous or signed-in, whether or not a visitor_id is present. An abusive
 * client sends whatever it likes (or nothing) — the IP is the one thing it
 * cannot fake without also distributing across many hosts, and provider spend
 * caps (Anthropic/OpenAI dashboards) are the final ceiling for that case.
 *
 * The counter lives in Postgres (ai_ip_rate_limits) because serverless
 * functions are stateless; the RPC is atomic (row lock) so concurrent requests
 * from one IP cannot race past the cap.
 *
 * Limit: RATE_LIMIT_MAX requests per RATE_LIMIT_WINDOW_SECONDS per IP.
 * 60/hour is generous for any real human (a person sends a handful of messages
 * and reads each reply) and comfortable even for a shared office/household
 * behind one NAT IP, while bounding a runaway to ~60 Anthropic turns/hour/IP
 * (order of $1/hour/IP at current per-turn cost). Tune the two constants.
 */

import { hashIpFallback } from './ai-quota.js';

export const RATE_LIMIT_MAX = 60;
export const RATE_LIMIT_WINDOW_SECONDS = 3600;

/**
 * Best-effort source IP from the request. Vercel sets x-forwarded-for; the
 * left-most entry is the client. Falls back to the socket address.
 * @param {object} req
 * @returns {string|null}
 */
export function getClientIp(req) {
  const xff = req?.headers?.['x-forwarded-for'];
  let first = null;
  if (typeof xff === 'string') first = xff.split(',')[0]?.trim();
  else if (Array.isArray(xff)) first = xff[0]?.split?.(',')[0]?.trim() ?? xff[0];
  return first || req?.socket?.remoteAddress || null;
}

function pgHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * Atomically count this request against the per-IP limit.
 *
 * On success returns { allowed, currentCount, windowResetsAt, ipHash }.
 * When no IP can be derived (should not happen on Vercel), returns
 * { allowed:true, unkeyed:true } so a genuine user is never blocked by a
 * missing IP; the caller logs it. On a DB error it THROWS — the caller decides
 * whether to fail open or closed.
 *
 * @param {object} opts
 * @param {string} opts.supabaseUrl
 * @param {string} opts.serviceRoleKey
 * @param {string|null} opts.ip
 * @param {number} [opts.max]
 * @param {number} [opts.windowSeconds]
 */
export async function checkIpRateLimit({
  supabaseUrl,
  serviceRoleKey,
  ip,
  max = RATE_LIMIT_MAX,
  windowSeconds = RATE_LIMIT_WINDOW_SECONDS,
}) {
  const ipHash = hashIpFallback(ip);
  if (!ipHash) {
    return { allowed: true, unkeyed: true, ipHash: null, currentCount: 0, windowResetsAt: null };
  }

  const url = `${supabaseUrl}/rest/v1/rpc/check_and_increment_ip_rate_limit`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: pgHeaders(serviceRoleKey),
    body: JSON.stringify({
      p_ip_hash: ipHash,
      p_window_seconds: windowSeconds,
      p_max_requests: max,
    }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`ip rate-limit RPC ${resp.status}: ${text.slice(0, 300)}`);
  }
  const rows = text ? JSON.parse(text) : [];
  const row = Array.isArray(rows) ? rows[0] : rows;
  return {
    allowed: !!row?.allowed,
    ipHash,
    currentCount: Number(row?.current_count) || 0,
    windowResetsAt: row?.window_resets_at ?? null,
  };
}
