#!/usr/bin/env node
/**
 * Session 4b verification — runs Queries A–I from the session prompt
 * against the locally-imported handler modules (no dev server needed)
 * + a raw SQL probe for Query I (staleness exclusion).
 *
 * Why import the handlers in-process rather than `next dev` + curl:
 *   - No port allocation, no race with the dev server, no shell
 *     plumbing for env / CRON_SECRET / curl flags.
 *   - Same code path the cron-auth smoke test uses (session 3b).
 *   - We still exercise the real Authorization header + JSON body
 *     contract via a mock req/res pair.
 *
 * Auth contract (Query G) IS exercised in-process. Production smoke
 * test (Query H) is documented but run manually after deploy.
 *
 * Usage:
 *   node scripts/verify-session-4b.js
 *
 * Exit code 0 iff every query produced the expected shape (i.e. did
 * not error). Semantic correctness — "did this query return the
 * right products?" — is judged by the human reader of the report.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const MGMT_SQL = 'https://api.supabase.com/v1/projects/cbcevjhvgmxrxeeyldza/database/query';

function mockReq(authHeader, body) {
  const headers = {};
  if (authHeader != null) headers.authorization = authHeader;
  return { method: 'POST', headers, body };
}

function mockRes() {
  let statusCode = null;
  let payload = null;
  return {
    status(c) { statusCode = c; return this; },
    setHeader() { return this; },
    json(p) { payload = p; return this; },
    end() { return this; },
    getStatus: () => statusCode,
    getJson: () => payload,
  };
}

async function callHandler(handlerPath, body, authHeader) {
  const { default: handler } = await import(handlerPath);
  const req = mockReq(authHeader, body);
  const res = mockRes();
  await handler(req, res);
  return { status: res.getStatus(), json: res.getJson() };
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
// Pretty printer
// ---------------------------------------------------------------------------

function pad(s, n) {
  const x = String(s ?? '');
  return x.length >= n ? x.slice(0, n) : x + ' '.repeat(n - x.length);
}

function printResults(label, rows, opts = {}) {
  const { showSim = true, showTsRank = true, showFinal = true, codeWidth = 18, nameWidth = 38 } = opts;
  console.log('');
  console.log(`=== ${label} ===`);
  if (!rows || rows.length === 0) {
    console.log('  (no rows)');
    return;
  }
  const head =
    pad('rank', 5) +
    pad('code', codeWidth) +
    (showSim     ? pad('sim',     8)  : '') +
    (showTsRank  ? pad('ts_rank', 10) : '') +
    (showFinal   ? pad('final',   10) : '') +
    pad('cat>sub', 30) +
    pad('core', 6) +
    pad('exp', 5) +
    pad('lead', 6) +
    'name';
  console.log(head);
  console.log('-'.repeat(head.length));
  rows.forEach((r, i) => {
    const cat = `${r.category ?? ''} > ${r.sub_category ?? ''}`;
    console.log(
      pad(String(i + 1), 5) +
      pad(r.supplier_product_code, codeWidth) +
      (showSim     ? pad(Number(r.similarity     ?? 0).toFixed(4), 8)  : '') +
      (showTsRank  ? pad(Number(r.tsvector_rank  ?? 0).toFixed(5), 10) : '') +
      (showFinal   ? pad(Number(r.final_score    ?? 0).toFixed(5), 10) : '') +
      pad(cat, 30) +
      pad(r.is_core_product ? 'YES' : '·', 6) +
      pad(r.express_available ? 'YES' : '·', 5) +
      pad(r.lead_time_days == null ? '·' : `${r.lead_time_days}d`, 6) +
      (r.name ?? '').slice(0, nameWidth),
    );
  });
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

async function searchOK(body, label) {
  const auth = `Bearer ${process.env.CRON_SECRET}`;
  const out = await callHandler('../api/search-products.js', body, auth);
  if (out.status !== 200) {
    console.error(`[${label}] EXPECTED 200, got ${out.status}:`, JSON.stringify(out.json));
    throw new Error(`${label} non-200`);
  }
  return out.json;
}

async function altsOK(body, label) {
  const auth = `Bearer ${process.env.CRON_SECRET}`;
  const out = await callHandler('../api/find-alternatives.js', body, auth);
  if (out.status !== 200 && out.status !== 404) {
    console.error(`[${label}] EXPECTED 200/404, got ${out.status}:`, JSON.stringify(out.json));
    throw new Error(`${label} non-200/404`);
  }
  return out;
}

async function authContract(handlerPath, body, label) {
  const cases = [
    { name: 'no auth',     auth: null,                        expect: 401 },
    { name: 'wrong auth',  auth: 'Bearer wrong-secret-value', expect: 401 },
    { name: 'correct auth', auth: `Bearer ${process.env.CRON_SECRET}`, expect: 200 },
  ];
  const results = [];
  for (const c of cases) {
    /* eslint-disable no-await-in-loop */
    const out = await callHandler(handlerPath, body, c.auth);
    const pass = out.status === c.expect;
    results.push({ case: c.name, expect: c.expect, got: out.status, pass });
    /* eslint-enable no-await-in-loop */
  }
  console.log('');
  console.log(`=== ${label} ===`);
  for (const r of results) {
    console.log(`  ${pad(r.case, 16)}  expect=${r.expect}  got=${r.got}  ${r.pass ? 'PASS' : 'FAIL'}`);
  }
  return results.every((r) => r.pass);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!process.env.CRON_SECRET) {
    console.error('CRON_SECRET missing from site/.env');
    process.exit(1);
  }
  if (!TOKEN) {
    console.error('SUPABASE_ACCESS_TOKEN missing from site/.env');
    process.exit(1);
  }

  // Setup verification
  console.log('=== SETUP ===');
  const setup = await execSQL(`
    SELECT
      (SELECT COUNT(*) FROM supplier_products WHERE search_tsv IS NULL)                  AS tsv_nulls,
      (SELECT COUNT(*) FROM supplier_products WHERE is_core_product = true)              AS core_count,
      (SELECT COUNT(*) FROM supplier_products sp JOIN suppliers s ON s.id=sp.supplier_id
         WHERE s.slug='laltex' AND express_available = true)                              AS express_n,
      (SELECT COUNT(*) FROM supplier_products sp JOIN suppliers s ON s.id=sp.supplier_id
         WHERE s.slug='laltex' AND lead_time_days IS NOT NULL)                            AS leadtime_n,
      (SELECT COUNT(*) FROM supplier_products sp JOIN suppliers s ON s.id=sp.supplier_id
         WHERE s.slug='laltex')                                                            AS laltex_total,
      (SELECT COUNT(*) FROM supplier_products sp JOIN suppliers s ON s.id=sp.supplier_id
         WHERE s.slug='pgifts-direct')                                                     AS pgd_total,
      (SELECT COUNT(*) FROM supplier_products WHERE last_synced_at < now() - interval '14 days') AS stale_n
  `);
  console.log(JSON.stringify(setup[0], null, 2));

  // ---- A: vector retrieval baseline ----
  const A = await searchOK({ query: 'insulated travel mug with custom print', filters: { limit: 5 } }, 'A');
  printResults('Query A — "insulated travel mug with custom print" (limit 5)', A.results);

  // ---- B: tsvector breakthrough on literal t-shirt ----
  const B = await searchOK({ query: 'embroidered cotton t-shirt', filters: { limit: 5 } }, 'B');
  printResults('Query B — "embroidered cotton t-shirt" (CRITICAL: real t-shirts in top 5?)', B.results);

  // ---- C: core boost — charging cable ----
  const C = await searchOK({ query: 'charging cable', filters: { limit: 5 } }, 'C');
  printResults('Query C — "charging cable" (CRITICAL: Ocean Octopus #1, 4 cable products top)', C.results);

  // ---- D: filter combinations ----
  const D = await searchOK({
    query: 'corporate gift pen',
    filters: { category: 'Writing', quantity: 250, maxUnitPrice: 5.00, limit: 10 },
  }, 'D');
  console.log('');
  console.log('=== Query D — Writing + qty=250 + maxUnitPrice<=£5 ===');
  console.log(`  result_count = ${D.query_metadata.result_count}`);
  printResults('Query D top 3', D.results.slice(0, 3));

  // ---- E: express only ----
  const E = await searchOK({ query: 'branded merchandise', filters: { expressOnly: true, limit: 5 } }, 'E');
  console.log('');
  console.log('=== Query E — "branded merchandise" + expressOnly=true ===');
  console.log(`  result_count = ${E.query_metadata.result_count}`);
  printResults('Query E top 3', E.results.slice(0, 3));

  // ---- F: find alternatives ----
  const F = await altsOK({ supplier_product_code: 'MG0192', limit: 5 }, 'F');
  console.log('');
  console.log('=== Query F — find alternatives for MG0192 (Polo Plus 400ml Travel Mug) ===');
  console.log(`  status=${F.status}`);
  if (F.json?.source_product) {
    console.log(`  source: ${F.json.source_product.supplier_product_code} - ${F.json.source_product.name} (${F.json.source_product.supplier})`);
  }
  printResults('Query F alternatives', F.json?.alternatives ?? [], { showTsRank: false });

  // ---- G: auth contract for both endpoints ----
  const okG1 = await authContract(
    '../api/search-products.js',
    { query: 'auth test', filters: { limit: 1 } },
    'Query G1 — search-products auth contract',
  );
  const okG2 = await authContract(
    '../api/find-alternatives.js',
    { supplier_product_code: 'MG0192', limit: 1 },
    'Query G2 — find-alternatives auth contract',
  );

  // ---- I: staleness exclusion ----
  console.log('');
  console.log('=== Query I — staleness exclusion ===');
  // Pick a Laltex row that's clearly findable by an exact name token.
  const pick = await execSQL(`
    SELECT sp.supplier_product_code, sp.name FROM supplier_products sp
    JOIN suppliers s ON s.id=sp.supplier_id
    WHERE s.slug='laltex' AND sp.name ILIKE '%polo plus%' LIMIT 1;
  `);
  if (!pick?.[0]) {
    console.log('  (could not pick a test row — skipping)');
  } else {
    const testCode = pick[0].supplier_product_code;
    const testName = pick[0].name;
    console.log(`  test row: ${testCode} - "${testName}"`);

    // Baseline — should find it.
    const baseline = await searchOK({ query: testName, filters: { limit: 3 } }, 'I-baseline');
    const foundBefore = baseline.results.some((r) => r.supplier_product_code === testCode);
    console.log(`  before staleness backdate: found=${foundBefore}`);

    // Backdate.
    await execSQL(`UPDATE supplier_products SET last_synced_at = now() - interval '30 days' WHERE supplier_product_code = '${testCode}';`);
    const stale = await searchOK({ query: testName, filters: { limit: 3 } }, 'I-stale');
    const foundDuring = stale.results.some((r) => r.supplier_product_code === testCode);
    console.log(`  after backdate (should be false): found=${foundDuring}`);

    // Restore.
    await execSQL(`UPDATE supplier_products SET last_synced_at = now() WHERE supplier_product_code = '${testCode}';`);
    const restored = await searchOK({ query: testName, filters: { limit: 3 } }, 'I-restored');
    const foundAfter = restored.results.some((r) => r.supplier_product_code === testCode);
    console.log(`  after restore: found=${foundAfter}`);

    const passI = foundBefore && !foundDuring && foundAfter;
    console.log(`  Query I: ${passI ? 'PASS' : 'FAIL'}`);
  }

  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`  Query A produced ${A.results.length} rows`);
  console.log(`  Query B produced ${B.results.length} rows (check for real t-shirts above)`);
  console.log(`  Query C produced ${C.results.length} rows (check Ocean Octopus position above)`);
  console.log(`  Query D produced ${D.query_metadata.result_count} rows`);
  console.log(`  Query E produced ${E.query_metadata.result_count} rows`);
  console.log(`  Query F produced ${F.json?.alternatives?.length ?? 0} alternatives`);
  console.log(`  Query G1 auth contract: ${okG1 ? 'PASS' : 'FAIL'}`);
  console.log(`  Query G2 auth contract: ${okG2 ? 'PASS' : 'FAIL'}`);
}

main().catch((err) => {
  console.error('verify-session-4b FAILED:', err);
  process.exit(1);
});
