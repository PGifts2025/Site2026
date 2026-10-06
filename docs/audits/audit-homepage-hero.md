# Audit — Homepage hero structure (read-only)

> Scope: map the two-panel hero so the conversion of the **right panel** into a 2-slide carousel can be drafted. No code was changed.

**TL;DR**
- Everything lives in **`src/pages/Home.jsx`** — no dedicated Hero component, **no slider library** (the carousel is a hand-rolled opacity crossfade).
- Left panel = a 2-slide auto-carousel driven by `heroSliderContent` + `heroSlide` state. Right panel = a **separate static block** driven by a single `rightHeroBlock` object.
- Converting the right panel means: turn `rightHeroBlock` (object) into an array, add a `useState`/`useEffect` pair mirroring the left one, and clone the left panel's JSX (stacked absolute slides + dot indicators).
- Slide images are in **Supabase storage** (`product-templates/hero-banners/`), not `src/assets` or `/public`.
- No tests cover the hero; hero data is referenced nowhere outside `Home.jsx`. Low risk.

> ⚠️ Minor correction to the brief: the **left** carousel's two slides are **"BRANDED WATER BOTTLES"** (slide 1) and **"BRANDED CUPS"** (slide 2) — not "BRANDED CUPS" + another. Verbatim below.

---

## 1. File location

- Homepage route: `src/App.jsx:74` → `<Route path="/" element={<Home />} />` (import at `src/App.jsx:4`).
- Hero renderer: **`src/pages/Home.jsx`**.
  - Hero **data**: lines **46–81** (`heroSliderContent` array + `rightHeroBlock` object).
  - Hero auto-advance **effect**: lines **130–136**.
  - Hero **JSX**: lines **248–322** (the `{/* Hero Image Blocks */}` `<section>`).

---

## 2. Left carousel — implementation

- **No third-party library.** No `swiper` / `embla` / `keen-slider` / `react-slick` / headlessui / framer-motion import anywhere in `src/`. It's a custom crossfade: all slides absolutely stacked, only the active one at `opacity-100`.
- **Slides defined** as an inline JSX-component array (hardcoded), `src/pages/Home.jsx:47-68`:

```jsx
// Hero slider content
const heroSliderContent = [
  {
    id: 1,
    title: "BRANDED WATER BOTTLES",
    subtitle: "from just 85p",
    buttonText: "ORDER NOW",
    bgColor: "bg-blue-500",
    textColor: "text-white",
    imageUrl: "https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/hero-banners/left-slider-1.png",
    link: "/water-bottles/water-bottle"
  },
  {
    id: 2,
    title: "BRANDED CUPS",
    subtitle: "from just £1.20",
    buttonText: "ORDER NOW",
    bgColor: "bg-green-600",
    textColor: "text-white",
    imageUrl: "https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/hero-banners/left-slider-2.png",
    link: "/cups/chi-cup"
  }
];
```

- **State:** `const [heroSlide, setHeroSlide] = useState(0);` (`src/pages/Home.jsx:24`).
- **Autoplay:** yes — `setInterval` every **5000 ms**, loops via modulo (`src/pages/Home.jsx:130-136`):

```jsx
// Auto-slider for hero section
useEffect(() => {
  const timer = setInterval(() => {
    setHeroSlide((prev) => (prev + 1) % heroSliderContent.length);
  }, 5000);
  return () => clearInterval(timer);
}, [heroSliderContent.length]);
```

- **Loop:** yes (modulo). **Pause-on-hover:** **no** (the hero has none; only the separate Best Sellers slider below uses `isSliderPaused`). **Manual controls:** dot indicators only (clickable), no prev/next arrows — `src/pages/Home.jsx:284-295`.
- **Image source:** Supabase Storage public bucket — `…/storage/v1/object/public/product-templates/hero-banners/left-slider-1.png` and `left-slider-2.png`. Not imported from `src/assets`, not from `/public`.
- `bgColor` is defined on each slide object but **not used** in the JSX (the image covers the panel); only `title`, `subtitle`, `buttonText`, `textColor`, `imageUrl`, `link` are rendered.

---

## 3. Right panel — implementation

- **Separate static block**, NOT part of the left carousel — it's a sibling `<div>` in the grid with its own markup. No state, no interval.
- **Data** (single object), `src/pages/Home.jsx:70-81`:

```jsx
// Static right hero block
const rightHeroBlock = {
  id: 3,
  title: "GRS RECYCLED TOTE BAGS",
  subtitle: "FROM JUST 58p A UNIT, WITH YOUR LOGO",
  description: "We've secured the UK's lowest prices for our best-selling promotional totes. Bag a bargain for your business today!",
  buttonText: "View Product",
  bgColor: "bg-gray-100",
  textColor: "text-gray-900",
  imageUrl: "https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/hero-banners/right-bags.png",
  link: "/bags"
};
```

- **JSX**, `src/pages/Home.jsx:298-321`:

```jsx
{/* Right - Static Bags Block */}
<div className="rounded-lg relative overflow-hidden h-64">
  {/* Background Image */}
  <img
    src={rightHeroBlock.imageUrl}
    alt={rightHeroBlock.title}
    className="absolute inset-0 w-full h-full object-cover object-center"
  />

  {/* Dark overlay for text readability */}
  <div className="absolute inset-0 bg-black/5"></div>

  {/* Content */}
  <div className="absolute inset-0 p-4 sm:p-8 flex items-center justify-between">
    <div className="z-10">
      <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-2 drop-shadow-lg text-white">{rightHeroBlock.title}</h2>
      <p className="text-base sm:text-xl text-red-500 font-bold mb-4 drop-shadow-lg">{rightHeroBlock.subtitle}</p>
      <p className="text-xs sm:text-sm mb-6 max-w-md drop-shadow-lg text-white/90">{rightHeroBlock.description}</p>
      <Link to={rightHeroBlock.link} className="inline-block bg-gray-800 text-white px-4 py-2 sm:px-6 sm:py-3 rounded font-semibold hover:bg-gray-700 transition-colors text-sm sm:text-base shadow-lg">
        {rightHeroBlock.buttonText}
      </Link>
    </div>
  </div>
</div>
```

- **Image/text storage:** same pattern as the left — image in Supabase storage (`right-bags.png`), text hardcoded in the `rightHeroBlock` object. Not the same array as the left slides (separate object).
- **Link target:** the "View Product" button → `to="/bags"` (`rightHeroBlock.link`, line 80).

### Notable differences left vs right (relevant to converting the right into a carousel)
| | Left (carousel) | Right (static) |
|---|---|---|
| Has `description` line | no | yes (`<p>` at line 315) |
| Subtitle colour | `text-yellow-300` (L275) | `text-red-500` (L314) |
| Button style | white bg, dark text (L276) | dark-gray bg, white text (L316) |
| Title colour | `block.textColor` (L272) | hardcoded `text-white` (L313) |
| Slides / indicators | yes (L284-295) | none |

A faithful right-carousel will need to decide whether to keep the right panel's distinct styling (description line, red subtitle, dark button) per slide, or unify with the left.

---

## 4. Shared layout

- Wrapper `<section>`: `src/pages/Home.jsx:249` → `className="max-w-7xl mx-auto px-4 py-6"`.
- Two-panel grid: `src/pages/Home.jsx:251`:

```jsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 md:h-64">
```

- Each panel is `h-64` (256px) fixed height. Left wrapper `relative overflow-hidden rounded-lg h-64` (L253); right wrapper `rounded-lg relative overflow-hidden h-64` (L299).
- **Responsive:** `grid-cols-1` (mobile default) → **stacked** (left carousel on top, right block below). `md:grid-cols-2` (≥768px) → side by side. `md:h-64` sets the row height at md+.
- **Mobile:** both panels show and stack; neither is hidden.

---

## 5. CSS / animation

- **No custom CSS file** for the hero — pure Tailwind utilities. (`src/index.css` has unrelated `.ava-*` rules for the Ava widget; nothing hero-specific.)
- Animation classes:
  - Left slide crossfade: `absolute inset-0 transition-opacity duration-1000` toggled between `opacity-100` / `opacity-0` (`src/pages/Home.jsx:257-259`). 1-second fade.
  - Dot indicators: `transition-all duration-300`, active dot widens to `w-6` (`src/pages/Home.jsx:290-292`).
  - Buttons: `transition-colors`.
  - The right panel currently has **no** transition (static). A right carousel would reuse the same `transition-opacity duration-1000` pattern.

---

## 6. Risk surface

- **Reuse:** `heroSliderContent`, `rightHeroBlock`, and the image filenames (`left-slider-*`, `right-bags`) appear **only** in `src/pages/Home.jsx`. The copy strings ("BRANDED CUPS", "GRS RECYCLED TOTE BAGS") are not referenced by any other page, util, or test.
- **Tests:** none cover the hero. The only first-party test file is `src/tests/printAreaSystem.test.js` (unrelated; all other `*.test.*` hits are inside `node_modules`).
- **Cross-file dependencies for the change:** none beyond `Home.jsx`. The only external dependency the hero uses is `Link` from `react-router-dom` (already imported) and the Supabase storage bucket for images (new right-carousel images would be uploaded there, matching the existing `hero-banners/` convention).

---

*Read-only audit. No source files edited, no packages installed, no commits/PR. This report is an untracked file at the repo root.*
