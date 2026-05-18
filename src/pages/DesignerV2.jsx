/**
 * DesignerV2 — the Designer for Laltex products (session 7).
 *
 * Architecture decisions baked in (session 7 spec):
 *   - Visually identical to Designer-v1 from the customer's perspective
 *   - Image-swap on colour change (NO hex overlay tinting like v1)
 *   - No 3D preview path (chi-cup / water-bottle stay in v1)
 *   - One Fabric canvas at 800x800; coordinates translated from each
 *     position+colour's source image native pixel space
 *   - Per-colour coordinate sets supported (Laltex returns separate
 *     coordinates per colour for left/right-handed variants)
 *   - Uses the supplier-agnostic helpers in utils/fabricCanvasManager.js
 *     for save snapshot, export, and the deferred-design-apply race
 *     guard (CLAUDE.md §8.1)
 *
 * Lifecycle:
 *   1. Mount → init Fabric canvas (800x800, background #f8f9fa)
 *   2. Load product by code via getProductByIdentifier (catalog-first,
 *      supplier-fallthrough — session 6); error out if not found
 *   3. Normalise positions / colours; pick default position
 *      (defaultOption flag, else first) and default colour
 *   4. Whenever position OR colour OR canvas changes: load the
 *      variant image, compute scale, place template image + print
 *      area overlay
 *   5. If ?design=<id> query param: pre-load the saved design,
 *      defer canvas.loadFromJSON until print-area overlay is ready
 *      (race guard from CLAUDE.md §8.1)
 *
 * Save / load (column reference — see CLAUDE.md §40 for the full schema):
 *   - user_designs.design_data: JSONB (Fabric serialisation, user
 *     objects only — chrome is excluded by captureUserCanvasJSON)
 *   - user_designs.supplier_product_code: text (added migration 20260512).
 *     v2's product reference. v1 designs leave this NULL and use
 *     product_id / product_key instead.
 *   - user_designs.print_area: text — position name (e.g. "Wrap", "Front")
 *   - user_designs.user_id OR session_id: existing v1 contract
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { fabric } from 'fabric';
import {
  ChevronLeft,
  Save,
  FileImage,
  FileText,
  Type,
  Upload,
  Trash2,
  LogIn,
  Loader,
  AlertCircle,
  Plus,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import AuthModal from '../components/auth/AuthModal';
import {
  supabase,
  getUserDesign,
  getUserDesigns,
  getSessionId,
} from '../services/supabaseService';
import { getProductByIdentifier } from '../services/productCatalogService';
import {
  exportCanvasAsPNG,
  exportCanvasAsPDF,
  captureUserCanvasJSON,
  captureCanvasThumbnail,
  useDeferredDesignApply,
  isUserObject,
} from '../utils/fabricCanvasManager';
import { prettyPrintArea } from '../utils/printAreaFormat';

const CANVAS_SIZE = 800;

// Object IDs follow v1's conventions so fabricCanvasManager's filters
// (isUserObject, captureUserCanvasJSON) recognise them as chrome.
const TEMPLATE_IMAGE_ID = 'template-image';
const PRINT_AREA_OVERLAY_ID = 'printAreaOverlay';

// Hosts whose images must be loaded via /api/proxy-image so the canvas
// stays un-tainted on Fabric draw. The proxy adds CORS headers; without
// that, canvas.toDataURL() throws SecurityError on PNG/PDF export.
// Mirrors the server-side ALLOWED_HOSTS in api/proxy-image.js — CLAUDE.md §39.
const PROXIED_IMAGE_HOSTS = new Set([
  'laltex-extranet.co.uk',
]);

function resolveImageUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl, window.location.origin);
    if (PROXIED_IMAGE_HOSTS.has(parsed.hostname.toLowerCase())) {
      return {
        url: `/api/proxy-image?url=${encodeURIComponent(rawUrl)}`,
        crossOrigin: 'anonymous',
      };
    }
  } catch {
    // Fall through to raw passthrough.
  }
  return { url: encodeURI(rawUrl), crossOrigin: undefined };
}

const DesignerV2 = () => {
  const { productCode } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // -------- Refs --------
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null); // holds the Fabric.Canvas wrapper
  const canvasReadyRef = useRef(false);
  const designLoadedRef = useRef(false);
  // Guards image loads against React Strict Mode double-mounts.
  const imageLoadTokenRef = useRef(0);
  // Tracks the design id we've already fetched for restore so the
  // pre-load effect doesn't issue a second getUserDesign call when
  // `product` is re-derived (CLAUDE.md §40.5).
  const designFetchedRef = useRef(null);

  // -------- Data state --------
  const [product, setProduct] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  // -------- Canvas state --------
  const [canvas, setCanvas] = useState(null);
  const [pendingDesignData, setPendingDesignData] = useState(null);
  const [printAreasLoaded, setPrintAreasLoaded] = useState(false);

  // -------- Selection state --------
  // Position picks are keyed by unique position name (post-§43 model).
  // `activePositionName` is which tab is currently shown on the canvas;
  // `activeRowByPosition` records which sibling row inside each
  // position is the customer's choice (size/method).
  const [activePositionName, setActivePositionName] = useState(null);
  const [activeRowByPosition, setActiveRowByPosition] = useState({});
  const [selectedColourId, setSelectedColourId] = useState(null);

  // -------- Preview-quality state --------
  // Fix #1 (Bug A): true when the canvas shows the catalogue thumb because
  // the active position's print_area_coordinates has no entry for the
  // selected colour. No print rectangle is drawn in that case; a small
  // notice tells the customer their print will still be produced.
  const [colourPreviewUnavailable, setColourPreviewUnavailable] = useState(false);

  // -------- Edit UI state --------
  const [selectedObject, setSelectedObject] = useState(null);
  const [textInput, setTextInput] = useState('');

  // -------- Save state --------
  const [currentDesignId, setCurrentDesignId] = useState(null);
  const [savedDesigns, setSavedDesigns] = useState([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showMyDesigns, setShowMyDesigns] = useState(false);
  const [designName, setDesignName] = useState('');
  const [saveStatus, setSaveStatus] = useState(null);
  const [savingDesign, setSavingDesign] = useState(false);

  // -------- Auth gate (reused pattern from session 6) --------
  const [authOpen, setAuthOpen] = useState(false);
  const [authPurpose, setAuthPurpose] = useState(null); // 'save' | 'png' | 'pdf' | null

  // ---------------------------------------------------------------------
  // 1. Load product
  // ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!productCode) {
        setLoadError('No product code provided');
        setLoading(false);
        return;
      }
      try {
        const resolved = await getProductByIdentifier(productCode);
        if (cancelled) return;
        if (!resolved) {
          setLoadError(`Product "${productCode}" not found.`);
          setLoading(false);
          return;
        }
        // v2 is for Laltex (supplier rows). If a PGifts Direct catalog
        // row resolves, redirect to v1's existing route — that's where
        // its 3D / hex overlay path lives.
        if (resolved.source === 'catalog') {
          const slug = resolved.raw?.slug;
          // v1 is currently slug-based; keep the user on v1 land.
          navigate(`/designer?product=${encodeURIComponent(slug)}`, { replace: true });
          return;
        }
        setProduct(resolved.normalised);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('[DesignerV2] product load failed:', err);
        setLoadError(err?.message || 'Failed to load product');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [productCode, navigate]);

  // ---------------------------------------------------------------------
  // 2. Init Fabric canvas — via a callback ref so init fires when the
  //    <canvas> element actually attaches to the DOM, NOT on first
  //    render-commit.
  //
  //    Why this matters: the early-return guards above (loading,
  //    loadError) skip rendering the <canvas> element until product
  //    data arrives. A useEffect with [] deps fires once on first
  //    mount-commit, when canvasRef.current is still null — it then
  //    bails and never runs again, even after the canvas element
  //    later attaches. Callback refs don't have that timing trap.
  // ---------------------------------------------------------------------
  const handleCanvasRef = useCallback((canvasEl) => {
    // Element detaching → dispose Fabric wrapper, reset readiness.
    if (!canvasEl) {
      canvasReadyRef.current = false;
      if (fabricCanvasRef.current) {
        try { fabricCanvasRef.current.dispose(); } catch {}
        fabricCanvasRef.current = null;
        setCanvas(null);
      }
      canvasRef.current = null;
      return;
    }

    // Element attaching. Strict Mode may attach twice; guard.
    canvasRef.current = canvasEl;
    if (fabricCanvasRef.current) return;

    try {
      const fabricCanvas = new fabric.Canvas(canvasEl, {
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        backgroundColor: '#ffffff',
        selection: true,
      });
      fabricCanvasRef.current = fabricCanvas;
      canvasReadyRef.current = true;

      // Force Fabric's display geometry to scale to the parent card.
      // The fabric.Canvas constructor sets inline width/height on BOTH
      // the canvas element and the auto-injected .canvas-container
      // wrapper (`width: 800px; height: 800px`). When the parent column
      // is narrower than 800px (small viewports, or lg:col-span-6 of a
      // ~1024px container), those inline styles win over the JSX-side
      // maxWidth:100% and the right half of the canvas renders OUTSIDE
      // the card boundary - the bug that hid four rounds of correct
      // centring math behind an overflow-clip.
      //
      // Override after construction. Drawing buffer stays 800x800 (the
      // canvas attributes set the buffer, NOT these styles) so render
      // math and export resolution are unchanged. aspect-ratio:1/1 is
      // load-bearing: without it, width:100% + height:auto on a canvas
      // collapses to zero height. Fabric's pointer hit-testing reads
      // getBoundingClientRect() so the scaled display works for events.
      const wrapperEl = canvasEl.parentElement;
      const fitStyles = {
        maxWidth: '100%',
        width: '100%',
        height: 'auto',
        aspectRatio: '1 / 1',
      };
      Object.assign(canvasEl.style, fitStyles);
      if (wrapperEl && wrapperEl.classList.contains('canvas-container')) {
        Object.assign(wrapperEl.style, fitStyles);
        // The upper (interactive) canvas Fabric stacks for events also
        // needs the same treatment - it's a sibling of the lower one.
        const upperCanvas = wrapperEl.querySelector('canvas.upper-canvas');
        if (upperCanvas) Object.assign(upperCanvas.style, fitStyles);
      }

      const handleSelection = () => {
        setSelectedObject(fabricCanvas.getActiveObject());
      };
      fabricCanvas.on('selection:created', handleSelection);
      fabricCanvas.on('selection:updated', handleSelection);
      fabricCanvas.on('selection:cleared', () => setSelectedObject(null));

      // Push into state LAST so downstream effects (image load,
      // race-guard) see a fully-initialised canvas.
      setCanvas(fabricCanvas);
    } catch (err) {
      console.error('[DesignerV2] canvas init failed:', err);
    }
  }, []);

  // ---------------------------------------------------------------------
  // 3. Default position + colour when product loads
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!product) return;
    const groups = product.printDetails?.positionGroups || [];
    // Default position = group containing the default-flagged row;
    // fallback to the first group. Default row inside each group =
    // group.defaultRowIndex.
    const defaultGroupIdx = Math.max(
      0,
      groups.findIndex((g) => (g.rows || []).some((r) => r.defaultOption)),
    );
    const defaultGroup = groups[defaultGroupIdx];
    setActivePositionName(defaultGroup?.name || null);
    const initialRowByPosition = {};
    groups.forEach((g) => { initialRowByPosition[g.name] = g.defaultRowIndex; });
    setActiveRowByPosition(initialRowByPosition);
    const firstColour = product.colours?.[0]?.id || null;
    setSelectedColourId(firstColour);
  }, [product]);

  // ---------------------------------------------------------------------
  // 4. Pre-load saved design via ?design=<id>
  //    The actual canvas.loadFromJSON is deferred (race guard) until the
  //    template image + print-area overlay are placed.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!canvas || !product) return;
    const designId = searchParams.get('design');
    if (!designId) return;
    // Guard against double-fetch: the effect deps include `product`,
    // which is re-derived as a new object reference on parent
    // re-renders. Without this guard, getUserDesign fires twice for
    // the same id on a single mount (observed in production logs).
    if (designFetchedRef.current === designId) return;
    designFetchedRef.current = designId;
    let cancelled = false;
    (async () => {
      try {
        const design = await getUserDesign(designId);
        if (cancelled || !design) return;
        if (design.supplier_product_code && design.supplier_product_code !== product.code) {
          console.warn('[DesignerV2] saved design is for a different product, skipping pre-load');
          return;
        }
        setCurrentDesignId(design.id);
        setDesignName(design.design_name || '');
        // Restore colour from the saved supplier code (e.g. "MG0192CY")
        // BEFORE the image-load effect fires, so it loads the cup in
        // the correct colour rather than the default.
        if (design.color_code) {
          const match = (product.colours || []).find((c) => c.code === design.color_code);
          if (match) setSelectedColourId(match.id);
        }
        if (design.print_area) {
          // Composite format from session 9: "Position|Size|PrintClass".
          // Legacy v2 saves stored just the position name — match on
          // name only and warn so we can monitor leftover rows post-merge.
          const parts = String(design.print_area).split('|');
          const [savedName, savedArea, savedClass] = parts;
          const groups = product.printDetails?.positionGroups || [];
          const group = groups.find((g) => g.name === savedName);
          if (group) {
            setActivePositionName(group.name);
            if (parts.length === 1) {
              console.warn(
                `[DesignerV2] Restoring pre-multi-row v2 design — defaulting to first row for position "${savedName}"`,
              );
              setActiveRowByPosition((prev) => ({
                ...prev,
                [group.name]: group.defaultRowIndex,
              }));
            } else {
              // Exact-tuple match first (area + class), then loose match
              // by class alone, then fall back to default row.
              let rowIdx = group.rows.findIndex(
                (r) => r.area === savedArea && r.printClass === savedClass,
              );
              if (rowIdx < 0 && savedClass) {
                rowIdx = group.rows.findIndex((r) => r.printClass === savedClass);
              }
              if (rowIdx < 0) {
                console.warn(
                  `[DesignerV2] Saved design row (${savedArea}, ${savedClass}) not found for "${savedName}"; falling back to default`,
                );
                rowIdx = group.defaultRowIndex;
              }
              setActiveRowByPosition((prev) => ({ ...prev, [group.name]: rowIdx }));
            }
          }
        }
        if (design.design_data) {
          setPendingDesignData(design.design_data);
        }
      } catch (err) {
        // Allow a retry on real failure (network, etc).
        designFetchedRef.current = null;
        console.error('[DesignerV2] saved-design pre-load failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [canvas, product, searchParams]);

  // ---------------------------------------------------------------------
  // 5. Render template image + print-area overlay whenever
  //    (position, row, colour, canvas) changes.
  // ---------------------------------------------------------------------
  // Position group currently shown on the canvas.
  const activeGroup = useMemo(() => {
    if (!product || !activePositionName) return null;
    const groups = product.printDetails?.positionGroups || [];
    return groups.find((g) => g.name === activePositionName) || null;
  }, [product, activePositionName]);

  // Selected ROW inside the active group (the (size × method) variant).
  // This is what drives the canvas — coordinates, image, print rect.
  const activeRow = useMemo(() => {
    if (!activeGroup) return null;
    const rowIdx = activeRowByPosition[activeGroup.name] ?? activeGroup.defaultRowIndex;
    return activeGroup.rows[rowIdx] || activeGroup.rows[0] || null;
  }, [activeGroup, activeRowByPosition]);

  // Fix #2 (Bug B): detect the "single rect copied across every position"
  // pattern (CLAUDE.md §37, MG0192 et al). True means the data is honest
  // - rows across positions carry distinct (x,y,w,h). False means only
  // one position has a faithful image+rect pairing and the rest would
  // render the rect floating off the product.
  const positionsHaveDistinctRects = useMemo(() => {
    const groups = product?.printDetails?.positionGroups || [];
    if (groups.length <= 1) return true;
    const tuples = new Set();
    for (const g of groups) {
      // Use the default row's coordinates as the position's signature —
      // sibling rows within a group have different rects (one per size)
      // but that's expected; the distinct-rect check is about position
      // diversity, not size diversity.
      const r = g.rows[g.defaultRowIndex] || g.rows[0];
      for (const coord of (r?.coordinates || [])) {
        tuples.add(`${coord.x}|${coord.y}|${coord.width}|${coord.height}`);
      }
    }
    return tuples.size > 1;
  }, [product]);

  // When positionsHaveDistinctRects is false we lock the canvas to one
  // canonical position group regardless of the user's selection.
  //
  // Resolver (CLAUDE.md §50):
  //   1. Filter positionGroups to only those with at least one row
  //      carrying at least one PAC entry. Empty groups are eliminated
  //      from consideration entirely — they have no image+coordinate
  //      payload to drive the canvas.
  //   2. From the filtered list, pick by case-insensitive name in this
  //      priority order: Wrap, Front, Back, then any other group in
  //      the existing array order.
  //   3. If nothing passes the filter, return null. LaltexProductView's
  //      isDesignable conditional hides the Customize card when no PAC
  //      exists anywhere, so this null state shouldn't be reachable in
  //      practice — but it's the correct neutral default.
  //
  // Why this changes:
  //   The previous heuristic preferred "Wrap" unconditionally if a
  //   group named Wrap existed, even when Laltex shipped Wrap as an
  //   empty placeholder. For engraving-heavy drinkware (MG0660, etc.)
  //   the real PAC lives on Front, which got bypassed — leading to
  //   the marketing-mockup fallback image and no overlay. See the
  //   audit report for details.
  const canonicalGroupName = useMemo(() => {
    const groups = product?.printDetails?.positionGroups || [];
    if (groups.length === 0) return null;
    const groupHasPac = (g) => (g.rows || []).some(
      (r) => (r?.coordinates?.length || 0) > 0,
    );
    const usable = groups.filter(groupHasPac);
    if (usable.length === 0) return null;
    // Priority order — case-insensitive name match.
    const priority = ['wrap', 'front', 'back'];
    for (const target of priority) {
      const hit = usable.find((g) => (g.name || '').trim().toLowerCase() === target);
      if (hit) return hit.name;
    }
    // No priority name; preserve source order (first remaining group).
    return usable[0].name;
  }, [product]);

  // The row whose image+rect actually drives the canvas. Equals
  // activeRow for normal products; locked to the canonical group's
  // default row for the 12.6% single-rect-multi-position bucket.
  const renderPosition = useMemo(() => {
    if (!product) return null;
    if (positionsHaveDistinctRects) return activeRow;
    const groups = product.printDetails?.positionGroups || [];
    const canonicalGroup = groups.find((g) => g.name === canonicalGroupName);
    if (!canonicalGroup) return null;
    return canonicalGroup.rows[canonicalGroup.defaultRowIndex] || canonicalGroup.rows[0] || null;
  }, [product, activeRow, canonicalGroupName, positionsHaveDistinctRects]);

  const canonicalPositionName = canonicalGroupName;

  const selectedColour = useMemo(() => {
    if (!product) return null;
    return (product.colours || []).find((c) => c.id === selectedColourId) || null;
  }, [product, selectedColourId]);

  useEffect(() => {
    if (!canvas || !canvasReadyRef.current || !product || !renderPosition) return;

    // Step 1 — pick the right COORDINATE entry first. For Laltex products
    // the print_area_coordinates[].image_url is the photo Laltex MARKED
    // UP to define the print area (coords are in this image's native
    // pixel space). The items[].item_images[0] catalogue thumb is a
    // DIFFERENT image at different dimensions/crop and would put the
    // rectangle in the wrong place.
    //
    // Defensive fallback (CLAUDE.md §50): if no PAC entry matches the
    // selected colour name, fall back to allCoords[0] rather than null.
    // The rect coordinates are identical across colours within a single
    // position group — only the per-colour image varies slightly. With
    // the canvas locked to a populated position (post-Change-1), the
    // worst-case is a marginally-mismatched colour preview, which is
    // strictly better than dropping into the no-coord path where the
    // overlay disappears and the image fallback walks back to marketing
    // photos. Bug A from session 7 (Amber→Blue silent swap on MG0192's
    // Back) does NOT reappear because the previous null path is gone
    // entirely — there is no silent-swap-vs-no-preview decision left to
    // get wrong.
    const allCoords = renderPosition.coordinates || [];
    const exactColourMatch = selectedColour?.name
      ? allCoords.find((c) =>
          c.colour && c.colour.toLowerCase().trim() === selectedColour.name.toLowerCase().trim(),
        )
      : null;
    const colourCoord = exactColourMatch || allCoords[0] || null;

    // Step 2 — pick the BACKGROUND image.
    // - colourCoord present: use its image_url. Coords match this exact
    //   image's pixel space, so we can draw the print rect on top.
    // - colourCoord missing AND the position HAS coords for other
    //   colours: render the per-colour catalogue thumb so the customer
    //   sees their actual colour, and SUPPRESS the print rect (the
    //   coords would land in the wrong place against the thumb). Show
    //   a notice via `colourPreviewUnavailable`.
    // - Position has NO coords at all (PGifts Direct, etc.): render the
    //   per-colour thumb, no rect, no notice - this isn't a colour-
    //   mismatch failure, this product type never had print previews.
    const positionHasAnyCoords = allCoords.length > 0;
    const previewUnavailable = positionHasAnyCoords && !colourCoord;
    setColourPreviewUnavailable(previewUnavailable);

    // Image fallback chain (CLAUDE.md §50): prefer plain/unbranded
    // images over marketing images at every step.
    //
    //   1. colourCoord.image_url   — Laltex's plain PAC image, primary.
    //                                 Coords-aligned, never branded.
    //   2. selectedColour.plainImages[0] — clean unbranded product photo
    //                                       per Laltex API V1.7 docs.
    //   3. selectedColour.images[0]      — supplier marketing image
    //                                       (Items[].ItemImages[0]). MAY
    //                                       contain customer-mockup
    //                                       branding (BLACKBRIDGE bug).
    //                                       Last resort.
    //   4. product.images[0].url         — top-level marketing image,
    //                                       same risk profile as step 3.
    //
    // Note: there is no top-level `product.plainImages` on the
    // normalised product shape today; productCatalogService.normaliseProduct
    // only surfaces plain_images per-colour (selectedColour.plainImages).
    // If a future refactor adds product.plainImages, insert it between
    // steps 2 and 3 as a sensible additional clean fallback.
    const rawImageUrl =
      colourCoord?.image_url ||
      selectedColour?.plainImages?.[0] ||
      selectedColour?.images?.[0] ||
      product.images?.[0]?.url ||
      null;

    if (!rawImageUrl) {
      console.warn('[DesignerV2] no image available for current product/colour');
      return;
    }

    // Route third-party supplier URLs through /api/proxy-image so the
    // canvas stays un-tainted (CLAUDE.md §39). Non-proxied URLs fall
    // back to encodeURI for the raw-space workaround (CLAUDE.md §35).
    const { url: imageUrl, crossOrigin } = resolveImageUrl(rawImageUrl);

    // Token guards against effect re-runs racing each other (Strict
    // Mode, rapid colour clicks). A stale callback bails out without
    // touching the canvas.
    imageLoadTokenRef.current += 1;
    const myToken = imageLoadTokenRef.current;

    fabric.Image.fromURL(
      imageUrl,
      (img) => {
        if (myToken !== imageLoadTokenRef.current) return;
        if (!canvasReadyRef.current) return;
        if (!img || !img.width) {
          console.warn('[DesignerV2] image failed to load (img null or width=0):', { imageUrl, img });
          return;
        }

        // Native dimensions of the source image.
        const natW = img.width;
        const natH = img.height;
        const scale = Math.min(CANVAS_SIZE / natW, CANVAS_SIZE / natH);
        const renderedW = natW * scale;
        const renderedH = natH * scale;

        // Centring strategy:
        // - Rect-anchor (colourCoord present): align the print rectangle
        //   centre to the canvas centre. Laltex frames products in
        //   varying portions of their reference photos (MG0192's mug
        //   sits high; AF0001's apron is roughly central). Centring the
        //   image bounds put the mug body in the upper portion of the
        //   canvas because the source image had empty space at the
        //   bottom. Anchoring on the rect makes the actual print area
        //   - what the customer cares about - land at canvas centre.
        // - Image-bounds (colourCoord missing): the Fix #1 fallback
        //   path renders a per-colour catalogue thumb that has no
        //   matching rect to anchor on; centre the image bounds.
        let imageLeft;
        let imageTop;
        if (colourCoord) {
          const rectCx_src = Number(colourCoord.x) + Number(colourCoord.width) / 2;
          const rectCy_src = Number(colourCoord.y) + Number(colourCoord.height) / 2;
          imageLeft = CANVAS_SIZE / 2 - rectCx_src * scale;
          imageTop = CANVAS_SIZE / 2 - rectCy_src * scale;
          // Defensive clamp: if the image is narrower than the canvas
          // along an axis (Math.min(scale) leaves slack), don't let
          // the rect-anchor push the image off-canvas. For products
          // where renderedW or renderedH equals CANVAS_SIZE (the
          // limiting axis) the clamp is a no-op.
          if (renderedW < CANVAS_SIZE) {
            imageLeft = Math.max(0, Math.min(CANVAS_SIZE - renderedW, imageLeft));
          }
          if (renderedH < CANVAS_SIZE) {
            imageTop = Math.max(0, Math.min(CANVAS_SIZE - renderedH, imageTop));
          }
        } else {
          imageLeft = (CANVAS_SIZE - renderedW) / 2;
          imageTop = (CANVAS_SIZE - renderedH) / 2;
        }

        // Capture user objects BEFORE clearing chrome so we can restore
        // them on top of the new background. Position-aware behaviour
        // requested in the spec: text/upload stay at their canvas
        // positions across colour/position swaps.
        const allObjects = canvas.getObjects();
        const userObjects = allObjects.filter(isUserObject);
        // Remove chrome (template + overlay). User objects stay put.
        allObjects
          .filter((o) => o.id === TEMPLATE_IMAGE_ID || o.id === PRINT_AREA_OVERLAY_ID)
          .forEach((o) => canvas.remove(o));

        // Explicit origin — Fabric 5.3 defaults to 'left'/'top' but be
        // defensive: any inherited or future-default drift would shift
        // the image relative to its left/top coords. Pinning these
        // means renderedW × renderedH are the rendered dimensions
        // starting from (imageLeft, imageTop).
        img.set({
          id: TEMPLATE_IMAGE_ID,
          name: TEMPLATE_IMAGE_ID,
          originX: 'left',
          originY: 'top',
          left: imageLeft,
          top: imageTop,
          scaleX: scale,
          scaleY: scale,
          selectable: false,
          evented: false,
          hoverCursor: 'default',
          excludeFromExport: false,
        });
        canvas.add(img);
        canvas.sendToBack(img);

        // Print area overlay rectangle — only when we have a matching
        // coordinate entry (Fix #1: no rect on the catalogue-thumb
        // fallback path, since the coords were calculated against a
        // different image and would land in empty space). Coords use
        // the SAME imageLeft/imageTop offset as the image itself, so
        // any clamp that fired stays in lockstep.
        if (colourCoord) {
          const rectLeft = Number(colourCoord.x) * scale + imageLeft;
          const rectTop = Number(colourCoord.y) * scale + imageTop;
          const rectWidth = Number(colourCoord.width) * scale;
          const rectHeight = Number(colourCoord.height) * scale;
          const rect = new fabric.Rect({
            id: PRINT_AREA_OVERLAY_ID,
            name: PRINT_AREA_OVERLAY_ID,
            originX: 'left',
            originY: 'top',
            left: rectLeft,
            top: rectTop,
            width: rectWidth,
            height: rectHeight,
            fill: 'rgba(59, 130, 246, 0.08)',
            stroke: '#3b82f6',
            strokeDashArray: [6, 4],
            strokeWidth: 1.5,
            selectable: false,
            evented: false,
            hoverCursor: 'default',
            excludeFromExport: true,
          });
          canvas.add(rect);
        }

        // Re-establish user-object z-order on top of the new chrome.
        // canvas.add already pushes them, but explicit bringToFront
        // hardens the case where Fabric reorders during loadFromJSON.
        userObjects.forEach((obj) => canvas.bringToFront(obj));

        canvas.renderAll();
        setPrintAreasLoaded(true);
      },
      crossOrigin ? { crossOrigin } : undefined,
    );
  }, [canvas, product, renderPosition, selectedColour, activeRow, positionsHaveDistinctRects]);

  // ---------------------------------------------------------------------
  // 6. Race-condition guarded deferred-apply of saved design
  // ---------------------------------------------------------------------
  useDeferredDesignApply({
    canvas,
    canvasReadyRef,
    printAreasLoaded,
    printAreas: renderPosition ? [renderPosition] : [],
    pendingDesignData,
    setPendingDesignData,
    designLoadedRef,
  });

  // ---------------------------------------------------------------------
  // 7. Tool: add text
  // ---------------------------------------------------------------------
  const handleAddText = () => {
    if (!canvas) return;
    const text = new fabric.IText(textInput || 'Your text', {
      left: CANVAS_SIZE / 2 - 80,
      top: CANVAS_SIZE / 2 - 20,
      fontSize: 36,
      fill: '#1a1a1a',
      fontFamily: 'Arial',
      fontWeight: 'bold',
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
    setTextInput('');
  };

  // ---------------------------------------------------------------------
  // 8. Tool: upload image
  // ---------------------------------------------------------------------
  const fileInputRef = useRef(null);
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file || !canvas) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      fabric.Image.fromURL(ev.target.result, (img) => {
        // Scale to fit a reasonable portion of the canvas (max 300px)
        const maxDim = 300;
        const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
        img.set({
          left: CANVAS_SIZE / 2 - (img.width * scale) / 2,
          top: CANVAS_SIZE / 2 - (img.height * scale) / 2,
          scaleX: scale,
          scaleY: scale,
        });
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.renderAll();
      });
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // allow same file again
  };

  // ---------------------------------------------------------------------
  // 9. Delete selected
  // ---------------------------------------------------------------------
  const handleDeleteSelected = () => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj || !isUserObject(obj)) return;
    canvas.remove(obj);
    canvas.discardActiveObject();
    canvas.renderAll();
    setSelectedObject(null);
  };

  // ---------------------------------------------------------------------
  // 10. Save / load
  // ---------------------------------------------------------------------
  const runSaveDesign = async () => {
    if (!canvas || !product || !user) return;
    if (!designName.trim()) {
      alert('Please enter a design name');
      return;
    }
    setSavingDesign(true);
    setSaveStatus('saving');
    try {
      const designJSON = captureUserCanvasJSON(canvas);
      const thumbnail = captureCanvasThumbnail(canvas);
      // Column names verified against the live user_designs schema
      // (CLAUDE.md §40). v2 rows reference the product via
      // supplier_product_code; product_id / product_key (v1 references)
      // are left NULL. The legacy product_template_id / variant_id
      // columns DO NOT exist on this table — do not re-add them.
      // Composite print_area: "Position|Size|PrintClass" — preserves
      // the customer's (size × method) selection across reload.
      // CLAUDE.md §43. Legacy plain-text format ("Front Chest") still
      // restores via the fallback branch in the pre-load effect.
      const printAreaComposite = activeGroup && activeRow
        ? [activeGroup.name, activeRow.area || '', activeRow.printClass || ''].join('|')
        : null;
      const row = {
        user_id: user.id,
        session_id: null,
        design_name: designName.trim(),
        supplier_product_code: product.code,
        print_area: printAreaComposite,
        color_code: selectedColour?.code || null,
        color_name: selectedColour?.name || null,
        design_data: designJSON,
        thumbnail_url: thumbnail,
      };

      let saved;
      if (currentDesignId) {
        const { data, error } = await supabase
          .from('user_designs')
          .update(row)
          .eq('id', currentDesignId)
          .select()
          .single();
        if (error) throw error;
        saved = data;
      } else {
        const { data, error } = await supabase
          .from('user_designs')
          .insert(row)
          .select()
          .single();
        if (error) throw error;
        saved = data;
        setCurrentDesignId(saved.id);
      }
      setSaveStatus('saved');
      setShowSaveModal(false);
      setTimeout(() => setSaveStatus(null), 2000);
    } catch (err) {
      console.error('[DesignerV2] save failed:', err);
      setSaveStatus('error');
      alert(`Save failed: ${err.message}`);
      setTimeout(() => setSaveStatus(null), 3000);
    } finally {
      setSavingDesign(false);
    }
  };

  const handleSaveClick = () => {
    if (!user) {
      setAuthPurpose('save');
      setAuthOpen(true);
      return;
    }
    setShowSaveModal(true);
  };

  const loadMyDesigns = async () => {
    if (!user || !product) return;
    try {
      const sessionId = getSessionId();
      const all = await getUserDesigns(user.id, sessionId);
      // Filter to designs for THIS product
      const forThis = (all || []).filter(
        (d) => d.supplier_product_code === product.code,
      );
      setSavedDesigns(forThis);
    } catch (err) {
      console.error('[DesignerV2] loadMyDesigns failed:', err);
    }
  };

  const handleOpenMyDesigns = async () => {
    if (!user) {
      setAuthPurpose('mydesigns');
      setAuthOpen(true);
      return;
    }
    await loadMyDesigns();
    setShowMyDesigns(true);
  };

  // ---------------------------------------------------------------------
  // 11. Export
  // ---------------------------------------------------------------------
  const runExport = (format) => {
    if (!canvas || !product) return;
    const filename = `${product.code.toLowerCase()}-design`;
    try {
      if (format === 'png') {
        exportCanvasAsPNG(canvas, { filename, hideWatermark: true });
      } else if (format === 'pdf') {
        exportCanvasAsPDF(canvas, { filename, hideWatermark: true });
      }
    } catch (err) {
      // Defense in depth: /api/proxy-image (CLAUDE.md §39) keeps the
      // canvas un-tainted for Laltex images, so toDataURL should not
      // throw SecurityError on the happy path. This catch covers any
      // future image source that gets added without proxy routing.
      console.error('[DesignerV2] export failed:', err);
      setSaveStatus({ type: 'error', message: err?.message || 'Export failed' });
      setTimeout(() => setSaveStatus(null), 4000);
    }
  };

  const handleExportClick = (format) => {
    if (!user) {
      setAuthPurpose(format);
      setAuthOpen(true);
      return;
    }
    if (!currentDesignId) {
      setSaveStatus({ type: 'error', message: 'Please save your design first' });
      setTimeout(() => setSaveStatus(null), 3000);
      return;
    }
    runExport(format);
  };

  // After successful in-modal sign-in, resume whichever action triggered
  // the gate. AuthModal calls onSuccess(user) — single positional arg.
  const handleAuthSuccess = (signedInUser) => {
    setAuthOpen(false);
    if (!signedInUser) return;
    const purpose = authPurpose;
    setAuthPurpose(null);
    if (purpose === 'save') setShowSaveModal(true);
    else if (purpose === 'png' && currentDesignId) runExport('png');
    else if (purpose === 'pdf' && currentDesignId) runExport('pdf');
    else if (purpose === 'mydesigns') {
      // Need to wait for product context; loadMyDesigns checks user/product.
      loadMyDesigns().then(() => setShowMyDesigns(true));
    }
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <Loader className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600 text-lg">Loading designer...</p>
        </div>
      </div>
    );
  }

  if (loadError || !product) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Designer unavailable</h2>
          <p className="text-gray-600 mb-6">{loadError || 'Product not found'}</p>
          <button
            onClick={() => navigate(-1)}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  const positionGroups = product.printDetails?.positionGroups || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* Header — same visual chrome as v1's sticky header */}
      <header className="bg-white shadow-sm border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate(-1)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                aria-label="Back"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-xl font-bold text-gray-900">{product.name}</h1>
                <p className="text-xs text-gray-500">Code: {product.code}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveClick}
                disabled={savingDesign}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-600 via-purple-600 to-blue-700 text-white rounded-lg font-semibold hover:from-blue-700 hover:via-purple-700 hover:to-blue-800 transition-colors"
              >
                <Save className="h-4 w-4" />
                Save
              </button>
              <button
                onClick={handleOpenMyDesigns}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
              >
                My Designs
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6">
        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-4 lg:gap-6">
          {/* LEFT: tools + colours + positions */}
          <aside className="lg:col-span-3 w-full space-y-4">
            {/* Position tabs — one row per UNIQUE position. Size/method
                dropdown for the active position is rendered in the
                separate panel below (session 9 / §43). */}
            <div className="bg-white rounded-2xl shadow-md border border-gray-200/50 p-4">
              <h3 className="font-bold text-sm text-gray-700 mb-3">Print Position</h3>
              <div className="space-y-1.5">
                {positionGroups.length === 0 && (
                  <p className="text-xs text-gray-500">
                    No print positions configured for this product.
                  </p>
                )}
                {positionGroups.map((g) => {
                  const rowIdx = activeRowByPosition[g.name] ?? g.defaultRowIndex;
                  const currentRow = g.rows[rowIdx] || g.rows[0];
                  const sizeHint = currentRow?.area || null;
                  const methodHint = currentRow?.printType || 'Print';
                  const isActive = g.name === activePositionName;
                  const isCanonical = g.name === canonicalGroupName;
                  // Fix #2: non-canonical tabs of a single-rect product
                  // stay clickable (the customer still records their
                  // intended print position for the quote) but are
                  // visually muted to signal the canvas preview is
                  // locked to the canonical view.
                  const isMutedForPreview =
                    !positionsHaveDistinctRects && !isCanonical;
                  return (
                    <button
                      key={g.name}
                      onClick={() => setActivePositionName(g.name)}
                      title={isMutedForPreview
                        ? `Preview shown is the ${canonicalGroupName} view. Print on ${g.name} is still orderable.`
                        : g.name}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                        isActive
                          ? 'border-blue-500 bg-blue-50/60'
                          : 'border-gray-200 hover:border-gray-300'
                      } ${isMutedForPreview ? 'opacity-60' : ''}`}
                    >
                      <div className="text-sm font-medium text-gray-800">{g.name}</div>
                      <div className="text-xs text-slate-500 truncate">
                        {isMutedForPreview
                          ? 'preview unavailable'
                          : (sizeHint ? `${sizeHint} — ${methodHint}` : methodHint)}
                      </div>
                    </button>
                  );
                })}
              </div>
              {/* Fix #2 notice: surfaces when the product is in the
                  single-rect-multi-position bucket (~12.6% of Laltex
                  catalogue, mainly mugs + power banks). */}
              {!positionsHaveDistinctRects && positionGroups.length > 1 && (
                <div className="mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                  <p className="text-[11px] text-amber-900 leading-snug">
                    Live preview available on <strong>{canonicalGroupName}</strong> only.
                    Other positions are still orderable and your design will print
                    correctly; the printer uses your chosen position when producing
                    the order.
                  </p>
                </div>
              )}
              {/* Fix #1 notice: surfaces when the active position has
                  print coordinates for some colours but not the one the
                  customer just selected. Canvas shows the catalogue
                  thumb in the right colour, no rect overlaid. */}
              {colourPreviewUnavailable && (
                <div className="mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                  <p className="text-[11px] text-amber-900 leading-snug">
                    Print preview unavailable for this colour combination. Your
                    order will print correctly.
                  </p>
                </div>
              )}
            </div>

            {/* Size / print-method dropdown for the active position.
                Hidden when the active position has only one row.
                Separate panel (not inline in the tab) so the canvas
                rect updates visibly as the customer changes the size. */}
            {activeGroup && activeGroup.rows.length > 1 && (
              <div className="bg-white rounded-2xl shadow-md border border-gray-200/50 p-4">
                <h3 className="font-bold text-sm text-gray-700 mb-2">
                  Size &amp; Method
                  <span className="text-xs text-gray-500 font-normal"> — {activeGroup.name}</span>
                </h3>
                <select
                  value={activeRowByPosition[activeGroup.name] ?? activeGroup.defaultRowIndex}
                  onChange={(e) =>
                    setActiveRowByPosition((prev) => ({
                      ...prev,
                      [activeGroup.name]: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2"
                >
                  {activeGroup.rows.map((r, ri) => {
                    const label = [r.printType || 'Print', r.area]
                      .filter(Boolean)
                      .join(' – ');
                    return (
                      <option key={ri} value={ri}>
                        {label}{r.defaultOption ? ' (default)' : ''}
                      </option>
                    );
                  })}
                </select>
                <p className="text-[11px] text-gray-500 mt-2 leading-snug">
                  The print rectangle on the canvas updates to match
                  your selection. Drag and resize your artwork to fit.
                </p>
              </div>
            )}

            {/* Colour swatches (image-based — Laltex has PMS, no hex) */}
            {product.colours.length > 0 && (
              <div className="bg-white rounded-2xl shadow-md border border-gray-200/50 p-4">
                <h3 className="font-bold text-sm text-gray-700 mb-3">
                  Colour {selectedColour && <span className="text-xs text-gray-500 font-normal">— {selectedColour.name}</span>}
                </h3>
                <div className="grid grid-cols-5 gap-2">
                  {product.colours.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedColourId(c.id)}
                      className={`aspect-square rounded-lg border-2 overflow-hidden bg-white transition-all ${
                        c.id === selectedColourId
                          ? 'border-blue-500 shadow-md scale-105'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      title={c.name}
                    >
                      {c.images?.[0] ? (
                        <img src={c.images[0]} alt={c.name} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <span className="block w-full h-full bg-gray-200" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* MIDDLE: canvas. Card is capped at the 800px canvas size
              and centred in its column via mx-auto. No padding on the
              card: Fabric.Canvas wraps the <canvas> in its own
              .canvas-container div and sets inline width/height on
              both, which override any maxWidth:100% declared from
              JSX. Padding here would push the Fabric-controlled
              wrapper outside the card's rounded corners. The canvas
              sits flush against the card border instead — overflow
              is the wallpaper-clip rounded-2xl gives us. */}
          <main className="lg:col-span-6 w-full">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200/50 max-w-[800px] mx-auto overflow-hidden">
              <canvas
                ref={handleCanvasRef}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
                style={{ display: 'block' }}
              />
              {saveStatus && (
                <div className={`mt-3 text-center text-sm font-medium ${
                  saveStatus === 'saved' ? 'text-green-600' :
                  saveStatus === 'error' ? 'text-red-600' :
                  saveStatus === 'saving' ? 'text-blue-600' :
                  saveStatus?.type === 'error' ? 'text-red-600' :
                  'text-gray-500'
                }`}>
                  {saveStatus === 'saved' ? 'Design saved' :
                   saveStatus === 'error' ? 'Save failed' :
                   saveStatus === 'saving' ? 'Saving...' :
                   saveStatus?.message || ''}
                </div>
              )}
            </div>
          </main>

          {/* RIGHT: tools */}
          <aside className="lg:col-span-3 w-full space-y-4">
            {/* Add text */}
            <div className="bg-white rounded-2xl shadow-md border border-gray-200/50 p-4 space-y-2">
              <h3 className="font-bold text-sm text-gray-700">Add Text</h3>
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Your text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleAddText}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors text-sm"
              >
                <Type className="h-4 w-4" />
                Add Text
              </button>
            </div>

            {/* Add image */}
            <div className="bg-white rounded-2xl shadow-md border border-gray-200/50 p-4 space-y-2">
              <h3 className="font-bold text-sm text-gray-700">Upload Image</h3>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-700 hover:border-blue-400 hover:bg-blue-50/50 transition-colors text-sm"
              >
                <Upload className="h-4 w-4" />
                Choose file
              </button>
            </div>

            {/* Delete selected */}
            {selectedObject && isUserObject(selectedObject) && (
              <button
                onClick={handleDeleteSelected}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg font-medium hover:bg-red-100 transition-colors text-sm"
              >
                <Trash2 className="h-4 w-4" />
                Delete selected
              </button>
            )}

            {/* Export */}
            <div className="bg-white rounded-2xl shadow-md border border-gray-200/50 p-4 space-y-2">
              <h3 className="font-bold text-sm text-gray-700">Export</h3>
              <button
                onClick={() => handleExportClick('png')}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors text-sm"
              >
                <FileImage className="h-4 w-4" />
                PNG
              </button>
              <button
                onClick={() => handleExportClick('pdf')}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-800 rounded-lg font-medium hover:bg-gray-50 transition-colors text-sm"
              >
                <FileText className="h-4 w-4" />
                PDF
              </button>
            </div>
          </aside>
        </div>
      </div>

      {/* Save modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold mb-4">
              {currentDesignId ? 'Update design' : 'Save design'}
            </h3>
            <input
              type="text"
              value={designName}
              onChange={(e) => setDesignName(e.target.value)}
              placeholder="Design name"
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-4 focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowSaveModal(false)}
                className="flex-1 px-4 py-2 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={runSaveDesign}
                disabled={savingDesign || !designName.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold disabled:bg-gray-300 hover:bg-blue-700 transition-colors"
              >
                {savingDesign ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* My Designs modal */}
      {showMyDesigns && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">My designs for {product.name}</h3>
              <button onClick={() => setShowMyDesigns(false)} className="text-gray-400 hover:text-gray-700">
                ×
              </button>
            </div>
            {savedDesigns.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                No saved designs yet for this product.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {savedDesigns.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      setShowMyDesigns(false);
                      navigate(`/design/${encodeURIComponent(product.code)}?design=${d.id}`);
                    }}
                    className="border border-gray-200 rounded-lg p-2 hover:border-blue-400 transition-colors text-left"
                  >
                    {d.thumbnail_url ? (
                      <img src={d.thumbnail_url} alt={d.design_name} className="w-full h-32 object-contain bg-gray-50 rounded mb-2" />
                    ) : (
                      <div className="w-full h-32 bg-gray-100 rounded mb-2 flex items-center justify-center text-gray-400">
                        No preview
                      </div>
                    )}
                    <div className="text-sm font-medium truncate">{d.design_name}</div>
                    <div className="text-xs text-gray-500">{prettyPrintArea(d.print_area)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Auth gate (reused pattern: same AuthModal as session 6) */}
      {authOpen && (
        <AuthModal
          isOpen={authOpen}
          onClose={() => { setAuthOpen(false); setAuthPurpose(null); }}
          onSuccess={handleAuthSuccess}
        />
      )}
    </div>
  );
};

export default DesignerV2;
