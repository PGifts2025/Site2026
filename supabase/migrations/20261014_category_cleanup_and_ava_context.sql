-- =============================================================================
-- 20261014_category_cleanup_and_ava_context.sql — category page review (9 Oct 2026)
--
-- 1. Remove obviously mis-categorised curated products from category grids:
--    cables: ZU0501BK Twister 8GB USB (a USB memory stick);
--    bags:   SS0069 / SS0079 / SS1069 dog waste-bag dispensers;
--    power:  ZP0107 RFID Magnetic Phone Wallet (not a power product).
--    (ZU0501BK stays on Power pending the owner's decision.)
-- 2. Ava's upsell context still described Ocean Octopus / Octopus Mini as power
--    banks. They are multi-head charging cables with no battery, made from
--    recycled ocean-reclaimed material (owner, 9 Oct 2026).
-- Rollback: .down.sql (restores rows by id).
-- =============================================================================

BEGIN;

DELETE FROM public.category_product_curation WHERE id = 184 AND supplier_product_code = 'SS0069';
DELETE FROM public.category_product_curation WHERE id = 185 AND supplier_product_code = 'SS0079';
DELETE FROM public.category_product_curation WHERE id = 186 AND supplier_product_code = 'SS1069';
DELETE FROM public.category_product_curation WHERE id = 198 AND supplier_product_code = 'ZU0501BK';
DELETE FROM public.category_product_curation WHERE id = 713 AND supplier_product_code = 'ZP0107';
UPDATE public.ava_direct_product_context SET differentiators = $q$Multi-head charging cable (no battery) with several connector tips built into one unit, so one cable charges a range of phones and devices. Made from recycled ocean-reclaimed material. A PGifts Direct hero product with live Designer previews.$q$, upsell_triggers = ARRAY[$q$charging cable$q$, $q$multi cable$q$, $q$multi tip$q$, $q$travel$q$, $q$delegate kit$q$, $q$tech$q$, $q$conference$q$, $q$eco$q$, $q$recycled$q$, $q$ocean plastic$q$, $q$sustainable$q$]::text[], upsell_framing_example = $q$The Ocean Octopus is worth suggesting when the customer wants one charging cable that suits everyone's phone: several connector tips in one unit, made from recycled ocean-reclaimed material. It is a cable, not a power bank, so suggest the Gamma Lite or Ice P if they need portable power.$q$ WHERE id = '83083a05-b66e-4372-b126-86fda41cbd91';
UPDATE public.ava_direct_product_context SET differentiators = $q$Compact, pocket-sized version of the Ocean Octopus multi-head charging cable (no battery), made from recycled ocean-reclaimed material, at a lower price point than the full Ocean Octopus.$q$, upsell_triggers = ARRAY[$q$charging cable$q$, $q$multi tip$q$, $q$tech giveaway$q$, $q$conference$q$, $q$compact$q$, $q$budget tech$q$, $q$eco$q$, $q$recycled$q$, $q$ocean plastic$q$]::text[], upsell_framing_example = $q$The Octopus Mini is worth suggesting for a compact, lower-cost tech giveaway: a pocket-sized multi-head charging cable made from recycled ocean-reclaimed material. It has no battery.$q$ WHERE id = '2614c0d9-62a5-463f-96b4-4e504ee6458d';

COMMIT;

-- Verify: expect miscat_rows = 0, power_bank_claims = 0, ocean_claims = 2
SELECT
  (SELECT count(*) FROM public.category_product_curation
    WHERE (category_slug = 'cables' AND supplier_product_code = 'ZU0501BK')
       OR (category_slug = 'bags' AND supplier_product_code IN ('SS0069', 'SS1069', 'SS0079'))
       OR (category_slug = 'power' AND supplier_product_code = 'ZP0107')) AS miscat_rows,
  (SELECT count(*) FROM public.ava_direct_product_context
    WHERE slug IN ('ocean-octopus', 'octopus-mini')
      AND (differentiators ILIKE '%power bank with%' OR differentiators ILIKE 'compact power bank%'
           OR 'power bank' = ANY (upsell_triggers))) AS power_bank_claims,
  (SELECT count(*) FROM public.ava_direct_product_context
    WHERE slug IN ('ocean-octopus', 'octopus-mini') AND differentiators ILIKE '%ocean-reclaimed%') AS ocean_claims;
