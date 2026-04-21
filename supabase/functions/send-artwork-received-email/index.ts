import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Best-effort email service. Every return is HTTP 200 JSON — never fail
// the caller. A failed send just leaves artwork_received_email_sent_at
// null, so a future retry (manual or scheduled) can try again.
//
// Idempotency guard: orders.artwork_received_email_sent_at.
// Success stamps it. Failure does not, so retries remain safe.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonOk(payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const orderId: string = typeof body?.order_id === "string" ? body.order_id : "";
    if (!orderId || !UUID_RE.test(orderId)) {
      console.warn("[send-artwork-received-email] invalid order_id:", orderId);
      return jsonOk({ success: true, sent: false, reason: "invalid_order_id" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Fetch order.
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(
        "id, order_number, customer_id, total_amount, artwork_received_email_sent_at, artwork_status",
      )
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) {
      console.error("[send-artwork-received-email] order fetch error:", orderError);
      return jsonOk({ success: true, sent: false, reason: "order_not_found" });
    }
    if (!order) {
      console.warn("[send-artwork-received-email] order not found:", orderId);
      return jsonOk({ success: true, sent: false, reason: "order_not_found" });
    }

    // 2. Idempotency.
    if (order.artwork_received_email_sent_at) {
      return jsonOk({ success: true, sent: false, reason: "already_sent" });
    }

    // 3. Sanity — status must have advanced past pending_artwork.
    if (order.artwork_status === "pending_artwork") {
      console.warn(
        "[send-artwork-received-email] artwork_status still pending_artwork for order",
        order.order_number,
      );
      return jsonOk({ success: true, sent: false, reason: "status_mismatch" });
    }

    // 4. Resolve customer email via auth.users.
    let customerEmail: string | null = null;
    if (order.customer_id) {
      const { data: userData } = await supabase.auth.admin.getUserById(
        order.customer_id,
      );
      customerEmail = userData?.user?.email || null;
    }
    if (!customerEmail) {
      console.warn(
        "[send-artwork-received-email] no customer email for order",
        order.order_number,
      );
      return jsonOk({ success: true, sent: false, reason: "no_customer_email" });
    }

    // 5. Resend API key.
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.warn("[send-artwork-received-email] RESEND_API_KEY not set");
      return jsonOk({ success: true, sent: false, reason: "no_api_key" });
    }

    // 6. Fetch order_items for the body.
    const { data: itemsData } = await supabase
      .from("order_items")
      .select("product_name, color, quantity, line_total")
      .eq("order_id", orderId);
    const items = itemsData || [];

    const totalAmount = Number(order.total_amount) || 0;

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

    const html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a; padding: 24px;">
  <h1 style="font-size: 24px; margin: 0 0 16px 0;">Thanks — we've got your artwork</h1>
  <p>We've received your artwork files for order <strong>${order.order_number}</strong> and they're now with our artwork team.</p>

  <h2 style="font-size: 18px; margin: 28px 0 12px 0;">What happens next</h2>
  <p>Our team will prepare a pre-production proof and send it directly to you from <strong>artwork@promo-gifts.co</strong>. Most proofs go out the same working day, though timing depends on when your order comes in and our current workload.</p>
  <p>Please review the proof carefully when it arrives — this is your chance to request any changes before we go to print. Simply reply to the proof email with your approval or any amendments.</p>

  <h2 style="font-size: 18px; margin: 28px 0 12px 0;">Your order</h2>
  <table style="width: 100%; border-collapse: collapse; margin: 0 0 24px 0;">
    <thead>
      <tr style="border-bottom: 2px solid #e5e5e5;">
        <th style="text-align: left; padding: 8px 0;">Item</th>
        <th style="text-align: right; padding: 8px 0;">Qty</th>
        <th style="text-align: right; padding: 8px 0;">Total</th>
      </tr>
    </thead>
    <tbody>${itemsHtml}
    </tbody>
    <tfoot>
      <tr style="font-weight: bold;">
        <td colspan="2" style="padding: 12px 0 8px 0;">Total paid</td>
        <td style="text-align: right; padding: 12px 0 8px 0;">£${totalAmount.toFixed(2)}</td>
      </tr>
    </tfoot>
  </table>

  <p style="margin: 24px 0;">
    <a href="https://promo-gifts-co.uk/account/orders" style="background: #1a1a1a; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">View order</a>
  </p>

  <p style="color: #666; font-size: 14px;">Any questions in the meantime? Just reply to this email.</p>
  <p style="color: #999; font-size: 12px; margin-top: 32px;">PGifts · promo-gifts-co.uk</p>
</div>`;

    const text = `Thanks — we've got your artwork

We've received your artwork files for order ${order.order_number} and they're now with our artwork team.

What happens next

Our team will prepare a pre-production proof and send it directly to you from artwork@promo-gifts.co. Most proofs go out the same working day, though timing depends on when your order comes in and our current workload.

Please review the proof carefully when it arrives — this is your chance to request any changes before we go to print. Simply reply to the proof email with your approval or any amendments.

Your order
${itemsText}

Total paid: £${totalAmount.toFixed(2)}

View order: https://promo-gifts-co.uk/account/orders

Any questions in the meantime? Just reply to this email.

— PGifts
promo-gifts-co.uk`;

    // 7. Send via Resend. Any failure → don't stamp; return sent:false so a
    // future retry path can try again.
    try {
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
          subject: `Artwork received — ${order.order_number}`,
          html,
          text,
        }),
      });

      if (!resendRes.ok) {
        const detail = await resendRes.text();
        console.error(
          "[send-artwork-received-email] Resend failed:",
          resendRes.status,
          detail,
        );
        return jsonOk({ success: true, sent: false, reason: "resend_failed" });
      }
    } catch (sendErr) {
      console.error("[send-artwork-received-email] Resend threw:", sendErr);
      return jsonOk({ success: true, sent: false, reason: "resend_failed" });
    }

    // 8. Stamp idempotency marker. If the UPDATE itself fails the email has
    //    already gone out, so we still report sent:true.
    const { error: stampError } = await supabase
      .from("orders")
      .update({ artwork_received_email_sent_at: new Date().toISOString() })
      .eq("id", orderId);
    if (stampError) {
      console.error(
        "[send-artwork-received-email] stamp failed (email did send):",
        stampError,
      );
    }

    console.log(
      "[send-artwork-received-email] Sent to",
      customerEmail,
      "for order",
      order.order_number,
    );
    return jsonOk({ success: true, sent: true });
  } catch (err) {
    console.error("[send-artwork-received-email] unexpected error:", err);
    return jsonOk({ success: true, sent: false, reason: "unexpected_error" });
  }
});
