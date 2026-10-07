-- =============================================================================
-- 20261011_catalogue_truth_cleanup.sql — owner's decisions of 9 Oct 2026
--
-- A. Remove unverified template specs/features (keep only what is specific and
--    supported by the product's own copy). Full list in the PR body.
-- B. Ocean Octopus / Octopus Mini are multi-head charging CABLES (no battery).
-- D. Colour names: "Voilet P7679" -> "Violet (Pantone 7679)"; "White " trimmed.
--    The Designer builds template URLs from the colour name, so the template
--    PNGs were COPIED to the new names first (old files kept for rollback).
-- E. No sales yet: "Best Seller" -> "Our Pick"; Chi Cup -> "Full Wrap Print";
--    recycled bags -> "Recycled". "New" (Edge pens) kept.
-- Catalogue data only. Rollback: .down.sql (restores every row by id).
-- After applying: re-run the mirror + embed scripts (or wait for the crons).
-- =============================================================================

BEGIN;

DELETE FROM public.catalog_product_features WHERE id = 'd3f9ca67-2b6f-4c1a-97bd-92716de61754';
DELETE FROM public.catalog_product_features WHERE id = '67f12845-fb78-4e98-b733-425ef66ac889';
UPDATE public.catalog_product_features SET feature_text = $q$Multiple colours available$q$ WHERE id = 'd4973051-c711-4f1a-bccf-14faca487f54';
UPDATE public.catalog_product_features SET feature_text = $q$Multiple colours available$q$ WHERE id = '67b6cf10-2a72-450b-a42b-db39e032a087';
DELETE FROM public.catalog_product_features WHERE id = 'ffff0d5f-92a0-4201-8214-12debe76069c';
DELETE FROM public.catalog_product_features WHERE id = '1085dfc4-fbf7-44cf-abc8-a148c635263b';
UPDATE public.catalog_product_features SET feature_text = $q$Multiple colours available$q$ WHERE id = '039cd4c3-e9c2-49e0-b689-41a6c4bed9cf';
DELETE FROM public.catalog_product_features WHERE id = '563d9e2b-06cb-471c-9a96-d52bc56d47ed';
DELETE FROM public.catalog_product_features WHERE id = '43dbb21f-34d0-4e5a-b9c8-48817d051725';
UPDATE public.catalog_product_features SET feature_text = $q$Multiple colours available$q$ WHERE id = 'df4e0b75-6e8a-42bc-8069-a212a93ffe84';
DELETE FROM public.catalog_product_features WHERE id = '50d2a22e-32a2-4a21-a9bd-6fb3e7bb5bb3';
DELETE FROM public.catalog_product_features WHERE id = '5fad3f40-0972-4127-aff4-4ff3653320e5';
UPDATE public.catalog_product_features SET feature_text = $q$Multiple colours available$q$ WHERE id = 'e08ff3b4-fec1-490a-a497-9e5f4f3c2006';
DELETE FROM public.catalog_product_features WHERE id = '20ce1113-b573-4cec-ac0e-3213c2b39478';
DELETE FROM public.catalog_product_features WHERE id = '027576f7-8e0c-424b-9cad-8c031aa2dc9e';
DELETE FROM public.catalog_product_features WHERE id = 'f38ee180-b232-4a35-aac6-bda4ff5256c6';
DELETE FROM public.catalog_product_features WHERE id = '0698cbc7-287d-4ae6-bba2-c6026f7fffa8';
DELETE FROM public.catalog_product_features WHERE id = 'd1c0f6f7-e7c8-42c4-9001-9ec0295507a2';
DELETE FROM public.catalog_product_features WHERE id = 'fd2804e4-472b-4c49-885e-540a2e5c1137';
DELETE FROM public.catalog_product_features WHERE id = 'b48d9ea4-2bec-4065-ba4f-43a5205b6e82';
DELETE FROM public.catalog_product_features WHERE id = '9e081bfc-2f23-4c71-87bd-2eaaac6796da';
DELETE FROM public.catalog_product_features WHERE id = '038dd59e-26a5-4e02-9a35-7f63dc3041da';
DELETE FROM public.catalog_product_features WHERE id = '34233a9a-1d98-4c58-9f64-c350ad60c7d0';
DELETE FROM public.catalog_product_features WHERE id = 'f03c0682-f5dd-4266-a3c5-71471722eb7e';
DELETE FROM public.catalog_product_features WHERE id = '165dcc0e-c63e-4fe0-b289-db0e2660e1ca';
DELETE FROM public.catalog_product_features WHERE id = '5eff9b50-32fe-448f-863e-76efdb47a291';
DELETE FROM public.catalog_product_features WHERE id = '7498920a-ae09-4359-a71b-f5848f05378d';
DELETE FROM public.catalog_product_features WHERE id = '40657b96-a45d-4b67-9e51-acdb0990996f';
DELETE FROM public.catalog_product_features WHERE id = '2a9dbdb5-fe51-460c-9a5d-bfaa4a7227ea';
DELETE FROM public.catalog_product_features WHERE id = '63e50ecd-c000-4a41-882c-5082bdc2824b';
DELETE FROM public.catalog_product_features WHERE id = 'a6e9d99b-2eca-4da6-806b-bb27ed95bc24';
DELETE FROM public.catalog_product_features WHERE id = 'ce254dfc-99d9-49a4-a848-e510f59006da';
DELETE FROM public.catalog_product_features WHERE id = 'd1b8655a-203f-424c-8b48-84ef597c54c2';
DELETE FROM public.catalog_product_features WHERE id = '5ef2b854-ed97-415b-956e-70df7804cd83';
DELETE FROM public.catalog_product_features WHERE id = '5ced4bff-7374-4cf9-9e91-8f73e0585525';
DELETE FROM public.catalog_product_features WHERE id = '24d04cd6-1d65-49fc-9404-f3f1255b87c9';
DELETE FROM public.catalog_product_features WHERE id = 'abd43fa8-fd17-4052-9e0d-9dd6224f15ae';
DELETE FROM public.catalog_product_features WHERE id = 'f40b7fbe-a241-4db1-a9c0-cf109ebffba0';
DELETE FROM public.catalog_product_features WHERE id = 'f4d69f9b-048a-4d36-bfa8-3636c3c223f9';
DELETE FROM public.catalog_product_features WHERE id = 'fb2ebc4c-d503-4e20-983c-9ef14c73579c';
DELETE FROM public.catalog_product_features WHERE id = 'b3b922b6-08cc-4399-8b79-1c5d79631533';
DELETE FROM public.catalog_product_features WHERE id = '80263ac1-df45-4ca4-9e38-15ef63d01b73';
DELETE FROM public.catalog_product_features WHERE id = '54172a77-d8a0-4392-88e7-86ba5fa1d98a';
DELETE FROM public.catalog_product_features WHERE id = '19847b7b-0217-4aec-a040-d7a3e5dc3265';
DELETE FROM public.catalog_product_features WHERE id = '1ef9d9c9-ce28-41b7-9ca9-3708eea8fab2';
DELETE FROM public.catalog_product_features WHERE id = '6796e737-7b10-4817-b7dc-c1cc2952565b';
DELETE FROM public.catalog_product_features WHERE id = 'a27474ff-3aa7-417c-bd13-810c9a3f6cca';
DELETE FROM public.catalog_product_features WHERE id = '0928b09e-8e33-4e77-b1e9-7fbfee3e0158';
DELETE FROM public.catalog_product_features WHERE id = 'd6db73b3-69b3-4537-aac5-b119cba5e09d';
DELETE FROM public.catalog_product_features WHERE id = '3142a865-478e-4799-bb1d-6a7cea4a7f1d';
DELETE FROM public.catalog_product_features WHERE id = '6fcaf0f6-7e22-48f2-8734-ea79d581b32b';
DELETE FROM public.catalog_product_features WHERE id = 'ce6af6d0-43a5-4a48-af36-4c9f4fc0837f';
DELETE FROM public.catalog_product_features WHERE id = 'b6455e40-ee33-409a-ab13-00b949b9a936';
DELETE FROM public.catalog_product_features WHERE id = 'ed17fd14-cc8b-4c4d-9ed6-7ee497c51b94';
DELETE FROM public.catalog_product_features WHERE id = '0f17fe38-af99-4eed-91d1-9639e12da9d8';
DELETE FROM public.catalog_product_features WHERE id = 'dcee7e1a-35ce-456b-8b2a-804aa4d478f1';
DELETE FROM public.catalog_product_features WHERE id = '04402275-fdbc-4864-b2de-94d72f356a1e';
DELETE FROM public.catalog_product_features WHERE id = 'c7377be7-552e-4c90-98f9-53f2a3ed7f0b';
DELETE FROM public.catalog_product_features WHERE id = '77f67bb6-c2ab-4f5f-ab3f-5a3efed97d08';
DELETE FROM public.catalog_product_features WHERE id = '74d9d674-e4dc-4241-8ca1-c04be5ab7c70';
UPDATE public.catalog_product_features SET feature_text = $q$Cotton material$q$ WHERE id = 'ea8fb6e5-6313-4c36-af46-0b3812f99a02';
DELETE FROM public.catalog_product_features WHERE id = '44b7f2f9-d501-41e9-90e2-3c64ea7feb4f';
DELETE FROM public.catalog_product_features WHERE id = '73854e7d-77ad-43de-a43d-6760628203be';
DELETE FROM public.catalog_product_features WHERE id = '2a6b07f6-b9a9-497e-be39-f717cab6b834';
UPDATE public.catalog_product_specifications SET specifications = $q${"Material": "Cotton"}$q$::jsonb WHERE id = 'e6d7b34e-ed4f-46df-acb6-70de46006aaa';
UPDATE public.catalog_product_specifications SET specifications = $q${"Material": "Cotton"}$q$::jsonb WHERE id = '2e391ff4-3d29-465a-a232-e1442d7ca367';
UPDATE public.catalog_product_specifications SET specifications = $q${"Material": "Cotton"}$q$::jsonb WHERE id = 'c954918a-6f29-468a-a895-2e1b13950baf';
UPDATE public.catalog_product_specifications SET specifications = $q${"Material": "Cotton"}$q$::jsonb WHERE id = 'c19e0b6c-6971-4113-a1a2-3e9b3ed60524';
UPDATE public.catalog_product_specifications SET specifications = $q${"Material": "Cotton"}$q$::jsonb WHERE id = '687af10d-207f-4526-8120-4acd04387eeb';
UPDATE public.catalog_product_specifications SET specifications = $q${}$q$::jsonb WHERE id = 'a1979a86-6e6e-47d8-b51d-21eb80cd1fa2';
UPDATE public.catalog_product_specifications SET specifications = $q${}$q$::jsonb WHERE id = '569a2682-fba0-47c4-b279-bf5954c68386';
UPDATE public.catalog_product_specifications SET specifications = $q${}$q$::jsonb WHERE id = 'ed3a2795-0440-4048-ad71-697b17a18b6e';
UPDATE public.catalog_product_specifications SET specifications = $q${}$q$::jsonb WHERE id = '872c0176-b123-4aae-b20a-33fa503bed76';
UPDATE public.catalog_product_specifications SET specifications = $q${}$q$::jsonb WHERE id = 'c2444b63-f9a7-4dec-a0ee-7b10b4ab733a';
UPDATE public.catalog_product_specifications SET specifications = $q${}$q$::jsonb WHERE id = '47f5c14f-3214-45ec-b9ba-e75fb7305e60';
UPDATE public.catalog_product_specifications SET specifications = $q${}$q$::jsonb WHERE id = '4220d383-1826-46dd-be24-225ce9b3c6cb';
UPDATE public.catalog_product_specifications SET specifications = $q${}$q$::jsonb WHERE id = '3759561b-9e38-4446-9411-f0daa106b6f0';
UPDATE public.catalog_product_specifications SET specifications = $q${}$q$::jsonb WHERE id = '99bcdb13-72f4-4a63-8982-c1bd32d129e2';
UPDATE public.catalog_product_specifications SET specifications = $q${}$q$::jsonb WHERE id = 'e58777a5-5163-41a3-8992-a0d14b218349';
UPDATE public.catalog_product_specifications SET specifications = $q${}$q$::jsonb WHERE id = 'c7b2b529-779c-4caa-b3ba-a246d2b32850';
UPDATE public.catalog_product_specifications SET specifications = $q${}$q$::jsonb WHERE id = 'bc8bb2fe-0b50-40c6-924a-63eb19a88b75';
UPDATE public.catalog_product_specifications SET specifications = $q${}$q$::jsonb WHERE id = '5c0508dc-942b-47a8-b1aa-1f69cbdaae5d';
UPDATE public.catalog_product_specifications SET specifications = $q${}$q$::jsonb WHERE id = '8d1e96d9-3a74-48c2-b4bf-f2252d7dab8b';
UPDATE public.catalog_product_specifications SET specifications = $q${}$q$::jsonb WHERE id = 'eb9feb5e-9380-42da-bfc8-9aed9f930102';
UPDATE public.catalog_product_specifications SET specifications = $q${}$q$::jsonb WHERE id = 'bd5cedbd-e7fe-419e-92bc-0bf2d13e20d0';
UPDATE public.catalog_product_specifications SET specifications = $q${"Material": "Cotton"}$q$::jsonb WHERE id = '0dd066aa-2363-4f01-8a21-d8ec0dbf5639';
UPDATE public.catalog_product_specifications SET specifications = $q${"Weight": "350g", "Material": "Stainless Steel 304", "Print Area": "70 x 170mm"}$q$::jsonb WHERE id = '84758c4a-0691-4d1e-8ccf-c9bac2d04e7c';
UPDATE public.catalog_products SET badge = $q$Our Pick$q$ WHERE slug = '5oz-cotton-bag';
UPDATE public.catalog_products SET badge = $q$Our Pick$q$ WHERE slug = '8oz-canvas';
UPDATE public.catalog_products SET badge = $q$Our Pick$q$ WHERE slug = 'gamma-lite';
UPDATE public.catalog_products SET badge = $q$Our Pick$q$ WHERE slug = 'hi-vis-vest';
UPDATE public.catalog_products SET badge = $q$Our Pick$q$ WHERE slug = 'ice-p';
UPDATE public.catalog_products SET badge = $q$Our Pick$q$ WHERE slug = 'luggie';
UPDATE public.catalog_products SET badge = $q$Our Pick$q$ WHERE slug = 'mr-bio';
UPDATE public.catalog_products SET badge = $q$Our Pick$q$ WHERE slug = 'ocean-octopus';
UPDATE public.catalog_products SET badge = $q$Our Pick$q$ WHERE slug = 'polo';
UPDATE public.catalog_products SET badge = $q$Our Pick$q$ WHERE slug = 't-shirts';
UPDATE public.catalog_products SET badge = $q$Our Pick$q$ WHERE slug = 'tea-towel';
UPDATE public.catalog_products SET badge = $q$Full Wrap Print$q$ WHERE slug = 'chi-cup';
UPDATE public.catalog_products SET badge = $q$Recycled$q$ WHERE slug = '12oz-recycled-canvas';
UPDATE public.catalog_products SET badge = $q$Recycled$q$ WHERE slug = '5oz-recycled-cotton-bag';
UPDATE public.catalog_products SET description = $q$Multi-head charging cable with several connector tips built into one unit, so a single cable charges a range of phones and devices. Suited to travel-heavy corporate clients, event delegate kits, and tech-sector promotional campaigns.$q$ WHERE slug = 'ocean-octopus';
UPDATE public.catalog_products SET description = $q$Compact version of the Ocean Octopus multi-head charging cable, sized to fit in a pocket or laptop bag for on-the-go charging. Suited to conference welcome packs and lower-cost tech giveaways.$q$ WHERE slug = 'octopus-mini';
UPDATE public.catalog_product_colors SET color_name = $q$White$q$ WHERE id = '38b01dc4-a789-43d3-b7e9-6169cacda829';
UPDATE public.catalog_product_colors SET color_name = $q$Violet (Pantone 7679)$q$ WHERE id = '07b9c4d8-53fc-4f85-a4b0-dcf2652a1384';
UPDATE public.product_template_variants SET color_name = $q$Violet (Pantone 7679)$q$, template_url = $q$https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/5oz-cotton-bag/violet-pantone-7679-front.png$q$ WHERE id = '9687349e-815c-49df-84db-c7f4135d98d1';
UPDATE public.product_template_variants SET color_name = $q$Violet (Pantone 7679)$q$, template_url = $q$https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/5oz-cotton-bag/violet-pantone-7679-back.png$q$ WHERE id = 'a31de302-77a3-45a5-b862-e0b1cb76f628';
UPDATE public.product_template_variants SET color_name = $q$White$q$, template_url = $q$https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/water-bottle/white-front.png$q$ WHERE id = 'd1f08bec-466d-497d-8499-8ab6b491b7d2';
UPDATE public.catalog_product_images SET alt_text = $q$5oz Cotton Bag - Violet (Pantone 7679)$q$ WHERE id = 'c5c34994-ba6b-4b00-850c-ac7bc76accd4';
UPDATE public.catalog_product_images SET alt_text = $q$Water Bottle - White$q$ WHERE id = '8776d125-1914-4a9b-892c-031ec8c7c367';

COMMIT;

-- Verify: expect best_seller = 0, voilet = 0, trailing_space = 0, placeholder_specs = 0,
--         origin_specs = 0, battery_on_cables = 0
SELECT
  (SELECT count(*) FROM public.catalog_products WHERE badge = 'Best Seller') AS best_seller,
  (SELECT count(*) FROM public.catalog_product_colors WHERE color_name ILIKE '%voilet%')
   + (SELECT count(*) FROM public.product_template_variants WHERE color_name ILIKE '%voilet%') AS voilet,
  (SELECT count(*) FROM public.catalog_product_colors WHERE color_name ~ '\s$')
   + (SELECT count(*) FROM public.product_template_variants WHERE color_name ~ '\s$') AS trailing_space,
  (SELECT count(*) FROM public.catalog_product_specifications
    WHERE specifications::text ~ '(Varies|Premium Materials|"120g"|"200g"|"25g"|"180g")') AS placeholder_specs,
  (SELECT count(*) FROM public.catalog_product_specifications WHERE specifications ? 'Origin') AS origin_specs,
  (SELECT count(*) FROM public.catalog_products
    WHERE slug IN ('ocean-octopus', 'octopus-mini') AND description ILIKE '%power bank%') AS battery_on_cables;
