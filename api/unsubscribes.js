// =====================================================================
// Outreach unsubscribes — CLAUDE.md §67. Interface contract from the
// cold-outreach project (24 Nov 2026). ONE function, two jobs, to stay
// inside the Vercel Hobby 12-function limit:
//
//  Page mode — /u/<token> (vercel.json rewrites it here with ?page=1&u=…)
//    GET/HEAD  confirmation page with one button. Records NOTHING: email
//              security scanners (Safe Links, Mimecast…) open every link.
//    POST      records { token, unsubscribed_at } (idempotent) and shows
//              the success line — for ANY well-formed token, seen or not
//              (this site can't know which are real and must not reveal it).
//              Also serves RFC 8058 one-click POSTs from mail clients.
//    Malformed token → 404, nothing stored.
//
//  Pull mode — GET /api/unsubscribes?since=<ISO>   (outreach server only)
//    Authorization: Bearer <UNSUB_PULL_SECRET>; wrong/missing → 401, empty
//    body. Returns rows with unsubscribed_at >= since, oldest first.
//
// Stores the token and the time ONLY — no IP, user agent or email. No
// scripts, analytics or third-party assets on the pages. Never deletes.
// =====================================================================

/* global process */ // server-side function; eslint.config.js only declares browser globals
import { createHash, timingSafeEqual } from 'node:crypto';

export const config = { maxDuration: 15 };

export const TOKEN_RE = /^[A-Za-z0-9_-]{27}$/;
const PAGE_SIZE = 1000; // PostgREST response cap (CLAUDE.md §28.1)

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Plain page in the site's colours (PG badge, gray text, blue button).
// Inline CSS only: no scripts, fonts, analytics or third-party requests.
export function pageHtml({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<meta name="referrer" content="no-referrer" />
<title>${esc(title)} | Promo Gifts</title>
<style>
  body { margin: 0; background: #f9fafb; color: #111827;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 32rem; margin: 15vh auto 0; padding: 2rem 1.5rem; background: #fff;
    border-radius: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); text-align: center; }
  .brand { display: inline-flex; align-items: center; gap: .6rem; margin-bottom: 1.5rem;
    font-weight: 700; font-size: 1.1rem; color: #111827; }
  .badge { width: 2.25rem; height: 2.25rem; border-radius: 50%; background: #ef4444; color: #fff;
    display: inline-flex; align-items: center; justify-content: center; font-size: .9rem; }
  h1 { font-size: 1.35rem; margin: 0 0 1.5rem; }
  button { background: #2563eb; color: #fff; border: 0; border-radius: .75rem;
    padding: .8rem 2rem; font-size: 1rem; font-weight: 600; cursor: pointer; }
  button:hover { background: #1d4ed8; }
</style>
</head>
<body>
<main>
  <div class="brand"><span class="badge">PG</span>Promo Gifts</div>
  ${body}
</main>
</body>
</html>`;
}

function sendHtml(res, status, html) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(html);
}

const notFound = (res) =>
  sendHtml(res, 404, pageHtml({ title: 'Not found', body: '<h1>Page not found.</h1>' }));

// Constant-time compare on equal-length digests.
export function secretMatches(header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const m = header.match(/^Bearer\s+(.+)$/);
  if (!m) return false;
  const a = createHash('sha256').update(m[1]).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------
async function insertToken({ supabaseUrl, serviceRoleKey, token }) {
  const r = await fetch(`${supabaseUrl}/rest/v1/unsubscribes?on_conflict=token`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      // Second press of the same token: keep the first row, no error.
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify({ token }),
  });
  if (!r.ok) throw new Error(`insert failed: HTTP ${r.status}`);
}

async function fetchSince({ supabaseUrl, serviceRoleKey, since }) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const params = new URLSearchParams({
      select: 'token,unsubscribed_at',
      order: 'unsubscribed_at.asc,token.asc',
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (since) params.set('unsubscribed_at', `gte.${since}`);
    const r = await fetch(`${supabaseUrl}/rest/v1/unsubscribes?${params}`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });
    if (!r.ok) throw new Error(`read failed: HTTP ${r.status}`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  // Postgres keeps microseconds; toISOString() floors to milliseconds, so a
  // caller re-using the last value as ?since= re-reads that row rather than
  // ever skipping one.
  return rows.map((r) => ({ token: r.token, unsubscribed_at: new Date(r.unsubscribed_at).toISOString() }));
}

// ---------------------------------------------------------------------
async function handlePage(req, res, env) {
  const token = String(req.query.u ?? '');
  if (!TOKEN_RE.test(token)) return notFound(res);

  if (req.method === 'GET' || req.method === 'HEAD') {
    // NOTHING is recorded here — link scanners open every URL.
    return sendHtml(res, 200, pageHtml({
      title: 'Unsubscribe',
      body: `<h1>Unsubscribe from Promo Gifts emails?</h1>
  <form method="post" action="/u/${esc(token)}">
    <button type="submit">Unsubscribe</button>
  </form>`,
    }));
  }

  if (req.method === 'POST') {
    if (!env.supabaseUrl || !env.serviceRoleKey) {
      console.error('[unsubscribes] missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
      return sendHtml(res, 503, pageHtml({ title: 'Please try again', body: '<h1>Sorry, something went wrong. Please try again in a minute.</h1>' }));
    }
    try {
      await insertToken({ ...env, token });
    } catch (err) {
      console.error('[unsubscribes] record failed:', err.message); // never log the token with anything else
      return sendHtml(res, 503, pageHtml({ title: 'Please try again', body: '<h1>Sorry, something went wrong. Please try again in a minute.</h1>' }));
    }
    return sendHtml(res, 200, pageHtml({
      title: 'Unsubscribed',
      body: "<h1>You've been unsubscribed. You won't hear from Promo Gifts again.</h1>",
    }));
  }

  res.setHeader('Allow', 'GET, HEAD, POST');
  return sendHtml(res, 405, pageHtml({ title: 'Not allowed', body: '<h1>Not allowed.</h1>' }));
}

async function handlePull(req, res, env) {
  res.setHeader('Cache-Control', 'no-store');
  // Auth first. An unset secret never opens the endpoint.
  if (!secretMatches(req.headers.authorization, env.pullSecret)) {
    res.statusCode = 401;
    return res.end();
  }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end();
  }
  let since = null;
  if (req.query.since != null && req.query.since !== '') {
    const t = Date.parse(String(req.query.since));
    if (Number.isNaN(t)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'since must be an ISO 8601 timestamp' }));
    }
    since = new Date(t).toISOString();
  }
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    res.statusCode = 500;
    return res.end();
  }
  try {
    const unsubscribes = await fetchSince({ ...env, since });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ unsubscribes }));
  } catch (err) {
    console.error('[unsubscribes] pull failed:', err.message);
    res.statusCode = 502;
    return res.end();
  }
}

export default async function handler(req, res) {
  const env = {
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    pullSecret: process.env.UNSUB_PULL_SECRET,
  };
  // vercel.json rewrites /u/<anything> to ?page=1&u=<anything>.
  if (req.query?.page === '1') return handlePage(req, res, env);
  return handlePull(req, res, env);
}
