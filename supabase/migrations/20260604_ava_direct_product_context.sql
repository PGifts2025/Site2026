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
-- live supplier_products sell_price tiers (read 2026-06-04). price_tier is
-- inferred from those prices relative to the catalogue: power banks (£12-20)
-- = premium, cables (£3.7-11) = mid, apparel = entry/mid.
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
  ('/clothing/t-shirts', 'T-shirts',
   ARRAY['event staff uniforms','club kit','promotional giveaways','bulk apparel orders'],
   'entry',
   'Gildan Heavy cotton, white plus a wide range of coloured variants, screen printed. As a PGifts Direct line it supports live Designer previews and hex-accurate colour matching before the customer commits.',
   ARRAY['clothing','apparel','t-shirt','t-shirts','uniform','event staff','giveaway','bulk apparel','screen print'],
   'The PGifts Direct T-shirt is worth suggesting when the customer wants to preview their branding live in the Designer with hex-accurate colours before ordering.'),

  ('/clothing/polo', 'Polo',
   ARRAY['corporate uniforms','hospitality teams','staff workwear'],
   'entry',
   'Classic three-button polo, priced to stay competitive on small-batch orders under 100 units, available in white and coloured garment variants with live Designer previews.',
   ARRAY['polo','polos','uniform','corporate wear','hospitality','workwear','staff shirt'],
   'The PGifts Direct Polo is worth suggesting for a customer who wants a uniform they can mock up live in the Designer rather than ordering blind.'),

  ('/clothing/hoodie', 'Hoodie',
   ARRAY['event staff','sports clubs','brand merchandise','team kit'],
   'mid',
   'Pullover hooded sweatshirt with front pouch pocket and drawstring hood, a heavier branded garment available with live Designer previews across white and coloured variants.',
   ARRAY['hoodie','hoodies','hooded sweatshirt','team kit','sports club','brand merch','winter wear'],
   'The PGifts Direct Hoodie is worth suggesting when the customer wants a heavier branded garment they can preview in the Designer before ordering.'),

  ('/clothing/sweatshirts', 'Sweatshirts',
   ARRAY['corporate uniforms','university merchandise','winter event kits'],
   'mid',
   'Crew-neck sweatshirt in a heavyweight blend, the same screen-print structure as the T-shirt and hoodie ranges, with live Designer previews across white and coloured variants.',
   ARRAY['sweatshirt','sweatshirts','crew neck','university merch','winter kit','jumper'],
   'The PGifts Direct Sweatshirt is worth suggesting for winter or university kit where the customer wants to see the print laid out live before committing.'),

  ('/cables/octopus-mini', 'Octopus Mini',
   ARRAY['conference welcome packs','lower-cost tech giveaways','delegate bags'],
   'mid',
   'Compact power bank with built-in charging cables in a pocket-sized form factor, a lower price point than the full Ocean Octopus while keeping the cable-free convenience.',
   ARRAY['power bank','charging cable','tech giveaway','conference','compact','budget tech','pocket charger'],
   'The Octopus Mini is worth suggesting when a customer wants a compact tech giveaway at a lower price point than the full Ocean Octopus.'),

  ('/cables/ocean-octopus', 'Ocean Octopus',
   ARRAY['travel-heavy corporate clients','event delegate kits','tech-sector campaigns'],
   'mid',
   'Multi-output power bank with several charging cables built into the housing, so recipients never need to carry their own leads. A PGifts Direct hero product with live Designer previews.',
   ARRAY['power bank','charging cable','travel','delegate kit','tech','multi cable','conference'],
   'The Ocean Octopus is worth suggesting for travel-heavy clients who would value a power bank with the cables already built in, so recipients never need to carry their own.'),

  ('/cables/mr-bio', 'Mr Bio',
   ARRAY['sustainability-led corporate gifting','conference delegate bags','eco campaigns'],
   'mid',
   'Multi-charging cable, 61% recycled by weight with a recycled-plastic housing, DuPont Tyvek jacket, and FSC-certified paper packaging. Three output tips cover Apple, Android, and USB-C in one unit.',
   ARRAY['eco','recycled','sustainable','charging cable','tech','conference','green gift','multi tip'],
   'The Mr Bio cable is worth suggesting when sustainability matters: 61% recycled with FSC packaging, which lands well with eco-conscious corporate gifting.'),

  ('/cables/mr-bio-pd-long', 'Mr Bio PD Long',
   ARRAY['premium eco tech gifts','executive delegate kits','sustainability campaigns'],
   'mid',
   '2-metre multi-charging cable, 53% GRS-certified recycled plastic, up to 60W fast charging and data transfer, a central logo hub for branding, and a heart indicator that lights green in fast-charge mode. CarPlay compatible.',
   ARRAY['eco','recycled','fast charge','long cable','premium tech','sustainable','60w','carplay'],
   'The Mr Bio PD Long is worth suggesting for a premium eco tech gift, with 60W fast charging and a 2-metre recycled cable.'),

  ('/power/ice-p', 'Ice P',
   ARRAY['everyday corporate gifting','conference welcome packs','safety and emergency kits'],
   'premium',
   '5,000mAh power bank with 15W fast charging and a built-in smart-touch LED flashlight, recharging a typical phone around twice per cycle. The flashlight adds practical utility for safety and emergency use.',
   ARRAY['power bank','flashlight','safety kit','emergency','conference','corporate gift','torch','5000mah'],
   'The Ice P is worth suggesting where the built-in flashlight adds practical value, for example safety kits or emergency packs alongside everyday corporate gifting.'),

  ('/power/luggie', 'Luggie',
   ARRAY['executive travel programs','incentive trips','premium welcome kits','higher-value client gifts'],
   'premium',
   'International travel adapter covering 150+ countries with swap-in US, UK, EU, and AUS plugs, two 25W USB-C ports and a 15W USB-A port, built from 65% recycled flame-retardant R-ABS with a generous imprint area. A premium gift for higher-value contacts.',
   ARRAY['travel','adapter','executive gift','premium','incentive','international','conference travel','plug','higher value client'],
   'The Luggie is worth considering if the client wants a premium gift for higher-value contacts: a recycled international travel adapter that covers 150+ countries.'),

  ('/power/gamma-lite', 'Gamma Lite',
   ARRAY['tech-focused corporate gifting','sustainability-led campaigns','conference packs'],
   'premium',
   'Compact 3,000mAh pocket power bank with a built-in multi-cable that recharges itself from the mains while charging a phone or device, 30% GRS-certified recycled plastic, FSC packaging, and a 2-year warranty.',
   ARRAY['power bank','eco','recycled','compact','tech gift','sustainable','pocket charger','warranty'],
   'The Gamma Lite is worth suggesting for a sustainability-led campaign that still wants a genuinely useful pocket power bank, backed by a 2-year warranty.');

COMMIT;

-- ----------------------------------------------------------------------------
-- Verification (run after COMMIT):
--   SELECT slug, product_name, price_tier, array_length(use_cases,1) AS uses,
--          array_length(upsell_triggers,1) AS triggers
--     FROM ava_direct_product_context ORDER BY slug;
--   -- expect 11 rows, every price_tier in (entry,mid,premium), no nulls.
-- ----------------------------------------------------------------------------
