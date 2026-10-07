# Dashboard security settings — checklist

Settings that live in provider dashboards (not in code). **List only** — review and change
by hand; tick and date each one. Items marked ⚠️ are the most valuable.

## Supabase (project `cbcevjhvgmxrxeeyldza`)

**Authentication → Sign In / Providers**
- [ ] Email confirmation **on** (it is today — keep it).
- [ ] ⚠️ **Prevent use of leaked passwords** (HaveIBeenPwned check) — on (Pro plan feature).
- [ ] Minimum password length ≥ 10, require letters + digits.
- [ ] Secure email change (confirm on both old and new address) — on.
- [ ] ⚠️ **CAPTCHA** (Cloudflare Turnstile or hCaptcha) on sign-up, sign-in and password reset — sign-up is open to anyone and is the entry point for abuse.
- [ ] Disable providers you don't use (phone, OAuth) so they can't be enabled by mistake.

**Authentication → URL Configuration**
- [ ] Site URL = `https://promo-gifts-co.uk`.
- [ ] Redirect URLs: only `https://promo-gifts-co.uk/**`, `http://localhost:5180/**` and (later) the staging/preview pattern. No wildcards on other domains.

**Authentication → Rate limits / Sessions**
- [ ] Review email-send, sign-up and token-refresh rate limits.
- [ ] JWT expiry ≤ 1 hour (default 3600 s).

**API (Data API)**
- [ ] ⚠️ **Exposed schemas: `public` only** (and `graphql_public` only if GraphQL is used). Never expose `auth`, `storage`, `vault` or private schemas.
- [ ] Max rows per request: keep the default (1000) or lower.
- [ ] Consider moving to the new publishable / secret API keys and disabling the legacy JWT keys afterwards.

**Database**
- [ ] ⚠️ **Enforce SSL** on connections — on.
- [ ] Network restrictions: allow-list the IPs that need direct DB access (or leave open and rely on the pooler + strong passwords — decide explicitly).
- [ ] Review Security Advisor (Database → Advisors) — it flags RLS-off tables and exposed definer functions; `npm run security:check` should agree with it.
- [ ] Point-in-time recovery / backups: confirm what the plan provides and that a restore has been tried once.

**Storage**
- [ ] Every bucket clients can write to has a size limit and MIME list (`security:check` check 8).
- [ ] `logos` and `uploads` buckets (public, 8 old test files, guessable names): retire, or make private.

**Organisation / account**
- [ ] ⚠️ **MFA on every Supabase account** with access to the organisation.
- [ ] Review organisation members; remove anyone who no longer needs access.
- [ ] Personal access tokens: give each an expiry date; delete unused ones.

## Vercel (project `site2026`, team `davepgs-projects`)
- [ ] ⚠️ **Preview env vars point at staging, not production** (today Preview uses the production service-role key — see `secrets-audit.md`).
- [ ] Mark server-only variables as **Sensitive** (values hidden after save).
- [ ] Deployment Protection: Vercel Authentication on for Preview deployments (it is today — keep it).
- [ ] Git fork protection: on (don't build PRs from forks with secrets).
- [ ] Team members: 2FA required; remove unused members.
- [ ] Confirm the plan allows commercial use (Hobby does not).

## GitHub (`PGifts2025/Site2026`)
- [ ] ⚠️ **Branch protection on `main`**: require a PR, require the `security-check` status check to pass, block force-pushes.
- [ ] 2FA required for all collaborators.
- [ ] Secret scanning + push protection — on (free for public repos; check availability for private).
- [ ] Dependabot security updates — on.
- [ ] Actions: allow only GitHub-authored and verified actions; default `GITHUB_TOKEN` permissions read-only.

## Stripe
- [ ] ⚠️ Replace the full live secret key with a **restricted key** (Checkout Sessions + read access) for `create-checkout-session` / `confirm-payment`.
- [ ] Webhook endpoint only subscribes to `checkout.session.completed` and `charge.refunded`.
- [ ] 2FA on all Stripe users; review team roles.
- [ ] Radar rules reviewed for card-testing protection.

## Resend
- [ ] SPF, DKIM and DMARC published for `promo-gifts.co` (DMARC at least `p=quarantine` once reports are clean).
- [ ] API keys scoped to "sending access" for the domain only; one key per environment.
