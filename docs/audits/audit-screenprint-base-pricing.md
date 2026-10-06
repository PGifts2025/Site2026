# Audit — Screen Print Base Layer Pricing

**Date:** 2026-07-24
**Scope:** Read-only. No source file changed, no pricing logic touched, no PR.
**Questions:** (1) Is the site under-charging on dark screen-printed garments? (2) Can the light/dark difference be priced per colour, to support multi-colour lines?

---

## TL;DR

**Question 1 — is the site under-charging on dark garments?**

**On Laltex products: the site charges the same for dark and light. Verified live.** TF0101, Front / Spot Print, 50 units: **White £5.67/unit (£283.50), Black £5.67, Navy £5.67, Sky Blue £5.67.** Garment colour never enters the price calculation — `selectedColour` appears nowhere in the pricing path.

**But that is not automatically a loss.** Laltex's own trade pricing is *also* colour-blind: their print price is keyed on `(num_colours, num_position, min_qty)` only, with no garment-colour dimension anywhere in the feed. If Laltex bills Dave the same for Navy as for White, then charging the same is correct and there is **no leak**. If Laltex quietly bills the underbase as an extra colour at order time, there is.

**The API cannot answer that — only Laltex can.** This is the single question that determines whether a fix is needed. **Recommend Dave asks Laltex directly before any code is written.** Mitigating the urgency: **zero orders and zero quotes to date contain a screen-print selection**, so nothing has been mispriced yet.

**On PGifts Direct products: already correct.** `catalog_print_pricing` carries a `white`/`coloured` split and `ProductDetailPage` filters on it. Dark tees already cost more, in both garment *and* print.

**Question 2 — can it be priced per colour?**

Yes on the print side (the tier lookup is keyed on colour count, so an effective +1 is trivial to apply per colour). **No on the persistence side without schema work** — `quote_items.unit_price` is a single `numeric(10,2)` per line, so a mixed light/dark line needs either a blended average (the existing PGifts Direct precedent) or a line split, plus `size_breakdown` nesting colour above size.

**One finding that contradicts the brief's premise:** Dave's own PGifts Direct pricing does **not** treat the base layer as a full extra colour. At qty 25 the coloured uplift is **+£0.36**, whereas a genuine extra colour is **+£1.68**. See §3.

---

## 1. How print pricing is calculated today

### 1.1 The path, end to end

| Stage | Where | What happens |
|---|---|---|
| 1. Feed | Laltex `GET /v1/products/{code}` → `PrintDetails[]` | Each entry is a (position × print area × method) tuple with its own `PrintPrice[]` tier table |
| 2. Parse | [`scripts/lib/laltex-parser.js`](scripts/lib/laltex-parser.js) `parsePrintDetails` / `parsePrintPrice` | Tier fields kept: `num_colours`, `num_position`, `min_qty`, `max_qty`, `price`, `is_poa` |
| 3. Setup bake | same file, `bakeSetupIntoPrintPrice` (L242) | `all_in_unit_price = price + setup/min_qty + (num_colours-1)×extra_setup/min_qty` |
| 4. Margin | [`scripts/lib/laltex-margin.js`](scripts/lib/laltex-margin.js) `applyMarginsInPlace` | Adds `sell_price` per tier (schedule v2, §57) |
| 5. Store | `supplier_products.print_details` JSONB | Tiers persisted with `all_in_unit_price`, `sell_price`, `margin_applied_pct` |
| 6. Normalise | [`productCatalogService.js`](src/services/productCatalogService.js) | → `printDetails.positionGroups[].rows[].tiers[]`, `allInUnitPrice` alias |
| 7. Select | [`LaltexProductView.jsx`](src/components/LaltexProductView.jsx) `positionContributions` (L352) | `pickPrintTier(row.tiers, quantity, pick.colours)` |
| 8. Total | same, L422 | `unitPrice = basePrice + printPerUnitTotal + deliveryUnitWithMargin`, rounded 2dp (§48) |

### 1.2 How colour *count* affects price — banded, not linear

Each `PrintPrice` row is a distinct `(num_colours, min_qty)` cell with its own price. It is a **lookup table, not a formula**. TF0101 Front / Spot Print, customer-facing `sell_price` per unit:

| min_qty | 1 col | 2 col | 3 col | 4 col | Δ 1→2 |
|---|---|---|---|---|---|
| 25 | 3.6720 | 3.7530 | 4.0230 | 4.2930 | +£0.0810 |
| 50 | 2.1465 | 2.3490 | 2.8215 | 2.9565 | +£0.2025 |
| 100 | 1.4235 | 1.5535 | 1.6835 | 1.8135 | +£0.1300 |
| 250 | 0.9600 | 1.0225 | 1.0850 | 1.1475 | +£0.0625 |
| 500 | 0.7460 | 0.7215 | 0.7705 | 0.8318 | **−£0.0245** |
| 1000 | 0.5754 | 0.6234 | 0.6714 | 0.6954 | +£0.0480 |
| 2500 | 0.5542 | 0.6022 | 0.6502 | 0.6742 | +£0.0480 |
| 5000 | 0.5471 | 0.5951 | 0.6431 | 0.6671 | +£0.0480 |

> **Data-quality flag:** at the 500 band, 2 colours is **cheaper** than 1 colour in Laltex's own feed. Not caused by our margin (all tiers in a band take the same margin %). Minor, but if a "+1 colour" rule is ever implemented it would *reduce* the price at that band — worth a guard, and worth mentioning to Laltex.

**Ceiling:** `max_colours = 4` on this method. A 4-colour design on a dark garment would need a 5th (base) colour, which the method does not offer. Any +1-colour rule needs an explicit rule for designs already at the ceiling.

### 1.3 Setup charge — baked in, on `tier.min_qty`

Confirmed as the brief describes. `bakeSetupIntoPrintPrice` amortises `setup_charge / tier.min_qty` and adds `(num_colours − 1) × extra_colour_setup_charge / tier.min_qty`. For TF0101 Spot Print: `setup_charge = £29.50`, `extra_colour_setup_charge = null` (treated as 0). So the entire colour-count price difference above comes from the tier table itself, not from extra setup.

Because setup is amortised on the **tier's** `min_qty` and not the customer's actual quantity, the per-unit price is flat within a band (§46.3). Consumers must read `tier.sell_price` / `allInUnitPrice` and **never** re-add `setup_charge` (§46.4 R6).

### 1.4 Does garment colour enter the calculation? **No.**

Traced honestly. In `LaltexProductView.jsx`, `selectedColour` / `selectedColourId` are referenced only at:

- L232–234 — deriving the selected colour object
- L253 — `availableSizeNames` (which sizes exist in that colour)
- L272 — resetting `sizeQtys` on colour change
- L766, L776 — the swatch UI itself
- image/gallery/stock display

They appear in **none** of `baseTier`, `positionContributions`, `pickPrintTier`, `printPerUnitTotal`, `deliveryUnitWithMargin`, or `unitPrice`. There is no colour dimension in `product_pricing` either, so the blank garment cost is colour-blind too.

### 1.5 Worked example — light vs dark, side by side (live, measured in browser)

TF0101 (Fruit of the Loom Valueweight T, Womens) · Front position · **Spot Print** 280×380mm · 1 colour · 50 units:

| Garment colour | Price per unit (ex VAT) | Total (ex VAT) |
|---|---|---|
| **White** (light) | **£5.67** | **£283.50** |
| **Sky Blue** (light) | £5.67 | £283.50 |
| **Navy** (dark) | £5.67 | £283.50 |
| **Black** (dark) | £5.67 | £283.50 |

**Identical.** That is the answer to question one on the Laltex pool.

### 1.6 The PGifts Direct pool behaves differently — and is already correct

`catalog_print_pricing` has a `colour_variant` column (`'white'` | `'coloured'`, §6.4). `ProductDetailPage.jsx` resolves it from the selected swatch (`getColourVariant`, L1003) and filters the active pricing set on it (`activePrintPricing`, L1017), with per-row variants for mixed-colour orders (`getRowVariant`, L1037). So on the 5 PGifts Direct clothing products, dark garments already price higher. **No fix needed there.**

---

## 2. What the Laltex feed actually encodes

### 2.1 Every field bearing on print pricing

`print_details[]` keys (TF0101, all 34 entries):

```
print_class, print_type, print_position, print_area, max_colours, notes, lead_time,
setup_charge, setup_charge_raw, rpt_setup_charge, rpt_setup_charge_raw,
extra_colour_setup_charge, extra_colour_setup_charge_raw,
default_print_option, print_price[], print_area_coordinates[]
```

`print_price[]` tier keys (ours in italics):

```
num_colours, num_position, min_qty, max_qty, price, is_poa,
*all_in_unit_price*, *sell_price*, *margin_applied_pct*
```

**Print pricing is quoted per (method × position × colour-count × quantity band).** There is no colour, lightness, base, or garment-shade dimension at any level.

TF0101's screen print method is **`Spot Print`, `print_class = FSCREEN1`**, area 280×380mm, `max_colours = 4`, setup £29.50.

### 2.2 Do individual colours carry any classification? **No.**

`items[]` keys across the whole corpus:

```
item_code, item_colour, item_description, item_size, item_indicator, pms, seed_type,
item_images, plain_images
```

No lightness value, no light/dark flag, no colour group, **no hex**. `item_indicator` is the merchandising flag (`Clearance`, `New`, …), not a shade. `pms` is populated on only **3,033 of 10,027** variants (30%) and is a spot-ink reference, not a garment-shade classification.

Sample: `{"item_code":"TF01012X-AZBL","item_colour":"Azure Blue","item_size":"2Xtra Large","pms":null,...}`

### 2.3 Keyword sweep for base-layer language

Scanned the full `raw_payload` text of 300 products:

| Term | Hits |
|---|---|
| `underbase`, `under base`, `white base`, `base layer`, `baselayer` | **0** |
| `light garment`, `dark garment`, `on dark`, `on light` | **0** |
| `additional colour`, `extra colour` | **0** |
| `undercoat` | 5 — all pen products (TPC…), a barrel finish, unrelated |
| `flash` | 1 — `ice-p`, a torch product, unrelated |

Corpus-wide, **no `print_type` value mentions base, light, or dark** (checked all 1,219 products / ~6,000 print rows).

### 2.4 Conclusion for §2

**The Laltex feed does not encode the light/dark distinction anywhere.** Dave's hypothesis is not borne out. This is a clean negative result, and it changes the recommendation: any light/dark logic must be **ours**, layered on top of a colour classification we own.

---

## 3. Dave's own pricing sheet

### 3.1 The named file is not on this machine — BLOCKED

`Screen Print Gildan Heavy Tshirts November 2025.xlsx` **does not exist** anywhere under `C:\Users\Admin`. Two independent full-profile searches (`find` for `*Screen*Print*Gildan*`, and a PowerShell recursive scan of all `.xlsx`/`.xls`/`.csv` matching `screen|gildan|tshirt`) returned it nowhere. It is not in the project tree either.

Closest matches found, none of which are it:

| File | Why it isn't the one |
|---|---|
| `OneDrive\Documents\Gildan Heavy stock.xlsx` | Oct **2021**, 9 KB, a **stock** list not a price list. Also an OneDrive cloud placeholder — not downloaded locally, so unreadable (`End-of-central-directory signature not found`) |
| `OneDrive\Documents\Pad Screen Print Price List 2022.docx` (and 2005) | **Pad** printing (pens, hard goods), not garment screen print |
| `ROYAL BLUE T-SHIRTS JAN 2022.xlsx`, `SOLS 11380 NAVY T-SHIRTS JAN 2022.xlsx` | 2022 single-colour stock sheets |

**Action needed from Dave:** drop the file into the project (e.g. `docs/`) and this section can be completed. It is the one input this audit could not obtain.

### 3.2 The available proxy — and it is a good one

`catalog_print_pricing` (252 rows) **is** Dave's own clothing screen-print matrix, already in the database, and it **does** express the light/dark logic explicitly. This is very likely derived from the same commercial thinking as the missing sheet, so it is a strong stand-in until the sheet arrives.

Which products carry both variants:

| Product | Variants present |
|---|---|
| `t-shirts` | white (36 rows) + coloured (36) |
| `hi-vis-vest` | white (36) + coloured (36) |
| `hoodie`, `sweatshirts`, `polo` | coloured only |

**t-shirts — white vs coloured at the same (qty, colour_count):**

| qty | cols | garment W | garment C | garment Δ | print W | print C | **print Δ** |
|---|---|---|---|---|---|---|---|
| 25 | 1 | 2.41 | 2.96 | +0.55 | 2.92 | 3.28 | **+0.36** |
| 25 | 2 | 2.41 | 2.96 | +0.55 | 4.60 | 4.74 | +0.14 |
| 25 | 4 | 2.41 | 2.96 | +0.55 | 7.54 | 7.60 | +0.06 |
| 50 | 1 | 2.23 | 2.78 | +0.55 | 1.75 | 1.95 | **+0.20** |
| 100 | 1 | 2.05 | 2.60 | +0.55 | 1.01 | 1.21 | **+0.20** |
| 250 | 1 | 2.05 | 2.60 | +0.55 | 0.68 | 0.81 | +0.13 |
| 1000 | 1 | 2.05 | 2.60 | +0.55 | 0.44 | 0.58 | +0.14 |

Two distinct effects, correctly separated:
- **Garment cost** +£0.55 flat — the blank tee is dearer in colour. Nothing to do with printing.
- **Print cost** +£0.06 to +£0.36 — **this is the base-layer charge**, and it is real.

**hi-vis-vest:** garment Δ +£0.82–£1.00, but **print Δ = £0.00 at every band**. Consistent: both hi-vis "variants" are bright fluoro fabric, so there is no underbase distinction — exactly as the §6.4 mapping intends (yellow/orange → `'white'` is a *garment tier* device, not a shade claim).

### 3.3 Where Dave's model disagrees with the brief's premise — worth knowing

The brief frames the base layer as "**one extra print colour**". Dave's own pricing does **not** do that:

| At qty 25, 1-colour design | Print cost |
|---|---|
| White tee, 1 colour | £2.92 |
| **Coloured tee, 1 colour** | **£3.28** (+£0.36) |
| White tee, 2 colours (a genuine extra colour) | £4.60 (+£1.68) |

The coloured uplift is **~21% of a full extra colour**. That makes commercial sense — the underbase is one extra screen and one extra pass, but it is a flood of white rather than a registered colour, and the setup is shared.

**Implication:** if a fix is built, modelling the base as `num_colours + 1` would **overcharge by roughly 5×** relative to how Dave prices it himself on PGifts Direct. A percentage or fixed-pence uplift matches his existing model far better. This should be settled with Dave before implementation.

### 3.4 Does it agree with the API?

No, and they are not really comparable: the API expresses **no** light/dark difference at all, while Dave's own table expresses a modest one. The gap is precisely the open commercial question in §1 — does Laltex actually charge more, and if so how?

---

## 4. Classifying colours

Something must decide light vs dark. Nothing in the feed does, so we would own it.

### 4.1 Coverage on the products that matter

Across the **56 Laltex garments that offer screen print** there are **218 distinct colour names** (1,040 product-colour combinations).

| Source | Names classified | Share |
|---|---|---|
| PR #82 hex map (`src/utils/colourSwatches.js`) + luminance | **55** | 25% |
| \+ confident name tokens (`black/navy/charcoal/forest/…` vs `white/cream/pale/ash/…`) | +53 (43 dark, 10 light) | +24% |
| **Still unclassifiable** | **108** | **~50%** |

Weighted by actual product-colour combinations: **391 dark (38%), 232 light (22%), 417 unclassifiable (40%)**.

So the hex map alone covers a quarter of the names, and hex + name tokens together only reach about half. **Neither is sufficient on its own.**

### 4.2 Where a name heuristic is genuinely unsafe

108 names carry no reliable token. A representative slice:

> heather grey · heather green · heather red · heather royal · airforce blue · apple green · burnt orange · brick red · caramel latte · cranberry · digital lavender · dusty rose · dusty blue · dusty green · dusty lilac · earthy green · ginger biscuit · gold · hawaiian blue · ink blue · lagoon blue · lipstick pink · magenta magic · mocha · moondust grey · moss green · nude · orange crush · peppermint · pumpkin pie · red rust · shark grey · steel grey · storm grey · tropical blue · turquoise surf

Several of these are confidently dark to a human (ink blue, mocha, red rust) and confidently light to a human (nude, peppermint, peach perfect) — but no formula gets there without a lookup. Inventing one would be guessing.

### 4.3 Genuinely ambiguous — needs judgement, not a formula

Even among hex-mapped names, **20 sit near the boundary** (perceived luminance 90–170 on a 0–255 scale):

> Sky Blue (167) · Mustard (166) · Khaki (161) · Orchid (153) · Turquoise Blue (151) · Hot Pink (150) · Orange (147) · Cornflower Blue (144) · Denim Blue (137) · Electric Orange (133) · Electric Green (127) · Slate Grey (125) · Electric Pink (124) · Fuchsia (119) · Jade (112) · Olive (112) · Azure Blue (109) · Kelly Green (107) · Irish Green (106) · Fern (102)

These are exactly the shades where a print shop makes a call — mid-tones can go either way depending on ink opacity and the design's own colours. A threshold will be wrong on some of them whatever value is chosen.

Separately, **17 heather/marl names** exist on these garments (Dark Heather, Heather Grey, Heather Navy, Athletic Heather, Vintage Heather Red, …). PR #82 deliberately left heathers out of the hex map because a flat hex cannot honestly represent a textured two-tone fabric — and that same honesty applies here: heathers are usually mid-tone and often *do* need a base, but that is a trade judgement, not a computation.

### 4.4 Recommended approach

1. **A three-state classification — `light` / `dark` / `unknown`** — never a silent binary. Unknown must be visible, not defaulted into a charge.
2. **Store it as an owned lookup keyed on the normalised colour name** (lowercase, trimmed, whitespace-collapsed — the same normalisation `colourSwatches.js` already uses). A small table or a static map file; the corpus is only ~350 distinct names catalogue-wide, and 218 on the products that matter.
3. **Seed it** from the hex map + luminance (55 names, mechanical) and the confident tokens (53 more), then **have Dave review the ~108 remainder and the ~20 boundary cases in one sitting**. That is a single sub-hour task on a spreadsheet, done once.
4. **Handle `unknown` explicitly** — either do not apply the uplift (safe, slightly under-charges) or surface a "we'll confirm at proof" note. Do not guess silently.
5. **Note the casing duplicates:** the corpus has both `Black` (578) and `BLACK` (201), `White`/`WHITE`, `Red`/`RED`. Normalise on the way in or the lookup will miss a third of the rows.

**Reliability, stated plainly:** mechanical classification is trustworthy for roughly half the names and unreliable for the rest. Anything beyond that needs Dave's input once. A formula alone will be wrong on heathers, mid-tones, and evocative names (mocha, nude, storm grey), and those are not rare — they are ~50% of the catalogue's garment colours.

---

## 5. Scope of exposure

### 5.1 How many products offer screen print?

| Population | Count |
|---|---|
| Non-retired Laltex products | 1,219 |
| …with a Spot Print / screen method | 955 |
| **…that are actually garments** (multi-size, category = Clothing) | **56** |

The 955 figure is misleading on its own — Spot Print is the most common method in the catalogue (2,097 rows) and is applied to pens, mugs and bottles, where no underbase question arises. **The base-layer issue is confined to the 56 garments.**

### 5.2 Proportion of dark colours

Of 1,040 product-colour combinations on those 56 garments: **38% classify dark, 22% light, 40% unclassifiable** (§4.1). Taking the classifiable subset at face value, dark garments are roughly **63%** of the pool — plausible for promotional apparel, where navy/black dominate.

### 5.3 Per-unit shortfall on a representative order

**Only meaningful if Laltex actually charges more.** Two candidate models:

**Model A — billed as one extra colour** (the brief's framing), TF0101 Front Spot Print:

| Qty band | Δ 1→2 colours per unit | On a 50-unit order |
|---|---|---|
| 25 | +£0.0810 | £2.03 |
| **50** | **+£0.2025** | **£10.13** |
| 100 | +£0.1300 | £13.00 (at 100 units) |
| 250 | +£0.0625 | £15.63 (at 250 units) |
| 1000 | +£0.0480 | £48.00 (at 1000 units) |

**Model B — Dave's own PGifts Direct uplift** (§3.2), cost basis at 1 colour: +£0.36 (qty 25), +£0.20 (qty 50), +£0.20 (qty 100). At the current 22–35% margin schedule (§57) that is roughly **+£0.24 to +£0.49 per unit** at the sell price.

The two models differ by about 5×. Which applies is a commercial question, not a technical one.

### 5.4 Orders affected: none

`order_items` holds **6 rows**; `quote_items` holds **7 rows**. **Zero** of either contain a Spot Print / screen selection in `print_areas`. All are Dave's own test transactions. **Nothing has been mispriced, and there is nothing to remediate.**

That materially lowers the urgency: this is a "fix before real trade begins" item, not a live bleed.

---

## 6. Recommendation

### 6.0 Do this first — one question to Laltex

**Ask Laltex: when a design is screen printed onto a dark garment, do you charge more, and how — an extra colour, an uplift, or nothing?**

Everything downstream depends on the answer, and their API is silent on it. If the answer is "nothing", **no pricing fix is required on the Laltex pool at all** and this becomes purely a question-2 (multi-colour line) piece of work. Costs one email; potentially saves the entire §6.1 build.

### 6.1 Fixing current pricing

**Only if Laltex confirms they charge more.**

- **Where it lands:** the read path only — `positionContributions` in `LaltexProductView.jsx` (L352), applying an effective colour bump or uplift when (method is screen/spot) **and** (garment colour classifies dark). Both `pickPrintTier`'s colour argument and a straight per-unit uplift are easy to slot in there.
- **Also needs:** the colour classification from §4 (a small owned lookup + a one-off review by Dave), and normalisation of colour-name casing.
- **Schema:** none for the pricing itself if the classification is a static map file; one small table if it should be admin-editable. No change to `quote_items` / `order_items` for this half.
- **Guards required:** the `max_colours = 4` ceiling (a 4-colour design on dark has no 5th slot), and the qty-500 inverted band in §1.2 (a naive +1 rule would *lower* the price there).
- **PGifts Direct:** no change — already colour-aware (§1.6).
- **Size:** small-to-moderate. Half a day of code; the real cost is Dave's colour-classification pass and the commercial decision on the uplift model.

### 6.2 Enabling per-colour pricing on a combined line

**The data supports the print-side maths, but the persistence layer is the real work.**

- **Supported:** print price is already keyed on colour count per position, so computing a different effective price per garment colour is straightforward.
- **The blocker:** `quote_items.unit_price` is a single `numeric(10,2)` per line (§48). A line spanning Navy and White at different prices cannot express both. Two options:
  - **Blended weighted-average** — the existing precedent (`getClothingBlendedPrice`, §7.2, already does exactly this for PGifts Direct multi-colour rows). Keeps one line, one price; the per-colour detail lives in the breakdown JSONB.
  - **Split into one line per colour** — exact pricing, but loses the "one shared setup, one quantity tier" framing Dave wants, unless setup is deliberately apportioned.
  Recommend **blended**, matching what the site already does elsewhere.
- **`size_breakdown` must nest colour above size**, e.g. `{"Navy":{"S":5,"M":10},"White":{"S":5}}` — a shape change, not just an addition.
- **Consumers that would need updating** (each already reads the flat shape): `confirm_payment_atomic` (copies the JSONB), `sendOrderConfirmation.ts` and `sendInternalOrderAlert.ts` (both render the size split inline), `CustomerQuotes.formatPrintAreas`, and the quantity/MOQ validation in `LaltexProductView`.
- **VAT interaction:** `taxable_net_unit` is per line (§...VAT PR A). A blended unit price across colours must keep the zero-rated split coherent.
- **Size:** moderate-to-large, and it touches the payment path — so it wants its own verification pass.

### 6.3 One PR or two, and in what order

**Two PRs, strictly sequential.**

1. **PR 1 — pricing correctness** (gated on the Laltex answer). Small, self-contained, no schema churn on the money tables, independently shippable.
2. **PR 2 — multi-colour combined line.** Depends on PR 1 because *whether colour affects price* determines PR 2's shape entirely: if colour is price-neutral, a combined line is just a nesting change with one price; if it is not, PR 2 must carry the blending logic and the VAT interaction.

Doing them together would mix a small commercial correction into a schema change on the quote/order path — exactly the kind of bundled risk surface worth avoiding.

---

## Appendix — evidence

| Finding | Source |
|---|---|
| `unitPrice = basePrice + printPerUnitTotal + deliveryUnitWithMargin` | `LaltexProductView.jsx` L422 |
| `selectedColour` absent from every pricing memo | grep of `LaltexProductView.jsx`; only L232/253/272/766/776 + image/stock uses |
| Setup baked on `tier.min_qty`, extra-colour setup per extra colour | `laltex-parser.js` `bakeSetupIntoPrintPrice` L242–258 |
| TF0101 White/Black/Navy/Sky Blue all £5.67/unit, £283.50 @ 50 units | live browser measurement, dev server, Front + Spot Print |
| Print tier keys carry no colour dimension | `probe-screenprint-base.mjs tf0101` |
| No base/underbase/light/dark language in 300 raw payloads | `probe-screenprint-base.mjs keywords` |
| No `print_type` mentions base/light/dark across 1,219 products | `probe-screenprint-base.mjs methods` |
| `items[]` has no lightness/flag/hex; PMS on 30% of variants | `probe-screenprint-base.mjs tf0101` / `colours` |
| PGifts Direct print Δ white→coloured £0.06–£0.36; hi-vis £0.00 | `probe-screenprint-direct.mjs` |
| 56 screen-printable garments; 1,040 combos; 38% dark, 40% unknown | `probe-screenprint-exposure.mjs` |
| Hex map covers 55/218 names; tokens add 53; 108 unclassifiable | `probe-screenprint-delta.mjs` |
| TF0101 Δ 1→2 colours per band; qty-500 inversion | `probe-screenprint-delta.mjs` |
| Zero orders/quotes with a screen print selection | PostgREST scan of `order_items` (6) + `quote_items` (7) |
| Named xlsx absent from the machine | full-profile `find` + PowerShell recursive scan |

Probe scripts are left in `scripts/diagnostic/` (untracked) as the canonical re-runnable audit tools, per CLAUDE.md §37:
`probe-screenprint-base.mjs`, `probe-screenprint-direct.mjs`, `probe-screenprint-exposure.mjs`, `probe-screenprint-delta.mjs`.

**No source file was modified and no pricing logic was changed by this audit.**
