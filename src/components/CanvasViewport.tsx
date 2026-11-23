import React, { useEffect, useRef, useState } from 'react';
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
  Film,
} from 'lucide-react';
import { hexToRgb, rgbToHex } from '../lib/palettes';
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pixelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceCropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const actual1xCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const actual2xCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [zoom, setZoom] = useState<number>(1);
  const [showGrid, setShowGrid] = useState<boolean>(false);
  const [hasEnteredEditOnce, setHasEnteredEditOnce] = useState<boolean>(false);
  const [backdrop, setBackdrop] = useState<BackdropMode>('checker');
  const [splitPos, setSplitPos] = useState<number>(50);
  const [isDraggingSplit, setIsDraggingSplit] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [showRealSize, setShowRealSize] = useState<boolean>(true);
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
    syncCanvasesWithImageData(result.imageData);
  }, [result, viewMode, showRealSize]);

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
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * result.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * result.height);
    if (x < 0 || x >= result.width || y < 0 || y >= result.height) return null;
    return { x, y };
  };

  const updateHoverInfo = (coords: { x: number; y: number } | null) => {
    if (!coords || !result) {
      setHoverPixel(null);
      return;
    }
    const img = strokeActiveRef.current.active && workingImgRef.current ? workingImgRef.current : result.imageData;
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
    if (!result) return;
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
  const availW = Math.max(220, viewportSize.w - (viewMode === 'side-by-side' ? 96 : 64));
  const availH = Math.max(200, viewportSize.h - 80);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files).filter((f) => f.type.startsWith('image/')) : [];
    if (files.length > 0) {
      onUploadFiles(files, 'replace');
    }
    e.target.value = '';
  };

  const brushPreviewRect = (() => {
    if (viewMode !== 'edit' || !hoverPixel || !result) return null;
    const isSingleCellTool =
      editor.tool === 'eyedropper' || editor.tool === 'bucket' || editor.tool === 'wand';
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
      isErase: editor.tool === 'eraser' || editor.tool === 'wand',
    };
  })();

  return (
    <div
      className="flex-1 flex flex-col min-w-0 min-h-[420px] bg-[#0B0D11] relative select-none"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setIsDragOver(true);
        }
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Contextual Workspace Toolbar */}
      <div className="px-3.5 py-2 border-b border-[#222733] bg-[#0F1218] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="可選取單張圖片，或一次多選多張連續圖自動建立動畫序列"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#F1F5F9] bg-[#1C212D] hover:bg-[#252C3B] border border-[#2D3546] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ImagePlus className="w-3.5 h-3.5 text-sky-400" />
            上傳圖片 / 多張動畫
          </button>

          <div className="h-4 w-px bg-[#262B38] mx-0.5" aria-hidden="true" />

          <div className="flex items-center gap-1">
            {samples.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSample(s)}
                className={`px-2 py-1 text-xs rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeSampleId === s.id
                    ? 'bg-[#222836] text-sky-300 font-medium'
                    : 'text-[#94A3B8] hover:text-[#E2E8F0] hover:bg-[#171B24]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right Canvas Controls: Batch Status, Grid, Backdrop, Zoom */}
        <div className="flex flex-wrap items-center gap-2">
          {isBatchProcessing && (
            <span className="text-xs text-sky-300 font-mono tabular-nums whitespace-nowrap">
              批次轉換中…
            </span>
          )}

          {sourceImage && result && !isBatchProcessing && (
            <div className="hidden 2xl:flex items-center gap-2 text-xs text-[#94A3B8] font-mono tabular-nums whitespace-nowrap mr-1">
              <span className="max-w-[120px] truncate text-[#CBD5E1] font-sans">{sourceName}</span>
              <span aria-hidden="true">·</span>
              <span className="text-sky-300">
                {result.width}×{result.height}
              </span>
              <span aria-hidden="true">·</span>
              <span>{result.uniqueColorCount} 色</span>
            </div>
          )}

          {viewMode !== 'crop' && (
            <>
              <button
                type="button"
                onClick={() => setShowGrid((g) => !g)}
                title="顯示或隱藏像素格線（含 8×8 區塊輔助線）"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  showGrid
                    ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                    : 'bg-[#161A23] border-[#2D3546] text-[#CBD5E1] hover:border-sky-400/50 hover:text-white'
                }`}
              >
                <Grid3X3 className="w-3.5 h-3.5" />
                {showGrid ? '格線：開' : '格線：關'}
              </button>

              <div className="flex items-center bg-[#161A23] border border-[#262B38] rounded-md p-0.5">
                {(['checker', 'dark', 'light'] as BackdropMode[]).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBackdrop(b)}
                    className={`px-2 py-1 text-[11px] rounded transition-colors whitespace-nowrap cursor-pointer ${
                      backdrop === b
                        ? 'bg-[#262C3B] text-[#F1F5F9] font-medium'
                        : 'text-[#8B95A8] hover:text-[#CBD5E1]'
                    }`}
                  >
                    {b === 'checker' ? '棋盤' : b === 'dark' ? '黑底' : '白底'}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 bg-[#161A23] border border-[#262B38] rounded-md px-1 py-0.5">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                  className="p-1 text-[#94A3B8] hover:text-[#F1F5F9] transition-colors cursor-pointer"
                  aria-label="縮小"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom(1)}
                  className="px-1.5 text-xs font-mono tabular-nums text-[#CBD5E1] hover:text-sky-300 transition-colors cursor-pointer"
                  title="重設為符合視窗"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(6, +(z + 0.25).toFixed(2)))}
                  className="p-1 text-[#94A3B8] hover:text-[#F1F5F9] transition-colors cursor-pointer"
                  aria-label="放大"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Animation Playback Bar (visible in Animate Mode) */}
      {viewMode === 'animate' && (
        <div className="px-3.5 py-2 border-b border-[#222733] bg-[#131722] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* Transport Controls */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={timelineFrames.length < 2}
                onClick={() => onStepFrame(-1)}
                title="上一格 (←)"
                className="p-1.5 bg-[#0D1017] hover:bg-[#1C2230] border border-[#262C3B] disabled:opacity-35 rounded text-[#CBD5E1] hover:text-white transition-colors cursor-pointer"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                disabled={timelineFrames.length < 2}
                onClick={onTogglePlay}
                title={isPlaying ? '暫停播放 (Space)' : '開始循環播放 (Space)'}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap disabled:opacity-40 cursor-pointer ${
                  isPlaying
                    ? 'bg-amber-400 hover:bg-amber-300 text-[#0B0D11]'
                    : 'bg-sky-400 hover:bg-sky-300 text-[#081018]'
                }`}
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {isPlaying ? '暫停' : '播放'}
              </button>

              <button
                type="button"
                disabled={timelineFrames.length < 2}
                onClick={() => onStepFrame(1)}
                title="下一格 (→)"
                className="p-1.5 bg-[#0D1017] hover:bg-[#1C2230] border border-[#262C3B] disabled:opacity-35 rounded text-[#CBD5E1] hover:text-white transition-colors cursor-pointer"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            </div>

            <span className="text-xs font-mono tabular-nums text-[#CBD5E1] px-1">
              影格{' '}
              <strong className="text-sky-300">
                {activeFrameIdx >= 0 ? String(activeFrameIdx + 1).padStart(2, '0') : '01'}
              </strong>{' '}
              / {String(timelineFrames.length).padStart(2, '0')}
            </span>

            <div className="h-4 w-px bg-[#262B38]" aria-hidden="true" />

            {/* Custom FPS Slider + Presets */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 px-2.5 py-1 bg-[#0D1017] border border-[#262C3B] rounded-md">
                <span className="text-[11px] text-[#94A3B8] whitespace-nowrap">播放速度</span>
                <input
                  type="range"
                  min={1}
                  max={30}
                  step={1}
                  value={fps}
                  onChange={(e) => onChangeFps(Number(e.target.value))}
                  className="w-24 studio-slider"
                />
                <span className="text-xs font-mono tabular-nums text-sky-300 w-12 text-right whitespace-nowrap">
                  {fps} FPS
                </span>
              </div>

              <div className="flex items-center bg-[#0D1017] border border-[#262C3B] rounded-md p-0.5">
                {FPS_PRESETS.map((presetFps) => (
                  <button
                    key={presetFps}
                    type="button"
                    onClick={() => onChangeFps(presetFps)}
                    className={`px-2 py-1 text-[11px] font-mono tabular-nums rounded transition-colors cursor-pointer ${
                      fps === presetFps
                        ? 'bg-[#262E40] text-sky-300 font-medium'
                        : 'text-[#8B95A8] hover:text-[#E2E8F0]'
                    }`}
                  >
                    {presetFps}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {activeFrameId && (
            <button
              type="button"
              onClick={() => onEditFrame(activeFrameId)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#E2E8F0] bg-[#1A202D] hover:bg-[#232B3C] border border-[#2D3546] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5 text-sky-400" />
              精修目前影格
            </button>
          )}
        </div>
      )}

      {/* Phase 2 Pixel Editor Bar (visible in Edit Mode) */}
      {viewMode === 'edit' && sourceImage && result && (
        <PixelEditorBar
          editor={editor}
          palette={result.palette}
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

      {/* Pending Reconversion Protection Notice */}
      {hasPendingReconvert && (
        <div className="px-4 py-2 bg-amber-500/12 border-b border-amber-500/30 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-100 shrink-0">
          <span>
            轉換參數或動畫影格已變更，目前保留手動修圖結果。套用新轉換將覆蓋手修版本。
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onApplyPendingReconvert}
              className="px-2.5 py-1 bg-amber-400 hover:bg-amber-300 text-[#0B0D11] font-medium rounded transition-colors cursor-pointer"
            >
              套用新轉換（覆蓋手修）
            </button>
            <button
              type="button"
              onClick={onDismissPendingReconvert}
              className="px-2.5 py-1 bg-[#1A1F2B] hover:bg-[#252C3D] text-amber-100 border border-amber-500/30 rounded transition-colors cursor-pointer"
            >
              維持目前修圖
            </button>
          </div>
        </div>
      )}

      {/* Single-Frame Hint inside Animate Mode */}
      {viewMode === 'animate' && timelineFrames.length <= 1 && (
        <div className="px-4 py-2 bg-sky-500/10 border-b border-sky-500/25 flex flex-wrap items-center justify-between gap-2 text-xs text-sky-100 shrink-0">
          <span className="inline-flex items-center gap-1.5">
            <Film className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            目前僅有 1 張影格。請一次多選多張連續圖（例如 8 張動作序列），或點下方「追加影格」即可開始動畫播放。
          </span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-2.5 py-1 bg-sky-400 hover:bg-sky-300 text-[#081018] font-medium rounded transition-colors whitespace-nowrap cursor-pointer"
          >
            一次選取多張連續圖
          </button>
        </div>
      )}

      {/* Main Canvas Stage */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto studio-scroll flex items-center justify-center p-6 relative"
      >
        {!sourceImage ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="max-w-md w-full border border-dashed border-[#333B4D] hover:border-sky-400/60 bg-[#12151C] rounded-lg p-10 text-center cursor-pointer transition-colors"
          >
            <ImagePlus className="w-8 h-8 text-sky-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-[#F1F5F9] mb-1">
              點擊上傳單張或一次多選多張連續動畫圖
            </p>
            <p className="text-xs text-[#94A3B8]">
              支援 PNG / JPG / WebP，也可以拖曳整組連續圖或按 Ctrl+V 貼上
            </p>
          </div>
        ) : viewMode === 'crop' ? (
          /* Interactive Crop Editor */
          <div className="flex flex-col items-center gap-3">
            <div className="flex flex-wrap items-center gap-3 text-xs text-[#94A3B8]">
              <span>
                拖曳裁切框或四角控制點，系統會自動鎖定輸出比例{' '}
                <strong className="font-mono text-sky-300">
                  {config.targetW}:{config.targetH}
                </strong>
                {timelineFrames.length > 1 ? '（將同步套用到全部影格）' : ''}
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
                置中符合比例
              </button>
              <button
                type="button"
                onClick={() =>
                  onChangeViewMode(timelineFrames.length > 1 ? 'animate' : 'side-by-side')
                }
                className="inline-flex items-center gap-1 px-3 py-1 bg-sky-500 hover:bg-sky-400 text-[#090C10] font-medium rounded text-xs cursor-pointer"
              >
                <CropIcon className="w-3 h-3" />
                完成裁切
              </button>
            </div>

            <div
              ref={cropBoxRef}
              className="relative inline-block border border-[#2D3546] shadow-2xl overflow-hidden bg-checkerboard"
              style={{
                maxWidth: Math.min(availW, 760),
                maxHeight: Math.min(availH - 48, 600),
              }}
            >
              <img
                src={sourceImage.src}
                alt="原圖裁切檢視"
                draggable={false}
                className="block max-w-full max-h-[55vh] object-contain select-none"
                referrerPolicy="no-referrer"
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
            <div className="w-full flex items-center justify-between gap-4 text-xs text-[#94A3B8]">
              <span className="text-[#F1F5F9] font-medium">
                {timelineFrames.length > 1
                  ? `第 ${activeFrameIdx + 1} 格精修 · `
                  : ''}
                {editor.tool === 'pencil'
                  ? '畫筆精修（左鍵點塗 · 右鍵快速點格去背）'
                  : editor.tool === 'eraser'
                    ? '橡皮擦手動去背（點擊或拖曳像素格變透明）'
                    : editor.tool === 'eyedropper'
                      ? '滴管吸色（點擊任意像素吸取顏色）'
                      : editor.tool === 'bucket'
                        ? '油漆桶填色（點擊區域填滿目前顏色）'
                        : '魔術棒去背（點擊背景區域一次清除為透明）'}
              </span>
              <span className="font-mono tabular-nums text-sky-300 shrink-0">
                {config.targetW}×{config.targetH}
              </span>
            </div>

            <div
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
                {isPlaying ? `播放中（${fps} FPS）` : '已暫停'} · {sourceName}
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
                <span>高解析原圖（裁切後）</span>
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
                  像素轉換結果{hasManualEdits ? '（已手動精修）' : ''}
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
              <span>左側：高解析原圖</span>
              <span>拖曳中線檢視線條與五官保留度</span>
              <span className="text-sky-300">
                右側：像素結果 ({config.targetW}×{config.targetH})
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
                像素預覽{hasManualEdits ? '（已手動精修）' : ''}
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

        {/* Floating 1:1 Actual Size Preview Panel (syncs live with animation playback too!) */}
        {sourceImage && result && viewMode !== 'crop' && (
          <div className="fixed md:absolute bottom-4 right-4 z-20 bg-[#12161F]/95 border border-[#262B38] rounded-md shadow-xl overflow-hidden">
            <div className="px-2.5 py-1.5 border-b border-[#222733] flex items-center justify-between gap-4">
              <span className="text-[11px] font-medium text-[#CBD5E1] whitespace-nowrap">
                {viewMode === 'animate' && isPlaying ? `1:1 動態預覽 (${fps} FPS)` : '實際尺寸預覽'}
              </span>
              <button
                type="button"
                onClick={() => setShowRealSize((v) => !v)}
                className="text-[#94A3B8] hover:text-[#F1F5F9] transition-colors cursor-pointer"
                aria-label={showRealSize ? '收合實際尺寸預覽' : '展開實際尺寸預覽'}
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
            放開即可載入單張圖片或整組連續動畫序列
          </div>
        </div>
      )}

      {/* Bottom Contextual Hint & Live Pixel Coordinate Bar */}
      <div className="h-8 px-4 border-t border-[#1D212C] bg-[#0D1016] flex items-center justify-between gap-4 text-[11px] text-[#7A879C] shrink-0">
        {viewMode === 'edit' ? (
          <>
            <div className="flex items-center gap-3 font-mono tabular-nums">
              {hoverPixel ? (
                <>
                  <span className="text-[#CBD5E1]">
                    X:{hoverPixel.x} Y:{hoverPixel.y}
                  </span>
                  <span aria-hidden="true">·</span>
                  {hoverPixel.isTransparent ? (
                    <span className="text-[#94A3B8]">透明像素</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[#CBD5E1]">
                      <span
                        className="w-2.5 h-2.5 rounded-[1px] border border-white/25 inline-block"
                        style={{ backgroundColor: hoverPixel.hex || '#000' }}
                      />
                      {hoverPixel.hex}
                    </span>
                  )}
                </>
              ) : (
                <span className="font-sans">
                  快捷鍵：B 畫筆 · E 橡皮擦去背 · I 滴管 · G 油漆桶 · W 魔術棒 · Ctrl+Z 復原
                </span>
              )}
            </div>
            <span className="hidden sm:inline whitespace-nowrap">
              右鍵可直接點格去背 · Alt+點擊吸色
            </span>
          </>
        ) : viewMode === 'animate' ? (
          <>
            <span>快捷鍵：Space 播放／暫停 · 左右方向鍵逐格切換 · 雙擊時間軸縮圖進入單格精修</span>
            <span className="hidden sm:inline whitespace-nowrap">所有動畫合成與 GIF/ZIP 編碼皆於本地執行</span>
          </>
        ) : (
          <>
            <span>提示：可一次拖曳多張連續圖自動建立動畫序列，或按 Ctrl+V 貼上圖片</span>
            <span className="hidden sm:inline whitespace-nowrap">所有影像運算皆於瀏覽器本地執行</span>
          </>
        )}
      </div>
    </div>
  );
}
