export default {
  preheader: "Confirm your email to activate your PGifts account.",
  heading: "Welcome to PGifts",
  ctaLabel: "Verify email",
  ctaUrl: "{{ .ConfirmationURL }}",
  supportEmail: "hello@promo-gifts.co",
  footerNote:
    "<div style=\"margin-bottom:8px;\">If you didn't create a PGifts account, you can safely ignore this email.</div>",
  bodyHtml: `              <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">Thanks for signing up. Please confirm your email address to activate your account and start designing.</p>`,
  plainText: `Welcome to PGifts

Thanks for signing up. Please confirm your email address to activate your account:

{{ .ConfirmationURL }}

If you didn't create a PGifts account, you can safely ignore this email.

— PGifts · promo-gifts-co.uk
Need help? Reply to this email or contact hello@promo-gifts.co.`,
};
