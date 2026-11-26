/** Document palette operations work on RGBA bytes, independently of the brush. */
export interface DocumentColor {
  hex: string;
  count: number;
}

export function normalizeDocumentHex(value: string): string | null {
  const raw = value.trim();
  return /^#?[0-9a-f]{6}$/i.test(raw) ? '#' + raw.replace(/^#/, '').toLowerCase() : null;
}

/** Include every visible RGB color, regardless of alpha or conversion palette limits. */
export function collectDocumentColors(data: Uint8ClampedArray): DocumentColor[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts, ([key, count]) => ({
    hex: '#' + key.toString(16).padStart(6, '0'),
    count,
  })).sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));
}

/**
 * Synchronously remap visible RGB pixels in one pass (O(pixels + mappings)).
 * Validate all entries first; invalid/ambiguous normalized mappings are a no-op.
 * A -> B, B -> C maps original A to B and original B to C, never recursively.
 * Transparent pixels and alpha bytes remain unchanged.
 */
export function remapDocumentColors(data: Uint8ClampedArray, mapping: ReadonlyMap<string, string>): number {
  const packed = new Map<number, number>();
  for (const [sourceHex, targetHex] of mapping) {
    const source = normalizeDocumentHex(sourceHex);
    const target = normalizeDocumentHex(targetHex);
    if (!source || !target) return 0;
    const from = Number.parseInt(source.slice(1), 16);
    const to = Number.parseInt(target.slice(1), 16);
    const previous = packed.get(from);
    if (previous !== undefined && previous !== to) return 0;
    packed.set(from, to);
  }
  for (const [from, to] of packed) {
    if (from === to) packed.delete(from);
  }
  if (packed.size === 0) return 0;

  let changed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    const to = packed.get(key);
    if (to === undefined) continue;
    data[i] = (to >> 16) & 255;
    data[i + 1] = (to >> 8) & 255;
    data[i + 2] = to & 255;
    changed++;
  }
  return changed;
}

/** Compatibility wrapper for the original Phase 01 single-color API. */
export function replaceDocumentColor(data: Uint8ClampedArray, sourceHex: string, targetHex: string): number {
  return remapDocumentColors(data, new Map([[sourceHex, targetHex]]));
}

export interface DocumentColorPreview {
  data: Uint8ClampedArray;
  changed: number;
}

/**
 * Always derive a fresh preview from the committed baseline. Do not mutate it.
 * Null means there is no effective edit (including invalid mappings).
 */
export function createDocumentColorPreview(
  baseline: Uint8ClampedArray,
  mapping: ReadonlyMap<string, string>
): DocumentColorPreview | null {
  const data = new Uint8ClampedArray(baseline);
  const changed = remapDocumentColors(data, mapping);
  return changed > 0 ? { data, changed } : null;
}
