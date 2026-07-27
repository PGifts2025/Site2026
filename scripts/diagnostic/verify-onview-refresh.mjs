#!/usr/bin/env node
/** Verification for the on-view stock refresh (read/write against prod DB).
 *  Differential proof of the gates: with a DELIBERATELY INVALID Laltex key,
 *  any path that actually calls upstream must THROW. So if a call returns
 *  cleanly with a bad key, no upstream call was made. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { refreshProductStock } from '../lib/laltex-stock.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const realKey = process.env.LALTEX_API_KEY;
const BAD = 'INVALID-KEY-0000';
const h = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };

const count = async (t) => {
  const r = await fetch(`${supabaseUrl}/rest/v1/${t}?select=id`, { headers: { ...h, Prefer: 'count=exact', Range: '0-0' } });
  return Number((r.headers.get('content-range') || '/0').split('/')[1]);
};
let pass = 0, fail = 0;
const ok = (l, c, extra='') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l}${extra ? ' — ' + extra : ''}`); c ? pass++ : fail++; };

const prodBefore = await count('supplier_products');
const runsBefore = await count('job_runs');
console.log(`baseline: supplier_products=${prodBefore} job_runs=${runsBefore}\n`);

// 1. Unknown code — rejected WITHOUT an upstream call (bad key would throw).
let r = await refreshProductStock({ laltexApiKey: BAD, supabaseUrl, serviceRoleKey, code: 'NOSUCHCODE123' });
ok('unknown code -> unknown_code, no upstream call', r.status === 'unknown_code', `status=${r.status}`);

// 2. Malformed-ish / retired-ish code likewise rejected.
r = await refreshProductStock({ laltexApiKey: BAD, supabaseUrl, serviceRoleKey, code: 'zz--zz' });
ok('junk code -> unknown_code, no upstream call', r.status === 'unknown_code', `status=${r.status}`);

// 3. Known code, forced stale (freshnessMs=0) with the REAL key -> refreshes.
r = await refreshProductStock({ laltexApiKey: realKey, supabaseUrl, serviceRoleKey, code: 'TF0101', freshnessMs: 0 });
ok('known code, stale -> refreshed', r.status === 'refreshed', `status=${r.status}, variants=${r.stock ? Object.keys(r.stock).length : 0}`);

// 4. Immediately again within the window, with a BAD key -> must return 'fresh'
//    without throwing, proving the freshness gate short-circuits upstream.
r = await refreshProductStock({ laltexApiKey: BAD, supabaseUrl, serviceRoleKey, code: 'TF0101' });
ok('within window -> fresh, no upstream call (bad key did not throw)', r.status === 'fresh', `status=${r.status}`);

// 5. Control: known code + stale + BAD key MUST throw (proves 3/4 are real gates).
let threw = false;
try { await refreshProductStock({ laltexApiKey: BAD, supabaseUrl, serviceRoleKey, code: 'TF0101', freshnessMs: 0 }); }
catch { threw = true; }
ok('control: stale + bad key DOES call upstream and throws', threw);

// 6. Lowercase code resolves case-insensitively (CLAUDE.md §33) and is served
//    from the freshness gate — bad key must not throw.
r = await refreshProductStock({ laltexApiKey: BAD, supabaseUrl, serviceRoleKey, code: 'tf0101' });
ok('lowercase code resolves + hits freshness gate', r.status === 'fresh', `status=${r.status}`);

const prodAfter = await count('supplier_products');
const runsAfter = await count('job_runs');
ok('no supplier_products rows inserted', prodAfter === prodBefore, `${prodBefore} -> ${prodAfter}`);
ok('no job_runs rows written by refreshes', runsAfter === runsBefore, `${runsBefore} -> ${runsAfter}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
