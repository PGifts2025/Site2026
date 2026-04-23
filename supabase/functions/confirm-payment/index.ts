import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderEmail } from "../_shared/emailShell.ts";

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

    // Payment is confirmed and the order exists. Send a confirmation email
    // via Resend. This step is best-effort — any failure here is logged but
    // must NEVER cause a non-2xx response, because the transaction has
    // already committed. The whole block is wrapped in its own try/catch.
    try {
      const resendApiKey = Deno.env.get("RESEND_API_KEY");
      if (!resendApiKey) {
        console.warn("[confirm-payment] RESEND_API_KEY not set — skipping email send");
      } else {
        const { data: orderRow, error: orderFetchError } = await supabase
          .from("orders")
          .select("id, order_number, total_amount, customer_id")
          .eq("id", orderId)
          .single();

        if (orderFetchError || !orderRow) {
          console.warn(
            "[confirm-payment] Could not load order for email:",
            orderFetchError,
          );
        } else {
          // Resolve recipient: Stripe session first (already in scope, no DB
          // round-trip), fallback to auth.users via admin API.
          let customerEmail: string | null = stripeSession.customer_email || null;
          if (!customerEmail && orderRow.customer_id) {
            const { data: userData } = await supabase.auth.admin.getUserById(
              orderRow.customer_id,
            );
            customerEmail = userData?.user?.email || null;
          }

          if (!customerEmail) {
            console.warn(
              "[confirm-payment] No customer email available — skipping email send for order",
              orderRow.order_number,
            );
          } else {
            const { data: itemsData } = await supabase
              .from("order_items")
              .select("product_name, color, quantity, line_total")
              .eq("order_id", orderId);
            const items = itemsData || [];

            const totalAmount = Number(orderRow.total_amount) || 0;

            const itemsHtml = items.map((item: any) => `
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${item.product_name}${item.color ? ` (${item.color})` : ""}</td>
        <td style="text-align: right; padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${item.quantity}</td>
        <td style="text-align: right; padding: 8px 0; border-bottom: 1px solid #f0f0f0;">£${Number(item.line_total).toFixed(2)}</td>
      </tr>`).join("");

            const itemsText = items
              .map((item: any) =>
                `- ${item.product_name}${item.color ? ` (${item.color})` : ""} × ${item.quantity} — £${Number(item.line_total).toFixed(2)}`
              )
              .join("\n");

            // Body content only — the shared shell in _shared/emailShell.ts
            // wraps this with the PG header, CTA button, and footer. Indented
            // to match the 14-space column inside the shell's content <td>.
            const bodyHtml = `              <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">We've received your payment for order <strong>${orderRow.order_number}</strong>. Here's a quick summary:</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse; margin:16px 0 20px 0;">
                <thead>
                  <tr style="border-bottom:2px solid #e5e5e5;">
                    <th align="left" style="text-align:left; padding:8px 0; font-size:14px;">Item</th>
                    <th align="right" style="text-align:right; padding:8px 0; font-size:14px;">Qty</th>
                    <th align="right" style="text-align:right; padding:8px 0; font-size:14px;">Total</th>
                  </tr>
                </thead>
                <tbody>${itemsHtml}
                </tbody>
                <tfoot>
                  <tr style="font-weight:bold;">
                    <td colspan="2" style="padding:12px 0 8px 0; font-size:14px;">Total paid</td>
                    <td align="right" style="text-align:right; padding:12px 0 8px 0; font-size:14px;">£${totalAmount.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 8px 0;">
                <tr>
                  <td style="background:#f5f5f5; border-radius:8px; padding:20px;">
                    <h2 style="margin:0 0 10px 0; font-size:18px; font-weight:700; color:#1a1a1a;">Next step — upload your artwork</h2>
                    <p style="margin:0; font-size:14px; line-height:1.6; color:#1a1a1a;">To move your order into production we need your artwork files — logo, design, or any print-ready artwork.</p>
                  </td>
                </tr>
              </table>`;

            const bodyText = `We've received your payment for order ${orderRow.order_number}. Here's a quick summary:

${itemsText}

Total paid: £${totalAmount.toFixed(2)}

Next step — upload your artwork
To move your order into production we need your artwork files — logo, design, or any print-ready artwork.`;

            const { html, text } = renderEmail({
              preheader: `Order ${orderRow.order_number} confirmed — £${totalAmount.toFixed(2)} paid. Upload your artwork next.`,
              heading: "Thanks for your order",
              bodyHtml,
              bodyText,
              ctaLabel: "Upload artwork",
              ctaUrl: "https://promo-gifts-co.uk/account/orders",
              supportEmail: "orders@promo-gifts.co",
            });

            const resendRes = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${resendApiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: "PGifts <orders@promo-gifts.co>",
                to: [customerEmail],
                reply_to: "orders@promo-gifts.co",
                subject: `Order confirmation — ${orderRow.order_number}`,
                html,
                text,
              }),
            });

            if (!resendRes.ok) {
              const detail = await resendRes.text();
              console.error(
                "[confirm-payment] Resend send failed:",
                resendRes.status,
                detail,
              );
            } else {
              console.log(
                "[confirm-payment] Confirmation email sent to",
                customerEmail,
                "for order",
                orderRow.order_number,
              );
            }
          }
        }
      }
    } catch (emailErr) {
      console.error("[confirm-payment] Email step failed (non-fatal):", emailErr);
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
