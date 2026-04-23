export default {
  preheader: "Reset your PGifts password.",
  heading: "Reset your password",
  ctaLabel: "Reset password",
  ctaUrl: "{{ .ConfirmationURL }}",
  supportEmail: "hello@promo-gifts.co",
  footerNote:
    "<div style=\"margin-bottom:8px;\">This link expires in an hour. If you didn't request a password reset, you can safely ignore this email — your current password won't change.</div>",
  bodyHtml: `              <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">We got a request to reset the password for <strong>{{ .Email }}</strong>. Click below to choose a new one.</p>`,
  plainText: `Reset your password

We got a request to reset the password for {{ .Email }}. Follow this link to choose a new one:

{{ .ConfirmationURL }}

This link expires in an hour. If you didn't request a password reset, you can safely ignore this email — your current password won't change.

— PGifts · promo-gifts-co.uk
Need help? Reply to this email or contact hello@promo-gifts.co.`,
};
