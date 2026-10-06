# Audit — Email Verification Callback Flow (read-only)

> Scope: trace signup → verification-email → link-click → landing, to explain why a new customer who clicks the verification link arrives on the homepage with no confirmation (and apparently no session). No source changed. Live evidence gathered via Playwright MCP against canonical `main` (`9190cce`).

## TL;DR — root cause

Two application-level faults combine, and both are in `src/context/AuthContext.jsx` + the route table:

1. **`signUp` does not pass `options.emailRedirectTo`** (AuthContext.jsx L86-95). `emailRedirectTo` appears **nowhere** in `src/` (verified by grep). So the confirmation link's `redirect_to` falls back to the bare Site URL `https://promo-gifts-co.uk/` — the customer lands on the **homepage**.
2. **There is no callback handler.** No `/auth/callback`, `/auth/confirm`, or `/verify` route exists in `App.jsx`; the only URL-token handler is `/reset-password`. The homepage (`Home.jsx`) contains no logic that inspects the URL for verification tokens or announces a successful verification. The auth listener that *does* fire (`onAuthStateChange` in AuthContext) sets state **silently** — no toast, no redirect, no "verified" message.

So even in the best case (session established), the customer gets **zero feedback**. The "no confirmation that verification succeeded" half of the bug is fully explained at the code level.

**The "no signed-in session" half is flow-dependent and I could not fully verify it without inbox access** (see §6). The live client uses **implicit** flow with `detectSessionInUrl: true`, which *should* auto-establish a session from a `#access_token` hash on any page it lands on (including `/`). So the live behaviour is most likely either (a) the session silently establishes and the customer simply isn't told, or (b) the confirmation redirect carries no tokens, leaving genuinely no session. **The recommended fix (§9) resolves both cases identically**, so the ambiguity does not block the fix.

This matches the prompt's stated combination: no `emailRedirectTo` **and** no callback route **is** the cause.

---

## 1. Signup call site

- **Form** lives in [`src/components/auth/AuthModal.jsx`](src/components/auth/AuthModal.jsx); on submit it calls `signUp(...)` from the auth context (`handleSignUp`, L94-136 → `signUp({...})` L114).
- **Actual Supabase call** — [`src/context/AuthContext.jsx` L83-95](src/context/AuthContext.jsx#L83-L95):

```jsx
const signUp = async ({ email, password, firstName, lastName, companyName, phone }) => {
  try {
    // 1. Create auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName
        }
      }
    });
```

- **Critical:** the call passes `options.data` only. **No `options.emailRedirectTo`.** Grep across the whole `src/` tree returns **zero** matches for `emailRedirectTo`. This is the primary fault: the confirmation link will use the project Site URL as its redirect target, dropping the customer on `/` with no designated handler.
- (Aside, unrelated to this bug: `signUp` then inserts into `customer_profiles`, L100-110. Not relevant to verification.)

## 2. Supabase client configuration

[`src/services/supabaseService.js` L46-51](src/services/supabaseService.js#L46-L51):

```jsx
supabaseClient = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
```

`flowType` and `detectSessionInUrl` are **not** set in code, so defaults apply. Read **live from the running client** (`supabase.auth.<prop>`):

| Property | Live value |
|---|---|
| `flowType` | **`'implicit'`** |
| `detectSessionInUrl` | **`true`** |
| `persistSession` | `true` |
| `autoRefreshToken` | `true` |
| `storageKey` | `sb-cbcevjhvgmxrxeeyldza-auth-token` |
| `@supabase/supabase-js` | `^2.58.0` (package.json L25) |

**Note:** I initially expected PKCE (commonly cited as the v2 default), but the live client reports **implicit**. This matters: implicit flow puts tokens directly in the URL hash and needs **no** code verifier, so a confirmation link works across browsers/devices — *if* the redirect carries the hash and the landing page lets the client parse it. `detectSessionInUrl: true` means the client will attempt to parse an `#access_token` hash on whatever URL it boots at.

## 3. Routes — is there a callback handler?

**No.** [`src/App.jsx` L72-153](src/App.jsx#L72-L153) defines: `/`, product/category routes (and `-legacy` variants), `/designer`, `/design/:productCode`, `/account/*` (behind `CustomerGuard`), `/admin/*` (behind `AdminGuard`), `/order-confirmation`, and **`/reset-password`**. There is **no** `/auth/callback`, `/auth/confirm`, `/verify`, or any signup-confirmation route.

The only route that processes auth tokens from a URL is **`/reset-password`** ([`src/pages/ResetPassword.jsx`](src/pages/ResetPassword.jsx)), which exists solely for password recovery. A signup verification link (redirect target `/`) renders `<Home>`, which has no equivalent logic.

## 4. Auth state listener

[`src/context/AuthContext.jsx` L24-37](src/context/AuthContext.jsx#L24-L37) — this is the active provider (`App.jsx` L23 imports `AuthProvider` from `./context/AuthContext`, used at L67):

```jsx
const { data: authListener } = supabase.auth.onAuthStateChange(
  async (event, session) => {
    console.log('[AuthContext] Auth state changed:', event);
    if (session?.user) {
      setUser(session.user);
      setIsAuthenticated(true);
    } else {
      setUser(null);
      setIsAuthenticated(false);
    }
    setLoading(false);
  }
);
```

On `SIGNED_IN` it sets `user`/`isAuthenticated` and logs the event — but it does **not** navigate, show a toast, or surface any "email verified" confirmation. So if a verification *does* establish a session, the only visible change is the header quietly flipping to signed-in; nothing tells the customer their email was verified. (There is a second, **unused** `onAuthStateChange` in `src/components/AuthProvider.jsx` L41 — not the provider App mounts.)

Confirmed live: on a normal homepage load the listener fires `[AuthContext] Auth state changed: INITIAL_SESSION` (so it is wired and would log/handle `SIGNED_IN` if it fired).

## 5. Email template

- **No Supabase CLI config in repo** — `supabase/config.toml` does not exist. Templates are managed by the custom generator in `supabase/email-templates/` and applied via the Management API (CLAUDE.md §21).
- The confirm-signup template body ([`supabase/email-templates/_bodies/confirm-signup.js`](supabase/email-templates/_bodies/confirm-signup.js)) points its CTA at the **standard** Supabase variable:
  ```js
  ctaUrl: "{{ .ConfirmationURL }}",
  ```
  (and a plain-text `{{ .ConfirmationURL }}`). The template is **correct** — `{{ .ConfirmationURL }}` resolves to `{SUPABASE_URL}/auth/v1/verify?token=…&type=signup&redirect_to={emailRedirectTo || SiteURL}`. The problem is the *resolved redirect target* (Site URL, because no `emailRedirectTo`), not the template.
- **No template change is required** to fix this (see §9) — it can be solved entirely client-side via `emailRedirectTo`. Dave can confirm the live template in **Authentication → Email Templates → Confirm signup** if he wants to double-check it still uses `{{ .ConfirmationURL }}`.

## 6. Browser reproduction

Ran a real signup in dev against the live Supabase project, mirroring `AuthContext.signUp`'s exact options (no `emailRedirectTo`):

**Signup result** (test user **left in place** per instructions):
```
email:               trackingdata2020+pgverify1@gmail.com
userId:              cca1ceb4-8c8a-4e31-be48-76f195dcd335
identities.length:   1            (genuinely new user, not a re-registration)
session after signup: null        (email confirmation pending — correct)
confirmation_sent_at: 2026-05-22T09:58:43Z   (verification email dispatched)
```

**localStorage after signup:** **zero `sb-*` keys** (no `…-code-verifier`, no `…-auth-token`). This is consistent with **implicit** flow — implicit needs no PKCE verifier, and no session exists yet. (Had the flow been PKCE, a `…-code-verifier` would have been written here; its absence corroborates the `flowType: 'implicit'` reading in §2.)

**Landing-path probe:** loaded `http://localhost:5173/#access_token=…&type=signup` (synthetic hash, deliberately invalid JWT). Result after settle: hash **not** consumed, no `sb-*` keys, console showed only `INITIAL_SESSION` (no `SIGNED_IN`), zero errors. This is **inconclusive** about real-token behaviour — a malformed JWT makes supabase-js bail before it would clear the hash / set a session, so it neither proves nor disproves that a *valid* implicit hash would establish a session. It does confirm the listener path is live.

**What could not be tested:** clicking the **actual** confirmation email link, because that requires reading the inbox (`trackingdata2020+pgverify1@gmail.com`) to obtain the real `{{ .ConfirmationURL }}` and observe the true redirect (whether it returns `#access_token=…` for implicit, or no tokens). **Dave should perform this one step** to confirm which of the two scenarios is live:
- If the landing URL is `…/#access_token=…&type=signup` → the session establishes silently and the bug is purely "unannounced" (no confirmation UI).
- If the landing URL is `…/` with no hash/query → the verify endpoint confirmed the email server-side without returning a session, so there is genuinely no session.

Either way, §9's fix applies.

## 7. Symmetry check — does sign-IN work?

**Code-verified (not browser-tested — no confirmed test-account credentials available locally).** `signIn` uses `supabase.auth.signInWithPassword` ([AuthContext L66-81](src/context/AuthContext.jsx#L66-L81)) with `persistSession: true`, which establishes and persists a normal session; `onAuthStateChange` then flips the header to signed-in. This is corroborated by the prior audit (`audit-ava-signup-popup-bug.md`), which confirmed in-browser that the `AuthModal` opened from `HeaderBar` signs in and persists. So the broader auth setup (client, context, persistence) is sound — the defect is specific to the **verification landing**, which has no `emailRedirectTo` and no handler. Sign-in does not depend on either.

## 8. Risk surface — the other URL-token flows

All Supabase "auth event from URL" flows share the same landing mechanism (implicit hash with a `type=` discriminator):

| Flow | `type=` | redirect configured? | handler? | Status |
|---|---|---|---|---|
| **Signup confirm** | `signup` | ❌ none (this bug) | ❌ none (lands on `/`) | **broken** |
| **Password recovery** | `recovery` | ✅ `resetPassword` passes `redirectTo: ${origin}/reset-password` (AuthContext L142-144) | ✅ `ResetPassword.jsx` (waits for `PASSWORD_RECOVERY` / session, lets user set password) | **works** (CLAUDE.md §10.4, previously verified) |
| **Magic link** | `magiclink` | ❌ none (no `signInWithOtp` caller found) | ❌ none | would be broken — but **not currently used** |
| **Email change** | `email_change` | ❌ none (no `updateUser({email})` caller found in app UI) | ❌ none | would be broken — but **not currently surfaced** |

So recovery is the one that already works, and it works precisely because it has *both* a `redirectTo` *and* a dedicated handler — the exact two things signup is missing. Magic-link and email-change are latent: there are no callers today, so they are not actively broken, but they would hit the same wall if added.

## 9. Recommended fix shape (prose)

Add a dedicated **`/auth/callback`** route rather than handling verification inside `Home.jsx`. A dedicated route mirrors the working `/reset-password` pattern, keeps the homepage free of auth-token logic, and gives a single place to disambiguate `type=signup` / `type=magiclink` / `type=email_change`. Two coordinated edits make it work: (a) pass `options.emailRedirectTo: \`${window.location.origin}/auth/callback\`` in `AuthContext.signUp` so the confirmation link lands there instead of `/`; (b) add the route + a small component that waits for the implicit-flow session to settle (the client auto-parses the `#access_token` hash because `detectSessionInUrl` is `true`), confirms via `getSession()` / an `onAuthStateChange` `SIGNED_IN`, shows a clear "Email verified — you're signed in" state, then redirects to `/account` (Dave's stated intent: auto-signed-in + clearly told it worked). Handle the failure/expired case the way `ResetPassword.jsx` already does — a friendly message and a route home — rather than surfacing raw Supabase errors.

**Keep the implicit flow; do not switch to PKCE.** Implicit is actually the safer choice for email links here: it carries tokens in the URL hash and needs no client-stored code verifier, so the link works even when opened on a different device or browser from the one that signed up (the common case for email). Switching to PKCE would *require* same-browser confirmation and would make cross-device clicks fail — a regression. The empirical `flowType: 'implicit'` + `detectSessionInUrl: true` config already does the heavy lifting; the fix is mostly about giving the tokens a place to land and the user some feedback.

**The same `/auth/callback` can serve magic-link and email-change** (both arrive as implicit hashes distinguished by `type=`), so building it once covers those if they're ever enabled — each just needs its initiating call to pass the matching `emailRedirectTo`. **Leave password recovery on its existing `/reset-password` route**, since it needs a password-set form rather than an auto-redirect; don't fold it into the generic callback. **No Supabase Dashboard template change is needed** — `{{ .ConfirmationURL }}` already honours `redirect_to`, and Dave has confirmed the redirect-URL allowlist permits any path under the site domains, so adding `emailRedirectTo` client-side is sufficient. The only thing to verify post-fix is the live email-link landing (§6) to confirm the implicit hash arrives and the callback establishes the session end-to-end.

---

*Read-only audit. No source files changed, no Supabase Dashboard settings touched, no PR opened. Live evidence via Playwright MCP on `main` (`9190cce`). Test signup user `cca1ceb4-8c8a-4e31-be48-76f195dcd335` (trackingdata2020+pgverify1@gmail.com) was created for §6 and deliberately left in place for Dave to inspect. This report is an untracked file at the repo root.*
