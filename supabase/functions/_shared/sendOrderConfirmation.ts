// Shared order-confirmation email helper.
//
// Called by two paths:
//   1. supabase/functions/confirm-payment   — browser-triggered after Stripe redirect
//   2. supabase/functions/stripe-webhook    — server-to-server on checkout.session.completed
//
// Both paths invoke this after a successful confirm_payment_atomic RPC call.
// The helper is idempotent: it stamps orders.confirmation_email_sent_at on
// successful Resend delivery and refuses to re-send if that timestamp is
// already populated. The CAS UPDATE pattern (predicate IS NULL on the
// .update()) makes the stamp race-safe even when both paths run concurrently.
//
// As a second line of defence, the Resend POST carries an
// Idempotency-Key: order-${orderId}-confirmation header so duplicate sends
// are also dedup'd at SMTP layer in the rare case both paths pass the SELECT
// guard before either lands the UPDATE.
//
// This module deliberately makes no decisions about HTTP responses or retry
// behaviour — that belongs to the caller. The helper never throws; it always
// returns a structured { sent, reason } result. Resend failures do NOT stamp
// the column, so a future call will retry.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderEmail } from "./emailShell.ts";

// Minimal Stripe Checkout Session shape needed for recipient resolution.
// Compatible with both the GET /checkout/sessions/{id} response shape used by
// confirm-payment and the event.data.object shape on checkout.session.completed.
export interface StripeSessionLike {
  customer_email?: string | null;
}

export type SendOrderConfirmationResult =
  | { sent: true }
  | {
    sent: false;
    reason:
      | "no_api_key"
      | "order_not_found"
      | "no_customer_email"
      | "already_sent"
      | "stamped_by_other_path"
      | "resend_error";
  };

export async function sendOrderConfirmation(
  supabase: SupabaseClient,
  orderId: string,
  stripeSession: StripeSessionLike,
): Promise<SendOrderConfirmationResult> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.warn(
      "[send-order-confirmation] RESEND_API_KEY not set — skipping email send",
    );
    return { sent: false, reason: "no_api_key" };
  }

  const { data: orderRow, error: orderFetchError } = await supabase
    .from("orders")
    .select(
      "id, order_number, total_amount, customer_id, confirmation_email_sent_at, shipping_address, po_number",
    )
    .eq("id", orderId)
    .single();

  if (orderFetchError || !orderRow) {
    console.warn(
      "[send-order-confirmation] Could not load order for email:",
      orderFetchError,
    );
    return { sent: false, reason: "order_not_found" };
  }

  // Idempotency gate. The other path already sent the confirmation email —
  // bail before doing any rendering or Resend traffic.
  if (orderRow.confirmation_email_sent_at) {
    return { sent: false, reason: "already_sent" };
  }

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
      "[send-order-confirmation] No customer email available — skipping email send for order",
      orderRow.order_number,
    );
    return { sent: false, reason: "no_customer_email" };
  }

  const { data: itemsData } = await supabase
    .from("order_items")
    .select("product_name, color, quantity, line_total, print_areas")
    .eq("order_id", orderId);
  const items = itemsData || [];

  const totalAmount = Number(orderRow.total_amount) || 0;

  // Format the v2 jsonb print_areas shape for the email body.
  // Falls back to plain string for legacy entries (CLAUDE.md §43).
  const formatPrintSelections = (pa: any): string[] => {
    if (!pa) return [];
    if (typeof pa === "string") return [pa];
    if (pa && Array.isArray(pa.selections)) {
      return pa.selections.map((s: any) => {
        const parts: string[] = [];
        if (s.position) parts.push(s.position);
        const detail: string[] = [];
        if (s.type) detail.push(s.type);
        if (s.area) detail.push(s.area);
        if (s.num_colours) detail.push(`${s.num_colours} colour${s.num_colours > 1 ? "s" : ""}`);
        return detail.length > 0
          ? `${parts.join("")} — ${detail.join(", ")}`
          : parts.join("");
      });
    }
    return [];
  };

  const itemsHtml = items.map((item: any) => {
    const selections = formatPrintSelections(item.print_areas);
    const selectionsHtml = selections.length > 0
      ? `<div style="margin-top:4px; font-size:12px; color:#6b7280; line-height:1.5;">${selections
          .map((s) => `<div>${s}</div>`)
          .join("")}</div>`
      : "";
    return `
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
          ${item.product_name}${item.color ? ` (${item.color})` : ""}${selectionsHtml}
        </td>
        <td style="text-align: right; padding: 8px 0; border-bottom: 1px solid #f0f0f0; vertical-align: top;">${item.quantity}</td>
        <td style="text-align: right; padding: 8px 0; border-bottom: 1px solid #f0f0f0; vertical-align: top;">£${Number(item.line_total).toFixed(2)}</td>
      </tr>`;
  }).join("");

  const itemsText = items
    .map((item: any) => {
      const selections = formatPrintSelections(item.print_areas);
      const head = `- ${item.product_name}${item.color ? ` (${item.color})` : ""} × ${item.quantity} — £${Number(item.line_total).toFixed(2)}`;
      if (selections.length === 0) return head;
      return [head, ...selections.map((s) => `    ${s}`)].join("\n");
    })
    .join("\n");

  // "Delivering to" block (PR B). Customer-entered free text, so HTML-escape
  // it. Rendered only when the order has a shipping_address (legacy orders
  // pre-this-feature have none → no empty section).
  const escHtml = (v: unknown): string =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const addr: any = orderRow.shipping_address || null;
  const poNumber: string | null = orderRow.po_number || null;

  const deliveryHtml = addr
    ? `              <h3 style="margin:24px 0 8px 0; font-size:16px; font-weight:700; color:#1a1a1a;">Delivering to</h3>
              <p style="margin:0 0 16px 0; font-size:14px; line-height:1.6; color:#1a1a1a;">
                ${addr.company ? `${escHtml(addr.company)}<br>` : ""}${addr.fao ? `FAO: ${escHtml(addr.fao)}<br>` : ""}${escHtml(addr.line1)}<br>${addr.line2 ? `${escHtml(addr.line2)}<br>` : ""}${[addr.city, addr.postcode].filter(Boolean).map(escHtml).join(", ")}<br>${escHtml(addr.country)}${addr.phone ? `<br>Phone: ${escHtml(addr.phone)}` : ""}${addr.instructions ? `<br><em>Instructions: ${escHtml(addr.instructions)}</em>` : ""}${poNumber ? `<br>PO: ${escHtml(poNumber)}` : ""}
              </p>`
    : "";

  const deliveryText = addr
    ? `\n\nDelivering to:\n${addr.company ? `${addr.company}\n` : ""}${addr.fao ? `FAO: ${addr.fao}\n` : ""}${addr.line1 || ""}\n${addr.line2 ? `${addr.line2}\n` : ""}${[addr.city, addr.postcode].filter(Boolean).join(", ")}\n${addr.country || ""}${addr.phone ? `\nPhone: ${addr.phone}` : ""}${addr.instructions ? `\nInstructions: ${addr.instructions}` : ""}${poNumber ? `\nPO: ${poNumber}` : ""}`
    : "";

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
${deliveryHtml}
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

Total paid: £${totalAmount.toFixed(2)}${deliveryText}

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
      // End-to-end dedup at SMTP layer. The CAS UPDATE on
      // confirmation_email_sent_at is the primary guard; this is the
      // belt-and-braces fallback for the narrow window where both paths
      // pass the SELECT before either lands the UPDATE.
      "Idempotency-Key": `order-${orderId}-confirmation`,
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
      "[send-order-confirmation] Resend send failed:",
      resendRes.status,
      detail,
    );
    // Deliberately do NOT stamp confirmation_email_sent_at — a future call
    // (manual retry, webhook redelivery, etc.) should be free to retry.
    return { sent: false, reason: "resend_error" };
  }

  // Compare-and-swap stamp. If the other path already populated the column
  // between our SELECT and this UPDATE, .select() returns zero rows. Both
  // requests carried the same Idempotency-Key, so Resend itself dedup'd the
  // delivery — no customer-visible double send.
  const { data: stamped, error: stampErr } = await supabase
    .from("orders")
    .update({ confirmation_email_sent_at: new Date().toISOString() })
    .eq("id", orderId)
    .is("confirmation_email_sent_at", null)
    .select("id");

  if (stampErr) {
    console.error(
      "[send-order-confirmation] Failed to stamp confirmation_email_sent_at (non-fatal):",
      stampErr,
    );
  }

  if (!stamped || stamped.length === 0) {
    console.log(
      "[send-order-confirmation] confirmation_email_sent_at already set by other path; Resend Idempotency-Key dedup'd the send. Order:",
      orderRow.order_number,
    );
    return { sent: false, reason: "stamped_by_other_path" };
  }

  console.log(
    "[send-order-confirmation] Confirmation email sent to",
    customerEmail,
    "for order",
    orderRow.order_number,
  );
  return { sent: true };
}
