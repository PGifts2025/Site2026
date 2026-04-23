export default {
  preheader: "Your one-time PGifts sign-in link.",
  heading: "Sign in to PGifts",
  ctaLabel: "Sign in",
  ctaUrl: "{{ .ConfirmationURL }}",
  supportEmail: "hello@promo-gifts.co",
  footerNote:
    "<div style=\"margin-bottom:8px;\">This link is single-use and expires shortly. If you didn't ask to sign in, you can safely ignore this email.</div>",
  bodyHtml: `              <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">Use the link below to sign in to your PGifts account. No password required.</p>`,
  plainText: `Sign in to PGifts

Use this link to sign in — no password required:

{{ .ConfirmationURL }}

This link is single-use and expires shortly. If you didn't ask to sign in, you can safely ignore this email.

— PGifts · promo-gifts-co.uk
Need help? Reply to this email or contact hello@promo-gifts.co.`,
};
