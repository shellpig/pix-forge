import React, { useEffect, useRef, useState } from 'react';
import {
  Grid3X3,
  ImagePlus,
  Maximize2,
  Minimize2,
  MoveHorizontal,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Crop as CropIcon,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  CropRect,
  PixelEngineConfig,
  PixelEngineResult,
  computeCenteredAspectCrop,
} from '../lib/pixelEngine';

export type ViewMode = 'side-by-side' | 'split' | 'pixel' | 'crop';
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
  onChangeCrop: (crop: CropRect) => void;
  onSelectDimensions: (w: number, h: number) => void;
  onUploadFile: (file: File) => void;
  samples: SampleItem[];
  activeSampleId: string | null;
  onSelectSample: (sample: SampleItem) => void;
  onChangeViewMode: (mode: ViewMode) => void;
}

const QUICK_RES_BUTTONS: Array<[number, number]> = [
  [16, 16],
  [32, 32],
  [48, 48],
  [64, 64],
  [96, 96],
  [128, 128],
];

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
    // Draw every pixel boundary when cells are >= 2.5px; otherwise draw every 2px/4px so lines stay clean & legible
    const step = cellW >= 2.5 && cellH >= 2.5 ? 1 : cellW >= 1.5 && cellH >= 1.5 ? 2 : 4;

    // Pass 1: subtle dark hairline (visible on light backgrounds like sky/silver hair)
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

    // Pass 2: subtle light offset hairline when cells are spacious enough (visible on dark areas like navy cape)
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

    // Pass 3: subtle 8x8 tile guide for sprite artists
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
  onChangeCrop,
  onSelectDimensions,
  onUploadFile,
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

  const [zoom, setZoom] = useState<number>(1); // 1 = fit nicely
  const [showGrid, setShowGrid] = useState<boolean>(false);
  const [backdrop, setBackdrop] = useState<BackdropMode>('checker');
  const [splitPos, setSplitPos] = useState<number>(50);
  const [isDraggingSplit, setIsDraggingSplit] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [showRealSize, setShowRealSize] = useState<boolean>(true);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });

  // Interactive crop state
  const cropBoxRef = useRef<HTMLDivElement | null>(null);
  const [cropDrag, setCropDrag] = useState<{
    handle: DragHandle;
    startX: number;
    startY: number;
    startCrop: CropRect;
    boxW: number;
    boxH: number;
  } | null>(null);

  // Measure viewport container for crisp auto-fit sizing
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

  // Draw pixel art result onto main pixel canvas and 1:1/2:1 floating preview canvases
  useEffect(() => {
    if (!result) return;
    const canvases = [pixelCanvasRef.current, actual1xCanvasRef.current, actual2xCanvasRef.current];
    for (const c of canvases) {
      if (!c) continue;
      c.width = result.width;
      c.height = result.height;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, result.width, result.height);
        ctx.putImageData(result.imageData, 0, 0);
      }
    }
  }, [result, viewMode, showRealSize]);

  // Draw cropped source image onto comparison source canvas
  useEffect(() => {
    const canvas = sourceCropCanvasRef.current;
    if (!canvas || !sourceImage || (viewMode !== 'side-by-side' && viewMode !== 'split')) return;

    const sx = config.crop.x * sourceImage.naturalWidth;
    const sy = config.crop.y * sourceImage.naturalHeight;
    const sw = Math.max(1, config.crop.w * sourceImage.naturalWidth);
    const sh = Math.max(1, config.crop.h * sourceImage.naturalHeight);

    // Keep source canvas crisp up to 1024px
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

  // Split handle pointer drag
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

  // Crop box pointer drag (maintains exact targetW : targetH aspect ratio)
  useEffect(() => {
    if (!cropDrag || !sourceImage) return;

    const srcRatio = sourceImage.naturalWidth / sourceImage.naturalHeight;
    const targetRatio = config.targetW / config.targetH;
    // Normalized crop height = normalized crop width * (srcRatio / targetRatio)
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

  // Compute crisp display dimensions so side-by-side / split / pixel canvases fit comfortably
  const targetRatio = config.targetW / config.targetH;
  const availW = Math.max(240, viewportSize.w - (viewMode === 'side-by-side' ? 96 : 64));
  const availH = Math.max(240, viewportSize.h - 96);

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
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onUploadFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadFile(file);
    }
    e.target.value = '';
  };

  return (
    <div
      className="flex-1 flex flex-col min-w-0 min-h-[420px] bg-[#0B0D11] relative select-none"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Contextual Workspace Toolbar (wraps cleanly so resolution & grid are always visible) */}
      <div className="px-3.5 py-2 border-b border-[#222733] bg-[#0F1218] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#F1F5F9] bg-[#1C212D] hover:bg-[#252C3B] border border-[#2D3546] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ImagePlus className="w-3.5 h-3.5 text-sky-400" />
            上傳圖片
          </button>

          <div className="h-4 w-px bg-[#262B38] mx-0.5" aria-hidden="true" />

          {/* Quick Resolution Switcher right on the Canvas Toolbar */}
          <div className="flex items-center bg-[#161A23] border border-[#262B38] rounded-md p-0.5">
            {QUICK_RES_BUTTONS.map(([w, h]) => {
              const active = config.targetW === w && config.targetH === h;
              return (
                <button
                  key={`${w}x${h}`}
                  type="button"
                  onClick={() => onSelectDimensions(w, h)}
                  className={`px-2 py-1 text-[11px] font-mono tabular-nums rounded transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-sky-500/20 text-sky-300 font-semibold'
                      : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                  }`}
                >
                  {w}×{h}
                </button>
              );
            })}
          </div>

          <div className="h-4 w-px bg-[#262B38] mx-0.5 hidden sm:block" aria-hidden="true" />

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

        {/* Right Canvas Controls: Grid, Backdrop, Zoom */}
        <div className="flex flex-wrap items-center gap-2">
          {sourceImage && result && (
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
              {/* Pixel Grid Toggle — Prominent & Always Visible */}
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

              {/* Backdrop Toggle */}
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

              {/* Zoom Controls */}
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
                  onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}
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
              點擊上傳或拖曳高解析 2D 圖片到這裡
            </p>
            <p className="text-xs text-[#94A3B8]">
              支援 PNG / JPG / WebP，也可以直接按 Ctrl+V 貼上剪貼簿圖片
            </p>
          </div>
        ) : viewMode === 'crop' ? (
          /* Interactive Crop Editor */
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-3 text-xs text-[#94A3B8]">
              <span>
                拖曳裁切框或四角控制點，系統會自動鎖定輸出比例{' '}
                <strong className="font-mono text-sky-300">
                  {config.targetW}:{config.targetH}
                </strong>
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
                onClick={() => onChangeViewMode('side-by-side')}
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
                maxHeight: Math.min(availH - 48, 620),
              }}
            >
              <img
                src={sourceImage.src}
                alt="原圖裁切檢視"
                draggable={false}
                className="block max-w-full max-h-[60vh] object-contain select-none"
                referrerPolicy="no-referrer"
              />

              {/* Dimmed overlay masks outside the crop rect */}
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

              {/* Interactive Crop Frame */}
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
                {/* Rule of thirds subtle guides */}
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

                {/* Corner Resize Handles */}
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
                <canvas
                  ref={sourceCropCanvasRef}
                  className="w-full h-full block"
                />
              </div>
            </div>

            <div className="flex flex-col items-center gap-2">
              <div className="w-full flex items-center justify-between text-xs text-[#94A3B8]">
                <span className="text-[#F1F5F9] font-medium">像素轉換結果</span>
                <span className="font-mono tabular-nums text-sky-300">
                  {config.targetW}×{config.targetH}
                </span>
              </div>
              <div
                className={`border border-[#262B38] overflow-hidden relative ${backdropClass}`}
                style={{ width: dispW, height: dispH }}
              >
                <canvas
                  ref={pixelCanvasRef}
                  className="w-full h-full block pixelated"
                />
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
              <span className="text-sky-300">右側：像素結果 ({config.targetW}×{config.targetH})</span>
            </div>
            <div
              id="split-compare-frame"
              className={`border border-[#262B38] overflow-hidden relative ${backdropClass}`}
              style={{ width: dispW, height: dispH }}
            >
              {/* Source underneath */}
              <canvas ref={sourceCropCanvasRef} className="w-full h-full block" />

              {/* Pixel result clipped on the right of splitPos */}
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

              {/* Draggable Divider */}
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
              <span className="text-[#F1F5F9] font-medium">像素預覽</span>
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

        {/* Floating 1:1 Actual Size Preview Panel */}
        {sourceImage && result && viewMode !== 'crop' && (
          <div className="fixed md:absolute bottom-4 right-4 z-20 bg-[#12161F]/95 border border-[#262B38] rounded-md shadow-xl overflow-hidden">
            <div className="px-2.5 py-1.5 border-b border-[#222733] flex items-center justify-between gap-4">
              <span className="text-[11px] font-medium text-[#CBD5E1] whitespace-nowrap">
                實際尺寸預覽
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

      {/* Drag-and-Drop Visual Indicator */}
      {isDragOver && (
        <div className="absolute inset-0 bg-sky-500/10 border-2 border-dashed border-sky-400 flex items-center justify-center z-30 pointer-events-none">
          <div className="px-5 py-3 bg-[#0F1218] border border-sky-400/50 rounded-md text-sm font-medium text-sky-200 shadow-xl flex items-center gap-2">
            <Maximize2 className="w-4 h-4 text-sky-400" />
            放開即可載入這張圖片進行像素轉換
          </div>
        </div>
      )}

      {/* Keyboard shortcut hint (subtle single line, non-telemetry) */}
      <div className="h-8 px-4 border-t border-[#1D212C] bg-[#0D1016] flex items-center justify-between text-[11px] text-[#64748B] shrink-0">
        <span>提示：可直接拖曳本機圖片到畫布，或按 Ctrl+V 貼上剪貼簿圖片</span>
        <span className="hidden sm:inline">所有影像運算皆於瀏覽器本地執行</span>
      </div>
    </div>
  );
}
