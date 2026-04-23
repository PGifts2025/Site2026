// Shared transactional-email shell. Produces branded HTML + plain-text
// wrapping around caller-provided bodyHtml / bodyText for PGifts emails.
//
// Design tokens: see supabase/email-templates/BRAND_EMAIL_TOKENS.md
// If you change the visual shell here, mirror it in
// supabase/email-templates/_shell.html so auth emails stay consistent.
//
// bodyHtml is trusted caller-provided HTML — NOT sanitised. Callers must
// escape any user-supplied data themselves before passing it in. This matches
// the pre-refactor behaviour of confirm-payment and send-artwork-received-email.

type EmailShellArgs = {
  preheader: string;
  heading: string;
  bodyHtml: string;
  bodyText: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
  // Support mailbox shown in the shared footer. Required — callers must pass
  // the mailbox that routes this email's replies correctly (orders@ for
  // order flow, artwork@ for artwork-status flow, hello@ for general /
  // auth emails). See supabase/email-templates/BRAND_EMAIL_TOKENS.md.
  supportEmail: string;
};

export function renderEmail({
  preheader,
  heading,
  bodyHtml,
  bodyText,
  ctaLabel,
  ctaUrl,
  footerNote,
  supportEmail,
}: EmailShellArgs): { html: string; text: string } {
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
