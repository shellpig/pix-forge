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

/** Mutate matching visible RGB pixels only. Preserve alpha, including partial alpha. */
export function replaceDocumentColor(data: Uint8ClampedArray, sourceHex: string, targetHex: string): number {
  const source = normalizeDocumentHex(sourceHex);
  const target = normalizeDocumentHex(targetHex);
  if (!source || !target || source === target) return 0;
  const from = Number.parseInt(source.slice(1), 16);
  const to = Number.parseInt(target.slice(1), 16);
  let changed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    if (key !== from) continue;
    data[i] = (to >> 16) & 255;
    data[i + 1] = (to >> 8) & 255;
    data[i + 2] = to & 255;
    changed++;
  }
  return changed;
}
