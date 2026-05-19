/**
 * LaltexProductView — renders Laltex-feed products (supplier_products
 * rows) into the same visual frame as the existing PGifts Direct page.
 *
 * Why a separate component:
 *   ProductDetailPage is 1.8k lines of catalog_products-shaped state
 *   threaded through every branch. Weaving a 4th pricing model through
 *   it would create huge regression risk on the 25 PGifts Direct
 *   products. Splitting keeps the catalog path bit-for-bit identical
 *   (hard constraint, session 6 spec) while letting Laltex have its
 *   own clean rendering with per-position pricing.
 *
 * Shared visual contract with ProductDetailPage:
 *   Sticky header, image hero, details/specs tabs, sticky Configure &
 *   Quote pricing panel on the right. The layout grid is the same so
 *   navigating between catalog and supplier products feels seamless.
 *
 * Laltex-specific bits:
 *   - Image-based colour swatches (Laltex has PMS, not hex)
 *   - Per-position price configurator (Front / Back / Wrap / etc.)
 *   - Pre-computed all_in_unit_price (setup-baked at sync time, NEVER
 *     recomputed here — CLAUDE.md §32 follow-up / session 6 spec)
 *   - "Open Designer" routes to DesignerV2 at /design/<supplier_product_code>;
 *     hidden when the product has zero print_area_coordinates
 *
 * Unit conventions:
 *   Prices are stored as numbers throughout. Rounding to pence happens
 *   ONLY at display time (toFixed(2)), never during math.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Heart,
  Share2,
  ShoppingCart,
  Check,
  Truck,
  ChevronLeft,
  Plus,
  Minus,
  Loader,
  Shield,
  Zap,
  X,
  Palette,
} from 'lucide-react';

import { supabase } from '../services/supabaseService';
import { useAuth } from '../context/AuthContext';
import { deliveryPerUnit } from '../../scripts/lib/laltex-delivery.js';
import { scheduleMarginForTier } from '../../scripts/lib/laltex-margin.js';
import { isBucketADesignable } from '../utils/laltexPositionHeuristics';

// ---------------------------------------------------------------------------
// Pricing helpers
// ---------------------------------------------------------------------------

/**
 * Format a GBP value for display. Always two decimal places, never
 * carries upstream precision (£0.2395) into the UI as £2.720 or
 * £2.7. Stored values keep full precision for tier math; this is
 * applied at the last possible moment.
 */
export const formatGBP = (value) => {
  if (value == null || !Number.isFinite(value)) return '—';
  return `£${value.toFixed(2)}`;
};

/**
 * Friendly display label for a PrintDetails entry.
 *
 * Laltex uses `print_class` as an internal SKU code (309 distinct
 * values in the live corpus) but exposes `print_type` as the
 * human-readable method ("Spot Print", "Embroidery", "Engraving",
 * "Full Colour Transfer", etc. — 59 distinct values, all readable).
 * Prefer print_type; fall back to print_class for the rare null,
 * then to a generic 'Print' so the UI never renders empty.
 */
export const printMethodLabel = (pd) => {
  if (!pd) return 'Print';
  return pd.printType || pd.print_type || pd.printClass || pd.print_class || 'Print';
};

/**
 * Find the price tier whose [min_qty, max_qty] range contains qty.
 * Falls back to the highest tier with min_qty <= qty (last tier is
 * usually open-ended max_qty=null).
 */
function pickTier(tiers, qty) {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  const sorted = [...tiers].sort((a, b) => (a.minQty ?? 0) - (b.minQty ?? 0));
  let match = null;
  for (const t of sorted) {
    if (qty >= (t.minQty ?? 0) && (t.maxQty == null || qty <= t.maxQty)) {
      return t;
    }
    if (qty >= (t.minQty ?? 0)) match = t;
  }
  return match || sorted[0];
}

/**
 * Pick a print_price tier from a position's tiers array, matching
 * (qty, num_colours). Mirrors pickTier but with the additional colour
 * filter.
 */
/**
 * Distinct, sorted num_colours values that a position's tiers actually
 * contain. Drives the per-row colour-count UI: dropdown if >1 option,
 * static label if exactly 1, hidden if empty.
 */
export function availableColourCounts(position) {
  const tiers = position?.tiers || [];
  const set = new Set();
  for (const t of tiers) {
    const n = t.numColours ?? 1;
    if (Number.isFinite(n)) set.add(n);
  }
  return Array.from(set).sort((a, b) => a - b);
}

function pickPrintTier(positionTiers, qty, numColours) {
  if (!Array.isArray(positionTiers) || positionTiers.length === 0) return null;
  const byColour = positionTiers.filter((t) => (t.numColours ?? 1) === numColours);
  const candidates = byColour.length > 0 ? byColour : positionTiers;
  return pickTier(
    candidates.map((t) => ({ ...t, minQty: t.minQty, maxQty: t.maxQty })),
    qty,
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const LaltexProductView = ({ product }) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Visual state
  const [isLiked, setIsLiked] = useState(false);
  const [activeTab, setActiveTab] = useState('details');
  const [selectedColourId, setSelectedColourId] = useState(null);
  const [colourGalleryUrl, setColourGalleryUrl] = useState(null);
  const [showAllColours, setShowAllColours] = useState(false);
  const [addingToQuote, setAddingToQuote] = useState(false);
  const [quoteSuccess, setQuoteSuccess] = useState(null);
  // Lightbox state — opens with whatever's currently in the hero slot,
  // so it picks up colour-variant swaps automatically.
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Order config
  const minQty = product?.minimumOrderQty ?? 1;
  const [quantity, setQuantity] = useState(minQty);
  const [quantityInput, setQuantityInput] = useState(String(minQty));

  // Picks keyed by unique position name (session 9 — CLAUDE.md §43).
  // Each pick has { enabled, selectedRowIndex, colours }. The dropdown
  // selects which row inside the position group is active; the tick
  // box enables / disables the whole position. The "default" position
  // is the one carrying the row flagged default_print_option=true.
  const initialPositions = useMemo(() => {
    const groups = product?.printDetails?.positionGroups || [];
    if (groups.length === 0) return {};
    // Default position = whichever group contains the default-flagged row.
    const defaultGroupIdx = Math.max(
      0,
      groups.findIndex((g) => (g.rows || []).some((r) => r.defaultOption)),
    );
    const out = {};
    groups.forEach((g, i) => {
      const row = g.rows[g.defaultRowIndex] || g.rows[0] || null;
      const firstColour = availableColourCounts(row)[0] || 1;
      out[g.name] = {
        enabled: i === defaultGroupIdx,
        selectedRowIndex: g.defaultRowIndex,
        colours: firstColour,
      };
    });
    return out;
  }, [product?.code]);

  const [positionPicks, setPositionPicks] = useState(initialPositions);

  // Set initial colour when product changes
  useEffect(() => {
    if (product?.colours?.length > 0 && !selectedColourId) {
      setSelectedColourId(product.colours[0].id);
    }
  }, [product?.code]);

  // Reset when product changes
  useEffect(() => {
    setPositionPicks(initialPositions);
    setQuantity(minQty);
    setQuantityInput(String(minQty));
  }, [product?.code, initialPositions, minQty]);

  // Lightbox UX glue: ESC-to-close + body-scroll lock while open. We
  // restore the prior overflow value on cleanup so we don't trample a
  // page-level scroll setting from elsewhere.
  useEffect(() => {
    if (!lightboxOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setLightboxOpen(false); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightboxOpen]);

  // ----- Derived: current colour, image, tier -----
  const selectedColour = useMemo(
    () => (product?.colours || []).find((c) => c.id === selectedColourId) || null,
    [product?.colours, selectedColourId],
  );

  const heroImage = useMemo(() => {
    if (colourGalleryUrl) return colourGalleryUrl;
    if (selectedColour?.images?.[0]) return selectedColour.images[0];
    return product?.images?.[0]?.url || null;
  }, [colourGalleryUrl, selectedColour, product?.images]);

  // Smart designability gate (CLAUDE.md §53).
  //
  // Path 1 — PAC-driven: product has at least one print_area_coordinates
  // entry across all positions. Existing behaviour. DesignerV2 renders
  // the blue dashed PAC rect at the supplier-provided coordinates.
  //
  // Path 2 — heuristic recognition (bucket-(a) relaxation): product
  // has zero PAC anywhere BUT at least one position whose name
  // canonicalises to a known entry in RECOGNISED_POSITIONS (e.g.
  // "Front", "Wrap", "Barrel - Side 1"). DesignerV2 renders the product
  // photo without a rect, with the amber disclaimer banner and the
  // export watermark.
  //
  // Products that satisfy neither path stay hidden and surface the
  // "Need help with artwork?" link below.
  const isDesignable = useMemo(() => {
    const groups = product?.printDetails?.positionGroups || [];
    const hasPac = groups.some((g) =>
      (g.rows || []).some((r) => (r.coordinates?.length || 0) > 0),
    );
    if (hasPac) return true;
    return isBucketADesignable(groups);
  }, [product?.printDetails]);

  const baseTier = useMemo(
    () => pickTier(product?.pricingTiers || [], quantity),
    [product?.pricingTiers, quantity],
  );

  // Per-position cost contribution at current qty. Each enabled position
  // adds the tier's customer-facing all-in margined unit price (setup
  // amortisation + margin baked at sync time per CLAUDE.md §46).
  //
  // CRITICAL (CLAUDE.md §46 R6): tier.allInUnitPrice now contains
  // setup_amortised AND margin. Do NOT re-add setup_charge / setupPerUnit
  // here — that would double-bill setup. The legacy fallback path that
  // added setup separately has been removed in Stage 1.
  const positionContributions = useMemo(() => {
    const groups = product?.printDetails?.positionGroups || [];
    const out = [];
    groups.forEach((g) => {
      const pick = positionPicks[g.name];
      if (!pick?.enabled) return;
      const row = g.rows[pick.selectedRowIndex] || g.rows[g.defaultRowIndex] || g.rows[0];
      if (!row) return;
      const tier = pickPrintTier(row.tiers, quantity, pick.colours);
      const label = `${g.name} (${printMethodLabel(row)})`;
      if (!tier) {
        out.push({
          name: g.name, label, row, colours: pick.colours,
          unit: null, isPoa: true,
        });
        return;
      }
      const unit = tier.allInUnitPrice != null ? Number(tier.allInUnitPrice) : null;
      out.push({
        name: g.name,
        label,
        row,
        colours: pick.colours,
        unit,
        rawUnit: tier.rawPrice ?? tier.price,
        tier,
        isPoa: !!tier.isPoa,
      });
    });
    return out;
  }, [product, positionPicks, quantity]);

  const basePrice = baseTier?.pricePerUnit ?? null;
  const printPerUnitTotal = positionContributions.reduce(
    (acc, p) => acc + (p.unit || 0),
    0,
  );
  const isAnyPoa = baseTier?.isPoa || positionContributions.some((p) => p.isPoa);

  // UK STANDARD delivery share at the customer's actual quantity, with
  // margin applied to the delivery share at the customer's qty rate.
  // Per Dave's decision B1-A: delivery is a READ-TIME concern; sync-stored
  // sell_price does NOT include delivery. CLAUDE.md §46.
  //
  // Delivery is 0 when shipping_charges is empty (PGifts Direct mirror
  // rows) or quantity is invalid — the customer-facing unit price then
  // collapses cleanly to (product + print) with no delivery line.
  const deliveryUnitWithMargin = useMemo(() => {
    if (isAnyPoa || basePrice == null) return 0;
    if (!Number.isFinite(quantity) || quantity <= 0) return 0;
    const total = deliveryPerUnit(
      product?.shippingCharges,
      product?.piecesPerCarton,
      quantity,
      'ukstandard',
    );
    if (!Number.isFinite(total) || total <= 0) return 0;
    const marginPct = scheduleMarginForTier(quantity, product?.marginPctOverride ?? null);
    return Number((total * (1 + marginPct)).toFixed(4));
  }, [product?.shippingCharges, product?.piecesPerCarton, product?.marginPctOverride, quantity, isAnyPoa, basePrice]);

  // Round to 2dp at the source. Every downstream price column —
  // quote_items.unit_price, order_items.unit_price, order_items.line_total,
  // quotes.total_amount, orders.total_amount — is numeric(10,2) and
  // silently truncates anything finer on INSERT. If unitPrice is computed
  // at 4dp here, the displayed totalPrice (quantity × precise unitPrice,
  // rounded at display) and the Stripe-charged total (quantity ×
  // 2dp-truncated unit_price, recomputed by recompute_quote_total trigger)
  // drift apart by up to a few pence per order. The customer sees one
  // total on screen and gets charged a different one. See CLAUDE.md §48.
  const unitPrice = basePrice == null || isAnyPoa
    ? null
    : Number((basePrice + printPerUnitTotal + deliveryUnitWithMargin).toFixed(2));
  const totalPrice = unitPrice == null ? null : Number((unitPrice * quantity).toFixed(2));

  const isOrderValid = () => {
    if (quantity < minQty) return false;
    return basePrice != null && !isAnyPoa;
  };

  // ----- Handlers -----
  const handleQuantityChange = (n) => {
    if (!Number.isFinite(n)) return;
    const next = Math.max(minQty, Math.floor(n));
    setQuantity(next);
    setQuantityInput(String(next));
  };
  const handleQuantityBlur = () => {
    const parsed = parseInt(quantityInput, 10);
    if (!Number.isFinite(parsed) || parsed < minQty) {
      setQuantity(minQty);
      setQuantityInput(String(minQty));
    } else {
      setQuantity(parsed);
      setQuantityInput(String(parsed));
    }
  };

  const togglePosition = (name) =>
    setPositionPicks((p) => ({
      ...p,
      [name]: {
        ...(p[name] || { selectedRowIndex: 0, colours: 1 }),
        enabled: !p[name]?.enabled,
      },
    }));
  const setPositionColours = (name, colours) =>
    setPositionPicks((p) => ({
      ...p,
      [name]: {
        ...(p[name] || { enabled: true, selectedRowIndex: 0 }),
        colours,
      },
    }));
  // When the customer changes the size/method dropdown for an enabled
  // position, reset colour count to the first available count of the
  // new row (different print methods support different colour counts).
  const setSelectedRowIndex = (name, selectedRowIndex) =>
    setPositionPicks((p) => {
      const group = (product?.printDetails?.positionGroups || []).find((g) => g.name === name);
      const newRow = group?.rows?.[selectedRowIndex];
      const firstColour = availableColourCounts(newRow)[0] || 1;
      return {
        ...p,
        [name]: {
          ...(p[name] || { enabled: true }),
          selectedRowIndex,
          colours: firstColour,
        },
      };
    });

  const handleAddToQuote = async () => {
    if (!user) {
      alert('Please sign in to add items to a quote.');
      return;
    }
    if (!product || unitPrice == null) {
      alert('Quote cannot be created — pricing unavailable.');
      return;
    }
    setAddingToQuote(true);
    try {
      const quoteNumber = `QT-${Date.now().toString(36).toUpperCase()}`;
      // Structured payload for quote_items.print_areas (jsonb column).
      // Envelope-wrapped so future fields (total_setup_charge, version,
      // etc.) can be added without re-shaping consumers. CLAUDE.md §43.
      const printAreasPayload = positionContributions.length > 0
        ? {
            selections: positionContributions.map((p) => ({
              position: p.name,
              area: p.row?.area || null,
              type: p.row?.printType || null,
              class: p.row?.printClass || null,
              num_colours: p.colours,
              unit_price: p.unit != null ? +p.unit.toFixed(4) : null,
            })),
          }
        : null;

      const { data: quote, error: quoteError } = await supabase
        .from('quotes')
        .insert({
          quote_number: quoteNumber,
          customer_id: user.id,
          status: 'draft',
          total_amount: +(unitPrice * quantity).toFixed(2),
        })
        .select()
        .single();
      if (quoteError) throw quoteError;

      const { error: itemError } = await supabase
        .from('quote_items')
        .insert({
          quote_id: quote.id,
          product_id: null, // Laltex products aren't in catalog_products
          product_name: product.name,
          quantity,
          unit_price: +unitPrice.toFixed(4),
          color: selectedColour?.name || null,
          print_areas: printAreasPayload,
          notes: `Supplier: ${product.supplier} | Code: ${product.code}`,
        })
        .select()
        .single();
      if (itemError) throw itemError;

      setQuoteSuccess({
        quoteNumber,
        productName: product.name,
        unitPrice: unitPrice.toFixed(2),
        quantity,
      });
      window.dispatchEvent(new Event('quoteCountChanged'));
    } catch (err) {
      console.error('[Laltex AddToQuote] error:', err);
      alert(`Error adding to quote: ${err.message}`);
    } finally {
      setAddingToQuote(false);
    }
  };

  // ----- Render -----
  if (!product) return null;

  const visibleColours = showAllColours ? product.colours : product.colours.slice(0, 8);

  return (
    <div className="bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate(-1)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <h1 className="text-xl font-bold text-gray-900">Back to Products</h1>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setIsLiked(!isLiked)}
                className={`p-3 rounded-full transition-all duration-300 ${
                  isLiked
                    ? 'bg-red-500 text-white shadow-lg shadow-red-500/25'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <Heart className={`h-5 w-5 ${isLiked ? 'fill-current' : ''}`} />
              </button>
              <button className="p-3 bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200 transition-colors">
                <Share2 className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-4">
        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-4 lg:gap-5">
          {/* Image hero */}
          <div className="lg:col-span-5 w-full">
            <div className="lg:sticky lg:top-24">
              <button
                type="button"
                onClick={() => heroImage && setLightboxOpen(true)}
                disabled={!heroImage}
                aria-label="View larger image"
                className={`bg-gradient-to-br from-gray-100 to-gray-200 rounded-3xl p-6 mb-4 max-h-[520px] aspect-square w-full flex items-center justify-center relative overflow-hidden group ${
                  heroImage ? 'cursor-zoom-in' : 'cursor-default'
                }`}
              >
                {heroImage ? (
                  <img
                    src={heroImage}
                    alt={`${product.name}${selectedColour ? ` in ${selectedColour.name}` : ''}`}
                    className="max-w-full max-h-full object-contain transform transition-all duration-700 group-hover:scale-110 relative z-10"
                  />
                ) : (
                  <div className="text-9xl">📦</div>
                )}
              </button>

              {/* Plain-image thumbnail strip (Laltex's PlainImages, when present) */}
              {selectedColour?.plainImages?.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {selectedColour.plainImages.slice(0, 6).map((url, i) => (
                    <button
                      key={i}
                      onClick={() => setColourGalleryUrl(url)}
                      className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 flex-shrink-0"
                    >
                      <img src={url} alt="" className="w-full h-full object-contain" />
                    </button>
                  ))}
                </div>
              )}

              {/* Customize panel — mirrors PGifts Direct's left-column
                  layout (ProductDetailPage.jsx ~L1325). Sits inside the
                  sticky wrapper so it scrolls alongside the image hero.
                  Hidden when the product has zero print_area_coordinates
                  across all positions (no preview to render). Route:
                  /design/<code> — case-sensitive in PostgREST but
                  productCatalogService.getSupplierProductByCode handles
                  either case per CLAUDE.md §33; we send the code as
                  stored (uppercase for Laltex). */}
              {isDesignable && (
                <div className="mt-3 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200/50 shadow-lg">
                  <div className="flex items-center space-x-3 mb-3">
                    <div className="bg-gradient-to-br from-blue-500 to-indigo-600 w-10 h-10 rounded-lg flex items-center justify-center shadow-md">
                      <Palette className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900">Customize This Product</h3>
                      <p className="text-sm text-gray-600">Add your logo & design</p>
                    </div>
                  </div>
                  <button
                    onClick={() => navigate(`/design/${product.code}`)}
                    className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white py-2 px-4 rounded-lg font-semibold hover:from-blue-600 hover:to-indigo-700 transition-all duration-300 shadow-md hover:shadow-lg transform hover:scale-105"
                  >
                    Open Designer
                  </button>
                </div>
              )}
              {!isDesignable && (
                <p className="mt-3 text-center text-sm text-gray-500">
                  Need help with artwork?{' '}
                  <a
                    href={`mailto:artwork@promo-gifts.co?subject=Artwork%20help%20-%20${encodeURIComponent(product.code)}`}
                    className="text-blue-600 hover:underline"
                  >
                    Get in touch
                  </a>
                  .
                </p>
              )}
            </div>
          </div>

          {/* Middle column: info */}
          <div className="lg:col-span-4 w-full space-y-4">
            <div>
              <div className="flex items-start justify-between gap-2">
                <h1 className="text-3xl font-extrabold text-gray-900">{product.name}</h1>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-600">
                {product.category && (
                  <span className="px-2 py-0.5 bg-gray-100 rounded-full">
                    {product.category}
                    {product.subCategory ? ` › ${product.subCategory}` : ''}
                  </span>
                )}
                {product.productIndicator && (
                  <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded-full font-medium">
                    {product.productIndicator}
                  </span>
                )}
                <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">
                  Code: {product.code}
                </span>
              </div>
            </div>

            {product.description && (
              <p className="text-gray-700 leading-relaxed">{product.description}</p>
            )}

            {/* Colour swatches (image-based — Laltex has no hex) */}
            {product.colours.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700">
                    Available Colours ({product.colours.length})
                  </h3>
                  {selectedColour && (
                    <span className="text-xs text-gray-500">{selectedColour.name}</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {visibleColours.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelectedColourId(c.id);
                        setColourGalleryUrl(null);
                      }}
                      className={`w-14 h-14 rounded-lg border-2 overflow-hidden bg-white transition-all ${
                        c.id === selectedColourId
                          ? 'border-blue-500 shadow-md scale-105'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      title={c.name}
                    >
                      {c.images?.[0] ? (
                        <img
                          src={c.images[0]}
                          alt={c.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : c.hex ? (
                        <span
                          className="block w-full h-full"
                          style={{ backgroundColor: c.hex }}
                        />
                      ) : (
                        <span className="block w-full h-full bg-gray-200" />
                      )}
                    </button>
                  ))}
                </div>
                {product.colours.length > 8 && (
                  <button
                    onClick={() => setShowAllColours((v) => !v)}
                    className="mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    {showAllColours
                      ? 'Show fewer'
                      : `Show all ${product.colours.length} colours`}
                  </button>
                )}
              </div>
            )}

            {/* Tabs */}
            <div>
              <div className="flex gap-2 border-b border-gray-200">
                {['details', 'specs', 'lead'].map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveTab(t)}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      activeTab === t
                        ? 'text-blue-600 border-b-2 border-blue-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {t === 'details'
                      ? 'Details'
                      : t === 'specs'
                        ? 'Specifications'
                        : 'Lead Time'}
                  </button>
                ))}
              </div>

              {activeTab === 'details' && (
                <div className="pt-4 space-y-3 text-sm text-gray-700">
                  <div className="flex items-center gap-3 text-gray-600">
                    <Shield className="h-4 w-4 text-blue-500 flex-shrink-0" />
                    <span className="font-medium">Premium quality</span>
                  </div>
                  {product.expressAvailable && (
                    <div className="flex items-center gap-3 text-gray-600">
                      <Zap className="h-4 w-4 text-amber-500 flex-shrink-0" />
                      <span className="font-medium">Express turnaround available</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-gray-600">
                    <Truck className="h-4 w-4 text-purple-500 flex-shrink-0" />
                    <span className="font-medium">Free UK delivery</span>
                  </div>
                </div>
              )}

              {activeTab === 'specs' && (
                <div className="pt-4 space-y-2 text-sm">
                  {product.material && (
                    <div className="flex justify-between py-2 border-b border-gray-100">
                      <span className="text-gray-600">Material</span>
                      <span className="font-semibold text-gray-900">{product.material}</span>
                    </div>
                  )}
                  {product.productDims && (
                    <div className="flex justify-between py-2 border-b border-gray-100">
                      <span className="text-gray-600">Dimensions</span>
                      <span className="font-semibold text-gray-900">{product.productDims}</span>
                    </div>
                  )}
                  {product.countryOfOrigin && (
                    <div className="flex justify-between py-2 border-b border-gray-100">
                      <span className="text-gray-600">Country of origin</span>
                      <span className="font-semibold text-gray-900">{product.countryOfOrigin}</span>
                    </div>
                  )}
                  {product.minimumOrderQty != null && (
                    <div className="flex justify-between py-2 border-b border-gray-100">
                      <span className="text-gray-600">Minimum order</span>
                      <span className="font-semibold text-gray-900">{product.minimumOrderQty} units</span>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'lead' && (
                <div className="pt-4 space-y-3 text-sm text-gray-700">
                  {product.leadTimeDays != null ? (
                    <p>
                      Standard lead time: <span className="font-semibold">{product.leadTimeDays} working days</span> from artwork approval.
                    </p>
                  ) : (
                    <p>Standard lead time confirmed at quote stage.</p>
                  )}
                  {/* Deduplicate by (position name, method label, lead time)
                      so we don't render the same row twice when Laltex
                      surfaces two identical print methods. Multiple
                      embroidery sizes have distinct method labels and
                      survive dedup. */}
                  {(() => {
                    // Flatten positionGroups → rows for the "methods available"
                    // summary block. Same dedup semantics as the legacy code:
                    // collapse rows that share (position, method, lead time)
                    // so we don't list the same row twice.
                    const groups = product.printDetails?.positionGroups || [];
                    const seen = new Set();
                    const rows = [];
                    groups.forEach((g) => {
                      (g.rows || []).forEach((r, ri) => {
                        const method = printMethodLabel(r);
                        const lead = r.leadTime || 'See product details';
                        const dedupKey = `${g.name}|${method}|${lead}`;
                        if (seen.has(dedupKey)) return;
                        seen.add(dedupKey);
                        rows.push({ key: `${g.name}-${ri}`, name: g.name, method, lead });
                      });
                    });
                    return rows.map((r) => (
                      <p key={r.key} className="text-xs text-gray-500">
                        <span className="font-medium text-gray-700">
                          {r.name}
                          {r.method && r.method !== r.name && (
                            <> — {r.method}</>
                          )}
                          :
                        </span>{' '}
                        {r.lead}
                      </p>
                    ));
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* Right column: Configure & Quote */}
          <div className="lg:col-span-3 w-full">
            <div className="lg:sticky lg:top-24">
              <div className="bg-white rounded-3xl shadow-xl border border-gray-200/50 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-blue-700 text-white p-4">
                  <h3 className="font-bold text-lg mb-0.5">Configure & Quote</h3>
                  <p className="text-blue-100 text-xs">Pricing includes setup</p>
                </div>

                <div className="p-4 space-y-4">
                  {/* Quantity */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">Quantity</label>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleQuantityChange(quantity - 1)}
                        className="w-9 h-9 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors border border-gray-200"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        type="text"
                        value={quantityInput}
                        onChange={(e) => setQuantityInput(e.target.value)}
                        onBlur={handleQuantityBlur}
                        onKeyDown={(e) => e.key === 'Enter' && handleQuantityBlur()}
                        className="w-20 h-9 text-center border border-gray-300 rounded-lg font-semibold text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <button
                        onClick={() => handleQuantityChange(quantity + 1)}
                        className="w-9 h-9 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors border border-gray-200"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2 text-center">
                      Minimum order: {minQty} units
                    </p>
                  </div>

                  {/* Print positions — one row per UNIQUE position, with
                      a size/method dropdown to choose among sibling rows
                      that share the position. Each position is independently
                      tickable; same-position duplication is impossible by
                      design (one dropdown per position). Session 9 / §43. */}
                  {(product.printDetails?.positionGroups || []).length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">Print Positions</h4>
                      <div className="space-y-2">
                        {product.printDetails.positionGroups.map((group) => {
                          const pick = positionPicks[group.name] || {
                            enabled: false, selectedRowIndex: group.defaultRowIndex, colours: 1,
                          };
                          const selectedRow = group.rows[pick.selectedRowIndex] || group.rows[0];
                          const colourOptions = availableColourCounts(selectedRow);
                          const methodLabel = printMethodLabel(selectedRow);
                          const sizeLabel = selectedRow?.area || null;
                          return (
                            <div
                              key={group.name}
                              className={`border rounded-lg p-2 transition-colors ${
                                pick.enabled
                                  ? 'border-blue-400 bg-blue-50/50'
                                  : 'border-gray-200'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <label className="flex items-start gap-2 cursor-pointer flex-1 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={pick.enabled}
                                    onChange={() => togglePosition(group.name)}
                                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0 mt-0.5"
                                  />
                                  {/* Two-line label: position name on top,
                                      currently-selected size + method below
                                      in smaller muted text. The dropdown
                                      below the row controls which sibling
                                      row is active. */}
                                  <span className="flex flex-col min-w-0 leading-tight">
                                    <span className="text-sm font-medium text-gray-800 truncate">
                                      {group.name}
                                    </span>
                                    {(sizeLabel || methodLabel) && (
                                      <span className="text-xs text-slate-500 truncate">
                                        {sizeLabel}
                                        {sizeLabel && methodLabel ? ' — ' : ''}
                                        {methodLabel !== group.name ? methodLabel : ''}
                                      </span>
                                    )}
                                  </span>
                                </label>
                                {pick.enabled && colourOptions.length > 1 && (
                                  <select
                                    value={pick.colours}
                                    onChange={(e) =>
                                      setPositionColours(group.name, parseInt(e.target.value, 10))
                                    }
                                    className="border border-gray-300 rounded text-xs py-0.5 px-1 flex-shrink-0 self-center"
                                  >
                                    {colourOptions.map((n) => (
                                      <option key={n} value={n}>{n} col{n > 1 ? 's' : ''}</option>
                                    ))}
                                  </select>
                                )}
                                {pick.enabled && colourOptions.length === 1 && (
                                  <span className="text-xs text-gray-500 flex-shrink-0 self-center">
                                    {colourOptions[0]} col{colourOptions[0] > 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>
                              {/* Size/method dropdown — only when this
                                  position has multiple rows AND is enabled.
                                  Hidden for single-row positions to keep the
                                  UI tidy. */}
                              {pick.enabled && group.rows.length > 1 && (
                                <div className="mt-2 pl-6">
                                  <select
                                    value={pick.selectedRowIndex}
                                    onChange={(e) =>
                                      setSelectedRowIndex(group.name, parseInt(e.target.value, 10))
                                    }
                                    className="w-full border border-gray-300 rounded text-xs py-1 px-1.5"
                                  >
                                    {group.rows.map((r, ri) => {
                                      const tier = pickPrintTier(r.tiers, quantity, availableColourCounts(r)[0] || 1);
                                      const priceLabel = tier?.allInUnitPrice != null
                                        ? formatGBP(tier.allInUnitPrice)
                                        : tier?.price != null
                                          ? formatGBP(tier.price)
                                          : 'POA';
                                      return (
                                        <option key={ri} value={ri}>
                                          {printMethodLabel(r)}
                                          {r.area ? ` – ${r.area}` : ''}
                                          {' – '}{priceLabel}/unit
                                        </option>
                                      );
                                    })}
                                  </select>
                                </div>
                              )}
                              {pick.enabled && selectedRow?.setupCharge != null && (
                                <p className="text-xs text-gray-500 mt-1 pl-6">
                                  Price includes set up
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Price */}
                  <div className="text-center p-6 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl">
                    {unitPrice == null ? (
                      <div>
                        <div className="text-lg font-bold text-gray-700">Price on application</div>
                        <p className="text-xs text-gray-500 mt-2">
                          Contact us for a tailored quote on this configuration.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="mb-2">
                          <span className="text-sm text-gray-600">Price per unit</span>
                        </div>
                        <div className="text-3xl font-bold text-blue-600">
                          {formatGBP(unitPrice)}
                        </div>
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">Total:</span>
                            <span className="text-2xl font-bold text-gray-900">
                              {formatGBP(totalPrice || 0)}
                            </span>
                          </div>
                          {(positionContributions.length > 0 || deliveryUnitWithMargin > 0) && (
                            <div className="mt-2 text-xs text-gray-500 space-y-0.5">
                              {basePrice != null && (
                                <div className="flex justify-between">
                                  <span>Product</span>
                                  <span>{formatGBP(basePrice)}</span>
                                </div>
                              )}
                              {positionContributions.map((p) => (
                                <div key={p.name} className="flex justify-between">
                                  <span className="truncate pr-2">
                                    {p.label} ({p.colours} col)
                                  </span>
                                  <span className="flex-shrink-0">
                                    {p.unit == null ? 'POA' : formatGBP(p.unit)}
                                  </span>
                                </div>
                              ))}
                              {deliveryUnitWithMargin > 0 && (
                                <div className="flex justify-between">
                                  <span>UK delivery</span>
                                  <span>{formatGBP(deliveryUnitWithMargin)}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* CTAs */}
                  <div className="space-y-3">
                    <button
                      onClick={handleAddToQuote}
                      disabled={!isOrderValid() || addingToQuote}
                      className={`w-full py-4 rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 flex items-center justify-center space-x-2 ${
                        !isOrderValid() || addingToQuote
                          ? 'bg-gray-300 cursor-not-allowed text-gray-500'
                          : 'bg-gradient-to-r from-blue-600 via-purple-600 to-blue-700 text-white hover:from-blue-700 hover:via-purple-700 hover:to-blue-800'
                      }`}
                    >
                      {addingToQuote ? (
                        <>
                          <Loader className="h-5 w-5 animate-spin" />
                          <span>Adding...</span>
                        </>
                      ) : (
                        <>
                          <ShoppingCart className="h-5 w-5" />
                          <span>
                            {unitPrice == null ? 'Request Quote' : 'Add to Quote'}
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <p className="mt-3 text-center text-xs text-gray-600">
                Questions?{' '}
                <a href="tel:01844600900" className="font-semibold text-blue-600 hover:text-blue-700">
                  Call 01844 600900
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox modal — minimal, dependency-free. Backdrop click and
          the × button close it; the ESC handler lives in the lightbox
          useEffect above (also locks body scroll while open). */}
      {lightboxOpen && heroImage && (
        <div
          className="fixed inset-0 z-[200] bg-black/75 flex items-center justify-center p-4"
          onClick={() => setLightboxOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Larger product image"
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightboxOpen(false); }}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 hover:bg-white text-gray-800 flex items-center justify-center shadow-lg z-10"
            aria-label="Close larger image"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={heroImage}
            alt={`${product.name}${selectedColour ? ` in ${selectedColour.name}` : ''} (enlarged)`}
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Quote Success Modal — same shape as ProductDetailPage so the UX
          feels consistent across catalog vs supplier products. */}
      {quoteSuccess && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-8 text-center">
            <div className="mb-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <Check className="h-8 w-8 text-green-600" />
              </div>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Added to Quotes</h3>
            <p className="text-gray-600 mb-4">Quote {quoteSuccess.quoteNumber}</p>
            <div className="bg-gray-50 rounded-lg p-4 mb-6 text-sm">
              <p className="font-semibold text-gray-900">{quoteSuccess.productName}</p>
              <p className="text-gray-600">
                {quoteSuccess.quantity} units @ £{quoteSuccess.unitPrice} each
              </p>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setQuoteSuccess(null);
                  navigate('/account/quotes');
                }}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
              >
                View My Quotes
              </button>
              <button
                onClick={() => setQuoteSuccess(null)}
                className="flex-1 px-4 py-3 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
              >
                Continue Shopping
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LaltexProductView;
