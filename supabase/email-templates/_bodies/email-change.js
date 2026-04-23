export default {
  preheader: "Confirm your new email address for PGifts.",
  heading: "Confirm your new email",
  ctaLabel: "Confirm new email",
  ctaUrl: "{{ .ConfirmationURL }}",
  supportEmail: "hello@promo-gifts.co",
  footerNote:
    "<div style=\"margin-bottom:8px;\">If you didn't request this change, contact us at <a href=\"mailto:hello@promo-gifts.co\" style=\"color:#666; text-decoration:underline;\">hello@promo-gifts.co</a> straight away.</div>",
  bodyHtml: `              <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">You asked to change your PGifts email address to <strong>{{ .Email }}</strong>. Click below to confirm.</p>`,
  plainText: `Confirm your new email

You asked to change your PGifts email address to {{ .Email }}. Follow this link to confirm:

{{ .ConfirmationURL }}

If you didn't request this change, contact us at hello@promo-gifts.co straight away.

— PGifts · promo-gifts-co.uk
Need help? Reply to this email or contact hello@promo-gifts.co.`,
};
