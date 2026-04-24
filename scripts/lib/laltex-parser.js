/**
 * Pure parsing helpers for the Laltex feed.
 *
 * Extracted from session 1's sync-laltex-product.js so the batch sync
 * and the single-product debug script can share the same logic.
 *
 * All functions are deterministic, side-effect free, and work on raw
 * Laltex field values. Nothing here talks to Supabase or Laltex — that
 * keeps the transform surface easy to unit-test if we ever decide to.
 *
 * Key parsing rules (verified against Laltex V1.7 PDF + session 1 live test):
 *   - Prices are "£1.79" strings — strip "£" and parse numeric.
 *   - Price > £900 per Laltex docs means POA; store is_poa=true, price=null.
 *   - Pixel coordinates are "267.500px" — strip "px", parse numeric.
 *   - MaxQuantity "N/A" means open-ended top tier — store as null.
 *   - Diameter present -> shape='circle'; else 'rectangle'.
 *   - Feed shape: session 1 discovered the live API returns a bare
 *     [{...}] array while the PDF-linked sample is wrapped {value:[...]}.
 *     normaliseProduct's caller (laltex-sync.js) handles both shapes.
 */

// ---------------------------------------------------------------------------
// Scalar parsers
// ---------------------------------------------------------------------------

export const POA_THRESHOLD = 900;

/**
 * Parse a Laltex price string.
 * @param {string|number|null|undefined} raw
 * @returns {{ price: number|null, is_poa: boolean }}
 */
export function parsePriceString(raw) {
  if (raw == null) return { price: null, is_poa: false };
  const s = String(raw).trim();
  if (!s || s.toUpperCase() === 'N/A' || s.toUpperCase() === 'POA') {
    return { price: null, is_poa: s.toUpperCase() === 'POA' };
  }
  const cleaned = s.replace(/[£€$,\s]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { price: null, is_poa: false };
  if (isPOA(n)) return { price: null, is_poa: true };
  return { price: n, is_poa: false };
}

/**
 * @param {number} price
 * @returns {boolean}
 */
export function isPOA(price) {
  return Number.isFinite(price) && price > POA_THRESHOLD;
}

/**
 * Parse a pixel coordinate like "267.500px".
 * @param {string|number|null|undefined} raw
 * @returns {number|null}
 */
export function parseCoordinate(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s.replace(/px$/i, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a qty bound; "N/A" -> null (open-ended).
 * @param {string|number|null|undefined} raw
 * @returns {number|null}
 */
export function parseQtyBound(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s.toUpperCase() === 'N/A') return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse an integer where null/invalid defaults to 0 (for MinQuantity etc).
 * @param {string|number|null|undefined} raw
 * @returns {number}
 */
export function parseQtyRequired(raw) {
  const n = parseQtyBound(raw);
  return n == null ? 0 : n;
}

// ---------------------------------------------------------------------------
// Array transforms (raw Laltex shape -> our JSONB shape)
// ---------------------------------------------------------------------------

/**
 * @returns {Array<{min_qty:number, max_qty:number|null, price:number|null, is_poa:boolean, note:string|null}>}
 */
export function parseProductPricing(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((tier) => {
    const { price, is_poa } = parsePriceString(tier?.Price);
    return {
      min_qty: parseQtyRequired(tier?.MinQuantity),
      max_qty: parseQtyBound(tier?.MaxQuantity),
      price,
      is_poa,
      note: tier?.Note || null,
    };
  });
}

export function parsePrintPrice(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((tier) => {
    const { price, is_poa } = parsePriceString(tier?.Price);
    return {
      num_colours: parseQtyRequired(tier?.NumColours),
      num_position: parseQtyRequired(tier?.NumPosition),
      min_qty: parseQtyRequired(tier?.MinQuantity),
      max_qty: parseQtyBound(tier?.MaxQuantity),
      price,
      is_poa,
    };
  });
}

export function parsePrintAreaCoordinates(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((c) => {
    const diameter = parseCoordinate(c?.Diameter);
    return {
      image_url: c?.ImageUrl || null,
      marked_image_url: c?.MarkedImageUrl || null,
      colour: c?.Colour || null,
      x: parseCoordinate(c?.Xpos),
      y: parseCoordinate(c?.YPos),
      width: parseCoordinate(c?.Width),
      height: parseCoordinate(c?.Height),
      diameter,
      shape: diameter != null ? 'circle' : 'rectangle',
    };
  });
}

export function parsePrintDetails(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((pd) => ({
    print_class: pd?.PrintClass || null,
    print_type: pd?.PrintType || null,
    print_position: pd?.PrintPosition || null,
    print_area: pd?.PrintArea || null,
    max_colours: pd?.MaxColours || null,
    notes: pd?.Notes || null,
    lead_time: pd?.LeadTime || null,
    setup_charge: parsePriceString(pd?.SetupCharge).price,
    setup_charge_raw: pd?.SetupCharge || null,
    rpt_setup_charge: parsePriceString(pd?.RptSetupCharge).price,
    rpt_setup_charge_raw: pd?.RptSetupCharge || null,
    extra_colour_setup_charge: parsePriceString(pd?.ExtraColourSetupCharge).price,
    extra_colour_setup_charge_raw: pd?.ExtraColourSetupCharge || null,
    default_print_option: !!pd?.DefaultPrintOption,
    print_price: parsePrintPrice(pd?.PrintPrice),
    print_area_coordinates: parsePrintAreaCoordinates(pd?.PrintAreaCoordinates),
  }));
}

export function parseItems(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((it) => ({
    item_code: it?.ItemCode || null,
    item_description: it?.ItemDescription || null,
    item_colour: it?.ItemColour || null,
    item_size: it?.ItemSize || null,
    item_indicator: it?.ItemIndicator || null,
    pms: it?.PMS || null,
    seed_type: it?.SeedType || null,
    item_images: Array.isArray(it?.ItemImages) ? it.ItemImages : [],
    plain_images: Array.isArray(it?.PlainImages) ? it.PlainImages : [],
  }));
}

export function parseArtworkTemplates(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((t) => ({
    template: t?.Template || null,
    template_type: t?.TemplateType || null,
  }));
}

// ---------------------------------------------------------------------------
// Top-level normaliser
// ---------------------------------------------------------------------------

/**
 * Normalise a raw Laltex Product into a supplier_products row shape.
 *
 * Crucially, this function NEVER throws on individual field problems.
 * Each soft failure is pushed to `parseErrors`; the caller decides
 * whether to persist (yes, best-effort) and whether to log a
 * job_failures row (yes).
 *
 * If raw is missing the bare minimum (ProductCode or ProductName), the
 * product is considered unusable and { row: null, parseErrors } is
 * returned — the caller should record a job_failures row and skip.
 *
 * @param {object} raw - one entry from the Laltex products feed
 * @returns {{ row: object|null, parseErrors: Array<{field:string, message:string}> }}
 */
export function normaliseProduct(raw) {
  const parseErrors = [];

  if (!raw || typeof raw !== 'object') {
    parseErrors.push({ field: 'root', message: 'product is not an object' });
    return { row: null, parseErrors };
  }

  const code = raw.ProductCode ? String(raw.ProductCode).trim() : null;
  const name = raw.ProductName ? String(raw.ProductName).trim() : null;
  if (!code) parseErrors.push({ field: 'ProductCode', message: 'missing ProductCode' });
  if (!name) parseErrors.push({ field: 'ProductName', message: 'missing ProductName' });
  if (!code || !name) return { row: null, parseErrors };

  // Integers (best-effort; parseInt NaN -> null)
  let minimumOrderQty = null;
  let cartonQty = null;
  if (raw.MinimumOrderQty != null && raw.MinimumOrderQty !== '') {
    const n = parseInt(raw.MinimumOrderQty, 10);
    if (Number.isFinite(n)) minimumOrderQty = n;
    else parseErrors.push({ field: 'MinimumOrderQty', message: `could not parse "${raw.MinimumOrderQty}" as int` });
  }
  if (raw.CartonQty != null && raw.CartonQty !== '') {
    const n = parseInt(raw.CartonQty, 10);
    if (Number.isFinite(n)) cartonQty = n;
    else parseErrors.push({ field: 'CartonQty', message: `could not parse "${raw.CartonQty}" as int` });
  }

  // Arrays — call sites are null-safe, but if a non-array shows up on a
  // required field we flag it so the snapshot is visible in job_failures.
  const pricingArr = Array.isArray(raw.ProductPrice) ? raw.ProductPrice : null;
  if (raw.ProductPrice != null && pricingArr == null) {
    parseErrors.push({ field: 'ProductPrice', message: 'not an array' });
  }
  const printArr = Array.isArray(raw.PrintDetails) ? raw.PrintDetails : null;
  if (raw.PrintDetails != null && printArr == null) {
    parseErrors.push({ field: 'PrintDetails', message: 'not an array' });
  }

  const row = {
    supplier_product_code: code,
    name,
    title: raw.ProductTitle ?? null,
    description: raw.Description ?? null,
    web_description: raw.WebDescription ?? null,
    keywords: raw.KeyWords ?? null,
    available_colours: raw.AvailableColours ?? null,
    product_dims: raw.ProductDims ?? null,
    unit_weight: raw.UnitWeight ?? null,
    material: raw.Material ?? null,
    country_of_origin: raw.CountryOfOrigin ?? null,
    tariff_code: raw.TariffCode ?? null,
    category: raw.Category ?? null,
    sub_category: raw.SubCategory ?? null,
    supplier_division: raw.Supplier ?? null,
    product_indicator: raw.ProductIndicator ?? null,
    minimum_order_qty: minimumOrderQty,
    carton_qty: cartonQty,
    carton_dims: raw.CartonDims ?? null,
    carton_gross_weight: raw.CartonGrossWeight ?? null,
    images: Array.isArray(raw.Images) ? raw.Images : [],
    plain_images: Array.isArray(raw.PlainImages) ? raw.PlainImages : [],
    artwork_templates: parseArtworkTemplates(raw.ArtworkTemplates),
    items: parseItems(raw.Items),
    product_pricing: parseProductPricing(pricingArr),
    print_details: parsePrintDetails(printArr),
    shipping_charges: Array.isArray(raw.ShippingCharge) ? raw.ShippingCharge : [],
    priority_service: Array.isArray(raw.PriorityService) ? raw.PriorityService : [],
    raw_payload: raw,
    // last_synced_at intentionally omitted — it is set by the sync
    // layer ONLY on successful UPSERT. Failed upserts must not touch it.
  };

  return { row, parseErrors };
}

/**
 * Unwrap a Laltex feed response, which may be any of:
 *   - [ ...products ]           (live API, confirmed session 1)
 *   - { value: [...products ] } (sample file / some endpoints)
 *   - { ...single product }     (defensive, rare)
 *
 * @param {unknown} data
 * @returns {Array<object>}
 */
export function unwrapFeedResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.value)) return data.value;
  if (data && typeof data === 'object' && 'ProductCode' in data) return [data];
  return [];
}
