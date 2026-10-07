import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Zap, FileCheck, Clock, Loader } from 'lucide-react';
import { supabase } from '../services/supabaseService';
import { getCuratedCategoryProducts } from '../services/productCatalogService';
import AvaPromptCard from './AvaPromptCard';
import { formatGBP } from '../utils/currency';

// ---------------------------------------------------------------------------
// CategoryPage — shared component rendered by all 11 category routes
// (BagsCategory, CablesCategory, …). Each route passes its `categorySlug`.
//
// Curation layer (CLAUDE.md §56): the Ava widget + curated Laltex grid +
// Load more button are DATA-GATED on `category_product_curation` having
// rows for the current slug. Categories without curation rows render the
// existing PGifts Direct surface unchanged. Adding a new category is
// seed-only: INSERT rows into `category_product_curation` (and add an
// entry to AVA_COPY below); no JSX changes needed.
//
// Hard rules (do not break):
//   - The new sections MUST be conditional on `hasCuration`.
//   - The curation fetch failure mode MUST be graceful — set
//     curatedProducts to [] and let the existing path render normally.
//   - `getCuratedCategoryProducts` already excludes retired products
//     (CLAUDE.md §51). Don't bypass.
//   - Use `plain_images[0]` for the Laltex thumbnail, not `images[0]`
//     (CLAUDE.md §50.2 — ItemImages may carry mockup branding).
// ---------------------------------------------------------------------------

// Per-category Ava copy, keyed by `categorySlug` (CLAUDE.md §65.7).
//   - examples       → 2–3 example prompts, written as real customer needs.
//                      Each one was run through Ava before shipping and kept only
//                      if she answered it accurately (MOQs, prices, no invented
//                      claims). Re-check them when you change one.
//   - welcomeMessage → first assistant message when the chat opens.
const AVA_COPY = {
  'bags': {
    examples: [
      '200 tote bags for a trade show, one-colour logo, under £3 each',
      'Recycled cotton bags for a charity fun run, around 300',
      'Sturdy canvas bags for a bookshop, 100 with a full-colour design',
    ],
    welcomeMessage:
      "Hi! What kind of bag are you looking for? Let me know your budget, quantity, or any specific features (cotton, jute, recycled, branded, drawstring…).",
  },
  'cables': {
    examples: [
      '50 charging cables for a work event, full-colour logo on one side',
      'Eco-friendly charging cables for 200 sustainability conference delegates',
      'A charging cable under £5 each that people will actually keep',
    ],
    welcomeMessage:
      "Hi! What kind of cable are you looking for? Let me know your quantity, output requirements (USB-A, USB-C, multi-port), or any specific features (recycled materials, with keyring, branded…).",
  },
  'clothing': {
    examples: [
      'T-shirts for 40 event staff with a one-colour logo on the front',
      'Polo shirts for a 15-person hospitality team, logo on the chest',
      'Hoodies for a sports club, about 60, under £20 each',
    ],
    welcomeMessage:
      "Hi! What kind of clothing are you looking for? Let me know your budget, quantity, garment type (polo, t-shirt, hoodie, jacket…), or any specific features.",
  },
  'cups': {
    examples: [
      'Travel mugs for 250 conference delegates, under £7 each',
      'Reusable coffee cups with our logo for 100 staff',
      'Full-colour ceramic mugs for 50 client gifts',
    ],
    welcomeMessage:
      "Hi! What kind of cup are you looking for? Let me know your budget, quantity, or any specific features (metal, ceramic, ceramic with handle, full-wrap print…).",
  },
  'hi-vis': {
    examples: [
      'Hi-vis vests with our logo for 30 event marshals',
      'Reflective high-visibility bags for a school road-safety campaign, 200',
    ],
    welcomeMessage:
      "Hi! What kind of hi-vis item are you after? Let me know your quantity and use case (event staff, construction, charity walk…).",
  },
  'notebooks': {
    examples: [
      'A5 notebooks for 100 conference delegates, logo on the cover',
      'Recycled notebooks under £3 each, around 250',
      'A6 pocket notebooks for an exhibition giveaway, 500',
    ],
    welcomeMessage:
      "Hi! What kind of notebook are you looking for? Let me know your size (A4, A5, A6), budget, quantity, or any specific features (recycled, with pen, gift sets, hardback…).",
  },
  'pens': {
    examples: [
      '500 pens for a trade show, under £1 each',
      'Recycled pens for an eco campaign, around 1,000',
      'Premium pens for 50 client gifts, around £5 each',
    ],
    welcomeMessage:
      "Hi! What kind of pen are you looking for? Let me know your budget, quantity, or any specific features (recycled, metal, gift sets, pencils, fountain pens…).",
  },
  'power': {
    examples: [
      'Power banks for 100 conference delegates, under £15 each',
      'Eco-friendly power bank for a sustainability event, about 200',
      'A premium travel gift for 25 senior clients',
    ],
    welcomeMessage:
      "Hi! What kind of power product are you looking for? Power banks, wireless chargers, USB drives? Let me know your budget, quantity, or any specific features.",
  },
  'speakers': {
    examples: [
      'Bluetooth speakers for 50 client gifts, under £15 each',
      'Portable speakers for a summer festival giveaway, 200',
    ],
    welcomeMessage:
      "Hi! What kind of speaker are you looking for? Let me know your budget, quantity, or any specific features (Bluetooth range, waterproof, mini portable, premium audio…).",
  },
  'tea-towels': {
    examples: [
      'Tea towels with a full-colour design for a charity fundraiser, 100',
      'Tea towels for a museum gift shop, 250, printed edge to edge with our illustration',
    ],
    welcomeMessage:
      "Hi! Tell me how many tea towels you need, what they're for and your design, and I'll recommend the right option and price it for you.",
  },
  'water-bottles': {
    examples: [
      'Metal water bottles for 150 staff, logo printed, under £8 each',
      'Recycled plastic sports bottles for a fun run, 500',
      'Full-wrap printed bottles with our artwork, 1,000',
    ],
    welcomeMessage:
      "Hi! What kind of water bottle are you looking for? Let me know your budget, quantity, or any specific features (metal, recycled, with a logo on the lid…).",
  },
};

function resolveAvaCopy(categorySlug, categoryName) {
  const explicit = AVA_COPY[categorySlug];
  if (explicit) return explicit;
  const lowerSingular = (categoryName || categorySlug || 'products').toString().toLowerCase();
  return {
    examples: [],
    welcomeMessage: `Hi! What kind of ${lowerSingular} are you looking for?`,
  };
}

// Initial visible count + Load-more step. CLAUDE.md §56 invariant —
// don't raise without a fresh decision; the 4×4 grid is the visual
// contract and the per-step reveal matches the §55 chat pagination
// rhythm.
const CURATED_INITIAL_VISIBLE = 16;
// Feature strip: lead times above this (working days) count as "longer".
const FAST_LEAD_MAX_WORKING_DAYS = 10;

// Image URLs for a curated card, in display order (colour 0 plain image first,
// CLAUDE.md §50.2). When scripts/check-curated-images.mjs has checked the row,
// its verified image leads (or the card is hidden if none worked); otherwise
// the card walks this list on load errors and is hidden when none load (§65.7).
function curatedImageCandidates({ normalised, cardImageUrl, cardImageChecked }) {
  if (cardImageChecked && !cardImageUrl) return [];
  const colours = normalised?.colours || [];
  const urls = [
    ...colours.flatMap((c) => [...(c?.plainImages || []), ...(c?.images || [])]),
    ...(normalised?.images || []).map((i) => i?.url),
  ].filter(Boolean);
  return [...new Set(cardImageUrl ? [cardImageUrl, ...urls] : urls)];
}

// Calendar days -> working days (PGifts Direct lead times are calendar days, §65.2).
const toWorkingDays = (calendarDays) => Math.ceil((Number(calendarDays) * 5) / 7);

function formatWeeksOrDays(minDays, maxDays) {
  const lo = minDays ?? maxDays;
  const hi = maxDays ?? minDays;
  const weeks = lo % 7 === 0 && hi % 7 === 0;
  const a = weeks ? lo / 7 : lo;
  const b = weeks ? hi / 7 : hi;
  const unit = weeks ? 'weeks' : 'days';
  return a === b ? `${a} ${unit}` : `${a}–${b} ${unit}`;
}

/**
 * The three feature boxes, derived from what this category actually sells so
 * every claim is true (owner, 9 Oct 2026). Returns an array of
 * { key, title, text } — the turnaround box is dropped when no product in the
 * category has a known lead time.
 */
function buildCategoryFeatures(products, curated) {
  const moqs = [];
  const leads = []; // working days
  const slowDirect = [];
  for (const p of products) {
    const tierMins = (p.catalog_pricing_tiers || []).map((t) => Number(t.min_quantity)).filter(Number.isFinite);
    const moq = tierMins.length ? Math.min(...tierMins) : Number(p.min_order_quantity);
    if (Number.isFinite(moq) && moq > 0) moqs.push(moq);
    if (p.lead_time_days_max != null) {
      const wd = toWorkingDays(p.lead_time_days_min ?? p.lead_time_days_max);
      leads.push(wd);
      if (toWorkingDays(p.lead_time_days_max) > FAST_LEAD_MAX_WORKING_DAYS) {
        slowDirect.push(`The ${p.name} takes ${formatWeeksOrDays(p.lead_time_days_min, p.lead_time_days_max)}.`);
      }
    }
  }
  let slowSupplier = false;
  for (const { normalised } of curated) {
    const moq = Number(normalised?.minimumOrderQty);
    if (Number.isFinite(moq) && moq > 0) moqs.push(moq);
    const lt = Number(normalised?.leadTimeDays);
    if (normalised?.leadTimeDays != null && Number.isFinite(lt)) {
      leads.push(lt);
      if (lt > FAST_LEAD_MAX_WORKING_DAYS) slowSupplier = true;
    }
  }

  const features = [];
  if (leads.length) {
    const fastest = Math.min(...leads);
    const atFastest = leads.filter((d) => d === fastest).length / leads.length;
    const lead = atFastest >= 0.25
      ? `Many items ready in ${fastest} working days from artwork approval.`
      : `Items from ${fastest} working days from artwork approval.`;
    const extra = [...slowDirect, slowSupplier ? 'Some take longer; the lead time is shown on each product.' : null]
      .filter(Boolean).join(' ');
    features.push({
      key: 'turnaround',
      title: fastest <= 7 ? 'Fast Turnaround' : 'Clear Lead Times',
      text: extra ? `${lead} ${extra}` : lead,
    });
  }
  features.push({
    key: 'proof',
    title: 'Proof Before Print',
    text: 'We send a visual proof for your approval before production starts.',
  });
  if (moqs.length) {
    const min = Math.min(...moqs);
    features.push({
      key: 'minimums',
      title: min <= 50 ? 'Low Minimums' : 'Minimum Orders',
      text: `Order quantities from ${min.toLocaleString('en-GB')} units`,
    });
  }
  return features;
}

const FEATURE_STYLE = {
  turnaround: { Icon: Zap, bg: 'bg-blue-100', fg: 'text-blue-600' },
  proof: { Icon: FileCheck, bg: 'bg-green-100', fg: 'text-green-600' },
  minimums: { Icon: Clock, bg: 'bg-purple-100', fg: 'text-purple-600' },
};
const CURATED_LOAD_MORE_STEP = 16;

const CategoryPage = ({ categorySlug }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState(null);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState(null);

  // Curated Laltex products (CLAUDE.md §56). Separate state + separate
  // fetch so the PGifts Direct rendering path stays untouched.
  const [curatedProducts, setCuratedProducts] = useState([]);
  const [visibleCuratedCount, setVisibleCuratedCount] = useState(CURATED_INITIAL_VISIBLE);
  // The feature strip is derived from BOTH pools, so it waits for the curated
  // fetch to settle (else e.g. /pens briefly shows only the Edge pens' 100 MOQ).
  const [curatedSettled, setCuratedSettled] = useState(false);

  useEffect(() => {
    fetchCategoryData();
  }, [categorySlug]);

  useEffect(() => {
    if (!categorySlug) return;
    let cancelled = false;
    setCuratedSettled(false);
    getCuratedCategoryProducts(categorySlug)
      .then((rows) => {
        if (cancelled) return;
        setCuratedProducts(rows);
        setVisibleCuratedCount(CURATED_INITIAL_VISIBLE); // reset on slug change
        setImageIndex({});
        setImagelessCodes(new Set());
        setCuratedSettled(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[CategoryPage] curated fetch failed:', err);
        setCuratedProducts([]); // graceful degrade — existing path unaffected
        setCuratedSettled(true);
      });
    return () => { cancelled = true; };
  }, [categorySlug]);

  // Image fallback (§65.7): index into each card's candidate list, and the
  // codes whose candidates all failed (hidden from the grid).
  const [imageIndex, setImageIndex] = useState({});
  const [imagelessCodes, setImagelessCodes] = useState(() => new Set());

  const hasCuration = curatedProducts.length > 0;
  const displayableCurated = useMemo(
    () => curatedProducts
      .map((item) => ({ ...item, imageCandidates: curatedImageCandidates(item) }))
      .filter((item) => item.imageCandidates.length > 0 && !imagelessCodes.has(item.code)),
    [curatedProducts, imagelessCodes],
  );
  const visibleCuratedProducts = useMemo(
    () => displayableCurated.slice(0, visibleCuratedCount),
    [displayableCurated, visibleCuratedCount],
  );
  const moreCuratedRemaining = displayableCurated.length - visibleCuratedCount;
  const categoryFeatures = useMemo(
    () => buildCategoryFeatures(products, displayableCurated),
    [products, displayableCurated],
  );

  const handleCuratedImageError = (code, candidateCount) => {
    setImageIndex((prev) => {
      const next = (prev[code] ?? 0) + 1;
      if (next >= candidateCount) {
        setImagelessCodes((s) => new Set(s).add(code));
      }
      return { ...prev, [code]: next };
    });
  };

  const fetchCategoryData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch category info
      const { data: categoryData, error: categoryError } = await supabase
        .from('catalog_categories')
        .select('*')
        .eq('slug', categorySlug)
        .single();

      if (categoryError) throw categoryError;
      if (!categoryData) throw new Error('Category not found');

      setCategory(categoryData);

      // Fetch products for this category
      const { data: productsData, error: productsError } = await supabase
        .from('catalog_products')
        .select(`
          *,
          catalog_product_images!inner(image_url, thumbnail_url, is_primary),
          catalog_pricing_tiers(min_quantity, price_per_unit)
        `)
        .eq('category_id', categoryData.id)
        .eq('status', 'active')
        .order('created_at', { ascending: true });

      if (productsError) throw productsError;

      // Process products to get lowest price and primary image
      const processedProducts = productsData.map(product => {
        // Get primary image or first image
        const primaryImage = product.catalog_product_images.find(img => img.is_primary)
          || product.catalog_product_images[0];

        // Get lowest price from pricing tiers
        const lowestPrice = product.catalog_pricing_tiers.length > 0
          ? Math.min(...product.catalog_pricing_tiers.map(tier => tier.price_per_unit))
          : null;

        return {
          ...product,
          primaryImage: primaryImage?.thumbnail_url || primaryImage?.image_url,
          lowestPrice
        };
      });

      setProducts(processedProducts);
    } catch (err) {
      console.error('Error fetching category data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <Loader className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading products...</p>
        </div>
      </div>
    );
  }

  if (error || !category) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg mb-4">Error loading category</p>
          <p className="text-gray-600 mb-6">{error || 'Category not found'}</p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-6">
          {/* Breadcrumb */}
          <div className="flex items-center space-x-2 text-sm text-gray-600 mb-4">
            <button
              onClick={() => navigate('/')}
              className="hover:text-blue-600 transition-colors"
            >
              Home
            </button>
            <ChevronRight className="h-4 w-4" />
            <span className="text-gray-900 font-semibold">{category.name}</span>
          </div>

          {/* Title */}
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">{category.name}</h1>
            <p className="text-lg text-gray-600">
              {category.description || `Premium branded ${category.name.toLowerCase()} for your promotional needs`}
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Ava advisor card — below the page title, ABOVE the feature strip,
            on every category (§65.7). Example prompts open the chat with the
            question already sent. */}
        {(() => {
          const avaCopy = resolveAvaCopy(categorySlug, category.name);
          return (
            <div className="mb-8">
              <AvaPromptCard examples={avaCopy.examples} welcomeMessage={avaCopy.welcomeMessage} />
            </div>
          );
        })()}

        {/* Feature strip — derived from this category's real minimums and lead
            times so every claim is true (§65.7). */}
        <div className={`grid grid-cols-1 ${categoryFeatures.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-6 mb-12 min-h-[96px]`}>
          {curatedSettled && categoryFeatures.map(({ key, title, text }) => {
            const { Icon, bg, fg } = FEATURE_STYLE[key];
            return (
              <div key={key} className="bg-white rounded-2xl p-6 shadow-md border border-gray-200 flex items-start space-x-4">
                <div className={`${bg} p-3 rounded-xl`}>
                  <Icon className={`h-6 w-6 ${fg}`} />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
                  <p className="text-sm text-gray-600">{text}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Unified products grid (CLAUDE.md §56).
            PGifts Direct products and curated Laltex products render in
            a single 4-column grid for visual continuity — no row break
            between the two pools, no empty cells. PGifts Direct cards
            come first (preserving the product's badge +
            full description), then Laltex cards append in curation
            order. Each card retains its own JSX treatment + click
            target (catalog slug route for PGifts Direct; /products/<code>
            for Laltex per §56.5).

            Grid classes match the pre-merge PGifts Direct values
            (md:grid-cols-2 lg:grid-cols-4 gap-8) precisely — the 10
            unseeded categories rendering changes nothing visually. The
            Laltex cards become visual citizens of the same grid rather
            than living in a separate row group below. */}
        {(products.length === 0 && !hasCuration) ? (
          <div className="text-center py-12">
            <p className="text-gray-600 text-lg">No products available in this category yet.</p>
            <p className="text-gray-500 text-sm mt-2">Check back soon for new items!</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              {products.map((product) => (
                <div
                  key={product.id}
                  className="group bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 cursor-pointer"
                  onClick={() => navigate(`/${categorySlug}/${product.slug}`)}
                >
                  {/* Product Image */}
                  <div className="relative aspect-square bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center p-8">
                    {product.primaryImage ? (
                      <img
                        src={product.primaryImage}
                        alt={product.name}
                        className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-300"
                      />
                    ) : (
                      <div className="text-8xl group-hover:scale-110 transition-transform duration-300">
                        📦
                      </div>
                    )}
                    {product.badge && (
                      <div className="absolute top-4 left-4 bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-semibold shadow-lg">
                        {product.badge}
                      </div>
                    )}
                  </div>

                  {/* Product Info */}
                  <div className="p-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">
                      {product.name}
                    </h3>
                    <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                      {product.short_description || product.description}
                    </p>

                    {/* Price */}
                    <div className="flex items-baseline justify-between mb-4">
                      <div>
                        {product.lowestPrice && (
                          <>
                            <span className="text-sm text-gray-500">From</span>
                            <span className="text-2xl font-bold text-green-600 ml-2">
                              {formatGBP(product.lowestPrice)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* View Details Button */}
                    <button
                      className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2 group-hover:shadow-lg"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/${categorySlug}/${product.slug}`);
                      }}
                    >
                      <span>View Details</span>
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Curated Laltex cards — appended into the SAME grid as
                  PGifts Direct cards so they flow continuously (no row
                  break, no empty cells). Card thumbnails read
                  plain_images[0] first per CLAUDE.md §50.2 (ItemImages
                  may carry mockup branding). Click routes to
                  /products/<code> (generic supplier route in App.jsx,
                  NOT /<categorySlug>/<slug> which is PGifts Direct
                  only). */}
              {hasCuration && visibleCuratedProducts.map(({ code, normalised, imageCandidates }) => {
                const thumb = imageCandidates[imageIndex[code] ?? 0] || null;
                // Normalised pricingTiers per productCatalogService.normaliseProduct:
                // each entry has { minQty, maxQty, pricePerUnit, isPoa, ... }.
                // pricePerUnit = sell_price (margin baked) with raw price fallback;
                // delivery share is read-time per LaltexProductView and not
                // included on the category-card "From £X.XX" line — the product
                // page is where the full inclusive price is shown.
                const lowestTier = Array.isArray(normalised?.pricingTiers) && normalised.pricingTiers.length > 0
                  ? normalised.pricingTiers
                      .filter((t) => t && !t.isPoa && Number.isFinite(Number(t.pricePerUnit)))
                      .reduce((min, t) => {
                        const p = Number(t.pricePerUnit);
                        return min == null || p < min ? p : min;
                      }, null)
                  : null;
                return (
                  <div
                    key={`laltex-${code}`}
                    className="group bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 cursor-pointer"
                    onClick={() => navigate(`/products/${encodeURIComponent(code)}`)}
                  >
                    <div className="relative aspect-square bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center p-6">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={normalised?.name || code}
                          className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-300"
                          loading="lazy"
                          onError={() => handleCuratedImageError(code, imageCandidates.length)}
                        />
                      ) : (
                        <div className="text-7xl group-hover:scale-110 transition-transform duration-300">📦</div>
                      )}
                    </div>
                    <div className="p-5">
                      <h3 className="text-lg font-bold text-gray-900 mb-1 line-clamp-2 group-hover:text-blue-600 transition-colors">
                        {normalised?.name || code}
                      </h3>
                      <p className="text-xs text-gray-500 mb-3">Code: {code}</p>
                      {lowestTier != null && (
                        <div className="flex items-baseline mb-4">
                          <span className="text-sm text-gray-500">From</span>
                          <span className="text-xl font-bold text-green-600 ml-2">{formatGBP(lowestTier)}</span>
                        </div>
                      )}
                      <button
                        className="w-full bg-blue-600 text-white py-2.5 rounded-xl font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2 group-hover:shadow-lg"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/products/${encodeURIComponent(code)}`);
                        }}
                      >
                        <span>View Details</span>
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* "Load more" lives BELOW the unified grid and reveals more
                Laltex cards (PGifts Direct is always fully shown above).
                Gated on hasCuration so unseeded categories don't render
                this. Pure client-side pagination per CLAUDE.md §56. */}
            {hasCuration && moreCuratedRemaining > 0 && (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisibleCuratedCount((n) =>
                    Math.min(n + CURATED_LOAD_MORE_STEP, displayableCurated.length))
                  }
                  className="px-8 py-3 rounded-xl bg-white border border-indigo-200 text-indigo-700 font-semibold hover:bg-indigo-50 hover:border-indigo-300 transition-colors shadow-sm"
                >
                  Load more ({moreCuratedRemaining} remaining)
                </button>
              </div>
            )}
          </>
        )}

        {/* Bottom CTA Section */}
        <div className="mt-16 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl p-12 text-center shadow-2xl">
          <h2 className="text-3xl font-bold text-white mb-4">
            Need Help Choosing?
          </h2>
          <p className="text-lg text-blue-100 mb-8 max-w-2xl mx-auto">
            Our team can help you select the perfect {category.name.toLowerCase()} for your promotional campaign
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button className="px-8 py-4 bg-white text-blue-600 rounded-xl font-semibold hover:bg-gray-100 transition-colors shadow-lg">
              Contact Sales
            </button>
            <button className="px-8 py-4 bg-transparent text-white border-2 border-white rounded-xl font-semibold hover:bg-white/10 transition-colors">
              Request Quote
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CategoryPage;
