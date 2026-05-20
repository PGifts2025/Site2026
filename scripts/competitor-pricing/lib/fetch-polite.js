// Rate-limited, honest, retrying HTTP GET wrapper around Node's built-in fetch.
//
// Politeness is the social contract for scraping someone else's site:
//  - we identify ourselves honestly in the User-Agent (no browser impersonation)
//  - we never issue requests to the same host closer than MIN_INTERVAL_MS apart
//  - we back off and retry transient failures, but HARD ABORT on signals that
//    suggest we're unwelcome (403) or hammering (429) or that the site changed
//    underneath us (a run of 404s).
//
// Errors thrown with `err.fatal === true` mean "stop the whole run". Errors
// without that flag are per-URL problems the caller can log and skip.

const USER_AGENT =
  'PGifts-PriceCheck/1.0 (https://promo-gifts-co.uk; contact: hello@promo-gifts.co)';

const MIN_INTERVAL_MS = 2500; // minimum gap between requests to the same host
const REQUEST_TIMEOUT_MS = 30000; // per-request timeout
const MAX_ATTEMPTS = 3; // total attempts on transient failures
const BACKOFF_MS = [2000, 5000, 12000]; // exponential-ish backoff between attempts
const CONSECUTIVE_404_ABORT = 5; // this many 404s in a row => site probably changed

const lastRequestAtByHost = new Map();
let consecutive404 = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fatalError(message) {
  const err = new Error(message);
  err.fatal = true;
  return err;
}

async function throttle(host) {
  const last = lastRequestAtByHost.get(host) || 0;
  const wait = MIN_INTERVAL_MS - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  // Stamp the moment we're about to fire so the interval is measured request-to-request.
  lastRequestAtByHost.set(host, Date.now());
}

function transientNetworkError(err) {
  const code = err.code || (err.cause && err.cause.code);
  return (
    err.name === 'AbortError' ||
    [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_SOCKET',
      'UND_ERR_HEADERS_TIMEOUT',
    ].includes(code)
  );
}

/**
 * Politely GET a URL and return the response body as text.
 * @param {string} url
 * @returns {Promise<string>}
 * @throws {Error} per-URL errors (caller logs + skips); errors with `.fatal === true` must abort the run.
 */
export async function politeFetch(url) {
  const host = new URL(url).host;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await throttle(host);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const started = Date.now();
    let res;

    try {
      res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const ms = Date.now() - started;
      console.log(`[GET] ${url} → ERR ${err.code || err.name} (${ms}ms)`);
      lastErr = err;
      if (attempt < MAX_ATTEMPTS && transientNetworkError(err)) {
        await sleep(BACKOFF_MS[attempt - 1]);
        continue;
      }
      throw err;
    }

    clearTimeout(timer);
    const ms = Date.now() - started;
    console.log(`[GET] ${url} → ${res.status} (${ms}ms)`);

    // Hard aborts: we are not welcome here.
    if (res.status === 403) {
      throw fatalError(
        `Hard abort: 403 Forbidden from ${host} — possible IP block. URL: ${url}`,
      );
    }
    if (res.status === 429) {
      throw fatalError(
        `Hard abort: 429 Too Many Requests from ${host} — we're being rate limited. ` +
          `Wait a while (hours) before retrying. URL: ${url}`,
      );
    }

    if (res.status === 404) {
      consecutive404 += 1;
      if (consecutive404 >= CONSECUTIVE_404_ABORT) {
        throw fatalError(
          `Hard abort: ${consecutive404} consecutive 404s — TM site structure has likely ` +
            `changed. Re-run scrape-tm-sitemap.js. Last URL: ${url}`,
        );
      }
      const err = new Error(`404 Not Found: ${url}`);
      err.status = 404;
      throw err; // per-URL, non-fatal
    }

    if (res.status >= 500) {
      lastErr = new Error(`${res.status} server error: ${url}`);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BACKOFF_MS[attempt - 1]);
        continue;
      }
      throw lastErr;
    }

    if (!res.ok) {
      // Other 4xx — not retryable, but not a reason to abort the whole run.
      throw new Error(`${res.status} ${res.statusText}: ${url}`);
    }

    consecutive404 = 0; // any success breaks a 404 streak
    return res.text();
  }

  throw lastErr || new Error(`Failed to fetch ${url}`);
}

export const FETCH_CONFIG = {
  USER_AGENT,
  MIN_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  MAX_ATTEMPTS,
};
