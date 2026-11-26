import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Grid3X3,
  ImagePlus,
  Maximize2,
  MoveHorizontal,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Crop as CropIcon,
  Eye,
  EyeOff,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Pencil,
  Keyboard,
  X,
} from 'lucide-react';
import { hexToRgb, rgbToHex } from '../lib/palettes';
import { pixelCoordsFromClient, readCanvasSourceColor, type CanvasSourcePickMode } from '../lib/canvasSourcePick';
import {
  CropRect,
  PixelEngineConfig,
  PixelEngineResult,
  computeCenteredAspectCrop,
} from '../lib/pixelEngine';
import {
  RGBA,
  cloneImageData,
  drawBrushStroke,
  floodFillOrReplace,
  getPixelAt,
} from '../lib/pixelEditOps';
import { PixelEditorBar, PixelEditorState } from './PixelEditorBar';
import { FrameTimelineBar, TimelineFramePreview } from './FrameTimelineBar';
import { useI18n } from '../i18n';

export type ViewMode = 'side-by-side' | 'split' | 'pixel' | 'crop' | 'edit' | 'animate';
export type BackdropMode = 'checker' | 'dark' | 'light';

interface SampleItem {
  id: string;
  label: string;
  src: string;
}

interface CanvasViewportProps {
  sourceImage: HTMLImageElement | null;
  sourceName: string;
  result: PixelEngineResult | null;
  previewImageData: ImageData | null;
  sequencePreviewActive: boolean;
  canvasSourcePickMode: CanvasSourcePickMode | null;
  canStartCanvasSourcePick: boolean;
  onToolbarReplace: () => void;
  onRevealDocumentPalette: () => void;
  onCanvasSourceColor: (hex:string) => void;
  onFinishCanvasSourcePick: () => void;
  onCancelPalettePreview: () => void;
  config: PixelEngineConfig;
  viewMode: ViewMode;
  editor: PixelEditorState;
  canUndo: boolean;
  canRedo: boolean;
  hasManualEdits: boolean;
  editStepCount: number;
  hasPendingReconvert: boolean;
  isBatchProcessing: boolean;
  // Animation sequence props
  timelineFrames: TimelineFramePreview[];
  activeFrameId: string | null;
  isPlaying: boolean;
  fps: number;
  onTogglePlay: () => void;
  onStepFrame: (delta: -1 | 1) => void;
  onChangeFps: (fps: number) => void;
  onSelectFrame: (id: string) => void;
  onEditFrame: (id: string) => void;
  onReorderFrames: (fromIndex: number, toIndex: number) => void;
  onDeleteFrame: (id: string) => void;
  onUploadFiles: (files: File[], mode: 'replace' | 'append') => void;
  onOpenUpload: () => void;
  // Editor & viewport callbacks
  onUpdateEditor: (patch: Partial<PixelEditorState>) => void;
  onCommitImageData: (next: ImageData) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAutoRemoveBg: () => void;
  onResetEdits: () => void;
  onApplyPendingReconvert: () => void;
  onDismissPendingReconvert: () => void;
  onChangeCrop: (crop: CropRect) => void;
  samples: SampleItem[];
  activeSampleId: string | null;
  onSelectSample: (sample: SampleItem) => void;
  onChangeViewMode: (mode: ViewMode) => void;
}

const FPS_PRESETS = [6, 8, 12, 15, 24];
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const SHOW_REAL_SIZE_STORAGE_KEY = 'pixforge:showRealSize';

function PixelGridOverlay({
  width,
  height,
  cols,
  rows,
}: {
  width: number;
  height: number;
  cols: number;
  rows: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0 || cols <= 0 || rows <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const cellW = width / cols;
    const cellH = height / rows;
    const step = cellW >= 2.5 && cellH >= 2.5 ? 1 : cellW >= 1.5 && cellH >= 1.5 ? 2 : 4;

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.42)';
    ctx.beginPath();
    for (let x = step; x < cols; x += step) {
      const px = Math.round(x * cellW) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
    }
    for (let y = step; y < rows; y += step) {
      const py = Math.round(y * cellH) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
    }
    ctx.stroke();

    if (cellW >= 5 && cellH >= 5) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.beginPath();
      for (let x = step; x < cols; x += step) {
        const px = Math.round(x * cellW) - 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
      }
      for (let y = step; y < rows; y += step) {
        const py = Math.round(y * cellH) - 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(width, py);
      }
      ctx.stroke();
    }

    if (cols >= 16 && rows >= 16) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.beginPath();
      for (let x = 8; x < cols; x += 8) {
        const px = Math.round(x * cellW) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
      }
      for (let y = 8; y < rows; y += 8) {
        const py = Math.round(y * cellH) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(width, py);
      }
      ctx.stroke();
    }
  }, [width, height, cols, rows]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}

type DragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export function CanvasViewport({
  sourceImage,
  sourceName,
  result,
  previewImageData,
  sequencePreviewActive,
  canvasSourcePickMode, onCanvasSourceColor, onFinishCanvasSourcePick,
  canStartCanvasSourcePick, onToolbarReplace, onRevealDocumentPalette,
  onCancelPalettePreview,
  config,
  viewMode,
  editor,
  canUndo,
  canRedo,
  hasManualEdits,
  editStepCount,
  hasPendingReconvert,
  isBatchProcessing,
  timelineFrames,
  activeFrameId,
  isPlaying,
  fps,
  onTogglePlay,
  onStepFrame,
  onChangeFps,
  onSelectFrame,
  onEditFrame,
  onReorderFrames,
  onDeleteFrame,
  onUploadFiles,
  onOpenUpload,
  onUpdateEditor,
  onCommitImageData,
  onUndo,
  onRedo,
  onAutoRemoveBg,
  onResetEdits,
  onApplyPendingReconvert,
  onDismissPendingReconvert,
  onChangeCrop,
  samples,
  activeSampleId,
  onSelectSample,
  onChangeViewMode,
}: CanvasViewportProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editCanvasBoxRef = useRef<HTMLDivElement | null>(null);
  const pixelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceCropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const actual1xCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const actual2xCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pendingWheelAnchorRef = useRef<{
    clientX: number;
    clientY: number;
    ratioX: number;
    ratioY: number;
  } | null>(null);
  const panDragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
  }>({ active: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 });

  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [showGrid, setShowGrid] = useState<boolean>(false);
  const [hasEnteredEditOnce, setHasEnteredEditOnce] = useState<boolean>(false);
  const [backdrop, setBackdrop] = useState<BackdropMode>('checker');
  const [splitPos, setSplitPos] = useState<number>(50);
  const [isDraggingSplit, setIsDraggingSplit] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [showRealSize, setShowRealSize] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem(SHOW_REAL_SIZE_STORAGE_KEY);
      if (saved === 'false') return false;
      if (saved === 'true') return true;
    } catch {
      // Ignore storage access errors
    }
    return true;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(SHOW_REAL_SIZE_STORAGE_KEY, String(showRealSize));
    } catch {
      // Ignore storage access errors
    }
  }, [showRealSize]);
  const [showShortcutHelp, setShowShortcutHelp] = useState<boolean>(false);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({ w: 800, h: 520 });

  const workingImgRef = useRef<ImageData | null>(null);
  const strokeActiveRef = useRef<{
    active: boolean;
    lastX: number;
    lastY: number;
    color: RGBA;
    size: number;
  }>({ active: false, lastX: 0, lastY: 0, color: { r: 0, g: 0, b: 0, a: 255 }, size: 1 });

  const [hoverPixel, setHoverPixel] = useState<{
    x: number;
    y: number;
    hex: string | null;
    isTransparent: boolean;
  } | null>(null);

  const cropBoxRef = useRef<HTMLDivElement | null>(null);
  const [cropDrag, setCropDrag] = useState<{
    handle: DragHandle;
    startX: number;
    startY: number;
    startCrop: CropRect;
    boxW: number;
    boxH: number;
  } | null>(null);

  const showTimeline = timelineFrames.length > 1 || viewMode === 'animate';
  const activeFrameIdx = timelineFrames.findIndex((f) => f.id === activeFrameId);

  useEffect(() => {
    if (viewMode === 'edit' && !hasEnteredEditOnce) {
      setShowGrid(true);
      setHasEnteredEditOnce(true);
    }
  }, [viewMode, hasEnteredEditOnce]);

  // Reset zoom and pan back to default fit whenever switching tabs/modes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsPanning(false);
    panDragRef.current.active = false;
    pendingWheelAnchorRef.current = null;
    if (containerRef.current) {
      containerRef.current.scrollLeft = 0;
      containerRef.current.scrollTop = 0;
    }
  }, [viewMode]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        setViewportSize({ w: rect.width, h: rect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Mouse wheel zoom in Pixel Edit mode (anchored to pointer position, allowing overflow beyond stage)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || viewMode !== 'edit' || !sourceImage) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();

      const canvasBox = editCanvasBoxRef.current;
      if (canvasBox) {
        const boxRect = canvasBox.getBoundingClientRect();
        if (boxRect.width > 0 && boxRect.height > 0) {
          const ratioX = Math.max(0, Math.min(1, (e.clientX - boxRect.left) / boxRect.width));
          const ratioY = Math.max(0, Math.min(1, (e.clientY - boxRect.top) / boxRect.height));
          pendingWheelAnchorRef.current = {
            clientX: e.clientX,
            clientY: e.clientY,
            ratioX,
            ratioY,
          };
        }
      }

      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom((prev) => {
        const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +(prev * factor).toFixed(2)));
        if (next === prev) {
          pendingWheelAnchorRef.current = null;
        }
        return next;
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [viewMode, sourceImage]);

  const clampPan = (x: number, y: number) => {
    const maxX = Math.max(120, Math.round((dispW + viewportSize.w) / 2) - 64);
    const maxY = Math.max(120, Math.round((dispH + viewportSize.h) / 2) - 64);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  };

  useLayoutEffect(() => {
    const anchor = pendingWheelAnchorRef.current;
    if (!anchor) return;
    pendingWheelAnchorRef.current = null;

    const canvasBox = editCanvasBoxRef.current;
    if (!canvasBox) return;

    const nextRect = canvasBox.getBoundingClientRect();
    const targetScreenX = nextRect.left + anchor.ratioX * nextRect.width;
    const targetScreenY = nextRect.top + anchor.ratioY * nextRect.height;
    const dx = anchor.clientX - targetScreenX;
    const dy = anchor.clientY - targetScreenY;

    if (Math.abs(dx) > 0.25 || Math.abs(dy) > 0.25) {
      setPan((prev) => clampPan(prev.x + dx, prev.y + dy));
    }
  }, [zoom]);

  const handleStageMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Prevent Windows/Chrome native middle-click autoscroll from hijacking 2D panning
    if (viewMode === 'edit' && e.button === 1) {
      e.preventDefault();
    }
  };

  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (viewMode !== 'edit' || e.button !== 1) return;
    const el = containerRef.current;
    if (!el) return;
    e.preventDefault();
    panDragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
    setIsPanning(true);
    el.setPointerCapture(e.pointerId);
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panDragRef.current.active) return;
    const nextX = panDragRef.current.startPanX + (e.clientX - panDragRef.current.startX);
    const nextY = panDragRef.current.startPanY + (e.clientY - panDragRef.current.startY);
    setPan(clampPan(nextX, nextY));
  };

  const handleStagePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panDragRef.current.active) return;
    panDragRef.current.active = false;
    setIsPanning(false);
    const el = containerRef.current;
    if (el && el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
  };

  const syncCanvasesWithImageData = (imgData: ImageData) => {
    const canvases = [pixelCanvasRef.current, actual1xCanvasRef.current, actual2xCanvasRef.current];
    for (const c of canvases) {
      if (!c) continue;
      c.width = imgData.width;
      c.height = imgData.height;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, imgData.width, imgData.height);
        ctx.putImageData(imgData, 0, 0);
      }
    }
  };

  useEffect(() => {
    if (!result) return;
    syncCanvasesWithImageData(previewImageData ?? result.imageData);
  }, [result, previewImageData, viewMode, showRealSize]);

  useEffect(() => {
    const canvas = sourceCropCanvasRef.current;
    if (!canvas || !sourceImage || (viewMode !== 'side-by-side' && viewMode !== 'split')) return;

    const sx = config.crop.x * sourceImage.naturalWidth;
    const sy = config.crop.y * sourceImage.naturalHeight;
    const sw = Math.max(1, config.crop.w * sourceImage.naturalWidth);
    const sh = Math.max(1, config.crop.h * sourceImage.naturalHeight);

    const maxEdge = 1024;
    const ratio = sw / sh;
    let cw = Math.min(maxEdge, Math.round(sw));
    let ch = Math.round(cw / ratio);
    if (ch > maxEdge) {
      ch = maxEdge;
      cw = Math.round(ch * ratio);
    }

    canvas.width = Math.max(1, cw);
    canvas.height = Math.max(1, ch);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    }
  }, [sourceImage, config.crop, viewMode]);

  useEffect(() => {
    const canvas = cropPreviewCanvasRef.current;
    if (!canvas || !sourceImage || viewMode !== 'crop') return;

    const nw = Math.max(1, sourceImage.naturalWidth);
    const nh = Math.max(1, sourceImage.naturalHeight);
    const maxEdge = 1024;
    const scale = Math.min(1, maxEdge / Math.max(nw, nh));
    canvas.width = Math.max(1, Math.round(nw * scale));
    canvas.height = Math.max(1, Math.round(nh * scale));

    const ctx = canvas.getContext('2d');
    if (ctx) {
      const isSmallSprite = nw <= 256 && nh <= 256;
      ctx.imageSmoothingEnabled = !isSmallSprite;
      if (!isSmallSprite) ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
    }
  }, [sourceImage, viewMode]);

  useEffect(() => {
    if (!isDraggingSplit) return;
    const handleMove = (e: PointerEvent) => {
      const frame = document.getElementById('split-compare-frame');
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitPos(Math.max(0, Math.min(100, pct)));
    };
    const handleUp = () => setIsDraggingSplit(false);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [isDraggingSplit]);

  useEffect(() => {
    if (!cropDrag || !sourceImage) return;

    const srcRatio = sourceImage.naturalWidth / sourceImage.naturalHeight;
    const targetRatio = config.targetW / config.targetH;
    const normFactor = srcRatio / targetRatio;

    const handleMove = (e: PointerEvent) => {
      const dx = (e.clientX - cropDrag.startX) / cropDrag.boxW;
      const dy = (e.clientY - cropDrag.startY) / cropDrag.boxH;
      const sc = cropDrag.startCrop;

      if (cropDrag.handle === 'move') {
        const nx = Math.max(0, Math.min(1 - sc.w, sc.x + dx));
        const ny = Math.max(0, Math.min(1 - sc.h, sc.y + dy));
        onChangeCrop({ x: nx, y: ny, w: sc.w, h: sc.h });
        return;
      }

      const minW = Math.min(0.15, 0.15 / normFactor);
      let newW = sc.w;
      let newH = sc.h;
      let newX = sc.x;
      let newY = sc.y;

      if (cropDrag.handle === 'se') {
        const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy / normFactor;
        newW = Math.max(minW, sc.w + delta);
        newH = newW * normFactor;
        if (sc.x + newW > 1) {
          newW = 1 - sc.x;
          newH = newW * normFactor;
        }
        if (sc.y + newH > 1) {
          newH = 1 - sc.y;
          newW = newH / normFactor;
        }
      } else if (cropDrag.handle === 'sw') {
        const right = sc.x + sc.w;
        const delta = Math.abs(dx) > Math.abs(dy) ? -dx : dy / normFactor;
        newW = Math.max(minW, sc.w + delta);
        newH = newW * normFactor;
        if (right - newW < 0) {
          newW = right;
          newH = newW * normFactor;
        }
        if (sc.y + newH > 1) {
          newH = 1 - sc.y;
          newW = newH / normFactor;
        }
        newX = right - newW;
      } else if (cropDrag.handle === 'ne') {
        const bottom = sc.y + sc.h;
        const delta = Math.abs(dx) > Math.abs(dy) ? dx : -dy / normFactor;
        newW = Math.max(minW, sc.w + delta);
        newH = newW * normFactor;
        if (sc.x + newW > 1) {
          newW = 1 - sc.x;
          newH = newW * normFactor;
        }
        if (bottom - newH < 0) {
          newH = bottom;
          newW = newH / normFactor;
        }
        newY = bottom - newH;
      } else if (cropDrag.handle === 'nw') {
        const right = sc.x + sc.w;
        const bottom = sc.y + sc.h;
        const delta = Math.abs(dx) > Math.abs(dy) ? -dx : -dy / normFactor;
        newW = Math.max(minW, sc.w + delta);
        newH = newW * normFactor;
        if (right - newW < 0) {
          newW = right;
          newH = newW * normFactor;
        }
        if (bottom - newH < 0) {
          newH = bottom;
          newW = newH / normFactor;
        }
        newX = right - newW;
        newY = bottom - newH;
      }

      onChangeCrop({
        x: Math.max(0, Math.min(1 - newW, newX)),
        y: Math.max(0, Math.min(1 - newH, newY)),
        w: Math.max(0.05, Math.min(1, newW)),
        h: Math.max(0.05, Math.min(1, newH)),
      });
    };

    const handleUp = () => setCropDrag(null);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [cropDrag, sourceImage, config.targetW, config.targetH, onChangeCrop]);

  const startCropDrag = (handle: DragHandle, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = cropBoxRef.current?.getBoundingClientRect();
    if (!box) return;
    setCropDrag({
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: { ...config.crop },
      boxW: box.width,
      boxH: box.height,
    });
  };

  // --- Pixel Editor Pointer Interaction Helpers ---
  const getPixelCoordsFromEvent = (e: React.PointerEvent<HTMLDivElement>): { x: number; y: number } | null => {
    if (!result) return null;
    const rect = pixelCanvasRef.current?.getBoundingClientRect();
    return rect ? pixelCoordsFromClient(rect,e.clientX,e.clientY,result.width,result.height) : null;
  };

  const updateHoverInfo = (coords: { x: number; y: number } | null) => {
    if (!coords || !result) {
      setHoverPixel(null);
      return;
    }
    const img = strokeActiveRef.current.active && workingImgRef.current ? workingImgRef.current : (previewImageData ?? result.imageData);
    const px = getPixelAt(img, coords.x, coords.y);
    if (!px || px.a === 0) {
      setHoverPixel({ x: coords.x, y: coords.y, hex: null, isTransparent: true });
    } else {
      setHoverPixel({
        x: coords.x,
        y: coords.y,
        hex: rgbToHex(px.r, px.g, px.b),
        isTransparent: false,
      });
    }
  };

  const handleEditPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!result || previewImageData) return;
    if (canvasSourcePickMode) {
      if (e.button !== 0 || !e.isPrimary) return;
      e.preventDefault();
      const coords = getPixelCoordsFromEvent(e);
      if (!coords) return;
      const hex = readCanvasSourceColor(result.imageData,coords.x,coords.y);
      if (hex) onCanvasSourceColor(hex);
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();

    const coords = getPixelCoordsFromEvent(e);
    if (!coords) return;

    if (e.altKey || (e.button === 0 && editor.tool === 'eyedropper')) {
      const picked = getPixelAt(result.imageData, coords.x, coords.y);
      if (picked && picked.a > 0) {
        onUpdateEditor({
          colorHex: rgbToHex(picked.r, picked.g, picked.b),
          tool: editor.tool === 'eyedropper' ? 'pencil' : editor.tool,
        });
      }
      return;
    }

    const effectiveTool = e.button === 2 ? 'eraser' : editor.tool;

    if (effectiveTool === 'bucket') {
      const next = cloneImageData(result.imageData);
      const rgb = hexToRgb(editor.colorHex);
      const changed = floodFillOrReplace(
        next,
        coords.x,
        coords.y,
        { r: rgb.r, g: rgb.g, b: rgb.b, a: 255 },
        editor.tolerance,
        editor.contiguous
      );
      if (changed > 0) onCommitImageData(next);
      return;
    }

    if (effectiveTool === 'wand') {
      const next = cloneImageData(result.imageData);
      const changed = floodFillOrReplace(
        next,
        coords.x,
        coords.y,
        { r: 0, g: 0, b: 0, a: 0 },
        editor.tolerance,
        editor.contiguous
      );
      if (changed > 0) onCommitImageData(next);
      return;
    }

    const rgb = hexToRgb(editor.colorHex);
    const strokeColor: RGBA =
      effectiveTool === 'eraser'
        ? { r: 0, g: 0, b: 0, a: 0 }
        : { r: rgb.r, g: rgb.g, b: rgb.b, a: 255 };

    const working = cloneImageData(result.imageData);
    drawBrushStroke(working, coords.x, coords.y, coords.x, coords.y, editor.brushSize, strokeColor);
    workingImgRef.current = working;
    strokeActiveRef.current = {
      active: true,
      lastX: coords.x,
      lastY: coords.y,
      color: strokeColor,
      size: editor.brushSize,
    };

    syncCanvasesWithImageData(working);
    e.currentTarget.setPointerCapture(e.pointerId);
    updateHoverInfo(coords);
  };

  const handleEditPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const coords = getPixelCoordsFromEvent(e);
    if (strokeActiveRef.current.active && workingImgRef.current && coords) {
      const st = strokeActiveRef.current;
      if (coords.x !== st.lastX || coords.y !== st.lastY) {
        drawBrushStroke(workingImgRef.current, st.lastX, st.lastY, coords.x, coords.y, st.size, st.color);
        st.lastX = coords.x;
        st.lastY = coords.y;
        syncCanvasesWithImageData(workingImgRef.current);
      }
    }
    updateHoverInfo(coords);
  };

  const finishEditStroke = (e?: React.PointerEvent<HTMLDivElement>) => {
    if (!strokeActiveRef.current.active) return;
    strokeActiveRef.current.active = false;
    if (e && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (workingImgRef.current) {
      onCommitImageData(cloneImageData(workingImgRef.current));
      workingImgRef.current = null;
    }
  };

  const targetRatio = config.targetW / config.targetH;
  const availW = Math.max(180, viewportSize.w - (viewMode === 'side-by-side' ? 72 : 40));
  const availH = Math.max(120, viewportSize.h - 48);

  const singleSlotMaxW = viewMode === 'side-by-side' ? Math.floor((availW - 24) / 2) : availW;
  const singleSlotMaxH = availH;

  let baseDispW = singleSlotMaxW;
  let baseDispH = baseDispW / targetRatio;
  if (baseDispH > singleSlotMaxH) {
    baseDispH = singleSlotMaxH;
    baseDispW = baseDispH * targetRatio;
  }

  const dispW = Math.round(baseDispW * zoom);
  const dispH = Math.round(baseDispH * zoom);

  const cropPreviewSize = (() => {
    if (!sourceImage) return { w: 320, h: 320 };
    const maxW = Math.max(160, Math.min(availW, 760));
    const maxH = Math.max(160, Math.min(availH - 56, 560));
    const ratio = sourceImage.naturalWidth / Math.max(1, sourceImage.naturalHeight);
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
  })();

  const backdropClass =
    backdrop === 'checker'
      ? 'bg-checkerboard'
      : backdrop === 'dark'
        ? 'bg-[#090B0E]'
        : 'bg-[#E5E7EB]';

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
    if (files.length > 0) {
      onUploadFiles(files, 'replace');
    }
  };

  useEffect(() => {
    if (canvasSourcePickMode && window.matchMedia('(max-width: 767px)').matches) {
      editCanvasBoxRef.current?.scrollIntoView({block:'nearest',inline:'nearest'});
    }
  }, [canvasSourcePickMode]);

  const brushPreviewRect = (() => {
    if (viewMode !== 'edit' || !hoverPixel || !result) return null;
    const isSingleCellTool =
      !!canvasSourcePickMode || editor.tool === 'eyedropper' || editor.tool === 'bucket' || editor.tool === 'wand';
    const sz = isSingleCellTool ? 1 : editor.brushSize;
    const half = Math.floor((sz - 1) / 2);
    const startX = Math.max(0, hoverPixel.x - half);
    const startY = Math.max(0, hoverPixel.y - half);
    const endX = Math.min(result.width, hoverPixel.x - half + sz);
    const endY = Math.min(result.height, hoverPixel.y - half + sz);
    const cellW = dispW / result.width;
    const cellH = dispH / result.height;
    return {
      left: startX * cellW,
      top: startY * cellH,
      width: (endX - startX) * cellW,
      height: (endY - startY) * cellH,
      isErase: !canvasSourcePickMode && (editor.tool === 'eraser' || editor.tool === 'wand'),
    };
  })();

  return (
    <div
      className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#0B0D11] relative select-none"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setIsDragOver(true);
        }
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Compact single-row toolbar: horizontally scrolls on narrow viewports
          instead of wrapping into additional rows and shrinking the canvas. */}
      <div className="shrink-0 border-b border-[#222733] bg-[#0F1218]">
        <div className="flex items-center gap-2 px-3 py-1.5 overflow-x-auto studio-scroll whitespace-nowrap">
          <select
            aria-label={t('toolbar.sampleAria')}
            title={t('toolbar.sampleTitle')}
            value={activeSampleId ?? ''}
            onChange={(e) => {
              const sample = samples.find((item) => item.id === e.target.value);
              if (sample) onSelectSample(sample);
            }}
            className="shrink-0 max-w-[168px] py-1 px-1.5 text-[11px] bg-[#161A23] border border-[#2D3546] text-[#CBD5E1] rounded cursor-pointer"
          >
            <option value="">{t('toolbar.samplePlaceholder')}</option>
            {samples.map((sample) => (
              <option key={sample.id} value={sample.id}>{sample.label}</option>
            ))}
          </select>

          {viewMode === 'animate' && (
            <>
              <div className="h-4 w-px shrink-0 bg-[#262B38]" aria-hidden="true" />

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={timelineFrames.length < 2}
                  onClick={() => onStepFrame(-1)}
                  title={t('toolbar.prevFrameTitle')}
                  aria-label={t('toolbar.prevFrame')}
                  className="p-1 border border-[#262C3B] bg-[#161A23] hover:bg-[#232B3C] text-[#CBD5E1] disabled:opacity-35 rounded cursor-pointer"
                >
                  <SkipBack className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  disabled={timelineFrames.length < 2}
                  onClick={onTogglePlay}
                  title={isPlaying ? t('toolbar.pauseTitle') : t('toolbar.playTitle')}
                  className={'inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded disabled:opacity-40 cursor-pointer ' + (isPlaying
                    ? 'bg-amber-400 hover:bg-amber-300 text-[#0B0D11]'
                    : 'bg-sky-400 hover:bg-sky-300 text-[#081018]')}
                >
                  {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  {isPlaying ? t('toolbar.pause') : t('toolbar.play')}
                </button>
                <button
                  type="button"
                  disabled={timelineFrames.length < 2}
                  onClick={() => onStepFrame(1)}
                  title={t('toolbar.nextFrameTitle')}
                  aria-label={t('toolbar.nextFrame')}
                  className="p-1 border border-[#262C3B] bg-[#161A23] hover:bg-[#232B3C] text-[#CBD5E1] disabled:opacity-35 rounded cursor-pointer"
                >
                  <SkipForward className="w-3 h-3" />
                </button>
              </div>

              <span className="shrink-0 px-0.5 text-[11px] font-mono tabular-nums text-sky-300">
                {String(Math.max(1, activeFrameIdx + 1)).padStart(2, '0')}/{String(timelineFrames.length).padStart(2, '0')}
              </span>

              <div className="flex shrink-0 items-center gap-0.5 p-0.5 border border-[#262C3B] bg-[#0D1017] rounded">
                {FPS_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => onChangeFps(preset)}
                    title={preset + ' FPS'}
                    className={'px-1.5 py-0.5 text-[11px] font-mono rounded cursor-pointer ' + (fps === preset
                      ? 'bg-[#262E40] text-sky-300 font-medium'
                      : 'text-[#94A3B8] hover:text-white')}
                  >
                    {preset}
                  </button>
                ))}
                <label className="inline-flex items-center gap-1 pl-1.5 border-l border-[#262C3B] text-[10px] text-[#94A3B8]">
                  <span>FPS</span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    step={1}
                    value={fps}
                    aria-label={t('toolbar.fpsInputAria')}
                    onChange={(e) => {
                      if (e.target.value !== '') {
                        onChangeFps(Math.max(1, Math.min(30, Number(e.target.value))));
                      }
                    }}
                    className="w-10 bg-transparent text-center text-[11px] font-mono text-sky-300 outline-none"
                  />
                </label>
              </div>

              {activeFrameId && (
                <button
                  type="button"
                  onClick={() => onEditFrame(activeFrameId)}
                  title={t('toolbar.editCurrentTitle')}
                  className="inline-flex shrink-0 items-center gap-1 px-2 py-1 border border-[#2D3546] bg-[#1A202D] hover:bg-[#232B3C] rounded text-[11px] text-[#E2E8F0] cursor-pointer"
                >
                  <Pencil className="w-3 h-3 text-sky-400" />
                  {t('toolbar.editCurrent')}
                </button>
              )}
            </>
          )}

          {isBatchProcessing && (
            <span className="shrink-0 text-[11px] text-sky-300">{t('toolbar.batchProcessing')}</span>
          )}

          {viewMode !== 'crop' && (
            <>
              <div className="h-4 w-px shrink-0 bg-[#262B38] ml-auto" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setShowGrid((value) => !value)}
                title={t('toolbar.gridTitle')}
                className={'inline-flex shrink-0 items-center gap-1 px-2 py-1 text-[11px] rounded border cursor-pointer ' + (showGrid
                  ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                  : 'bg-[#161A23] border-[#2D3546] text-[#CBD5E1] hover:border-sky-400/50')}
              >
                <Grid3X3 className="w-3 h-3" />
                {showGrid ? t('toolbar.gridOn') : t('toolbar.gridOff')}
              </button>

              <select
                aria-label={t('toolbar.backdropAria')}
                title={t('toolbar.backdropTitle')}
                value={backdrop}
                onChange={(e) => setBackdrop(e.target.value as BackdropMode)}
                className="shrink-0 px-1.5 py-1 border border-[#2D3546] bg-[#161A23] text-[11px] text-[#CBD5E1] rounded cursor-pointer"
              >
                <option value="checker">{t('toolbar.backdropChecker')}</option>
                <option value="dark">{t('toolbar.backdropDark')}</option>
                <option value="light">{t('toolbar.backdropLight')}</option>
              </select>

              <div className="flex shrink-0 items-center gap-1 px-1 py-0.5 border border-[#262B38] bg-[#161A23] rounded">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.25).toFixed(2)))}
                  title={t('toolbar.zoomOut')}
                  aria-label={t('toolbar.zoomOut')}
                  className="p-0.5 text-[#94A3B8] hover:text-[#F1F5F9] cursor-pointer"
                >
                  <ZoomOut className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                  title={t('toolbar.zoomResetTitle')}
                  className="px-1 text-[11px] font-mono tabular-nums text-[#CBD5E1] hover:text-sky-300 cursor-pointer"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.25).toFixed(2)))}
                  title={t('toolbar.zoomIn')}
                  aria-label={t('toolbar.zoomIn')}
                  className="p-0.5 text-[#94A3B8] hover:text-[#F1F5F9] cursor-pointer"
                >
                  <ZoomIn className="w-3 h-3" />
                </button>
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowShortcutHelp((value) => !value)}
            title={t('toolbar.shortcutsAria')}
            aria-label={t('toolbar.shortcutsAria')}
            aria-expanded={showShortcutHelp}
            className="shrink-0 p-1 text-[#94A3B8] hover:text-sky-300 bg-[#161A23] border border-[#2D3546] rounded cursor-pointer"
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Phase 2 Pixel Editor Bar (visible in Edit Mode) */}
      {viewMode === 'edit' && sourceImage && result && (
        <PixelEditorBar
          editor={editor}
          palette={result.palette}
          canvasPicking={!!canvasSourcePickMode}
          canStartCanvasSourcePick={canStartCanvasSourcePick}
          onToolbarReplace={onToolbarReplace}
          onRevealDocumentPalette={onRevealDocumentPalette}
          canUndo={canUndo}
          canRedo={canRedo}
          hasManualEdits={hasManualEdits}
          editStepCount={editStepCount}
          onUpdateEditor={onUpdateEditor}
          onUndo={onUndo}
          onRedo={onRedo}
          onAutoRemoveBg={onAutoRemoveBg}
          onResetEdits={onResetEdits}
        />
      )}

      {canvasSourcePickMode && (
        <div role="status" className="px-4 py-2 bg-sky-500/10 border-b border-sky-500/30 flex flex-wrap items-center justify-between gap-2 text-xs text-sky-100 shrink-0">
          <span>{t(canvasSourcePickMode==='manual'?'documentPalette.canvasPickManualHint':'documentPalette.canvasPickSingleHint')}</span>
          <div className="flex gap-2">
            {canvasSourcePickMode==='manual' && <button type="button" onClick={onFinishCanvasSourcePick} className="px-2 py-1 rounded bg-sky-600 text-white">{t('documentPalette.canvasPickDone')}</button>}
            <button type="button" onClick={onCancelPalettePreview} className="px-2 py-1 border border-[#2D3546] rounded">{t('documentPalette.canvasPickCancel')}</button>
          </div>
        </div>
      )}
      {previewImageData && (
        <div role="status" className="px-4 py-2 bg-sky-500/10 border-b border-sky-500/30 flex flex-wrap items-center justify-between gap-2 text-xs text-sky-100 shrink-0">
          <span>{t(sequencePreviewActive ? 'sequencePalette.previewNotice' : 'documentPalette.previewNotice')}</span>
          <button type="button" onClick={onCancelPalettePreview} className="px-2.5 py-1 bg-[#161A23] border border-[#2D3546] rounded hover:text-sky-300">
            {t('documentPalette.cancelPreview')}
          </button>
        </div>
      )}

      {/* Pending Reconversion Protection Notice */}
      {hasPendingReconvert && (
        <div className="px-4 py-2 bg-amber-500/12 border-b border-amber-500/30 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-100 shrink-0">
          <span>{t('reconvert.notice')}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onApplyPendingReconvert}
              className="px-2.5 py-1 bg-amber-400 hover:bg-amber-300 text-[#0B0D11] font-medium rounded transition-colors cursor-pointer"
            >
              {t('reconvert.apply')}
            </button>
            <button
              type="button"
              onClick={onDismissPendingReconvert}
              className="px-2.5 py-1 bg-[#1A1F2B] hover:bg-[#252C3D] text-amber-100 border border-amber-500/30 rounded transition-colors cursor-pointer"
            >
              {t('reconvert.keep')}
            </button>
          </div>
        </div>
      )}

      {/* Main Canvas Stage */}
      <div className="flex-1 min-h-0 relative flex flex-col">
        <div
          ref={containerRef}
          onMouseDown={handleStageMouseDown}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerUp}
          onPointerCancel={handleStagePointerUp}
          className={`flex-1 min-h-0 flex p-3 sm:p-4 ${
            viewMode === 'edit'
              ? `overflow-hidden ${isPanning ? 'cursor-grabbing' : ''}`
              : 'overflow-auto studio-scroll'
          }`}
        >
          <div
            className="m-auto shrink-0"
            style={
              viewMode === 'edit'
                ? { transform: `translate3d(${pan.x}px, ${pan.y}px, 0)` }
                : undefined
            }
          >
        {!sourceImage ? (
          <div
            onClick={onOpenUpload}
            className="max-w-md w-full border border-dashed border-[#333B4D] hover:border-sky-400/60 bg-[#12151C] rounded-lg p-10 text-center cursor-pointer transition-colors"
          >
            <ImagePlus className="w-8 h-8 text-sky-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-[#F1F5F9] mb-1">
              {t('stage.emptyTitle')}
            </p>
            <p className="text-xs text-[#94A3B8]">
              {t('stage.emptyDesc')}
            </p>
          </div>
        ) : viewMode === 'crop' ? (
          /* Interactive Crop Editor */
          <div className="flex flex-col items-center gap-3">
            <div className="flex flex-wrap items-center gap-3 text-xs text-[#94A3B8]">
              <span>
                {t('crop.hintPrefix')}{' '}
                <strong className="font-mono text-sky-300">
                  {config.targetW}:{config.targetH}
                </strong>
                {timelineFrames.length > 1 ? t('crop.hintMulti') : ''}
              </span>
              <button
                type="button"
                onClick={() =>
                  onChangeCrop(
                    computeCenteredAspectCrop(
                      sourceImage.naturalWidth,
                      sourceImage.naturalHeight,
                      config.targetW,
                      config.targetH
                    )
                  )
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#1A1F2B] hover:bg-[#232A3A] text-[#E2E8F0] border border-[#2D3546] rounded text-xs cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                {t('crop.center')}
              </button>
              <button
                type="button"
                onClick={() =>
                  onChangeViewMode(timelineFrames.length > 1 ? 'animate' : 'side-by-side')
                }
                className="inline-flex items-center gap-1 px-3 py-1 bg-sky-500 hover:bg-sky-400 text-[#090C10] font-medium rounded text-xs cursor-pointer"
              >
                <CropIcon className="w-3 h-3" />
                {t('crop.done')}
              </button>
            </div>

            <div
              ref={cropBoxRef}
              className="relative inline-block border border-[#2D3546] shadow-2xl overflow-hidden bg-checkerboard"
              style={{
                width: cropPreviewSize.w,
                height: cropPreviewSize.h,
              }}
            >
              <canvas
                ref={cropPreviewCanvasRef}
                aria-label={t('crop.previewAria')}
                className={`block w-full h-full select-none ${
                  sourceImage.naturalWidth <= 256 && sourceImage.naturalHeight <= 256 ? 'pixelated' : ''
                }`}
              />

              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: 'rgba(6, 8, 12, 0.62)',
                  clipPath: `polygon(
                    0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                    ${config.crop.x * 100}% ${config.crop.y * 100}%,
                    ${config.crop.x * 100}% ${(config.crop.y + config.crop.h) * 100}%,
                    ${(config.crop.x + config.crop.w) * 100}% ${(config.crop.y + config.crop.h) * 100}%,
                    ${(config.crop.x + config.crop.w) * 100}% ${config.crop.y * 100}%,
                    ${config.crop.x * 100}% ${config.crop.y * 100}%
                  )`,
                }}
              />

              <div
                onPointerDown={(e) => startCropDrag('move', e)}
                className="absolute border-2 border-sky-400 cursor-move"
                style={{
                  left: `${config.crop.x * 100}%`,
                  top: `${config.crop.y * 100}%`,
                  width: `${config.crop.w * 100}%`,
                  height: `${config.crop.h * 100}%`,
                }}
              >
                <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3">
                  <div className="border-r border-b border-white/20" />
                  <div className="border-r border-b border-white/20" />
                  <div className="border-b border-white/20" />
                  <div className="border-r border-b border-white/20" />
                  <div className="border-r border-b border-white/20" />
                  <div className="border-b border-white/20" />
                  <div className="border-r border-white/20" />
                  <div className="border-r border-white/20" />
                  <div />
                </div>

                {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                  <div
                    key={corner}
                    onPointerDown={(e) => startCropDrag(corner, e)}
                    className={`absolute w-3.5 h-3.5 bg-sky-400 border-2 border-[#0B0D11] rounded-xs ${
                      corner === 'nw'
                        ? '-top-2 -left-2 cursor-nwse-resize'
                        : corner === 'ne'
                          ? '-top-2 -right-2 cursor-nesw-resize'
                          : corner === 'sw'
                            ? '-bottom-2 -left-2 cursor-nesw-resize'
                            : '-bottom-2 -right-2 cursor-nwse-resize'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : viewMode === 'edit' ? (
          /* Interactive Pixel Touch-Up & Background Removal Canvas */
          <div className="flex flex-col items-center gap-2">
            <div className="w-full flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-[#94A3B8]">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-[#F1F5F9] font-medium whitespace-nowrap">
                  {timelineFrames.length > 1
                    ? t('edit.framePrefix', { n: activeFrameIdx + 1 })
                    : ''}
                  {canvasSourcePickMode ? t('documentPalette.canvasPick') : t(`edit.title.${editor.tool}`)}
                </span>
                <span className="text-[11px] text-[#8B95A8]">
                  {canvasSourcePickMode ? t('documentPalette.canvasPickShortHint') : t(`edit.hint.${editor.tool}`)}
                  {t('edit.hint.zoomPan')}
                </span>
              </div>
              <span className="font-mono tabular-nums text-sky-300 shrink-0">
                {config.targetW}×{config.targetH}
              </span>
            </div>

            <div
              ref={editCanvasBoxRef}
              onPointerDown={handleEditPointerDown}
              onPointerMove={handleEditPointerMove}
              onPointerUp={finishEditStroke}
              onPointerCancel={finishEditStroke}
              onPointerLeave={() => {
                if (!strokeActiveRef.current.active) setHoverPixel(null);
              }}
              onContextMenu={(e) => e.preventDefault()}
              className={`border border-[#333C4F] overflow-hidden relative touch-none cursor-crosshair ${backdropClass}`}
              style={{ width: dispW, height: dispH }}
            >
              <canvas ref={pixelCanvasRef} className="w-full h-full block pixelated" />
              {showGrid && (
                <PixelGridOverlay
                  width={dispW}
                  height={dispH}
                  cols={config.targetW}
                  rows={config.targetH}
                />
              )}

              {brushPreviewRect && (
                <div
                  className={`absolute pointer-events-none box-border border-2 ${
                    brushPreviewRect.isErase
                      ? 'border-rose-400 bg-rose-400/20'
                      : 'border-sky-300 bg-sky-400/15'
                  }`}
                  style={{
                    left: brushPreviewRect.left,
                    top: brushPreviewRect.top,
                    width: Math.max(2, brushPreviewRect.width),
                    height: Math.max(2, brushPreviewRect.height),
                  }}
                />
              )}
            </div>
          </div>
        ) : viewMode === 'animate' ? (
          /* Animation Playback Stage */
          <div className="flex flex-col items-center gap-2">
            <div className="w-full flex items-center justify-between gap-4 text-xs text-[#94A3B8]">
              <span className="text-[#F1F5F9] font-medium truncate max-w-[260px]">
                {isPlaying ? t('animate.playing', { fps }) : t('animate.paused')} · {sourceName}
              </span>
              <span className="font-mono tabular-nums text-sky-300 shrink-0">
                {config.targetW}×{config.targetH}
              </span>
            </div>
            <div
              className={`border border-[#262B38] overflow-hidden relative ${backdropClass}`}
              style={{ width: dispW, height: dispH }}
            >
              <canvas ref={pixelCanvasRef} className="w-full h-full block pixelated" />
              {showGrid && (
                <PixelGridOverlay
                  width={dispW}
                  height={dispH}
                  cols={config.targetW}
                  rows={config.targetH}
                />
              )}
            </div>
          </div>
        ) : viewMode === 'side-by-side' ? (
          /* Side-by-Side Synced Comparison */
          <div className="flex flex-col md:flex-row items-center justify-center gap-6">
            <div className="flex flex-col items-center gap-2">
              <div className="w-full flex items-center justify-between text-xs text-[#94A3B8]">
                <span>{t('compare.sourceTitle')}</span>
                <span className="font-mono tabular-nums">
                  {Math.round(config.crop.w * sourceImage.naturalWidth)}×
                  {Math.round(config.crop.h * sourceImage.naturalHeight)}
                </span>
              </div>
              <div
                className={`border border-[#262B38] overflow-hidden relative ${backdropClass}`}
                style={{ width: dispW, height: dispH }}
              >
                <canvas ref={sourceCropCanvasRef} className="w-full h-full block" />
              </div>
            </div>

            <div className="flex flex-col items-center gap-2">
              <div className="w-full flex items-center justify-between text-xs text-[#94A3B8]">
                <span className="text-[#F1F5F9] font-medium">
                  {t('compare.pixelTitle')}
                  {hasManualEdits ? t('compare.editedSuffix') : ''}
                </span>
                <span className="font-mono tabular-nums text-sky-300">
                  {config.targetW}×{config.targetH}
                </span>
              </div>
              <div
                className={`border border-[#262B38] overflow-hidden relative ${backdropClass}`}
                style={{ width: dispW, height: dispH }}
              >
                <canvas ref={pixelCanvasRef} className="w-full h-full block pixelated" />
                {showGrid && (
                  <PixelGridOverlay
                    width={dispW}
                    height={dispH}
                    cols={config.targetW}
                    rows={config.targetH}
                  />
                )}
              </div>
            </div>
          </div>
        ) : viewMode === 'split' ? (
          /* Interactive Split Slider Comparison */
          <div className="flex flex-col items-center gap-2">
            <div className="w-full flex items-center justify-between text-xs text-[#94A3B8]">
              <span>{t('split.left')}</span>
              <span>{t('split.middle')}</span>
              <span className="text-sky-300">
                {t('split.right', { w: config.targetW, h: config.targetH })}
              </span>
            </div>
            <div
              id="split-compare-frame"
              className={`border border-[#262B38] overflow-hidden relative ${backdropClass}`}
              style={{ width: dispW, height: dispH }}
            >
              <canvas ref={sourceCropCanvasRef} className="w-full h-full block" />

              <div
                className="absolute inset-0 overflow-hidden"
                style={{ clipPath: `inset(0 0 0 ${splitPos}%)` }}
              >
                <canvas ref={pixelCanvasRef} className="w-full h-full block pixelated" />
                {showGrid && (
                  <PixelGridOverlay
                    width={dispW}
                    height={dispH}
                    cols={config.targetW}
                    rows={config.targetH}
                  />
                )}
              </div>

              <div
                onPointerDown={(e) => {
                  e.preventDefault();
                  setIsDraggingSplit(true);
                }}
                className="absolute top-0 bottom-0 w-0.5 bg-sky-400 cursor-ew-resize z-10"
                style={{ left: `${splitPos}%` }}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-[#0F1218] border border-sky-400 text-sky-300 flex items-center justify-center shadow-lg">
                  <MoveHorizontal className="w-3.5 h-3.5" />
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Pixel Art Only Focus Mode */
          <div className="flex flex-col items-center gap-2">
            <div className="w-full flex items-center justify-between text-xs text-[#94A3B8]">
              <span className="text-[#F1F5F9] font-medium">
                {t('pixel.previewTitle')}
                {hasManualEdits ? t('compare.editedSuffix') : ''}
              </span>
              <span className="font-mono tabular-nums text-sky-300">
                {config.targetW}×{config.targetH}
              </span>
            </div>
            <div
              className={`border border-[#262B38] overflow-hidden relative ${backdropClass}`}
              style={{ width: dispW, height: dispH }}
            >
              <canvas ref={pixelCanvasRef} className="w-full h-full block pixelated" />
              {showGrid && (
                <PixelGridOverlay
                  width={dispW}
                  height={dispH}
                  cols={config.targetW}
                  rows={config.targetH}
                />
              )}
            </div>
          </div>
        )}
          </div>
        </div>

        {/* Compact coordinate readout replaces the fixed 32px bottom bar. */}
        {viewMode === 'edit' && hoverPixel && (
          <div className="absolute bottom-2 left-2 z-20 pointer-events-none flex items-center gap-2 px-2 py-1 bg-[#0D1016]/95 border border-[#2D3546] rounded text-[11px] font-mono tabular-nums text-[#CBD5E1]">
            <span>X:{hoverPixel.x} Y:{hoverPixel.y}</span>
            {hoverPixel.isTransparent ? (
              <span className="text-[#94A3B8]">{t('edit.transparentPixel')}</span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <span
                  className="w-2.5 h-2.5 rounded-[1px] border border-white/25"
                  style={{ backgroundColor: hoverPixel.hex || '#000' }}
                />
                {hoverPixel.hex}
              </span>
            )}
          </div>
        )}

        {showShortcutHelp && (
          <div role="dialog" aria-label={t('shortcuts.dialogAria')} className="absolute right-3 top-3 z-40 max-w-[min(360px,calc(100%-24px))] p-3 bg-[#151B26] border border-[#364056] shadow-xl rounded-md text-xs text-[#CBD5E1]">
            <div className="flex items-center justify-between gap-4 mb-2">
              <span className="font-semibold text-[#F1F5F9]">{t('shortcuts.title')}</span>
              <button
                type="button"
                onClick={() => setShowShortcutHelp(false)}
                aria-label={t('shortcuts.closeAria')}
                className="text-[#94A3B8] hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="leading-relaxed">{t('shortcuts.global')}</p>
            {viewMode === 'animate' && (
              <p className="mt-1.5 leading-relaxed">{t('shortcuts.animate')}</p>
            )}
            {viewMode === 'edit' && (
              <p className="mt-1.5 leading-relaxed">{t('shortcuts.edit')}</p>
            )}
          </div>
        )}

        {/* Floating 1:1 Actual Size Preview Panel (syncs live with animation playback too!) */}
        {sourceImage && result && viewMode !== 'crop' && (
          <div className="fixed md:absolute bottom-4 right-4 z-20 bg-[#12161F]/95 border border-[#262B38] rounded-md shadow-xl overflow-hidden">
            <div className="px-2.5 py-1.5 border-b border-[#222733] flex items-center justify-between gap-4">
              <span className="text-[11px] font-medium text-[#CBD5E1] whitespace-nowrap">
                {viewMode === 'animate' && isPlaying ? t('realSize.liveTitle', { fps }) : t('realSize.title')}
              </span>
              <button
                type="button"
                onClick={() => setShowRealSize((v) => !v)}
                className="text-[#94A3B8] hover:text-[#F1F5F9] transition-colors cursor-pointer"
                aria-label={showRealSize ? t('realSize.collapseAria') : t('realSize.expandAria')}
              >
                {showRealSize ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            {showRealSize && (
              <div className="p-3 flex items-end gap-4">
                <div className="flex flex-col items-center gap-1">
                  <div className={`border border-[#2C3344] ${backdropClass}`}>
                    <canvas
                      ref={actual1xCanvasRef}
                      className="block pixelated"
                      style={{ width: result.width, height: result.height }}
                    />
                  </div>
                  <span className="text-[10px] font-mono tabular-nums text-[#8B95A8]">
                    1:1 ({result.width}×{result.height})
                  </span>
                </div>
                {result.width <= 96 && result.height <= 96 && (
                  <div className="flex flex-col items-center gap-1">
                    <div className={`border border-[#2C3344] ${backdropClass}`}>
                      <canvas
                        ref={actual2xCanvasRef}
                        className="block pixelated"
                        style={{ width: result.width * 2, height: result.height * 2 }}
                      />
                    </div>
                    <span className="text-[10px] font-mono tabular-nums text-[#8B95A8]">
                      2× ({result.width * 2}×{result.height * 2})
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Compact Frame Timeline Bar (when multi-frame or in Animate mode) */}
      {showTimeline && (
        <FrameTimelineBar
          frames={timelineFrames}
          activeFrameId={activeFrameId}
          isPlaying={isPlaying}
          onSelectFrame={onSelectFrame}
          onEditFrame={onEditFrame}
          onReorderFrames={onReorderFrames}
          onDeleteFrame={onDeleteFrame}
          onAppendFiles={(files) => onUploadFiles(files, 'append')}
        />
      )}

      {/* Drag-and-Drop Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-sky-500/10 border-2 border-dashed border-sky-400 flex items-center justify-center z-30 pointer-events-none">
          <div className="px-5 py-3 bg-[#0F1218] border border-sky-400/50 rounded-md text-sm font-medium text-sky-200 shadow-xl flex items-center gap-2">
            <Maximize2 className="w-4 h-4 text-sky-400" />
            {t('stage.dropOverlay')}
          </div>
        </div>
      )}

    </div>
  );
}
