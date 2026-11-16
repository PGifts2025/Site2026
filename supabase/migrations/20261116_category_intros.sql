-- 20261116_category_intros.sql — CLAUDE.md §66.6
--
-- An "About" paragraph per category page (visible to everyone, shown above
-- the "Need Help Choosing?" box) + its heading. Paragraphs are separated by
-- a blank line. Every fact was checked against the catalogue on 16 Nov 2026:
--   - "from N units" = lowest minimum order in the category (supplier
--     minimum_order_qty / our lowest tier); clothing and hi vis 10, rest 25.
--   - price claims use the same margined "From" price as the category cards
--     (sell_price, ex delivery): cables, notebooks all < £10; cups 63/64 and
--     water bottles 63/63 < £10; pens 201/276 < £1.
--   - "who orders" lines are PROPOSED from what the products are, for the
--     owner to correct — not sales data. Approved by the owner on: <date>.
-- Rollback: 20261116_category_intros.down.sql

BEGIN;

ALTER TABLE public.catalog_categories ADD COLUMN IF NOT EXISTS intro_heading text;
ALTER TABLE public.catalog_categories ADD COLUMN IF NOT EXISTS intro text;
COMMENT ON COLUMN public.catalog_categories.intro IS
  'Visible "About" copy on the category page; paragraphs separated by a blank line. True facts only (CLAUDE.md §65.6, §66.6).';

UPDATE public.catalog_categories AS c
   SET intro_heading = v.h,
       intro = v.t
  FROM (VALUES
('bags', 'Promotional bags for events, shops and staff', $t$Our promotional bags range from cotton and canvas tote bags to rucksacks, drawstring bags, cooler bags, laptop bags and paper gift bags, all printed with your logo. Recycled cotton and recycled plastic options are included.

Tote bags work well as giveaways at exhibitions, conferences and events, and as branded carrier bags for shops, farm shops and wineries. Rucksacks and laptop bags suit staff welcome packs and client gifts. Orders start from 25 units, and most bags cost under £10 each at volume.$t$),

('cups', 'Promotional mugs and cups', $t$Choose from ceramic mugs, stainless steel and plastic travel mugs, tumblers and reusable coffee cups, printed with your logo. Some mugs can be printed in full colour, and our Chi Cup is printed all the way round.

A branded mug keeps your name on a client's or colleague's desk every day, and reusable cups suit cafés, offices and sustainability campaigns. Orders start from 25 units, and almost every cup costs under £10 each at volume.$t$),

('water-bottles', 'Promotional water bottles and flasks', $t$Our branded water bottles include stainless steel and insulated bottles and flasks, recycled and plastic sports bottles, foldable bottles and glass bottles. Our own Water Bottle is printed all the way round; it has a 1,000-unit minimum and a 4–8 week lead time.

Water bottles suit gyms, sports clubs, schools, events and office teams, and a reusable bottle fits naturally into a sustainability campaign. Most bottles start from 25 units and cost under £10 each at volume.$t$),

('clothing', 'Branded clothing and workwear', $t$Put your logo on T-shirts, polo shirts, sweatshirts, hoodies, softshell and waterproof jackets, fleeces, bodywarmers, caps, beanies and aprons. Kids' and women's fits are available on selected styles, along with organic and recycled fabrics.

Branded clothing is everyday uniform for hospitality, trades, retail and facilities teams, and crew wear for events, clubs and schools. Some styles start from 10 units.$t$),

('hi-vis', 'Branded hi vis vests', $t$Our hi vis range includes vests printed with your logo, among them an EN ISO 20471-compliant waistcoat in fluorescent yellow and orange, plus a reflective hi vis drawstring bag.

Branded hi vis is standard kit for construction crews, warehouse and logistics teams and event marshals, and keeps your name visible on site. Orders start from 10 units.$t$),

('cables', 'Promotional charging cables', $t$Our branded charging cables charge Apple, Android and USB-C devices from a single cable. The range includes Xoopar's multi-tip cables (Ocean Octopus, Octopus Mini, Mr Bio and Mr Bio PD Long), several made from recycled plastic, plus keyring, reel and lanyard chargers.

Charging cables are useful, low-cost tech gifts for conference delegates, sales teams and clients who travel. Orders start from 25 units, and every cable costs under £10 each at volume.$t$),

('power', 'Promotional power banks and chargers', $t$Choose from branded power banks, including magnetic wireless models, wireless charging pads and stands, and the Xoopar Luggie world travel adapter for over 150 countries. Several are made with recycled plastic.

Power banks and chargers make practical client gifts, incentive rewards and kit for staff who travel. Orders start from 25 units.$t$),

('speakers', 'Branded speakers and earbuds', $t$Our audio range includes Bluetooth speakers, among them desk and light-up styles, plus wireless earbuds and wireless headphones, all printed with your logo.

Branded audio makes a memorable gift for clients and staff, and suits technology companies and incentive schemes. Orders start from 25 units.$t$),

('pens', 'Promotional pens and pencils', $t$Our promotional pens include plastic and metal ballpoints, premium pens and rollerballs, recycled plastic pens, and pens made from bamboo, wheat and card, plus pencils and colouring sets, all printed with your logo.

Pens are the classic giveaway for conferences, exhibitions, mailshots and reception desks, and premium metal pens suit client gifts in professional services. Orders start from 25 units, and most pens cost under £1 each at volume.$t$),

('notebooks', 'Branded notebooks and stationery', $t$Our notebooks come in A4, A5 and A6 sizes with PU, recycled, cork and stone-paper covers, many with elastic closures and pen loops, plus notebook-and-pen sets in matching colours.

Notebooks are a staple of conference delegate packs, staff welcome packs and client meetings. Orders start from 25 units, and every notebook costs under £10 each at volume.$t$),

('tea-towels', 'Printed tea towels', $t$Our cotton tea towel is printed with your own design across the whole towel.

Printed tea towels suit gift shop and heritage retail, charity fundraising, and kitchen and guest use in hospitality. Orders start from 25 units.$t$)
  ) AS v(slug, h, t)
 WHERE c.slug = v.slug;

COMMIT;

-- Verify:
-- SELECT slug, intro_heading, length(intro) FROM catalog_categories ORDER BY sort_order;  -- 11 rows set
