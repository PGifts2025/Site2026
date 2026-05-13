# Diagnostic Probes

One-shot read-only SQL probes against the live Supabase DB. Used to
investigate data shape questions that come up during integration work.
Safe to re-run anytime; they only `SELECT`.

Auth pattern: `SUPABASE_ACCESS_TOKEN` (PAT) from `site/.env`, posted to
the Supabase Management API at `/v1/projects/.../database/query`. See
`CLAUDE.md §27.2` for why this is the right tool for ad-hoc admin
queries (vs PostgREST + service-role for bulk DML).

Run from the `site/` directory:

```bash
node scripts/diagnostic/<script>.mjs
```

## Index

### `probe-mg0192-coords.mjs`

Dumps every `(position, colour, image_url, x, y, w, h)` row of MG0192's
`supplier_products.print_details[].print_area_coordinates[]`.

Diagnosed session 7's Bug A (Back position has only 11 of 13 colours —
Amber and Black missing — and DesignerV2's `allCoords[0]` fallback was
silently rendering Blue when Amber was selected) and Bug B (all 39
rows carry the **same** `(x, y, w, h) = (267.5, 703.5, 688x183)`, so
Front/Back positions inherit the Wrap rectangle even though their
source images frame the cup differently — the rectangle visibly
floats off the cup body on those tabs).

### `probe-af0001-and-corpus.mjs`

Two-part probe:

1. AF0001 audit — per-position rect tuples + colour coverage. AF0001
   has one position (Front Chest), 54 colours, 5 distinct rect sizes
   per colour. Healthy data — no silent-swap risk, no single-rect
   problem.

2. Corpus scan — for every Laltex product with print coordinates,
   counts distinct `(x, y)` tuples across all positions. Buckets the
   catalogue into:
   - 202 products (25.5%) with `distinct_xy = 1` — a single rect
     copied. Harmless on single-position products.
   - 100 products (12.6%) with **multiple positions but a single
     `(x, y)` tuple** — the MG0192 pattern. These are the products
     where DesignerV2 needs Fix #2 (canonical-position lock).
     Heavily skewed to mugs (MG0xxx) and power banks (ZCxxxx).
   - 590 products (74.5%) with `distinct_xy > 1` — genuine
     per-position data, Fix #1's strict colour match is enough.

## Adding a new probe

- Keep each probe to one concern.
- Use the Management API + PAT pattern, not the service-role key.
- Print results in summary form first; only dump full rows if there's
  a reason. Some `print_area_coordinates` arrays run into the hundreds
  of rows.
- Probes do not write to the DB. If a probe ever needs to write,
  promote it out of this folder and treat it as a regular script.
