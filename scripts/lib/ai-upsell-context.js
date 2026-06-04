/**
 * Loader + formatter for the AVA Direct-product upsell context.
 *
 * Source of truth: the `ava_direct_product_context` table (one row per
 * PGifts Direct product). This is the TUNING editing surface: edit rows in
 * Supabase Studio, no code change or commit needed (CLAUDE.md §32 / the
 * AVA conversation-rules section). The stable conversation RULES live in
 * docs/ava-conversation-rules.md instead.
 *
 * The formatted text is injected into the chat system prompt as a cached
 * block (CLAUDE.md §32.4). To keep prompt caching healthy it must be
 * byte-stable across requests within a cache window, so we:
 *   - fetch ONCE per request (the chat handler builds the system array once
 *     and reuses it across agentic-loop iterations), and
 *   - memoise across requests with a short TTL so Studio edits propagate
 *     within minutes without a redeploy, at the cost of an occasional
 *     cache rebuild (rare; the table changes infrequently).
 *
 * Degrades gracefully: if the table is missing (migration not yet applied)
 * or the query fails, returns '' and logs. The chat endpoint keeps working
 * on the base prompt + rules; it just won't proactively upsell that turn.
 */

const TTL_MS = 5 * 60 * 1000; // 5 min: matches Anthropic's cache TTL ballpark

let cache = { text: null, fetchedAt: 0 };

const SELECT_COLS =
  'slug,product_name,use_cases,price_tier,differentiators,upsell_triggers,upsell_framing_example';

function formatRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  // A field still holding the '<NEEDS DAVE INPUT ...>' placeholder is unreviewed
  // copy and must never be presented to the model. Skip those lines.
  const present = (v) => typeof v === 'string' && v.length > 0 && !/NEEDS DAVE INPUT/i.test(v);
  const lines = rows.map((r) => {
    const uses = Array.isArray(r.use_cases) ? r.use_cases.join(', ') : '';
    const triggers = Array.isArray(r.upsell_triggers) ? r.upsell_triggers.join(', ') : '';
    return [
      `- ${r.product_name} (${r.slug}) [${r.price_tier}]`,
      uses ? `  Use cases: ${uses}` : null,
      present(r.differentiators) ? `  Differentiators: ${r.differentiators}` : null,
      triggers ? `  Suggest when the query relates to: ${triggers}` : null,
      present(r.upsell_framing_example) ? `  Framing: ${r.upsell_framing_example}` : null,
    ].filter(Boolean).join('\n');
  });
  return [
    'PGIFTS DIRECT UPSELL CONTEXT',
    '',
    'These PGifts Direct products are available to suggest as premium or',
    'value-add options, per the Upsell Pattern in the conversation rules.',
    'Suggest one ONLY when the customer\'s stated need genuinely matches its',
    'triggers. Always lead with the best honest match for what they asked',
    'for, then add the Direct product as something "worth considering". Never',
    'substitute it silently for a cheaper honest match. Do not invent',
    'specifications beyond what is listed here.',
    '',
    ...lines,
  ].join('\n');
}

/**
 * Returns the formatted upsell-context block as a string (or '' if none /
 * unavailable). Never throws.
 *
 * @param {object} opts
 * @param {string} opts.supabaseUrl
 * @param {string} opts.serviceRoleKey
 * @param {function} [opts.nowMs] injectable clock for tests
 * @param {function} [opts.fetchImpl] injectable fetch for tests
 */
export async function loadUpsellContext({ supabaseUrl, serviceRoleKey, nowMs, fetchImpl } = {}) {
  const now = (nowMs ?? Date.now)();
  if (cache.text !== null && now - cache.fetchedAt < TTL_MS) {
    return cache.text;
  }
  const doFetch = fetchImpl ?? fetch;
  try {
    const url =
      `${supabaseUrl}/rest/v1/ava_direct_product_context` +
      `?active=eq.true&select=${SELECT_COLS}&order=slug.asc`;
    const resp = await doFetch(url, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: 'application/json',
      },
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[ai/chat] upsell-context query -> HTTP ${resp.status}: ${body.slice(0, 200)}`);
      cache = { text: '', fetchedAt: now };
      return '';
    }
    const rows = await resp.json();
    cache = { text: formatRows(rows), fetchedAt: now };
    return cache.text;
  } catch (err) {
    console.error('[ai/chat] failed to load upsell context:', err?.message ?? err);
    cache = { text: '', fetchedAt: now };
    return '';
  }
}

/** Test helper: clear the TTL memo. */
export function _resetUpsellContextCache() {
  cache = { text: null, fetchedAt: 0 };
}

export { formatRows as _formatRows };
