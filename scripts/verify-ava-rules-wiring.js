/**
 * Deterministic verification for the AVA conversation-rules + upsell-context
 * wiring. Proves, without calling Anthropic or the live DB:
 *   1. docs/ava-conversation-rules.md loads and carries the key rules.
 *   2. The upsell-context loader formats rows into the expected block
 *      (fetch is stubbed with two sample rows).
 *   3. The system-prompt assembly (mirroring api/ai/chat.js) produces the
 *      3-block layout with a single trailing cache breakpoint, and the
 *      base prompt no longer names a supplier.
 *
 * Run: node scripts/verify-ava-rules-wiring.js
 */
import { SYSTEM_PROMPT } from './lib/ai-system-prompt.js';
import { loadConversationRules } from './lib/ai-conversation-rules.js';
import { loadUpsellContext, _resetUpsellContextCache, _formatRows } from './lib/ai-upsell-context.js';

let failures = 0;
// Collapse whitespace so checks are insensitive to markdown line-wrapping
// (the rules doc hard-wraps prose; the wraps are cosmetic to the model).
const norm = (s) => s.replace(/\s+/g, ' ');
const check = (label, cond, detail = '') => {
  const ok = !!cond;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
};

// 1. Rules markdown
const rules = loadConversationRules();
check('rules markdown loads non-empty', rules.length > 0, `${rules.length} chars`);
check('rules: identity deflection present', norm(rules).includes("I'm Ava from Promo Gifts"));
check('rules: supplier confidentiality present', norm(rules).includes('We source our own products as required'));
check('rules: payment/Stripe answer present', /account terms/i.test(rules));
check('rules: emoji ban present', /Never produce emojis/i.test(rules));
check('rules: no em dash in rules body (—)', !rules.includes('—'));

// 2. Upsell context loader (stubbed fetch with 2 sample rows)
_resetUpsellContextCache();
const sampleRows = [
  {
    slug: '/power/luggie', product_name: 'Luggie',
    use_cases: ['executive travel programs', 'incentive trips'],
    price_tier: 'premium',
    differentiators: 'International travel adapter covering 150+ countries.',
    upsell_triggers: ['travel', 'adapter', 'executive gift'],
    upsell_framing_example: 'The Luggie is worth considering if the client wants a premium gift for higher-value contacts.',
  },
  {
    slug: '/cables/octopus-mini', product_name: 'Octopus Mini',
    use_cases: ['conference welcome packs'],
    price_tier: 'mid',
    differentiators: 'Compact power bank with built-in charging cables.',
    upsell_triggers: ['power bank', 'tech giveaway'],
    upsell_framing_example: 'The Octopus Mini is worth suggesting for a compact tech giveaway.',
  },
];
const stubFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => sampleRows,
  text: async () => JSON.stringify(sampleRows),
});
const upsell = await loadUpsellContext({
  supabaseUrl: 'https://stub', serviceRoleKey: 'stub', fetchImpl: stubFetch,
});
check('upsell: header present', upsell.includes('PGIFTS DIRECT UPSELL CONTEXT'));
check('upsell: Luggie framing present', upsell.includes('worth considering if the client wants a premium gift'));
check('upsell: price tier rendered', upsell.includes('[premium]') && upsell.includes('[mid]'));
check('upsell: triggers rendered', /Suggest when the query relates to: travel, adapter/.test(upsell));

// 2a-ii. A '<NEEDS DAVE INPUT ...>' framing must be omitted, not shown
const guarded = _formatRows([{
  slug: 'hoodie', product_name: 'Hoodie', use_cases: ['team kit'], price_tier: 'mid',
  differentiators: 'Pullover with front pouch pocket.',
  upsell_triggers: ['hoodie'],
  upsell_framing_example: '<NEEDS DAVE INPUT: genuine why-us hook for the hoodie.>',
}]);
check('upsell: NEEDS DAVE INPUT framing is omitted', guarded.includes('Hoodie (hoodie)') && !guarded.includes('Framing:') && !/NEEDS DAVE INPUT/.test(guarded));

// 2b. Loader degrades gracefully on a missing table (HTTP 404)
_resetUpsellContextCache();
const stub404 = async () => ({ ok: false, status: 404, text: async () => 'relation does not exist' });
const upsellMissing = await loadUpsellContext({
  supabaseUrl: 'https://stub', serviceRoleKey: 'stub', fetchImpl: stub404,
});
check('upsell: empty string when table missing (no crash)', upsellMissing === '');

// 3. System-prompt assembly (mirror of api/ai/chat.js)
function buildSystemBlocks(rulesText, upsellText) {
  const blocks = [{ type: 'text', text: SYSTEM_PROMPT }];
  if (rulesText) blocks.push({ type: 'text', text: `AVA CONVERSATION RULES\n\n${rulesText}` });
  if (upsellText) blocks.push({ type: 'text', text: upsellText });
  blocks[blocks.length - 1].cache_control = { type: 'ephemeral' };
  return blocks;
}
const blocks = buildSystemBlocks(rules, upsell);
check('assembly: 3 system blocks', blocks.length === 3, `${blocks.length} blocks`);
check('assembly: block 1 is base SYSTEM_PROMPT', blocks[0].text === SYSTEM_PROMPT);
check('assembly: block 2 carries rules', norm(blocks[1].text).includes('We source our own products as required'));
check('assembly: block 3 carries upsell', blocks[2].text.includes('PGIFTS DIRECT UPSELL CONTEXT'));
check('assembly: exactly one cache breakpoint, on the last block',
  blocks.filter((b) => b.cache_control).length === 1 && !!blocks[2].cache_control);
check('assembly: graceful 2-block layout when upsell empty',
  (() => { const b = buildSystemBlocks(rules, ''); return b.length === 2 && !!b[1].cache_control; })());

// base prompt must not contradict rule 2
check('base SYSTEM_PROMPT no longer names a supplier', !/laltex/i.test(SYSTEM_PROMPT));
check('base SYSTEM_PROMPT carries supplier-confidentiality line', /never name a supplier/i.test(SYSTEM_PROMPT));

const approxTokens = (s) => Math.round(s.length / 4);
console.log(`\nApprox token sizes: rules ~${approxTokens(rules)}, upsell(sample 2 rows) ~${approxTokens(upsell)}, base ~${approxTokens(SYSTEM_PROMPT)}`);
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
