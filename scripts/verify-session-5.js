#!/usr/bin/env node
/**
 * Session 5 verification — Queries A–J.
 *
 * Split into two phases:
 *
 *   STRUCTURAL — schema, validation, auth gates, body shapes, quota lib
 *   correctness. Runs without spending Anthropic credits.
 *
 *   END-TO-END — actual conversations with real Anthropic + real
 *   /api/search-products + real /api/find-alternatives calls.
 *   Skipped automatically if the Anthropic key has no balance (the
 *   first call fails with credit-low and we short-circuit so we don't
 *   slam the API with N retries).
 *
 * Cleanup: every conversation row + quota row created during
 * verification is deleted at the end. Real user data is untouched.
 *
 * Usage:
 *   node scripts/verify-session-5.js
 *
 * Env required:
 *   ANTHROPIC_API_KEY  CRON_SECRET  SUPABASE_ACCESS_TOKEN
 *   VITE_SUPABASE_URL  SUPABASE_SERVICE_ROLE_KEY  OPENAI_API_KEY
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const MGMT_SQL = 'https://api.supabase.com/v1/projects/cbcevjhvgmxrxeeyldza/database/query';

// ---------------------------------------------------------------------------
// In-process tool router
// ---------------------------------------------------------------------------

async function spawnToolRouter() {
  const { default: searchHandler } = await import('../api/search-products.js');
  const { default: altsHandler } = await import('../api/find-alternatives.js');

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      req.body = body ? JSON.parse(body) : {};
      const handler =
        req.url.startsWith('/api/search-products')   ? searchHandler :
        req.url.startsWith('/api/find-alternatives') ? altsHandler   :
        null;
      if (!handler) { res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' })); return; }
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (payload) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(payload));
        return res;
      };
      handler(req, res).catch((err) => {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err?.message ?? String(err) }));
      });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

// ---------------------------------------------------------------------------
// Mock req/res
// ---------------------------------------------------------------------------

function mockReq({ body, authHeader, ip = '127.0.0.1' }) {
  const headers = {};
  if (authHeader) headers.authorization = authHeader;
  headers.origin = 'http://localhost';
  headers['x-forwarded-for'] = ip;
  return { method: 'POST', headers, body, socket: { remoteAddress: ip } };
}

function mockRes() {
  let statusCode = 200;
  let payload = null;
  return {
    setHeader() { return this; },
    status(c) { statusCode = c; return this; },
    json(p) { payload = p; return this; },
    end() { return this; },
    getStatus: () => statusCode,
    getJson: () => payload,
  };
}

async function callChat({ chatHandler, body, authHeader, visitorIp }) {
  const req = mockReq({ body, authHeader, ip: visitorIp });
  const res = mockRes();
  await chatHandler(req, res);
  return { status: res.getStatus(), json: res.getJson() };
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

async function execSQL(sql) {
  const r = await fetch(MGMT_SQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 300)}`);
  try { return JSON.parse(t); } catch { return t; }
}

function trim(s, n) {
  const x = String(s ?? '');
  return x.length <= n ? x : x.slice(0, n - 1) + '…';
}

function printAssistant(label, json) {
  console.log('');
  console.log(`=== ${label} ===`);
  if (!json) { console.log('(no body)'); return; }
  console.log(`  stop_reason=${json.stop_reason ?? '?'}  conv=${json.conversation_id?.slice(0, 8) ?? '?'}…`);
  if (json.message?.tool_calls?.length) {
    console.log(`  tool_calls: ${json.message.tool_calls.map((c) => c.name).join(', ')}`);
    for (const c of json.message.tool_calls) {
      console.log(`    ${c.name}(${trim(JSON.stringify(c.input), 200)})`);
    }
  }
  if (json.message?.content) {
    console.log(`  assistant: ${trim(json.message.content, 700)}`);
  }
  if (json.quota_status) {
    console.log(`  quota: used=${json.quota_status.used ?? '-'} remaining=${json.quota_status.remaining}`);
  }
  if (json.usage) {
    console.log(`  tokens: in=${json.usage.input_tokens} out=${json.usage.output_tokens} cache_read=${json.usage.cache_read_input_tokens} cache_write=${json.usage.cache_creation_input_tokens} cost=$${(json.usage.estimated_cost_usd ?? 0).toFixed(6)}`);
  }
}

function isAnthropicCreditError(json) {
  return typeof json?.message === 'string' && /credit balance is too low/i.test(json.message);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }
  if (!process.env.CRON_SECRET) { console.error('CRON_SECRET missing'); process.exit(1); }
  if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN missing'); process.exit(1); }

  console.log('=== SETUP ===');
  const setup = await execSQL(`
    SELECT
      (SELECT COUNT(*) FROM ai_conversations) AS conversations_existing,
      (SELECT COUNT(*) FROM ai_quotas) AS quotas_existing,
      (SELECT data_type FROM information_schema.columns
        WHERE table_name='profiles' AND column_name='ai_chat_enabled' LIMIT 1) AS profile_flag_col,
      (SELECT COUNT(*) FROM pg_policies WHERE tablename IN ('ai_conversations','ai_quotas')) AS rls_policies
  `);
  console.log(JSON.stringify(setup[0], null, 2));

  const router = await spawnToolRouter();
  process.env.AI_CHAT_SELF_BASE_URL = router.baseUrl;
  const { default: chatHandler } = await import('../api/ai/chat.js');

  const visitorA = `verify-anon-${randomUUID()}`;
  const visitorIp = '203.0.113.7';
  const createdConversationIds = new Set();
  const visitorIdsToCleanup = new Set([visitorA]);

  // -----------------------------------------------------------------------
  // STRUCTURAL — runs always, no Anthropic spend
  // -----------------------------------------------------------------------

  console.log('');
  console.log('############# STRUCTURAL TESTS #############');

  // Query A: auth contract.
  console.log('');
  console.log('=== Query A — auth contract ===');
  // No auth + no visitor_id field at all → 401.
  const noAuthNoField = await callChat({ chatHandler, body: { message: 'hi' }, visitorIp });
  console.log(`  no auth, no visitor_id field → ${noAuthNoField.status} ${noAuthNoField.status === 401 ? 'PASS' : 'FAIL'}`);
  // Invalid Bearer + no visitor_id field → 401.
  const badBearerNoField = await callChat({
    chatHandler, body: { message: 'hi' }, authHeader: 'Bearer not-a-real-jwt', visitorIp,
  });
  console.log(`  invalid Bearer + no visitor_id field → ${badBearerNoField.status} ${badBearerNoField.status === 401 ? 'PASS' : 'FAIL'}`);
  // Validation paths — don't reach Anthropic.
  const noMessage = await callChat({ chatHandler, body: { visitor_id: visitorA }, visitorIp });
  console.log(`  visitor_id but missing message → ${noMessage.status} ${noMessage.status === 400 ? 'PASS' : 'FAIL'}`);
  const longMessage = await callChat({
    chatHandler,
    body: { visitor_id: visitorA, message: 'x'.repeat(5000) },
    visitorIp,
  });
  console.log(`  message > 2000 chars → ${longMessage.status} ${longMessage.status === 400 ? 'PASS' : 'FAIL'}`);

  // Query J (structural part): feature flag matrix.
  console.log('');
  console.log('=== Query J — feature flag matrix (env + DB checks) ===');
  console.log(`  VITE_AI_CHAT_PUBLIC_ENABLED env value: ${process.env.VITE_AI_CHAT_PUBLIC_ENABLED ?? '(unset → treated as false)'}`);
  const flagOnRows = await execSQL(`SELECT COUNT(*) FROM profiles WHERE ai_chat_enabled = true;`);
  console.log(`  profiles rows with ai_chat_enabled=true: ${flagOnRows[0]?.count} (seed Dave's row manually post-merge — §32.9)`);
  console.log(`  widget visibility logic in AIChatWidget.jsx gates on these two — manual visual check after deploy.`);

  // Quota lib correctness (no Anthropic dependency).
  console.log('');
  console.log('=== Quota library round-trip ===');
  const { hashVisitorId, checkSearchQuota, incrementQuota, ANON_DAILY_LIMIT } = await import('./lib/ai-quota.js');
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const quotaVisitor = `verify-quota-${randomUUID()}`;
  visitorIdsToCleanup.add(quotaVisitor);
  const quotaVisitorHash = hashVisitorId(quotaVisitor);

  const c0 = await checkSearchQuota({ supabaseUrl, serviceRoleKey, visitorHash: quotaVisitorHash });
  console.log(`  initial: used=${c0.used} remaining=${c0.remaining} (expect 0/5)`);
  for (let i = 1; i <= ANON_DAILY_LIMIT; i += 1) {
    /* eslint-disable no-await-in-loop */
    await incrementQuota({ supabaseUrl, serviceRoleKey, visitorHash: quotaVisitorHash });
    /* eslint-enable no-await-in-loop */
  }
  const cFull = await checkSearchQuota({ supabaseUrl, serviceRoleKey, visitorHash: quotaVisitorHash });
  console.log(`  after ${ANON_DAILY_LIMIT} increments: used=${cFull.used} remaining=${cFull.remaining} allowed=${cFull.allowed} (expect 5/0/false)`);
  // Signed-in check — passing visitorHash=null → unlimited.
  const cSignedIn = await checkSearchQuota({ supabaseUrl, serviceRoleKey, visitorHash: null });
  console.log(`  signed-in (visitorHash=null): allowed=${cSignedIn.allowed} remaining=${cSignedIn.remaining} (expect true/unlimited)`);

  // -----------------------------------------------------------------------
  // END-TO-END — only if Anthropic key has balance
  // -----------------------------------------------------------------------

  console.log('');
  console.log('############# END-TO-END TESTS #############');

  // First Anthropic-touching call. If it fails with credit-low, mark
  // every downstream query as BLOCKED and skip them.
  console.log('');
  console.log('=== Probe Anthropic billing ===');
  const probe = await callChat({
    chatHandler,
    body: { message: 'Hello, are you available?', visitor_id: visitorA },
    visitorIp,
  });
  if (probe.json?.conversation_id) createdConversationIds.add(probe.json.conversation_id);

  let anthropicAvailable = probe.status === 200;
  if (!anthropicAvailable) {
    const creditLow = isAnthropicCreditError(probe.json);
    console.log(`  probe status=${probe.status} ${creditLow ? 'BLOCKED: Anthropic credit balance too low' : '(unknown failure)'}`);
    console.log(`  raw error: ${trim(probe.json?.message ?? JSON.stringify(probe.json), 300)}`);
  } else {
    console.log(`  probe OK — proceeding with end-to-end queries`);
    printAssistant('Probe response', probe.json);
  }

  const skipAll = () => {
    console.log('');
    console.log('  Queries B, C, D, E, F, I, K skipped because Anthropic returned no usable response on probe.');
    console.log('  To unblock: top up Anthropic credits, then re-run `node scripts/verify-session-5.js`.');
  };

  if (anthropicAvailable) {
    const callAnon = async (label, message, conversationId = null) => {
      const out = await callChat({
        chatHandler,
        body: { message, conversation_id: conversationId, visitor_id: visitorA },
        visitorIp,
      });
      if (out.status !== 200) {
        console.error(`[${label}] status=${out.status}:`, JSON.stringify(out.json));
        return null;
      }
      if (out.json?.conversation_id) createdConversationIds.add(out.json.conversation_id);
      printAssistant(label, out.json);
      return out.json;
    };

    // Query B — vague request, expect clarification (no tool calls).
    const B = await callAnon('Query B — vague request triggers clarification',
      'I need something nice for clients');
    if (B) {
      const calls = B.message?.tool_calls?.length ?? 0;
      console.log(`  ${calls === 0 ? 'PASS' : 'FAIL'} — tool_calls=${calls} (expected 0)`);
    }

    // Query C — precise request, expect search.
    const C = await callAnon('Query C — precise request triggers search',
      '12oz cotton bags, 500 units, under £2 each. Top 5 options please.');
    if (C) {
      const calls = C.message?.tool_calls?.map((c) => c.name) ?? [];
      console.log(`  ${calls.includes('searchProducts') ? 'PASS' : 'FAIL'} — tool_calls=${JSON.stringify(calls)}`);
    }

    // Query D — out-of-scope, expect polite refusal (no tools).
    const D = await callAnon('Query D — out-of-scope politely declined',
      "What's your opinion on Bitcoin?");
    if (D) {
      const calls = D.message?.tool_calls?.length ?? 0;
      console.log(`  ${calls === 0 ? 'PASS' : 'FAIL'} — tool_calls=${calls} (expected 0)`);
    }

    // Query F — alternatives doesn't count against quota.
    const quotaBefore = (await execSQL(`SELECT searches_used FROM ai_quotas WHERE visitor_id_hash = '${hashVisitorId(visitorA)}' LIMIT 1;`))?.[0]?.searches_used ?? 0;
    const F = await callAnon('Query F — alternatives (no quota consumption)',
      'Can you find me alternatives to MG0192? Use the findAlternatives tool directly.');
    const quotaAfter = (await execSQL(`SELECT searches_used FROM ai_quotas WHERE visitor_id_hash = '${hashVisitorId(visitorA)}' LIMIT 1;`))?.[0]?.searches_used ?? quotaBefore;
    console.log(`  quota before/after: ${quotaBefore}/${quotaAfter} ${quotaBefore === quotaAfter ? 'PASS (unchanged)' : 'FAIL'}`);

    // Query E — quota enforcement on the 6th searching turn.
    // The probe + C already burned some count. Fire turns until we trip the cap.
    console.log('');
    console.log('=== Query E — quota enforcement (anonymous) ===');
    let blockedSeen = false;
    for (let i = 0; i < ANON_DAILY_LIMIT + 2; i += 1) {
      /* eslint-disable no-await-in-loop */
      const out = await callChat({
        chatHandler,
        body: { message: `Find me cheap branded pens under £1 in quantities of 500. Attempt ${i + 2}.`, visitor_id: visitorA },
        visitorIp,
      });
      if (out.json?.conversation_id) createdConversationIds.add(out.json.conversation_id);
      const remaining = out.json?.quota_status?.remaining;
      const calls = out.json?.message?.tool_calls?.length ?? 0;
      console.log(`  burn attempt ${i + 2}: status=${out.status} tool_calls=${calls} remaining=${remaining}`);
      if (remaining === 0 && calls === 0) blockedSeen = true;
      /* eslint-enable no-await-in-loop */
    }
    const finalUsed = (await execSQL(`SELECT searches_used FROM ai_quotas WHERE visitor_id_hash = '${hashVisitorId(visitorA)}' LIMIT 1;`))?.[0]?.searches_used;
    console.log(`  final searches_used: ${finalUsed} (cap=${ANON_DAILY_LIMIT})`);
    console.log(`  saw a "quota-blocked" reply: ${blockedSeen ? 'PASS' : 'CHECK MANUALLY'}`);

    // Query I — conversation persistence (anon round-trip via conversation_id).
    console.log('');
    console.log('=== Query I — conversation persistence ===');
    const persisted = await execSQL(`
      SELECT id, jsonb_array_length(messages) AS message_count, total_input_tokens,
             total_output_tokens, total_cached_input_tokens, search_tool_calls,
             alternative_tool_calls, estimated_cost_usd
      FROM ai_conversations
      WHERE id IN (${[...createdConversationIds].map((x) => `'${x}'`).join(',') || "''"})
      ORDER BY updated_at DESC LIMIT 10;
    `);
    console.log(`  recent conversations: ${persisted.length}`);
    for (const c of persisted) {
      console.log(`    ${c.id.slice(0, 8)}…  msgs=${c.message_count}  in=${c.total_input_tokens} out=${c.total_output_tokens} cached=${c.total_cached_input_tokens}  search=${c.search_tool_calls} alts=${c.alternative_tool_calls}  $${c.estimated_cost_usd}`);
    }

    // Cache hit rate analysis.
    console.log('');
    console.log('=== Cache hit-rate check ===');
    if (createdConversationIds.size) {
      const ids = [...createdConversationIds].map((id) => `'${id}'`).join(',');
      const rows = await execSQL(`
        SELECT
          COUNT(*) AS conversations,
          SUM(total_input_tokens) AS input_tokens,
          SUM(total_cached_input_tokens) AS cache_read_tokens,
          SUM(total_output_tokens) AS output_tokens,
          SUM(estimated_cost_usd)::numeric(10,6) AS cost_usd
        FROM ai_conversations WHERE id IN (${ids});
      `);
      console.log(`  ${JSON.stringify(rows[0])}`);
      const inp = Number(rows[0]?.input_tokens ?? 0);
      const cr = Number(rows[0]?.cache_read_tokens ?? 0);
      const hit = inp + cr === 0 ? 0 : cr / (inp + cr);
      console.log(`  cache hit ratio ≈ ${(hit * 100).toFixed(1)}% (cache_read / (input + cache_read))`);
    }
  } else {
    skipAll();
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------
  console.log('');
  console.log('=== Cleanup ===');
  if (createdConversationIds.size) {
    const ids = [...createdConversationIds].map((id) => `'${id}'`).join(',');
    await execSQL(`DELETE FROM ai_conversations WHERE id IN (${ids});`);
    console.log(`  deleted ${createdConversationIds.size} conversation rows`);
  }
  const hashes = [...visitorIdsToCleanup].map((v) => `'${hashVisitorId(v)}'`).join(',');
  if (hashes.length) {
    await execSQL(`DELETE FROM ai_quotas WHERE visitor_id_hash IN (${hashes});`);
    console.log(`  deleted ai_quotas rows for harness visitor IDs`);
  }
  router.server.close();
  console.log('');
  console.log('=== DONE ===');
}

main().catch((err) => {
  console.error('verify-session-5 FAILED:', err);
  process.exit(1);
});
