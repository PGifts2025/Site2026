# Audit — AVA Chat Signup Popup Flash Bug (read-only)

> Scope: find why the signup/auth modal flashes and disappears when reached from the AVA chat quota prompt. No source changed. Reproduced live via Playwright MCP.

## TL;DR — root cause found

The modal flash is **not** in AVA chat and **not** in the auth modal. It is in **`src/components/auth/CustomerGuard.jsx` (lines 26-34)**, which guards the `/account` route. For an anonymous user it renders a `<Navigate to="/">` redirect **and** `<AuthModal isOpen={true} />` **as siblings in the same fragment**. React commits both: the modal mounts and paints for one frame, then `<Navigate>` performs the redirect to `/`, which unmounts the guard subtree (including the modal). Net effect: the modal appears for a fraction of a second, then vanishes as the page redirects home.

The AVA chat quota prompt's affordance is a plain `<a href="/account">` link, so clicking it lands the anonymous user on the guarded `/account` route and triggers the guard's flash. The **same `AuthModal` works correctly from the header** (state-driven, no redirect) — confirmed in browser — which proves the modal component is fine and the bug is confined to the guard.

```jsx
// src/components/auth/CustomerGuard.jsx  L26-34
if (!isAuthenticated || !user) {
  // Show auth modal or redirect to home
  return (
    <>
      <Navigate to="/" replace state={{ message: 'Please sign in to access your account' }} />
      <AuthModal isOpen={true} onClose={() => setShowAuthModal(false)} />
    </>
  );
}
```

**One wording caveat:** Dave's report says *"Sign up for more searches"*. The actual AVA affordance reads *"Sign in for unlimited"* and links to `/account` (see §3). The behaviour (flash) matches exactly; the button label does not. There is no separate "Sign up for more searches" button in the current `main` code — the fix prompt should use the real copy/affordance.

---

## 1. AVA chat component location

- **Component:** [`src/components/AIChatWidget/AIChatWidget.jsx`](src/components/AIChatWidget/AIChatWidget.jsx) — the floating Ava chat widget (`export default function AIChatWidget()`, L82).
- **Mounted globally** in [`src/App.jsx` L156](src/App.jsx#L156), after `<Cart />`, inside `<Router>`:
  ```jsx
  <Cart />
  <AIChatWidget />
  ```
  So it is **not** homepage-only — it can appear on every route. Visibility is gated (L150-153): anonymous users see it only when `VITE_AI_CHAT_PUBLIC_ENABLED === 'true'`; signed-in users see it when `profiles.ai_chat_enabled === true` (CLAUDE.md §32.3).
- The homepage **Ava card** ([`Home.jsx`](src/pages/Home.jsx)) and category-page `AvaPromptCard` open this same widget by dispatching a `pgifts:open-chat` window event (handled at AIChatWidget L106-127). They do not render their own chat or auth UI.

## 2. Daily search counter

- **Enforced server-side**, not in the widget. [`scripts/lib/ai-quota.js`](scripts/lib/ai-quota.js):
  - `export const ANON_DAILY_LIMIT = 5;` (L22)
  - `const remaining = Math.max(0, ANON_DAILY_LIMIT - used);` (L140)
  - `allowed: status.remaining > 0` (L228) — so a search is **allowed while `used < 5`** and **blocked once `used >= 5`** (the 6th attempt is refused). Threshold is effectively `used >= 5` blocks.
- **Scope:** counts **`searchProducts` tool calls only**, per rolling 24h, keyed on a SHA-256 hash of the FingerprintJS visitor id (CLAUDE.md §32.6). Greetings, clarifications, and `findAlternatives` are free. Signed-in users are unlimited and bypass the table entirely (`remaining: 'unlimited'`, L224).
- **Incremented** in `incrementQuota` (ai-quota.js ~L197) inside the chat endpoint's tool-use branch ([`api/ai/chat.js`](api/ai/chat.js)); checked before invoking `searchProducts`.
- The widget only **reflects** the server count. After each reply it reads `data.quota_status` into `quotaStatus` (AIChatWidget L206) and derives:
  ```jsx
  // AIChatWidget L261-265
  const quotaExhausted =
    !user &&
    quotaStatus &&
    typeof quotaStatus.remaining === 'number' &&
    quotaStatus.remaining <= 0;
  ```
- It is the AI search counter; it is **not** shared with any general site search (there is no separate site search — the header search bar was removed, CLAUDE.md §55).

## 3. Signup prompt: the trigger

When the limit is reached the footer shows a small amber banner with a **plain anchor link** (no button, no modal trigger):

```jsx
// src/components/AIChatWidget/AIChatWidget.jsx  L404-409
{quotaExhausted && (
  <div style={signInPromptStyle}>
    You've used your free searches today.{' '}
    <a href="/account" style={{ color: '#1d4ed8' }}>Sign in</a> for unlimited.
  </div>
)}
```

- **Affordance:** the `<a href="/account">Sign in</a>` link. Visible copy is *"You've used your free searches today. Sign in for unlimited."*
- **Click handler:** **none.** It is a raw `<a>` with an `href` and no `onClick` (contrast with the product-card links at L477-483 / L561-565, which `preventDefault()` + `pushState` for soft navigation). So clicking it performs a **full-page browser navigation to `/account`**.
- There is **no** "Sign up for more searches" button and **no** code in the widget that opens `AuthModal`. The widget never imports or renders `AuthModal`.

## 4. Signup popup: the modal itself

- **Defined in** [`src/components/auth/AuthModal.jsx`](src/components/auth/AuthModal.jsx) (L1-519). A single modal with Sign In / Create Account tabs + forgot-password sub-flow.
- **Open state is a prop**, not internal: `const AuthModal = ({ isOpen, onClose, onSuccess })` (L8); it early-returns `if (!isOpen) return null;` (L143). There is **no** context/store/URL-param controlling it — each mount site owns an `isOpen` value.
- **Mount sites** (`grep AuthModal src/`): `HeaderBar.jsx`, `CustomerGuard.jsx`, `Designer.jsx`, `DesignerV2.jsx` (+ archived files). Each passes its own `isOpen`.
- **Every code path that closes it** (sets the controlling state false / unmounts):
  - The header **X** button → `onClose` (AuthModal L155-160).
  - The "Got it" buttons on the email-confirmation and forgot-sent screens → `onClose` (L253, L277, L283).
  - **Successful sign-in** → `setTimeout(() => onClose(), 500)` (L86).
  - The owning component setting its `isOpen` state to false (e.g. HeaderBar `setShowAuthModal(false)`).
  - **Unmount of the owning component** — this is the bug: in `CustomerGuard` the modal is hardcoded `isOpen={true}` and is unmounted by the sibling `<Navigate>` redirect (§5).
- **Notably absent:** `AuthModal` has **no outside-click (backdrop) close** and **no ESC handler**. The backdrop `<div className="fixed inset-0 bg-black/50 …">` (L146) has no `onClick`. This rules out the "outside-click close fires on the opening click" hypothesis.

## 5. Event chain reproduction (resolved cleanly)

**Reproduced live** (Playwright MCP, anonymous, dev server). A `MutationObserver` watching for the modal overlay + heading across a client-side nav to `/account` captured:

| t (ms) | URL | AuthModal in DOM |
|---|---|---|
| 15464 | `/` | false (start, home) |
| **15487** | **`/account`** | **true** — modal mounts/paints |
| **15541** | **`/`** | **false** — `<Navigate>` redirects, modal unmounts |
| 16980 | `/` | false (settled on home) |

The modal was alive ~**54 ms** before the redirect tore it down. (On a real cold load the `CustomerGuard` `loading` spinner phase precedes this, so a human perceives "page goes to account, modal flashes, bounces home".)

Step-by-step for the AVA path:

1. **Which onClick fires:** none — the affordance is `<a href="/account">` (AIChatWidget L407). The browser does a full navigation to `/account`.
2. **stopPropagation / preventDefault:** neither. It is a default anchor navigation.
3. **State updates from the click:** none in the widget. The app re-boots at `/account`.
4. **Parent onClick / outside-click bubbling:** **not a factor.** AVA chat has **no** outside-click detector (no document-level listener, no backdrop close). The auth modal also has no outside-click close (§4). The flash is not caused by a click bubbling to a closer.
5. **Where the modal renders / why it unmounts:** the modal is **not** rendered inside AVA's tree. It is rendered by `CustomerGuard` at the `/account` route root ([App.jsx L128](src/App.jsx#L128)). After `useAuth().loading` resolves and the user is anonymous, the guard returns:
   ```jsx
   // CustomerGuard.jsx L28-33
   <>
     <Navigate to="/" replace state={{ message: 'Please sign in to access your account' }} />
     <AuthModal isOpen={true} onClose={() => setShowAuthModal(false)} />
   </>
   ```
   React commits both children. `<AuthModal>` mounts and paints (the visible flash). `<Navigate>` then performs the redirect to `/`, which **unmounts `CustomerGuard` and the modal with it.**

   Two compounding faults in this block, both pointing at the same fix:
   - `<Navigate>` and `<AuthModal>` are rendered together — mutually exclusive intents (go away vs stay and sign in).
   - The modal's `onClose` is `() => setShowAuthModal(false)`, but `showAuthModal` (declared L13) is never read — the modal is hardcoded `isOpen={true}`. So even without the redirect, the close button could not dismiss it. Dead state.

**Candidate causes from the brief, adjudicated:** outside-click close — ruled out (no such handler anywhere). `useEffect` reset — ruled out (open state is a prop, no resetting effect). Re-mount resetting state — partially: it is an **unmount** (not a state reset) caused by the redirect. Timeout/animation — ruled out. Conflicting AVA/global state — ruled out (AVA only links to `/account`). The cause is unambiguously the `<Navigate>`+`<AuthModal>` co-render in `CustomerGuard`.

## 6. Symmetry check — the same modal works from the header

**Confirmed in code and in browser.** `HeaderBar` opens the identical `AuthModal` via local state, with **no** redirect:

```jsx
// HeaderBar.jsx
const [showAuthModal, setShowAuthModal] = useState(false);          // L28
<button onClick={() => setShowAuthModal(true)} …>…Sign In…</button> // L181
<AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} /> // L310
```

Browser test (anonymous, home): clicked header **Sign In** → modal `present: true` at t=1000 ms, URL still `/` (no redirect). It opens and **stays open**. So the modal component, `AuthContext`, and the auth flow are all fine. The defect is specific to the `CustomerGuard` render path; the fix surface is one file.

## 7. Recommended fix shape (prose)

The fix belongs in **`src/components/auth/CustomerGuard.jsx`** alone — it is the only place that renders a redirect and a modal together. It is a **logical/structural** fix, not a guard-based one (there is no event to suppress) and not a portal change (the modal does not need to escape AVA's tree — it never lived there). Render exactly one outcome for an unauthenticated user, never both. The lightest correct version keeps the user on the page and lets them sign in in place: drop the `<Navigate>`, render only `<AuthModal isOpen onClose={…} onSuccess={…} />`, and on `onClose` (the X / dismiss) navigate home with `useNavigate`. Once the user authenticates, `useAuth().user` becomes set and the guard re-renders its `children` automatically (the existing `if (!isAuthenticated || !user)` branch simply stops matching), so no extra wiring is needed for the success path. The dead `showAuthModal` / `setShowAuthModal` state should be removed at the same time.

An equally valid alternative is **redirect-only**: keep `<Navigate to="/" replace state={{ message }}>` and delete the modal, then have the home page (or header) open the auth modal in response to the redirect `state.message`. This is cleaner if a single global auth-modal opener is desired, but it requires a second change on the receiving page to actually surface the modal, so it is heavier than the in-place option. Either way the principle is the same: a route guard must not simultaneously navigate away and mount a modal.

**Regression risk is low and contained.** `AuthModal` itself, the header sign-in path, and the Designer auth gates are untouched and already work. The only behaviours to re-verify after the change are: (a) an anonymous visit to `/account` shows a stable modal (or a clean redirect) with no flash; (b) signing in from that modal lands the user on their dashboard (guard re-renders children); (c) dismissing the modal without signing in sends them somewhere sensible (home). **The daily-search-counter logic needs no change** — it is server-side, correct, and entirely unrelated to the flash. Separately (optional, not required to fix the flash): the AVA affordance currently sends anonymous users through a guarded route via a full-page `<a href="/account">`; a nicer follow-up would be to open `AuthModal` directly from the widget (client-side) and to align the copy with intent ("Sign in for unlimited" vs the reported "Sign up for more searches"). That is a UX enhancement, not part of the bug fix.

---

*Read-only audit. No source files changed, no PR opened. Reproduced live with Playwright MCP against the dev server on the canonical `main` branch. This report is an untracked file at the repo root.*
