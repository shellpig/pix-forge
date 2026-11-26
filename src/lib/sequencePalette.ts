import { collectDocumentColors, createDocumentColorPreview, type DocumentColor } from './documentPalette';
import { getEffectiveFrameImageData } from './frameHistory';
import type { JournalFrame } from './batchHistory';

export type PaletteScope = 'frame' | 'sequence';
export interface SequenceDocumentColor extends DocumentColor {
  pixelCount: number;
  frameCount: number;
  frameIds: string[];
}
export interface SequencePalette {
  colors: SequenceDocumentColor[];
  frameBytes: ReadonlyMap<string, number>;
  frameCount: number;
  convertedCount: number;
}
export function collectSequencePalette(frames: readonly JournalFrame[]): SequencePalette {
  const byColor = new Map<string, SequenceDocumentColor>();
  const frameBytes = new Map<string, number>();
  for (const frame of frames) {
    const image = getEffectiveFrameImageData(frame);
    if (!image) continue;
    frameBytes.set(frame.id, image.data.byteLength);
    for (const color of collectDocumentColors(image.data)) {
      const existing = byColor.get(color.hex);
      if (existing) {
        existing.count += color.count;
        existing.pixelCount += color.count;
        existing.frameIds.push(frame.id);
        existing.frameCount++;
      } else {
        byColor.set(color.hex, {hex:color.hex,count:color.count,pixelCount:color.count,frameCount:1,frameIds:[frame.id]});
      }
    }
  }
  return {colors:[...byColor.values()].sort((a,b)=>b.count-a.count||a.hex.localeCompare(b.hex)),
    frameBytes,frameCount:frames.length,convertedCount:frameBytes.size};
}

export function getSequenceMappingStats(palette: SequencePalette, mapping: ReadonlyMap<string,string>) {
  const after = new Set<string>();
  const affected = new Set<string>();
  let changedPixels = 0;
  for (const color of palette.colors) {
    const next = mapping.get(color.hex) ?? color.hex;
    after.add(next);
    if (next !== color.hex) {
      changedPixels += color.count;
      for (const id of color.frameIds) affected.add(id);
    }
  }
  let bytes = 0;
  for (const id of affected) bytes += 2 * (palette.frameBytes.get(id) ?? 0);
  return {after:after.size,changedPixels,affectedFrameIds:[...affected],bytes};
}

/** Lazy preview: render just the selected frame, including an unchanged frame.
 * The mapping and committed frame references remain the source of truth. */
export function previewSequenceFrame(frame: JournalFrame, mapping: ReadonlyMap<string,string>): ImageData | null {
  const image = getEffectiveFrameImageData(frame);
  if (!image) return null;
  const preview = createDocumentColorPreview(image.data,mapping);
  return preview ? new ImageData(new Uint8ClampedArray(preview.data),image.width,image.height) : image;
}

export function equalPaletteMappings(a: ReadonlyMap<string,string>, b: ReadonlyMap<string,string>): boolean {
  return a.size === b.size && [...a].every(([from,to])=>b.get(from)===to);
}
