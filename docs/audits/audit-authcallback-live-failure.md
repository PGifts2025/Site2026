# Audit — Live AuthCallback Failure (post-#59/#60/#61)

> Scope: why a real Outlook signup, opening the new `?token_hash=…&type=email`
> verification link, lands straight on the error state with no "Verify and sign
> in" button. **Conclusive cause found in §1.** Audit only — no fix code written.

## TL;DR — CONCLUSIVE CAUSE (Theory A: deployed code is not PR #60)

**PR #60 (the click-to-verify rewrite of `AuthCallback.jsx`) never reached `main`.** It was merged **into the `feat/email-verification-callback` branch (PR #59's branch), not `main`** — the classic stacked-PR + squash-merge trap. The result:

- The **email template was updated** to the new `…/auth/callback?token_hash=…&type=email` URL (Dave confirmed; the link he received proves it).
- But **`main`/production still runs PR #59's auto-verify `AuthCallback.jsx`**, which expects an **implicit `#access_token` hash**, has **no button**, and times out to the error card when no session forms.

A `?token_hash=` query is neither an implicit hash (`#access_token`) nor a PKCE code (`?code=`), so the #59 page's `detectSessionInUrl` establishes no session → `user` stays null → after the 1200 ms timeout it shows "We couldn't verify this link". There is no button in that code at all. **This is exactly Dave's symptom.**

**The fix is NOT a redeploy** (production correctly reflects `main`; `main` itself lacks #60's code). The fix is to **re-apply PR #60's click-to-verify `AuthCallback.jsx` onto current `main`** via a fresh, non-stacked PR. No Supabase template change is needed — the template is already correct.

Theory E (external token consumption / click-to-verify is insufficient) is **ruled out**: the deployed page never renders a button regardless of token state, so it fails upstream of any token-consumption concern. Click-to-verify for verification was never actually deployed.

---

## 1. Does deployed code match PR #60? — NO (decisive)

**Git history — there is no #60 commit on `main`:**
```
005b289 Defeat email link scanners on password reset (sibling of #60) (#61)
9a02c9e Add email verification callback handler (fix silent post-verify landing) (#59)
1608006 fix(auth): render modal exclusively in CustomerGuard ... (#58)
9190cce Remove redundant MOQ hint ... (#56)
```
#59 and #61 are present; **#60 is absent.**

**PR #60 was merged into the wrong branch:**
```
$ gh pr view 60 --json state,baseRefName,headRefName,mergedAt,mergeCommit
state:       MERGED
baseRefName: feat/email-verification-callback     ← merged into #59's branch, NOT main
headRefName: feat/click-to-verify-email
mergedAt:    2026-05-22T11:10:45Z
mergeCommit: fa9d600e6868fa7974b31fb56e91db53de08eb25
```
```
$ git merge-base --is-ancestor fa9d600… origin/main   →  NO — #60 is NOT on main
```

**`main`'s `AuthCallback.jsx` is the #59 auto-verify version** (`git show origin/main:src/pages/AuthCallback.jsx`, head):
```jsx
// Flow is IMPLICIT with detectSessionInUrl:true ... the Supabase client
// auto-parses the `#access_token=...&type=signup` hash on page load ...
export default function AuthCallback() {
  const { user, loading } = useAuth();
  const [hadAuthHash] = useState(
    () => typeof window !== 'undefined' && window.location.hash.includes('access_token'),
  );
  const [status, setStatus] = useState('verifying'); // 'verifying' | 'success' | 'error'
  ...
  useEffect(() => {
    if (loading) return;
    if (user) { ... }
    // Not loading, no user → after a timeout, show error.
    const t = setTimeout(() => setStatus('error'), hadAuthHash ? 2500 : 1200);
    return () => clearTimeout(t);
  }, [user, loading, hadAuthHash, navigate]);
```
It contains **no `token_hash` handling, no `verifyOtp`, and no "Verify and sign in" button** — confirmed:
```
$ git grep -n "Verify and sign in|One more step|verifyOtp|token_hash" origin/main -- src/pages/AuthCallback.jsx
(none)
```

**Live production reproduces it.** Playwright →
`https://promo-gifts-co.uk/auth/callback?token_hash=fake_test_value_abc123&type=email`:

| Time | Heading | "Verify and sign in" button | "One more step" present |
|---|---|---|---|
| on load | "We couldn't verify this link" | **false** | **false** |
| +2 s | "We couldn't verify this link" | **false** | **false** |

Screenshot: `live-authcallback-error-no-button.png`. The deployed site = `main` = #59 code = no button → straight to error. **This is the bug.** Per the audit's stop rule, the cause is established here.

## 2. Auto-verify mechanisms

Not the cause (the deployed page has no button because it has no click-to-verify code at all), but for completeness:

- **`main`'s `AuthCallback.jsx`** never calls `verifyOtp`. It relies on `detectSessionInUrl` (client init) to auto-parse an implicit `#access_token` hash. For a `?token_hash=` query there is **no** matching auto-parse, so no session forms and no API call to `/auth/v1/verify` is made by the page.
- **`verifyOtp` on `main` exists only in `ResetPassword.jsx`** (PR #61, which *did* reach `main`):
  ```
  origin/main:src/pages/ResetPassword.jsx:138:  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  ```
  Called only from the "Continue" `onClick` (`handleVerify`). So password reset is correctly click-to-verify on `main`; **email verification is not** — the asymmetry is the smoking gun that only #61 (not #60) landed.
- **`AuthContext.onAuthStateChange`** (L24-37) never calls `verifyOtp`; it only mirrors session state. No router/middleware inspects the URL for tokens.

## 3. Network trace — not required (cause already conclusive)

§1 is decisive: the deployed page has **no button and no `verifyOtp`/`token_hash` code path at all**, so it cannot be consuming the token via a click-path, and it makes no `/auth/v1/verify` call for a `?token_hash=` query. A network trace would show the #59 page issuing only its normal app/Supabase `getSession` calls and **no** request carrying the `token_hash` — consistent with "the page doesn't understand this URL format." Running it would add nothing to an already-conclusive finding, and the live repro in §1 confirms behaviour directly. (If desired post-fix, the #60 curl-then-click proof re-applies once #60's code is on `main`.)

## 4. Dave's exact scenario (dwell + paste) — explained without it

The 60 s-dwell + curl reproduction was designed to test **token-consumption-in-transit** theories. Those are **moot**: the deployed page fails identically for a *fake* token with zero dwell (§1 live test) — it never reaches a token-validation step because it has no `token_hash` code. So Dave's failure is **not** time-dependent and **not** caused by Outlook/Defender consuming the token; it is a **deterministic code mismatch**. Dave's "paste into Chrome, straight to error, no button" is reproduced exactly by the §1 live test (`token_hash` present, fake or real, no button, error). Outlook is a red herring here.

## 5. State-determination logic during the failure

`main`'s `AuthCallback.jsx` render path for Dave's URL (`?token_hash=…&type=email`, no `#` hash, fresh browser, signed out):

1. `hadAuthHash = window.location.hash.includes('access_token')` → **false** (the URL has a query, not a hash).
2. `status` initial = `'verifying'`.
3. `useEffect`: `loading` resolves false; `user` is null (no session — `detectSessionInUrl` found no hash/code to parse); `hadAuthHash` false → `setTimeout(() => setStatus('error'), 1200)`.
4. Render: `status` goes `'verifying'` → `'error'`. **No `awaiting`/button state exists in this file.**

So it shows a brief "Verifying your email…" then "We couldn't verify this link" — no button, ever. No stale `useAuth()` error state is involved; the error is simply the timeout branch firing because the session never materialised from an unrecognised URL shape. (The #60 code, by contrast, starts in an `awaiting` state with a button whenever `token_hash` is present — which is why Dave never saw a button: that code isn't deployed.)

## 6. Theory ranking

**A — Deployed code is not PR #60. ✅ CONFIRMED (cause).**
- *Supports:* #60 absent from `main` log; `gh pr view 60` shows `baseRefName=feat/email-verification-callback`; `git merge-base --is-ancestor fa9d600 origin/main` = NO; `main`'s `AuthCallback.jsx` is verbatim the #59 auto-verify version (no `token_hash`/`verifyOtp`/button); live site reproduces error-no-button for a fake token.
- *Rules out others:* the page has no click-to-verify code at all, so B/C/D/E cannot be operative on the deployed surface.
- *Conclusive test (done):* read `origin/main:src/pages/AuthCallback.jsx` + live render. Both confirm.

**B — AuthCallback has auto-verify code that regressed. ❌ Ruled out.**
- The deployed file has neither click-to-verify nor a `token_hash`-triggered auto-verify; it's the original #59 implicit-hash auto-detect. Nothing "regressed" — #60 simply never landed.

**C — Another component auto-calls `verifyOtp` on URL load. ❌ Ruled out.**
- `git grep verifyOtp origin/main -- src/` → only `ResetPassword.jsx` (click-gated). No context/router/listener calls it.

**D — An auth-state listener interprets the URL and triggers verification. ❌ Ruled out.**
- `AuthContext.onAuthStateChange` only mirrors session state; never calls `verifyOtp`. No URL inspection.

**E — External party (Outlook/Defender) consumes the token; click-to-verify is insufficient. ❌ Ruled out (for this failure).**
- The deployed page fails for a brand-new fake token with no dwell and no email scanner involved — the failure is upstream of any token validation. We literally have not deployed the click-to-verify defense for verification yet, so its sufficiency is untested in production (PR #60's local Test B already showed curl-then-click surviving; that proof applies once #60's code is on `main`).

## 7. Recommended fix (prose)

The fix is to **land PR #60's click-to-verify `AuthCallback.jsx` on `main`** — it was merged into the now-defunct `feat/email-verification-callback` branch instead of `main`, so its changes are sitting in commit `fa9d600` but not in the deployed line. This is **not a redeploy** (production faithfully reflects `main`; `main` is missing the code). Create a **fresh branch off current `main`** and re-introduce the exact click-to-verify component from #60 — read `token_hash`/`type`/`next` from the query, render the "Verify and sign in" button, call `verifyOtp({ token_hash, type })` only on click, then success → `/account`, with the error + resend states. The #60 code is recoverable verbatim from `git show fa9d600:src/pages/AuthCallback.jsx` (or the PR #60 diff), so this is a re-application, not a redesign. **Do not** stack this PR on anything — base it directly on `main`.

No other change is required. The Supabase "Confirm signup" template is already correct (it produces the `?token_hash=…&type=email` URL Dave received), so **do not touch the Dashboard**. `AuthContext.signUp`'s `emailRedirectTo` (PR #59, on `main`) is correct. `ResetPassword.jsx` (PR #61) already shipped the sibling click-to-verify and is unaffected. Once #60's `AuthCallback.jsx` is on `main` and deployed, re-run the PR #60 Test B (curl-prefetch then browser click) against production to confirm — and only then is the Outlook scenario truly closed. (If, after deploying the real click-to-verify page, a corporate tenant *still* fails, *that* would be the moment to investigate Theory E and consider an OTP-code fallback — but there is no evidence for it today.)

**Process root cause (to prevent recurrence):** PR #60 was created with `--base feat/email-verification-callback` (a stacked PR) for a clean diff. When #59 was **squash-merged** to `main`, the squash captured only #59's commits; #60 had been merged into #59's branch and never got retargeted/re-merged to `main`, so its changes silently dropped. This is the same "squash-merge + stale branch" hazard noted in the project's working memory. Going forward, fixes that must reach `main` should be **based on `main`**, not stacked on an unmerged branch — or, if stacked, the dependent PR must be explicitly re-merged to `main` after the base merges, with a post-merge `git grep` on `main` confirming the expected code is present.

---

*Read-only audit. No source files changed, no Vercel/Supabase settings touched, no PR opened. Evidence from `origin/main` (`005b289`), `gh pr view 60`, and a live Playwright check of production. This report is an untracked file at the repo root.*
