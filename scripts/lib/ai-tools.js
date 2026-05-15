/**
 * Tool definitions for the PGifts AI assistant.
 *
 * Two tools, mirroring session 4b's HTTP endpoints:
 *   - searchProducts → POST /api/search-products
 *   - findAlternatives → POST /api/find-alternatives
 *
 * The schemas are intentionally a subset of the endpoints' full filter
 * surface. We expose the filters the model is likely to use well
 * (category, sub-category, MOQ, quantity, price ceiling, supplier
 * preference, stock/express toggles) and omit ones that need normalised
 * data we don't have (material — free text in Laltex; see CLAUDE.md
 * §31.2).
 *
 * Caching contract:
 *   These definitions live in the request's `tools` array, which renders
 *   BEFORE the system prompt. Any change here invalidates the system+tools
 *   cache (which is the high-value cached region — see CLAUDE.md §32.4).
 *   Treat the schema as frozen unless you're rolling a deliberate cache
 *   bust.
 */

export const SEARCH_PRODUCTS_TOOL = {
  name: 'searchProducts',
  description:
    'Search the PGifts catalogue with hybrid semantic + keyword retrieval. Use this when the customer\'s request is precise enough to fetch concrete products (specific category, budget, quantity, or product type). Returns up to `limit` products ranked by relevance with full pricing tiers, print details, colour variants, lead time, and stock status. Counts against the anonymous user\'s daily quota.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Natural-language search query, e.g. "insulated travel mug with custom print", "cotton tote bags", "branded power bank under £20". Max 500 chars.',
      },
      category: {
        type: 'string',
        description:
          'Restrict to a top-level category. Valid values include: Bags, Bespoke Sourced, Cables, Clearance, Clothing, Confectionery, Drinkware, Giveaways, Health and Wellbeing, Homeware, Keyrings, Lanyards, Notebooks, Office, Outdoor and Sports, Power, Practical, Safety Wear, Seeds, Tech, Writing. Omit for cross-category search.',
      },
      sub_category: {
        type: 'string',
        description:
          'Restrict to a specific sub-category (EXACT match — case sensitive). Use ONLY when the customer named the exact sub-category, or after a prior search showed you the exact string. Different suppliers use different sub-category names (e.g. Laltex uses "T-shirts", "Plastic Travel Mugs", "Ceramic Mug", "Shoppers"; PGifts Direct uses "Coffee Cups", "Cotton Bags"). Setting this filter typically restricts results to a single supplier — prefer leaving it unset and relying on the natural-language query unless you have a specific reason.',
      },
      minOrderQuantity: {
        type: 'integer',
        description:
          'Maximum acceptable minimum-order quantity. Excludes products whose MOQ exceeds this number. Use when the customer\'s order size is small.',
      },
      quantity: {
        type: 'integer',
        description:
          'Order quantity, used to pick the applicable price tier when maxUnitPrice is set. REQUIRED if maxUnitPrice is provided.',
      },
      maxUnitPrice: {
        type: 'number',
        description:
          'Per-unit price ceiling in GBP at the given `quantity`. POA (price-on-application) products are excluded when this is set. Requires `quantity`.',
      },
      maxLeadTimeDays: {
        type: 'integer',
        description:
          'Maximum lead time in working days. Use when the customer needs the order by a specific date.',
      },
      inStockOnly: {
        type: 'boolean',
        description: 'Default true. Set false to include products marked out-of-stock.',
      },
      expressOnly: {
        type: 'boolean',
        description: 'Default false. Set true to restrict to express-turnaround products (Laltex Fast Fit division).',
      },
      supplierSlug: {
        type: 'string',
        enum: ['laltex', 'pgifts-direct'],
        description:
          'Restrict to one supplier. Use ONLY when the customer explicitly names a supplier preference (e.g. "show me PGifts Direct cables", "Laltex tote bags only"), or when the customer asks for live-design-preview-compatible products (which are PGifts-Direct-only at present). Do NOT filter to one supplier on subjective grounds like "premium" or "highest quality".',
      },
      product_indicator: {
        type: 'string',
        description:
          'Filter by Laltex editorial indicator. Common values: "Clearance", "Best Seller", "Eco-Friendly", "New". Useful for "show me your best sellers" or "show me clearance items".',
      },
      limit: {
        type: 'integer',
        description: 'Number of results to return (default 10, max 50).',
      },
    },
    required: ['query'],
  },
};

export const FIND_ALTERNATIVES_TOOL = {
  name: 'findAlternatives',
  description:
    'Given a product code (e.g. "MG0192", "ocean-octopus"), find up to `limit` similar products by semantic similarity. Use this when the customer asks "more like this", "alternatives to X", or when a product is out of stock and you want to offer near-substitutes. Does NOT count against quota.',
  input_schema: {
    type: 'object',
    properties: {
      supplier_product_code: {
        type: 'string',
        description:
          'The exact supplier_product_code of the source product. For Laltex products this is the SKU code (e.g. "MG0192"); for PGifts-Direct it is the slug (e.g. "ocean-octopus").',
      },
      limit: {
        type: 'integer',
        description: 'Number of alternatives to return (default 5, max 20).',
      },
      excludeOutOfStock: {
        type: 'boolean',
        description: 'Default true. Set false to include out-of-stock alternatives.',
      },
    },
    required: ['supplier_product_code'],
  },
};

export const ALL_TOOLS = [SEARCH_PRODUCTS_TOOL, FIND_ALTERNATIVES_TOOL];

// Anthropic model + sampling defaults for the chat endpoint. Surfaced
// here so the verification harness can match against the same values
// and so a future retune is one edit.
//
// Per the claude-api skill recommendation for non-thinking chat workloads:
//   thinking: disabled  + effort: low → similar-or-better than Sonnet 4.5
//   no-thinking, with snappier latency and lower cost.
// CLAUDE.md §32.5 documents the rationale.
export const ANTHROPIC_CONFIG = Object.freeze({
  model: 'claude-sonnet-4-6',
  max_tokens: 2048,
  thinking: { type: 'disabled' },
  effort: 'low',
});
