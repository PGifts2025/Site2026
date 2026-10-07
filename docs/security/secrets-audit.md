# Secrets audit — 7 Oct 2026

Inventory of every secret and public config value, where it lives, who uses it, and whether
it can reach a browser. Values are never recorded here — names only.

## Exposure checks (done)
| Check | Result |
|---|---|
| Live production JavaScript (`promo-gifts-co.uk`, all 4 bundles, 7 Oct) | Only the **anon** JWT present. No service-role JWT, no `sb_secret_` key. |
| Git history (all branches, 347 commits, every diff incl. deleted files) | No service-role key, no `sb_secret_`, **no JWT of any kind**. Only env file ever committed: `.env.example` (placeholders). |
| Client source `src/` | No `VITE_*SERVICE_ROLE*` usage after the `[TEST]` helper was removed (PR #112). |
| Database functions in `public` | No literal secrets (patterns `sk_live_`, `sk_test_`, `whsec_`, `re_…`, JWT). The artwork-alert trigger reads its shared secret from **Supabase Vault**. |
| Ongoing | `npm run security:check` check 11 scans `src/` + the built bundle on every PR and nightly. |

**Conclusion:** no secret has been exposed; no rotation is required by this audit.

## Inventory

### Vercel (project `site2026`) — checked by Dave, 7 Oct
| Name | Scope | Client-safe? | Used by |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Prod + Preview | ✅ public | browser client, `api/` fallback |
| `VITE_SUPABASE_ANON_KEY` | Prod + Preview | ✅ public (RLS is the protection) | browser client, `api/` fallback |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Prod + Preview | ✅ public | browser |
| `VITE_AI_CHAT_PUBLIC_ENABLED` | Prod + Preview | ✅ flag | AI chat widget |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod + Preview | ❌ server-only | `api/` (AI chat, search, crons, admin recompute) |
| `CRON_SECRET` | Prod + Preview | ❌ server-only | `api/` cron + internal search auth |
| `LALTEX_API_KEY` | Prod + Preview | ❌ server-only | Laltex sync / stock crons |
| `OPENAI_API_KEY` | Prod + Preview | ❌ server-only | embeddings |
| `ANTHROPIC_API_KEY` | Prod + Preview | ❌ server-only | AI chat |
| `VISITOR_HASH_SALT` | Prod + Preview | ❌ server-only | AI quota / IP-hash rate limiter |

⚠️ **Preview deployments use the production service-role key** (and production data). Any
preview build can read/write everything. **Fix with the staging project:** Preview-scoped
`SUPABASE_SERVICE_ROLE_KEY` / `VITE_SUPABASE_*` pointing at staging.

Code also reads `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AI_CHAT_SELF_BASE_URL` as optional
fallbacks — not set in Vercel, which is fine.

### Supabase Edge Function secrets (project `cbcevjhvgmxrxeeyldza`)
| Name | Notes |
|---|---|
| `STRIPE_SECRET_KEY` | **Live** key (`cs_live_` sessions observed 7 Oct). CLAUDE.md §2 still says test — corrected in §64. |
| `STRIPE_WEBHOOK_SECRET` | Verifies `stripe-webhook` |
| `RESEND_API_KEY` | Transactional email |
| `ARTWORK_ALERT_SECRET` | Shared secret for `send-internal-artwork-alert` (also in Vault for the DB trigger) |
| `SITE_URL` | Not secret |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` | Platform-managed; injected automatically |

### GitHub (`PGifts2025/Site2026`) — to add for the security-check workflow
| Kind | Name | Value |
|---|---|---|
| Secret | `SECURITY_CHECK_DATABASE_URL` | Read-only `security_check` role via the IPv4 pooler (from `site/.env.security-check.local`) |
| Variable | `SUPABASE_URL` | `https://cbcevjhvgmxrxeeyldza.supabase.co` |
| Variable | `SUPABASE_ANON_KEY` | the anon key (public) |

**Never** add the service-role key, a personal access token, or Stripe/Resend keys to GitHub.

### Local developer machine (`site/.env`, gitignored)
Holds `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ACCESS_TOKEN` (a personal access token with
**account-wide** Supabase access) for scripts and migrations. Never commit; never paste into
chat, PRs or issues.

### Database roles
`security_check` — LOGIN, read-only sessions, no data access (verified: `orders`,
`customer_profiles`, `auth.users` denied; writes denied). Password only in the GitHub secret
and the local `.env.security-check.local`.

## Rotation plan
| Secret | When | How |
|---|---|---|
| Any secret suspected exposed | Immediately | Rotate at the provider, update Vercel / Supabase / GitHub, redeploy, note in `incidents.md` |
| `SUPABASE_SERVICE_ROLE_KEY` | When staging lands (separate key for Preview) and yearly | Supabase → Settings → API keys (new secret key), update Vercel + `.env`, redeploy |
| `SUPABASE_ACCESS_TOKEN` (PAT) | Every 90 days; on laptop loss | Supabase → Account → Access Tokens; prefer an expiry date |
| `STRIPE_SECRET_KEY` | Yearly; consider a **restricted key** (Checkout Sessions write + read only) | Stripe → Developers → API keys → `supabase secrets set` |
| `STRIPE_WEBHOOK_SECRET` | With the webhook endpoint | Stripe → Webhooks → roll secret |
| `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LALTEX_API_KEY` | Yearly | Provider console → Vercel / Supabase |
| `CRON_SECRET`, `VISITOR_HASH_SALT`, `ARTWORK_ALERT_SECRET` | Yearly (salt rotation resets anonymous AI quotas) | Generate random, update everywhere it is used |
| `security_check` password | Yearly or on suspicion | `ALTER ROLE security_check PASSWORD '…'` → update the GitHub secret |
