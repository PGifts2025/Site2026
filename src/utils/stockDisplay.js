/**
 * Read-time helpers for presenting Laltex live stock on the product page.
 *
 * The data model (from supplier_products.stock, joined onto colours/sizes in
 * productCatalogService.normaliseProduct):
 *
 *   per-size / per-variant entry: { free: number|null, mto: boolean, dueIns: [{qty, eta}] }
 *     free > 0  -> in stock (that many)
 *     free === 0 -> out of stock now (dueIns may carry an ETA)
 *     mto === true (free === -1) -> Made To Order: available, longer lead time
 *     free === null / entry null -> NO stock signal (unknown)
 *
 * Guiding rules (audit-laltex-stock-availability.md §5, and the build brief):
 *   - FreeStock -1 is Made To Order, NEVER "out of stock".
 *   - Warn, don't hard-block. Only genuine zeros grey + disable a size.
 *   - Stale or missing stock is presented as "unknown", NOT as out of stock:
 *     when stock is stale/null the UI reverts to the pre-stock display.
 */

// Stock is refreshed hourly 07:00-24:00 UK, with an overnight pause. Data can
// therefore legitimately be up to ~8h old before the first morning run. We only
// treat stock as STALE (revert to the no-stock display) when it is older than
// this window, i.e. the cron has actually been failing for most of a day, not
// merely paused overnight. During the normal pause we keep showing last-known
// stock alongside an honest "checked Xh ago" note.
export const STOCK_STALE_HOURS = 18;
const STOCK_STALE_MS = STOCK_STALE_HOURS * 60 * 60 * 1000;

// At or below this free-stock figure a size shows a quiet "Low stock (N left)"
// note. Above it, an in-stock size shows nothing (deliberately quiet).
export const LOW_STOCK_THRESHOLD = 20;

/**
 * Is the product's stock snapshot fresh enough to display?
 * Returns false for null/invalid timestamps or anything older than the window.
 * `now` is injectable for tests.
 */
export function isStockFresh(checkedAt, now = Date.now()) {
  if (!checkedAt) return false;
  const t = new Date(checkedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return (now - t) <= STOCK_STALE_MS;
}

/**
 * Classify a single size/variant stock entry.
 * @returns {{state:'in'|'low'|'out'|'mto'|'unknown', free:number|null, dueIns:Array}}
 */
export function sizeStockState(entry) {
  if (!entry || typeof entry !== 'object') {
    return { state: 'unknown', free: null, dueIns: [] };
  }
  const dueIns = Array.isArray(entry.dueIns) ? entry.dueIns : [];
  if (entry.mto === true || entry.free === -1) {
    return { state: 'mto', free: entry.free ?? -1, dueIns };
  }
  const free = Number.isFinite(Number(entry.free)) ? Number(entry.free) : null;
  if (free === null) return { state: 'unknown', free: null, dueIns };
  if (free <= 0) return { state: 'out', free: 0, dueIns };
  if (free <= LOW_STOCK_THRESHOLD) return { state: 'low', free, dueIns };
  return { state: 'in', free, dueIns };
}

/**
 * Should the colour tile be greyed? Only when we have real stock signal for
 * EVERY available size AND every one is a genuine zero AND none is Made To
 * Order. Any unknown size, any MTO, or any positive stock -> not greyed. This
 * deliberately never greys a colour on partial/absent data.
 *
 * @param {object} colour           normalised colour ({ sizeStock, stock })
 * @param {string[]} availableSizes  size names available in this colour
 * @param {boolean} fresh            whether the snapshot is fresh
 */
export function isColourSoldOut(colour, availableSizes, fresh) {
  if (!fresh || !colour) return false;

  // Multi-size clothing: judge across the colour's available sizes.
  if (Array.isArray(availableSizes) && availableSizes.length > 0) {
    const sizeStock = colour.sizeStock || {};
    let sawData = false;
    for (const name of availableSizes) {
      const st = sizeStockState(sizeStock[name]);
      if (st.state === 'unknown') return false; // incomplete data -> don't grey
      if (st.state !== 'out') return false;      // any in/low/mto -> available
      sawData = true;
    }
    return sawData;
  }

  // Single-variant (non-clothing): judge the colour-level entry.
  const st = sizeStockState(colour.stock);
  return st.state === 'out';
}

/**
 * True when a requested quantity exceeds the free stock for a size (a warn, not
 * a block). MTO and unknown never warn (no finite ceiling to exceed).
 */
export function exceedsStock(entry, qty) {
  const st = sizeStockState(entry);
  if (st.state === 'in' || st.state === 'low' || st.state === 'out') {
    return Number(qty) > st.free;
  }
  return false;
}

/**
 * Short relative-age string for the freshness note, e.g. "just now",
 * "23 minutes ago", "3 hours ago", "yesterday".
 */
export function formatCheckedAgo(checkedAt, now = Date.now()) {
  if (!checkedAt) return null;
  const t = new Date(checkedAt).getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * Human ETA for a DueIns date, e.g. "12 Aug". Returns null on bad input.
 */
export function formatEta(eta) {
  if (!eta) return null;
  const d = new Date(eta);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Earliest "more due" line for an out-of-stock size, or null. Picks the
 * soonest ETA among dueIns entries that carry a date.
 */
export function nextDueLine(dueIns) {
  if (!Array.isArray(dueIns) || dueIns.length === 0) return null;
  const dated = dueIns
    .filter((d) => d?.eta && Number.isFinite(new Date(d.eta).getTime()))
    .sort((a, b) => new Date(a.eta) - new Date(b.eta));
  if (dated.length === 0) return null;
  const soon = dated[0];
  const when = formatEta(soon.eta);
  return when ? `More due ~${when}` : null;
}
