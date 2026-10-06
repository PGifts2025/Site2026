import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type LineCheck = { ok: true } | { ok: false; error: string; reason: string };

type Line = {
  id: string;
  product_id: string | null;
  supplier_product_id: string | null;
  quantity: number;
  unit_price: number;
  taxable_net_unit: number | null;
  line_vat: number | null;
};

const PRICE_CHANGED =
  "Prices have changed since this quote was created. Please remove the item and add it again from the product page.";
const CANT_VERIFY = "Could not verify this quote. Please try again.";

// Mirrors ZERO_RATED_PRODUCT_CODES in src/utils/vat.js — keep in sync. Only
// these Laltex codes may carry a taxable_net_unit (services-only VAT basis).
const ZERO_RATED_PRODUCT_CODES = ["TF001K", "TF004K", "CF2019"];

const minPositive = (values: unknown[]): number | null => {
  const nums = values.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? Math.min(...nums) : null;
};

/**
 * Re-validate a quote's lines against live catalog data before charging.
 * Every check is keyed on product_id / supplier_product_id, never on names.
 *
 * All quotes: at least one line; every line has a positive integer quantity
 * and positive unit_price; quotes.total_amount equals the total recomputed
 * from the lines (same formula as recompute_quote_total).
 *
 * Tier-priced catalog products (catalog_pricing_tiers only — water-bottle,
 * chi-cup, pens, power, cables, notebooks, tea towel): EXACT. Quantity must
 * reach the lowest tier, unit_price must equal the matching tier price, and
 * taxable_net_unit must be null. (The quote_items_server_price trigger already
 * sets these server-side; this re-check covers rows written before it.)
 *
 * Clothing (catalog_print_pricing), bags (bag_print_pricing) and Laltex lines:
 * FLOOR ONLY. unit_price must be at least the lowest price the product could
 * ever sell at. This stops £0.01-style tampering but not a smaller under-price
 * — see CLAUDE.md §16.10.
 */
// deno-lint-ignore no-explicit-any
async function validateQuoteLines(supabase: any, quote: { id: string; total_amount: number }): Promise<LineCheck> {
  const { data: items, error } = await supabase
    .from("quote_items")
    .select("id, product_id, supplier_product_id, quantity, unit_price, taxable_net_unit, line_vat")
    .eq("quote_id", quote.id);

  if (error) return { ok: false, error: CANT_VERIFY, reason: `items query: ${error.message}` };
  const lines = (items ?? []) as Line[];
  if (lines.length === 0) return { ok: false, error: "This quote has no items.", reason: "no items" };

  let net = 0;
  let vat = 0;
  for (const it of lines) {
    const qty = Number(it.quantity);
    const price = Number(it.unit_price);
    if (!Number.isInteger(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      return { ok: false, error: "This quote has an item with an invalid quantity or price.", reason: `bad line ${it.id}` };
    }
    net += qty * price;
    vat += Number(it.line_vat ?? 0);
  }
  const recomputed = Math.round((net + vat) * 100) / 100;
  if (Math.abs(recomputed - Number(quote.total_amount)) > 0.005) {
    return {
      ok: false,
      error: "This quote's total doesn't match its items. Please refresh the page and try again.",
      reason: `total ${quote.total_amount} != recomputed ${recomputed}`,
    };
  }

  const catalogIds = [...new Set(lines.map((l) => l.product_id).filter((v): v is string => !!v))];
  const supplierIds = [...new Set(lines.map((l) => l.supplier_product_id).filter((v): v is string => !!v))];

  const none = Promise.resolve({ data: [], error: null });
  const [products, tiers, printRows, bagRows, supplierRows] = await Promise.all([
    catalogIds.length ? supabase.from("catalog_products").select("id, name").in("id", catalogIds) : none,
    catalogIds.length
      ? supabase.from("catalog_pricing_tiers").select("catalog_product_id, min_quantity, max_quantity, price_per_unit").in("catalog_product_id", catalogIds)
      : none,
    catalogIds.length
      ? supabase.from("catalog_print_pricing").select("catalog_product_id, total_sell_price, garment_cost").in("catalog_product_id", catalogIds)
      : none,
    catalogIds.length ? supabase.from("bag_print_pricing").select("catalog_product_id, unit_cost").in("catalog_product_id", catalogIds) : none,
    supplierIds.length
      ? supabase.from("supplier_products").select("id, supplier_product_code, name, product_pricing").in("id", supplierIds)
      : none,
  ]);
  const failed = [products, tiers, printRows, bagRows, supplierRows].find((r) => r.error);
  if (failed) return { ok: false, error: CANT_VERIFY, reason: `catalog query: ${failed.error.message}` };

  // deno-lint-ignore no-explicit-any
  const byProduct = (rows: any[], id: string) => rows.filter((r) => r.catalog_product_id === id);
  const names = new Map<string, string>(products.data.map((p: { id: string; name: string }) => [p.id, p.name]));
  // deno-lint-ignore no-explicit-any
  const suppliers = new Map<string, any>(supplierRows.data.map((s: { id: string }) => [s.id, s]));

  for (const it of lines) {
    const qty = Number(it.quantity);
    const price = Number(it.unit_price);

    // ---- Laltex line ------------------------------------------------------
    if (!it.product_id) {
      const sp = it.supplier_product_id ? suppliers.get(it.supplier_product_id) : undefined;
      if (!sp) {
        return { ok: false, error: PRICE_CHANGED, reason: `laltex line ${it.id} has no resolvable supplier_product_id` };
      }
      const tiersArr = Array.isArray(sp.product_pricing) ? sp.product_pricing : [];
      const floor = minPositive(
        tiersArr
          .filter((t: { is_poa?: boolean }) => !t?.is_poa)
          .map((t: { sell_price?: number; price?: number }) => t?.sell_price ?? t?.price),
      );
      if (floor == null) {
        return { ok: false, error: `${sp.name} can't be ordered online right now. Please call us.`, reason: `no laltex floor ${it.supplier_product_id}` };
      }
      if (price < floor - 0.00005) {
        return { ok: false, error: PRICE_CHANGED, reason: `laltex floor: ${price} < ${floor} (${it.supplier_product_id})` };
      }
      if (it.taxable_net_unit != null) {
        const tnu = Number(it.taxable_net_unit);
        const code = String(sp.supplier_product_code ?? "").trim().toUpperCase();
        if (!ZERO_RATED_PRODUCT_CODES.includes(code) || !Number.isFinite(tnu) || tnu < 0 || tnu > price) {
          return { ok: false, error: PRICE_CHANGED, reason: `bad taxable_net_unit ${it.taxable_net_unit} on ${code}` };
        }
      }
      continue;
    }

    // ---- Catalog line -----------------------------------------------------
    const name = names.get(it.product_id);
    if (!name) {
      return { ok: false, error: "This quote contains a product that is no longer available.", reason: `unknown product ${it.product_id}` };
    }
    if (it.taxable_net_unit != null) {
      return { ok: false, error: PRICE_CHANGED, reason: `taxable_net_unit on catalog line ${it.id}` };
    }

    const productTiers = byProduct(tiers.data, it.product_id).sort((a, b) => a.min_quantity - b.min_quantity);
    const print = byProduct(printRows.data, it.product_id);
    const bag = byProduct(bagRows.data, it.product_id);

    if (print.length > 0 || bag.length > 0) {
      // Clothing / bags: engine-priced client-side, so floor check only.
      const floor = minPositive([
        ...print.map((r) => r.total_sell_price),
        ...print.map((r) => r.garment_cost),
        ...bag.map((r) => r.unit_cost),
        ...productTiers.map((t) => t.price_per_unit),
      ]);
      if (floor == null || price < floor - 0.00005) {
        return { ok: false, error: PRICE_CHANGED, reason: `engine floor: ${price} < ${floor} (${it.product_id})` };
      }
      continue;
    }

    // Tier-priced: exact.
    if (productTiers.length === 0) {
      return { ok: false, error: `${name} can't be ordered online right now. Please call us.`, reason: `no tiers ${it.product_id}` };
    }
    const moq = productTiers[0].min_quantity;
    if (qty < moq) {
      return {
        ok: false,
        error: `Minimum order for ${name} is ${moq.toLocaleString("en-GB")} units.`,
        reason: `below MOQ: ${qty} < ${moq} (${it.product_id})`,
      };
    }
    const tier = [...productTiers].reverse().find(
      (t) => qty >= t.min_quantity && (t.max_quantity == null || qty <= t.max_quantity),
    );
    if (!tier || Math.abs(Number(tier.price_per_unit) - price) > 0.00005) {
      return { ok: false, error: PRICE_CHANGED, reason: `price ${price} != tier ${tier?.price_per_unit} (${it.product_id} x${qty})` };
    }
  }

  return { ok: true };
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { quote_id } = await req.json();

    if (!quote_id) {
      return json({ error: "quote_id is required" }, 400);
    }

    // Create Supabase client with service role key (bypasses RLS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Identify the caller from their session JWT. The platform gate
    // (verify_jwt = true) also accepts the anon key, which carries no user,
    // so getUser() is what actually proves who is paying.
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
    const caller = authData?.user;
    if (authError || !caller) {
      return json({ error: "Please sign in to pay for this quote." }, 401);
    }

    // Read the quote from Supabase
    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select("id, total_amount, quote_number, status, customer_id")
      .eq("id", quote_id)
      .single();

    // Same 404 for "missing" and "not yours" so quote ids can't be probed.
    if (quoteError || !quote || quote.customer_id !== caller.id) {
      return json({ error: "Quote not found" }, 404);
    }

    // Prevent double payment
    if (quote.status === "converted") {
      return json({ error: "This quote has already been paid" }, 400);
    }
    if (quote.status !== "draft") {
      return json({ error: "This quote can't be paid in its current state." }, 400);
    }

    // Server-side line validation. The browser can write quote_items and
    // quotes directly, so nothing it stored is trusted until re-checked here.
    const lineCheck = await validateQuoteLines(supabase, quote);
    if (!lineCheck.ok) {
      console.warn("[create-checkout-session] rejected quote", {
        quote_id: quote.id, reason: lineCheck.reason,
      });
      return json({ error: lineCheck.error }, 400);
    }

    // Reject non-positive totals. Stripe auto-completes £0 sessions without
    // a card charge, so an empty-cart or null-total quote would silently
    // pass through and produce a "paid" confirmation email. Check against
    // the same field we send to Stripe (quote.total_amount).
    const totalAmount = Number(quote.total_amount);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      console.warn(
        "[create-checkout-session] blocking non-positive total",
        { quote_id: quote.id, total_amount: quote.total_amount, coerced: totalAmount }
      );
      return new Response(
        JSON.stringify({ error: "Orders must have a total greater than zero." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build Stripe Checkout session via fetch()
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;
    const siteUrl = Deno.env.get("SITE_URL") || "https://promo-gifts-co.uk";

    const unitAmountPence = Math.round(Number(quote.total_amount) * 100);

    // Pre-fill Stripe with the authenticated user's email, not a body field.
    const email = caller.email ?? null;

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("currency", "gbp");
    params.append("line_items[0][quantity]", "1");
    params.append("line_items[0][price_data][currency]", "gbp");
    params.append(
      "line_items[0][price_data][unit_amount]",
      String(unitAmountPence)
    );
    params.append(
      "line_items[0][price_data][product_data][name]",
      `Promo Gifts Order ${quote.quote_number}`
    );
    params.append(
      "success_url",
      `${siteUrl}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`
    );
    params.append("cancel_url", `${siteUrl}/account/quotes`);
    params.append("metadata[quote_id]", quote_id);
    // Visible, non-blocking Terms of Sale link on the Stripe-hosted checkout
    // page. Deliberately NOT the required-checkbox variant
    // (consent_collection[terms_of_service]='required'): the customer already
    // sees a Terms link at Pay Now, so a second required tick is friction for
    // nothing. Stripe renders the Markdown link in custom_text messages.
    params.append(
      "custom_text[after_submit][message]",
      `By completing your order you agree to our [Terms of Sale](${siteUrl}/terms).`
    );
    if (email) {
      params.append("customer_email", email);
    }

    const stripeRes = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    );

    const stripeSession = await stripeRes.json();

    if (!stripeRes.ok) {
      console.error("Stripe error:", stripeSession);
      return new Response(
        JSON.stringify({ error: stripeSession.error?.message || "Stripe error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ url: stripeSession.url }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
