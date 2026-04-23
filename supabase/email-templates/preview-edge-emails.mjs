#!/usr/bin/env node
// Renders before/after preview HTML for the two Edge Function emails so a
// human reviewer can open them in a browser side-by-side.
//
// This script is REVIEW-ONLY — it is not shipped or imported by any runtime.
// It mirrors the renderEmail function from ../functions/_shared/emailShell.ts
// inline because Node can't import the Deno/TS file directly. If you change
// _shared/emailShell.ts, also update the inlined copy below, or regenerate
// these previews with the new logic. There is no automated drift check.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "previews");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// ========== MIRROR OF _shared/emailShell.ts — KEEP IN SYNC ==========
function renderEmail({ preheader, heading, bodyHtml, bodyText, ctaLabel, ctaUrl, footerNote, supportEmail }) {
  const ctaBlockHtml = (ctaLabel && ctaUrl)
    ? `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 20px 0;">
                <tr>
                  <td align="center" bgcolor="#1a1a1a" style="background:#1a1a1a; border-radius:6px;">
                    <a href="${ctaUrl}" target="_blank" style="display:inline-block; padding:12px 28px; color:#ffffff; text-decoration:none; font-weight:600; font-size:15px;">${ctaLabel}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px 0; font-size:13px; color:#666; line-height:1.5;">If the button doesn't work, paste this link into your browser:<br /><span style="word-break:break-all; color:#666;">${ctaUrl}</span></p>`
    : "";

  const footerNoteBlock = footerNote
    ? `<div style="margin-bottom:8px;">${footerNote}</div>`
    : "";

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>PGifts</title>
</head>
<body style="margin:0; padding:0; background:#f5f5f5; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#1a1a1a;">
  <span style="display:none !important; visibility:hidden; mso-hide:all; font-size:1px; color:#f5f5f5; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background:#ffffff; border-radius:8px; border:1px solid #e5e5e5;">
          <tr>
            <td style="padding:24px; border-bottom:1px solid #f0f0f0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="48" height="48" align="center" valign="middle" bgcolor="#ef4444" style="background:#ef4444; color:#ffffff; font-weight:700; font-size:18px; border-radius:24px;">PG</td>
                  <td style="padding-left:12px; font-size:18px; font-weight:700; color:#1a1a1a;">PGifts</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px 24px;">
              <h1 style="margin:0 0 12px 0; font-size:24px; font-weight:700; color:#1a1a1a; line-height:1.25;">${heading}</h1>
${bodyHtml}${ctaBlockHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px; border-top:1px solid #f0f0f0; color:#999; font-size:12px; line-height:1.5;">
              ${footerNoteBlock}
              <div>PGifts &middot; <a href="https://promo-gifts-co.uk" style="color:#666; text-decoration:none;">promo-gifts-co.uk</a></div>
              <div style="margin-top:4px;">Need help? Reply to this email or contact <a href="mailto:${supportEmail}" style="color:#666; text-decoration:underline;">${supportEmail}</a>.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const ctaText = (ctaLabel && ctaUrl) ? `\n\n${ctaLabel}: ${ctaUrl}` : "";
  const text = `${heading}\n\n${bodyText}${ctaText}\n\n— PGifts · promo-gifts-co.uk\nNeed help? Reply to this email or contact ${supportEmail}.`;
  return { html, text };
}
// ========== END MIRROR ==========

// Representative mock data matching what the live Edge Functions would compute.
const mockOrder = {
  order_number: "ORD-20260423-0042",
  total_amount: 287.64,
};
const mockItems = [
  { product_name: "Ocean Octopus", color: "Charcoal", quantity: 50, line_total: 147.5 },
  { product_name: "T-Shirts", color: "Navy", quantity: 25, line_total: 89.25 },
  { product_name: "A6 Pocket Notebook", color: null, quantity: 100, line_total: 50.89 },
];
const itemsHtmlOld = mockItems.map((item) => `
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${item.product_name}${item.color ? ` (${item.color})` : ""}</td>
        <td style="text-align: right; padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${item.quantity}</td>
        <td style="text-align: right; padding: 8px 0; border-bottom: 1px solid #f0f0f0;">£${Number(item.line_total).toFixed(2)}</td>
      </tr>`).join("");

const itemsHtmlNew = mockItems.map((item) => `
                  <tr>
                    <td style="padding:8px 0; border-bottom:1px solid #f0f0f0; font-size:14px;">${item.product_name}${item.color ? ` (${item.color})` : ""}</td>
                    <td align="right" style="text-align:right; padding:8px 0; border-bottom:1px solid #f0f0f0; font-size:14px;">${item.quantity}</td>
                    <td align="right" style="text-align:right; padding:8px 0; border-bottom:1px solid #f0f0f0; font-size:14px;">£${Number(item.line_total).toFixed(2)}</td>
                  </tr>`).join("");

// -------------------- confirm-payment: BEFORE --------------------
const confirmBefore = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a; padding: 24px;">
  <h1 style="font-size: 24px; margin: 0 0 16px 0;">Thanks for your order</h1>
  <p>We've received your payment for order <strong>${mockOrder.order_number}</strong>. Here's a quick summary:</p>

  <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
    <thead>
      <tr style="border-bottom: 2px solid #e5e5e5;">
        <th style="text-align: left; padding: 8px 0;">Item</th>
        <th style="text-align: right; padding: 8px 0;">Qty</th>
        <th style="text-align: right; padding: 8px 0;">Total</th>
      </tr>
    </thead>
    <tbody>${itemsHtmlOld}
    </tbody>
    <tfoot>
      <tr style="font-weight: bold;">
        <td colspan="2" style="padding: 12px 0 8px 0;">Total paid</td>
        <td style="text-align: right; padding: 12px 0 8px 0;">£${mockOrder.total_amount.toFixed(2)}</td>
      </tr>
    </tfoot>
  </table>

  <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 24px 0;">
    <h2 style="font-size: 18px; margin: 0 0 12px 0;">Next step &mdash; upload your artwork</h2>
    <p style="margin: 0 0 16px 0;">To move your order into production we need your artwork files &mdash; logo, design, or any print-ready artwork.</p>
    <p style="margin: 0;">
      <a href="https://promo-gifts-co.uk/account/orders" style="background: #1a1a1a; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Upload artwork</a>
    </p>
  </div>

  <p style="color: #666; font-size: 14px;">Any questions? Just reply to this email.</p>
  <p style="color: #999; font-size: 12px; margin-top: 32px;">PGifts &middot; promo-gifts-co.uk</p>
</div>`;

// -------------------- confirm-payment: AFTER --------------------
const confirmBodyHtml = `              <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">We've received your payment for order <strong>${mockOrder.order_number}</strong>. Here's a quick summary:</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse; margin:16px 0 20px 0;">
                <thead>
                  <tr style="border-bottom:2px solid #e5e5e5;">
                    <th align="left" style="text-align:left; padding:8px 0; font-size:14px;">Item</th>
                    <th align="right" style="text-align:right; padding:8px 0; font-size:14px;">Qty</th>
                    <th align="right" style="text-align:right; padding:8px 0; font-size:14px;">Total</th>
                  </tr>
                </thead>
                <tbody>${itemsHtmlNew}
                </tbody>
                <tfoot>
                  <tr style="font-weight:bold;">
                    <td colspan="2" style="padding:12px 0 8px 0; font-size:14px;">Total paid</td>
                    <td align="right" style="text-align:right; padding:12px 0 8px 0; font-size:14px;">£${mockOrder.total_amount.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 8px 0;">
                <tr>
                  <td style="background:#f5f5f5; border-radius:8px; padding:20px;">
                    <h2 style="margin:0 0 10px 0; font-size:18px; font-weight:700; color:#1a1a1a;">Next step &mdash; upload your artwork</h2>
                    <p style="margin:0; font-size:14px; line-height:1.6; color:#1a1a1a;">To move your order into production we need your artwork files &mdash; logo, design, or any print-ready artwork.</p>
                  </td>
                </tr>
              </table>`;

const confirmAfter = renderEmail({
  preheader: `Order ${mockOrder.order_number} confirmed — £${mockOrder.total_amount.toFixed(2)} paid. Upload your artwork next.`,
  heading: "Thanks for your order",
  bodyHtml: confirmBodyHtml,
  bodyText: "(text body omitted in preview)",
  ctaLabel: "Upload artwork",
  ctaUrl: "https://promo-gifts-co.uk/account/orders",
  supportEmail: "orders@promo-gifts.co",
}).html;

// -------------------- artwork-received: BEFORE --------------------
const artworkBefore = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a; padding: 24px;">
  <h1 style="font-size: 24px; margin: 0 0 16px 0;">Thanks &mdash; we've got your artwork</h1>
  <p>We've received your artwork files for order <strong>${mockOrder.order_number}</strong> and they're now with our artwork team.</p>

  <h2 style="font-size: 18px; margin: 28px 0 12px 0;">What happens next</h2>
  <p>Our team will prepare a pre-production proof and send it directly to you from <strong>artwork@promo-gifts.co</strong>. Most proofs go out the same working day, though timing depends on when your order comes in and our current workload.</p>
  <p>Please review the proof carefully when it arrives &mdash; this is your chance to request any changes before we go to print. Simply reply to the proof email with your approval or any amendments.</p>

  <h2 style="font-size: 18px; margin: 28px 0 12px 0;">Your order</h2>
  <table style="width: 100%; border-collapse: collapse; margin: 0 0 24px 0;">
    <thead>
      <tr style="border-bottom: 2px solid #e5e5e5;">
        <th style="text-align: left; padding: 8px 0;">Item</th>
        <th style="text-align: right; padding: 8px 0;">Qty</th>
        <th style="text-align: right; padding: 8px 0;">Total</th>
      </tr>
    </thead>
    <tbody>${itemsHtmlOld}
    </tbody>
    <tfoot>
      <tr style="font-weight: bold;">
        <td colspan="2" style="padding: 12px 0 8px 0;">Total paid</td>
        <td style="text-align: right; padding: 12px 0 8px 0;">£${mockOrder.total_amount.toFixed(2)}</td>
      </tr>
    </tfoot>
  </table>

  <p style="margin: 24px 0;">
    <a href="https://promo-gifts-co.uk/account/orders" style="background: #1a1a1a; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">View order</a>
  </p>

  <p style="color: #666; font-size: 14px;">Any questions in the meantime? Just reply to this email.</p>
  <p style="color: #999; font-size: 12px; margin-top: 32px;">PGifts &middot; promo-gifts-co.uk</p>
</div>`;

// -------------------- artwork-received: AFTER --------------------
const artworkBodyHtml = `              <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">We've received your artwork files for order <strong>${mockOrder.order_number}</strong> and they're now with our artwork team.</p>
              <h2 style="margin:24px 0 10px 0; font-size:18px; font-weight:700; color:#1a1a1a;">What happens next</h2>
              <p style="margin:0 0 12px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">Our team will prepare a pre-production proof and send it directly to you from <strong>artwork@promo-gifts.co</strong>. Proofs sent within the next couple of hours, though timing depends on when your order comes in and our current workload.</p>
              <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">Please review the proof carefully when it arrives &mdash; this is your chance to request any changes before we go to print. Simply reply to the proof email with your approval or any amendments.</p>
              <h2 style="margin:24px 0 10px 0; font-size:18px; font-weight:700; color:#1a1a1a;">Your order</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse; margin:0 0 16px 0;">
                <thead>
                  <tr style="border-bottom:2px solid #e5e5e5;">
                    <th align="left" style="text-align:left; padding:8px 0; font-size:14px;">Item</th>
                    <th align="right" style="text-align:right; padding:8px 0; font-size:14px;">Qty</th>
                    <th align="right" style="text-align:right; padding:8px 0; font-size:14px;">Total</th>
                  </tr>
                </thead>
                <tbody>${itemsHtmlNew}
                </tbody>
                <tfoot>
                  <tr style="font-weight:bold;">
                    <td colspan="2" style="padding:12px 0 8px 0; font-size:14px;">Total paid</td>
                    <td align="right" style="text-align:right; padding:12px 0 8px 0; font-size:14px;">£${mockOrder.total_amount.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>`;

const artworkAfter = renderEmail({
  preheader: `Artwork received for order ${mockOrder.order_number} — proof coming soon.`,
  heading: "Thanks — we've got your artwork",
  bodyHtml: artworkBodyHtml,
  bodyText: "(text body omitted in preview)",
  ctaLabel: "View order",
  ctaUrl: "https://promo-gifts-co.uk/account/orders",
  supportEmail: "artwork@promo-gifts.co",
}).html;

writeFileSync(join(outDir, "confirm-payment-before.html"), confirmBefore);
writeFileSync(join(outDir, "confirm-payment-after.html"), confirmAfter);
writeFileSync(join(outDir, "send-artwork-received-before.html"), artworkBefore);
writeFileSync(join(outDir, "send-artwork-received-after.html"), artworkAfter);
console.log("Wrote 4 preview files to", outDir);
