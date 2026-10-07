-- Rollback for 20261014_category_cleanup_and_ava_context.sql: restores the 5 curation
-- rows (original ids/positions) and the 2 Ava context rows verbatim.

BEGIN;

INSERT INTO public.category_product_curation (id, category_slug, supplier_product_code, position, created_at) VALUES (184, 'bags', 'SS0069', 121, '2026-05-19T16:21:03.323412+00:00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.category_product_curation (id, category_slug, supplier_product_code, position, created_at) VALUES (185, 'bags', 'SS0079', 122, '2026-05-19T16:21:03.323412+00:00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.category_product_curation (id, category_slug, supplier_product_code, position, created_at) VALUES (186, 'bags', 'SS1069', 123, '2026-05-19T16:21:03.323412+00:00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.category_product_curation (id, category_slug, supplier_product_code, position, created_at) VALUES (198, 'cables', 'ZU0501BK', 12, '2026-05-19T16:21:52.488675+00:00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.category_product_curation (id, category_slug, supplier_product_code, position, created_at) VALUES (713, 'power', 'ZP0107', 24, '2026-05-19T16:24:42.339782+00:00') ON CONFLICT (id) DO NOTHING;
UPDATE public.ava_direct_product_context SET differentiators = $q$Multi-output power bank with several charging cables built into the housing, so recipients never need to carry their own leads. A PGifts Direct hero product with live Designer previews.$q$, upsell_triggers = ARRAY[$q$power bank$q$, $q$charging cable$q$, $q$travel$q$, $q$delegate kit$q$, $q$tech$q$, $q$multi cable$q$, $q$conference$q$]::text[], upsell_framing_example = $q$The Ocean Octopus is worth suggesting for travel-heavy clients who would value a power bank with the cables already built in, so recipients never need to carry their own.$q$ WHERE id = '83083a05-b66e-4372-b126-86fda41cbd91';
UPDATE public.ava_direct_product_context SET differentiators = $q$Compact power bank with built-in charging cables in a pocket-sized form factor, a lower price point than the full Ocean Octopus while keeping the cable-free convenience.$q$, upsell_triggers = ARRAY[$q$power bank$q$, $q$charging cable$q$, $q$tech giveaway$q$, $q$conference$q$, $q$compact$q$, $q$budget tech$q$, $q$pocket charger$q$]::text[], upsell_framing_example = $q$The Octopus Mini is worth suggesting when a customer wants a compact tech giveaway at a lower price point than the full Ocean Octopus.$q$ WHERE id = '2614c0d9-62a5-463f-96b4-4e504ee6458d';

COMMIT;

-- Verify: expect miscat_rows = 5.
SELECT count(*) AS miscat_rows FROM public.category_product_curation
 WHERE (category_slug = 'cables' AND supplier_product_code = 'ZU0501BK')
    OR (category_slug = 'bags' AND supplier_product_code IN ('SS0069', 'SS1069', 'SS0079'))
    OR (category_slug = 'power' AND supplier_product_code = 'ZP0107');
