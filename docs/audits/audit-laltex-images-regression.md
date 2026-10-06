# Audit — Laltex Product Images "Regression"

**Date:** 2026-07-24
**Scope:** Read-only. No source changed, no sync run, no `supplier_products` mutation, no PR.
**Premise under test (Dave):** Laltex clothing images worked before and no longer do — treat as a possible regression on our side, not a supplier gap.

---

## TL;DR

I took Dave's account as evidence and tested every on-our-side failure mode. The evidence does **not** support a regression in our code:

- **The hero product image works.** Loaded live in the browser on `/products/TF0101`: `naturalWidth 2000`, HTTP 200. What is blank is the **colour swatches**, and only because TF0101 has no per-colour imagery.
- **The parser is faithful.** TF0101's stored `raw_payload` is byte-identical to the live API: 2 generic top-level images, **zero** per-variant `ItemImages`. Nothing is lost at parse time.
- **The code path is unchanged.** The colour→image mapping in `normaliseProduct` and the swatch grey-fallback in `LaltexProductView` have not been modified since they were introduced in session-6 (#11). No migration dropped or renamed an image column.
- **The URLs resolve.** Every stored Laltex image URL returns HTTP 200 (including the space-in-filename one, which the browser encodes). Not a CDN move, not a dead hotlink.
- **The per-colour images do not exist at source.** Reconstructing TF0101's per-colour URLs the way TF004K names them (`TF0101AZBL.jpg`, `TF0101BLAC.jpg`, …) returns **404** for every colour, while the TF004K control returns 200. There is nothing to re-fetch.

**So this is not a parser/sync/renderer/storage/URL regression on our side.** It is one of two supplier-side possibilities that the available evidence cannot separate (no pre-regression snapshot of `supplier_products` exists, and Laltex doesn't version): either **TF0101 always lacked per-colour photography** (and "worked before" is the still-working hero, or a memory of a TF004K-class product), or **Laltex removed TF0101's per-colour images** (feed references and CDN files) and our faithful nightly sync overwrote our then-good data. Either way it is unrecoverable by re-sync. The actionable fix is on our side but different from what was assumed: a **swatch fallback** (hero image or a labelled colour chip) plus the **colour de-dup** ("120 colours" → 22), which make TF0101 and the other 52 image-less products look right regardless of Laltex.

---

## 1. What the API sends right now (verbatim)

`GET https://auto.laltex.com/trade/api/v1/products/{code}` (`API_KEY` header, `Accept: application/json`).

**TF0101** — image fields:
```
top-level Images (2): [
  "https://laltex-extranet.co.uk/images/TF0101 .jpg",   <-- note the SPACE before .jpg
  "https://laltex-extranet.co.uk/images/TF0101.jpg"
]
top-level PlainImages (0): []
Items: 120 variants  |  with ItemImages: 0  |  with PlainImages: 0
```
Both top-level entries are the same generic product shot (one with a stray space in the filename). There is **no per-colour image** at product or variant level.

**TF004K** — image fields:
```
top-level Images (19): [
  "https://laltex-extranet.co.uk/images/TF004K.jpg",       <-- generic
  "https://laltex-extranet.co.uk/images/TF004KBLAC.jpg",   <-- Black
  "https://laltex-extranet.co.uk/images/TF004KCHAR.jpg",   <-- Charcoal
  ... 16 more, one per colour (named {code}{COLOUR}.jpg)
]
Items: 115 variants  |  with ItemImages: 90  |  with PlainImages: 0
sample variant WITH image: Black / Age 3-4 => ["https://laltex-extranet.co.uk/images/TF004KBLAC.jpg"]
```

**The API genuinely differs between the two products.** TF004K carries 19 top-level per-colour images and populates `ItemImages` on 90 of 115 variants. TF0101 carries only the generic shot and zero variant images. This confirms (against the live API, not just the DB) the prior audit's observation — but it does not by itself prove whether TF0101 *ever* had them.

---

## 2. Sent vs stored — the decisive parse-time check

`supplier_products.raw_payload` retains the untouched API response. For TF0101:

| | top-level Images | per-variant ItemImages |
|---|---|---|
| **Live API** | 2 (generic, incl. space URL) | 0 / 120 |
| **Stored `raw_payload`** | 2 (same URLs) | 0 / 120 |
| **Stored `images` column** | `["…/TF0101 .jpg","…/TF0101.jpg"]` | — |
| **Stored `plain_images` column** | `[]` | — |

Row timestamps: `created_at 2026-04-24`, `last_synced_at / updated_at 2026-07-23 03:49` (last night's cron).

**`raw_payload` equals the live API, and the parsed `images` column equals `raw_payload.Images`.** Images present in the payload are present in the stored fields; images absent from the payload are absent because the API doesn't send them, not because the parser drops them. **The parser is not the culprit.** (Caveat: `raw_payload` is overwritten on every nightly sync, so it reflects the 2026-07-23 state, not TF0101's original April state — see §4.)

---

## 3. Git history on the image path

Every commit touching image handling, newest first:

| Concern | Last touched | Verdict |
|---|---|---|
| Parser `parseItems` image mapping (`scripts/lib/laltex-parser.js`) | session-3a (#3), stable since | maps `ItemImages`/`PlainImages` verbatim; never dropped |
| `normaliseProduct` colour→image mapping (`productCatalogService.js:1440-1450`) | **session-6 (#11)** — introduced then, **unchanged since** (`git log -S "item_images"` → only #11) | no regression |
| Swatch renderer + grey fallback (`LaltexProductView.jsx:674-688`) | **session-6 (#11)** — the `images[0] → hex → bg-gray-200` fallback has existed from day one (`git log -S "bg-gray-200"` → only #11) | the grey box is original behaviour, not a new regression |
| Image proxy (`api/proxy-image.js`) | session-8 (#14) | for Designer export only; product page does not use it |
| Image-column migration (drop/rename) | none found (`grep DROP/RENAME COLUMN` over migrations with image columns → nothing) | schema intact |

Recent commits to `LaltexProductView.jsx` (#79 VAT PR B, #76 VAT, #68 phone-swap, #57 call-us notice, #55 pre-launch polish) touched pricing/labels/footer, **not** the swatch or hero image logic. The sizes/colours work Dave referenced was an **audit only — never implemented**, so nothing landed in the normaliser.

**Last commit at which image handling looked correct: it still is correct.** No commit broke it.

---

## 4. Sync history

- **Last full sync:** the nightly `sync-laltex` cron; TF0101's `last_synced_at` is `2026-07-23 03:49 UTC`.
- **Overwrite vs merge:** the sync does a PostgREST bulk UPSERT with `Prefer: resolution=merge-duplicates` (CLAUDE.md §27.4), which **refreshes all data columns** — including `images` and `items`. So each night it overwrites image data with whatever the API returns. **If Laltex ever served images for TF0101 and later stopped, the very next sync would have blanked our copy.** This is the one mechanism by which a supplier-side removal becomes a silent local loss — but it is driven by the API, not a bug in our sync.
- **Pre-regression snapshot:** none available. `raw_payload` is overwritten nightly (no history). The `comparison-20260521-121033.csv` (found in `~/Downloads`, dated 2026-05-21) is a **competitor-pricing** file (`pgifts_code, pgifts_name, tm_code, tm_name…`, 201 rows) — it contains **no TF0101 row and no image data**, so it cannot show TF0101's earlier image state. There is no Supabase PITR export, diagnostic dump, or CSV that captures `supplier_products` image fields before 2026-07-23.

**Consequence:** I cannot observe TF0101's image state prior to last night's sync. The question "did it change" is therefore not directly answerable from stored data.

---

## 5. Where images are stored

- **Hotlinked, not downloaded.** `supplier_products.images` holds Laltex CDN URLs (`laltex-extranet.co.uk/images/…`); nothing is copied into Supabase Storage. So there is no bucket to have been emptied or renamed — that failure mode does not apply.
- **The URLs resolve.** Fetched directly (encodeURI'd):

  | URL | HTTP |
  |---|---|
  | `…/TF0101 .jpg` (space) | **200** image/jpeg |
  | `…/TF0101.jpg` | **200** image/jpeg |
  | `…/TF004KBLAC.jpg` | **200** image/jpeg |
  | `…/TF004K.jpg` | **200** image/jpeg |

- **The product page renders the hero fine.** Loaded `/products/TF0101` in a real browser: exactly **one** `<img>`, `src=…/TF0101%20.jpg` (the browser encoded the space), `complete && naturalWidth === 2000`. The hero image is **not** broken. The swatches are `<span>` elements (grey), because every colour object has `images: []` and `hex: null`.
- **The per-colour files do not exist at source.** Reconstructing TF0101 URLs in TF004K's naming scheme returned **404 for every colour** (`TF0101AZBL.jpg`, `TF0101BLAC.jpg`, `TF0101BOTT.jpg`, `TF0101BURG.jpg`, `TF0101DHGY.jpg`, `TF0101DNAV.jpg`), with `TF004KBLAC.jpg` → 200 as a control and `TF0101ZZZZ.jpg` → 404 as a negative control. So there is no unreferenced-but-present imagery to recover — Laltex's CDN simply has no per-colour photos for TF0101.

The "hotlinked URLs no longer resolve / CDN path changed" scenario is **ruled out** — every referenced URL works, and the hero renders.

---

## 6. Scope

Counts across all stored Laltex rows (`supplier_products`, supplier = laltex, n = 1194):

| Metric | Count |
|---|---|
| Total Laltex products | 1194 |
| With ≥1 top-level (hero) image | **1194 (100%)** |
| With ≥1 per-variant `item_images` | **1141 (95.6%)** |
| Without any per-variant image | **53 (4.4%)** |
| Clothing products | 85 |
| Clothing with per-variant images | 72 |
| Clothing without per-variant images (incl. TF0101) | **13** |

**TF0101 is one of a 53-product minority** (13 of 85 clothing) with no per-colour imagery, against 1141 that have it. If a parser/sync/render bug had blanked images, it would hit the whole population, not 4.4% of it. The distribution looks like **per-product Laltex photography completeness**, not a systemic failure.

- **Non-clothing:** unaffected as a class — non-clothing products are single-variant and universally have hero images; the swatch grid is a clothing/multi-colour concern.
- **PGifts Direct:** a separate pipeline (`catalog_product_images` + hex swatches via `normaliseProduct`'s `row.colors` branch, `productCatalogService.js:1366`). Nothing in the Laltex image path touches it; its swatches render from `hex_value`, not Laltex URLs. Not implicated. (Architectural separation; not re-screenshotted this session.)

---

## 7. Conclusion

Testing each candidate against the evidence:

| Candidate cause | Verdict |
|---|---|
| Parser stopped mapping the field | **Ruled out** — `raw_payload` == live API == stored `images`; `parseItems` maps `ItemImages` verbatim, unchanged since #3. |
| Sync overwrote good data with nulls **(our bug)** | **Ruled out as a bug** — the sync overwrites by design, but only with what the API returns; it is faithful. (It *is* the propagation mechanism if Laltex removed the data — see below.) |
| API response shape changed → silent match failure | **Ruled out** — field names/shape unchanged; TF004K parses images correctly through the same code. |
| Storage files removed/moved | **Not applicable** — images are hotlinked, not stored in Supabase. |
| Hotlinked URLs no longer resolve | **Ruled out** — all referenced URLs return 200; hero renders at 2000px. |
| Renderer reads a field that no longer exists | **Ruled out** — swatch renderer unchanged since #11; it reads `c.images[0]`/`c.hex`, both of which the normaliser still populates. |
| Genuine supplier gap / recollection of a different set | **Consistent with all evidence.** |
| Laltex removed TF0101's per-colour images (feed + CDN files) | **Consistent, but unprovable from our data**, and the CDN 404s mean the files are gone at source. |

**The evidence rules out every on-our-side regression.** It does not, however, let me choose cleanly between the two supplier-side explanations, because no pre-2026-07-23 snapshot of `supplier_products` image fields exists. Ranked:

1. **Most likely — genuine Laltex data incompleteness for TF0101 (and 52 others).** Our code is provably unchanged and faithful; 4.4% of the catalogue has always-or-currently no per-colour photos; the hero (which *does* work) is a plausible referent for "images worked." I lean here.
2. **Possible — Laltex-side removal.** Laltex previously served TF0101's per-colour images and deleted both the feed references and the CDN files; our nightly sync then overwrote our good `item_images` with empty arrays. This matches Dave's recollection literally. I cannot confirm or refute it, and the CDN 404s make it irreversible from our side.

**No specific commit is implicated** — the image path is unchanged.

### Recovery

- **Per-colour swatch images for TF0101 cannot be restored by us.** Re-sync would re-pull the same empty arrays; URL reconstruction 404s; there is nothing in Storage (hotlinked). If scenario 2 is true, only **Laltex** can restore the source files — worth raising with them, citing the 53 image-less products (TF0101 among them) and asking whether per-colour photography exists.
- **Do NOT run a sync to "fix" it** — it would overwrite `raw_payload`, destroying the one artifact that currently proves the parser is faithful, and change nothing (the API has no images to bring back).
- **The genuinely actionable fix is on our side and independent of Laltex:** in `normaliseProduct` / `LaltexProductView`, (a) **de-duplicate colours** so the swatch grid shows 22 real colours instead of 120 variant rows (the "Available Colours (120)" bug), and (b) **replace the blank grey swatch fallback** with the product's hero image or a labelled colour chip (name/initial) when a colour has neither image nor hex. That makes TF0101 and all 53 image-less products present cleanly without depending on Laltex, and folds naturally into the sizes/colours work already scoped in `audit-clothing-sizes-and-colours.md`.

**Correction to the prior audit:** its data (TF0101 has no variant imagery) was accurate, but its framing ("supplier data gap, full stop") was incomplete. It never tested whether the images exist unreferenced at the CDN (they don't — a stronger finding), never confirmed the hero still works (it does), and never distinguished "always absent" from "removed." Dave was right to push: the correct statement is "our pipeline is faithful and unbroken; the missing per-colour images are a supplier-side absence we can't recover, but we can and should stop rendering it as blank grey."

---

## Appendix — evidence

| Fact | Source |
|---|---|
| Live API TF0101: 2 top images (incl. space URL), 0/120 variant images | live `GET /v1/products/TF0101` |
| Live API TF004K: 19 top images (per-colour), 90/115 variant images | live `GET /v1/products/TF004K` |
| Stored `raw_payload` == live API for TF0101 | `supplier_products` service-role read |
| Row synced 2026-07-23 03:49; created 2026-04-24 | `supplier_products.last_synced_at/created_at` |
| All 4 image URLs resolve 200 (incl. space URL) | `curl` with encodeURI |
| Hero renders in-browser (naturalWidth 2000); swatches are grey spans | Playwright on `/products/TF0101` |
| Reconstructed per-colour URLs 404; TF004K control 200 | `fetch` TF0101{COLOUR}.jpg |
| 1194 Laltex products: 1194 hero, 1141 variant-image, 53 without | `supplier_products` full scan |
| Normaliser colour-image map + swatch grey fallback unchanged since #11 | `git log -S` on `item_images` / `bg-gray-200` |
| No migration drops/renames image columns | migration grep |
| comparison CSV is competitor pricing, no TF0101/images | `~/Downloads/comparison-20260521-121033.csv` |
