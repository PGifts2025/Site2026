/**
 * fabricCanvasManager.js — supplier-agnostic Fabric.js helpers shared by
 * Designer-v1 (PGifts Direct) and Designer-v2 (Laltex).
 *
 * Designed to be additive: v1 can adopt helpers one at a time without
 * behavioural change. The race-condition hook mirrors v1's existing
 * inline pattern (pendingDesignData + designLoadedRef + a useEffect
 * guarded on print-areas-loaded) — see CLAUDE.md §8.1/§8.2/§8.3.
 *
 * Anything that couples to catalog_products shape, hex-overlay tinting,
 * or 3D preview lives in v1 and stays out of this module.
 */

import { useEffect } from 'react';
import jsPDF from 'jspdf';

/**
 * Identifiers used in Designer-v1 to mark non-user objects on the canvas.
 * v2 uses the same conventions so the save/load/export filters work
 * across both designers.
 */
export const NON_USER_OBJECT_IDS = Object.freeze([
  'template-image',
  'watermark',
  'printAreaOverlay',
]);

const NON_USER_OBJECT_ID_PREFIXES = Object.freeze([
  'print-area-guide-',
  'print-area-label-',
  'print-area-',
]);

/**
 * Test whether a Fabric object represents the customer's design content
 * (text, images, shapes they added) vs the chrome of the canvas
 * (template/background, print-area guides, watermark).
 *
 * Mirrors Designer-v1's inline filter at Designer.jsx ~4889. Pulled
 * out into a single source of truth so v1 and v2 can't diverge.
 */
export function isUserObject(obj) {
  if (!obj) return false;
  if (obj.isPrintAreaGuide) return false;
  if (obj.excludeFromExport) return false;
  if (obj.id) {
    if (NON_USER_OBJECT_IDS.includes(obj.id)) return false;
    for (const prefix of NON_USER_OBJECT_ID_PREFIXES) {
      if (obj.id.startsWith(prefix)) return false;
    }
  }
  if (obj.name) {
    if (obj.name === 'template-image') return false;
    if (obj.name.startsWith('print-area-')) return false;
  }
  return true;
}

/**
 * Capture a serialisable JSON snapshot of the canvas containing ONLY
 * user objects, preserving z-order. We don't actually remove anything
 * from the canvas — we build the JSON from the filtered list. v1 relies
 * on the canvas remaining intact while a save modal is open (canvas can
 * remount under the modal otherwise).
 *
 * @param {fabric.Canvas} canvas
 * @returns {object} Fabric JSON ready for canvas.loadFromJSON
 */
export function captureUserCanvasJSON(canvas) {
  if (!canvas) return null;
  const tracked = ['id', 'name', 'isPrintAreaGuide', 'excludeFromExport'];
  const baseJSON = canvas.toJSON(tracked);
  const userObjects = canvas.getObjects().filter(isUserObject);
  baseJSON.objects = userObjects.map((obj) => obj.toObject(tracked));
  return baseJSON;
}

/**
 * Capture a PNG thumbnail of the design. Hides chrome (guides /
 * watermark / overlay) but keeps the template image visible so the
 * thumbnail shows the design in product context. Restores visibility
 * after.
 *
 * @param {fabric.Canvas} canvas
 * @param {object} [opts]
 * @param {number} [opts.multiplier=1.5]
 * @returns {string|null} dataURL or null if no canvas
 */
export function captureCanvasThumbnail(canvas, { multiplier = 1.5 } = {}) {
  if (!canvas) return null;
  const allObjects = canvas.getObjects();
  // Hide things that look like chrome BUT NOT the template image —
  // matches v1's thumbnail behaviour.
  const toHide = allObjects.filter((obj) => {
    if (obj.id === 'template-image' || obj.name === 'template-image') return false;
    return !isUserObject(obj);
  });
  toHide.forEach((obj) => { obj.visible = false; });
  const prevBg = canvas.backgroundColor;
  canvas.backgroundColor = 'transparent';
  canvas.renderAll();
  const dataURL = canvas.toDataURL({ format: 'png', quality: 1, multiplier });
  toHide.forEach((obj) => { obj.visible = true; });
  canvas.backgroundColor = prevBg;
  canvas.renderAll();
  return dataURL;
}

/**
 * Export the canvas as PNG (download). Multiplier 3 is load-bearing
 * for print quality — see CLAUDE.md §8.4. Print-area overlays and
 * watermark are hidden during the export and restored after.
 *
 * @param {fabric.Canvas} canvas
 * @param {object} opts
 * @param {string} opts.filename - download filename without extension
 * @param {boolean} [opts.hideWatermark=true]
 * @param {number} [opts.multiplier=3]
 */
export function exportCanvasAsPNG(canvas, { filename, hideWatermark = true, multiplier = 3 }) {
  if (!canvas) return;
  const overlay = canvas.getObjects().find((obj) => obj.id === 'printAreaOverlay');
  const watermark = canvas.getObjects().find((obj) => obj.id === 'watermark');
  const overlayWasVisible = overlay?.visible;
  const watermarkWasVisible = watermark?.visible;
  if (overlay) overlay.set('visible', false);
  if (watermark && hideWatermark) watermark.set('visible', false);
  canvas.renderAll();

  try {
    const dataURL = canvas.toDataURL({ format: 'png', quality: 1, multiplier });
    const link = document.createElement('a');
    link.download = `${filename}.png`;
    link.href = dataURL;
    link.click();
  } catch (err) {
    // Tainted-canvas SecurityError: cross-origin background image
    // (e.g. Laltex CDN without CORS headers) blocks pixel readback.
    // Surface a user-readable error rather than a stack trace; v1 paths
    // (PGifts Direct images served from same-origin Supabase Storage)
    // never hit this.
    console.error('[exportCanvasAsPNG] toDataURL failed:', err);
    throw new Error(
      'PNG export is temporarily unavailable for this product (image security). The team has been notified.',
    );
  } finally {
    if (overlay) overlay.set('visible', overlayWasVisible !== false);
    if (watermark) watermark.set('visible', watermarkWasVisible !== false);
    canvas.renderAll();
  }
}

/**
 * Export the canvas as PDF (download). Same chrome-hiding behaviour
 * as PNG export. Uses A4 portrait with the canvas image placed in a
 * 190mm square — matches v1.
 *
 * @param {fabric.Canvas} canvas
 * @param {object} opts
 * @param {string} opts.filename - download filename without extension
 * @param {boolean} [opts.hideWatermark=true]
 * @param {number} [opts.multiplier=3]
 */
export function exportCanvasAsPDF(canvas, { filename, hideWatermark = true, multiplier = 3 }) {
  if (!canvas) return;
  const overlay = canvas.getObjects().find((obj) => obj.id === 'printAreaOverlay');
  const watermark = canvas.getObjects().find((obj) => obj.id === 'watermark');
  const overlayWasVisible = overlay?.visible;
  const watermarkWasVisible = watermark?.visible;
  if (overlay) overlay.set('visible', false);
  if (watermark && hideWatermark) watermark.set('visible', false);
  canvas.renderAll();

  try {
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const imgData = canvas.toDataURL({ format: 'png', quality: 1, multiplier });
    pdf.addImage(imgData, 'PNG', 10, 10, 190, 190);
    pdf.save(`${filename}.pdf`);
  } catch (err) {
    // Same tainted-canvas concern as exportCanvasAsPNG.
    console.error('[exportCanvasAsPDF] toDataURL failed:', err);
    throw new Error(
      'PDF export is temporarily unavailable for this product (image security). The team has been notified.',
    );
  } finally {
    if (overlay) overlay.set('visible', overlayWasVisible !== false);
    if (watermark) watermark.set('visible', watermarkWasVisible !== false);
    canvas.renderAll();
  }
}

/**
 * Race-condition guard for restoring a saved design when the user
 * arrives at the Designer with `?design=<id>` or otherwise pre-loads
 * a saved design.
 *
 * The bug this prevents (CLAUDE.md §8.1):
 *   Canvas mounts → setCanvas(c) → useEffect to apply design fires →
 *   canvas.loadFromJSON runs BEFORE the print-area / template-image
 *   load completes → restored design objects are placed at coordinates
 *   that haven't been recomputed for the current view → ghost objects.
 *
 * The fix:
 *   1. When a saved design arrives, write its `design_data` into the
 *      `pendingDesignData` STATE (not a ref — state guarantees a
 *      re-render).
 *   2. Defer canvas.loadFromJSON until ALL of: canvas ready, print
 *      areas loaded, print-areas array non-empty.
 *   3. Once applied, set `designLoadedRef.current = true` so other
 *      effects (template reload, colour change) skip their reset paths
 *      and the restored objects survive.
 *
 * Caller passes its existing state setters / refs in — this hook
 * doesn't own them, it just wires the deferred-apply effect.
 *
 * @param {object} args
 * @param {fabric.Canvas|null} args.canvas
 * @param {React.RefObject<boolean>} args.canvasReadyRef
 * @param {boolean} args.printAreasLoaded
 * @param {Array} args.printAreas
 * @param {object|null} args.pendingDesignData
 * @param {(v: object|null) => void} args.setPendingDesignData
 * @param {React.RefObject<boolean>} args.designLoadedRef
 * @param {(result: 'success'|'error') => void} [args.onApplied]
 */
export function useDeferredDesignApply({
  canvas,
  canvasReadyRef,
  printAreasLoaded,
  printAreas,
  pendingDesignData,
  setPendingDesignData,
  designLoadedRef,
  onApplied,
}) {
  useEffect(() => {
    if (pendingDesignData === null) return;
    if (!canvas || !canvasReadyRef?.current) return;
    if (!printAreasLoaded || !printAreas || printAreas.length === 0) return;

    const designData = pendingDesignData;
    setPendingDesignData(null);

    try {
      canvas.loadFromJSON(designData, () => {
        canvas.renderAll();
        if (designLoadedRef) designLoadedRef.current = true;
        onApplied?.('success');
      });
    } catch (err) {
      // Surface but don't propagate — the deferred apply should never
      // crash the page. The design just stays unrestored.
      console.error('[fabricCanvasManager] loadFromJSON failed:', err?.message);
      onApplied?.('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDesignData, printAreasLoaded, printAreas, canvas]);
}

/**
 * Translate a Laltex print-area coordinate set (in the source image's
 * native pixel space) into canvas coordinates. Laltex returns
 * coordinates as already-parsed numerics (CLAUDE.md §26.5) — no string
 * "267.500px" parsing here.
 *
 * @param {{x:number,y:number,width:number,height:number}} laltexCoord
 * @param {number} sourceWidth  - natural width of the source variant image
 * @param {number} sourceHeight - natural height of the source variant image
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @returns {{x:number,y:number,width:number,height:number,scale:number}}
 */
export function translateLaltexCoord(laltexCoord, sourceWidth, sourceHeight, canvasWidth, canvasHeight) {
  // Preserve aspect ratio — use the SMALLER of the two scale factors
  // so the image fits inside the canvas in both dimensions.
  const scaleX = canvasWidth / sourceWidth;
  const scaleY = canvasHeight / sourceHeight;
  const scale = Math.min(scaleX, scaleY);
  // Centre the image on the canvas: if the image's scaled dimension
  // is smaller than the canvas dimension on one axis, the print-area
  // origin shifts by half of the empty band.
  const imgRenderedW = sourceWidth * scale;
  const imgRenderedH = sourceHeight * scale;
  const offsetX = (canvasWidth - imgRenderedW) / 2;
  const offsetY = (canvasHeight - imgRenderedH) / 2;
  return {
    x: laltexCoord.x * scale + offsetX,
    y: laltexCoord.y * scale + offsetY,
    width: laltexCoord.width * scale,
    height: laltexCoord.height * scale,
    scale,
  };
}
