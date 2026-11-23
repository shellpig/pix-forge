import { rgbToOklab } from './palettes';

export type IsolatedPixelMode = 'off' | 'light' | 'strong';

export interface IsolatedCleanupSettings {
  isolatedPixelMode: IsolatedPixelMode;
  paletteMode: 'full' | 'auto' | 'preset';
  ditherMode: 'none' | 'bayer4' | 'floyd';
}

/**
 * Dithering intentionally makes alternating, isolated colors. Keep the
 * user's selected cleanup mode, but bypass it while dithering is active.
 * "full" bypasses dithering in the engine, so cleanup remains available.
 */
export function isCleanupDisabledByDither(config: IsolatedCleanupSettings): boolean {
  return config.paletteMode !== 'full' && config.ditherMode !== 'none';
}

export function getEffectiveIsolatedPixelMode(config: IsolatedCleanupSettings): IsolatedPixelMode {
  return isCleanupDisabledByDither(config) ? 'off' : config.isolatedPixelMode;
}

/**
 * Remove single-pixel islands via an 8-neighbor majority rule.
 *
 * - Never mutate the input: all decisions read from a single source snapshot.
 * - Only replace a center pixel if NONE of its 8 neighbors matches it.
 * - Light: >=7 matching neighbors and similar visible Oklab colors.
 * - Strong: >=6 matching neighbors, regardless of contrast.
 * - Fully transparent pixels are one logical color, ignoring hidden RGB.
 * - Skip the outermost row/column to protect silhouette boundaries.
 *
 * The replacement is always copied from a real neighbor; no new palette
 * colors can be introduced (including on transparent islands/holes).
 */
export function removeIsolatedPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  mode: IsolatedPixelMode
): Uint8ClampedArray {
  if (mode === 'off' || width < 3 || height < 3) return data;

  if (data.length !== width * height * 4) {
    throw new Error('孤立像素清除：影像緩衝區尺寸不正確。');
  }

  const source = data;
  const output = new Uint8ClampedArray(source);
  const neighbors = new Uint32Array(8);
  const minimumAgreement = mode === 'light' ? 7 : 6;

  // Keep RGB for visible pixels; normalize fully transparent RGB to key 0.
  const colorKeyAt = (offset: number): number => {
    if (source[offset + 3] === 0) return 0;
    return (
      (source[offset + 3] << 24) |
      (source[offset] << 16) |
      (source[offset + 1] << 8) |
      source[offset + 2]
    ) >>> 0;
  };

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const centerOffset = (y * width + x) * 4;
      const centerColor = colorKeyAt(centerOffset);
      let i = 0;
      let hasMatchingNeighbor = false;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const key = colorKeyAt(((y + dy) * width + x + dx) * 4);
          neighbors[i++] = key;
          if (key === centerColor) hasMatchingNeighbor = true;
        }
      }
      if (hasMatchingNeighbor) continue;

      // Boyer-Moore produces the candidate if an 8-neighbor majority exists.
      // Verify its exact count afterwards (light: 7, strong: 6).
      let candidate = 0;
      let votes = 0;
      for (let j = 0; j < 8; j++) {
        if (votes === 0) {
          candidate = neighbors[j];
          votes = 1;
        } else if (neighbors[j] === candidate) {
          votes++;
        } else {
          votes--;
        }
      }
      let agreement = 0;
      for (let j = 0; j < 8; j++) {
        if (neighbors[j] === candidate) agreement++;
      }
      if (agreement < minimumAgreement) continue;

      const nextAlpha = (candidate >>> 24) & 255;
      const centerAlpha = source[centerOffset + 3];

      if (mode === 'light' && centerAlpha !== 0 && nextAlpha !== 0) {
        // Preserve tiny eye highlights, sparks, and intentional accent pixels.
        const before = rgbToOklab(
          source[centerOffset],
          source[centerOffset + 1],
          source[centerOffset + 2]
        );
        const after = rgbToOklab(
          (candidate >>> 16) & 255,
          (candidate >>> 8) & 255,
          candidate & 255
        );
        const dL = before.L - after.L;
        const da = before.a - after.a;
        const db = before.b - after.b;
        const distanceSq = dL * dL + 1.35 * (da * da + db * db);
        if (
          Math.abs(dL) > 0.09 ||
          distanceSq > 0.12 * 0.12 ||
          Math.abs(centerAlpha - nextAlpha) > 40
        ) {
          continue;
        }
      }

      output[centerOffset] = (candidate >>> 16) & 255;
      output[centerOffset + 1] = (candidate >>> 8) & 255;
      output[centerOffset + 2] = candidate & 255;
      output[centerOffset + 3] = nextAlpha;
    }
  }

  return output;
}
