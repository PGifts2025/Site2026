import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { session_id } = await req.json();

    if (!session_id) {
      return new Response(
        JSON.stringify({ error: "session_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;

    const stripeRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session_id)}`,
      { method: "GET", headers: { Authorization: `Bearer ${stripeSecretKey}` } },
    );
    const stripeSession = await stripeRes.json();

    if (!stripeRes.ok) {
      console.error("Stripe error:", stripeSession);
      return new Response(
        JSON.stringify({
          error: stripeSession.error?.message || "Failed to retrieve session",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (stripeSession.payment_status !== "paid") {
      return new Response(
        JSON.stringify({
          error: "Payment not completed",
          payment_status: stripeSession.payment_status,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const quoteId = stripeSession.metadata?.quote_id;
    if (!quoteId) {
      return new Response(
        JSON.stringify({ error: "No quote_id in session metadata" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const paymentAmountPounds = stripeSession.amount_total / 100;
    const paymentIntentId =
      typeof stripeSession.payment_intent === "string"
        ? stripeSession.payment_intent
        : stripeSession.payment_intent?.id ?? null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // All DB work happens atomically inside this RPC. Idempotent on
    // stripe_session_id. Any failure rolls back the whole transaction.
    const { data: orderId, error: rpcError } = await supabase.rpc(
      "confirm_payment_atomic",
      {
        p_quote_id: quoteId,
        p_stripe_session_id: session_id,
        p_payment_intent_id: paymentIntentId,
        p_payment_amount: paymentAmountPounds,
      },
    );

    if (rpcError) {
      console.error("confirm_payment_atomic error:", rpcError);
      return new Response(
        JSON.stringify({
          error: "Failed to confirm payment",
          details: rpcError.message,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: "Order creation returned no id" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, order_id: orderId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: detail }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
