/**
 * POST /api/ai/chat — PGifts AI assistant entry point.
 *
 * This is the FIRST customer-facing endpoint in the Laltex integration.
 * Everything before it (sync, embed, search, alternatives) has been
 * server-to-server only. The widget calls this from the browser, so:
 *   - CORS headers (the search-only endpoints don't have these)
 *   - Per-visitor anonymous quota enforcement (no other endpoint does)
 *   - Two auth modes (signed-in Supabase JWT vs anonymous visitor hash)
 *
 * Pipeline:
 *   1. CORS / OPTIONS preflight.
 *   2. Identify caller (signed-in JWT or anonymous visitor) — 401 otherwise.
 *   3. Quota check (anonymous only). Returns the remaining count for
 *      use in the system-reminder block; does NOT increment yet.
 *   4. Load or create the ai_conversations row.
 *   5. Manual agentic loop with Anthropic Sonnet 4.6:
 *        a. Send {system + tools + messages} to messages.create.
 *        b. If response.stop_reason === 'tool_use': dispatch each tool
 *           call against /api/search-products or /api/find-alternatives
 *           (inter-API auth = Bearer CRON_SECRET; CLAUDE.md §32.6),
 *           accumulate tool_result blocks, increment counters, loop.
 *        c. If quota is exhausted AND model wants searchProducts: short-
 *            circuit by returning an is_error tool_result that explains
 *            the limit; the model then phrases the polite refusal.
 *        d. Stop when stop_reason === 'end_turn' (or 'max_tokens' / 'refusal'
 *            — both terminal here).
 *   6. Persist messages + token totals + cost; return conversation_id +
 *      assistant message + quota_status.
 *
 * Prompt caching:
 *   The system prompt + tool definitions cache together (render order is
 *   tools → system → messages). We place `cache_control: ephemeral` on
 *   the last system block; that breakpoint also covers the tools block.
 *   See CLAUDE.md §32.4 for the cache hit-rate math.
 *
 * The session 5 spec asked for `anthropic-beta: prompt-caching-2024-07-31`
 * — that header is from the beta era. Prompt caching is GA in the current
 * SDK (0.95.1); no beta header is needed. Documented as a spec deviation
 * in CLAUDE.md §32.10.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';

import { SYSTEM_PROMPT } from '../../scripts/lib/ai-system-prompt.js';
import { ALL_TOOLS, ANTHROPIC_CONFIG } from '../../scripts/lib/ai-tools.js';
import {
  checkSearchQuota,
  hashVisitorId,
  hashIpFallback,
  incrementQuota,
  ANON_DAILY_LIMIT,
} from '../../scripts/lib/ai-quota.js';

export const config = {
  maxDuration: 60, // seconds — typical turn 3–8s; tool-call turns can hit ~15s
};

// ---------------------------------------------------------------------------
// Cost math (Sonnet 4.6 list price as of session 5)
// ---------------------------------------------------------------------------
const PRICE_PER_M_INPUT_USD = 3.0;     // standard input
const PRICE_PER_M_CACHED_USD = 0.30;   // 10% of input — cache reads
const PRICE_PER_M_CACHE_WRITE_USD = 3.75; // 1.25× standard, 5-min TTL
const PRICE_PER_M_OUTPUT_USD = 15.0;

function estimateTurnCostUsd(usage) {
  const i = (usage?.input_tokens ?? 0) * PRICE_PER_M_INPUT_USD;
  const r = (usage?.cache_read_input_tokens ?? 0) * PRICE_PER_M_CACHED_USD;
  const w = (usage?.cache_creation_input_tokens ?? 0) * PRICE_PER_M_CACHE_WRITE_USD;
  const o = (usage?.output_tokens ?? 0) * PRICE_PER_M_OUTPUT_USD;
  return (i + r + w + o) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Inter-API call (the tools the model invokes)
// ---------------------------------------------------------------------------

function getSelfBaseUrl(req) {
  // In production Vercel sets x-forwarded-proto/host. In local dev (vite +
  // `vercel dev` or our in-process verification harness) we fall back to
  // localhost. The harness imports the handler in-process so this only
  // matters when calling out for tool dispatch.
  const proto = req?.headers?.['x-forwarded-proto'] || 'http';
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'localhost:3000';
  return process.env.AI_CHAT_SELF_BASE_URL || `${proto}://${host}`;
}

async function dispatchTool({ name, input, baseUrl, cronSecret }) {
  const path = name === 'searchProducts' ? '/api/search-products' :
               name === 'findAlternatives' ? '/api/find-alternatives' :
               null;
  if (!path) {
    return {
      ok: false,
      error: `Unknown tool: ${name}`,
      payload: { error: `Unknown tool: ${name}` },
    };
  }
  // Map the model's filter shape into the search endpoint's nested filters object.
  let body;
  if (name === 'searchProducts') {
    const { query, ...filters } = input ?? {};
    body = { query, filters };
  } else {
    body = input ?? {};
  }

  try {
    const resp = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 1000) }; }
    if (!resp.ok) {
      return {
        ok: false,
        error: `${path} returned HTTP ${resp.status}`,
        payload: parsed,
      };
    }
    return { ok: true, error: null, payload: parsed };
  } catch (err) {
    return {
      ok: false,
      error: err?.message ?? String(err),
      payload: { error: err?.message ?? String(err) },
    };
  }
}

// ---------------------------------------------------------------------------
// Supabase auth / data access
// ---------------------------------------------------------------------------

async function resolveUserFromBearer({ supabaseUrl, anonKey, bearerToken }) {
  // /auth/v1/user verifies the JWT and returns the user object. Using anon
  // key + the Authorization header is the standard pattern for server-side
  // verification of a Supabase session token without re-running the JWKS dance.
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

async function loadConversation({ supabaseUrl, serviceRoleKey, conversationId, userId, visitorHash }) {
  if (!conversationId) return null;
  // Identity guard: a user can only continue their own conversation;
  // a visitor can only continue conversations matching their hash.
  let filter;
  if (userId) filter = `&user_id=eq.${encodeURIComponent(userId)}`;
  else if (visitorHash) filter = `&visitor_id_hash=eq.${encodeURIComponent(visitorHash)}`;
  else return null;

  const rows = await pgRest(
    'GET',
    supabaseUrl,
    `/ai_conversations?id=eq.${encodeURIComponent(conversationId)}${filter}&select=*&limit=1`,
    serviceRoleKey,
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function createConversation({ supabaseUrl, serviceRoleKey, userId, visitorHash }) {
  const rows = await pgRest(
    'POST',
    supabaseUrl,
    '/ai_conversations',
    serviceRoleKey,
    {
      body: [{
        user_id: userId ?? null,
        visitor_id_hash: visitorHash ?? null,
        messages: [],
      }],
      extraHeaders: { Prefer: 'return=representation' },
    },
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function persistConversation({ supabaseUrl, serviceRoleKey, conversationId, patch }) {
  await pgRest(
    'PATCH',
    supabaseUrl,
    `/ai_conversations?id=eq.${encodeURIComponent(conversationId)}`,
    serviceRoleKey,
    { body: patch, extraHeaders: { Prefer: 'return=minimal' } },
  );
}

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

const MAX_USER_MESSAGE_CHARS = 2000;

function validateBody(body) {
  if (body == null || typeof body !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const { message, conversation_id, visitor_id } = body;
  if (typeof message !== 'string' || message.trim().length === 0) {
    return { ok: false, error: 'message (non-empty string) is required' };
  }
  if (message.length > MAX_USER_MESSAGE_CHARS) {
    return { ok: false, error: `message exceeds ${MAX_USER_MESSAGE_CHARS} chars` };
  }
  if (conversation_id != null && typeof conversation_id !== 'string') {
    return { ok: false, error: 'conversation_id must be a string' };
  }
  if (visitor_id != null && typeof visitor_id !== 'string') {
    return { ok: false, error: 'visitor_id must be a string' };
  }
  return {
    ok: true,
    message: message.trim(),
    conversationId: conversation_id ?? null,
    visitorId: visitor_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const ALLOW_METHODS = 'POST, OPTIONS';

function setCors(res, req) {
  // Permissive CORS at this stage — endpoint is gated by feature flag +
  // CRON_SECRET (for tool dispatch). When the public-facing layer lands,
  // tighten to allow-list.
  res.setHeader('Access-Control-Allow-Origin', req.headers?.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', ALLOW_METHODS);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Env guard
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const cronSecret = process.env.CRON_SECRET;
  const missing = [];
  if (!anthropicKey) missing.push('ANTHROPIC_API_KEY');
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('VITE_SUPABASE_ANON_KEY');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!cronSecret) missing.push('CRON_SECRET');
  if (missing.length) {
    return res.status(500).json({ error: 'Missing required env vars', missing });
  }

  // 2. Parse body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'body is not valid JSON' }); }
  }
  const v = validateBody(body);
  if (!v.ok) return res.status(400).json({ error: v.error });

  // 3. Identify caller — signed-in JWT or anonymous visitor.
  let userId = null;
  let visitorHash = null;
  const auth = req.headers?.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    if (token.length > 0) {
      const user = await resolveUserFromBearer({
        supabaseUrl, anonKey: supabaseAnonKey, bearerToken: token,
      });
      if (user) userId = user.id;
    }
  }
  if (!userId) {
    // Spec: "if neither [JWT nor visitor_id] available: 401".
    // The visitor_id FIELD must be present in the body (even if its
    // value is null/empty because FingerprintJS failed). Without that,
    // the client never tried to identify itself and we reject. The
    // IP-hash fallback below ONLY kicks in to rescue clients whose
    // FingerprintJS produced a value the server can't use (adblocker
    // mangling, exotic browsers, hash error) — see CLAUDE.md §32.6.
    const visitorFieldPresent = body != null && 'visitor_id' in body;
    if (!visitorFieldPresent) {
      return res.status(401).json({ error: 'No identity — provide a Bearer Supabase JWT or visitor_id in the body' });
    }
    if (v.visitorId) {
      try { visitorHash = hashVisitorId(v.visitorId); } catch { /* fall through to IP fallback */ }
    }
    if (!visitorHash) {
      const ip = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress;
      visitorHash = hashIpFallback(ip);
    }
    if (!visitorHash) {
      return res.status(401).json({ error: 'Could not derive visitor identity' });
    }
  }

  // 4. Pre-call quota check (anonymous only). Doesn't increment yet —
  //    we only consume when the model actually invokes searchProducts.
  const preQuota = await checkSearchQuota({ supabaseUrl, serviceRoleKey, visitorHash });

  // 5. Load or create the conversation.
  let conversation = await loadConversation({
    supabaseUrl, serviceRoleKey, conversationId: v.conversationId, userId, visitorHash,
  });
  if (!conversation) {
    conversation = await createConversation({ supabaseUrl, serviceRoleKey, userId, visitorHash });
    if (!conversation?.id) return res.status(500).json({ error: 'Failed to create conversation' });
  }
  const messages = Array.isArray(conversation.messages) ? [...conversation.messages] : [];

  // Append the new user turn. The system-reminder carrying quota status
  // goes inline as a separate text block so the cached prefix isn't
  // disturbed (it's appended at the END of messages, not the start).
  const quotaReminder = userId
    ? null
    : `<system-reminder>Customer quota: ${preQuota.used ?? 0}/${ANON_DAILY_LIMIT} searches used in current 24h window (${preQuota.remaining} remaining). Window resets ${preQuota.window_resets_at ?? 'on first search'}. Anonymous users get ${ANON_DAILY_LIMIT}/day; signed-in users unlimited.</system-reminder>`;

  const userTurnContent = [{ type: 'text', text: v.message }];
  if (quotaReminder) userTurnContent.push({ type: 'text', text: quotaReminder });
  messages.push({ role: 'user', content: userTurnContent });

  // 6. Agentic loop.
  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const baseUrl = getSelfBaseUrl(req);

  let searchCalls = 0;
  let alternativeCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedReadTokens = 0;
  let totalCachedWriteTokens = 0;
  let totalCostUsd = 0;
  let quotaAfter = preQuota;
  let assistantContentBlocks = null;
  let stopReason = null;
  // Session 6: accumulate slimmed product cards from successful tool
  // calls. The widget renders these as clickable cards alongside the
  // assistant prose. We collect from BOTH searchProducts and
  // findAlternatives; the latest call's results win when codes
  // overlap.
  const productCardMap = new Map();

  const MAX_LOOP_ITERATIONS = 6; // safety net; typical turn is 1-3 iterations
  let iter = 0;

  try {
    while (iter < MAX_LOOP_ITERATIONS) {
      iter += 1;

      const response = await anthropic.messages.create({
        model: ANTHROPIC_CONFIG.model,
        max_tokens: ANTHROPIC_CONFIG.max_tokens,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        tools: ALL_TOOLS,
        messages,
      });

      // Token accounting
      totalInputTokens += response.usage?.input_tokens ?? 0;
      totalOutputTokens += response.usage?.output_tokens ?? 0;
      totalCachedReadTokens += response.usage?.cache_read_input_tokens ?? 0;
      totalCachedWriteTokens += response.usage?.cache_creation_input_tokens ?? 0;
      totalCostUsd += estimateTurnCostUsd(response.usage);

      // Append assistant turn (full content — preserves tool_use blocks
      // for the next API round-trip if we keep looping).
      messages.push({ role: 'assistant', content: response.content });
      assistantContentBlocks = response.content;
      stopReason = response.stop_reason;

      if (response.stop_reason !== 'tool_use') break;

      // Dispatch every tool_use block in the assistant message.
      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      const toolResults = [];
      for (const tool of toolUseBlocks) {
        if (tool.name === 'searchProducts') {
          // Quota gate. Signed-in users skip; anonymous users check.
          // (At this point we're already inside the !userId branch so
          // quotaAfter.remaining is a number, never the 'unlimited' sentinel.)
          if (!userId) {
            if (typeof quotaAfter.remaining === 'number' && quotaAfter.remaining <= 0) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: tool.id,
                is_error: true,
                content: `Quota exhausted: this visitor has used all ${ANON_DAILY_LIMIT} of their daily searches. Window resets at ${quotaAfter.window_resets_at ?? 'midnight UTC'}. Politely explain to the customer that they can sign up for unlimited searches.`,
              });
              continue;
            }
            // Otherwise allow + increment.
            quotaAfter = await incrementQuota({ supabaseUrl, serviceRoleKey, visitorHash });
          }
          searchCalls += 1;
          const out = await dispatchTool({
            name: 'searchProducts', input: tool.input, baseUrl, cronSecret,
          });
          const slimmed = out.ok ? truncateForModel(out.payload) : null;
          if (slimmed?.results) {
            for (const r of slimmed.results) {
              if (r?.supplier_product_code) productCardMap.set(r.supplier_product_code, r);
            }
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            is_error: !out.ok,
            content: JSON.stringify(slimmed ?? { error: out.error }),
          });
        } else if (tool.name === 'findAlternatives') {
          alternativeCalls += 1;
          const out = await dispatchTool({
            name: 'findAlternatives', input: tool.input, baseUrl, cronSecret,
          });
          const slimmed = out.ok ? truncateForModel(out.payload) : null;
          if (slimmed?.alternatives) {
            for (const r of slimmed.alternatives) {
              if (r?.supplier_product_code) productCardMap.set(r.supplier_product_code, r);
            }
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            is_error: !out.ok,
            content: JSON.stringify(slimmed ?? { error: out.error }),
          });
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            is_error: true,
            content: `Unknown tool: ${tool.name}`,
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }
  } catch (err) {
    console.error('[ai/chat] anthropic loop failed:', err?.message);
    return res.status(500).json({
      error: 'Anthropic API failure',
      error_code: 'anthropic_error',
      message: err?.message ?? String(err),
    });
  }

  // 7. Persist.
  try {
    await persistConversation({
      supabaseUrl, serviceRoleKey, conversationId: conversation.id,
      patch: {
        messages,
        search_tool_calls: (conversation.search_tool_calls ?? 0) + searchCalls,
        alternative_tool_calls: (conversation.alternative_tool_calls ?? 0) + alternativeCalls,
        total_input_tokens: (conversation.total_input_tokens ?? 0) + totalInputTokens,
        total_output_tokens: (conversation.total_output_tokens ?? 0) + totalOutputTokens,
        total_cached_input_tokens: (conversation.total_cached_input_tokens ?? 0) + totalCachedReadTokens,
        estimated_cost_usd: Number(
          ((conversation.estimated_cost_usd ?? 0) + totalCostUsd).toFixed(6),
        ),
      },
    });
  } catch (err) {
    // Don't fail the response if persistence hiccups — log and continue.
    console.error('[ai/chat] persist failed:', err?.message);
  }

  // 8. Shape the response.
  const assistantTextBlocks = (assistantContentBlocks ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text);
  const toolCallSummaries = (assistantContentBlocks ?? [])
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ name: b.name, input: b.input }));

  // Session 6: build the product cards payload. If the assistant text
  // mentions specific codes, surface only those (most relevant); else
  // return everything we accumulated this turn, capped at 6.
  const assistantText = assistantTextBlocks.join('\n\n');
  const allCards = Array.from(productCardMap.values());
  const mentioned = allCards.filter((c) =>
    c.supplier_product_code &&
    assistantText.toLowerCase().includes(String(c.supplier_product_code).toLowerCase()),
  );
  const productCards = (mentioned.length > 0 ? mentioned : allCards).slice(0, 6);

  return res.status(200).json({
    conversation_id: conversation.id,
    message: {
      role: 'assistant',
      content: assistantText,
      tool_calls: toolCallSummaries,
    },
    products: productCards,
    stop_reason: stopReason,
    quota_status: {
      used: quotaAfter.used,
      remaining: quotaAfter.remaining,
      window_resets_at: quotaAfter.window_resets_at,
    },
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      cache_read_input_tokens: totalCachedReadTokens,
      cache_creation_input_tokens: totalCachedWriteTokens,
      estimated_cost_usd: Number(totalCostUsd.toFixed(6)),
    },
    signed_in: userId != null,
  });
}

// ---------------------------------------------------------------------------
// Truncate search results to a Claude-friendly shape.
//
// /api/search-products returns full product rows including JSONB blobs
// (product_pricing, print_details, items, images, plain_images) that
// can be 5-15 KB each. Sending 10 of those raw eats ~50K tokens of
// context. We keep the fields the model needs to synthesise a useful
// answer and drop the heavy blobs the chat surface doesn't need at
// this stage. Sessions 6+ may restore more.
//
// CLAUDE.md §32.7 documents this trade-off.
// ---------------------------------------------------------------------------

function truncateForModel(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload.results)) {
    return {
      ...payload,
      results: payload.results.map(slimProduct),
    };
  }
  if (Array.isArray(payload.alternatives)) {
    return {
      ...payload,
      alternatives: payload.alternatives.map(slimProduct),
    };
  }
  return payload;
}

function slimProduct(p) {
  if (!p || typeof p !== 'object') return p;
  // Summarise pricing as a compact array; drop print_details + items raw.
  const pricingSummary = Array.isArray(p.product_pricing)
    ? p.product_pricing
        .filter((t) => t && !t.is_poa && t.price != null)
        .slice(0, 6)
        .map((t) => ({ min: t.min_qty, max: t.max_qty, price: t.price }))
    : [];
  const firstImage = Array.isArray(p.images) && p.images.length > 0
    ? (typeof p.images[0] === 'string' ? p.images[0] : p.images[0]?.url ?? null)
    : null;
  return {
    supplier_product_code: p.supplier_product_code,
    name: p.name,
    supplier: p.supplier,
    category: p.category,
    sub_category: p.sub_category,
    description: typeof p.description === 'string' ? p.description.slice(0, 600) : null,
    minimum_order_qty: p.minimum_order_qty,
    lead_time_days: p.lead_time_days,
    express_available: p.express_available,
    in_stock: p.in_stock,
    is_core_product: p.is_core_product,
    pricing: pricingSummary,
    unit_price_at_quantity: p.unit_price_at_quantity,
    unit_price_at_quantity_is_poa: p.unit_price_at_quantity_is_poa,
    similarity: p.similarity != null ? Number(p.similarity.toFixed(4)) : null,
    final_score: p.final_score != null ? Number(p.final_score.toFixed(5)) : null,
    image_url: firstImage,
  };
}
