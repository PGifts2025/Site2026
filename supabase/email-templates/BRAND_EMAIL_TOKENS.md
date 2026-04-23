# PGifts Email Design Tokens

Shared reference for the six transactional emails in this repo:

- 4 Supabase auth templates in [`auth/`](auth/) (generated from [`_shell.html`](_shell.html) + [`_bodies/`](_bodies/))
- 2 Resend emails sent from Edge Functions — [`confirm-payment`](../functions/confirm-payment/index.ts) and [`send-artwork-received-email`](../functions/send-artwork-received-email/index.ts), both using [`_shared/emailShell.ts`](../functions/_shared/emailShell.ts)

If you change a token here, mirror it in **both** `_shell.html` and `_shared/emailShell.ts` — they are the two sources of truth.

## Colours

| Token                  | Hex       | Usage                                           |
| ---------------------- | --------- | ----------------------------------------------- |
| Primary text           | `#1a1a1a` | Headings, body text, CTA button background      |
| Secondary text         | `#666`    | "Any questions" sub-text, footer links          |
| Footer muted           | `#999`    | Footer lines and timestamps                     |
| Info box bg            | `#f5f5f5` | Highlighted "next step" sections; page bg       |
| Border primary         | `#e5e5e5` | Outer card border, table header underline       |
| Border muted           | `#f0f0f0` | Row separators, header/footer dividers          |
| PG brand red           | `#ef4444` | Badge cell background only                      |
| CTA button bg          | `#1a1a1a` | Primary CTA button                              |
| CTA button text        | `#ffffff` | Primary CTA button label                        |

## Typography

System font stack — no web fonts (email clients strip them, Gmail proxies block many):

```
-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif
```

| Element           | Size | Weight | Line-height |
| ----------------- | ---- | ------ | ----------- |
| h1                | 24px | 700    | 1.25        |
| h2 (in body)      | 18px | 700    | 1.3         |
| Body paragraph    | 15px | 400    | 1.6         |
| CTA label         | 15px | 600    | n/a         |
| Table cell        | 14px | 400    | 1.4         |
| Button-fallback p | 13px | 400    | 1.5         |
| Footer text       | 12px | 400    | 1.5         |

## Layout

- 600px max-width table, centred (`align="center"`, `margin:0 auto`)
- Outer page bg: `#f5f5f5`
- Inner card: `#ffffff`, 8px radius, 1px `#e5e5e5` border
- Card padding: header 24px, content 28px 24px 8px, footer 24px
- Mobile: outer `<td>` uses `padding:24px 12px` — card shrinks to viewport width

## PG badge — CSS-rendered, not an image

```html
<td width="48" height="48" align="center" valign="middle"
    bgcolor="#ef4444"
    style="background:#ef4444; color:#ffffff; font-weight:700; font-size:18px; border-radius:24px;">
  PG
</td>
```

**Outlook desktop caveat**: Outlook's Word rendering engine strips `border-radius`, so the badge renders as a **red square** on Outlook desktop. This is accepted as an edge case — the red + white "PG" still reads as the brand. No VML fallback, documented here for future reference.

When a proper logo asset is designed and hosted (future task), swap this cell for an `<img>` in **both** `_shell.html` and `_shared/emailShell.ts` — that also closes the Outlook shape issue.

## CTA button — Outlook-safe

Table-based with `bgcolor` on the `<td>`, padding on the inner `<a>`. `border-radius:6px` degrades to a square corner on Outlook (acceptable).

```html
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td align="center" bgcolor="#1a1a1a" style="background:#1a1a1a; border-radius:6px;">
      <a href="${url}" target="_blank"
         style="display:inline-block; padding:12px 28px; color:#ffffff; text-decoration:none; font-weight:600; font-size:15px;">
        ${label}
      </a>
    </td>
  </tr>
</table>
```

Every email also includes a plain-text "If the button doesn't work, paste this link into your browser:" fallback below the button — defends against Outlook button-clipping and broken rendering.

## Footer

Two lines on every template, plus an optional per-template note slot above them:

```
[optional footer note — expiry hint, "if you didn't request this", contact support]
PGifts · promo-gifts-co.uk
Need help? Reply to this email or contact {{SUPPORT_EMAIL}}.
```

Footer text colour `#999`, links `#666`, 12px.

### Support email routing

The contact address is **per-template** so customer queries land in the right inbox:

| Template                     | Support email              |
| ---------------------------- | -------------------------- |
| Auth (all 4)                 | `hello@promo-gifts.co`     |
| `confirm-payment`            | `orders@promo-gifts.co`    |
| `send-artwork-received-email`| `artwork@promo-gifts.co`   |

- **HTML shell**: `{{SUPPORT_EMAIL}}` placeholder, substituted by the generator from each body file's `supportEmail` field (assertion-guarded — missing field fails the build)
- **TS shell**: `renderEmail({ ..., supportEmail })` — parameter is required (no default; the type system enforces caller-aware routing)

This controls footer-display text only — **not** the SMTP `Reply-To` header. Those are set independently in each Edge Function's Resend API call.

## Sender addresses

| Context         | From                             | Reply-to                  |
| --------------- | -------------------------------- | ------------------------- |
| Order flow      | `PGifts <orders@promo-gifts.co>` | `orders@promo-gifts.co`   |
| Auth (Supabase) | `hello@promo-gifts.co`           | `hello@promo-gifts.co`    |

Auth emails currently still send from `noreply@mail.app.supabase.io` — migration to `hello@promo-gifts.co` via custom SMTP (Resend) is being configured in parallel and is not part of this task.

## Accessibility

- All links have semantic text (no "click here")
- `role="presentation"` on all layout tables — screen readers skip them
- Colour contrast meets WCAG AA: `#1a1a1a` on `#ffffff` = 16.6:1; `#ffffff` on `#1a1a1a` button = 16.6:1; `#ffffff` on `#ef4444` badge = 3.8:1 (AA-passes for large/bold text)
- Preheader span is visually hidden but screen-reader accessible — populated with a concise inbox preview per template

## Constraints (do not break)

- No external stylesheets, no `<link>`, no `<style>` blocks (some clients strip them)
- No web fonts
- No JavaScript
- No tracking pixels or analytics beacons
- No remote images other than hosted brand assets (currently none — badge is CSS-rendered)
- Inline styles only; all structural attributes (`width`, `align`, `bgcolor`) duplicated for Outlook compatibility
