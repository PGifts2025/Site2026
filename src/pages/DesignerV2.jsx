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
 * Save / load:
 *   - user_designs.design_data: JSONB (Fabric serialisation, user
 *     objects only — chrome is excluded by captureUserCanvasJSON)
 *   - user_designs.supplier_product_code: text (new column added in
 *     migration 20260512). Replaces product_template_id for v2 rows.
 *   - user_designs.view_name: position name (e.g. "Wrap", "Front")
 *   - user_designs.user_id OR session_id: existing v1 contract
 */

/* Mount-diagnosis marker — must fire on module load.
 * If this log does NOT appear in console, the running app is loading
 * a different module than this file. */
// eslint-disable-next-line no-console
console.log('[DESIGNERV2-FILE-LOADED]', new Date().toISOString());

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
  translateLaltexCoord,
  useDeferredDesignApply,
  isUserObject,
} from '../utils/fabricCanvasManager';

const CANVAS_SIZE = 800;

// Object IDs follow v1's conventions so fabricCanvasManager's filters
// (isUserObject, captureUserCanvasJSON) recognise them as chrome.
const TEMPLATE_IMAGE_ID = 'template-image';
const PRINT_AREA_OVERLAY_ID = 'printAreaOverlay';

const DesignerV2 = () => {
  /* Mount-diagnosis marker — must fire on every render of this
   * component. If [DESIGNERV2-FILE-LOADED] appears but this does NOT,
   * the file is being imported but the component never instantiated
   * (route mismatch). */
  // eslint-disable-next-line no-console
  console.log('[DESIGNERV2-COMPONENT-CALLED]');

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

  // -------- Data state --------
  const [product, setProduct] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  // -------- Canvas state --------
  const [canvas, setCanvas] = useState(null);
  const [pendingDesignData, setPendingDesignData] = useState(null);
  const [printAreasLoaded, setPrintAreasLoaded] = useState(false);

  // -------- Selection state --------
  const [activePositionIdx, setActivePositionIdx] = useState(0);
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
      console.log('[DesignerV2] canvas ready');

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
    const positions = product.printDetails?.positions || [];
    const defaultIdx = Math.max(0, positions.findIndex((p) => p.defaultOption));
    setActivePositionIdx(defaultIdx);
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
    let cancelled = false;
    (async () => {
      try {
        const design = await getUserDesign(designId);
        if (cancelled || !design) return;
        // Safety: only consume the saved design if it matches THIS product.
        if (design.supplier_product_code && design.supplier_product_code !== product.code) {
          console.warn('[DesignerV2] saved design is for a different product, skipping pre-load');
          return;
        }
        setCurrentDesignId(design.id);
        setDesignName(design.design_name || '');
        if (design.view_name) {
          const idx = (product.printDetails?.positions || [])
            .findIndex((p) => p.name === design.view_name);
          if (idx >= 0) setActivePositionIdx(idx);
        }
        if (design.design_data) {
          setPendingDesignData(design.design_data);
        }
      } catch (err) {
        console.error('[DesignerV2] saved-design pre-load failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [canvas, product, searchParams]);

  // ---------------------------------------------------------------------
  // 5. Render template image + print-area overlay whenever
  //    (position, colour, canvas) changes.
  // ---------------------------------------------------------------------
  const activePosition = useMemo(() => {
    if (!product) return null;
    const positions = product.printDetails?.positions || [];
    return positions[activePositionIdx] || null;
  }, [product, activePositionIdx]);

  // Fix #2 (Bug B): detect the "single rect copied across every position"
  // pattern (CLAUDE.md §37, MG0192 et al). True means the data is honest
  // - every position carries its own distinct (x,y,w,h). False means
  // only one of the listed positions has a faithful image+rect pairing
  // and the rest would render the rect floating off the product.
  // Single-position products are trivially "honest" (length<=1 → true).
  const positionsHaveDistinctRects = useMemo(() => {
    const positions = product?.printDetails?.positions || [];
    if (positions.length <= 1) return true;
    const tuples = new Set();
    for (const pos of positions) {
      for (const coord of (pos.coordinates || [])) {
        tuples.add(`${coord.x}|${coord.y}|${coord.width}|${coord.height}`);
      }
    }
    return tuples.size > 1;
  }, [product]);

  // When positionsHaveDistinctRects is false we lock the canvas to one
  // canonical position regardless of the user's selection. Heuristic:
  // - Drinkware ships with a head-on "Wrap" image whose rect coords align
  //   with the visible cup body — prefer Wrap if present.
  // - Otherwise pick the position with the most colour entries (most
  //   field-tested / most likely to be the canonical framing).
  const canonicalPositionIdx = useMemo(() => {
    const positions = product?.printDetails?.positions || [];
    if (positions.length === 0) return 0;
    const wrapIdx = positions.findIndex((p) => p.name === 'Wrap');
    if (wrapIdx !== -1) return wrapIdx;
    let bestIdx = 0;
    let bestCount = -1;
    positions.forEach((p, i) => {
      const cnt = (p.coordinates || []).length;
      if (cnt > bestCount) { bestCount = cnt; bestIdx = i; }
    });
    return bestIdx;
  }, [product]);

  // The position whose image+rect actually drives the canvas. Equals
  // activePosition for normal products; locked to canonical for the
  // 12.6% single-rect-multi-position bucket.
  const renderPosition = useMemo(() => {
    if (!product) return null;
    const positions = product.printDetails?.positions || [];
    const idx = positionsHaveDistinctRects ? activePositionIdx : canonicalPositionIdx;
    return positions[idx] || null;
  }, [product, activePositionIdx, canonicalPositionIdx, positionsHaveDistinctRects]);

  const canonicalPositionName = useMemo(() => {
    const positions = product?.printDetails?.positions || [];
    return positions[canonicalPositionIdx]?.name || null;
  }, [product, canonicalPositionIdx]);

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
    // Fix #1 (Bug A, session 7): strict colour match. If the selected
    // colour has no entry in this position's coordinates, we do NOT fall
    // back to allCoords[0] - that silently swapped the customer's chosen
    // colour for whichever sorted first (the original "Amber selected,
    // Blue cup rendered" bug on MG0192's Back).
    const allCoords = renderPosition.coordinates || [];
    const colourCoord = allCoords.find((c) =>
      c.colour && selectedColour?.name &&
      c.colour.toLowerCase().trim() === selectedColour.name.toLowerCase().trim(),
    ) || null;

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

    const rawImageUrl =
      colourCoord?.image_url ||
      selectedColour?.images?.[0] ||
      selectedColour?.plainImages?.[0] ||
      product.images?.[0]?.url ||
      null;

    if (!rawImageUrl) {
      console.warn('[DesignerV2] no image available for current product/colour');
      return;
    }

    // URL-encode (preserves any pre-existing %XX, encodes raw spaces).
    // Laltex's pac/ URLs contain literal spaces — Fabric 5.3's
    // loadImage path has been reported to silently drop those without
    // encoding. The browser's <img src> auto-encodes; Fabric's internal
    // path is less forgiving.
    const imageUrl = encodeURI(rawImageUrl);

    // Diagnostic trace — surfaces the resolved image URL + coord entry.
    // If the canvas stays blank, paste this from devtools.
    console.log('[DesignerV2] effect run', {
      activePosition: activePosition?.name,
      renderPosition: renderPosition.name,
      positionsHaveDistinctRects,
      colour: selectedColour?.name,
      coordsLen: allCoords.length,
      colourCoord: colourCoord ? {
        colour: colourCoord.colour,
        image_url: colourCoord.image_url,
      } : null,
      previewUnavailable,
      rawImageUrl,
      imageUrl,
    });

    // Token guards against effect re-runs racing each other (Strict
    // Mode, rapid colour clicks). A stale callback bails out without
    // touching the canvas.
    imageLoadTokenRef.current += 1;
    const myToken = imageLoadTokenRef.current;

    // CORS note: Laltex's image server does not return
    // Access-Control-Allow-Origin headers. We DON'T request CORS — that
    // would make Chrome refuse the image entirely and leave the canvas
    // blank. The canvas will be "tainted" for export purposes; PNG/PDF
    // export of a tainted canvas throws SecurityError. exportCanvasAsPNG
    // and exportCanvasAsPDF surface that as a friendly error rather
    // than a stack trace; a proper image-proxy fix lands later.
    fabric.Image.fromURL(
      imageUrl,
      (img) => {
        if (myToken !== imageLoadTokenRef.current) {
          console.log('[DesignerV2] image load callback stale, bailing', { imageUrl });
          return;
        }
        if (!canvasReadyRef.current) {
          console.log('[DesignerV2] canvas not ready in callback, bailing', { imageUrl });
          return;
        }
        if (!img || !img.width) {
          console.warn('[DesignerV2] image failed to load (img null or width=0):', { imageUrl, img });
          return;
        }
        console.log('[DesignerV2] image loaded OK', { imageUrl, w: img.width, h: img.height });

        // Native dimensions of the source — translateLaltexCoord scales
        // print-area rect from this space onto canvas space.
        const natW = img.width;
        const natH = img.height;
        const scale = Math.min(CANVAS_SIZE / natW, CANVAS_SIZE / natH);

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
        // means natW*scale and natH*scale are the rendered dimensions
        // starting from (left, top).
        img.set({
          id: TEMPLATE_IMAGE_ID,
          name: TEMPLATE_IMAGE_ID,
          originX: 'left',
          originY: 'top',
          left: (CANVAS_SIZE - natW * scale) / 2,
          top: (CANVAS_SIZE - natH * scale) / 2,
          scaleX: scale,
          scaleY: scale,
          selectable: false,
          evented: false,
          hoverCursor: 'default',
          excludeFromExport: false,
        });
        // Extra diagnostic — log the actual placed geometry so any
        // off-centre symptom is reproducible from the console.
        console.log('[DesignerV2] image placed', {
          natW, natH, scale,
          left: (CANVAS_SIZE - natW * scale) / 2,
          top: (CANVAS_SIZE - natH * scale) / 2,
          renderedW: natW * scale,
          renderedH: natH * scale,
        });
        canvas.add(img);
        canvas.sendToBack(img);

        // Print area overlay rectangle — only when we have a coordinate
        // entry. Degraded fallback (catalogue thumb only, no
        // print_area_coordinates rows) renders the image without an
        // overlay since the math would be wrong against the wrong image.
        if (colourCoord) {
          const t = translateLaltexCoord(
            colourCoord, natW, natH, CANVAS_SIZE, CANVAS_SIZE,
          );
          const rect = new fabric.Rect({
            id: PRINT_AREA_OVERLAY_ID,
            name: PRINT_AREA_OVERLAY_ID,
            originX: 'left',
            originY: 'top',
            left: t.x,
            top: t.y,
            width: t.width,
            height: t.height,
            fill: 'rgba(59, 130, 246, 0.08)',
            stroke: '#3b82f6',
            strokeDashArray: [6, 4],
            strokeWidth: 1.5,
            selectable: false,
            evented: false,
            hoverCursor: 'default',
            excludeFromExport: true,
          });
          console.log('[DesignerV2] print rect placed', {
            left: t.x, top: t.y, width: t.width, height: t.height, scale: t.scale,
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
      // NO crossOrigin — see CORS note above.
    );
  }, [canvas, product, renderPosition, selectedColour, activePosition, positionsHaveDistinctRects]);

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
      const row = {
        user_id: user.id,
        session_id: null,
        design_name: designName.trim(),
        supplier_product_code: product.code,
        view_name: activePosition?.name || null,
        color_code: selectedColour?.code || null,
        color_name: selectedColour?.name || null,
        design_data: designJSON,
        thumbnail_url: thumbnail,
        product_key: product.code,
        // Legacy v1 columns left null — v2 keys off supplier_product_code.
        product_template_id: null,
        variant_id: null,
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
      // Tainted-canvas error from cross-origin Laltex images. Surface
      // a friendly inline message instead of letting it bubble.
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

  const positions = product.printDetails?.positions || [];

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
            {/* Position tabs */}
            <div className="bg-white rounded-2xl shadow-md border border-gray-200/50 p-4">
              <h3 className="font-bold text-sm text-gray-700 mb-3">Print Position</h3>
              <div className="space-y-1.5">
                {positions.length === 0 && (
                  <p className="text-xs text-gray-500">
                    No print positions configured for this product.
                  </p>
                )}
                {positions.map((p, idx) => {
                  const method = p.printType || 'Print';
                  const isActive = idx === activePositionIdx;
                  const isCanonical = idx === canonicalPositionIdx;
                  // Fix #2: non-canonical tabs of a single-rect product
                  // stay clickable (the customer still records their
                  // intended print position for the quote) but are
                  // visually muted to signal the canvas preview is
                  // locked to the canonical view.
                  const isMutedForPreview =
                    !positionsHaveDistinctRects && !isCanonical;
                  return (
                    <button
                      key={idx}
                      onClick={() => setActivePositionIdx(idx)}
                      title={isMutedForPreview
                        ? `Preview shown is the ${canonicalPositionName} view. Print on ${p.name} is still orderable.`
                        : p.name}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                        isActive
                          ? 'border-blue-500 bg-blue-50/60'
                          : 'border-gray-200 hover:border-gray-300'
                      } ${isMutedForPreview ? 'opacity-60' : ''}`}
                    >
                      <div className="text-sm font-medium text-gray-800">{p.name}</div>
                      <div className="text-xs text-slate-500 truncate">
                        {isMutedForPreview ? 'preview unavailable' : method}
                      </div>
                    </button>
                  );
                })}
              </div>
              {/* Fix #2 notice: surfaces when the product is in the
                  single-rect-multi-position bucket (~12.6% of Laltex
                  catalogue, mainly mugs + power banks). */}
              {!positionsHaveDistinctRects && positions.length > 1 && (
                <div className="mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                  <p className="text-[11px] text-amber-900 leading-snug">
                    Live preview available on <strong>{canonicalPositionName}</strong> only.
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
                    <div className="text-xs text-gray-500">{d.view_name || ''}</div>
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
