import type { PixelEngineConfig } from './pixelEngine';
import { DEFAULT_ENGINE_CONFIG } from './pixelEngine';
import type { ViewMode } from '../components/CanvasViewport';

const DB_NAME = 'pix-forge-workspace';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const SESSION_KEY = 'last-session';

const VALID_VIEW_MODES: ReadonlySet<ViewMode> = new Set([
  'side-by-side',
  'split',
  'pixel',
  'crop',
  'edit',
  'animate',
]);

export interface PersistedImageBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface PersistedFrameRecord {
  id: string;
  name: string;
  sourceBlob?: Blob;
  sampleSrc?: string;
  manualEdit?: PersistedImageBuffer;
}

export interface PersistedWorkspaceSession {
  version: 1;
  savedAt: number;
  activeSampleId: string | null;
  activeFrameId: string | null;
  viewMode: ViewMode;
  config: PixelEngineConfig;
  fps: number;
  exportScale: number;
  spriteSheetCols: number;
  frames: PersistedFrameRecord[];
}

export function serializeManualEdit(imageData: ImageData | null): PersistedImageBuffer | undefined {
  if (!imageData || imageData.width <= 0 || imageData.height <= 0) return undefined;
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  };
}

export function deserializeManualEdit(buf?: PersistedImageBuffer): ImageData | null {
  if (!buf || buf.width <= 0 || buf.height <= 0 || !(buf.data instanceof Uint8ClampedArray)) {
    return null;
  }
  if (buf.data.length !== buf.width * buf.height * 4) return null;
  if (typeof ImageData === 'undefined') return null;
  return new ImageData(new Uint8ClampedArray(buf.data), buf.width, buf.height);
}

export function normalizeRestoredSession(raw: unknown): PersistedWorkspaceSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<PersistedWorkspaceSession>;
  if (candidate.version !== 1 || !Array.isArray(candidate.frames) || candidate.frames.length === 0) {
    return null;
  }

  const validFrames = candidate.frames.filter(
    (f): f is PersistedFrameRecord =>
      Boolean(
        f &&
          typeof f.id === 'string' &&
          typeof f.name === 'string' &&
          (f.sourceBlob instanceof Blob || (typeof f.sampleSrc === 'string' && f.sampleSrc.length > 0))
      )
  );
  if (validFrames.length === 0) return null;

  const viewMode: ViewMode =
    candidate.viewMode && VALID_VIEW_MODES.has(candidate.viewMode)
      ? candidate.viewMode
      : 'side-by-side';

  const mergedConfig: PixelEngineConfig = {
    ...DEFAULT_ENGINE_CONFIG,
    ...(candidate.config && typeof candidate.config === 'object' ? candidate.config : {}),
    crop:
      candidate.config?.crop &&
      typeof candidate.config.crop.x === 'number' &&
      typeof candidate.config.crop.y === 'number' &&
      typeof candidate.config.crop.w === 'number' &&
      typeof candidate.config.crop.h === 'number'
        ? { ...candidate.config.crop }
        : { ...DEFAULT_ENGINE_CONFIG.crop },
  };

  return {
    version: 1,
    savedAt: typeof candidate.savedAt === 'number' ? candidate.savedAt : Date.now(),
    activeSampleId: typeof candidate.activeSampleId === 'string' ? candidate.activeSampleId : null,
    activeFrameId: typeof candidate.activeFrameId === 'string' ? candidate.activeFrameId : null,
    viewMode,
    config: mergedConfig,
    fps: typeof candidate.fps === 'number' && candidate.fps >= 1 && candidate.fps <= 30 ? candidate.fps : 10,
    exportScale:
      typeof candidate.exportScale === 'number' && candidate.exportScale >= 1 && candidate.exportScale <= 32
        ? candidate.exportScale
        : 8,
    spriteSheetCols: typeof candidate.spriteSheetCols === 'number' ? candidate.spriteSheetCols : 0,
    frames: validFrames,
  };
}

function openWorkspaceDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadPersistedWorkspace(): Promise<PersistedWorkspaceSession | null> {
  const db = await openWorkspaceDb();
  if (!db) return null;
  try {
    return await new Promise<PersistedWorkspaceSession | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(SESSION_KEY);
      req.onsuccess = () => resolve(normalizeRestoredSession(req.result));
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function savePersistedWorkspace(session: PersistedWorkspaceSession): Promise<void> {
  const db = await openWorkspaceDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(session, SESSION_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Ignore storage quota / private mode errors; app remains fully usable in memory.
  } finally {
    db.close();
  }
}
