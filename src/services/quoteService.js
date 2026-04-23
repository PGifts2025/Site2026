// TODO(MOQ-unification): three MOQ columns currently coexist in the schema —
// catalog_products.min_order_quantity (canonical for buy-flow), catalog_pricing_tiers.min_quantity
// (per-tier price break), and product_templates.min_order_qty (designer-side). The buy/quote
// flow uses catalog_products.min_order_quantity. A future task should reconcile these into a
// single source of truth; do not paper over the divergence here.
import { supabase } from './supabaseService';

const CLOTHING_PRODUCTS = ['t-shirts', 'hoodie', 'sweatshirts', 'polo', 'hi-vis-vest'];

const buildClothingRedirect = (productKey, designId) => {
  const prefix = productKey === 'hi-vis-vest' ? '/hi-vis' : '/clothing';
  return `${prefix}/${productKey}?design=${designId}`;
};

const pickTierForQty = (tiers, qty) => {
  if (!tiers || tiers.length === 0) return null;
  const sorted = [...tiers].sort((a, b) => a.min_quantity - b.min_quantity);
  let match = sorted[0];
  for (const tier of sorted) {
    if (tier.min_quantity <= qty) match = tier;
    else break;
  }
  return match;
};

/**
 * Create a draft quote from a saved design.
 * Clothing products redirect to the product page so Configure & Quote handles
 * size/colour/print configuration. Non-clothing products insert a single
 * quote_item using the tier matching `quantityOverride` (or the lowest tier
 * minimum if no override is supplied).
 *
 * @returns {Promise<{ redirect: string, quoteId?: string, quoteNumber?: string, error?: string }>}
 */
export const createQuoteFromDesign = async ({ design, user, quantityOverride = null }) => {
  if (!design || !design.product_key) {
    return { error: 'Invalid design — missing product_key' };
  }
  if (!user || !user.id) {
    return { error: 'Sign-in required to create a quote' };
  }

  if (CLOTHING_PRODUCTS.includes(design.product_key)) {
    return { redirect: buildClothingRedirect(design.product_key, design.id) };
  }

  const { data: product, error: productError } = await supabase
    .from('catalog_products')
    .select('id, name')
    .eq('slug', design.product_key)
    .single();

  if (productError || !product) {
    console.error('[quoteService] Product lookup failed:', productError);
    return { error: 'Could not find product. Please try again.' };
  }

  const { data: allTiers, error: tierError } = await supabase
    .from('catalog_pricing_tiers')
    .select('min_quantity, price_per_unit')
    .eq('catalog_product_id', product.id)
    .order('min_quantity', { ascending: true });

  if (tierError) {
    console.error('[quoteService] Tier lookup failed:', tierError);
    return { error: 'Could not load pricing. Please try again.' };
  }

  const lowestMin = allTiers?.[0]?.min_quantity ?? 1;
  const effectiveQty = quantityOverride ?? lowestMin;
  const matchedTier = pickTierForQty(allTiers, effectiveQty);
  const unitPrice = matchedTier?.price_per_unit ?? 0;

  const quoteNumber = 'Q-' + Date.now().toString().slice(-6);
  // Computed pre-insert for correctness; also maintained by
  // 20260422_quote_total_sync_trigger.sql as a safety net for future item edits.
  const initialTotal = +(effectiveQty * unitPrice).toFixed(2);
  const { data: newQuote, error: quoteError } = await supabase
    .from('quotes')
    .insert({
      quote_number: quoteNumber,
      customer_id: user.id,
      status: 'draft',
      total_amount: initialTotal,
      notes: `Design: ${design.design_name || 'Untitled'}`,
    })
    .select()
    .single();

  if (quoteError || !newQuote) {
    console.error('[quoteService] Failed to create quote:', quoteError);
    return { error: 'Failed to create quote. Please try again.' };
  }

  const { error: itemError } = await supabase
    .from('quote_items')
    .insert({
      quote_id: newQuote.id,
      product_id: product.id,
      product_name: product.name,
      quantity: effectiveQty,
      unit_price: unitPrice,
      color: design.color_name || design.color_code || null,
      print_areas: design.print_area || null,
      notes: `Design: ${design.design_name || 'Untitled'}`,
    });

  if (itemError) {
    console.error('[quoteService] quote_items insert failed:', itemError);
    return { error: `Failed to add item to quote: ${itemError.message}` };
  }

  window.dispatchEvent(new Event('quoteCountChanged'));

  return {
    redirect: '/account/quotes',
    quoteId: newQuote.id,
    quoteNumber: newQuote.quote_number,
  };
};
