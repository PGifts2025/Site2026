// Stripe webhook backup path for order creation.
//
// Today, order rows are created when the customer's browser is redirected
// back from Stripe to /order-confirmation, which triggers the confirm-payment
// Edge Function. If the browser dies between Stripe charging the card and
// hitting our redirect URL (laptop closed, tab crashed, network drop), the
// money is taken but no order row exists.
//
// This function closes that gap by subscribing to the
// checkout.session.completed event server-to-server. It calls the SAME
// confirm_payment_atomic RPC the redirect path uses, with the same
// (quote_id, stripe_session_id) idempotency anchor, so duplicate orders are
// impossible. See CLAUDE.md §17.7 for the RPC's concurrency contract.
//
// The email-send step delegates to the shared sendOrderConfirmation helper,
// which uses a CAS UPDATE on orders.confirmation_email_sent_at + a Resend
// Idempotency-Key header so the customer cannot receive the email twice
// even if both paths run concurrently.
//
// Deploy:  supabase functions deploy stripe-webhook --project-ref <ref> --no-verify-jwt
// The --no-verify-jwt flag is REQUIRED. Stripe does not send a Supabase JWT;
// signature verification is the security boundary instead.

import Stripe from "https://esm.sh/stripe@17?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOrderConfirmation } from "../_shared/sendOrderConfirmation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !supabaseServiceKey) {
    console.error(
      "[stripe-webhook] Missing required env vars:",
      {
        STRIPE_SECRET_KEY: !!stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: !!webhookSecret,
        SUPABASE_URL: !!supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: !!supabaseServiceKey,
      },
    );
    // Return 500 so Stripe retries — this is recoverable once the secret lands.
    return jsonResponse(500, { error: "Server misconfigured" });
  }

  // Read the raw request body BEFORE any JSON parsing. The signature is
  // computed over the exact bytes Stripe sent; req.json() consumes the
  // stream and any re-stringification would break the HMAC.
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    console.warn("[stripe-webhook] Missing Stripe-Signature header");
    return jsonResponse(400, { error: "Missing signature" });
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });

  let event: Stripe.Event;
  try {
    // constructEventAsync is required in Deno — Web Crypto HMAC is async,
    // and the sync variant relies on Node's crypto module which is absent.
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Do NOT log the raw body — could be an attacker probing the endpoint.
    console.warn("[stripe-webhook] Signature verification failed:", message);
    // 400 is terminal — Stripe will not retry. Correct: a wrong signature
    // is not a transient failure.
    return jsonResponse(400, { error: "Signature verification failed" });
  }

  console.log(`[stripe-webhook] event ${event.id} type=${event.type}`);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.payment_status !== "paid") {
        console.log(
          `[stripe-webhook] event ${event.id} session ${session.id} payment_status=${session.payment_status} — skipping`,
        );
        return jsonResponse(200, { received: true, skipped: "unpaid" });
      }

      const quoteId = session.metadata?.quote_id;
      if (!quoteId) {
        // Could be a Stripe Checkout session not originating from PGifts
        // (test fixtures, another product). 200 so Stripe stops retrying.
        console.warn(
          `[stripe-webhook] event ${event.id} session ${session.id} has no quote_id metadata — ignoring`,
        );
        return jsonResponse(200, { received: true, skipped: "no_quote_id" });
      }

      const paymentAmountPounds =
        typeof session.amount_total === "number"
          ? session.amount_total / 100
          : null;
      if (paymentAmountPounds == null) {
        console.error(
          `[stripe-webhook] event ${event.id} session ${session.id} missing amount_total`,
        );
        return jsonResponse(500, { error: "Missing amount_total" });
      }

      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null;

      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const { data: orderId, error: rpcError } = await supabase.rpc(
        "confirm_payment_atomic",
        {
          p_quote_id: quoteId,
          p_stripe_session_id: session.id,
          p_payment_intent_id: paymentIntentId,
          p_payment_amount: paymentAmountPounds,
        },
      );

      if (rpcError) {
        console.error(
          `[stripe-webhook] confirm_payment_atomic error for event ${event.id}:`,
          rpcError,
        );
        // 500 = Stripe retries. Correct for transient DB failures; for
        // permanent ones (bad data) Stripe will give up after ~3 days of
        // exponential backoff. Better than silently swallowing.
        return jsonResponse(500, { error: "RPC failed" });
      }

      if (!orderId) {
        console.error(
          `[stripe-webhook] confirm_payment_atomic returned no order id for event ${event.id}`,
        );
        return jsonResponse(500, { error: "RPC returned no order id" });
      }

      // Best-effort email send. Same helper the redirect path uses; CAS on
      // orders.confirmation_email_sent_at + Resend Idempotency-Key dedup the
      // delivery if both paths race here. Failures do not affect the 200
      // response — Stripe should not retry a successful order creation just
      // because email send is slow.
      try {
        const emailResult = await sendOrderConfirmation(
          supabase,
          orderId,
          { customer_email: session.customer_email ?? null },
        );
        console.log(
          `[stripe-webhook] event ${event.id} sendOrderConfirmation result:`,
          emailResult,
        );
      } catch (emailErr) {
        console.error(
          `[stripe-webhook] event ${event.id} email step failed (non-fatal):`,
          emailErr,
        );
      }

      return jsonResponse(200, { received: true, order_id: orderId });
    }

    default: {
      // Acknowledge events we haven't subscribed for — keeps the endpoint
      // generous if the Stripe Dashboard subscription is broadened later
      // without a code change here.
      console.log(
        `[stripe-webhook] event ${event.id} type=${event.type} — no handler, ignoring`,
      );
      return jsonResponse(200, { received: true, ignored: event.type });
    }
  }
});
