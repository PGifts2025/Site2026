import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { quote_id, customer_email } = await req.json();

    if (!quote_id) {
      return new Response(
        JSON.stringify({ error: "quote_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with service role key (bypasses RLS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Read the quote from Supabase
    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select("id, total_amount, quote_number, status, customer_id")
      .eq("id", quote_id)
      .single();

    if (quoteError || !quote) {
      return new Response(
        JSON.stringify({ error: "Quote not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prevent double payment
    if (quote.status === "converted") {
      return new Response(
        JSON.stringify({ error: "This quote has already been paid" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build Stripe Checkout session via fetch()
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;
    const siteUrl = Deno.env.get("SITE_URL") || "https://pgifts.co.uk";

    const unitAmountPence = Math.round(Number(quote.total_amount) * 100);

    // Use customer_email from request body, or fall back to profile email
    const profileEmail = null;
    const email = customer_email || profileEmail;

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
      `PGifts Order ${quote.quote_number}`
    );
    params.append(
      "success_url",
      `${siteUrl}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`
    );
    params.append("cancel_url", `${siteUrl}/account/quotes`);
    params.append("metadata[quote_id]", quote_id);
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
