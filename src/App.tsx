import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { CanvasViewport, ViewMode } from './components/CanvasViewport';
import { ControlPanel } from './components/ControlPanel';
import { PixelEditorState } from './components/PixelEditorBar';
import { rgbToHex } from './lib/palettes';
import {
  CropRect,
  DEFAULT_ENGINE_CONFIG,
  PixelEngineConfig,
  PixelEngineResult,
  computeCenteredAspectCrop,
  exportPixelPngBlob,
  runPixelConversion,
} from './lib/pixelEngine';
import { autoRemoveCornerBackground, cloneImageData } from './lib/pixelEditOps';

const BUILTIN_SAMPLES = [
  {
    id: 'rpg-knight',
    label: '範例：騎士立繪 (1:1)',
    src: '/src/assets/images/sample_rpg_knight_1795397004570.jpg',
    defaultW: 64,
    defaultH: 64,
  },
  {
    id: 'fantasy-tavern',
    label: '範例：煉金小屋 (4:3)',
    src: '/src/assets/images/sample_fantasy_tavern_1795397003478.jpg',
    defaultW: 96,
    defaultH: 72,
  },
];

const VIEW_TABS: Array<{ id: ViewMode; label: string }> = [
  { id: 'side-by-side', label: '並排對照' },
  { id: 'split', label: '拉桿對比' },
  { id: 'pixel', label: '僅看像素' },
  { id: 'crop', label: '範圍裁切' },
  { id: 'edit', label: '像素精修' },
];

const MAX_HISTORY = 40;

function extractPaletteFromImageData(data: Uint8ClampedArray): {
  palette: string[];
  uniqueColorCount: number;
} {
  const seen = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  const entries = Array.from(seen.entries());
  const limited =
    entries.length > 64 ? entries.sort((a, b) => b[1] - a[1]).slice(0, 48) : entries;
  const palette = limited
    .map(([key]) => {
      const r = (key >> 16) & 255;
      const g = (key >> 8) & 255;
      const b = key & 255;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      return { hex: rgbToHex(r, g, b), lum };
    })
    .sort((a, b) => a.lum - b.lum)
    .map((x) => x.hex);

  return { palette, uniqueColorCount: seen.size };
}

export default function App() {
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [sourceName, setSourceName] = useState<string>('騎士立繪.jpg');
  const [activeSampleId, setActiveSampleId] = useState<string | null>(BUILTIN_SAMPLES[0].id);
  const [config, setConfig] = useState<PixelEngineConfig>(DEFAULT_ENGINE_CONFIG);
  const [convertedResult, setConvertedResult] = useState<PixelEngineResult | null>(null);

  // Phase 2 Editable Layer & Undo/Redo History
  const [editHistory, setEditHistory] = useState<ImageData[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [hasPendingReconvert, setHasPendingReconvert] = useState<boolean>(false);

  const [editor, setEditor] = useState<PixelEditorState>({
    tool: 'pencil',
    brushSize: 1,
    colorHex: '#181425',
    tolerance: 26,
    contiguous: true,
  });

  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [lockAspect, setLockAspect] = useState<boolean>(false);
  const [exportScale, setExportScale] = useState<number>(8);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hasManualEdits = historyIndex > 0 && editHistory.length > 0;
  const activeEditedImageData =
    hasManualEdits && historyIndex >= 0 && historyIndex < editHistory.length
      ? editHistory[historyIndex]
      : null;

  // Unified active pixel result (seamlessly reflects manual edits across preview, 1:1, and export!)
  const activeResult: PixelEngineResult | null = useMemo(() => {
    if (!convertedResult) return null;
    if (
      activeEditedImageData &&
      activeEditedImageData.width === convertedResult.width &&
      activeEditedImageData.height === convertedResult.height
    ) {
      const { palette, uniqueColorCount } = extractPaletteFromImageData(
        activeEditedImageData.data
      );
      return {
        imageData: activeEditedImageData,
        width: activeEditedImageData.width,
        height: activeEditedImageData.height,
        palette,
        uniqueColorCount,
        computeMs: convertedResult.computeMs,
      };
    }
    return convertedResult;
  }, [convertedResult, activeEditedImageData]);

  const clearManualEdits = useCallback(() => {
    setEditHistory([]);
    setHistoryIndex(-1);
    setHasPendingReconvert(false);
  }, []);

  const loadImageUrl = useCallback(
    (url: string, label: string, suggestedDims?: { w: number; h: number }) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        setErrorMsg(null);
        clearManualEdits();
        setSourceImage(img);
        setSourceName(label);
        setConfig((prev) => {
          const nextW = suggestedDims ? suggestedDims.w : prev.targetW;
          const nextH = suggestedDims ? suggestedDims.h : prev.targetH;
          const crop = computeCenteredAspectCrop(img.naturalWidth, img.naturalHeight, nextW, nextH);
          return { ...prev, targetW: nextW, targetH: nextH, crop };
        });
      };
      img.onerror = () => {
        setErrorMsg('圖片載入失敗，請確認檔案格式為 PNG / JPG / WebP。');
      };
      img.src = url;
    },
    [clearManualEdits]
  );

  // Load initial built-in sample
  useEffect(() => {
    const first = BUILTIN_SAMPLES[0];
    loadImageUrl(first.src, '騎士立繪.jpg', { w: first.defaultW, h: first.defaultH });
  }, [loadImageUrl]);

  // Upload file handler (input, drag & drop, or Ctrl+V paste)
  const handleUploadFile = useCallback(
    (file: File) => {
      const objectUrl = URL.createObjectURL(file);
      setActiveSampleId(null);

      const img = new Image();
      img.onload = () => {
        setErrorMsg(null);
        clearManualEdits();
        setSourceImage(img);
        setSourceName(file.name || '剪貼簿圖片.png');

        setConfig((prev) => {
          const ratio = img.naturalWidth / img.naturalHeight;
          let nextW = prev.targetW;
          let nextH = prev.targetH;
          if (Math.abs(ratio - 1) > 0.08) {
            const base = Math.max(prev.targetW, prev.targetH);
            if (ratio > 1) {
              nextW = Math.min(256, Math.max(16, base));
              nextH = Math.min(256, Math.max(8, Math.round(nextW / ratio)));
            } else {
              nextH = Math.min(256, Math.max(16, base));
              nextW = Math.min(256, Math.max(8, Math.round(nextH * ratio)));
            }
          }
          const crop = computeCenteredAspectCrop(img.naturalWidth, img.naturalHeight, nextW, nextH);
          return { ...prev, targetW: nextW, targetH: nextH, crop };
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        setErrorMsg('無法讀取該圖片檔案，請改用 PNG / JPG / WebP 格式。');
      };
      img.src = objectUrl;
    },
    [clearManualEdits]
  );

  // Global Ctrl+V paste support
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            handleUploadFile(file);
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleUploadFile]);

  // Run pixel art conversion whenever image or config changes
  useEffect(() => {
    if (!sourceImage) return;
    let cancelled = false;
    const rafId = window.requestAnimationFrame(() => {
      if (cancelled) return;
      try {
        const res = runPixelConversion(sourceImage, config);
        if (!cancelled) {
          setConvertedResult(res);
          setErrorMsg(null);
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : '轉換運算發生錯誤');
        }
      }
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [sourceImage, config]);

  // Commit a new edited pixel frame onto the Undo/Redo stack
  const handleCommitImageData = useCallback(
    (next: ImageData) => {
      if (!convertedResult) return;
      setHasPendingReconvert(false);
      setEditHistory((prev) => {
        // Seed index 0 with the untouched automatic conversion so Ctrl+Z can revert all the way back!
        const base =
          prev.length === 0 || historyIndex < 0
            ? [cloneImageData(convertedResult.imageData)]
            : prev.slice(0, historyIndex + 1);
        const appended = [...base, cloneImageData(next)];
        if (appended.length > MAX_HISTORY) {
          const trimmed = appended.slice(appended.length - MAX_HISTORY);
          setHistoryIndex(trimmed.length - 1);
          return trimmed;
        }
        setHistoryIndex(appended.length - 1);
        return appended;
      });
    },
    [convertedResult, historyIndex]
  );

  const handleUndo = useCallback(() => {
    setHistoryIndex((idx) => (idx > 0 ? idx - 1 : idx));
  }, []);

  const handleRedo = useCallback(() => {
    setHistoryIndex((idx) => (idx < editHistory.length - 1 ? idx + 1 : idx));
  }, [editHistory.length]);

  const handleAutoRemoveBg = useCallback(() => {
    if (!activeResult) return;
    const next = cloneImageData(activeResult.imageData);
    const removed = autoRemoveCornerBackground(next, Math.max(12, editor.tolerance));
    if (removed > 0) {
      handleCommitImageData(next);
    }
  }, [activeResult, editor.tolerance, handleCommitImageData]);

  // Keyboard shortcuts for Edit Mode (B/E/I/G/W + Ctrl+Z / Ctrl+Y)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        if (editHistory.length > 0) {
          e.preventDefault();
          if (e.shiftKey) handleRedo();
          else handleUndo();
        }
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (editHistory.length > 0) {
          e.preventDefault();
          handleRedo();
        }
        return;
      }

      if (viewMode !== 'edit' || mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'b') setEditor((p) => ({ ...p, tool: 'pencil' }));
      else if (k === 'e') setEditor((p) => ({ ...p, tool: 'eraser' }));
      else if (k === 'i') setEditor((p) => ({ ...p, tool: 'eyedropper' }));
      else if (k === 'g') setEditor((p) => ({ ...p, tool: 'bucket' }));
      else if (k === 'w') setEditor((p) => ({ ...p, tool: 'wand' }));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewMode, editHistory.length, handleUndo, handleRedo]);

  const handleUpdateConfig = useCallback(
    (patch: Partial<PixelEngineConfig>) => {
      setConfig((prev) => ({ ...prev, ...patch }));
      if (hasManualEdits) {
        setHasPendingReconvert(true);
      }
    },
    [hasManualEdits]
  );

  const handleSelectDimensions = useCallback(
    (w: number, h: number) => {
      clearManualEdits();
      setConfig((prev) => {
        const crop = sourceImage
          ? computeCenteredAspectCrop(sourceImage.naturalWidth, sourceImage.naturalHeight, w, h)
          : prev.crop;
        return { ...prev, targetW: w, targetH: h, crop };
      });
    },
    [sourceImage, clearManualEdits]
  );

  const handleChangeCrop = useCallback(
    (crop: CropRect) => {
      clearManualEdits();
      setConfig((prev) => ({ ...prev, crop }));
    },
    [clearManualEdits]
  );

  const handleResetConfig = useCallback(() => {
    clearManualEdits();
    setConfig((prev) => ({
      ...DEFAULT_ENGINE_CONFIG,
      targetW: prev.targetW,
      targetH: prev.targetH,
      crop: sourceImage
        ? computeCenteredAspectCrop(
            sourceImage.naturalWidth,
            sourceImage.naturalHeight,
            prev.targetW,
            prev.targetH
          )
        : DEFAULT_ENGINE_CONFIG.crop,
    }));
  }, [sourceImage, clearManualEdits]);

  const handlePickColor = useCallback((hex: string) => {
    setEditor((prev) => ({ ...prev, colorHex: hex }));
  }, []);

  const handleDownloadPng = useCallback(async () => {
    if (!activeResult) return;
    try {
      const blob = await exportPixelPngBlob(activeResult.imageData, exportScale);
      const url = URL.createObjectURL(blob);
      const baseName = sourceName.replace(/\.[^.]+$/, '');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}_${activeResult.width}x${activeResult.height}_${exportScale}x.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setErrorMsg('匯出 PNG 失敗，請再試一次。');
    }
  }, [activeResult, exportScale, sourceName]);

  const handleCopyPng = useCallback(async () => {
    if (!activeResult) return;
    try {
      const blob = await exportPixelPngBlob(activeResult.imageData, exportScale);
      if (navigator.clipboard && 'ClipboardItem' in window) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      }
    } catch {
      setErrorMsg('目前瀏覽器環境不允許直接寫入圖片到剪貼簿，請使用「下載 PNG」。');
    }
  }, [activeResult, exportScale]);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#0B0D11] text-[#F1F5F9]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="h-13 px-5 border-b border-[#222733] bg-[#0F1218] flex items-center justify-between gap-8 shrink-0">
        {/* Zone 1: Single-line Brand Wordmark */}
        <span className="text-base font-bold tracking-tight text-[#F8FAFC] whitespace-nowrap shrink-0">
          PixForge
        </span>

        {/* Zone 2: 5 Single-line Mode Links */}
        <nav className="flex items-center gap-6 h-full overflow-x-auto">
          {VIEW_TABS.map((tab) => {
            const active = viewMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setViewMode(tab.id)}
                className={`relative h-full inline-flex items-center text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active ? 'text-[#F8FAFC] font-medium' : 'text-[#8B95A8] hover:text-[#E2E8F0]'
                }`}
              >
                {tab.label}
                {active && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-400" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="shrink-0">
          <button
            type="button"
            disabled={!activeResult}
            onClick={handleDownloadPng}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#081018] bg-sky-400 hover:bg-sky-300 disabled:opacity-40 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            下載 PNG
          </button>
        </div>
      </header>

      {/* Error banner if needed */}
      {errorMsg && (
        <div className="px-5 py-2 bg-rose-500/15 border-b border-rose-500/30 text-xs text-rose-200 flex items-center justify-between">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-300 hover:text-white cursor-pointer"
          >
            關閉
          </button>
        </div>
      )}

      {/* Main Studio Workspace */}
      <main className="flex-1 flex flex-col md:flex-row min-h-0 overflow-y-auto md:overflow-hidden">
        <CanvasViewport
          sourceImage={sourceImage}
          sourceName={sourceName}
          result={activeResult}
          config={config}
          viewMode={viewMode}
          editor={editor}
          canUndo={historyIndex > 0}
          canRedo={historyIndex >= 0 && historyIndex < editHistory.length - 1}
          hasManualEdits={hasManualEdits}
          editStepCount={Math.max(0, historyIndex)}
          hasPendingReconvert={hasPendingReconvert}
          onUpdateEditor={(patch) => setEditor((p) => ({ ...p, ...patch }))}
          onCommitImageData={handleCommitImageData}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onAutoRemoveBg={handleAutoRemoveBg}
          onResetEdits={clearManualEdits}
          onApplyPendingReconvert={clearManualEdits}
          onDismissPendingReconvert={() => setHasPendingReconvert(false)}
          onChangeCrop={handleChangeCrop}
          onSelectDimensions={handleSelectDimensions}
          onUploadFile={handleUploadFile}
          samples={BUILTIN_SAMPLES}
          activeSampleId={activeSampleId}
          onSelectSample={(s) => {
            const full = BUILTIN_SAMPLES.find((b) => b.id === s.id);
            if (!full) return;
            setActiveSampleId(full.id);
            loadImageUrl(full.src, `${full.label.replace('範例：', '')}.jpg`, {
              w: full.defaultW,
              h: full.defaultH,
            });
          }}
          onChangeViewMode={setViewMode}
        />

        <ControlPanel
          config={config}
          result={activeResult}
          sourceSize={
            sourceImage
              ? { w: sourceImage.naturalWidth, h: sourceImage.naturalHeight }
              : null
          }
          lockAspect={lockAspect}
          exportScale={exportScale}
          onChangeExportScale={setExportScale}
          onToggleLockAspect={() => setLockAspect((v) => !v)}
          onUpdateConfig={handleUpdateConfig}
          onSelectDimensions={handleSelectDimensions}
          onResetConfig={handleResetConfig}
          onOpenCropMode={() => setViewMode('crop')}
          onPickColor={handlePickColor}
          onDownloadPng={handleDownloadPng}
          onCopyPng={handleCopyPng}
        />
      </main>
    </div>
  );
}
