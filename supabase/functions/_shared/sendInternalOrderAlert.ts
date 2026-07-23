// Internal new-order alert — operational notification to the orders@ inbox.
//
// Sent IN ADDITION to the customer-facing confirmation (sendOrderConfirmation).
// Deliberately NOT built on that helper: it early-returns on already_sent and
// no_customer_email, and an order with a missing customer email is precisely
// the case the team most needs to see.
//
// From:     noreply@promo-gifts.co   (system alert; keeps customer mailboxes clean)
// To:       orders@promo-gifts.co
// Reply-To: the customer's email (Reply in Outlook reaches the customer).
//
// Exactly-once across the two payment paths (confirm-payment redirect +
// stripe-webhook): we CLAIM orders.internal_alert_sent_at atomically
//   UPDATE orders SET internal_alert_sent_at = now()
//    WHERE id = ? AND internal_alert_sent_at IS NULL RETURNING id
// so only one path proceeds to send. On send failure the claim is reset to
// NULL, so it stays retryable and the miss-detector query finds it.
//
// This helper NEVER throws — payment must not be affected by an alert failure.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderEmail } from "./emailShell.ts";

// Sender / recipient. MIRRORS src/config/business.js (Deno cannot import from
// src/); keep in sync if the constants module changes. Same mirror pattern as
// emailShell.ts (CLAUDE.md §21).
const NOREPLY_FROM = "Promo Gifts <noreply@promo-gifts.co>";
const INTERNAL_ORDERS_INBOX = "orders@promo-gifts.co";

export interface StripeSessionLike {
  customer_email?: string | null;
}

export type SendInternalOrderAlertResult =
  | { sent: true }
  | {
    sent: false;
    reason:
      | "no_api_key"
      | "order_not_found"
      | "already_sent"
      | "resend_error";
  };

const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const money = (v: unknown): string => `£${(Number(v) || 0).toFixed(2)}`;

// Print positions/method from the structured print_areas jsonb (CLAUDE.md §43).
function formatPrintSelections(pa: any): string[] {
  if (!pa) return [];
  if (typeof pa === "string") return [pa];
  if (pa && Array.isArray(pa.selections)) {
    return pa.selections.map((s: any) => {
      const detail: string[] = [];
      if (s.type) detail.push(String(s.type));
      if (s.area) detail.push(String(s.area));
      if (s.num_colours) detail.push(`${s.num_colours} colour${s.num_colours > 1 ? "s" : ""}`);
      const pos = s.position ? String(s.position) : "";
      return detail.length > 0 ? `${pos}: ${detail.join(", ")}` : pos;
    }).filter(Boolean);
  }
  return [];
}

// Laltex items carry "Supplier: X | Code: YYY" in notes; surface the code.
function productCodeFromNotes(notes: unknown): string | null {
  const m = typeof notes === "string" ? notes.match(/Code:\s*(\S+)/i) : null;
  return m ? m[1] : null;
}

async function postResend(
  apiKey: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // End-to-end dedup at Resend, belt-and-braces to the atomic DB claim.
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error("[internal-order-alert] Resend send failed:", res.status, detail);
    return false;
  }
  return true;
}

export async function sendInternalOrderAlert(
  supabase: SupabaseClient,
  orderId: string,
  stripeSession: StripeSessionLike,
): Promise<SendInternalOrderAlertResult> {
  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.warn("[internal-order-alert] RESEND_API_KEY not set — skipping");
      return { sent: false, reason: "no_api_key" };
    }

    // Fetch the order. No deleted_at filter: the alert fires at confirmation,
    // before any soft-delete could apply (audit §8).
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select(
        "id, order_number, created_at, payment_status, payment_intent_id, subtotal, tax_amount, total_amount, shipping_address, po_number, customer_id, internal_alert_sent_at",
      )
      .eq("id", orderId)
      .single();

    if (orderErr || !order) {
      console.error("[internal-order-alert] order not found:", orderId, orderErr);
      return { sent: false, reason: "order_not_found" };
    }

    if (order.internal_alert_sent_at) {
      return { sent: false, reason: "already_sent" };
    }

    // Atomic claim — only one path wins. If no row comes back, another path
    // already claimed (and is sending / has sent), so skip.
    const { data: claimed, error: claimErr } = await supabase
      .from("orders")
      .update({ internal_alert_sent_at: new Date().toISOString() })
      .eq("id", orderId)
      .is("internal_alert_sent_at", null)
      .select("id");

    if (claimErr) {
      console.error("[internal-order-alert] claim update failed:", orderId, claimErr);
      return { sent: false, reason: "resend_error" };
    }
    if (!claimed || claimed.length === 0) {
      return { sent: false, reason: "already_sent" };
    }

    // We hold the claim. Any failure past this point MUST reset it to NULL.
    const resetClaim = async () => {
      const { error } = await supabase
        .from("orders")
        .update({ internal_alert_sent_at: null })
        .eq("id", orderId);
      if (error) {
        console.error("[internal-order-alert] failed to reset claim (order may show a false stamp):", orderId, error);
      }
    };

    try {
      const { data: itemsData } = await supabase
        .from("order_items")
        .select("product_name, quantity, unit_price, color, print_areas, taxable_net_unit, line_vat, notes, product_id")
        .eq("order_id", orderId);
      const items = itemsData || [];

      let profile: any = null;
      if (order.customer_id) {
        const { data } = await supabase
          .from("customer_profiles")
          .select("contact_name, first_name, last_name, company_name, phone, email")
          .eq("id", order.customer_id)
          .maybeSingle();
        profile = data;
      }

      // Reply-To target: Stripe session first, then profile, then auth.users.
      let customerEmail: string | null = stripeSession?.customer_email || profile?.email || null;
      if (!customerEmail && order.customer_id) {
        const { data } = await supabase.auth.admin.getUserById(order.customer_id);
        customerEmail = data?.user?.email || null;
      }

      const customerName =
        profile?.contact_name ||
        [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
        order.shipping_address?.fao ||
        (customerEmail ? customerEmail.split("@")[0] : null) ||
        "Unknown";
      const company = order.shipping_address?.company || profile?.company_name || null;
      const phone = order.shipping_address?.phone || profile?.phone || null;

      const subtotal = Number(order.subtotal) || 0;
      const vat = Number(order.tax_amount) || 0;
      const total = Number(order.total_amount) || 0;
      const hasZeroRated = items.some((i: any) => i.taxable_net_unit != null);

      const siteUrl = Deno.env.get("SITE_URL") || "https://promo-gifts-co.uk";
      const adminUrl = `${siteUrl}/admin/orders/${order.id}`;

      const placedAt = (() => {
        try {
          return new Date(order.created_at).toLocaleString("en-GB", {
            timeZone: "Europe/London",
            day: "numeric", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit",
          });
        } catch {
          return String(order.created_at);
        }
      })();

      // ---- HTML body (indented to the shell's 14-space content column) ----
      const row = (label: string, value: string) =>
        `                <tr><td style="padding:2px 12px 2px 0; font-size:14px; color:#6b7280; vertical-align:top;">${label}</td><td style="padding:2px 0; font-size:14px; color:#1a1a1a;">${value}</td></tr>`;

      const itemsHtml = items.map((item: any) => {
        const code = productCodeFromNotes(item.notes);
        const sels = formatPrintSelections(item.print_areas);
        const selHtml = sels.length
          ? `<div style="margin-top:4px; font-size:12px; color:#6b7280;">${sels.map((s) => `<div>${esc(s)}</div>`).join("")}</div>`
          : "";
        return `
                <tr>
                  <td style="padding:8px 0; border-bottom:1px solid #f0f0f0; font-size:13px;">
                    <strong>${esc(item.product_name)}</strong>${code ? ` <span style="color:#6b7280;">(${esc(code)})</span>` : ""}${item.color ? `<br><span style="color:#6b7280;">Colour: ${esc(item.color)}</span>` : ""}${selHtml}
                  </td>
                  <td style="padding:8px 0; border-bottom:1px solid #f0f0f0; text-align:center; font-size:13px; vertical-align:top;">${item.quantity}</td>
                  <td style="padding:8px 0; border-bottom:1px solid #f0f0f0; text-align:right; font-size:13px; vertical-align:top;">${money(item.unit_price)}</td>
                  <td style="padding:8px 0; border-bottom:1px solid #f0f0f0; text-align:right; font-size:13px; vertical-align:top;">${money((Number(item.unit_price) || 0) * (Number(item.quantity) || 0))}</td>
                </tr>`;
      }).join("");

      const addr = order.shipping_address;
      const deliveryHtml = addr
        ? `              <p style="margin:0 0 16px 0; font-size:14px; line-height:1.6; color:#1a1a1a;">
                ${addr.company ? `${esc(addr.company)}<br>` : ""}${addr.fao ? `FAO: ${esc(addr.fao)}<br>` : ""}${esc(addr.line1)}<br>${addr.line2 ? `${esc(addr.line2)}<br>` : ""}${[addr.city, addr.postcode].filter(Boolean).map(esc).join(", ")}<br>${esc(addr.country)}${addr.instructions ? `<br><em>Instructions: ${esc(addr.instructions)}</em>` : ""}${order.po_number ? `<br>PO: ${esc(order.po_number)}` : ""}
              </p>`
        : `              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;"><tr><td style="background:#fef2f2; border:2px solid #dc2626; border-radius:8px; padding:14px 16px;">
                <div style="font-size:16px; font-weight:700; color:#b91c1c; letter-spacing:0.5px;">DELIVERY ADDRESS REQUIRED</div>
                <div style="font-size:13px; color:#7f1d1d; margin-top:4px;">No delivery address on this order yet. Common for B2B (paid before the recipient is known); chase the customer before dispatch.</div>
              </td></tr></table>`;

      const zeroRatedNote = hasZeroRated
        ? `              <p style="margin:6px 0 0 0; font-size:12px; color:#92400e; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:8px 10px;">This order contains a zero-rated line (children's clothing). VAT is charged on the print/services portion only, so the VAT figure is NOT 20% of subtotal. This is correct, not an error.</p>`
        : "";

      const bodyHtml =
`              <h2 style="margin:0 0 8px 0; font-size:18px; font-weight:700; color:#1a1a1a;">Order</h2>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
${row("Order", `<strong>${esc(order.order_number)}</strong>`)}
${row("Placed", esc(placedAt))}
${row("Payment", esc(order.payment_status || "unknown"))}
${row("Payment intent", esc(order.payment_intent_id || "n/a"))}
              </table>

              <h2 style="margin:0 0 8px 0; font-size:18px; font-weight:700; color:#1a1a1a;">Customer</h2>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
${row("Name", esc(customerName))}
${row("Email", customerEmail ? esc(customerEmail) : `<span style="color:#b91c1c;">not supplied</span>`)}
${company ? row("Company", esc(company)) : ""}
${phone ? row("Phone", esc(phone)) : ""}
              </table>

              <h2 style="margin:0 0 8px 0; font-size:18px; font-weight:700; color:#1a1a1a;">Delivery</h2>
${deliveryHtml}

              <h2 style="margin:0 0 8px 0; font-size:18px; font-weight:700; color:#1a1a1a;">Items</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse; margin:0 0 8px 0;">
                <thead><tr style="border-bottom:2px solid #e5e5e5;">
                  <th align="left" style="text-align:left; padding:6px 0; font-size:12px; color:#6b7280;">Item</th>
                  <th align="center" style="text-align:center; padding:6px 0; font-size:12px; color:#6b7280;">Qty</th>
                  <th align="right" style="text-align:right; padding:6px 0; font-size:12px; color:#6b7280;">Unit (ex VAT)</th>
                  <th align="right" style="text-align:right; padding:6px 0; font-size:12px; color:#6b7280;">Line net</th>
                </tr></thead>
                <tbody>${itemsHtml}
                </tbody>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0 0 0;">
                <tr><td style="text-align:right; font-size:14px; color:#6b7280; padding:2px 0;">Subtotal (ex VAT): <span style="color:#1a1a1a; display:inline-block; min-width:90px; text-align:right;">${money(subtotal)}</span></td></tr>
                <tr><td style="text-align:right; font-size:14px; color:#6b7280; padding:2px 0;">VAT: <span style="color:#1a1a1a; display:inline-block; min-width:90px; text-align:right;">${money(vat)}</span></td></tr>
                <tr><td style="text-align:right; font-size:16px; font-weight:700; color:#1a1a1a; padding:6px 0 0 0;">Total: <span style="display:inline-block; min-width:90px; text-align:right;">${money(total)}</span></td></tr>
              </table>
${zeroRatedNote}`;

      // ---- Plain-text twin ----
      const itemsText = items.map((item: any) => {
        const code = productCodeFromNotes(item.notes);
        const sels = formatPrintSelections(item.print_areas);
        const head = `- ${item.product_name}${code ? ` (${code})` : ""}${item.color ? ` [${item.color}]` : ""} x${item.quantity} @ ${money(item.unit_price)} = ${money((Number(item.unit_price) || 0) * (Number(item.quantity) || 0))}`;
        return sels.length ? [head, ...sels.map((s) => `    ${s}`)].join("\n") : head;
      }).join("\n");

      const deliveryText = addr
        ? `${addr.company ? `${addr.company}\n` : ""}${addr.fao ? `FAO: ${addr.fao}\n` : ""}${addr.line1 || ""}\n${addr.line2 ? `${addr.line2}\n` : ""}${[addr.city, addr.postcode].filter(Boolean).join(", ")}\n${addr.country || ""}${addr.instructions ? `\nInstructions: ${addr.instructions}` : ""}${order.po_number ? `\nPO: ${order.po_number}` : ""}`
        : "*** DELIVERY ADDRESS REQUIRED *** No delivery address on this order yet.";

      const bodyText =
`ORDER
Order: ${order.order_number}
Placed: ${placedAt}
Payment: ${order.payment_status || "unknown"}
Payment intent: ${order.payment_intent_id || "n/a"}

CUSTOMER
Name: ${customerName}
Email: ${customerEmail || "NOT SUPPLIED"}
${company ? `Company: ${company}\n` : ""}${phone ? `Phone: ${phone}\n` : ""}
DELIVERY
${deliveryText}

ITEMS
${itemsText}

Subtotal (ex VAT): ${money(subtotal)}
VAT: ${money(vat)}
Total: ${money(total)}
${hasZeroRated ? "\nNote: zero-rated line present; VAT is not 20% of subtotal (correct).\n" : ""}
Open in admin: ${adminUrl}`;

      const { html, text } = renderEmail({
        preheader: `New paid order ${order.order_number} from ${customerName} for ${money(total)}.`,
        heading: `New order ${esc(order.order_number)}`,
        bodyHtml,
        bodyText,
        ctaLabel: "Open in admin",
        ctaUrl: adminUrl,
        supportEmail: INTERNAL_ORDERS_INBOX,
      });

      const payload: Record<string, unknown> = {
        from: NOREPLY_FROM,
        to: [INTERNAL_ORDERS_INBOX],
        subject: `New Order #${order.order_number} - ${customerName} - ${money(total)}`,
        html,
        text,
      };
      if (customerEmail) payload.reply_to = customerEmail;

      // Idempotency-Key (HTTP header, belt-and-braces to the atomic DB claim).
      const idemKey = `internal-alert-${orderId}`;

      // Send with one in-function retry.
      let ok = await postResend(resendApiKey, payload, idemKey);
      if (!ok) {
        await new Promise((r) => setTimeout(r, 500));
        ok = await postResend(resendApiKey, payload, idemKey);
      }

      if (!ok) {
        console.error("[internal-order-alert] send failed after retry for order", order.order_number);
        await resetClaim();
        return { sent: false, reason: "resend_error" };
      }

      console.log("[internal-order-alert] sent for order", order.order_number);
      return { sent: true };
    } catch (inner) {
      console.error("[internal-order-alert] build/send error for order", orderId, inner);
      await resetClaim();
      return { sent: false, reason: "resend_error" };
    }
  } catch (outer) {
    // Absolute backstop — must never throw into the payment caller.
    console.error("[internal-order-alert] unexpected error:", outer);
    return { sent: false, reason: "resend_error" };
  }
}
