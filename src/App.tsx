import React, { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { CanvasViewport, ViewMode } from './components/CanvasViewport';
import { ControlPanel } from './components/ControlPanel';
import {
  CropRect,
  DEFAULT_ENGINE_CONFIG,
  PixelEngineConfig,
  PixelEngineResult,
  computeCenteredAspectCrop,
  exportPixelPngBlob,
  runPixelConversion,
} from './lib/pixelEngine';

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
];

export default function App() {
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [sourceName, setSourceName] = useState<string>('騎士立繪.jpg');
  const [activeSampleId, setActiveSampleId] = useState<string | null>(BUILTIN_SAMPLES[0].id);
  const [config, setConfig] = useState<PixelEngineConfig>(DEFAULT_ENGINE_CONFIG);
  const [result, setResult] = useState<PixelEngineResult | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [lockAspect, setLockAspect] = useState<boolean>(false);
  const [exportScale, setExportScale] = useState<number>(8);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadImageUrl = useCallback(
    (url: string, label: string, suggestedDims?: { w: number; h: number }, revokeAfter?: boolean) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        setErrorMsg(null);
        setSourceImage(img);
        setSourceName(label);
        setConfig((prev) => {
          const nextW = suggestedDims ? suggestedDims.w : prev.targetW;
          const nextH = suggestedDims ? suggestedDims.h : prev.targetH;
          const crop = computeCenteredAspectCrop(img.naturalWidth, img.naturalHeight, nextW, nextH);
          return { ...prev, targetW: nextW, targetH: nextH, crop };
        });
        if (revokeAfter) {
          // Keep object URL alive for crop preview img; clean up previous URLs via separate effect if needed
        }
      };
      img.onerror = () => {
        setErrorMsg('圖片載入失敗，請確認檔案格式為 PNG / JPG / WebP。');
      };
      img.src = url;
    },
    []
  );

  // Load initial built-in high-res 2D sample so conversion quality is immediately inspectable
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
        setSourceImage(img);
        setSourceName(file.name || '剪貼簿圖片.png');

        // Automatically compute smart default pixel dimensions matching source aspect ratio
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
    []
  );

  // Global Ctrl+V clipboard paste support for rapid testing
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

  // Run pixel art conversion smoothly whenever image or config changes
  useEffect(() => {
    if (!sourceImage) return;
    let cancelled = false;
    const rafId = window.requestAnimationFrame(() => {
      if (cancelled) return;
      try {
        const res = runPixelConversion(sourceImage, config);
        if (!cancelled) {
          setResult(res);
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

  const handleUpdateConfig = useCallback((patch: Partial<PixelEngineConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSelectDimensions = useCallback(
    (w: number, h: number) => {
      setConfig((prev) => {
        const crop = sourceImage
          ? computeCenteredAspectCrop(sourceImage.naturalWidth, sourceImage.naturalHeight, w, h)
          : prev.crop;
        return { ...prev, targetW: w, targetH: h, crop };
      });
    },
    [sourceImage]
  );

  const handleChangeCrop = useCallback((crop: CropRect) => {
    setConfig((prev) => ({ ...prev, crop }));
  }, []);

  const handleResetConfig = useCallback(() => {
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
  }, [sourceImage]);

  const handleDownloadPng = useCallback(async () => {
    if (!result) return;
    try {
      const blob = await exportPixelPngBlob(result.imageData, exportScale);
      const url = URL.createObjectURL(blob);
      const baseName = sourceName.replace(/\.[^.]+$/, '');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}_${result.width}x${result.height}_${exportScale}x.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setErrorMsg('匯出 PNG 失敗，請再試一次。');
    }
  }, [result, exportScale, sourceName]);

  const handleCopyPng = useCallback(async () => {
    if (!result) return;
    try {
      const blob = await exportPixelPngBlob(result.imageData, exportScale);
      if (navigator.clipboard && 'ClipboardItem' in window) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      }
    } catch {
      setErrorMsg('目前瀏覽器環境不允許直接寫入圖片到剪貼簿，請使用「下載 PNG」。');
    }
  }, [result, exportScale]);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#0B0D11] text-[#F1F5F9]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="h-13 px-5 border-b border-[#222733] bg-[#0F1218] flex items-center justify-between gap-8 shrink-0">
        {/* Zone 1: Single-line Brand Wordmark */}
        <span className="text-base font-bold tracking-tight text-[#F8FAFC] whitespace-nowrap shrink-0">
          PixForge
        </span>

        {/* Zone 2: 4 Single-line View Mode Links */}
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
            disabled={!result}
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
          result={result}
          config={config}
          viewMode={viewMode}
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
          result={result}
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
          onDownloadPng={handleDownloadPng}
          onCopyPng={handleCopyPng}
        />
      </main>
    </div>
  );
}
