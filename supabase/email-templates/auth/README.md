# PGifts Auth Email Templates

Branded Supabase auth emails. Generated from `../_shell.html` + `../_bodies/*.js` via `npm run build:email-templates`. The files in this directory are the ones to paste into the Supabase Dashboard.

## Applying a template

1. Open the [Supabase Dashboard](https://app.supabase.com/project/cbcevjhvgmxrxeeyldza/auth/templates)
2. Authentication → Email Templates
3. Select the template type (see mapping below)
4. Paste the HTML from the matching file in this directory into the **Message (HTML)** field
5. Also set the **Subject** to the value from the mapping
6. Optionally paste the plain-text fallback (at the top of each file inside `<!-- ... -->`) into the plain-text field
7. Click **Save**

## Template-to-file mapping

| Supabase template type | Subject line                        | File                         |
| ---------------------- | ----------------------------------- | ---------------------------- |
| Confirm signup         | Verify your email for PGifts        | [`confirm-signup.html`](confirm-signup.html) |
| Reset password         | Reset your PGifts password          | [`reset-password.html`](reset-password.html) |
| Magic link             | Your PGifts sign-in link            | [`magic-link.html`](magic-link.html) |
| Email change           | Confirm your new email for PGifts   | [`email-change.html`](email-change.html) |

## Supabase template variables

Supabase uses Go-template syntax — always the leading-dot, spaced form:

| Variable                | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `{{ .ConfirmationURL }}` | The action link; used as the primary CTA button href |
| `{{ .Email }}`          | The recipient's email address                        |
| `{{ .SiteURL }}`        | Configured site URL; not currently used in these templates (we hard-code `https://promo-gifts-co.uk` in the footer for consistency with the Edge Function emails) |
| `{{ .Token }}`          | OTP token; not used — we send only `.ConfirmationURL` |

Do **not** use `{{variable}}` (Handlebars-style). The generator asserts `{{ .ConfirmationURL }}` survives; mis-syntaxed vars will silently fail to interpolate at send time.

## Editing

**Do not edit files in this directory directly** — they're regenerated. Edit the source:

- Shared shell (colours, header, footer, CTA button): [`../_shell.html`](../_shell.html)
- Per-template copy: [`../_bodies/<name>.js`](../_bodies/)

Then run:

```bash
npm run build:email-templates
```

from `site/`. The generator will:

- regenerate all four HTML files here
- assert no generator placeholders (`{{NAME}}`) leaked through
- assert Supabase's `{{ .ConfirmationURL }}` variable survived
- fail loudly with a non-zero exit code if either assertion trips

## Testing after applying

- **Confirm signup**: sign out, create a new account at [promo-gifts-co.uk](https://promo-gifts-co.uk), check the email. During local dev you can point Supabase Auth → URL Configuration → Site URL at `http://localhost:5173` (already allow-listed).
- **Reset password**: on the sign-in modal click "Forgot password?", enter your email, check the inbox.
- **Magic link**: only fires if passwordless sign-in is enabled in Auth settings. Not currently wired into the UI.
- **Email change**: sign in, go to Account → Settings, change the email address, confirm it from the email sent to the NEW address.

For all four, also verify the plain-text fallback by viewing the source of the delivered email.

## Design reference

See [`../BRAND_EMAIL_TOKENS.md`](../BRAND_EMAIL_TOKENS.md) for the design tokens (colours, font stack, PG badge snippet) shared with the Edge Function transactional emails.
