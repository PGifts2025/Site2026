/**
 * Shared embedding helpers.
 *
 * Single source of truth for:
 *   - which OpenAI model we use
 *   - how supplier_products rows are flattened into source text
 *   - how that text is hashed for idempotency
 *   - how the embedding is requested from OpenAI
 *
 * ESM (site/package.json has "type": "module"). Pure module — no I/O
 * beyond the network call inside generateEmbedding().
 */

import crypto from 'node:crypto';

/**
 * The only place the model name is hardcoded. If this changes, the
 * vector() column dimension in supplier_products must change to match,
 * and every embedding in the table must be regenerated.
 */
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMS = 1536;

const MAX_SOURCE_CHARS = 8000;

function squashWhitespace(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

function presentField(val) {
  if (val == null) return null;
  const s = squashWhitespace(val);
  return s.length > 0 ? s : null;
}

/**
 * Flatten a supplier_products row into the source string that gets
 * embedded. Recipe:
 *
 *   [name]. [name].                                    (×2 for weighting)
 *   [category] > [sub_category].
 *   [description OR web_description].
 *   Keywords: [keywords].
 *   Material: [material].
 *   Available in [available_colours].
 *
 * - Name is duplicated — the product name is the single strongest signal
 *   for search intent. Repeating gives it roughly 2× weight in the
 *   bag-of-tokens view.
 * - description/web_description fall back to each other.
 * - Any segment that would produce a null/empty field is dropped whole
 *   (no "Material: null" garbage).
 * - Final string is squashed (single spaces, trimmed) and capped at
 *   MAX_SOURCE_CHARS. 8000 chars ≈ 2000 tokens — well under the model's
 *   8191-token context limit, with headroom for longer future feeds.
 *
 * @param {object} product - supplier_products row (snake_case columns)
 * @returns {string}
 */
export function buildEmbeddingSourceText(product) {
  if (!product || typeof product !== 'object') return '';

  const name = presentField(product.name);
  const category = presentField(product.category);
  const subCategory = presentField(product.sub_category);
  const description =
    presentField(product.description) || presentField(product.web_description);
  const keywords = presentField(product.keywords);
  const material = presentField(product.material);
  const colours = presentField(product.available_colours);

  const segments = [];

  if (name) {
    segments.push(name);
    segments.push(name); // deliberate duplicate — name weighting
  }

  if (category && subCategory) {
    segments.push(`${category} > ${subCategory}`);
  } else if (category) {
    segments.push(category);
  } else if (subCategory) {
    segments.push(subCategory);
  }

  if (description) segments.push(description);
  if (keywords) segments.push(`Keywords: ${keywords}`);
  if (material) segments.push(`Material: ${material}`);
  if (colours) segments.push(`Available in ${colours}`);

  const joined = segments.join('. ') + (segments.length ? '.' : '');
  const squashed = squashWhitespace(joined);

  if (squashed.length <= MAX_SOURCE_CHARS) return squashed;
  return squashed.slice(0, MAX_SOURCE_CHARS);
}

/**
 * SHA-256 hex of the source text. Used as the idempotency key:
 *   if hash(new_source) === row.embedding_source_hash && row.embedding IS NOT NULL
 *      => skip the OpenAI call entirely.
 *
 * Exposed so callers can check before instantiating the OpenAI client.
 *
 * @param {string} text
 * @returns {string} 64-char lowercase hex
 */
export function hashSourceText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Generate an embedding for a given text via the provided OpenAI client.
 *
 * @param {string} text
 * @param {import('openai').default} openaiClient
 * @returns {Promise<{
 *   embedding: number[],
 *   sourceHash: string,
 *   tokensUsed: number,
 *   model: string
 * }>}
 */
export async function generateEmbedding(text, openaiClient) {
  if (!text || typeof text !== 'string') {
    throw new Error('generateEmbedding: text must be a non-empty string');
  }
  if (!openaiClient?.embeddings?.create) {
    throw new Error('generateEmbedding: openaiClient looks malformed (missing .embeddings.create)');
  }

  const resp = await openaiClient.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    encoding_format: 'float',
  });

  const vec = resp?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMS) {
    throw new Error(
      `generateEmbedding: unexpected response shape — got ${Array.isArray(vec) ? `${vec.length} dims` : typeof vec}`,
    );
  }

  return {
    embedding: vec,
    sourceHash: hashSourceText(text),
    tokensUsed: resp?.usage?.total_tokens ?? 0,
    model: resp?.model ?? EMBEDDING_MODEL,
  };
}

/**
 * Cost helper for logging. text-embedding-3-small is priced at
 * $0.02 per 1M input tokens.
 *
 * @param {number} tokens
 * @returns {{ usd: number, pence: number }}
 */
export function estimateEmbeddingCost(tokens) {
  const usd = (tokens / 1_000_000) * 0.02;
  const pence = usd * 100 * 0.79; // rough USD→GBP for display only
  return { usd, pence };
}

/**
 * Render a 1536-float array as a pgvector literal string (e.g.
 * '[0.123,0.456,...]'). Used when building INSERT/UPDATE SQL for the
 * Management API path — pgvector accepts this text form directly.
 *
 * @param {number[]} vec
 * @returns {string}
 */
export function vectorLiteral(vec) {
  if (!Array.isArray(vec)) throw new Error('vectorLiteral: expected array');
  return '[' + vec.map((n) => Number(n).toString()).join(',') + ']';
}
