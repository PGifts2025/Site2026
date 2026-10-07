/**
 * category-images.js — verified card images + thumbnails for curated category
 * products (category_product_curation). CLAUDE.md §65.8.
 *
 * For each curated product it:
 *   1. builds the candidate image list in the same order CategoryPage shows
 *      them (colour plain images, colour images, product images);
 *   2. skips it when nothing changed since the last check (candidate-list
 *      hash unchanged, thumbnail present, checked < RECHECK_DAYS ago);
 *   3. otherwise HEAD-checks candidates server-side (Laltex answers missing
 *      images slowly, ~20 s, so this can't be left to the browser) and keeps
 *      the first that returns an image;
 *   4. writes a ~480px WebP thumbnail to the public `category-thumbs` bucket
 *      (originals are 2000×2000, up to 1.2 MB).
 * Products with no working image get card_image_url = NULL and are hidden.
 *
 * Runs nightly inside api/cron/sync-catalog-mirror.js (after the 03:00 Laltex
 * sync), with a time budget; whatever doesn't fit carries over to the next
 * night. Manual: node scripts/check-curated-images.mjs [--all] [--dry-run].
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const BUCKET = 'category-thumbs';
const THUMB_PX = 480; // card image area is ~230 CSS px; 2× for high-DPI screens
const WEBP_QUALITY = 72;
const HEAD_TIMEOUT_MS = 8000;
const GET_TIMEOUT_MS = 20000;
const RECHECK_DAYS = 30;
const CONCURRENCY = 6;

const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Candidate image URLs — same order as productCatalogService.normaliseProduct + CategoryPage. */
export function imageCandidates(row) {
  const byColour = new Map();
  (row?.items || []).forEach((it, idx) => {
    const key = String(it.item_colour || it.ItemColour || `Colour ${idx + 1}`).toLowerCase().trim();
    if (!byColour.has(key)) byColour.set(key, { images: [], plain: [] });
    const c = byColour.get(key);
    if (!c.images.length) c.images = (it.item_images || it.ItemImages || []).filter(Boolean);
    if (!c.plain.length) c.plain = (it.plain_images || it.PlainImages || []).filter(Boolean);
  });
  const urls = [
    ...[...byColour.values()].flatMap((c) => [...c.plain, ...c.images]),
    ...(Array.isArray(row?.images) ? row.images : []),
  ].map((u) => (typeof u === 'string' ? u : u?.url)).filter(Boolean);
  return [...new Set(urls)];
}

async function withTimeout(ms, fn) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fn(ctrl.signal); } finally { clearTimeout(t); }
}

const encode = (url) => encodeURI(decodeURI(url));

async function imageWorks(url) {
  try {
    return await withTimeout(HEAD_TIMEOUT_MS, async (signal) => {
      const r = await fetch(encode(url), { method: 'HEAD', signal });
      return r.status === 200 && String(r.headers.get('content-type') || '').startsWith('image/');
    });
  } catch {
    return false;
  }
}

async function makeThumb(url) {
  const buf = await withTimeout(GET_TIMEOUT_MS, async (signal) => {
    const r = await fetch(encode(url), { signal });
    if (!r.ok) throw new Error(`GET ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  });
  return sharp(buf)
    .rotate()
    .resize(THUMB_PX, THUMB_PX, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

function makeRest(supabaseUrl, serviceRoleKey) {
  const H = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
  return {
    async json(method, pathAndQuery, body, extra = {}) {
      const r = await fetch(`${supabaseUrl}/rest/v1/${pathAndQuery}`, {
        method, headers: { ...H, 'Content-Type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`${method} ${pathAndQuery.split('?')[0]} -> ${r.status}: ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    },
    async upload(objectPath, bytes) {
      const r = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${objectPath}`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'image/webp', 'x-upsert': 'true', 'cache-control': 'max-age=31536000' },
        body: bytes,
      });
      if (!r.ok) throw new Error(`upload ${objectPath} -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${objectPath}`;
    },
  };
}

/**
 * @param {object} o
 * @param {string} o.supabaseUrl
 * @param {string} o.serviceRoleKey
 * @param {number} [o.timeBudgetMs]  stop starting new products after this (default: no limit)
 * @param {boolean} [o.force]        re-check every product
 * @param {boolean} [o.dryRun]       report only, no uploads or writes
 * @param {(msg: string) => void} [o.log]
 */
export async function processCategoryImages({ supabaseUrl, serviceRoleKey, timeBudgetMs = Infinity, force = false, dryRun = false, log = () => {} }) {
  if (!supabaseUrl || !serviceRoleKey) throw new Error('supabaseUrl and serviceRoleKey are required');
  const started = Date.now();
  const rest = makeRest(supabaseUrl, serviceRoleKey);

  const curation = await rest.json('GET',
    'category_product_curation?select=id,category_slug,supplier_product_code,position,card_image_url,card_image_checked_at,card_thumb_url,card_image_source_hash&order=id.asc&limit=10000');
  const codes = [...new Set(curation.map((c) => c.supplier_product_code))];
  const products = new Map();
  for (let i = 0; i < codes.length; i += 150) {
    const list = codes.slice(i, i + 150).map((c) => `"${c.replace(/"/g, '\\"')}"`).join(',');
    const rows = await rest.json('GET', `supplier_products?select=supplier_product_code,items,images&supplier_product_code=in.(${encodeURIComponent(list)})`);
    rows.forEach((r) => products.set(r.supplier_product_code, r));
  }

  // One unit of work per product code (a product can be curated on several pages).
  const staleBefore = Date.now() - RECHECK_DAYS * 86400000;
  const byCode = new Map();
  for (const row of curation) {
    const cands = imageCandidates(products.get(row.supplier_product_code));
    const hash = sha(JSON.stringify(cands)).slice(0, 16);
    const needs = force
      || !row.card_image_checked_at
      || row.card_image_source_hash !== hash
      || new Date(row.card_image_checked_at).getTime() < staleBefore
      || (row.card_image_url && !row.card_thumb_url);
    if (!byCode.has(row.supplier_product_code)) byCode.set(row.supplier_product_code, { cands, hash, rows: [], needs: false });
    const unit = byCode.get(row.supplier_product_code);
    unit.rows.push(row);
    unit.needs = unit.needs || needs;
  }
  const work = [...byCode.entries()].filter(([, u]) => u.needs);

  const summary = { curatedRows: curation.length, products: byCode.size, needingWork: work.length, processed: 0, deferred: 0,
    firstImageOk: 0, fixedWithLaterImage: 0, noWorkingImage: 0, thumbsMade: 0, thumbsReused: 0, errors: [] };
  const updates = [];
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < work.length) {
      if (Date.now() - started > timeBudgetMs) { summary.deferred = work.length - next; next = work.length; break; }
      const [code, unit] = work[next++];
      const prev = unit.rows[0];
      let chosen = null;
      for (const u of unit.cands) { if (await imageWorks(u)) { chosen = u; break; } }
      let thumbUrl = null;
      if (!chosen) summary.noWorkingImage += 1;
      else {
        if (chosen === unit.cands[0]) summary.firstImageOk += 1; else summary.fixedWithLaterImage += 1;
        const version = sha(chosen).slice(0, 10);
        const objectPath = `${code.replace(/[^A-Za-z0-9._-]/g, '_')}.webp`;
        const reusable = prev.card_thumb_url && prev.card_image_url === chosen && prev.card_thumb_url.includes(`?v=${version}`);
        if (reusable) { thumbUrl = prev.card_thumb_url; summary.thumbsReused += 1; }
        else if (!dryRun) {
          try {
            const bytes = await makeThumb(chosen);
            thumbUrl = `${await rest.upload(objectPath, bytes)}?v=${version}`;
            summary.thumbsMade += 1;
          } catch (err) {
            summary.errors.push(`${code}: ${err.message}`); // card falls back to the original image
          }
        }
      }
      const checkedAt = new Date().toISOString();
      for (const r of unit.rows) {
        updates.push({ id: r.id, category_slug: r.category_slug, supplier_product_code: r.supplier_product_code, position: r.position,
          card_image_url: chosen, card_thumb_url: thumbUrl, card_image_source_hash: unit.hash, card_image_checked_at: checkedAt });
      }
      summary.processed += 1;
    }
  }));

  if (!dryRun && updates.length) {
    for (let i = 0; i < updates.length; i += 200) {
      await rest.json('POST', 'category_product_curation?on_conflict=id', updates.slice(i, i + 200), { Prefer: 'resolution=merge-duplicates,return=minimal' });
    }
  }
  summary.ms = Date.now() - started;
  log(`category images: ${summary.processed}/${summary.needingWork} products processed (${summary.deferred} deferred), `
    + `thumbs made ${summary.thumbsMade}, reused ${summary.thumbsReused}, fixed ${summary.fixedWithLaterImage}, `
    + `no image ${summary.noWorkingImage}, errors ${summary.errors.length}, ${summary.ms} ms`);
  return summary;
}
