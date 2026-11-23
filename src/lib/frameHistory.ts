import type { PixelEngineResult } from './pixelEngine';
import { cloneImageData } from './pixelEditOps';

export interface FrameHistoryState {
  convertedResult: PixelEngineResult | null;
  editHistory: ImageData[];
  historyIndex: number;
}

/**
 * Index 0 is always the current, unedited conversion baseline.
 * Later history entries are manual edits; they can deliberately retain
 * their appearance when the conversion settings change.
 */
export function getEffectiveFrameImageData(frame: FrameHistoryState): ImageData | null {
  const conversion = frame.convertedResult;
  if (!conversion) return null;
  if (
    frame.historyIndex > 0 &&
    frame.historyIndex < frame.editHistory.length &&
    frame.editHistory[frame.historyIndex].width === conversion.width &&
    frame.editHistory[frame.historyIndex].height === conversion.height
  ) {
    return frame.editHistory[frame.historyIndex];
  }
  return conversion.imageData;
}

/** Update the Undo baseline without overwriting any user-edited snapshots. */
export function applyFrameConversion<T extends FrameHistoryState>(
  frame: T,
  result: PixelEngineResult
): T {
  return {
    ...frame,
    convertedResult: result,
    editHistory: frame.editHistory.length > 0
      ? [cloneImageData(result.imageData), ...frame.editHistory.slice(1)]
      : [],
  };
}

/**
 * Fork the history from the current Undo position. Always use the latest
 * conversion as entry 0, even when the user has undone every manual edit.
 * Keep entry 0 when capping history length so an Undo never jumps back
 * to a stale conversion.
 */
export function appendFrameEdit<T extends FrameHistoryState>(
  frame: T,
  next: ImageData,
  maxHistory: number
): T {
  if (!frame.convertedResult) return frame;

  const currentEdits = frame.historyIndex > 0
    ? frame.editHistory.slice(1, frame.historyIndex + 1)
    : [];
  const history = [
    cloneImageData(frame.convertedResult.imageData),
    ...currentEdits,
    cloneImageData(next),
  ];
  const cap = Math.max(2, Math.floor(maxHistory));
  const trimmed = history.length > cap
    ? [history[0], ...history.slice(-(cap - 1))]
    : history;

  return {
    ...frame,
    editHistory: trimmed,
    historyIndex: trimmed.length - 1,
  };
}
