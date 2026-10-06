# Audit — Designer Layout Off-Centre on Smaller Screens

**Date:** 2026-06-04
**Scope:** Read-only audit. No source files changed.
**Route audited:** `/designer` → [`src/pages/Designer.jsx`](src/pages/Designer.jsx)
**Method:** Static read of the layout shell + live measurement in Playwright MCP at five viewport widths (1920 / 1440 / 1366 / 1280 / 1024).

---

## TL;DR

The page chrome (header) and the body's outer container are **both perfectly centred** at every width — `max-w-7xl mx-auto` works. The bug is **inside** that container: the three-column flex row contains **two fixed-width sidebars (320px + 288px) plus a middle column that cannot shrink below the fabric `<canvas>`'s pixel width**, so the columns sum to more than the container and **overflow to the right**. The middle (`lg:flex-1`) column is missing `min-w-0`, so flexbox's default `min-width:auto` blocks it from shrinking to fit.

Result: the Tools panel escapes the right edge of the centred container (by +119px at 1280, +145px at 1366, +185px at 1440), the assembly's visual centre is pushed right, and a horizontal scrollbar appears. On Dave's wide monitor the overflow still fits inside the viewport so it "looks fine"; on a 1366px laptop it does not.

**Recommended fix (lowest blast radius): add `lg:min-w-0` to the middle canvas column at [`Designer.jsx:5605`](src/pages/Designer.jsx#L5605).** One class. Does not touch the canvas coordinate system, the Tools panel, or the sidebars.

---

## 1. Designer page layout structure

Root component: [`Designer.jsx`](src/pages/Designer.jsx). Layout is **Tailwind utility classes** (no CSS modules, no inline width styles except on the canvas element itself). The shell is a single `flex` row that becomes a column on mobile.

JSX skeleton (outermost wrapper → three panels), with the load-bearing classes:

```jsx
// Designer.jsx:5072
<div className="min-h-screen bg-gray-50">

  {/* Header — centred, NOT part of the bug */}
  <div className="bg-white shadow-sm border-b">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">      // 5075
      ...Design Studio title...
    </div>
  </div>

  {/* Body — same centring container as the header */}
  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">  // 5101  ← centred container
    <div className="flex flex-col lg:flex-row gap-6">             // 5102  ← three-column row

      {/* LEFT: Product picker — FIXED 320px */}
      <div className="w-full lg:w-80 flex-shrink-0 order-1 lg:order-none space-y-6">   // 5104

      {/* (mobile-only print-location block, lg:hidden, width 0 on desktop) */}        // 5557

      {/* MIDDLE: Canvas — flex-1, but NO min-w-0 */}
      <div className="w-full lg:flex-1 order-3 lg:order-2">       // 5605  ← cannot shrink
        <div className="bg-gray-100 rounded-lg p-2 sm:p-4 lg:p-8">
          <div className="bg-white shadow-lg rounded-lg p-2 sm:p-4 w-full h-full">
            <div className="flex flex-row justify-between ...">   // 5609 header w/ 4 flex-shrink-0 buttons
            <div ref={canvasContainerRef} className="... overflow-auto"> // 5673
              <canvas width={canvasSize} className="max-w-full h-auto" /> // 5687  ← fixed px width
          </div>
        </div>
      </div>

      {/* RIGHT: Tools — FIXED 288px */}
      <div className="w-full lg:w-72 flex-shrink-0 order-4 lg:order-last">  // 5708
    </div>
  </div>
</div>
```

| Column | Line | Desktop width class | Computed | Shrinkable? |
|---|---|---|---|---|
| Product picker (left) | 5104 | `lg:w-80 flex-shrink-0` | **320px fixed** | No (`flex-shrink-0`) |
| Canvas (middle) | 5605 | `lg:flex-1` | fluid share | **No — missing `min-w-0`** |
| Tools (right) | 5708 | `lg:w-72 flex-shrink-0` | **288px fixed** | No (`flex-shrink-0`) |

---

## 2. Width and centring behaviour

- **Outermost width constraint:** `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` ([5101](src/pages/Designer.jsx#L5101)) — 1280px max, auto-centred. **This is correct and identical to the header** ([5075](src/pages/Designer.jsx#L5075)).
- **Column sizing:** mixed. Left and right are **fixed** (`w-80` / `w-72` + `flex-shrink-0`). Middle is **`flex-1`** (fluid) — but its content (a fixed-pixel `<canvas>`) gives the flex item a non-zero automatic minimum size.
- **min-width forcing overflow:** Yes — implicitly. The middle column has no `min-w-0`, so its effective minimum is the canvas's pixel width (`canvasSize`, 600–720px depending on viewport) plus card padding. It cannot shrink to its fair flex share.

**Measured centring proof** — the container *is* centred at every width; only the *content inside it* overflows:

| Viewport | Header container L→R | Body container L→R | Centred? |
|---|---|---|---|
| 1920 | 313 → 1593 | 313 → 1593 | ✅ identical |
| 1440 | 73 → 1353 | 73 → 1353 | ✅ identical |
| 1366 | 36 → 1316 | 36 → 1316 | ✅ identical |

So **Theory B is ruled out** — the outer container has `max-w-* mx-auto` and is centred.

**Comparison to Home.jsx:** Home uses the *same* `max-w-7xl mx-auto` pattern ([`Home.jsx:255,358,409,526,…`](src/pages/Home.jsx#L255)). The difference is **not** the centring container — it's the children. Home's children are normal block/grid content that wraps and shrinks. Designer's children are two rigid sidebars + a pixel-locked canvas that together exceed the container and overflow.

---

## 3. Breakpoint behaviour

- **Responsive classes present:** `lg:` (flex-row vs flex-col, the column widths), `sm:` (canvas card padding), plus a `lg:hidden` mobile-only print block. The three-column row activates at the **`lg` breakpoint = 1024px**. Below 1024 everything stacks vertically (`flex-col`) and is fine.
- **Where it breaks:** the overflow exists at **every width where the row is active** (≥1024px). It is *invisible* only when the viewport is wide enough to absorb the overflow without a scrollbar.

### Live measurements (Playwright MCP)

Fixed overhead is constant: left 320 + right 288 + two `gap-6` (24px each) = **656px**. The canvas column needs whatever the container has left, but refuses to go below the canvas pixel width.

| Viewport | flex-dir | canvas `width` attr | Columns (L / C / R) | Cols + gaps | Container inner | Page H-scroll | **Tools panel juts past container** |
|---|---|---|---|---|---|---|---|
| **1920** | row | 720 | 320 / 816 / 288 | **1472** | 1216 | none (fits viewport) | **+224px** |
| **1440** | row | 680 | 320 / 776 / 288 | **1432** | 1280 | **97px** | **+185px** |
| **1366** | row | 640 | 320 / 736 / 288 | **1392** | 1280 | **94px** | **+145px** |
| **1280** | row | 600 | 320 / 696 / 288 | **1352** | 1265 | **104px** | **+119px** |
| **1024** | row | ~600 | 320 / 656 / 288 | **1312** | 1009 | **320px** | **+335px** |

**Reading of the table:**
- At **1920** the columns already sum to 1472 vs a 1216 container — the assembly overflows the *centred container* by 256px, but since the overflow (right edge at x=1817) is still less than the 1920 viewport, no scrollbar appears and Dave sees it as "fine" (though the assembly's centre is actually ~120px right of the viewport centre).
- At **1440 and below** the overflow exceeds the free viewport margin, so a **horizontal scrollbar appears** and the Tools panel visibly juts out to the right. **This is the colleague's 1366px case.**
- At **1024** the lg row activates with the least room, giving the worst overflow (+335px).

The layout **first stops fitting cleanly the moment the `lg` row engages (1024px)** and stays broken up to ~1870px (where 1472px of content finally fits within the viewport again).

### Screenshots

![1920px](designer-1920.png)
*1920px — fits the viewport, so it reads as "fine", but the assembly is already shifted right of centre.*

![1440px](designer-1440.png)
*1440px — Tools panel overflows the right edge; horizontal scrollbar present.*

![1366px](designer-1366.png)
*1366px — the reported broken case. Header centred, three-column area shifted right, Tools panel flush against / past the right edge.*

![1280px](designer-1280.png)
*1280px — same failure, canvas squeezed further.*

![1024px](designer-1024.png)
*1024px — worst case; lg row activates with no room, +335px overflow.*

---

## 4. Canvas-specific positioning

- **Intrinsic width:** the `<canvas>` `width`/`height` attributes are bound to the **`canvasSize` state** ([5689](src/pages/Designer.jsx#L5689)), default **800** ([79](src/pages/Designer.jsx#L79)). A `useEffect` ([554–595](src/pages/Designer.jsx#L554)) recomputes it on mount and on `window.resize`:
  ```js
  const containerWidth = canvasContainerRef.current.clientWidth;   // 566
  newSize = Math.min(containerWidth - 40, 800);                    // 575 (desktop)
  setCanvasSize(newSize);
  ```
  Measured values: 720 → 680 → 640 → 600 as the viewport narrows. So the canvas **does** scale responsively, and the Fabric canvas **re-initialises on every `canvasSize` change** (effect deps `[canvasSize]`, [668](src/pages/Designer.jsx#L668)).

- **Is the canvas constrained independently from its coordinate system?** Partially. The `<canvas>` carries `className="max-w-full h-auto"` ([5691](src/pages/Designer.jsx#L5691)) and its wrapper has `overflow-auto` ([5675](src/pages/Designer.jsx#L5675)). `max-w-full` *would* let the canvas display-shrink. **But the fixed `width` attribute still gives the flex item a non-zero automatic minimum size**, and because the middle column lacks `min-w-0`, that minimum leaks into the layout and prevents the column from shrinking to its flex share.

- **The feedback loop that perpetuates it:** `canvasSize` is derived from `canvasContainerRef.clientWidth`. When the column is *already overflowing*, `clientWidth` reports the overflowed (too-wide) width, so `canvasSize` is set large, which keeps the column wide — the measurement never sees the *available* width because the column never had to fit. This is why narrowing the viewport shrinks the canvas a little but never enough to clear the overflow.

---

## 5. Tools panel and Product picker sizing

- **Tools panel (right):** **fixed** — `lg:w-72` = 288px, `flex-shrink-0`. Its internal sections (Add Elements, Text Options, Transform, etc.) are fine; width is rigid regardless of content. Measured 288px at every width.
- **Product picker (left):** **fixed** — `lg:w-80` = 320px, `flex-shrink-0`. Measured 320px at every width.
- **Consequence:** both flanks are rigid (608px combined), the middle is content-locked, so the three children are *all* effectively non-shrinking. The parent container is fluid/centred, but its rigid children overflow it — exactly the "fluid parent, rigid children" assembly the prompt anticipated.

---

## 6. Theory ranking

| Rank | Theory | Verdict | Evidence |
|---|---|---|---|
| **1** | **A — Fixed canvas width + fixed columns exceed container; no shrink-to-fit** | ✅ **CONFIRMED (primary cause)** | Columns sum 1312–1472px vs container 1009–1280px at every tested width. Canvas column won't shrink below the `<canvas>` pixel width (`canvasSize` 600–720) + padding. Middle column is `lg:flex-1` **without `min-w-0`**, so `min-width:auto` blocks shrinking. Overflow lands rightward → Tools panel escapes the right edge. |
| **2** | **D — Three columns behave like fixed tracks** | ✅ **Effectively true (same root cause as A)** | Two columns are *literally* fixed (`w-80`/`w-72` + `flex-shrink-0`); the third is `flex-1` but content-locked, so functionally it's a third fixed track. This is the mechanism behind A, not a separate bug. |
| 3 | C — wrapper uses `justify-start` instead of centre | ❌ Not the cause | The row defaults to `flex-start`, but if the content *fit*, `flex-1` would fill the row and centring would be moot. The issue is overflow, not justification. Changing justify would not stop the overflow. |
| 4 | B — outer container missing `max-w-*` + `mx-auto` | ❌ Ruled out | Body container is measured **identical** to the (correctly centred) header at every width (e.g. both 36→1316 at 1366). The container is centred; its content overflows it. |
| 5 | E — absolute element with hardcoded `right: Xpx` | ❌ Not present | No `position:absolute` + `right:` hardcoding in the layout shell. The Tools panel is a normal flow flex child; its rightward position is the overflow, not absolute positioning. |

---

## 7. Recommended fix (prose only)

### Primary recommendation — one class, minimum blast radius

**Add `lg:min-w-0` to the middle canvas column at [`Designer.jsx:5605`](src/pages/Designer.jsx#L5605):**

```
- <div className="w-full lg:flex-1 order-3 lg:order-2">
+ <div className="w-full lg:flex-1 lg:min-w-0 order-3 lg:order-2">
```

This is the canonical flexbox remedy for "a flex child won't shrink below its content and overflows its container." `min-w-0` overrides the default `min-width:auto` on the flex item, letting `flex-1` shrink the middle column to its true fair share (`container − 656px`). The canvas already carries `max-w-full h-auto`, so it display-scales down to fit the now-correctly-sized column, and the existing `canvasSize` resize handler then reads the *correct* (non-overflowed) `clientWidth` and computes an appropriate canvas size — breaking the feedback loop described in §4.

**Why this is the lightest fix:**
- One Tailwind class on one element.
- Touches only the middle column's *flex shrink behaviour* — not the sidebars, not the Tools panel content, not the canvas markup.
- Mirrors the pattern the rest of the app already relies on (Home's children all shrink/wrap inside the same `max-w-7xl mx-auto`); it makes Designer's middle column behave like a normal fluid flex child.

### Direct answers to the prompt's specific questions

- **Will the fix affect the canvas's render dimensions (i.e. existing saved designs)?**
  **No new risk.** The canvas's internal size (`canvasSize`) is *already* recomputed on every viewport resize and the Fabric canvas *already* re-initialises on each change (effect deps `[canvasSize]`, [668](src/pages/Designer.jsx#L668)) — observed live: 720→680→640→600 across widths. `min-w-0` does not introduce canvas resizing; it only ensures the column is sized from the *available* width instead of an overflowed one. Saved-design rendering is governed by the existing `canvasSize`-based init/load path, which the fix does not alter. The canvas's **internal coordinate system and Fabric.js setup are untouched** — only the surrounding column's CSS shrink behaviour changes.

- **Will the fix change the Tools panel's content layout (sections in the right rail)?**
  **No.** The Tools panel keeps `lg:w-72 flex-shrink-0` (288px). Its sections render exactly as before; it simply stops being pushed past the container's right edge.

- **Will the fix work down to the 1280px floor?**
  **Yes.** At 1280px the fixed overhead is 656px, leaving ~609px for the canvas column inside the 1265px container — comfortably enough for the canvas to scale into. At 1366px it leaves ~624px. The overflow and horizontal scrollbar disappear at both, and the assembly centres within `max-w-7xl`. (At the 1024px `lg` breakpoint the canvas column would shrink to ~353px — functional but cramped; see optional note below.)

### Conservative fallback (only if the team distrusts any canvas-size change)

If there is concern about the canvas re-initialising at a different size than today, a non-flex alternative is to **leave all three column widths exactly as-is and instead prevent the overflow by capping the rigid assembly**: keep the fixed sidebars, but the assembly will still overflow because the total exceeds the container — so the truly conservative version is to **defer the three-column row to a wider breakpoint** (e.g. change `lg:flex-row` → `xl:flex-row` and the matching `lg:` column classes to `xl:`), so the columns stack vertically until there is genuinely room (1280px) for the row. This guarantees the canvas pixel size only ever matches today's wide-monitor value and never the squeezed mid-range value. Trade-off: 1024–1279px users get a stacked layout instead of three columns. This is heavier UX-wise than the one-class `min-w-0` fix and is **not** recommended unless the canvas-resize concern proves real in testing.

### Optional follow-up (out of scope, not required)

Even with `min-w-0`, the `lg` breakpoint (1024px) gives the canvas only ~353px. If mid-range laptops should keep a roomier canvas, consider stacking until `xl` (1280px) as a *separate* UX decision. Not needed to fix the reported bug (the report floor is 1280px, which the primary fix handles cleanly).

---

## Appendix — files & lines referenced

| File | Lines | What |
|---|---|---|
| [`Designer.jsx`](src/pages/Designer.jsx#L5101) | 5101 | Centred body container (`max-w-7xl mx-auto`) — correct |
| [`Designer.jsx`](src/pages/Designer.jsx#L5102) | 5102 | Three-column flex row (`flex flex-col lg:flex-row gap-6`) |
| [`Designer.jsx`](src/pages/Designer.jsx#L5104) | 5104 | Left sidebar — fixed `lg:w-80 flex-shrink-0` |
| [`Designer.jsx`](src/pages/Designer.jsx#L5605) | 5605 | **Middle canvas column — `lg:flex-1`, missing `min-w-0` (the fix site)** |
| [`Designer.jsx`](src/pages/Designer.jsx#L5687) | 5687–5701 | `<canvas>` with `width={canvasSize}` + `max-w-full h-auto` |
| [`Designer.jsx`](src/pages/Designer.jsx#L5708) | 5708 | Right Tools panel — fixed `lg:w-72 flex-shrink-0` |
| [`Designer.jsx`](src/pages/Designer.jsx#L554) | 554–595 | `canvasSize` responsive recompute (mount + resize) |
| [`Designer.jsx`](src/pages/Designer.jsx#L668) | 636–668 | Fabric canvas re-init on `[canvasSize]` change |
