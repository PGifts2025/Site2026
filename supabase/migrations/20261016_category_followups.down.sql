-- Rollback for 20261016_category_followups.sql.
BEGIN;

INSERT INTO public.category_product_curation
  (id, category_slug, supplier_product_code, position, created_at, card_image_url, card_image_checked_at)
VALUES (715, 'power', 'ZU0501BK', 26, '2026-05-19T16:24:42.339782+00:00',
        'https://laltex-extranet.co.uk/images/ZU0501BK-8GB.jpg', '2026-10-07T15:31:30.965+00:00')
ON CONFLICT (id) DO NOTHING;

UPDATE public.catalog_products SET badge = 'Eco-Friendly' WHERE slug = 'mr-bio-pd-long';

DELETE FROM public.catalog_product_features f
 USING public.catalog_products p
 WHERE p.id = f.catalog_product_id AND p.slug = 'mr-bio-pd-long'
   AND f.feature_text = '53% GRS-certified recycled plastic';

COMMIT;

-- Verify: expect usb_on_power = 1, badge = Eco-Friendly.
SELECT (SELECT count(*) FROM public.category_product_curation
         WHERE category_slug = 'power' AND supplier_product_code = 'ZU0501BK') AS usb_on_power,
       (SELECT badge FROM public.catalog_products WHERE slug = 'mr-bio-pd-long') AS badge;
