-- ============================================================================
-- AVA Direct-product upsell context
-- ----------------------------------------------------------------------------
-- Structured upsell context for the 11 express-delivery PGifts Direct products.
-- Read at AVA chat init and injected into the system prompt as a cached block
-- (CLAUDE.md §32.4). This table is the editing surface for upsell TUNING:
-- edit rows in Supabase Studio, no code change or git commit required. The
-- conversation RULES (stable) live in docs/ava-conversation-rules.md instead.
--
-- Seed data is drafted from verbatim catalog_products.description text and the
-- live supplier_products sell_price tiers (read 2026-06-04). price_tier is set
-- by USE-CASE positioning, not price alone (Dave's rule, PR #72 review):
-- premium is reserved for genuinely executive / high-value-contact gifting
-- (Luggie travel adapter, Gamma Lite). Mass-distribution products stay mid even
-- when the unit price is high: Ice P is a 5,000mAh power bank (~£13-17) but its
-- use cases (everyday gifting, conference packs, safety kits) are mid, so it is
-- tiered mid. Cables = mid, apparel = entry/mid.
--
-- slug = the bare catalog_products slug (e.g. 'luggie', 'mr-bio-pd-long'), NOT
-- a URL path. Matches how catalog_products keys products and is simpler to edit
-- in Studio (Dave's rule, PR #72 review).
--
-- Hoodie and Sweatshirt framings are intentionally '<NEEDS DAVE INPUT: ...>':
-- the source data carries no honest competitor differentiator for them (the
-- catalog_product_specifications rows are identical generic boilerplate across
-- all four clothing products and contradict the descriptions). Better an empty
-- flag than fabricated marketing copy. The loader skips any framing containing
-- that marker so it never reaches a customer.
--
-- DEPLOY (CLAUDE.md §52): apply via Supabase SQL Editor BEFORE merging the PR.
-- Verify with the SELECT at the bottom, then merge.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ava_direct_product_context (
    id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                     text        NOT NULL UNIQUE,
    product_name             text        NOT NULL,
    use_cases                text[]      NOT NULL DEFAULT '{}',
    price_tier               text        NOT NULL CHECK (price_tier IN ('entry', 'mid', 'premium')),
    differentiators          text        NOT NULL,
    upsell_triggers          text[]      NOT NULL DEFAULT '{}',
    upsell_framing_example   text        NOT NULL,
    active                   boolean     NOT NULL DEFAULT true,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ava_direct_product_context_active_idx
  ON ava_direct_product_context(active) WHERE active = true;

-- RLS: SELECT open (the chat function reads via service role anyway; open SELECT
-- keeps a future authenticated read path simple). No INSERT/UPDATE/DELETE policy
-- means writes are denied to anon + authenticated; only service_role (which
-- bypasses RLS) can write. Edits happen in Supabase Studio.
ALTER TABLE ava_direct_product_context ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ava_direct_product_context_select ON ava_direct_product_context;
CREATE POLICY ava_direct_product_context_select
  ON ava_direct_product_context FOR SELECT
  USING (true);

-- updated_at maintenance (reuses the project-wide trigger fn; see §15)
DROP TRIGGER IF EXISTS ava_direct_product_context_set_updated_at ON ava_direct_product_context;
CREATE TRIGGER ava_direct_product_context_set_updated_at
  BEFORE UPDATE ON ava_direct_product_context
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- Seed: 11 express-delivery PGifts Direct products
-- ----------------------------------------------------------------------------
INSERT INTO ava_direct_product_context
  (slug, product_name, use_cases, price_tier, differentiators, upsell_triggers, upsell_framing_example)
VALUES
  ('t-shirts', 'T-shirts',
   ARRAY['event staff uniforms','club kit','promotional giveaways','bulk apparel orders'],
   'entry',
   'Gildan heavyweight cotton in white plus a wide coloured range, screen printed. A recognised garment brand built for repeated wear, not a thin throwaway giveaway tee.',
   ARRAY['clothing','apparel','t-shirt','t-shirts','uniform','event staff','giveaway','bulk apparel','screen print'],
   'The PGifts Direct T-shirt is worth suggesting when the customer wants a recognised Gildan heavyweight cotton tee that holds up to repeated wear and washing, rather than a thin giveaway shirt.'),

  ('polo', 'Polo',
   ARRAY['corporate uniforms','hospitality teams','staff workwear'],
   'entry',
   'Classic three-button polo in white and coloured variants. Pricing is held competitive on small-batch orders under 100 units (the polo price guard), so small teams are not penalised on price per unit.',
   ARRAY['polo','polos','uniform','corporate wear','hospitality','workwear','staff shirt'],
   'The PGifts Direct Polo is worth suggesting for smaller polo runs: pricing is held competitive under 100 units, so a small team or department is not penalised on price per unit.'),

  ('hoodie', 'Hoodie',
   ARRAY['event staff','sports clubs','brand merchandise','team kit'],
   'mid',
   'Pullover hooded sweatshirt with front pouch pocket and drawstring hood, a substantial layer for adult workwear and team kit, screen printed across white and coloured variants.',
   ARRAY['hoodie','hoodies','hooded sweatshirt','team kit','sports club','brand merch','winter wear'],
   '<NEEDS DAVE INPUT: genuine why-us hook for the hoodie. Source data has only generic garment features (pouch pocket, drawstring); no brand, stock, lead-time, or quality differentiator to ground a competitor hook honestly.>'),

  ('sweatshirts', 'Sweatshirts',
   ARRAY['corporate uniforms','university merchandise','winter event kits'],
   'mid',
   'Crew-neck sweatshirt for corporate uniforms, university merchandise, and winter event kits, screen printed across white and coloured variants.',
   ARRAY['sweatshirt','sweatshirts','crew neck','university merch','winter kit','jumper'],
   '<NEEDS DAVE INPUT: genuine why-us hook for the sweatshirt. Source description claims a heavyweight blend but the spec record says 200g (mid-weight) and is generic boilerplate; no brand, stock, or lead-time field to ground a competitor hook honestly.>'),

  ('octopus-mini', 'Octopus Mini',
   ARRAY['conference welcome packs','lower-cost tech giveaways','delegate bags'],
   'mid',
   'Compact power bank with built-in charging cables in a pocket-sized form factor, a lower price point than the full Ocean Octopus while keeping the cable-free convenience.',
   ARRAY['power bank','charging cable','tech giveaway','conference','compact','budget tech','pocket charger'],
   'The Octopus Mini is worth suggesting when a customer wants a compact tech giveaway at a lower price point than the full Ocean Octopus.'),

  ('ocean-octopus', 'Ocean Octopus',
   ARRAY['travel-heavy corporate clients','event delegate kits','tech-sector campaigns'],
   'mid',
   'Multi-output power bank with several charging cables built into the housing, so recipients never need to carry their own leads. A PGifts Direct hero product with live Designer previews.',
   ARRAY['power bank','charging cable','travel','delegate kit','tech','multi cable','conference'],
   'The Ocean Octopus is worth suggesting for travel-heavy clients who would value a power bank with the cables already built in, so recipients never need to carry their own.'),

  ('mr-bio', 'Mr Bio',
   ARRAY['sustainability-led corporate gifting','conference delegate bags','eco campaigns'],
   'mid',
   'Multi-charging cable, 61% recycled by weight with a recycled-plastic housing, DuPont Tyvek jacket, and FSC-certified paper packaging. Three output tips cover Apple, Android, and USB-C in one unit.',
   ARRAY['eco','recycled','sustainable','charging cable','tech','conference','green gift','multi tip'],
   'The Mr Bio cable is worth suggesting when sustainability matters: 61% recycled with FSC packaging, which lands well with eco-conscious corporate gifting.'),

  ('mr-bio-pd-long', 'Mr Bio PD Long',
   ARRAY['premium eco tech gifts','executive delegate kits','sustainability campaigns'],
   'mid',
   '2-metre multi-charging cable, 53% GRS-certified recycled plastic, up to 60W fast charging and data transfer, a central logo hub for branding, and a heart indicator that lights green in fast-charge mode. CarPlay compatible.',
   ARRAY['eco','recycled','fast charge','long cable','premium tech','sustainable','60w','carplay'],
   'The Mr Bio PD Long is worth suggesting for a premium eco tech gift, with 60W fast charging and a 2-metre recycled cable.'),

  ('ice-p', 'Ice P',
   ARRAY['everyday corporate gifting','conference welcome packs','safety and emergency kits'],
   'mid',
   '5,000mAh power bank with 15W fast charging and a built-in smart-touch LED flashlight, recharging a typical phone around twice per cycle. The flashlight adds practical utility for safety and emergency use.',
   ARRAY['power bank','flashlight','safety kit','emergency','conference','corporate gift','torch','5000mah'],
   'The Ice P is worth suggesting where a built-in flashlight adds practical value to a tech giveaway, especially conference packs and safety or emergency kits where the safety angle resonates.'),

  ('luggie', 'Luggie',
   ARRAY['executive travel programs','incentive trips','premium welcome kits','higher-value client gifts'],
   'premium',
   'International travel adapter covering 150+ countries with swap-in US, UK, EU, and AUS plugs, two 25W USB-C ports and a 15W USB-A port, built from 65% recycled flame-retardant R-ABS with a generous imprint area. A premium gift for higher-value contacts.',
   ARRAY['travel','adapter','executive gift','premium','incentive','international','conference travel','plug','higher value client'],
   'The Luggie is worth considering if the client wants a premium gift for higher-value contacts: a recycled international travel adapter that covers 150+ countries.'),

  ('gamma-lite', 'Gamma Lite',
   ARRAY['tech-focused corporate gifting','sustainability-led campaigns','conference packs'],
   'premium',
   'Compact 3,000mAh pocket power bank (ABS plus lithium battery) with a built-in multi-cable that recharges itself from the mains while charging a phone or device, 30% GRS-certified recycled plastic, FSC packaging, and a 2-year warranty. Unlike Mr Bio (a recycled cable with no battery), this carries its own charge.',
   ARRAY['power bank','eco','recycled','compact','tech gift','sustainable','pocket charger','warranty','battery','portable power'],
   'The Gamma Lite is worth suggesting when the customer wants portable power rather than just a cable: a 3,000mAh pocket power bank with the charging lead built in, so recipients can top up away from the mains. Suggest the Mr Bio cable instead when they only need a recycled charging lead, not a battery.');

COMMIT;

-- ----------------------------------------------------------------------------
-- Verification (run after COMMIT):
--   SELECT slug, product_name, price_tier, array_length(use_cases,1) AS uses,
--          array_length(upsell_triggers,1) AS triggers
--     FROM ava_direct_product_context ORDER BY slug;
--   -- expect 11 rows, every price_tier in (entry,mid,premium), no nulls.
-- ----------------------------------------------------------------------------
