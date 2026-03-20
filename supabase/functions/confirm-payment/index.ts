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
    const { session_id } = await req.json();

    if (!session_id) {
      return new Response(
        JSON.stringify({ error: "session_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;

    // Retrieve the Stripe Checkout session
    const stripeRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session_id)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
        },
      }
    );

    const stripeSession = await stripeRes.json();

    if (!stripeRes.ok) {
      console.error("Stripe error:", stripeSession);
      return new Response(
        JSON.stringify({ error: stripeSession.error?.message || "Failed to retrieve session" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify payment was successful
    if (stripeSession.payment_status !== "paid") {
      return new Response(
        JSON.stringify({ error: "Payment not completed", payment_status: stripeSession.payment_status }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const quoteId = stripeSession.metadata?.quote_id;
    if (!quoteId) {
      return new Response(
        JSON.stringify({ error: "No quote_id in session metadata" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with service role key (bypasses RLS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Idempotency check: does an order already exist for this stripe session?
    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id")
      .eq("stripe_session_id", session_id)
      .maybeSingle();

    if (existingOrder) {
      return new Response(
        JSON.stringify({
          success: true,
          order_id: existingOrder.id,
          already_existed: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the quote to find customer_id
    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select("id, customer_id, status")
      .eq("id", quoteId)
      .single();

    if (quoteError || !quote) {
      return new Response(
        JSON.stringify({ error: "Quote not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prevent processing an already-converted quote (extra safety)
    if (quote.status === "converted") {
      // Quote already converted but no order with this session — edge case
      // Return success to avoid blocking the customer
      const { data: existingOrderByQuote } = await supabase
        .from("orders")
        .select("id")
        .eq("quote_id", quoteId)
        .maybeSingle();

      return new Response(
        JSON.stringify({
          success: true,
          order_id: existingOrderByQuote?.id || null,
          already_existed: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const paymentAmountPounds = stripeSession.amount_total / 100;

    // Update the quote
    const { error: updateError } = await supabase
      .from("quotes")
      .update({
        status: "converted",
        stripe_session_id: session_id,
        paid_at: new Date().toISOString(),
        payment_amount: paymentAmountPounds,
      })
      .eq("id", quoteId);

    if (updateError) {
      console.error("Quote update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update quote" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create the order record
    const { data: newOrder, error: orderError } = await supabase
      .from("orders")
      .insert({
        quote_id: quoteId,
        customer_id: quote.customer_id,
        status: "confirmed",
        artwork_status: "pending_artwork",
        stripe_session_id: session_id,
        total_amount: paymentAmountPounds,
      })
      .select("id")
      .single();

    if (orderError) {
      console.error("Order creation error:", orderError);
      return new Response(
        JSON.stringify({ error: "Failed to create order" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        order_id: newOrder.id,
      }),
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
