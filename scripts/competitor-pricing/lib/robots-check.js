// Mandatory robots.txt gate. Runs at the start of EVERY script that touches TM.
//
// We fetch TM's robots.txt fresh (never cached), parse the rule group that
// applies to our User-Agent, and confirm that the product-page paths we intend
// to crawl are not Disallowed. If they are, we abort with a clear message and
// scrape nothing.

const USER_AGENT =
  'PGifts-PriceCheck/1.0 (https://promo-gifts-co.uk; contact: hello@promo-gifts.co)';
const ROBOTS_URL = 'https://www.totalmerchandise.co.uk/robots.txt';
const ROBOTS_TIMEOUT_MS = 30000;

// Representative paths the scraper actually fetches. If any is disallowed, abort.
const PRODUCT_TEST_PATHS = [
  '/branded-products/branded-clothing/essential-sandwich-peak-cotton-cap',
  '/branded-products/',
];

/**
 * Parse robots.txt into { '<user-agent>': { allow: [], disallow: [] } }.
 * Handles consecutive User-agent lines sharing a single rule block.
 */
export function parseRobots(txt) {
  const groups = Object.create(null);
  const ensure = (ua) => (groups[ua] || (groups[ua] = { allow: [], disallow: [] }));
  let pendingUAs = [];
  let rulesStarted = false;

  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (rulesStarted) {
        pendingUAs = [];
        rulesStarted = false;
      }
      const ua = value.toLowerCase();
      pendingUAs.push(ua);
      ensure(ua);
    } else if (field === 'disallow' || field === 'allow') {
      rulesStarted = true;
      const targets = pendingUAs.length ? pendingUAs : ['*'];
      for (const ua of targets) ensure(ua)[field].push(value);
    }
  }
  return groups;
}

/** Pick the rule group that applies to our UA (longest matching token, else '*'). */
export function selectGroup(groups) {
  const ua = USER_AGENT.toLowerCase();
  let best = null;
  for (const key of Object.keys(groups)) {
    if (key === '*') continue;
    if (ua.includes(key) && (!best || key.length > best.length)) best = key;
  }
  return groups[best] || groups['*'] || { allow: [], disallow: [] };
}

function ruleToRegex(rule) {
  let body = rule;
  let anchorEnd = false;
  if (body.endsWith('$')) {
    anchorEnd = true;
    body = body.slice(0, -1);
  }
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + (anchorEnd ? '$' : ''));
}

function longestMatchLen(path, rules) {
  let len = -1;
  for (const rule of rules) {
    if (rule === '') continue; // an empty Disallow means "allow all" — contributes no match
    if (ruleToRegex(rule).test(path)) {
      len = Math.max(len, rule.replace(/\$$/, '').length);
    }
  }
  return len;
}

/** Standard longest-match precedence between allow and disallow rules. */
export function isPathAllowed(path, group) {
  const dis = longestMatchLen(path, group.disallow);
  if (dis === -1) return true; // nothing disallows it
  const all = longestMatchLen(path, group.allow);
  return all >= dis; // an equally- or more-specific Allow wins
}

/**
 * Fetch + check robots.txt. Resolves on success; throws a `.fatal` error if
 * product pages are disallowed or robots.txt can't be confirmed.
 * @param {string[]} [testPaths]
 */
export async function assertScrapingAllowed(testPaths = PRODUCT_TEST_PATHS) {
  console.log(`[robots] Fetching ${ROBOTS_URL}`);
  let txt = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS);
    const res = await fetch(ROBOTS_URL, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.status === 404) {
      console.log('[robots] 404 — no robots.txt published; scraping permitted by default.');
      return { allowed: true, group: { allow: [], disallow: [] }, raw: '' };
    }
    if (!res.ok) throw new Error(`robots.txt fetch returned ${res.status}`);
    txt = await res.text();
  } catch (err) {
    const e = new Error(
      `Could not fetch robots.txt (${err.message}). Refusing to scrape without ` +
        `confirming the robots policy. Aborting.`,
    );
    e.fatal = true;
    throw e;
  }

  const group = selectGroup(parseRobots(txt));
  const disallowList = group.disallow.filter(Boolean);
  console.log(
    `[robots] Applicable Disallow rules: ${disallowList.length ? disallowList.join(', ') : '(none)'}`,
  );

  for (const path of testPaths) {
    if (!isPathAllowed(path, group)) {
      const e = new Error(
        `TM's robots.txt disallows scraping of product pages. Aborting. Path: ${path}. ` +
          `Update robots-policy.md or seek permission before proceeding.`,
      );
      e.fatal = true;
      throw e;
    }
  }

  console.log(
    `[robots] OK — product pages permitted (${testPaths.length} representative paths checked).`,
  );
  return { allowed: true, group, raw: txt };
}
