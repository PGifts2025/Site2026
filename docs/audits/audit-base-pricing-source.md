# Audit — Base-White Pricing Source (the `(colours + 1)` method is unreliable)

**Date:** 2026-07-29
**Scope:** Read-only. No source changed, no pricing logic touched, PR #85 not reverted, no PR.
**Question:** Is `(colours + 1)` a sound way to price the white underbase, or does Laltex's non-monotonic colour-step break it — and is Dave's spreadsheet a better source?

---

## TL;DR

**`(colours + 1)` is broken, and the root cause is confirmed at the tier level.** Laltex's own screen-print colour ladder is non-monotonic: the 1→2-colour step on TF0001 goes **£0.08 (25) → £0.20 (50) → £0.13 (100) → £0.06 (250) → −£0.02 (500) → £0.05 (1000)**. It rises, falls, and at the 500 band **goes negative**, which is why PR #85's floor pins the base to **£0.00** there. A base that costs money cannot be £0. The derivation method, not the floor, is what failed.

**This is not a TF0001 quirk.** Every Laltex clothing product shares one identical `FSCREEN1` print-price matrix — TF0001 (t-shirt), HF0001 (hoodie) and PF0006 (polo) return byte-identical colour-steps. So the erratic uplift affects **all 89 Laltex garments, at every position**.

**Dave's spreadsheet gives a clean alternative.** The GD005 coloured-minus-white print delta at 1 colour is **36p / 20p / 20p / 13p / 14p / 14p** across the six breaks — monotonic (bar a 1p tail rounding), always positive, and **identical across t-shirts, hoodies, sweats and polos** (the print columns are the same on every sheet; only the garment column changes). The base is a print-side cost, and print costs transfer across garment brands far better than garment costs do.

**Recommendation: ship Option B (a flat spreadsheet-derived base-print lookup) now, and ask Laltex for their real base-print costs (Option C) in parallel** to confirm or replace the numbers. On reverting #85: **leave it live** — its floor guarantees a dark garment is never cheaper than white, so it only ever under-recovers, exactly like no-base but less so. Reverting buys nothing; replacing it with B is the fix.

**Two bugs found while confirming §6:**
1. **`AF0010` "Tom Franks Hi Vis Vest" is categorised `Clothing`, so the current code applies a white base to it** (its only colour, Yellow, resolves to base-required). Dave has confirmed hi-vis takes no base. This is live and wrong.
2. Hoodies, sweats and polos are all `Clothing` and carry the same non-monotonic matrix, so the erratic uplift applies to them too.

---

## 1. The non-monotonic behaviour, reproduced from the live path

Measured in the browser against the running app (TF0001, Front, Spot Print), unit price ex-VAT. The four figures from the brief reproduce exactly:

**1 colour**

| Qty | White | Black (based) | Uplift |
|---|---|---|---|
| 25 | £7.51 | £7.59 | **£0.08** |
| 50 | £5.67 | £5.87 | **£0.20** |
| 100 | £4.76 | £4.89 | **£0.13** |
| 250 | £4.11 | £4.17 | **£0.06** |
| 500 | £3.80 | £3.80 | **£0.00** ← floor engaged |
| 1000 | £3.57 | £3.61 | **£0.04** |

The uplift rises (0.08→0.20), falls (0.20→0.06), collapses to zero, then rises again. No cost curve behaves like this.

**Full matrix — White / Black / uplift, all six breaks × 1-4 colours** (4 colours is the ceiling; the based lookup there is extrapolated — see §2):

| Qty | 1c W | 1c B | Δ | 2c W | 2c B | Δ | 3c W | 3c B | Δ | 4c W | 4c B | Δ (extrap) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 25 | 7.51 | 7.59 | 0.08 | 7.59 | 7.86 | 0.27 | 7.86 | 8.13 | 0.27 | 8.13 | 8.40 | 0.27 |
| 50 | 5.67 | 5.87 | 0.20 | 5.87 | 6.34 | 0.47 | 6.34 | 6.48 | 0.14 | 6.48 | 6.61 | 0.13 |
| 100 | 4.76 | 4.89 | 0.13 | 4.89 | 5.02 | 0.13 | 5.02 | 5.15 | 0.13 | 5.15 | 5.28 | 0.13 |
| 250 | 4.11 | 4.17 | 0.06 | 4.17 | 4.23 | 0.06 | 4.23 | 4.29 | 0.06 | 4.29 | 4.36 | 0.07 |
| 500 | 3.80 | **3.80** | **0.00** | 3.78 | 3.83 | 0.05 | 3.83 | 3.89 | 0.06 | 3.89 | 3.95 | 0.06 |
| 1000 | 3.57 | 3.61 | 0.04 | 3.61 | 3.66 | 0.05 | 3.66 | 3.69 | 0.03 | 3.69 | 3.71 | 0.02 |

Notes readable directly from the table:
- **Black `Nc` = White `(N+1)c`** everywhere (7.59 = 7.59, 5.87 = 5.87, …) — the `(colours + 1)` mechanic, working as designed.
- **Floor engages at 500 / 1 colour** (Black = White = £3.80). It is the *only* £0.00 uplift; it happens because White 2-colour (£3.78) is *below* White 1-colour (£3.80).
- **The 50-unit, 2-colour uplift is £0.47** — six times the £0.08 at 25/1c. A base cost should never jump like that.
- **4 colours is the ceiling**: the "5-colour" lookup doesn't exist, so it is extrapolated; Black 4c (£8.40) stays above White 4c (£8.13), so it does not clamp — but it is a projection, not a real Laltex price.

---

## 2. Root cause, at the tier level

Raw Laltex `FSCREEN1` print tiers for TF0001 Front, keyed `(num_colours, min_qty)`, customer-facing `sell_price`. The **colour-step** is `sell(N+1) − sell(N)` at each band — this delta *is* the base uplift the code applies.

| Qty band | 1→2 | 2→3 | 3→4 |
|---|---|---|---|
| 25 | £0.0810 | £0.2700 | £0.2700 |
| 50 | **£0.2025** | £0.4725 | £0.1350 |
| 100 | £0.1300 | £0.1300 | £0.1300 |
| 250 | £0.0625 | £0.0625 | £0.0625 |
| 500 | **−£0.0245** | £0.0490 | £0.0613 |
| 1000 | £0.0480 | £0.0480 | £0.0240 |

**The ladder is non-monotonic and, at 500 for 1→2, negative.** Read the 1→2 column top to bottom: 0.08 → **0.20** → 0.13 → 0.06 → **−0.02** → 0.05. A well-formed volume curve falls smoothly; this does not. The −£0.0245 at 500 is the direct cause of the £0.00 floored base in §1: Laltex prices a 2-colour print *below* a 1-colour print at that break.

**This is systemic, not per-product.** Identical `1→2` colour-steps were pulled from:
- **TF0001** (t-shirt): 0.0810 / 0.2025 / 0.1300 / 0.0625 / −0.0245 / 0.0480
- **HF0001** (hoodie): 0.0810 / 0.2025 / 0.1300 / 0.0625 / −0.0245 / 0.0480
- **PF0006** (polo, Left Breast): 0.0810 / 0.2025 / 0.1300 / 0.0625 / −0.0245 / 0.0480

All 89 Laltex garments draw on the same `FSCREEN1` matrix, so the base uplift is equally erratic on every one of them, at every print position.

**Conclusion:** the assumption behind PR #85 — that Laltex's colour-step is a fair proxy for the base cost — does not hold. The colour-step is not a clean cost signal; it is a pricing table with inversions. `(colours + 1)` faithfully reproduces those inversions.

---

## 3. The spreadsheet as an alternative source

From `Screen Print Gildan Heavy T-shirts November 2025.xlsx` (10 sheets: White/Coloured pairs for t-shirts, hoodies, sweats, polos, plus two hi-vis sheets). The `Print` column is a **cost** (the sheet layout is Garment | Print | subtotal | Profit | Total, so Total is the sell price and Print is cost).

**GD005 t-shirt, coloured-print minus white-print, by design colours:**

| Qty | 1 col | 2 col | 3 col | 4 col |
|---|---|---|---|---|
| 25 | **£0.36** | £0.14 | £0.16 | £0.06 |
| 50 | **£0.20** | £0.13 | £0.13 | £0.07 |
| 100 | **£0.20** | £0.13 | £0.13 | £0.07 |
| 250 | **£0.13** | £0.12 | £0.08 | £0.07 |
| 500 | **£0.14** | £0.13 | £0.15 | £0.06 |
| 1000 | **£0.14** | £0.13 | £0.07 | £0.06 |

The **1-colour** delta — the cleanest read of "one white flood on an otherwise-blank dark garment" — is **£0.36 / 0.20 / 0.20 / 0.13 / 0.14 / 0.14**, matching the brief's expected shape. It is **monotonic non-increasing** (the 0.13→0.14 tail is 1p of rounding) and **always positive**. Contrast the API's 1→2 sell-uplift from §1: 0.08 / 0.20 / 0.13 / 0.06 / 0.00 / 0.04 — the spreadsheet is both larger and stable where the API collapses.

**It generalises cleanly across garments.** The `Print` columns are *identical* on every clothing sheet — coloured 1-col print is £3.28/1.95/1.21/0.81/0.62/0.58 on the t-shirt, hoodie, sweat AND polo sheets; only the `Garment` column differs (£2.96 tee vs £8.79 hoodie vs £7.17 sweat vs £6.39 polo). So one base-print lookup covers all four garment families. This is expected: printing is a print-shop operation, independent of which blank goes under the head.

**The caveat, stated plainly.** This is Dave's *Gildan* cost model. Laltex products are largely *not* Gildan (TF0001 is Fruit of the Loom). We do **not** know what Laltex actually invoice for a base on their stock. **But** the mismatch bites far less than it first appears: the base is a *print* cost, and the spreadsheet shows print cost is already garment-independent in Dave's own model. A white flood on a FOTL tee and on a Gildan tee is the same screen, same ink, same pass. So transplanting Dave's *base-print* figure across brands is much safer than transplanting a *garment* cost would be. It remains an estimate, not Laltex's number — which is why Option C (below) should run in parallel.

The higher-colour deltas (2-4 col columns above) are smaller and noisier than the 1-col delta, because the sheet folds most of the base into the first colour. For a lookup, the **1-colour delta is the right figure to adopt as the flat per-position base** — using it regardless of design colour count is slightly generous at higher counts and physically honest (one flood is one flood).

---

## 4. Options

### Option A — Keep `(colours + 1)`, fix the floor

Clamp the colour-step to be monotonic (e.g. carry the last positive step forward) before applying, so the 500-band inversion can't zero the base.

- **Where:** `resolvePrintTierWithBase` in `LaltexProductView.jsx`; a monotonic-clamp pass over the position's tiers.
- **Schema:** none.
- **Ceiling:** still needs the existing extrapolation for 4→5.
- **All garments:** applies uniformly (shared matrix), so one fix covers everything.
- **Trade-off:** cheapest, but it is polishing a data source Dave's own live figures show is erratic. Even monotonic, the numbers (£0.08 at 25, £0.20 at 50) are the API's arbitrary steps, not a base cost. It would produce **defensible-looking but still-wrong** numbers, and it entrenches the dependency on a signal we've shown is unreliable. Not recommended.

### Option B — Flat base-print lookup from the spreadsheet

A small table of base-white **print cost** pence by quantity break, added to dark garments (then run through the normal margin schedule, exactly as `sell_price` already is).

- **Where:** a new constant (e.g. in `screenPrintBase.js`) plus a branch in the print-cost path that, when a base is required, adds `baseLookup(qty)` to the position's cost instead of shifting to `(colours + 1)`. Margin applies on top via the existing schedule (§57).
- **Schema:** none — a code constant, or a tiny admin-editable table if Dave wants to tune it without a deploy.
- **Ceiling:** **disappears as a problem.** The base is an additive per-position amount, not a tier shift, so there is no "5th colour" to fall off the end of. A 4-colour dark design = 4-colour tier + base. Clean.
- **All garments:** one table covers t-shirts, hoodies, sweats, polos (print columns identical, §3). Applied per position, same as today.
- **Trade-off:** monotonic, predictable, matches Dave's own costing, and removes the erratic-API dependency entirely. The one weakness is that it is one garment brand's figures applied across all Laltex clothing — mitigated by the base being a print-side cost (§3), but still an estimate until Laltex confirm.

### Option C — Ask Laltex for their base-print cost per break per product

The only authoritative source.

- **Where:** no code until the data arrives; then it slots into the same additive slot as Option B (or a per-product column).
- **Schema:** likely a `base_print_cost` structure on `supplier_products` if it turns out to vary by product.
- **Ceiling / all garments:** whatever Laltex specify.
- **Trade-off:** removes all guessing, but slow — and Laltex have just told Dave the *API* base-charge fix is months away and that they won't levy a base **setup**, so a prompt, itemised base-print price list from them is not guaranteed soon. Good as the eventual truth; poor as the thing to wait on before charging correctly.

---

## 5. Recommendation

**Ship Option B now; run Option C in parallel.**

B replaces an erratic, sometimes-zero derivation with a monotonic, always-positive base that mirrors Dave's own cost model and sidesteps both the inversion and the colour-ceiling. It is a small, self-contained change with no schema requirement. C is the eventual authority, but it should not block correct charging for the months Laltex may take; when their numbers arrive, swap the lookup values (or move to a per-product column) — the shape of the code doesn't change.

### Proposed lookup table (base-white **print cost**, per position, per unit)

From the GD005 1-colour coloured-minus-white delta (§3), which is garment-independent:

| Qty band (min_qty) | Base print cost / unit |
|---|---|
| 25 | £0.36 |
| 50 | £0.20 |
| 100 | £0.20 |
| 250 | £0.13 |
| 500 | £0.14 |
| 1000+ | £0.14 |

- Pick the band the same way tiers are picked (highest `min_qty ≤ order qty`).
- Add per **enabled screen-print position** (front + back on navy = two bases), matching today's per-position rule.
- It is a **cost**; the existing margin schedule (§57) turns it into the customer figure — so at 25 units the customer-facing uplift becomes ~£0.36 × 1.35 ≈ **£0.49**, versus the £0.08 the API gives today. At 500 it becomes ~£0.14 × 1.225 ≈ **£0.17**, versus today's £0.00.
- **Generalisation:** the same table serves hoodies, sweats and polos (identical print columns). Hi-vis is excluded entirely (§6).

### Should PR #85 be reverted meanwhile? — my view: **leave it live.**

PR #85's no-negative floor guarantees a dark garment is **never** priced below the same white one. Its only failure mode is *under*-recovery (the £0.00 at 500, and generally charging a bit less than B would). No-base has the *same* failure mode, only worse — it under-recovers at **every** band. So at every quantity, #85 recovers ≥ what reverting would, and it never over-charges. Reverting therefore loses money for no correctness gain, and because the base is never shown as a line item, there is no "customer sees an arbitrary number" transparency argument either.

The honest framing: #85 is *roughly right and occasionally £0*; no-base is *£0 everywhere*. Neither is *correct* — only B/C are — but #85 is strictly the better holding position. Keep it live, ship B promptly to replace the derivation, and drop C's numbers in when Laltex provide them.

(If B genuinely cannot ship for a while and Dave would rather charge nothing than an approximate amount on principle, reverting is defensible — but it costs recovery and fixes nothing. I would not.)

---

## 6. Hi-vis and the other garments

### Hi-vis — Dave's "no base" rule is **not** currently honoured. Bug.

- **Confirmed in the data:** the spreadsheet's two hi-vis sheets ("Yellow or Orange" vs "other colours") differ only in the **garment** column; their **print** column is the standard coloured print (£3.28/1.95/… at 1 col), with **no white-base delta** between them. So hi-vis print is flat regardless of shade — consistent with "hi-vis takes no base."
- **But the code applies one.** `productNeedsWhiteBase(category, colour)` gates solely on `category === 'Clothing'`. The PGifts-Direct mirror `hi-vis-vest` is safely `category = 'Safety Wear'` (exempt), **but the Laltex product `AF0010` "Tom Franks Hi Vis Vest" is `category = 'Clothing'`** with a full `FSCREEN1` 1-4 colour matrix. Its only colour is **Yellow**, which is not White/Natural, so:

  > `productNeedsWhiteBase('Clothing', 'Yellow') === true` — verified live.

  A customer configuring a screen print on AF0010 today is charged a white base they should not be. It is wrong on two counts: hi-vis takes no base at all, and fluoro yellow is the last colour that would need a white underbase.
- **Flag / fix direction (not for this audit):** hi-vis needs to be excluded from the base rule — either by not treating `AF0010`'s category as base-eligible, by an explicit hi-vis/sub-category exclusion, or by correcting the product's category. There may be other hi-vis or non-print garments miscategorised as `Clothing`; the gate being a single category string is the underlying fragility.

### Hoodies, sweats, polos — `(colours + 1)` applies, and the same problem appears.

- All are `category = 'Clothing'`, so any non-White/Natural colour triggers the base today.
- They draw on the **identical** `FSCREEN1` matrix (HF0001 and PF0006 verified byte-identical to TF0001 in §2), so the non-monotonic uplift — including the £0.00 at 500 — is present on every one of them.
- Option B fixes all of them at once (single garment-independent lookup, §3/§5).

---

## Appendix — evidence

| Finding | Source |
|---|---|
| TF0001 displayed White/Black/uplift, all 6 qty × 1-4 col | live browser capture, dev server, Front + Spot Print |
| Four brief figures reproduce (7.51/4.76/4.11/3.80 vs 7.59/4.89/4.17/3.80) | same |
| Raw `FSCREEN1` colour-steps; 1→2 negative at 500 | `scripts/diagnostic/probe-base-tiers.mjs TF0001` |
| Identical matrix on TF0001 / HF0001 / PF0006 | same probe on each code |
| Spreadsheet coloured−white print deltas; print columns identical across garments | `Screen Print Gildan Heavy T-shirts November 2025.xlsx`, sheets 1-8 |
| `AF0010` is `category='Clothing'`, colour Yellow, base applied = true | live query + `productNeedsWhiteBase` from `src/utils/screenPrintBase.js` |
| `hi-vis-vest` mirror is `category='Safety Wear'` (exempt) | live query |
| Floor + ceiling behaviour of current code | replicated exactly in `probe-base-tiers.mjs` (mirrors `resolvePrintTierWithBase`) |

Probe script `scripts/diagnostic/probe-base-tiers.mjs` left committed for re-runs (the xlsx reader was a throwaway and removed; the sheet is gitignored per CLAUDE.md §26.9).

**No source file was modified, no pricing logic changed, and PR #85 was not reverted by this audit.**
