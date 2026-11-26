import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CodeXml, Globe, ImagePlus } from 'lucide-react';
import { CanvasViewport, ViewMode } from './components/CanvasViewport';
import { ControlPanel } from './components/ControlPanel';
import { PixelEditorState } from './components/PixelEditorBar';
import { TimelineFramePreview } from './components/FrameTimelineBar';
import {
  LOCALE_OPTIONS,
  useI18n,
  type Locale,
  type TranslationKey,
} from './i18n';
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
import { createDocumentColorPreview } from './lib/documentPalette';
import type { CanvasSourcePickMode, CanvasSourcePickEvent } from './lib/canvasSourcePick';
import { autoRemoveCornerBackground, cloneImageData } from './lib/pixelEditOps';
import {
  applyFrameConversion,
  getEffectiveFrameImageData,
  getHistoryFloor,
} from './lib/frameHistory';
import {
  commitSinglePixelEdit, commitSequenceColors, moveFramePixelHistory,
  movePixelEntry, retireBatchHistory, canMoveFramePixelHistory,
  MAX_PIXEL_HISTORY, getBatchBlockReason, type HistoryEntry, type HistoryJournal, type BatchBlockReason,
} from './lib/batchHistory';
import { collectSequencePalette, getSequenceMappingStats, previewSequenceFrame, equalPaletteMappings, type PaletteScope } from './lib/sequencePalette';
import {
  exportAnimatedGifBlob,
  exportFramesZipBlob,
  exportSpriteSheetPngBlob,
} from './lib/animationExport';
import {
  getSpriteSheetLayout,
  MAX_SPRITE_SHEET_PIXELS,
  MAX_SPRITE_SHEET_SIDE,
} from './lib/spriteSheetLayout';
import {
  deserializeManualEdit,
  loadPersistedWorkspace,
  savePersistedWorkspace,
  serializeManualEdit,
} from './lib/workspacePersistence';

type BatchWorkerReply =
  | { type: 'success'; results: PixelEngineResult[] }
  | { type: 'error'; message: string };

interface AnimationFrameItem {
  id: string;
  name: string;
  sourceImage: HTMLImageElement;
  sourceBlob?: Blob;
  sampleSrc?: string;
  convertedResult: PixelEngineResult | null;
  editHistory: ImageData[];
  historyIndex: number;
  historyFloor?: number;
}

interface PalettePreviewSession {
  frame: AnimationFrameItem;
  config: PixelEngineConfig;
  sourceKey: string;
  viewMode: ViewMode;
  pendingReconvert: boolean;
  imageData: ImageData;
}

interface SequencePreviewSession {
  frames: AnimationFrameItem[];
  config: PixelEngineConfig;
  viewMode: ViewMode;
  mapping: ReadonlyMap<string,string>;
}

interface CanvasSourcePickSession {
  mode: CanvasSourcePickMode;
  scope: PaletteScope;
  frames: AnimationFrameItem[];
  frameId: string;
  config: PixelEngineConfig;
  pendingReconvert: boolean;
}

type UndoActionEntry = HistoryEntry<AnimationFrameItem>;

const BUILTIN_SAMPLES: Array<{
  id: string;
  labelKey: TranslationKey;
  src: string;
  legacySrc: string;
  defaultW: number;
  defaultH: number;
}> = [
  {
    id: 'rpg-knight',
    labelKey: 'sample.catKnight',
    src: '/src/assets/images/sample-cat-knight.png',
    legacySrc: '/src/assets/images/sample_rpg_knight_1795397004570.jpg',
    defaultW: 64,
    defaultH: 64,
  },
  {
    id: 'fantasy-tavern',
    labelKey: 'sample.forestCottage',
    src: '/src/assets/images/sample-forest-cottage.png',
    legacySrc: '/src/assets/images/sample_fantasy_tavern_1795397003478.jpg',
    defaultW: 128,
    defaultH: 96,
  },
];

const VIEW_TABS: Array<{ id: ViewMode; labelKey: TranslationKey }> = [
  { id: 'side-by-side', labelKey: 'tab.sideBySide' },
  { id: 'split', labelKey: 'tab.split' },
  { id: 'pixel', labelKey: 'tab.pixel' },
  { id: 'crop', labelKey: 'tab.crop' },
  { id: 'edit', labelKey: 'tab.edit' },
  { id: 'animate', labelKey: 'tab.animate' },
];

const MAX_HISTORY = MAX_PIXEL_HISTORY;
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
  const { locale, setLocale, t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const [frames, setFrames] = useState<AnimationFrameItem[]>([]);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);
  const [activeSampleId, setActiveSampleId] = useState<string | null>(BUILTIN_SAMPLES[0].id);

  const [config, setConfig] = useState<PixelEngineConfig>(DEFAULT_ENGINE_CONFIG);
  const [hasPendingReconvert, setHasPendingReconvert] = useState<boolean>(false);
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [isConversionPending, setIsConversionPending] = useState(false);
  const [conversionFailed, setConversionFailed] = useState(false);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [palettePreview, setPalettePreview] = useState<PalettePreviewSession | null>(null);
  const [sequencePreview, setSequencePreview] = useState<SequencePreviewSession | null>(null);
  const [requestedPaletteScope, setRequestedPaletteScope] = useState<PaletteScope>('frame');
  const paletteScope = frames.length > 1 ? requestedPaletteScope : 'frame';
  const [paletteDraftResetVersion, setPaletteDraftResetVersion] = useState(0);
  const [canvasSourcePick, setCanvasSourcePick] = useState<CanvasSourcePickSession | null>(null);
  const [canvasPickEvent, setCanvasPickEvent] = useState<CanvasSourcePickEvent | null>(null);
  const previewShortcutConsumedRef = useRef(false);
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
  const [spriteSheetCols, setSpriteSheetCols] = useState<number>(0); // 0 = automatic near-square grid, -1 = single row
  const [fps, setFps] = useState<number>(8);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Track frame membership, not timeline order: reordering should not restart the Worker.
  const sourceKey = useMemo(() => frames.map((f) => f.id).sort().join('|'), [frames]);
  const framesRef = useRef<AnimationFrameItem[]>(frames);
  framesRef.current = frames;
  const activeFrameIdRef = useRef(activeFrameId);
  activeFrameIdRef.current = activeFrameId;
  const workspaceReadyRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const undoStackRef = useRef<UndoActionEntry[]>([]);
  const redoStackRef = useRef<UndoActionEntry[]>([]);

  const readHistoryJournal = useCallback((): HistoryJournal<AnimationFrameItem> => ({
    frames: framesRef.current, undo: undoStackRef.current, redo: redoStackRef.current,
  }), []);

  // All history transitions publish a complete frame array and both stacks
  // together. Updating the ref also prevents rapid events from reading stale frames.
  const publishHistoryJournal = useCallback((journal: HistoryJournal<AnimationFrameItem>) => {
    framesRef.current = journal.frames;
    undoStackRef.current = journal.undo;
    redoStackRef.current = journal.redo;
    setFrames(journal.frames);
  }, []);

  const notifyBatchRetirement = useCallback((count: number) => {
    if (count > 0) setHistoryNotice(tRef.current('history.batchCheckpoint', {count}));
  }, []);

  // A reconversion, membership change or explicit reset may invalidate a
  // conversion baseline. Retire whole batch boundaries before those actions.
  const sealBatchHistory = useCallback((frameId?: string) => {
    const journal = readHistoryJournal();
    if (frameId && ![...journal.undo, ...journal.redo].some(entry =>
      entry.type === 'batch-pixel-edit' && entry.changes.some(change => change.frameId === frameId))) return;
    const retired = retireBatchHistory(journal);
    if (retired.retired) {
      publishHistoryJournal(retired.journal);
      notifyBatchRetirement(retired.retired);
    }
  }, [readHistoryJournal, publishHistoryJournal, notifyBatchRetirement]);

  const clearUndoStacks = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryNotice(null);
  }, []);

  const activeFrame = useMemo(() => {
    if (frames.length === 0) return null;
    return frames.find((f) => f.id === activeFrameId) || frames[0];
  }, [frames, activeFrameId]);

  const anyFrameHasManualEdits = useMemo(
    () => frames.some((f) => f.historyIndex > 0 && f.editHistory.length > 0),
    [frames]
  );

  const canUndoActive = Boolean(activeFrame && canMoveFramePixelHistory(readHistoryJournal(), activeFrame.id, 'undo'));
  const canRedoActive = Boolean(activeFrame && canMoveFramePixelHistory(readHistoryJournal(), activeFrame.id, 'redo'));

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

  // Only the canvas may read this ephemeral preview. All edits, exports, palette
  // statistics, timeline thumbnails and persistence continue using committed frames.
  const sequenceBlockReason = getBatchBlockReason(frames, {
    isPlaying, isConversionPending: isConversionPending || conversionFailed,
    isBatchProcessing, hasPendingReconvert, hasPreview: false,
  });
  const activeCanvasPick = canvasSourcePick && activeResult && activeFrame &&
    canvasSourcePick.scope === paletteScope && canvasSourcePick.frames === frames &&
    canvasSourcePick.config === config && canvasSourcePick.pendingReconvert === hasPendingReconvert &&
    (paletteScope === 'sequence' ? !sequenceBlockReason : canvasSourcePick.frameId === activeFrame.id) &&
    viewMode === 'edit' && !isPlaying && !isConversionPending && !isBatchProcessing && !conversionFailed
    ? canvasSourcePick : null;
  useEffect(() => {
    if (canvasSourcePick && !activeCanvasPick) {
      setCanvasSourcePick(null);
      setCanvasPickEvent(null);
      setPaletteDraftResetVersion(version => version + 1);
    }
  }, [canvasSourcePick, activeCanvasPick]);
  const sequencePalette = useMemo(() => paletteScope === 'sequence' ? collectSequencePalette(frames) : null, [paletteScope, frames]);
  const validSequencePreview = sequencePreview && paletteScope === 'sequence' &&
    sequencePreview.frames === frames && sequencePreview.config === config &&
    sequencePreview.viewMode === viewMode && viewMode !== 'crop' && !sequenceBlockReason
      ? sequencePreview : null;
  const singlePreviewImageData =
    palettePreview &&
    palettePreview.frame === activeFrame &&
    palettePreview.config === config &&
    palettePreview.sourceKey === sourceKey &&
    palettePreview.viewMode === viewMode &&
    palettePreview.pendingReconvert === hasPendingReconvert &&
    !isPlaying && !isConversionPending && !isBatchProcessing
      ? palettePreview.imageData
      : null;
  const previewImageData = useMemo(() => validSequencePreview && activeFrame
    ? previewSequenceFrame(activeFrame, validSequencePreview.mapping)
    : singlePreviewImageData, [validSequencePreview, activeFrame, singlePreviewImageData]);

  useEffect(() => {
    if ((palettePreview && !singlePreviewImageData) || (sequencePreview && !validSequencePreview)) {
      setPalettePreview(null);
      setSequencePreview(null);
      setPaletteDraftResetVersion(version => version + 1);
    }
  }, [palettePreview, singlePreviewImageData, sequencePreview, validSequencePreview]);
  useEffect(() => {
    if (frames.length < 2) setRequestedPaletteScope('frame');
  }, [frames.length]);

  // Low-level cancellation is also used for no-op mappings and preview toggles.
  const cancelPalettePreview = useCallback(() => {
    setPalettePreview(null);
    setSequencePreview(null);
  }, []);
  const handleChangePaletteScope = useCallback((scope: PaletteScope) => {
    cancelPalettePreview();
    setCanvasSourcePick(null);
    setCanvasPickEvent(null);
    setPaletteDraftResetVersion(version => version + 1);
    setRequestedPaletteScope(scope);
  }, [cancelPalettePreview]);

  const startCanvasSourcePick = useCallback((mode: CanvasSourcePickMode) => {
    if (!activeResult || !activeFrame || isPlaying || isConversionPending || isBatchProcessing ||
        conversionFailed || (paletteScope === 'sequence' && sequenceBlockReason)) return;
    cancelPalettePreview();
    setCanvasPickEvent(null);
    setCanvasSourcePick({mode,scope:paletteScope,frames,frameId:activeFrame.id,config,pendingReconvert:hasPendingReconvert});
    setViewMode('edit');
  }, [activeResult, activeFrame, isPlaying, isConversionPending, isBatchProcessing,
    conversionFailed, paletteScope, sequenceBlockReason, frames, config, hasPendingReconvert, cancelPalettePreview]);

  const stopCanvasSourcePick = useCallback(() => {
    setCanvasSourcePick(null);
    setCanvasPickEvent(null);
  }, []);
  const consumeCanvasPickEvent = useCallback((event: CanvasSourcePickEvent) => {
    setCanvasPickEvent(current => current === event ? null : current);
  }, []);
  const finishCanvasSourcePick = useCallback(() => {
    if (!activeCanvasPick) return;
    setCanvasSourcePick(null);
    setCanvasPickEvent({type:'finish'});
  }, [activeCanvasPick]);
  const handleCanvasSourceColor = useCallback((hex: string) => {
    if (!activeCanvasPick || activeCanvasPick.frames !== framesRef.current) return;
    setCanvasPickEvent({type:'color',hex,mode:activeCanvasPick.mode});
    if (activeCanvasPick.mode === 'single') setCanvasSourcePick(null);
  }, [activeCanvasPick]);

  // Explicit cancellation discards the draft as well as its rendered preview.
  // Returning true consumes a history action without touching either stack.
  const dismissPalettePreview = useCallback((): boolean => {
    if (!previewImageData && !activeCanvasPick) return false;
    stopCanvasSourcePick();
    setPalettePreview(null);
    setSequencePreview(null);
    setPaletteDraftResetVersion(version => version + 1);
    return true;
  }, [previewImageData, activeCanvasPick, stopCanvasSourcePick]);

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
    sealBatchHistory();
    const currentFrames = framesRef.current;
    if (currentFrames.length === 0) {
      setIsBatchProcessing(false);
      setIsConversionPending(false);
      setConversionFailed(false);
      return;
    }

    let cancelled = false;
    let worker: Worker | null = null;
    let paintRaf = 0;
    let computeRaf = 0;
    setIsBatchProcessing(currentFrames.length > 1);
    setIsConversionPending(true);
    setConversionFailed(false);

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
      setConversionFailed(false);
      setIsBatchProcessing(false);
      setIsConversionPending(false);
    };

    const reportError = (err: unknown) => {
      if (cancelled) return;
      setErrorMsg(err instanceof Error ? err.message : String(err || tRef.current('error.batchConvert')));
      setConversionFailed(true);
      setIsBatchProcessing(false);
      setIsConversionPending(false);
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
  }, [sourceKey, config, sealBatchHistory]);

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
    setFrames((prev) => prev.map((f) => ({ ...f, editHistory: [], historyIndex: -1, historyFloor: undefined })));
    undoStackRef.current = undoStackRef.current.filter((e) => e.type === 'delete-frame');
    redoStackRef.current = redoStackRef.current.filter((e) => e.type === 'delete-frame');
    setHasPendingReconvert(false);
  }, []);

  const clearActiveFrameManualEdits = useCallback(() => {
    if (!activeFrame) return;
    const targetId = activeFrame.id;
    sealBatchHistory(targetId);
    setFrames((prev) =>
      prev.map((f) => (f.id === targetId ? { ...f, editHistory: [], historyIndex: -1, historyFloor: undefined } : f))
    );
    undoStackRef.current = undoStackRef.current.filter(
      (e) => !(e.type === 'pixel-edit' && e.frameId === targetId)
    );
    redoStackRef.current = redoStackRef.current.filter(
      (e) => !(e.type === 'pixel-edit' && e.frameId === targetId)
    );
    setHasPendingReconvert(false);
  }, [activeFrame, sealBatchHistory]);

  const getSampleFileName = useCallback((sample: (typeof BUILTIN_SAMPLES)[number]) => {
    const label = tRef.current(sample.labelKey).replace(tRef.current('sample.prefix'), '');
    return `${label}${sample.src.slice(sample.src.lastIndexOf('.'))}`;
  }, []);

  // Load built-in single sample
  const loadSample = useCallback(
    async (sample: (typeof BUILTIN_SAMPLES)[number], canApply?: () => boolean) => {
      try {
        const img = await loadHtmlImageFromUrl(sample.src);
        if (canApply && !canApply()) return;
        workspaceReadyRef.current = true;
        const id = makeFrameId();
        clearUndoStacks();
        setErrorMsg(null);
        setActiveSampleId(sample.id);
        setIsPlaying(false);
        setHasPendingReconvert(false);
        setSpriteSheetCols(0);
        setFrames([
          {
            id,
            name: getSampleFileName(sample),
            sourceImage: img,
            sampleSrc: sample.src,
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
        if (!canApply || canApply()) {
          setErrorMsg(tRef.current('error.sampleLoad'));
        }
      }
    },
    [clearUndoStacks, getSampleFileName]
  );

  // Initial load: restore previous workspace from IndexedDB, or fall back to built-in sample
  useEffect(() => {
    let cancelled = false;
    const canApplyStartupWorkspace = () => !cancelled && !workspaceReadyRef.current;

    const hydrate = async () => {
      try {
        const saved = await loadPersistedWorkspace();
        if (!canApplyStartupWorkspace()) return;

        if (saved && saved.frames.length > 0) {
          const decoded = await Promise.all(
            saved.frames.map(async (pf): Promise<AnimationFrameItem | null> => {
              try {
                let img: HTMLImageElement;
                let { name, sampleSrc } = pf;
                if (pf.sourceBlob) {
                  const url = URL.createObjectURL(pf.sourceBlob);
                  try {
                    img = await loadHtmlImageFromUrl(url);
                  } finally {
                    URL.revokeObjectURL(url);
                  }
                } else if (sampleSrc) {
                  const replacement = BUILTIN_SAMPLES.find((sample) => sample.legacySrc === sampleSrc);
                  if (replacement) {
                    sampleSrc = replacement.src;
                    name = getSampleFileName(replacement);
                  }
                  img = await loadHtmlImageFromUrl(sampleSrc);
                } else {
                  return null;
                }

                const manualImg = deserializeManualEdit(pf.manualEdit);
                return {
                  id: pf.id,
                  name,
                  sourceImage: img,
                  sourceBlob: pf.sourceBlob,
                  sampleSrc,
                  convertedResult: null,
                  editHistory: manualImg ? [cloneImageData(manualImg), manualImg] : [],
                  historyIndex: manualImg ? 1 : -1,
                  historyFloor: manualImg && pf.manualEditCheckpoint === true ? 1 : undefined,
                };
              } catch {
                return null;
              }
            })
          );

          if (!canApplyStartupWorkspace()) return;
          const restoredFrames = decoded.filter((f): f is AnimationFrameItem => f !== null);
          if (restoredFrames.length > 0) {
            workspaceReadyRef.current = true;
            clearUndoStacks();
            setErrorMsg(null);
            setActiveSampleId(saved.activeSampleId);
            setIsPlaying(false);
            setHasPendingReconvert(false);
            setConfig(saved.config);
            setViewMode(saved.viewMode);
            setFps(saved.fps);
            setExportScale(saved.exportScale);
            setSpriteSheetCols(saved.spriteSheetCols);
            setFrames(restoredFrames);
            const nextActiveId =
              saved.activeFrameId && restoredFrames.some((f) => f.id === saved.activeFrameId)
                ? saved.activeFrameId
                : restoredFrames[0].id;
            setActiveFrameId(nextActiveId);
            return;
          }
        }
      } catch {
        // Fall through to default sample
      }

      if (canApplyStartupWorkspace()) {
        await loadSample(BUILTIN_SAMPLES[0], canApplyStartupWorkspace);
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [loadSample, clearUndoStacks, getSampleFileName]);

  // Auto-save current workspace (images, manual edits, settings) to IndexedDB
  // Playback advances the active frame without restarting the save timer.
  const pausedFrameId = isPlaying ? null : activeFrameId;
  useEffect(() => {
    if (!workspaceReadyRef.current || frames.length === 0) return;

    const timerId = window.setTimeout(() => {
      const appliedBatchFrameIds = new Set(undoStackRef.current.flatMap(entry => entry.type === 'batch-pixel-edit' ? entry.changes.map(change => change.frameId) : []));
      const persistedFrames = frames
        .filter((f) => Boolean(f.sourceBlob || f.sampleSrc))
        .map((f) => {
          const manualImg =
            f.historyIndex > 0 && f.historyIndex < f.editHistory.length
              ? f.editHistory[f.historyIndex]
              : null;
          return {
            id: f.id,
            name: f.name,
            sourceBlob: f.sourceBlob,
            sampleSrc: f.sampleSrc,
            manualEdit: serializeManualEdit(manualImg),
            manualEditCheckpoint: manualImg && (getHistoryFloor(f) > 0 || appliedBatchFrameIds.has(f.id)) ? true : undefined,
          };
        });

      if (persistedFrames.length === 0) return;

      void savePersistedWorkspace({
        version: 1,
        savedAt: Date.now(),
        activeSampleId,
        activeFrameId: activeFrameIdRef.current,
        viewMode,
        config,
        fps,
        exportScale,
        spriteSheetCols,
        frames: persistedFrames,
      });
    }, 450);

    return () => window.clearTimeout(timerId);
  }, [frames, pausedFrameId, activeSampleId, viewMode, config, fps, exportScale, spriteSheetCols]);

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
            name: file.name || t('sample.clipboardName'),
            sourceImage: img,
            sourceBlob: file,
            convertedResult: null,
            editHistory: [] as ImageData[],
            historyIndex: -1,
          };
        })
      );

      workspaceReadyRef.current = true;
      setErrorMsg(null);
      setActiveSampleId(null);

      if (mode === 'append' && framesRef.current.length > 0) {
        // A new frame can change the shared auto palette; keep existing manual
        // edits intact and let the user choose whether to apply the new result.
        if (framesRef.current.some((f) => f.historyIndex > 0 && f.editHistory.length > 0)) {
          setHasPendingReconvert(true);
        }
        sealBatchHistory();
        setFrames((prev) => [...prev, ...loaded]);
        setActiveFrameId(loaded[0].id);
        if (framesRef.current.length + loaded.length > 1) {
          setViewMode('animate');
        }
        return;
      }

      // Replace workspace with newly uploaded image(s)
      const firstImg = loaded[0].sourceImage;
      clearUndoStacks();
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
      setErrorMsg(t('error.uploadRead'));
    }
  }, [clearUndoStacks, sealBatchHistory, t]);

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
      if (!activeFrame || !activeFrame.convertedResult || validSequencePreview || activeCanvasPick) return;
      const committed = commitSinglePixelEdit(readHistoryJournal(), activeFrame.id, next);
      if (!committed) return;
      setPalettePreview(null);
      publishHistoryJournal(committed.journal);
      notifyBatchRetirement(committed.retired);
    },
    [activeFrame, readHistoryJournal, publishHistoryJournal, notifyBatchRetirement, validSequencePreview, activeCanvasPick]
  );

  // Every preview starts from the effective committed frame, never from an
  // earlier preview. The same mapping path will serve manual/automatic merge.
  const handlePreviewDocumentColors = useCallback(
    (mapping: ReadonlyMap<string, string>) => {
      if (!activeResult || !activeFrame || isPlaying || isConversionPending ||
          isBatchProcessing || viewMode === 'crop') {
        setPalettePreview(null);
        return;
      }
      const preview = createDocumentColorPreview(activeResult.imageData.data, mapping);
      if (!preview) {
        setPalettePreview(null);
        return;
      }
      const imageData = new ImageData(new Uint8ClampedArray(preview.data), activeResult.width, activeResult.height);
      setPalettePreview({
        frame: activeFrame, config, sourceKey, viewMode,
        pendingReconvert: hasPendingReconvert, imageData,
      });
    },
    [activeResult, activeFrame, isPlaying, isConversionPending, isBatchProcessing,
      viewMode, config, sourceKey, hasPendingReconvert]
  );

  // One mapping, one commit, one undo entry. Recompute from the committed
  // baseline so no stale or cumulative preview data can enter history.
  const handleApplyDocumentColors = useCallback(
    (mapping: ReadonlyMap<string, string>): boolean => {
      if (!activeResult || !activeFrame || isPlaying || isConversionPending || isBatchProcessing || activeCanvasPick) return false;
      const next = createDocumentColorPreview(activeResult.imageData.data, mapping);
      if (!next) return false;
      handleCommitImageData(new ImageData(new Uint8ClampedArray(next.data), activeResult.width, activeResult.height));
      return true;
    },
    [activeResult, activeFrame, isPlaying, isConversionPending, isBatchProcessing, handleCommitImageData, activeCanvasPick]
  );

  const handleReplaceDocumentColor = useCallback(
    (source: string, target: string): boolean => handleApplyDocumentColors(new Map([[source, target]])),
    [handleApplyDocumentColors]
  );

  // A sequence draft retains only a mapping; scrub paused frames to preview
  // each on demand. No timeline thumbnail, export, or history uses the draft.
  const handlePreviewSequenceColors = useCallback((mapping: ReadonlyMap<string,string>) => {
    if (!sequencePalette || sequenceBlockReason || viewMode === 'crop' ||
        getSequenceMappingStats(sequencePalette,mapping).changedPixels === 0) {
      cancelPalettePreview();
      return;
    }
    setPalettePreview(null);
    setSequencePreview({frames, config, viewMode, mapping:new Map(mapping)});
  }, [sequencePalette, sequenceBlockReason, viewMode, frames, config, cancelPalettePreview]);

  const handleApplySequenceColors = useCallback((mapping: ReadonlyMap<string, string>) => {
    const committed = commitSequenceColors(readHistoryJournal(), mapping, {
      isPlaying, isConversionPending: isConversionPending || conversionFailed,
      isBatchProcessing, hasPendingReconvert,
      // Only this exact, still-current sequence draft can be explicitly applied.
      hasPreview: !!activeCanvasPick || (previewImageData !== null && !(validSequencePreview &&
        validSequencePreview.frames === framesRef.current && equalPaletteMappings(validSequencePreview.mapping,mapping))),
    }, globalThis.crypto?.randomUUID?.() ?? makeFrameId());
    if (committed.ok) {
      cancelPalettePreview();
      publishHistoryJournal(committed.journal);
      notifyBatchRetirement(committed.retired);
    }
    return committed;
  }, [readHistoryJournal, isPlaying, isConversionPending, conversionFailed, isBatchProcessing,
    hasPendingReconvert, previewImageData, validSequencePreview, activeCanvasPick, publishHistoryJournal, notifyBatchRetirement, cancelPalettePreview]);

  const handleApplySequencePalette = useCallback((mapping: ReadonlyMap<string,string>): BatchBlockReason | null => {
    const result = handleApplySequenceColors(mapping);
    return result.ok === false ? result.reason : null;
  }, [handleApplySequenceColors]);

  const handleUndo = useCallback(() => {
    if (dismissPalettePreview()) return;
    if (!activeFrame) return;
    const moved = moveFramePixelHistory(readHistoryJournal(), activeFrame.id, 'undo');
    if (moved.status === 'applied') publishHistoryJournal(moved.journal);
    else if (moved.status === 'blocked') setHistoryNotice(tRef.current('history.batchBlocked'));
  }, [activeFrame, dismissPalettePreview, readHistoryJournal, publishHistoryJournal]);

  const handleRedo = useCallback(() => {
    if (dismissPalettePreview()) return;
    if (!activeFrame) return;
    const moved = moveFramePixelHistory(readHistoryJournal(), activeFrame.id, 'redo');
    if (moved.status === 'applied') publishHistoryJournal(moved.journal);
    else if (moved.status === 'blocked') setHistoryNotice(tRef.current('history.batchBlocked'));
  }, [activeFrame, dismissPalettePreview, readHistoryJournal, publishHistoryJournal]);

  const handleGlobalUndo = useCallback((): boolean => {
    if (dismissPalettePreview()) return true;
    while (undoStackRef.current.length > 0) {
      const entry = undoStackRef.current[undoStackRef.current.length - 1];
      if (entry.type === 'delete-frame') {
        // Membership changes invalidate any batch boundaries (including redo).
        sealBatchHistory();
        undoStackRef.current.pop();
        if (framesRef.current.some(f => f.id === entry.frame.id)) continue;
        const journal = readHistoryJournal();
        const next = [...journal.frames];
        next.splice(Math.max(0, Math.min(entry.index, next.length)), 0, entry.frame);
        publishHistoryJournal({...journal, frames:next, redo:[...journal.redo,entry]});
        setActiveFrameId(entry.frame.id);
        return true;
      }
      const moved = movePixelEntry(readHistoryJournal(), entry, 'undo');
      if (moved.status === 'applied') {
        publishHistoryJournal(moved.journal);
        if (entry.type === 'pixel-edit') setActiveFrameId(entry.frameId);
        return true;
      }
      if (moved.status === 'blocked') {
        setHistoryNotice(tRef.current('history.batchBlocked'));
        return true;
      }
      undoStackRef.current.pop();
    }
    if (activeFrame) {
      const moved = moveFramePixelHistory(readHistoryJournal(), activeFrame.id, 'undo');
      if (moved.status === 'applied') { publishHistoryJournal(moved.journal); return true; }
      if (moved.status === 'blocked') { setHistoryNotice(tRef.current('history.batchBlocked')); return true; }
    }
    return false;
  }, [activeFrame, dismissPalettePreview, readHistoryJournal, publishHistoryJournal, sealBatchHistory]);

  const handleGlobalRedo = useCallback((): boolean => {
    if (dismissPalettePreview()) return true;
    while (redoStackRef.current.length > 0) {
      const entry = redoStackRef.current[redoStackRef.current.length - 1];
      if (entry.type === 'delete-frame') {
        sealBatchHistory();
        redoStackRef.current.pop();
        const journal = readHistoryJournal();
        if (journal.frames.length <= 1 || !journal.frames.some(f => f.id === entry.frame.id)) continue;
        const index = journal.frames.findIndex(f => f.id === entry.frame.id);
        const next = journal.frames.filter(f => f.id !== entry.frame.id);
        publishHistoryJournal({...journal, frames:next, undo:[...journal.undo,entry]});
        setActiveFrameId(curId => curId === entry.frame.id ? next[Math.min(index,next.length-1)]?.id ?? null : curId);
        if (next.length <= 1) setIsPlaying(false);
        return true;
      }
      const moved = movePixelEntry(readHistoryJournal(), entry, 'redo');
      if (moved.status === 'applied') {
        publishHistoryJournal(moved.journal);
        if (entry.type === 'pixel-edit') setActiveFrameId(entry.frameId);
        return true;
      }
      if (moved.status === 'blocked') {
        setHistoryNotice(tRef.current('history.batchBlocked'));
        return true;
      }
      redoStackRef.current.pop();
    }
    if (activeFrame) {
      const moved = moveFramePixelHistory(readHistoryJournal(), activeFrame.id, 'redo');
      if (moved.status === 'applied') { publishHistoryJournal(moved.journal); return true; }
      if (moved.status === 'blocked') { setHistoryNotice(tRef.current('history.batchBlocked')); return true; }
    }
    return false;
  }, [activeFrame, dismissPalettePreview, readHistoryJournal, publishHistoryJournal, sealBatchHistory]);

  const handleAutoRemoveBg = useCallback(() => {
    if (!activeResult || previewImageData || activeCanvasPick) return;
    const next = cloneImageData(activeResult.imageData);
    const removed = autoRemoveCornerBackground(next, Math.max(12, editor.tolerance));
    if (removed > 0) {
      handleCommitImageData(next);
    }
  }, [activeResult, editor.tolerance, handleCommitImageData, previewImageData, activeCanvasPick]);

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
    if (framesRef.current.length <= 1 || !framesRef.current.some(f => f.id === id)) return;
    sealBatchHistory();
    const currentFrames = framesRef.current;
    const removedIdx = currentFrames.findIndex((f) => f.id === id);
    const removedFrame = currentFrames[removedIdx];
    // Removing a frame can also change the shared palette. Only warn if a
    // surviving frame still has manual edits to preserve.
    if (currentFrames.some((f) => f.id !== id && f.historyIndex > 0 && f.editHistory.length > 0)) {
      setHasPendingReconvert(true);
    }
    const journal = readHistoryJournal();
    const entry: UndoActionEntry = { type: 'delete-frame', frame: removedFrame, index: removedIdx };
    const next = journal.frames.filter(f => f.id !== id);
    publishHistoryJournal({frames:next, undo:[...journal.undo,entry].slice(-MAX_HISTORY), redo:[]});
    setActiveFrameId(curId => curId === id ? next[Math.min(removedIdx,next.length-1)]?.id ?? null : curId);
    if (next.length <= 1) setIsPlaying(false);
  }, [sealBatchHistory, readHistoryJournal, publishHistoryJournal]);

  // Keyboard shortcuts for Edit Mode & Animate Mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const target = e.target as HTMLElement | null;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const historyShortcut = mod && (key === 'z' || key === 'y');

      // Consume the first history shortcut (or Escape) during preview, even
      // when a color input or slider has focus. Holding the key must not
      // immediately undo the preceding committed edit through auto-repeat.
      if (historyShortcut || key === 'escape') {
        if (!e.repeat) previewShortcutConsumedRef.current = false;
        if (e.repeat && previewShortcutConsumedRef.current) {
          e.preventDefault();
          return;
        }
        if (dismissPalettePreview()) {
          previewShortcutConsumedRef.current = true;
          e.preventDefault();
          return;
        }
      }

      const textEditing = target && (
        target.tagName === 'TEXTAREA' || target.isContentEditable ||
        (target instanceof HTMLInputElement &&
          !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color'].includes(target.type))
      );
      if (historyShortcut && !textEditing) {
        const handled = key === 'y' || e.shiftKey ? handleGlobalRedo() : handleGlobalUndo();
        if (handled) e.preventDefault();
        return;
      }

      // Preserve native text editing and other input-specific shortcuts.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

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
      if (activeCanvasPick && ['b','e','i','g','w'].includes(k)) dismissPalettePreview();
      if (k === 'b') setEditor((p) => ({ ...p, tool: 'pencil' }));
      else if (k === 'e') setEditor((p) => ({ ...p, tool: 'eraser' }));
      else if (k === 'i') setEditor((p) => ({ ...p, tool: 'eyedropper' }));
      else if (k === 'g') setEditor((p) => ({ ...p, tool: 'bucket' }));
      else if (k === 'w') setEditor((p) => ({ ...p, tool: 'wand' }));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewMode, handleGlobalUndo, handleGlobalRedo, handleStepFrame, dismissPalettePreview, activeCanvasPick]);

  const handleUpdateConfig = useCallback(
    (patch: Partial<PixelEngineConfig>) => {
      sealBatchHistory();
      setConfig((prev) => ({ ...prev, ...patch }));
      if (anyFrameHasManualEdits) {
        setHasPendingReconvert(true);
      }
    },
    [anyFrameHasManualEdits, sealBatchHistory]
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
      setErrorMsg(t('error.downloadPng'));
    }
  }, [activeResult, activeFrame, exportScale, t]);

  const handleCopyPng = useCallback(async () => {
    if (!activeResult) return;
    try {
      const blob = await exportPixelPngBlob(activeResult.imageData, exportScale);
      if (navigator.clipboard && 'ClipboardItem' in window) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      }
    } catch {
      setErrorMsg(t('error.clipboardWrite'));
    }
  }, [activeResult, exportScale, t]);

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
      // Check the actual ready frame count before attempting any Canvas allocation.
      const layout = getSpriteSheetLayout(
        ready[0].imageData.width,
        ready[0].imageData.height,
        ready.length,
        exportScale,
        spriteSheetCols
      );
      if (!layout.isWithinLimits) {
        setErrorMsg(
          t('error.sheetOversize', {
            width: layout.width.toLocaleString(locale),
            height: layout.height.toLocaleString(locale),
            pixels: layout.pixelCount.toLocaleString(locale),
            maxSide: MAX_SPRITE_SHEET_SIDE.toLocaleString(locale),
            maxPixels: MAX_SPRITE_SHEET_PIXELS.toLocaleString(locale),
          })
        );
        return;
      }
      const blob = await exportSpriteSheetPngBlob(
        ready.map((r) => r.imageData),
        exportScale,
        spriteSheetCols
      );
      const base = ready[0].name.replace(/\.[^.]+$/, '');
      triggerBlobDownload(
        blob,
        `${base}_sheet_${ready.length}f_${config.targetW}x${config.targetH}_${exportScale}x.png`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('error.exportSheet'));
    } finally {
      setIsExporting(false);
    }
  }, [collectAllExportFrames, spriteSheetCols, exportScale, config.targetW, config.targetH, locale, t]);

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
      setErrorMsg(t('error.exportGif'));
    } finally {
      setIsExporting(false);
    }
  }, [collectAllExportFrames, exportScale, fps, t]);

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
      setErrorMsg(t('error.exportZip'));
    } finally {
      setIsExporting(false);
    }
  }, [collectAllExportFrames, exportScale, config.targetW, config.targetH, t]);

  const localizedSamples = useMemo(
    () =>
      BUILTIN_SAMPLES.map((s) => ({
        ...s,
        label: t(s.labelKey),
      })),
    [t]
  );

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#0B0D11] text-[#F1F5F9]">
      {/* Top Navigation Bar */}
      <header className="h-13 px-2 sm:px-5 border-b border-[#222733] bg-[#0F1218] grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-2 sm:gap-6 shrink-0">
        {/* Zone 1: Single-line Brand Wordmark */}
        <span className="text-base font-bold tracking-tight text-[#F8FAFC] whitespace-nowrap shrink-0 justify-self-start">
          PixForge
        </span>

        {/* Zone 2: Concise Single-Line Mode Links */}
        <nav className="flex items-center gap-2 sm:gap-6 h-full min-w-0">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              if (files.length > 0) handleUploadFiles(files, 'replace');
              event.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title={t('toolbar.uploadTitle')}
            className="inline-flex shrink-0 items-center gap-1.5 px-2 sm:px-3 py-1.5 text-sm font-medium whitespace-nowrap text-[#F1F5F9] bg-[#1C212D] hover:bg-[#252C3B] border border-[#2D3546] rounded-md cursor-pointer"
          >
            <ImagePlus className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
            {t('toolbar.upload')}
          </button>
          <div className="flex items-center gap-4 sm:gap-6 h-full overflow-x-auto studio-scroll">
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
                  {t(tab.labelKey)}
                  {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-400" />}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Zone 3: Source and Language */}
        <div className="justify-self-end flex flex-col items-center sm:flex-row sm:gap-2">
          <a
            href={import.meta.env.PIXFORGE_SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('app.sourceAndLicense')}
            title={t('app.sourceAndLicense')}
            className="inline-flex items-center gap-1.5 rounded-md p-1 text-xs text-[#CBD5E1] hover:text-sky-300 whitespace-nowrap"
          >
            <CodeXml className="size-4 shrink-0" aria-hidden="true" />
            <span className="hidden xl:inline">{t('app.sourceAndLicense')}</span>
          </a>
          <div className="flex items-center sm:gap-1.5 px-1.5 sm:px-2 py-1 bg-[#161A23] border border-[#2D3546] rounded-md">
            <Globe className="hidden sm:block w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden="true" />
            <select
              aria-label={t('app.langAria')}
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className="bg-transparent text-xs text-[#E2E8F0] outline-none cursor-pointer"
            >
              {LOCALE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id} className="bg-[#161A23] text-[#E2E8F0]">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Error banner if needed */}
      {historyNotice && (
        <div role="status" className="flex items-center justify-between gap-2 px-4 py-2 bg-amber-500/10 text-amber-200 text-xs">
          <span>{historyNotice}</span>
          <button type="button" onClick={() => setHistoryNotice(null)} aria-label={t('history.dismiss')}>×</button>
        </div>
      )}
      {errorMsg && (
        <div className="px-5 py-2 bg-rose-500/15 border-b border-rose-500/30 text-xs text-rose-200 flex items-center justify-between">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-300 hover:text-white cursor-pointer"
          >
            {t('app.close')}
          </button>
        </div>
      )}

      {/* Main Studio Workspace */}
      <main className="flex-1 flex flex-col md:flex-row min-h-0 overflow-y-auto md:overflow-hidden">
        <CanvasViewport
          sourceImage={activeFrame?.sourceImage ?? null}
          sourceName={activeFrame?.name ?? ''}
          result={activeResult}
          previewImageData={previewImageData}
          sequencePreviewActive={Boolean(validSequencePreview)}
          canvasSourcePickMode={activeCanvasPick?.mode ?? null}
          onCanvasSourceColor={handleCanvasSourceColor}
          onFinishCanvasSourcePick={finishCanvasSourcePick}
          onCancelPalettePreview={dismissPalettePreview}
          config={config}
          viewMode={viewMode}
          editor={editor}
          canUndo={Boolean(previewImageData || activeCanvasPick || canUndoActive)}
          canRedo={canRedoActive}
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
          onOpenUpload={() => fileInputRef.current?.click()}
          onUpdateEditor={(patch) => {
            if (activeCanvasPick && patch.tool) dismissPalettePreview();
            setEditor((p) => ({ ...p, ...patch }));
          }}
          onCommitImageData={handleCommitImageData}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onAutoRemoveBg={handleAutoRemoveBg}
          onResetEdits={clearActiveFrameManualEdits}
          onApplyPendingReconvert={clearAllManualEdits}
          onDismissPendingReconvert={() => setHasPendingReconvert(false)}
          onChangeCrop={handleChangeCrop}
          samples={localizedSamples}
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
          onPickColor={handlePickColor}
          activeFrameId={activeFrame?.id ?? null}
          paletteEditingDisabled={isPlaying || isConversionPending || isBatchProcessing}
           paletteScope={paletteScope}
           onChangePaletteScope={handleChangePaletteScope}
           sequencePalette={sequencePalette}
           sequenceBlockReason={sequenceBlockReason}
           sequenceFrameNames={frames.map((f,index)=>({id:f.id,name:f.name,index:index+1}))}
           onPreviewSequenceColors={handlePreviewSequenceColors}
           onApplySequenceColors={handleApplySequencePalette}
           canUndoSequence={Boolean(previewImageData || activeCanvasPick || undoStackRef.current.length || canUndoActive)}
           canRedoSequence={Boolean(redoStackRef.current.length || canRedoActive)}
           onUndoSequence={handleGlobalUndo}
           onRedoSequence={handleGlobalRedo}
          canvasSourcePickMode={activeCanvasPick?.mode ?? null}
           canvasPickEvent={canvasPickEvent}
           onConsumeCanvasPickEvent={consumeCanvasPickEvent}
           onStartCanvasSourcePick={startCanvasSourcePick}
           onStopCanvasSourcePick={stopCanvasSourcePick}
           onFinishCanvasSourcePick={finishCanvasSourcePick}
           canvasSourcePickDisabled={conversionFailed}
           palettePreviewActive={previewImageData !== null}
          paletteDraftResetVersion={paletteDraftResetVersion}
          palettePreviewDisabled={viewMode === 'crop'}
          onPreviewColors={handlePreviewDocumentColors}
          onCancelPreview={cancelPalettePreview}
          canUndo={Boolean(previewImageData || activeCanvasPick || canUndoActive)}
          canRedo={canRedoActive}
          onReplaceColor={handleReplaceDocumentColor}
          onApplyColors={handleApplyDocumentColors}
          onUndo={handleUndo}
          onRedo={handleRedo}
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
