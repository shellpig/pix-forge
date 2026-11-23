import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { CanvasViewport, ViewMode } from './components/CanvasViewport';
import { ControlPanel } from './components/ControlPanel';
import { PixelEditorState } from './components/PixelEditorBar';
import { TimelineFramePreview } from './components/FrameTimelineBar';
import {
  CropRect,
  DEFAULT_ENGINE_CONFIG,
  PixelEngineConfig,
  PixelEngineResult,
  collectUsedPalette,
  computeCenteredAspectCrop,
  exportPixelPngBlob,
  runBatchPixelConversion,
} from './lib/pixelEngine';
import { autoRemoveCornerBackground, cloneImageData } from './lib/pixelEditOps';
import {
  appendFrameEdit,
  applyFrameConversion,
  getEffectiveFrameImageData,
} from './lib/frameHistory';
import {
  exportAnimatedGifBlob,
  exportFramesZipBlob,
  exportSpriteSheetPngBlob,
} from './lib/animationExport';

type BatchWorkerReply =
  | { type: 'success'; results: PixelEngineResult[] }
  | { type: 'error'; message: string };

interface AnimationFrameItem {
  id: string;
  name: string;
  sourceImage: HTMLImageElement;
  convertedResult: PixelEngineResult | null;
  editHistory: ImageData[];
  historyIndex: number;
}

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
  { id: 'animate', label: '動畫播放' },
];

const MAX_HISTORY = 40;
const NATURAL_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function makeFrameId(): string {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function loadHtmlImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('圖片載入失敗'));
    img.src = url;
  });
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export default function App() {
  const [frames, setFrames] = useState<AnimationFrameItem[]>([]);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);
  const [activeSampleId, setActiveSampleId] = useState<string | null>(BUILTIN_SAMPLES[0].id);

  const [config, setConfig] = useState<PixelEngineConfig>(DEFAULT_ENGINE_CONFIG);
  const [hasPendingReconvert, setHasPendingReconvert] = useState<boolean>(false);
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);

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
  const [spriteSheetCols, setSpriteSheetCols] = useState<number>(0); // 0 = single horizontal strip
  const [fps, setFps] = useState<number>(8);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Track frame membership, not timeline order: reordering should not restart the Worker.
  const sourceKey = useMemo(() => frames.map((f) => f.id).sort().join('|'), [frames]);
  const framesRef = useRef<AnimationFrameItem[]>(frames);
  framesRef.current = frames;

  const activeFrame = useMemo(() => {
    if (frames.length === 0) return null;
    return frames.find((f) => f.id === activeFrameId) || frames[0];
  }, [frames, activeFrameId]);

  const anyFrameHasManualEdits = useMemo(
    () => frames.some((f) => f.historyIndex > 0 && f.editHistory.length > 0),
    [frames]
  );

  const activeFrameHasManualEdits = Boolean(
    activeFrame && activeFrame.historyIndex > 0 && activeFrame.editHistory.length > 0
  );

  // Unified PixelEngineResult for the active frame (reflects manual edits seamlessly)
  const activeResult: PixelEngineResult | null = useMemo(() => {
    if (!activeFrame || !activeFrame.convertedResult) return null;
    const effective = getEffectiveFrameImageData(activeFrame);
    if (!effective) return null;
    if (effective === activeFrame.convertedResult.imageData) {
      return activeFrame.convertedResult;
    }
    const { swatches, totalUnique } = collectUsedPalette(effective.data);
    return {
      imageData: effective,
      width: effective.width,
      height: effective.height,
      palette: swatches,
      uniqueColorCount: totalUnique,
      computeMs: activeFrame.convertedResult.computeMs,
    };
  }, [activeFrame]);

  const timelineFrames: TimelineFramePreview[] = useMemo(
    () =>
      frames.map((f) => ({
        id: f.id,
        name: f.name,
        imageData: getEffectiveFrameImageData(f),
        hasManualEdits: f.historyIndex > 0 && f.editHistory.length > 0,
      })),
    [frames]
  );

  // Debounce slider changes, and run the complete batch conversion inside a
  // module Worker so heavy multi-frame processing never blocks React painting.
  useEffect(() => {
    const currentFrames = framesRef.current;
    if (currentFrames.length === 0) {
      setIsBatchProcessing(false);
      return;
    }

    let cancelled = false;
    let worker: Worker | null = null;
    let paintRaf = 0;
    let computeRaf = 0;
    setIsBatchProcessing(currentFrames.length > 1);

    const applyResults = (results: PixelEngineResult[]) => {
      if (cancelled) return;
      const resultById = new Map<string, PixelEngineResult>();
      currentFrames.forEach((frame, idx) => {
        if (results[idx]) resultById.set(frame.id, results[idx]);
      });
      setFrames((prev) =>
        prev.map((frame) => {
          const result = resultById.get(frame.id);
          return result ? applyFrameConversion(frame, result) : frame;
        })
      );
      setErrorMsg(null);
      setIsBatchProcessing(false);
    };

    const reportError = (err: unknown) => {
      if (cancelled) return;
      setErrorMsg(err instanceof Error ? err.message : String(err || '批次轉換運算發生錯誤'));
      setIsBatchProcessing(false);
    };

    // Older browsers without OffscreenCanvas/Workers retain a functional
    // fallback. Two rAFs permit a real paint of the busy indicator first.
    const runFallback = () => {
      paintRaf = window.requestAnimationFrame(() => {
        computeRaf = window.requestAnimationFrame(() => {
          if (cancelled) return;
          try {
            applyResults(runBatchPixelConversion(currentFrames.map((f) => f.sourceImage), config));
          } catch (err) {
            reportError(err);
          }
        });
      });
    };

    const timerId = window.setTimeout(async () => {
      if (cancelled) return;
      if (
        typeof Worker === 'undefined' ||
        typeof createImageBitmap !== 'function' ||
        typeof OffscreenCanvas === 'undefined'
      ) {
        runFallback();
        return;
      }

      let bitmaps: ImageBitmap[] = [];
      try {
        // Decoding to transferable bitmaps is asynchronous; the Worker owns
        // them after postMessage, and closes them once conversion completes.
        bitmaps = await Promise.all(currentFrames.map((f) => createImageBitmap(f.sourceImage)));
        if (cancelled) {
          bitmaps.forEach((bitmap) => bitmap.close());
          return;
        }

        worker = new Worker(new URL('./workers/pixelConversion.worker.ts', import.meta.url), {
          type: 'module',
        });
        worker.onmessage = ({ data }: MessageEvent<BatchWorkerReply>) => {
          if (cancelled) return;
          worker?.terminate();
          worker = null;
          if (data.type === 'success') applyResults(data.results);
          else reportError(data.message);
        };
        worker.onerror = (event) => {
          if (cancelled) return;
          event.preventDefault();
          worker?.terminate();
          worker = null;
          runFallback();
        };
        worker.postMessage({ config, images: bitmaps }, bitmaps);
      } catch {
        // No worker support or bitmap decode failure: use the original
        // conversion pipeline, but only after the pending paint.
        bitmaps.forEach((bitmap) => bitmap.close());
        worker?.terminate();
        worker = null;
        if (!cancelled) runFallback();
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
      window.cancelAnimationFrame(paintRaf);
      window.cancelAnimationFrame(computeRaf);
      worker?.terminate(); // Discard stale jobs when sliders or frames change.
    };
  }, [sourceKey, config]);

  // Animation playback loop (rAF with exact FPS delta accumulation)
  useEffect(() => {
    if (viewMode !== 'animate' || !isPlaying || frames.length < 2) return;

    let rafId = 0;
    let lastTime = performance.now();
    let acc = 0;
    const frameInterval = 1000 / Math.max(1, fps);

    const tick = (now: number) => {
      const dt = Math.min(250, now - lastTime);
      lastTime = now;
      acc += dt;

      if (acc >= frameInterval) {
        const steps = Math.floor(acc / frameInterval);
        acc -= steps * frameInterval;
        setActiveFrameId((prevId) => {
          const curFrames = framesRef.current;
          if (curFrames.length < 2) return prevId;
          const idx = curFrames.findIndex((f) => f.id === prevId);
          const nextIdx = ((idx >= 0 ? idx : 0) + steps) % curFrames.length;
          return curFrames[nextIdx].id;
        });
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [viewMode, isPlaying, fps, frames.length]);

  // Automatically pause animation playback if leaving Animate mode
  const handleChangeViewMode = useCallback((nextMode: ViewMode) => {
    if (nextMode !== 'animate') {
      setIsPlaying(false);
    }
    setViewMode(nextMode);
  }, []);

  const clearAllManualEdits = useCallback(() => {
    setFrames((prev) => prev.map((f) => ({ ...f, editHistory: [], historyIndex: -1 })));
    setHasPendingReconvert(false);
  }, []);

  const clearActiveFrameManualEdits = useCallback(() => {
    if (!activeFrame) return;
    setFrames((prev) =>
      prev.map((f) => (f.id === activeFrame.id ? { ...f, editHistory: [], historyIndex: -1 } : f))
    );
    setHasPendingReconvert(false);
  }, [activeFrame]);

  // Load built-in single sample
  const loadSample = useCallback(
    async (sample: (typeof BUILTIN_SAMPLES)[number]) => {
      try {
        const img = await loadHtmlImageFromUrl(sample.src);
        const id = makeFrameId();
        setErrorMsg(null);
        setActiveSampleId(sample.id);
        setIsPlaying(false);
        setHasPendingReconvert(false);
        setSpriteSheetCols(0);
        setFrames([
          {
            id,
            name: `${sample.label.replace('範例：', '')}.jpg`,
            sourceImage: img,
            convertedResult: null,
            editHistory: [],
            historyIndex: -1,
          },
        ]);
        setActiveFrameId(id);
        setConfig((prev) => {
          const crop = computeCenteredAspectCrop(
            img.naturalWidth,
            img.naturalHeight,
            sample.defaultW,
            sample.defaultH
          );
          return { ...prev, targetW: sample.defaultW, targetH: sample.defaultH, crop };
        });
      } catch {
        setErrorMsg('範例圖片載入失敗。');
      }
    },
    []
  );

  // Initial load
  useEffect(() => {
    loadSample(BUILTIN_SAMPLES[0]);
  }, [loadSample]);

  // Multi-file or single-file upload handler (with natural numeric filename sorting!)
  const handleUploadFiles = useCallback(async (rawFiles: File[], mode: 'replace' | 'append') => {
    const imageFiles = rawFiles
      .filter((f) => f.type.startsWith('image/'))
      .sort((a, b) => NATURAL_COLLATOR.compare(a.name, b.name));

    if (imageFiles.length === 0) return;

    try {
      const loaded = await Promise.all(
        imageFiles.map(async (file) => {
          const url = URL.createObjectURL(file);
          let img: HTMLImageElement;
          try {
            img = await loadHtmlImageFromUrl(url);
          } finally {
            // Release the temporary blob URL on both success and failure.
            // The loaded HTMLImageElement retains its decoded image.
            URL.revokeObjectURL(url);
          }
          return {
            id: makeFrameId(),
            name: file.name || '剪貼簿圖片.png',
            sourceImage: img,
            convertedResult: null,
            editHistory: [] as ImageData[],
            historyIndex: -1,
          };
        })
      );

      setErrorMsg(null);
      setActiveSampleId(null);

      if (mode === 'append' && framesRef.current.length > 0) {
        // A new frame can change the shared auto palette; keep existing manual
        // edits intact and let the user choose whether to apply the new result.
        if (framesRef.current.some((f) => f.historyIndex > 0 && f.editHistory.length > 0)) {
          setHasPendingReconvert(true);
        }
        setFrames((prev) => [...prev, ...loaded]);
        setActiveFrameId(loaded[0].id);
        if (framesRef.current.length + loaded.length > 1) {
          setViewMode('animate');
        }
        return;
      }

      // Replace workspace with newly uploaded image(s)
      const firstImg = loaded[0].sourceImage;
      setHasPendingReconvert(false);
      setSpriteSheetCols(0);
      setFrames(loaded);
      setActiveFrameId(loaded[0].id);

      setConfig((prev) => {
        const ratio = firstImg.naturalWidth / firstImg.naturalHeight;
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
        const crop = computeCenteredAspectCrop(
          firstImg.naturalWidth,
          firstImg.naturalHeight,
          nextW,
          nextH
        );
        return { ...prev, targetW: nextW, targetH: nextH, crop };
      });

      if (loaded.length > 1) {
        setViewMode('animate');
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
      }
    } catch {
      setErrorMsg('部分圖片無法讀取，請確認格式為 PNG / JPG / WebP。');
    }
  }, []);

  // Global Ctrl+V clipboard paste support
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        handleUploadFiles(files, viewMode === 'animate' && framesRef.current.length > 0 ? 'append' : 'replace');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleUploadFiles, viewMode]);

  // Commit edited pixel frame onto the active frame's Undo/Redo stack
  const handleCommitImageData = useCallback(
    (next: ImageData) => {
      if (!activeFrame || !activeFrame.convertedResult) return;
      const targetId = activeFrame.id;
      // Ongoing painting must not silently dismiss a pending palette change.

      setFrames((prev) =>
        prev.map((f) => {
          if (f.id !== targetId || !f.convertedResult) return f;
          return appendFrameEdit(f, next, MAX_HISTORY);
        })
      );
    },
    [activeFrame]
  );

  const handleUndo = useCallback(() => {
    if (!activeFrame) return;
    const targetId = activeFrame.id;
    setFrames((prev) =>
      prev.map((f) =>
        f.id === targetId && f.historyIndex > 0
          ? { ...f, historyIndex: f.historyIndex - 1 }
          : f
      )
    );
  }, [activeFrame]);

  const handleRedo = useCallback(() => {
    if (!activeFrame) return;
    const targetId = activeFrame.id;
    setFrames((prev) =>
      prev.map((f) =>
        f.id === targetId && f.historyIndex < f.editHistory.length - 1
          ? { ...f, historyIndex: f.historyIndex + 1 }
          : f
      )
    );
  }, [activeFrame]);

  const handleAutoRemoveBg = useCallback(() => {
    if (!activeResult) return;
    const next = cloneImageData(activeResult.imageData);
    const removed = autoRemoveCornerBackground(next, Math.max(12, editor.tolerance));
    if (removed > 0) {
      handleCommitImageData(next);
    }
  }, [activeResult, editor.tolerance, handleCommitImageData]);

  // Timeline actions
  const handleStepFrame = useCallback((delta: -1 | 1) => {
    setIsPlaying(false);
    setActiveFrameId((prevId) => {
      const cur = framesRef.current;
      if (cur.length < 2) return prevId;
      const idx = cur.findIndex((f) => f.id === prevId);
      const nextIdx = ((idx >= 0 ? idx : 0) + delta + cur.length) % cur.length;
      return cur[nextIdx].id;
    });
  }, []);

  const handleSelectFrame = useCallback((id: string) => {
    setIsPlaying(false);
    setActiveFrameId(id);
  }, []);

  const handleEditFrame = useCallback((id: string) => {
    setIsPlaying(false);
    setActiveFrameId(id);
    setViewMode('edit');
  }, []);

  const handleReorderFrames = useCallback((fromIndex: number, toIndex: number) => {
    setFrames((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const handleDeleteFrame = useCallback((id: string) => {
    const currentFrames = framesRef.current;
    if (currentFrames.length <= 1 || !currentFrames.some((f) => f.id === id)) return;
    // Removing a frame can also change the shared palette. Only warn if a
    // surviving frame still has manual edits to preserve.
    if (currentFrames.some((f) => f.id !== id && f.historyIndex > 0 && f.editHistory.length > 0)) {
      setHasPendingReconvert(true);
    }
    setFrames((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((f) => f.id === id);
      const next = prev.filter((f) => f.id !== id);
      setActiveFrameId((curId) => {
        if (curId !== id) return curId;
        const fallbackIdx = Math.min(idx, next.length - 1);
        return next[fallbackIdx]?.id ?? null;
      });
      if (next.length <= 1) setIsPlaying(false);
      return next;
    });
  }, []);

  // Keyboard shortcuts for Edit Mode & Animate Mode
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
        if (activeFrame && activeFrame.editHistory.length > 0) {
          e.preventDefault();
          if (e.shiftKey) handleRedo();
          else handleUndo();
        }
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (activeFrame && activeFrame.editHistory.length > 0) {
          e.preventDefault();
          handleRedo();
        }
        return;
      }

      if (viewMode === 'animate' && !mod && !e.altKey) {
        if (e.code === 'Space') {
          e.preventDefault();
          if (framesRef.current.length > 1) setIsPlaying((p) => !p);
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          handleStepFrame(-1);
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          handleStepFrame(1);
          return;
        }
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
  }, [viewMode, activeFrame, handleUndo, handleRedo, handleStepFrame]);

  const handleUpdateConfig = useCallback(
    (patch: Partial<PixelEngineConfig>) => {
      setConfig((prev) => ({ ...prev, ...patch }));
      if (anyFrameHasManualEdits) {
        setHasPendingReconvert(true);
      }
    },
    [anyFrameHasManualEdits]
  );

  const handleSelectDimensions = useCallback(
    (w: number, h: number) => {
      clearAllManualEdits();
      setConfig((prev) => {
        const refImg = framesRef.current[0]?.sourceImage;
        const crop = refImg
          ? computeCenteredAspectCrop(refImg.naturalWidth, refImg.naturalHeight, w, h)
          : prev.crop;
        return { ...prev, targetW: w, targetH: h, crop };
      });
    },
    [clearAllManualEdits]
  );

  const handleChangeCrop = useCallback(
    (crop: CropRect) => {
      clearAllManualEdits();
      setConfig((prev) => ({ ...prev, crop }));
    },
    [clearAllManualEdits]
  );

  const handleResetConfig = useCallback(() => {
    clearAllManualEdits();
    setConfig((prev) => {
      const refImg = framesRef.current[0]?.sourceImage;
      return {
        ...DEFAULT_ENGINE_CONFIG,
        targetW: prev.targetW,
        targetH: prev.targetH,
        crop: refImg
          ? computeCenteredAspectCrop(
              refImg.naturalWidth,
              refImg.naturalHeight,
              prev.targetW,
              prev.targetH
            )
          : DEFAULT_ENGINE_CONFIG.crop,
      };
    });
  }, [clearAllManualEdits]);

  const handlePickColor = useCallback((hex: string) => {
    setEditor((prev) => ({ ...prev, colorHex: hex }));
  }, []);

  // --- Export Handlers ---
  const handleDownloadPng = useCallback(async () => {
    if (!activeResult || !activeFrame) return;
    try {
      const blob = await exportPixelPngBlob(activeResult.imageData, exportScale);
      const baseName = activeFrame.name.replace(/\.[^.]+$/, '');
      triggerBlobDownload(
        blob,
        `${baseName}_${activeResult.width}x${activeResult.height}_${exportScale}x.png`
      );
    } catch {
      setErrorMsg('匯出 PNG 失敗，請再試一次。');
    }
  }, [activeResult, activeFrame, exportScale]);

  const handleCopyPng = useCallback(async () => {
    if (!activeResult) return;
    try {
      const blob = await exportPixelPngBlob(activeResult.imageData, exportScale);
      if (navigator.clipboard && 'ClipboardItem' in window) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      }
    } catch {
      setErrorMsg('目前瀏覽器環境不允許直接寫入圖片到剪貼簿，請使用下載按鈕。');
    }
  }, [activeResult, exportScale]);

  const collectAllExportFrames = useCallback((): Array<{ name: string; imageData: ImageData }> => {
    const out: Array<{ name: string; imageData: ImageData }> = [];
    for (const f of frames) {
      const img = getEffectiveFrameImageData(f);
      if (img) out.push({ name: f.name, imageData: img });
    }
    return out;
  }, [frames]);

  const handleDownloadSpriteSheet = useCallback(async () => {
    const ready = collectAllExportFrames();
    if (ready.length === 0) return;
    setIsExporting(true);
    try {
      const cols =
        spriteSheetCols <= 0 || spriteSheetCols > ready.length ? ready.length : spriteSheetCols;
      const blob = await exportSpriteSheetPngBlob(
        ready.map((r) => r.imageData),
        exportScale,
        cols
      );
      const base = ready[0].name.replace(/\.[^.]+$/, '');
      triggerBlobDownload(
        blob,
        `${base}_sheet_${ready.length}f_${config.targetW}x${config.targetH}_${exportScale}x.png`
      );
    } catch {
      setErrorMsg('匯出 Sprite Sheet 失敗，請再試一次。');
    } finally {
      setIsExporting(false);
    }
  }, [collectAllExportFrames, spriteSheetCols, exportScale, config.targetW, config.targetH]);

  const handleDownloadGif = useCallback(async () => {
    const ready = collectAllExportFrames();
    if (ready.length === 0) return;
    setIsExporting(true);
    try {
      const blob = exportAnimatedGifBlob(
        ready.map((r) => r.imageData),
        exportScale,
        fps
      );
      const base = ready[0].name.replace(/\.[^.]+$/, '');
      triggerBlobDownload(
        blob,
        `${base}_anim_${ready.length}f_${fps}fps_${exportScale}x.gif`
      );
    } catch {
      setErrorMsg('匯出動態 GIF 失敗，請再試一次。');
    } finally {
      setIsExporting(false);
    }
  }, [collectAllExportFrames, exportScale, fps]);

  const handleDownloadZip = useCallback(async () => {
    const ready = collectAllExportFrames();
    if (ready.length === 0) return;
    setIsExporting(true);
    try {
      const blob = await exportFramesZipBlob(ready, exportScale);
      const base = ready[0].name.replace(/\.[^.]+$/, '');
      triggerBlobDownload(
        blob,
        `${base}_frames_${ready.length}f_${config.targetW}x${config.targetH}_${exportScale}x.zip`
      );
    } catch {
      setErrorMsg('打包 ZIP 失敗，請再試一次。');
    } finally {
      setIsExporting(false);
    }
  }, [collectAllExportFrames, exportScale, config.targetW, config.targetH]);

  const isMultiFrame = frames.length > 1;

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#0B0D11] text-[#F1F5F9]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="h-13 px-5 border-b border-[#222733] bg-[#0F1218] flex items-center justify-between gap-8 shrink-0">
        {/* Zone 1: Single-line Brand Wordmark */}
        <span className="text-base font-bold tracking-tight text-[#F8FAFC] whitespace-nowrap shrink-0">
          PixForge
        </span>

        {/* Zone 2: Concise Single-Line Mode Links */}
        <nav className="flex items-center gap-6 h-full overflow-x-auto">
          {VIEW_TABS.map((tab) => {
            const active = viewMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleChangeViewMode(tab.id)}
                className={`relative h-full inline-flex items-center text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active ? 'text-[#F8FAFC] font-medium' : 'text-[#8B95A8] hover:text-[#E2E8F0]'
                }`}
              >
                {tab.label}
                {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-400" />}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="shrink-0">
          <button
            type="button"
            disabled={!activeResult || isExporting}
            onClick={isMultiFrame && viewMode === 'animate' ? handleDownloadSpriteSheet : handleDownloadPng}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#081018] bg-sky-400 hover:bg-sky-300 disabled:opacity-40 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            {isMultiFrame && viewMode === 'animate' ? '匯出 Sprite Sheet' : '下載 PNG'}
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
          sourceImage={activeFrame?.sourceImage ?? null}
          sourceName={activeFrame?.name ?? ''}
          result={activeResult}
          config={config}
          viewMode={viewMode}
          editor={editor}
          canUndo={Boolean(activeFrame && activeFrame.historyIndex > 0)}
          canRedo={Boolean(
            activeFrame &&
              activeFrame.historyIndex >= 0 &&
              activeFrame.historyIndex < activeFrame.editHistory.length - 1
          )}
          hasManualEdits={activeFrameHasManualEdits}
          editStepCount={activeFrame ? Math.max(0, activeFrame.historyIndex) : 0}
          hasPendingReconvert={hasPendingReconvert}
          isBatchProcessing={isBatchProcessing}
          timelineFrames={timelineFrames}
          activeFrameId={activeFrame?.id ?? null}
          isPlaying={isPlaying}
          fps={fps}
          onTogglePlay={() => setIsPlaying((p) => !p)}
          onStepFrame={handleStepFrame}
          onChangeFps={setFps}
          onSelectFrame={handleSelectFrame}
          onEditFrame={handleEditFrame}
          onReorderFrames={handleReorderFrames}
          onDeleteFrame={handleDeleteFrame}
          onUploadFiles={handleUploadFiles}
          onUpdateEditor={(patch) => setEditor((p) => ({ ...p, ...patch }))}
          onCommitImageData={handleCommitImageData}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onAutoRemoveBg={handleAutoRemoveBg}
          onResetEdits={clearActiveFrameManualEdits}
          onApplyPendingReconvert={clearAllManualEdits}
          onDismissPendingReconvert={() => setHasPendingReconvert(false)}
          onChangeCrop={handleChangeCrop}
          onSelectDimensions={handleSelectDimensions}
          samples={BUILTIN_SAMPLES}
          activeSampleId={activeSampleId}
          onSelectSample={(s) => {
            const full = BUILTIN_SAMPLES.find((b) => b.id === s.id);
            if (full) loadSample(full);
          }}
          onChangeViewMode={handleChangeViewMode}
        />

        <ControlPanel
          config={config}
          result={activeResult}
          sourceSize={
            activeFrame
              ? {
                  w: activeFrame.sourceImage.naturalWidth,
                  h: activeFrame.sourceImage.naturalHeight,
                }
              : null
          }
          frameCount={frames.length}
          fps={fps}
          spriteSheetCols={spriteSheetCols}
          isExporting={isExporting}
          lockAspect={lockAspect}
          exportScale={exportScale}
          onChangeExportScale={setExportScale}
          onChangeSpriteSheetCols={setSpriteSheetCols}
          onToggleLockAspect={() => setLockAspect((v) => !v)}
          onUpdateConfig={handleUpdateConfig}
          onSelectDimensions={handleSelectDimensions}
          onResetConfig={handleResetConfig}
          onOpenCropMode={() => handleChangeViewMode('crop')}
          onPickColor={handlePickColor}
          onDownloadPng={handleDownloadPng}
          onCopyPng={handleCopyPng}
          onDownloadSpriteSheet={handleDownloadSpriteSheet}
          onDownloadGif={handleDownloadGif}
          onDownloadZip={handleDownloadZip}
        />
      </main>
    </div>
  );
}
