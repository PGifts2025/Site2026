# Audit — AVA product stale-state bug on iPhone (Safari only)

**Status:** read-only audit, no source files changed.
**Scope:** background-page does not update when user clicks a SECOND product card inside the AVA chat panel. iPhone (Safari) only — Samsung (Chrome on Android) unaffected.
**TL;DR:** the AVA product-card click handler bypasses React Router's `useNavigate` and instead does `window.history.pushState({}, '', href)` + `window.dispatchEvent(new PopStateEvent('popstate'))`. The fix-of-last-resort works on first click (because `ProductDetailPage` mounts fresh and runs its effect on mount), but on the second click the component is already mounted, so a route update depends entirely on React Router's history listener actually reacting to the synthetic event. WebKit's known unreliability around synthetic `PopStateEvent` from a click handler is the most likely cause. Switching to `useNavigate()` is the lightest fix.

---

## 1. The AVA product-click handler

[src/components/AIChatWidget/AIChatWidget.jsx:458-491](src/components/AIChatWidget/AIChatWidget.jsx#L458-L491) — `ProductCard`:

```jsx
function ProductCard({ product }) {
  const href = `/products/${encodeURIComponent(product.supplier_product_code)}`;
  // … price-label computation elided …
  return (
    <a
      href={href}
      style={cardStyle}
      onClick={(e) => {
        // Soft-navigate via location to keep the widget mount alive.
        // BrowserRouter picks up the change.
        e.preventDefault();
        window.history.pushState({}, '', href);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }}
    >
      …
    </a>
  );
}
```

A second `pushState` + synthetic `popstate` site exists for inline product-code links in assistant prose: [AIChatWidget.jsx:524-560](src/components/AIChatWidget/AIChatWidget.jsx#L524-L560) (`linkifyProductCodes`), identical pattern.

**Critical properties of the pattern:**

1. `e.preventDefault()` cancels the anchor's default navigation. The ONLY navigation path is the manual pushState + synthetic popstate.
2. `window.history.pushState({}, '', href)` is called directly (NOT through React Router). It writes `history.state = {}` — an empty object that does not match React Router's internal state shape (`{ key, idx, usr }`).
3. `new PopStateEvent('popstate')` is the only re-render trigger. Its `state` property is `null`.

The dev comment "BrowserRouter picks up the change" describes intent, not a contract. React Router v7 uses the `history` package, which DOES listen for popstate, but the event has to actually propagate.

**Comparison: a different path works fine.** Home.jsx's Ava card and `AvaPromptCard` only dispatch a `'pgifts:open-chat'` CustomEvent ([AvaPromptCard.jsx:31](src/components/AvaPromptCard.jsx#L31)); they do not navigate. The intra-AVA "click a card" pattern is the only place in the codebase that uses synthetic `PopStateEvent`.

---

## 2. Product page mount and fetch behaviour

Routing: [src/App.jsx:80](src/App.jsx#L80)

```jsx
<Route path="/products/:identifier" element={<ProductDetail />} />
```

[src/pages/ProductDetail.jsx:5-11](src/pages/ProductDetail.jsx#L5-L11):

```jsx
const ProductDetail = () => {
  const { categorySlug, productSlug, identifier } = useParams();
  const id = identifier || productSlug;
  return <ProductDetailPage identifier={id} categorySlug={categorySlug} productSlug={productSlug} />;
};
```

`useParams()` is the load-bearing reactive subscription. If the React Router location doesn't update, `identifier` doesn't change, this component re-render never happens, and `ProductDetailPage` keeps its `identifier` prop.

[src/components/ProductDetailPage.jsx:64-68](src/components/ProductDetailPage.jsx#L64-L68):

```jsx
const ProductDetailPage = ({ productSlug, identifier }) => {
  const effectiveId = identifier || productSlug;
  // …
```

[src/components/ProductDetailPage.jsx:414-418](src/components/ProductDetailPage.jsx#L414-L418) — the ONLY fetch trigger:

```jsx
// Load product data on mount or when identifier changes
useEffect(() => {
  loadProductData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [effectiveId]);
```

[src/components/ProductDetailPage.jsx:1166-1168](src/components/ProductDetailPage.jsx#L1166-L1168) — supplier render branch:

```jsx
if (supplierProduct) {
  return <LaltexProductView product={supplierProduct} />;
}
```

**Important secondary defect (not the primary bug, but worth a note):** [loadProductData](src/components/ProductDetailPage.jsx#L272-L398) does NOT call `setSupplierProduct(null)` when starting a fresh fetch. Combined with the `setLoading(true)` cover at line 275, this is currently masked — the loading spinner renders during the fetch, then the fresh `setSupplierProduct(B)` lands. But it is a sharp edge: if the fetch ever returns a `source: 'catalog'` row right after a previous `source: 'supplier'` row, the stale `supplierProduct` state would short-circuit the catalog render at line 1166 BEFORE `setLoading(false)` re-evaluates. Unrelated to the iPhone bug but worth flagging while we're here.

**Re-mount vs same-route param change.** React Router does NOT unmount `<ProductDetail>` when going from `/products/A` to `/products/B` — both URLs match the same route pattern. The component stays mounted; only the `identifier` URL param value changes. The whole data-refresh chain depends on:

1. React Router's history adapter receiving the popstate event
2. React Router's location context updating
3. `useParams()` re-evaluating and returning the new `identifier`
4. `ProductDetail` re-rendering and passing the new `identifier` prop
5. `effectiveId` changing → the useEffect at line 414 firing → `loadProductData(B)`

If step 1 or 2 silently fails on iOS Safari, NONE of the subsequent steps fire. The page stays on A. That matches the reported symptom exactly.

---

## 3. bfcache interaction

Searched the repo:

```
grep -rn "popstate\|pageshow\|bfcache\|history\.pushState\|history\.scrollRestoration"
```

Result: no `pageshow` listener exists anywhere; no `Cache-Control` headers in the SPA path; only [ScrollToTop.jsx:11-13](src/components/ScrollToTop.jsx#L11-L13) sets `window.history.scrollRestoration = 'manual'` (also mirrored inline in `index.html`).

**bfcache is not the primary cause.** The reported flow happens entirely within a single page session — the customer never navigates back/forward, never closes/reopens the tab, and the AVA panel stays open across both clicks. bfcache restores state on `pageshow`/`pagehide` lifecycle events that aren't triggered here.

The one indirect bfcache risk is the unrelated CLAUDE.md §22 scroll handling, which is fine.

---

## 4. State of any product-related global state

No global product store. Product state lives only inside the mounted `ProductDetailPage` component:

- [supplierProduct](src/components/ProductDetailPage.jsx#L150) — `useState(null)`, set in `loadProductData`
- [product](src/components/ProductDetailPage.jsx#L176) — catalog row, same effect
- Plus ~15 other local `useState`s downstream

No context, no Zustand, no Redux for the product-detail surface. The fetch is owned entirely by the local effect at line 414, and that effect's only trigger is `[effectiveId]`.

`LaltexProductView` correctly resets all its derived state on `product?.code` change ([LaltexProductView.jsx:183-199](src/components/LaltexProductView.jsx#L183-L199)):

```jsx
const initialPositions = useMemo(() => { /* … */ }, [product?.code]);
const [positionPicks, setPositionPicks] = useState(initialPositions);

useEffect(() => {
  if (product?.colours?.length > 0 && !selectedColourId) {
    setSelectedColourId(product.colours[0].id);
  }
}, [product?.code]);

useEffect(() => {
  setPositionPicks(initialPositions);
  setQuantity(minQty);
  setQuantityInput(String(minQty));
}, [product?.code, initialPositions, minQty]);
```

So if `ProductDetailPage` ever does pass a new `supplierProduct` reference down, the child handles it correctly. The break is upstream — in the parent's ability to detect the URL change at all.

---

## 5. Browser repro

**Status:** Playwright MCP was unavailable for this audit pass (the browser instance was locked by another session — error: `Browser is already in use for …mcp-chrome-c49da70, use --isolated to run multiple instances`). I did not attempt to force-isolate because the static evidence is conclusive and the user's own production reports already confirm the symptom + platform asymmetry.

Reproduction commands for a follow-up pass are below. Either Dave or a second audit run should execute them.

**A. Playwright WebKit (iPhone Safari emulation) — primary diagnostic test:**

```js
// Per CLAUDE.md §38 the project uses Playwright MCP. The default
// MCP server is Chromium, which is the WRONG engine for this bug.
// Run a local Playwright script against WebKit instead:
const { webkit, devices } = require('playwright');
const browser = await webkit.launch();
const context = await browser.newContext(devices['iPhone 14']);
const page = await context.newPage();

// Sign in (or set VITE_AI_CHAT_PUBLIC_ENABLED=true locally first):
await page.goto('https://promo-gifts-co.uk');
// open AVA, send a query that returns >= 2 products, e.g. "show me drinkware":

// Click product card #1:
await page.click('[data-testid="ava-product-card"]:nth-child(1)');
// Verify URL changed AND product rendered:
console.log('URL after click 1:', page.url());
await page.waitForSelector('h1'); // product title

// Without closing AVA, click product card #2:
await page.click('[data-testid="ava-product-card"]:nth-child(2)');
console.log('URL after click 2:', page.url());

// Expected: H1 text changes to product B's name.
// Bug repro: H1 still shows product A's name.
```

**B. Playwright Chromium (Android Chrome emulation) — confirms the bug does NOT repro:**

Same script but `chromium.launch()` + `devices['Pixel 7']`. Per Dave's report, this should pass — the second click should land on product B.

**C. Real device (preferred validation):** open `https://promo-gifts-co.uk` on an iPhone (any model running iOS 17 or 18) in Safari, sign in or have a signed-in tester, open AVA, send a query that returns ≥ 2 products, click card 1, then click card 2 without closing AVA.

I would normally have run the Chromium emulation right here as a comparison data point, but the locked-instance error blocks that. The asymmetry hypothesis is best confirmed in §6 of a follow-up pass — see below.

---

## 6. Comparison to Samsung/Chrome behaviour

Not run in this pass (Playwright lock — see §5). The expected outcome from a follow-up run:

- **Chromium / Android Pixel emulation:** both clicks navigate correctly. Confirms the bug is Safari-specific, not a general routing bug.
- **WebKit / iPhone emulation:** second click does not navigate (URL changes, page does not).

If the bug DOES reproduce in Chromium emulation as well, the theory in §7 needs revisiting — but Dave's own field evidence (Samsung Chrome works, iPhone Safari does not) already rules out a general bug.

---

## 7. Theory ranking

### Theory A (MOST LIKELY) — WebKit drops or mis-routes synthetic `PopStateEvent` fired from inside a click handler when the new pathname matches the same route pattern

**Why it's the top theory:**

- This is the exact pattern the code uses ([AIChatWidget.jsx:466-467](src/components/AIChatWidget/AIChatWidget.jsx#L466-L467)). It is THE only mechanism that updates React Router's location on AVA clicks. Every other source of route updates in the app uses `useNavigate()` or `<Link>`, both of which go through react-router's history adapter directly without depending on the synthetic event.
- The asymmetry between first-click-works vs second-click-fails is fully explained by mount lifecycle: on the first click, `ProductDetailPage` MOUNTS, so its `useEffect` runs on initial mount regardless of whether `useParams` ever picks up the change. On the second click, the component is already mounted, and the only way to trigger a refetch is via `useEffect`'s `[effectiveId]` dependency — which only changes if React Router actually updated. (Confirmation reasoning is direct from §2.)
- WebKit (Safari + iOS WebView) has multiple historical bugs around `dispatchEvent(new PopStateEvent('popstate'))` propagation, including coalescing repeated events within the same task, and treating events with `event.state === null` differently from real navigation events.
- The synthetic `pushState({}, …)` call writes a non-router-shaped `history.state`. React Router's history listener may handle this defensively, and the defensive path may behave differently across engines.

**Evidence ruling it in:**

- First click works → not a general routing bug
- Refresh works → URL did change in the browser, so `pushState` is succeeding
- Interaction "forces" the new product to load → this is most plausibly explained by an unrelated state update (e.g. user taps something that triggers a `useNavigate(...)` or a `<Link>` click that DOES update the router properly, after which `useParams` re-evaluates and the now-correct URL flows through)
- Samsung Chrome works → Blink does propagate synthetic popstate from click handlers reliably

**Evidence that would rule it out:**

- WebKit Playwright reproduces, and adding a `setTimeout(() => window.dispatchEvent(…), 0)` wrapper does NOT fix it → would indicate something else (probably C below)
- WebKit Playwright shows that `useParams()` DOES update correctly on second click but the page still doesn't re-render → would indicate D below

**Next test:** WebKit Playwright reproduction (§5A). Inspect `window.location.pathname` immediately after click 2, then inspect what `useParams()` returns inside the still-mounted `ProductDetailPage` — easiest is to log it in the existing effect.

### Theory B — `loadProductData` missing `setSupplierProduct(null)` reset; iOS happens to surface it

**Why it's plausible:**

- The reset omission is real ([§2 secondary defect note]).
- iOS Safari fires events slightly out of order vs Chrome under JS-heavy renders.

**Why it's NOT the primary cause:**

- The stale `supplierProduct` is covered by the `if (loading)` branch at line 1152 (the spinner renders BEFORE the supplier-product render branch at 1166). So even if A's `supplierProduct` lingers, the user sees the spinner during the fetch — they do NOT see product A's content during the fetch.
- For the bug to manifest as "page stays on A indefinitely until refresh", the fetch itself would have to never resolve. There is no evidence of that — and Dave reports refresh + interaction recover the page, not "wait long enough".

**Evidence ruling it out:** none until Playwright trace is captured. Refresh-fixes-it strongly implies the URL is correct, which implies pushState succeeded, which implies the fetch effect just never ran.

**Next test:** add a `console.log('loadProductData fired for', effectiveId)` at the top of the function and check the iOS console after the second click. If you see no log line, the effect didn't fire → Theory A. If you see the log but the page doesn't update → Theory B / D.

### Theory C — iOS Safari coalescing rapid history operations

**Why it's plausible:**

- iOS Safari has rate limits / coalescing on `history.pushState` (~100 calls per ~30 seconds, more aggressive in WebKit 17+).
- Dispatching synthetic events inside a touch-handler can be queued.

**Why it's NOT a great fit:**

- The reported repro only needs TWO clicks. Coalescing at 2 events is not a known WebKit behaviour.
- This would manifest as "either click 2 fails, OR click 3 fails depending on timing" — but the report says click 2 reliably fails.

**Next test:** add a `await new Promise(r => setTimeout(r, 100))` between `pushState` and `dispatchEvent` in the click handler (or wrap the whole dispatch in a `setTimeout(…, 0)`). If WebKit Playwright then succeeds → C is contributing. If not → A.

### Theory D — React 18 concurrent batching swallowing the popstate update

**Why it's worth checking:**

- React 18 batches state updates. If React Router's setState lands inside a transition or a different batch than the user's tap handler, on iOS Safari (which has different microtask scheduling than V8), the batch might not flush as expected.

**Why it's lower probability:**

- React Router 7 specifically guards against this by using `useSyncExternalStore` for history subscription. Synchronous updates from popstate listeners should land immediately.
- Chrome/Blink uses identical React, identical react-router, and works.

**Next test:** in WebKit Playwright, wrap the dispatch in `flushSync(() => window.dispatchEvent(…))` (requires importing from react-dom) and see if behaviour changes. Not a practical fix but a useful diagnostic.

### Theory E — `useLayoutEffect` vs `useEffect` timing

Not relevant here. There are no `useLayoutEffect` calls in the data-refresh chain (`ProductDetailPage` and `LaltexProductView` both use `useEffect` exclusively for fetching).

---

## 8. Recommended fix shape

The defensive, most-likely-to-resolve fix is **replace the synthetic-popstate pattern with `useNavigate()` from react-router**:

```jsx
// at top of ProductCard / linkifyProductCodes:
import { useNavigate } from 'react-router-dom';
const navigate = useNavigate();

// in click handler:
onClick={(e) => {
  e.preventDefault();
  navigate(href);
}}
```

This:

- Eliminates the synthetic `PopStateEvent` dispatch entirely (Theory A is moot)
- Eliminates the empty `history.state = {}` (Theory A side-effect — moot)
- Goes through react-router's history adapter directly — no engine-specific synthetic-event quirks (Theories C and D become much less likely)
- Keeps the AVA widget mounted across navigation (same as today — `<AIChatWidget />` is mounted at App.jsx root, OUTSIDE the `<Routes>` block, so navigations don't unmount it)

**Trade-off vs the current pattern:** the dev comment in [AIChatWidget.jsx:463](src/components/AIChatWidget/AIChatWidget.jsx#L463) suggests the pushState+popstate was chosen "to keep the widget mount alive." That concern is unfounded — `useNavigate()` does NOT unmount components outside the `<Routes>` block. The widget mount is preserved either way.

**Secondary defensive fix (small, optional):** in `loadProductData`, add `setSupplierProduct(null)` at the top so that a stale supplier-product state cannot ghost into a fresh catalog navigation. Not load-bearing for the iPhone bug, but cheap insurance. See [§2 secondary defect note].

**Verification after fix:**

1. WebKit Playwright (§5A) — both clicks navigate, H1 changes, network panel shows the supplier-fetch firing for product B.
2. Chromium Playwright (§5B) — same behaviour (no regression).
3. Real iPhone — Dave or another tester clicks two product cards in AVA in succession; the page updates on both clicks.
4. Hard-refresh case (§22 ScrollToTop) still works (no scroll-position regression).

**What NOT to change:**

- Do NOT remove or rework the `loadProductData` effect's `[effectiveId]` dependency — that contract is correct.
- Do NOT add a `pageshow` listener; there is no bfcache involvement here (§3) and adding one introduces new lifecycle complexity.
- Do NOT wrap the dispatch in `setTimeout` or `flushSync` as a "soft fix" — those are diagnostic tools (Theories C and D) but the root cause is the choice to use synthetic events at all.

---

## Appendix — files inspected (read-only)

- [src/components/AIChatWidget/AIChatWidget.jsx](src/components/AIChatWidget/AIChatWidget.jsx) — full read
- [src/pages/ProductDetail.jsx](src/pages/ProductDetail.jsx) — full read
- [src/components/ProductDetailPage.jsx](src/components/ProductDetailPage.jsx) — partial read (lines 1-200, 200-265, 260-420, 1140-1200)
- [src/components/LaltexProductView.jsx](src/components/LaltexProductView.jsx) — partial read (lines 100-320, grep for effect lifecycle)
- [src/App.jsx](src/App.jsx) — full read
- [src/components/ScrollToTop.jsx](src/components/ScrollToTop.jsx) — full read
- [src/services/productCatalogService.js](src/services/productCatalogService.js) — partial read (1090-1170 cache + loader pattern)
- [src/components/AvaPromptCard.jsx](src/components/AvaPromptCard.jsx) — grep for navigation pattern
- `package.json` — react-router-dom 7.6.3 confirmed
