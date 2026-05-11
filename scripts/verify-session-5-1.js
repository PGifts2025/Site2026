#!/usr/bin/env node
/**
 * Session 5.1 verification — three focused probes against the in-process
 * /api/ai/chat handler with the v2 system prompt.
 *
 * Probes the three scenarios from the session 5.1 prompt:
 *   1. Bamboo eco-products around £5 at 200 units (alternatives when sparse)
 *   2. Joke about competitors (declines warmly, no emojis / em dashes)
 *   3. 12oz cotton bags for £3 at 500 units (near-miss reasoning)
 *
 * Post-call checks:
 *   - assistant response contains no emojis (broad heuristic across
 *     several common Unicode blocks)
 *   - assistant response contains no em dash character (— U+2014)
 *
 * Cleans up harness conversations + ai_quotas rows at the end.
 *
 * Usage: node scripts/verify-session-5-1.js
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
// In-process tool router (re-uses session 4b search endpoints)
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
        req.url.startsWith('/api/find-alternatives') ? altsHandler   : null;
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
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function mockReq({ body, ip = '127.0.0.1' }) {
  return {
    method: 'POST',
    headers: { origin: 'http://localhost', 'x-forwarded-for': ip },
    body,
    socket: { remoteAddress: ip },
  };
}
function mockRes() {
  let statusCode = 200; let payload = null;
  return {
    setHeader() { return this; },
    status(c) { statusCode = c; return this; },
    json(p) { payload = p; return this; },
    end() { return this; },
    getStatus: () => statusCode,
    getJson: () => payload,
  };
}

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

// ---------------------------------------------------------------------------
// Tone checkers
// ---------------------------------------------------------------------------
// Em dash: U+2014. (We deliberately do NOT flag U+2013 en dash — different
// character, conventional in UK English for ranges.)
const EM_DASH = '—';

// Emoji detection: catch the common ranges. This is a heuristic, not a
// perfect Unicode-class regex — but it covers everything the model is
// realistically going to emit (smileys, gestures, symbols, flags, etc.).
const EMOJI_REGEX = /[\u{1F300}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u;

function findEmDashes(text) {
  if (typeof text !== 'string') return [];
  const hits = [];
  let i = -1;
  while ((i = text.indexOf(EM_DASH, i + 1)) !== -1) {
    hits.push({ index: i, snippet: text.slice(Math.max(0, i - 30), Math.min(text.length, i + 31)) });
  }
  return hits;
}
function findEmojis(text) {
  if (typeof text !== 'string') return [];
  const hits = [];
  const re = new RegExp(EMOJI_REGEX.source, 'gu');
  let m;
  while ((m = re.exec(text)) !== null) {
    hits.push({ index: m.index, char: m[0], snippet: text.slice(Math.max(0, m.index - 20), Math.min(text.length, m.index + 21)) });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  for (const k of ['ANTHROPIC_API_KEY', 'CRON_SECRET', 'SUPABASE_ACCESS_TOKEN']) {
    if (!process.env[k]) { console.error(`${k} missing from site/.env`); process.exit(1); }
  }

  const router = await spawnToolRouter();
  process.env.AI_CHAT_SELF_BASE_URL = router.baseUrl;
  const { default: chatHandler } = await import('../api/ai/chat.js');

  const visitorA = `verify-5-1-${randomUUID()}`;
  const visitorIp = '203.0.113.99';

  const createdConversationIds = new Set();
  const visitorIdsToCleanup = new Set([visitorA]);

  const PROBES = [
    {
      label: 'Probe 1 — Bamboo eco-products around £5 at 200 units',
      message: 'I need bamboo eco-products around £5 at 200 units',
    },
    {
      label: 'Probe 2 — Joke about competitors (decline)',
      message: 'tell me a joke about your competitors',
    },
    {
      label: 'Probe 3 — 12oz cotton bags for £3 at 500 units (near-miss)',
      message: 'I need 12oz cotton bags for £3 at 500 units',
    },
  ];

  const results = [];

  for (const p of PROBES) {
    const t0 = Date.now();
    const req = mockReq({ body: { message: p.message, visitor_id: visitorA }, ip: visitorIp });
    const res = mockRes();
    /* eslint-disable no-await-in-loop */
    await chatHandler(req, res);
    /* eslint-enable no-await-in-loop */
    const elapsed = Date.now() - t0;
    const json = res.getJson();
    if (json?.conversation_id) createdConversationIds.add(json.conversation_id);

    const content = json?.message?.content ?? '';
    const emojis = findEmojis(content);
    const emDashes = findEmDashes(content);

    results.push({
      label: p.label,
      message: p.message,
      status: res.getStatus(),
      stopReason: json?.stop_reason,
      toolCalls: (json?.message?.tool_calls ?? []).map((c) => c.name),
      content,
      emojis,
      emDashes,
      usage: json?.usage,
      quota: json?.quota_status,
      elapsedMs: elapsed,
    });
  }

  // -----------------------------------------------------------------------
  // Print transcripts
  // -----------------------------------------------------------------------
  console.log('');
  console.log('=================================================================');
  console.log('                  SESSION 5.1 — VERIFICATION');
  console.log('=================================================================');

  let overallPass = true;

  for (const r of results) {
    console.log('');
    console.log(`### ${r.label}`);
    console.log(`> ${r.message}`);
    console.log('');
    console.log(`  HTTP status: ${r.status}`);
    console.log(`  stop_reason: ${r.stopReason}`);
    if (r.toolCalls.length) console.log(`  tool_calls (last turn only): ${JSON.stringify(r.toolCalls)}`);
    console.log(`  elapsed: ${r.elapsedMs}ms`);
    if (r.usage) {
      console.log(`  tokens: in=${r.usage.input_tokens} out=${r.usage.output_tokens} cache_read=${r.usage.cache_read_input_tokens} cache_write=${r.usage.cache_creation_input_tokens} cost=$${(r.usage.estimated_cost_usd ?? 0).toFixed(6)}`);
    }
    console.log('');
    console.log('--- TRANSCRIPT ---');
    console.log(r.content || '(empty)');
    console.log('--- /TRANSCRIPT ---');
    console.log('');
    const emojiPass = r.emojis.length === 0;
    const emDashPass = r.emDashes.length === 0;
    console.log(`  emojis found:    ${emojiPass ? 'NONE — PASS' : `${r.emojis.length} — FAIL`}`);
    if (!emojiPass) {
      for (const e of r.emojis) console.log(`    @ idx ${e.index}: ${JSON.stringify(e.char)} | "${e.snippet}"`);
    }
    console.log(`  em dashes found: ${emDashPass ? 'NONE — PASS' : `${r.emDashes.length} — FAIL`}`);
    if (!emDashPass) {
      for (const e of r.emDashes) console.log(`    @ idx ${e.index}: "${e.snippet}"`);
    }
    if (!emojiPass || !emDashPass) overallPass = false;
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------
  console.log('');
  console.log('=== CLEANUP ===');
  if (createdConversationIds.size) {
    const ids = [...createdConversationIds].map((id) => `'${id}'`).join(',');
    await execSQL(`DELETE FROM ai_conversations WHERE id IN (${ids});`);
    console.log(`  deleted ${createdConversationIds.size} ai_conversations rows`);
  }
  const { hashVisitorId } = await import('./lib/ai-quota.js');
  const hashes = [...visitorIdsToCleanup].map((v) => `'${hashVisitorId(v)}'`).join(',');
  if (hashes.length) {
    await execSQL(`DELETE FROM ai_quotas WHERE visitor_id_hash IN (${hashes});`);
    console.log(`  deleted harness ai_quotas rows`);
  }
  router.server.close();

  console.log('');
  console.log(`=== OVERALL: ${overallPass ? 'PASS' : 'FAIL'} ===`);
  process.exit(overallPass ? 0 : 1);
}

main().catch((err) => {
  console.error('verify-session-5-1 FAILED:', err);
  process.exit(1);
});
