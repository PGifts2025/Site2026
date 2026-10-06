# Audit — Direct Bag Print Config "Regression"

**Date:** 2026-07-29
**Scope:** Read-only. No source changed, no PR.
**Question:** Bags lost their print configuration. Did PR #88 break a shared path, and where is the stored bag print pricing?

---

## TL;DR — two headline findings, both contradicting the brief's assumption

**1. This is NOT a PR #88 regression.** #88's diff touches only the *clothing* pricing branch. It changes nothing in the flat/coverage path, the print-config render condition, or the data-load — verified by grep (zero matches). The condition that hides bag print config (`printPricingData.length > 0`) was added on **2026-02-27** (commit `0c2a2e4`, the original print-pricing feature), **five months before** #85/#88. #88's migration only inserts *clothing* rows; it never touches bags. Reverting #88 would not bring back bag print options and would re-break the clothing fix.

**2. There is no stored bag print pricing to surface.** `catalog_print_pricing` holds exactly **360 rows = 5 clothing products × 72** (t-shirts, hi-vis-vest, polo, hoodie, sweatshirts). **Every bag — and every other non-clothing Direct product — has 0 rows.** It is not in `catalog_pricing_tiers` (that holds only the flat product price) nor on `catalog_products` (no print-cost field). No seed in the repo ever created bag print rows. So Dave's premise "that pricing still exists in Supabase" is not borne out by anything I can find.

**What is actually happening:** bags are `pricing_model = 'flat'`. The flat model's only print UI is an *"Add second position"* checkbox, and it is gated on `printPricingData.length > 0`. With zero print rows, that gate is false, so no print UI renders and the price is just the flat `catalog_pricing_tiers` value (£2.99/unit). This has been the state for every flat product since the feature shipped in February — it is a **data gap, not a code regression**.

**The fix is therefore data + a product decision, not a code revert:** decide how bags should be decorated and priced, then seed it. Details in §6.

*(Caveat stated honestly: I cannot inspect historical DB snapshots, so I cannot prove bags *never* had rows in some past state. I can prove: none exist now, no repo seed ever created them, #88 didn't remove them, and the hiding condition long predates #88.)*

---

## 1. Reproduce and compare against clothing — the exact divergence

**5oz Cotton Bag** — product code / slug `5oz-cotton-bag` (id `5c0b2e9b-b411-493e-9d80-a0c0dcb98efc`). `pricing_model = 'flat'`, `max_print_positions = 2`, `is_customizable = true` (it *is* designable — has a `designer_product_id`).

**Polo** — slug `polo`, `pricing_model = 'clothing'`, `max_print_positions = 3`.

Both render through the same component, `ProductDetailPage.jsx`. The print-config UI splits on `pricing_model`:

| | Polo (clothing) | 5oz Bag (flat) |
|---|---|---|
| Print-config JSX | `{product.pricing_model === 'clothing' && ( … Print Positions … )}` — **line 1774** | `{printPricingData.length > 0 && ( … "Add second position" … )}` — **line 1797/1800** |
| Gate type | **Model/code** — unconditional for clothing, always shown | **Data** — only if `catalog_print_pricing` has rows |
| Rows in `catalog_print_pricing` | 72 | **0** |
| Result | Print Positions render (per-position colour-count dropdowns) | Gate is false → **no print UI** |
| Price path (`getEffectivePricePerUnit`) | clothing branch (garment + print / total) | flat branch: `secondPosition` can't be toggled (no UI) and no `extra_position_price` row → returns `tierBase` = **£2.99** |

**The precise field that diverges:** clothing's print UI is gated on the *model string* `pricing_model === 'clothing'` (always true for a polo). The flat/coverage print UI is gated on the *data condition* `printPricingData.length > 0` (false for a bag, because it has no rows). That single condition — [`ProductDetailPage.jsx:1797`](src/components/ProductDetailPage.jsx#L1797) — is why the polo shows print config and the bag does not.

Note the clothing model was **never** the bag's path. Bags are flat and, by design, only ever offered a flat "second position" toggle, not clothing-style per-colour-count positions. So "make bags look like the polo" would be a *new* capability, not a restoration (see §6).

## 2. The stored bag print pricing — it isn't there

I checked every candidate location:

**`catalog_print_pricing`** — the table that holds clothing print pricing. **0 rows for `5oz-cotton-bag`.** In fact 0 rows for every bag:

```
5oz-cotton-bag           print_rows = 0
5oz-mini-cotton-bag      print_rows = 0
5oz-recycled-cotton-bag  print_rows = 0
8oz-canvas               print_rows = 0
12oz-recycled-canvas     print_rows = 0
```

The whole table (360 rows) belongs to the five clothing products only:
`{ t-shirts: 72, hi-vis-vest: 72, polo: 72, hoodie: 72, sweatshirts: 72 }`.

**`catalog_pricing_tiers`** — holds the flat product price for the 5oz bag, and **only** that (no print/colour dimension):

```
q 25-49   £2.99      q 250-499  £2.09
q 50-99   £2.69      q 500-999  £1.79
q 100-249 £2.39      q 1000+    £1.49
```

This is exactly what the page shows (£2.99 @ 25 = £74.75). It is the flat unit price, **one figure regardless of colour**.

**`catalog_products`** — no print-cost field. Only `max_print_positions = 2` (a UI hint) and `pricing_model = 'flat'`. No per-product price data.

**Structure question (bag print priced how?):** it isn't priced at all. The flat model's schema ([`database/migrations/010_add_print_pricing.sql`](database/migrations/010_add_print_pricing.sql)) provides a single `extra_position_price` column for a flat second-position add-on — no colour-count dimension, no natural/coloured split. Even that column is empty for bags (no rows).

**Natural vs coloured (Dave's open question):** there is **nothing stored to distinguish them**. Bags have one colour-independent flat price and no print pricing at all. So there are no current figures to review — Dave would be *creating* bag print/colour pricing from scratch, not adjusting existing numbers.

## 3. What #88 changed — and why it isn't this

`git diff main..#88 -- src/components/ProductDetailPage.jsx`, every hunk:

- Added `import { colourNeedsWhiteBase }`.
- `getColourVariant`: the return line now uses the shared exempt set.
- Added `findTotalRow`, `findGarmentSell`, `getClothingTotalPrice`.
- Rewrote `getClothingBlendedPrice` and the **`pricing_model === 'clothing'` branch** of `getEffectivePricePerUnit`.

Grep of the full #88 diff for `printPricingData.length`, `secondPosition`, `pricing_model === 'flat'`, `pricing_model === 'coverage'`, `extra_position_price`, `getProductPrintPricing`, `coverage_type`:

```
NONE — #88 does not touch the flat/coverage/render-gate/data-load paths
```

- The render gate `printPricingData.length > 0` was introduced in **`0c2a2e4` (2026-02-27)** — the original "Add print position pricing" commit — **five months before** #85 (2026-07-27) and #88. `git log -S "printPricingData.length > 0"` returns only that one commit.
- #88's migration (`20260729_direct_clothing_total_sell_price.sql`) `UPDATE`s/`INSERT`s **only** t-shirts/hoodie/sweat/polo rows. It never references any bag. (It is also not confirmed applied to prod yet — you hit the dotenv-line error, which I fixed.)
- Even #88's one shared change — `getColourVariant` now mapping Natural → `'white'` — has **zero** effect on bags: `activePrintPricing` filters `catalog_print_pricing` rows, of which a bag has none, so the variant it resolves to changes nothing. The flat price comes from `catalog_pricing_tiers` (colour-independent).

**Did #88 add a condition bags fall into incorrectly?** No. Bags were on the flat path before #88 and are on the identical flat path after. The sub_category allow-list and `total_sell_price` lookup live entirely inside the clothing branch, which bags never enter.

## 4. Data-driven or code-driven?

**Data-driven.** Bags show (or don't show) print config purely on whether `catalog_print_pricing` has rows for them — the code path (`ProductDetailPage.jsx:1797`) is intact and unchanged. The data has never existed for bags. So:

- The **code is fine** — no bypassed branch, no #88 breakage.
- The **data is absent** — and, as far as the repo and current DB show, always has been for bags.

This is the clean case the brief hoped for ("if the data is intact and only the code path changed, clean regression fix") — but *inverted*: the code path is intact and the **data** is what's missing.

## 5. Scope — far wider than bags, and not a regression

Every non-clothing Direct product is `flat`/`coverage` with **0** print rows, so **none** of them show print config:

| Category | Products (all 0 print rows) |
|---|---|
| Bags | 5oz-cotton-bag, 5oz-mini-cotton-bag, 5oz-recycled-cotton-bag, 8oz-canvas, 12oz-recycled-canvas |
| Cables | mr-bio, mr-bio-pd-long, ocean-octopus, octopus-mini |
| Drinkware | water-bottle (flat), chi-cup (coverage) |
| Power | ice-p, luggie, gamma-lite |
| Writing | edge-classic, edge-silver, edge-white |
| Notebooks | a5-notebook, a6-pocket-notebook |
| Homeware | tea-towel |

**20 products.** All identical: flat/coverage model, 0 print rows, no print UI, flat colour-independent price. This is uniform — which is itself evidence they were *never seeded* (a targeted removal of bags would have left cables/pens with rows; they're all empty).

The only Direct products with print config are the **5 clothing** ones. So this is not "bags regressed" — it is "**print pricing was only ever seeded for clothing**", catalogue-wide. If the launch expectation is that bags/pens/drinkware take print and show priced options, that is a **launch-scope data gap across the whole non-clothing Direct catalogue**, not a bag bug and not a #88 side-effect.

(Laltex non-clothing products *do* show print config, because they carry `print_details` in `supplier_products` and render via `LaltexProductView` — a different path. That may be the source of the "bags used to show print options" impression: Laltex bags do; the 25 Direct products never had the data.)

## 6. Recommendation

**Do not revert #88.** It is not the cause (§3), and reverting would re-break the clothing pricing fix. There is no code regression to fix here — the flat/coverage render path is intact.

**The real task is a data + product decision.** To make Direct bags show print options and priced decoration, decide the model and seed it:

- **Option A — flat second-position (matches the current bag model).** Seed `catalog_print_pricing` rows for each bag with an `extra_position_price`. The existing UI ([`ProductDetailPage.jsx:1800`](src/components/ProductDetailPage.jsx#L1800)) then renders the "Add second position" checkbox and the price responds. **No code change** — pure data. Smallest, lowest-risk. But it only offers a second-position toggle, not per-colour-count pricing.
- **Option B — per-colour-count pricing like clothing.** If bags need "1 col / 2 col / …" pricing that responds to how they're decorated (which is what the brief describes wanting), the flat model does not support it. This needs either moving bags onto a clothing-style model or extending the flat model — a **code + data** change, larger, and a genuine product decision.

**Which, and Dave's open question:** because *no* bag print/colour pricing exists anywhere, Dave isn't adjusting figures — he's supplying them. He needs to provide, per bag: the print cost model (flat add-on vs per-colour-count), the numbers, and whether natural vs coloured bags differ (today they don't — bags have one flat price for all colours). Once he provides them, seeding is trivial for Option A; Option B needs a small build first.

**Size / risk:** Option A is a data seed, minutes of work once the numbers exist, zero code risk. Option B is a targeted feature (extend the flat model or reclassify bags), moderate. Neither is a "rebuild". The brief's instinct that this is small is right for Option A; Option B is small-to-moderate. Either way it is **additive**, and unrelated to #85/#87/#88.

**One thing to confirm with Dave:** the brief states bags "previously showed print options and print pricing." I can find no evidence of that in the current DB, the repo's seed history, or git — and the hiding condition predates #88 by five months. If Dave is certain bags showed priced print options recently, the next step is to locate that data (a DB backup / export from when it worked), because it is not in the live database now. If instead the memory is of the Laltex print UI or the clothing configurator, then this is purely the launch-scope data gap in §5.

---

## Appendix — evidence

| Fact | Source |
|---|---|
| Bag is `pricing_model='flat'`, `max_print_positions=2`, 0 print rows | live query, `catalog_products` + `catalog_print_pricing` |
| Bag flat price £2.99…£1.49 (colour-independent) | `catalog_pricing_tiers` for `5oz-cotton-bag` |
| Clothing print UI gated on `pricing_model==='clothing'` (line 1774); flat on `printPricingData.length>0` (line 1797) | `ProductDetailPage.jsx` |
| #88 diff touches none of flat/coverage/gate/data-load | `git diff main..HEAD` + grep |
| Render gate added 2026-02-27 (`0c2a2e4`), 5 months before #88 | `git log -S`, `git show -s` |
| `catalog_print_pricing` = 360 rows = 5 clothing × 72; 0 for all 20 non-clothing | live query |
| No repo seed ever inserts bag print rows (only #88's clothing migration) | repo grep `INSERT INTO catalog_print_pricing` |
| Schema `010_add_print_pricing.sql` is DDL-only (0 INSERTs) | file |

**No source file was modified and no pricing logic was changed by this audit.** Browser reproduction was not run (the Playwright MCP server disconnected mid-session); the render path was traced directly in source, which is conclusive for this question.
