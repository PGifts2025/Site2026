// Internal artwork-uploaded alert — operational notification to the artwork@ inbox.
//
// Sibling to sendInternalOrderAlert.ts (PR #80). Fired server-side by an
// AFTER INSERT trigger on order_artwork (via pg_net) — one alert per uploaded
// file, so replacements and revisions each notify. NOT built on the customer
// courtesy email (send-artwork-received-email), which fires first-upload-only.
//
// From:     noreply@promo-gifts.co   (system alert; keeps customer mailboxes clean)
// To:       artwork@promo-gifts.co
// Reply-To: artwork@promo-gifts.co   (a staff reply lands back in the shared
//                                     inbox — internal coordination, not the
//                                     customer. Differs from the order alert.)
//
// Idempotency is PER UPLOAD, keyed on the artwork row (NOT the order), because
// every upload must alert. We CLAIM order_artwork.internal_alert_sent_at
// atomically:
//   UPDATE order_artwork SET internal_alert_sent_at = now()
//    WHERE id = ? AND internal_alert_sent_at IS NULL RETURNING id
// so a re-delivery of the same insert cannot double-send. On send failure the
// claim is reset to NULL, so it stays retryable and the miss-detector
// (internal_alert_sent_at IS NULL) finds it.
//
// This helper NEVER throws — an alert failure must not affect the upload.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderEmail } from "./emailShell.ts";

// Sender / recipient. Mirrors src/config/business.js (Deno cannot import src/);
// keep in sync. Same mirror pattern as emailShell.ts (CLAUDE.md §21).
const NOREPLY_FROM = "Promo Gifts <noreply@promo-gifts.co>";
const ARTWORK_INBOX = "artwork@promo-gifts.co";

// 48-hour signed download links. The admin order page is the durable route once
// the link expires (a longer bearer token in a forwardable inbox is a wider
// window than the convenience warrants — Dave's decision).
const SIGNED_URL_TTL_SECONDS = 48 * 60 * 60; // 172800

export type SendInternalArtworkAlertResult =
  | { sent: true; replacement: boolean; uploadCount: number }
  | {
    sent: false;
    reason:
      | "no_api_key"
      | "artwork_not_found"
      | "already_sent"
      | "order_soft_deleted"
      | "resend_error";
  };

const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Human-readable file size.
function fmtSize(bytes: unknown): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "unknown size";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// order_artwork.file_url is the bare storage path (legacy rows may hold a full
// URL with a /order-artwork/ marker). Mirror supabaseService.getArtworkSignedUrl.
function storagePathOf(fileUrl: string): string {
  const marker = "/order-artwork/";
  return fileUrl.includes(marker) ? fileUrl.split(marker)[1] : fileUrl;
}

// Print positions/method/dimensions from the structured print_areas jsonb
// (CLAUDE.md §43). Same shape as sendInternalOrderAlert.
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

function productCodeFromNotes(notes: unknown): string | null {
  const m = typeof notes === "string" ? notes.match(/Code:\s*(\S+)/i) : null;
  return m ? m[1] : null;
}

function formatSizeBreakdown(sb: any): string {
  if (!sb || typeof sb !== "object") return "";
  return Object.entries(sb)
    .filter(([, q]) => Number(q) > 0)
    .map(([name, q]) => `${name}: ${q}`)
    .join(", ");
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
    console.error("[internal-artwork-alert] Resend send failed:", res.status, detail);
    return false;
  }
  return true;
}

export async function sendInternalArtworkAlert(
  supabase: SupabaseClient,
  artworkId: string,
): Promise<SendInternalArtworkAlertResult> {
  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.warn("[internal-artwork-alert] RESEND_API_KEY not set — skipping");
      return { sent: false, reason: "no_api_key" };
    }

    // 1. Fetch the triggering artwork row.
    const { data: artwork, error: awErr } = await supabase
      .from("order_artwork")
      .select("id, order_id, user_id, file_name, file_url, file_type, file_size, notes, uploaded_at, created_at, internal_alert_sent_at")
      .eq("id", artworkId)
      .single();

    if (awErr || !artwork) {
      console.error("[internal-artwork-alert] artwork row not found:", artworkId, awErr);
      return { sent: false, reason: "artwork_not_found" };
    }
    if (artwork.internal_alert_sent_at) {
      return { sent: false, reason: "already_sent" };
    }

    // 2. Atomic per-upload claim — only one delivery wins.
    const { data: claimed, error: claimErr } = await supabase
      .from("order_artwork")
      .update({ internal_alert_sent_at: new Date().toISOString() })
      .eq("id", artworkId)
      .is("internal_alert_sent_at", null)
      .select("id");

    if (claimErr) {
      console.error("[internal-artwork-alert] claim update failed:", artworkId, claimErr);
      return { sent: false, reason: "resend_error" };
    }
    if (!claimed || claimed.length === 0) {
      return { sent: false, reason: "already_sent" };
    }

    // We hold the claim. A transient failure past this point MUST reset it to
    // NULL so it stays retryable and shows in the miss-detector.
    const resetClaim = async () => {
      const { error } = await supabase
        .from("order_artwork")
        .update({ internal_alert_sent_at: null })
        .eq("id", artworkId);
      if (error) {
        console.error("[internal-artwork-alert] failed to reset claim (row may show a false stamp):", artworkId, error);
      }
    };

    try {
      // 3. Order, soft-delete guarded. A soft-deleted order must not alert.
      //    Leave the claim STAMPED (intentional skip, not a failure) so a
      //    re-invocation does not send; the miss-detector joins deleted_at IS
      //    NULL so it is excluded there regardless.
      const { data: order, error: orderErr } = await supabase
        .from("orders")
        .select("id, order_number, created_at, customer_id, deleted_at, shipping_address")
        .eq("id", artwork.order_id)
        .is("deleted_at", null)
        .maybeSingle();

      if (orderErr) {
        console.error("[internal-artwork-alert] order fetch failed:", artwork.order_id, orderErr);
        await resetClaim();
        return { sent: false, reason: "resend_error" };
      }
      if (!order) {
        console.warn("[internal-artwork-alert] order missing or soft-deleted — not alerting:", artwork.order_id);
        return { sent: false, reason: "order_soft_deleted" };
      }

      // 4. All files for the order (newest first) — the alert lists the full
      //    current set so the team sees exactly what to review; the triggering
      //    upload is flagged NEW. uploadCount drives the replacement banner.
      const { data: allFilesData } = await supabase
        .from("order_artwork")
        .select("id, file_name, file_url, file_type, file_size, notes, uploaded_at, created_at")
        .eq("order_id", artwork.order_id)
        .order("created_at", { ascending: false });
      const allFiles = allFilesData && allFilesData.length > 0 ? allFilesData : [artwork];
      const uploadCount = allFiles.length;
      const isReplacement = uploadCount > 1;

      // 5. Items (for print positions + dimensions).
      const { data: itemsData } = await supabase
        .from("order_items")
        .select("product_name, quantity, color, print_areas, size_breakdown, notes, product_id")
        .eq("order_id", artwork.order_id);
      const items = itemsData || [];

      // 6. Customer name/company.
      let profile: any = null;
      if (order.customer_id) {
        const { data } = await supabase
          .from("customer_profiles")
          .select("contact_name, first_name, last_name, company_name, email")
          .eq("id", order.customer_id)
          .maybeSingle();
        profile = data;
      }
      let customerEmail: string | null = profile?.email || null;
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

      // 7. Signed 48h links for every file.
      const signed = new Map<string, string | null>();
      for (const f of allFiles) {
        try {
          const { data: s } = await supabase.storage
            .from("order-artwork")
            .createSignedUrl(storagePathOf(f.file_url), SIGNED_URL_TTL_SECONDS);
          signed.set(f.id, s?.signedUrl || null);
        } catch (e) {
          console.error("[internal-artwork-alert] signing failed for", f.id, e);
          signed.set(f.id, null);
        }
      }

      const siteUrl = Deno.env.get("SITE_URL") || "https://promo-gifts-co.uk";
      const adminUrl = `${siteUrl}/admin/orders/${order.id}`;
      const expiryAt = (() => {
        try {
          return new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toLocaleString("en-GB", {
            timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
          });
        } catch { return "in 48 hours"; }
      })();
      const fmtWhen = (v: unknown) => {
        try {
          return new Date(String(v)).toLocaleString("en-GB", {
            timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
          });
        } catch { return String(v ?? ""); }
      };
      const placedAt = fmtWhen(order.created_at);

      // ---- HTML ----
      const row = (label: string, value: string) =>
        `                <tr><td style="padding:2px 12px 2px 0; font-size:14px; color:#6b7280; vertical-align:top;">${label}</td><td style="padding:2px 0; font-size:14px; color:#1a1a1a;">${value}</td></tr>`;

      const replacementBanner = isReplacement
        ? `              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;"><tr><td style="background:#fffbeb; border:2px solid #d97706; border-radius:8px; padding:14px 16px;">
                <div style="font-size:16px; font-weight:700; color:#b45309; letter-spacing:0.5px;">REPLACEMENT ARTWORK</div>
                <div style="font-size:13px; color:#78350f; margin-top:4px;">This replaces previously uploaded artwork. There are now <strong>${uploadCount}</strong> uploads on this order. Review the newest file (marked NEW below); do NOT proof superseded artwork.</div>
              </td></tr></table>`
        : "";

      const itemsHtml = items.map((item: any) => {
        const code = productCodeFromNotes(item.notes);
        const sels = formatPrintSelections(item.print_areas);
        const selHtml = sels.length
          ? `<div style="margin-top:4px; font-size:12px; color:#6b7280;">${sels.map((s) => `<div>${esc(s)}</div>`).join("")}</div>`
          : `<div style="margin-top:4px; font-size:12px; color:#9ca3af;">No print positions recorded</div>`;
        const sizes = formatSizeBreakdown(item.size_breakdown);
        const sizeHtml = sizes
          ? `<div style="margin-top:4px; font-size:12px; color:#1a1a1a; font-weight:600;">Sizes: ${esc(sizes)}</div>`
          : "";
        return `
                <tr><td style="padding:8px 0; border-bottom:1px solid #f0f0f0; font-size:13px;">
                  <strong>${esc(item.product_name)}</strong>${code ? ` <span style="color:#6b7280;">(${esc(code)})</span>` : ""} <span style="color:#6b7280;">x ${item.quantity}</span>${item.color ? `<br><span style="color:#6b7280;">Colour: ${esc(item.color)}</span>` : ""}${sizeHtml}${selHtml}
                </td></tr>`;
      }).join("");

      const filesHtml = allFiles.map((f: any) => {
        const link = signed.get(f.id);
        const isNew = f.id === artwork.id;
        const linkHtml = link
          ? `<a href="${esc(link)}" style="color:#1d4ed8; font-weight:600; text-decoration:underline;">Download</a> <span style="color:#9ca3af; font-size:12px;">(link valid until ${esc(expiryAt)})</span>`
          : `<span style="color:#b91c1c;">Link unavailable — use the admin page</span>`;
        return `
                <tr><td style="padding:10px 0; border-bottom:1px solid #f0f0f0; font-size:13px;">
                  ${isNew ? `<span style="display:inline-block; background:#065f46; color:#fff; font-size:11px; font-weight:700; padding:1px 6px; border-radius:4px; margin-right:6px;">NEW</span>` : `<span style="display:inline-block; background:#e5e7eb; color:#6b7280; font-size:11px; padding:1px 6px; border-radius:4px; margin-right:6px;">earlier</span>`}<strong>${esc(f.file_name)}</strong>
                  <div style="color:#6b7280; margin-top:3px;">${esc(f.file_type || "file")} &middot; ${esc(fmtSize(f.file_size))} &middot; uploaded ${esc(fmtWhen(f.uploaded_at || f.created_at))}${f.notes ? ` &middot; ${esc(f.notes)}` : ""}</div>
                  <div style="margin-top:4px;">${linkHtml}</div>
                </td></tr>`;
      }).join("");

      const bodyHtml =
`${replacementBanner}              <h2 style="margin:0 0 8px 0; font-size:18px; font-weight:700; color:#1a1a1a;">Order</h2>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
${row("Order", `<strong>${esc(order.order_number)}</strong>`)}
${row("Placed", esc(placedAt))}
${row("Customer", esc(customerName))}
${company ? row("Company", esc(company)) : ""}
              </table>

              <h2 style="margin:0 0 8px 0; font-size:18px; font-weight:700; color:#1a1a1a;">Items</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse; margin:0 0 20px 0;">
                <tbody>${itemsHtml || `<tr><td style="font-size:13px; color:#9ca3af; padding:8px 0;">No line items on this order.</td></tr>`}
                </tbody>
              </table>

              <h2 style="margin:0 0 8px 0; font-size:18px; font-weight:700; color:#1a1a1a;">Artwork file${uploadCount > 1 ? "s" : ""}${uploadCount > 1 ? ` (${uploadCount})` : ""}</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse; margin:0 0 12px 0;">
                <tbody>${filesHtml}
                </tbody>
              </table>
              <p style="margin:0; font-size:12px; color:#6b7280;">Download links expire after 48 hours. The admin order page is the permanent route: <a href="${esc(adminUrl)}" style="color:#1d4ed8;">${esc(adminUrl)}</a></p>`;

      // ---- Plain-text twin ----
      const filesText = allFiles.map((f: any) => {
        const link = signed.get(f.id);
        const tag = f.id === artwork.id ? "[NEW] " : "[earlier] ";
        return `- ${tag}${f.file_name} (${f.file_type || "file"}, ${fmtSize(f.file_size)}, uploaded ${fmtWhen(f.uploaded_at || f.created_at)})${f.notes ? ` - ${f.notes}` : ""}\n    ${link ? `${link}  (valid until ${expiryAt})` : "link unavailable - use the admin page"}`;
      }).join("\n");
      const itemsText = items.map((item: any) => {
        const code = productCodeFromNotes(item.notes);
        const sels = formatPrintSelections(item.print_areas);
        const sizes = formatSizeBreakdown(item.size_breakdown);
        const head = `- ${item.product_name}${code ? ` (${code})` : ""} x${item.quantity}${item.color ? ` [${item.color}]` : ""}`;
        const extra: string[] = [];
        if (sizes) extra.push(`    Sizes: ${sizes}`);
        for (const s of sels) extra.push(`    ${s}`);
        return extra.length ? [head, ...extra].join("\n") : head;
      }).join("\n");

      const bodyText =
`${isReplacement ? `*** REPLACEMENT ARTWORK *** This replaces previously uploaded artwork. There are now ${uploadCount} uploads on this order. Review the newest (marked NEW); do not proof superseded artwork.\n\n` : ""}ORDER
Order: ${order.order_number}
Placed: ${placedAt}
Customer: ${customerName}
${company ? `Company: ${company}\n` : ""}
ITEMS
${itemsText || "No line items."}

ARTWORK FILE${uploadCount > 1 ? `S (${uploadCount})` : ""}
${filesText}

Download links expire after 48 hours. Permanent route: ${adminUrl}`;

      const subject = isReplacement
        ? `Artwork REPLACED - Order #${order.order_number} - ${customerName}`
        : `Artwork uploaded - Order #${order.order_number} - ${customerName}`;

      const { html, text } = renderEmail({
        preheader: isReplacement
          ? `Replacement artwork (upload ${uploadCount}) for ${order.order_number} from ${customerName}.`
          : `Artwork uploaded for ${order.order_number} from ${customerName}.`,
        heading: isReplacement ? `Artwork replaced - ${esc(order.order_number)}` : `Artwork uploaded - ${esc(order.order_number)}`,
        bodyHtml,
        bodyText,
        ctaLabel: "Open in admin",
        ctaUrl: adminUrl,
        supportEmail: ARTWORK_INBOX,
      });

      const payload: Record<string, unknown> = {
        from: NOREPLY_FROM,
        to: [ARTWORK_INBOX],
        reply_to: ARTWORK_INBOX,
        subject,
        html,
        text,
      };

      // Per-UPLOAD idempotency key (a second file legitimately re-alerts).
      const idemKey = `artwork-${artworkId}`;

      let ok = await postResend(resendApiKey, payload, idemKey);
      if (!ok) {
        await new Promise((r) => setTimeout(r, 500));
        ok = await postResend(resendApiKey, payload, idemKey);
      }
      if (!ok) {
        console.error("[internal-artwork-alert] send failed after retry for order", order.order_number, "artwork", artworkId);
        await resetClaim();
        return { sent: false, reason: "resend_error" };
      }

      console.log("[internal-artwork-alert] sent for order", order.order_number, "artwork", artworkId, "upload", uploadCount, isReplacement ? "(replacement)" : "(first)");
      return { sent: true, replacement: isReplacement, uploadCount };
    } catch (inner) {
      console.error("[internal-artwork-alert] build/send error for artwork", artworkId, inner);
      await resetClaim();
      return { sent: false, reason: "resend_error" };
    }
  } catch (outer) {
    // Absolute backstop — must never throw into the trigger/caller.
    console.error("[internal-artwork-alert] unexpected error:", outer);
    return { sent: false, reason: "resend_error" };
  }
}
