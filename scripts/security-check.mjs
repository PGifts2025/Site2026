#!/usr/bin/env node
/**
 * npm run security:check — database & client security guardrails (CLAUDE.md §64).
 *
 * Fails (exit 1) on any of:
 *   1  public tables with RLS disabled
 *   2  RLS enabled but zero policies (unless allow-listed below, with a reason)
 *   3  TRUNCATE granted to anon/authenticated (TRUNCATE bypasses RLS)
 *   4  write policies open to anon/authenticated (USING/WITH CHECK true or absent)
 *   5  policies that read user_metadata / raw_user_meta_data (user-editable)
 *   6  function bodies that read user metadata (unless allow-listed, with a reason)
 *   7  SECURITY DEFINER functions executable by anon
 *   8  storage buckets uploadable by non-admins without size + MIME limits
 *   9  rls_auto_enable event trigger missing or disabled
 *  10  REAL anon-key HTTP reads against the private tables return rows
 *  11  service-role keys / VITE_*SERVICE_ROLE* in client code or the built bundle
 *
 * Database access (first one found):
 *   SECURITY_CHECK_DATABASE_URL  read-only `security_check` role via the pooler (CI)
 *   SUPABASE_ACCESS_TOKEN        Management API SQL endpoint (local; from .env)
 * REST probe: SUPABASE_URL / VITE_SUPABASE_URL + SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY.
 * Optional: --dist <dir> to scan a built bundle (default: ./dist if present).
 *
 * Never give this script the service-role key.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = 'cbcevjhvgmxrxeeyldza';

// ---------------------------------------------------------------------------
// Allow-lists — every entry needs a reason. Review these in PRs.
// ---------------------------------------------------------------------------

/** Check 2: RLS on, zero policies. Deny-all to clients is intended. */
const ALLOW_NO_POLICIES = {
  profiles: 'Unused by clients; service_role only (§62.3)',
  uploads: 'Unused by clients; service_role only (§62.3)',
  visual_proofs: 'Unused by clients; service_role only (§62.3)',
};

/** Check 6: functions that read user metadata for a non-authorisation purpose. */
const ALLOW_METADATA_FUNCTIONS = {
  'handle_new_customer_profile()': 'Copies sign-up name/company/phone into customer_profiles; grants nothing (§62.3)',
};

/** Check 7: SECURITY DEFINER functions anon may execute (none today). */
const ALLOW_ANON_DEFINER = {};

/** Check 10: private tables probed with the anon key. */
const PRIVATE_TABLES = [
  'orders', 'order_items', 'quotes', 'quote_items', 'customer_profiles',
  'profiles', 'uploads', 'visual_proofs', 'user_designs', 'team_members',
];

// ---------------------------------------------------------------------------

function loadDotEnv() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return {};
  return Object.fromEntries(
    readFileSync(p, 'utf8').split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  );
}
const fileEnv = loadDotEnv();
const env = (k) => process.env[k] || fileEnv[k] || '';

async function makeQuery() {
  const dbUrl = env('SECURITY_CHECK_DATABASE_URL');
  if (dbUrl) {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    return {
      via: 'read-only role (SECURITY_CHECK_DATABASE_URL)',
      query: async (sql) => (await client.query(sql)).rows,
      close: () => client.end(),
    };
  }
  const token = env('SUPABASE_ACCESS_TOKEN');
  if (token) {
    return {
      via: 'Management API (SUPABASE_ACCESS_TOKEN)',
      query: async (sql) => {
        const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql }),
        });
        const body = await r.json();
        if (!r.ok || !Array.isArray(body)) throw new Error(body?.message || `HTTP ${r.status}`);
        return body;
      },
      close: async () => {},
    };
  }
  throw new Error('No database access: set SECURITY_CHECK_DATABASE_URL (CI) or SUPABASE_ACCESS_TOKEN (local .env)');
}

const results = [];
const record = (id, title, failures, passDetail) =>
  results.push({ id, title, ok: failures.length === 0, detail: failures.length ? failures.join('; ') : passDetail });

async function runDbChecks(q) {
  const rlsOff = await q(`
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
    ORDER BY 1`);
  record(1, 'RLS enabled on every public table', rlsOff.map((r) => `${r.relname}: RLS off`), 'all public tables have RLS');

  const noPolicies = await q(`
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND c.relrowsecurity
      AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
    ORDER BY 1`);
  const unexpected = noPolicies.filter((r) => !ALLOW_NO_POLICIES[r.relname]);
  record(2, 'No RLS table without policies (except allow-list)',
    unexpected.map((r) => `${r.relname}: RLS on, 0 policies — add policies or allow-list with a reason`),
    `${noPolicies.length} allow-listed (${noPolicies.map((r) => r.relname).join(', ') || 'none'})`);

  const truncate = await q(`
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
      AND (has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('authenticated', c.oid, 'TRUNCATE'))
    ORDER BY 1`);
  record(3, 'No client TRUNCATE grants', truncate.map((r) => `${r.relname}: TRUNCATE granted`), 'none');

  const policies = await q(`
    SELECT schemaname, tablename, policyname, cmd, roles::text AS roles,
           coalesce(qual, '') AS qual, coalesce(with_check, '') AS with_check
    FROM pg_policies WHERE schemaname IN ('public','storage')`);
  const clientRole = (roles) => /\b(public|anon|authenticated)\b/.test(roles);
  const isTrue = (e) => /^\(?\s*true\s*\)?$/i.test(e.trim());
  const openWrites = policies.filter((p) => {
    if (!clientRole(p.roles) || p.cmd === 'SELECT') return false;
    if (p.cmd === 'INSERT') return !p.with_check || isTrue(p.with_check);
    if (p.cmd === 'UPDATE') return !p.qual || isTrue(p.qual) || (p.with_check && isTrue(p.with_check));
    return !p.qual || isTrue(p.qual); // DELETE / ALL
  });
  record(4, 'No write policy open to anon/authenticated',
    openWrites.map((p) => `${p.schemaname}.${p.tablename} "${p.policyname}" (${p.cmd} ${p.roles})`), 'none');

  const metaPolicies = policies.filter((p) => /user_metadata|raw_user_meta_data/i.test(p.qual + ' ' + p.with_check));
  record(5, 'No policy authorises on user metadata',
    metaPolicies.map((p) => `${p.schemaname}.${p.tablename} "${p.policyname}"`), 'none');

  const metaFns = await q(`
    SELECT p.oid::regprocedure::text AS fn FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ~* '(raw_user_meta_data|user_metadata)'
    ORDER BY 1`);
  const badMetaFns = metaFns.filter((r) => !ALLOW_METADATA_FUNCTIONS[r.fn]);
  record(6, 'No function authorises on user metadata (except allow-list)',
    badMetaFns.map((r) => `${r.fn} reads user metadata — use is_admin()/team_members, or allow-list with a reason`),
    `${metaFns.length} allow-listed (${metaFns.map((r) => r.fn).join(', ') || 'none'})`);

  const definer = await q(`
    SELECT p.oid::regprocedure::text AS fn FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
      AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
    ORDER BY 1`);
  const badDefiner = definer.filter((r) => !ALLOW_ANON_DEFINER[r.fn]);
  record(7, 'No SECURITY DEFINER function executable by anon',
    badDefiner.map((r) => `${r.fn} — REVOKE EXECUTE ... FROM PUBLIC, anon`), 'none');

  // storage.buckets has its own RLS; the read-only role reads it through
  // security_check_buckets() (migration 20261007_security_guardrails).
  const [{ via_fn: viaFn }] = await q(`
    SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'security_check_buckets'
                   AND has_function_privilege(current_user, oid, 'EXECUTE')) AS via_fn`);
  const buckets = await q(viaFn
    ? 'SELECT id, file_size_limit, allowed_mime_types FROM public.security_check_buckets()'
    : 'SELECT id, file_size_limit, allowed_mime_types FROM storage.buckets');
  const uploadable = new Set();
  for (const p of policies.filter((x) => x.schemaname === 'storage' && x.tablename === 'objects' && ['INSERT', 'ALL'].includes(x.cmd) && clientRole(x.roles))) {
    const expr = p.with_check || p.qual;
    if (/is_admin\s*\(/i.test(expr)) continue;
    for (const m of expr.matchAll(/bucket_id\s*=\s*'([^']+)'/g)) uploadable.add(m[1]);
  }
  const unbounded = buckets.filter((b) => uploadable.has(b.id) && (!b.file_size_limit || !b.allowed_mime_types?.length));
  // Never pass vacuously: every client-uploadable bucket must be visible here.
  const invisible = [...uploadable].filter((id) => !buckets.some((b) => b.id === id));
  record(8, 'Non-admin upload buckets have size + MIME limits',
    [...unbounded.map((b) => `${b.id}: limit=${b.file_size_limit ?? 'none'} mime=${b.allowed_mime_types ?? 'any'}`),
     ...invisible.map((id) => `${id}: bucket not visible to the checker — cannot verify limits`)],
    `${uploadable.size} non-admin upload bucket(s) limited (${[...uploadable].join(', ') || 'none'})`);

  const evt = await q(`SELECT evtenabled FROM pg_event_trigger WHERE evtname = 'rls_auto_enable'`);
  record(9, 'rls_auto_enable event trigger active',
    evt.length === 0 ? ['missing'] : evt[0].evtenabled === 'D' ? ['disabled'] : [], 'present and enabled');
}

async function runRestProbe() {
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
  const anon = env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY');
  if (!url || !anon) {
    record(10, 'Anon HTTP reads of private tables return nothing', ['SUPABASE_URL / SUPABASE_ANON_KEY not set — probe not run'], '');
    return;
  }
  const failures = [];
  const seen = [];
  for (const t of PRIVATE_TABLES) {
    const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
    let rows = null;
    try { const b = await r.json(); rows = Array.isArray(b) ? b.length : null; } catch { /* non-JSON body */ }
    seen.push(`${t}=${r.status}${rows !== null ? `/${rows}` : ''}`);
    if (r.ok && rows !== 0) failures.push(`${t}: HTTP ${r.status} returned ${rows ?? '?'} row(s) to anon`);
  }
  record(10, 'Anon HTTP reads of private tables return nothing', failures, seen.join(' '));
}

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

function runSecretScan() {
  const argDist = process.argv.indexOf('--dist');
  const dist = argDist > -1 ? process.argv[argDist + 1] : join(ROOT, 'dist');
  const files = [...walk(join(ROOT, 'src'), ['.js', '.jsx', '.ts', '.tsx']), ...walk(dist, ['.js', '.html'])];
  const failures = [];
  const jwt = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const rel = relative(ROOT, f);
    if (/VITE_[A-Z0-9_]*SERVICE_ROLE/.test(text)) failures.push(`${rel}: references a VITE_*SERVICE_ROLE* variable`);
    if (text.includes('sb_secret_')) failures.push(`${rel}: contains an sb_secret_ key`);
    for (const tok of text.match(jwt) || []) {
      try {
        const payload = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString('utf8'));
        if (payload.role === 'service_role') failures.push(`${rel}: contains a service_role JWT`);
      } catch { /* not a JWT */ }
    }
  }
  const scanned = `${files.length} files (src/${existsSync(dist) ? ' + ' + relative(ROOT, dist) + '/' : ', no build to scan'})`;
  record(11, 'No service-role key in client code / bundle', [...new Set(failures)], scanned);
}

// ---------------------------------------------------------------------------

const started = Date.now();
let db;
try {
  db = await makeQuery();
  await runDbChecks(db.query);
} catch (e) {
  record(0, 'Database checks', [`could not run: ${e.message}`], '');
} finally {
  await db?.close?.();
}
await runRestProbe();
runSecretScan();

results.sort((a, b) => a.id - b.id);
const w = Math.max(...results.map((r) => r.title.length));
console.log(`\nsecurity:check — ${new Date().toISOString()} — via ${db?.via ?? 'n/a'}\n`);
console.log(`  #  ${'Check'.padEnd(w)}  Result  Details`);
console.log(`  -  ${'-'.repeat(w)}  ------  -------`);
for (const r of results) {
  console.log(`${String(r.id).padStart(3)}  ${r.title.padEnd(w)}  ${r.ok ? 'PASS  ' : 'FAIL  '}  ${r.detail}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? `FAILED: ${failed} of ${results.length} checks` : `PASSED: all ${results.length} checks`} (${Date.now() - started} ms)\n`);
process.exit(failed ? 1 : 0);
