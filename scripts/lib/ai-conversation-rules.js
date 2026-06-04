/**
 * Loader for the AVA conversation-rules markdown.
 *
 * The canonical, human-editable source is docs/ava-conversation-rules.md.
 * This module reads that file once per cold start, caches the string, and
 * exposes it for injection into the chat system prompt as a cached block
 * (CLAUDE.md §32.4).
 *
 * Why read at runtime (not inline the string here):
 *   The markdown is the single editing surface. Dave (or a reviewer) edits
 *   the .md via PR; the next deploy picks it up with zero code change. We
 *   deliberately do NOT keep a second copy of the rules in JS, which would
 *   drift from the markdown.
 *
 * Bundling on Vercel:
 *   `new URL(..., import.meta.url)` is statically analysable by Vercel's
 *   file tracer (@vercel/nft), so the .md is included in the function
 *   bundle. vercel.json also lists it under functions.includeFiles as
 *   belt-and-braces. If both somehow fail, we degrade gracefully: the
 *   base system prompt still governs the conversation; we log loudly and
 *   return an empty string rather than crashing the chat endpoint.
 *
 * Caching contract:
 *   The returned string must be byte-stable across requests within a cache
 *   window (it is: a file read of a committed file). It changes only on a
 *   markdown edit + redeploy, which is an intended cache rebuild.
 */

import { readFileSync } from 'node:fs';

const RULES_URL = new URL('../../docs/ava-conversation-rules.md', import.meta.url);

let cachedRules = null; // string once loaded; '' on failure (still memoised)

/**
 * Returns the conversation-rules markdown as a plain string. Memoised for
 * the lifetime of the function instance. Never throws: on read failure it
 * logs and returns '' so the chat endpoint keeps working on the base prompt.
 */
export function loadConversationRules() {
  if (cachedRules !== null) return cachedRules;
  try {
    cachedRules = readFileSync(RULES_URL, 'utf8').trim();
    if (!cachedRules) {
      console.error('[ai/chat] ava-conversation-rules.md loaded empty');
    }
  } catch (err) {
    console.error('[ai/chat] failed to load ava-conversation-rules.md:', err?.message ?? err);
    cachedRules = '';
  }
  return cachedRules;
}

/** Test helper: clear the memo so a test can re-read the file. */
export function _resetConversationRulesCache() {
  cachedRules = null;
}
