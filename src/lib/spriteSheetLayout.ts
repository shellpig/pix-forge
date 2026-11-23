/**
 * Conservative browser-canvas export guard. Some devices impose even tighter
 * limits, but checking before allocation avoids known huge-canvas failures.
 */
export const MAX_SPRITE_SHEET_SIDE = 16_384;
export const MAX_SPRITE_SHEET_PIXELS = 16_000_000;

export interface SpriteSheetLayout {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  width: number;
  height: number;
  pixelCount: number;
  isWithinLimits: boolean;
  errorMessage: string | null;
}

/**
 * requestedColumns: 0 = near-square automatic grid, -1 = one row,
 * any positive value = explicit column count (clamped to the frame count).
 */
export function getSpriteSheetLayout(
  frameWidth: number,
  frameHeight: number,
  frameCount: number,
  scale: number,
  requestedColumns: number = 0
): SpriteSheetLayout {
  if (
    ![frameWidth, frameHeight, frameCount, scale, requestedColumns].every(Number.isFinite) ||
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    frameCount <= 0 ||
    scale <= 0
  ) {
    throw new Error('Sprite Sheet 尺寸、影格數與倍率必須是有效的正數。');
  }

  const count = Math.floor(frameCount);
  const columns =
    requestedColumns === -1
      ? count
      : requestedColumns <= 0
        ? Math.ceil(Math.sqrt(count))
        : Math.max(1, Math.min(count, Math.round(requestedColumns)));
  const rows = Math.ceil(count / columns);
  const cellWidth = frameWidth * scale;
  const cellHeight = frameHeight * scale;
  const width = cellWidth * columns;
  const height = cellHeight * rows;
  const pixelCount = width * height;

  const isWithinLimits =
    Number.isSafeInteger(pixelCount) &&
    width <= MAX_SPRITE_SHEET_SIDE &&
    height <= MAX_SPRITE_SHEET_SIDE &&
    pixelCount <= MAX_SPRITE_SHEET_PIXELS;

  const errorMessage = isWithinLimits
    ? null
    : `Sprite Sheet 尺寸 ${width.toLocaleString('zh-TW')}×${height.toLocaleString('zh-TW')}（${pixelCount.toLocaleString('zh-TW')} 像素）超過安全匯出上限：單邊 ${MAX_SPRITE_SHEET_SIDE.toLocaleString('zh-TW')}px、總像素 ${MAX_SPRITE_SHEET_PIXELS.toLocaleString('zh-TW')}。請降低匯出倍率；若多出空白格，也可嘗試調整排列欄數。`;

  return { columns, rows, cellWidth, cellHeight, width, height, pixelCount, isWithinLimits, errorMessage };
}
