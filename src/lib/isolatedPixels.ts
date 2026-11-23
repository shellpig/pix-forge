import { rgbToOklab } from './palettes';

export type IsolatedPixelMode = 'off' | 'light' | 'strong';

// All cleanup thresholds live here so modes stay consistent in every caller.
export const CLEANUP_RULES = {
  light: { minCandidateCount: 4, maxColorDelta: 0.2, minAlphaAgreement: 7 },
  strong: { minCandidateCount: 3, maxColorDelta: 0.3, minAlphaAgreement: 6 },
} as const;

export const LOCAL_EXTREME_L_MARGIN = 0.12;

export interface IsolatedCleanupSettings {
  isolatedPixelMode: IsolatedPixelMode;
  paletteMode: 'full' | 'auto' | 'preset';
  ditherMode: 'none' | 'bayer4' | 'floyd';
}

/**
 * Dithering deliberately introduces isolated, alternating pixels. Keep the
 * user's preference, but bypass cleanup while actual dithering is enabled.
 * Full-color mode bypasses quantization/dithering, so cleanup stays available.
 */
export function isCleanupDisabledByDither(config: IsolatedCleanupSettings): boolean {
  return config.paletteMode !== 'full' && config.ditherMode !== 'none';
}

export function getEffectiveIsolatedPixelMode(config: IsolatedCleanupSettings): IsolatedPixelMode {
  return isCleanupDisabledByDither(config) ? 'off' : config.isolatedPixelMode;
}

/**
 * An 8-neighbor, palette-preserving single-pixel cleanup pass.
 *
 * Opaque pixels: choose the closest Oklab color among neighbor groups with
 * enough votes, unless the center is a local luminance extreme or the color
 * difference is too large. Strong and Light BOTH protect local extremes.
 *
 * Transparent pixels / alpha changes: retain the stricter 7/6 vote rules.
 * Every replacement copies a complete RGBA value from an actual neighbor.
 * All reads come from the original input and all writes go to a copy.
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

  const rules = CLEANUP_RULES[mode];
  const source = data;
  const output = new Uint8ClampedArray(source);
  const size = width * height;

  // Cache normalized RGBA keys and Oklab once before walking the image.
  // Alpha=0 has one logical key regardless of its hidden RGB bytes.
  const keys = new Uint32Array(size);
  const labL = new Float32Array(size);
  const labA = new Float32Array(size);
  const labB = new Float32Array(size);
  const labCache = new Map<number, { L: number; a: number; b: number }>();
  for (let index = 0; index < size; index++) {
    const offset = index * 4;
    const alpha = source[offset + 3];
    if (alpha === 0) continue;

    const r = source[offset];
    const g = source[offset + 1];
    const b = source[offset + 2];
    const rgbKey = (r << 16) | (g << 8) | b;
    keys[index] = ((alpha << 24) | rgbKey) >>> 0;

    let lab = labCache.get(rgbKey);
    if (!lab) {
      lab = rgbToOklab(r, g, b);
      labCache.set(rgbKey, lab);
    }
    labL[index] = lab.L;
    labA[index] = lab.a;
    labB[index] = lab.b;
  }

  // Eight neighbors contain at most eight distinct colors. Reuse scratch
  // arrays to avoid allocating maps or objects for each output pixel.
  const groupKeys = new Uint32Array(8);
  const groupCounts = new Uint8Array(8);
  const groupFirstIndices = new Int32Array(8);

  const copyNeighbor = (centerIndex: number, neighborIndex: number): void => {
    const dst = centerIndex * 4;
    const src = neighborIndex * 4;
    output[dst] = source[src];
    output[dst + 1] = source[src + 1];
    output[dst + 2] = source[src + 2];
    output[dst + 3] = source[src + 3];
  };

  // Do not touch the outermost border: important for sprite silhouettes.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const center = y * width + x;
      const centerKey = keys[center];
      const centerAlpha = source[center * 4 + 3];
      let groupLength = 0;
      let hasSameColorNeighbor = false;
      let darkestOpaque = Infinity;
      let brightestOpaque = -Infinity;
      let transparentCount = 0;
      let firstTransparentIndex = -1;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const neighbor = (y + dy) * width + x + dx;
          const key = keys[neighbor];

          if (key === centerKey) hasSameColorNeighbor = true;
          if (key === 0) {
            transparentCount++;
            if (firstTransparentIndex < 0) firstTransparentIndex = neighbor;
          } else {
            const lightness = labL[neighbor];
            if (lightness < darkestOpaque) darkestOpaque = lightness;
            if (lightness > brightestOpaque) brightestOpaque = lightness;
          }

          let group = 0;
          while (group < groupLength && groupKeys[group] !== key) group++;
          if (group === groupLength) {
            groupKeys[group] = key;
            groupCounts[group] = 1;
            groupFirstIndices[group] = neighbor;
            groupLength++;
          } else {
            groupCounts[group]++;
          }
        }
      }

      // Any matching neighbor means this pixel is part of a connected feature.
      if (hasSameColorNeighbor) continue;

      // A highlight or dark accent that lies outside the local luminance
      // range is meaningful even in Strong mode. But if enough neighbors are
      // transparent to erase an opaque speck (7 in Light, 6 in Strong),
      // do not let one remaining dark/bright neighbor block that cleanup.
      if (
        centerAlpha !== 0 &&
        darkestOpaque !== Infinity &&
        transparentCount < rules.minAlphaAgreement
      ) {
        const lightness = labL[center];
        if (
          lightness >= brightestOpaque + LOCAL_EXTREME_L_MARGIN ||
          lightness <= darkestOpaque - LOCAL_EXTREME_L_MARGIN
        ) {
          continue;
        }
      }

      if (centerAlpha === 0) {
        // Transparent pinhole: only a near-unanimous *single* opaque color
        // may fill it. No color-distance comparison is meaningful here.
        let bestGroup = -1;
        for (let group = 0; group < groupLength; group++) {
          if (groupKeys[group] === 0 || groupCounts[group] < rules.minAlphaAgreement) continue;
          if (bestGroup < 0 || groupCounts[group] > groupCounts[bestGroup]) {
            bestGroup = group;
          }
        }
        if (bestGroup >= 0) copyNeighbor(center, groupFirstIndices[bestGroup]);
        continue;
      }

      // Visible isolated center: choose the nearest supported opaque color,
      // not necessarily the group with the most votes. An alpha change
      // (including partially transparent colors) still needs 7/6 votes.
      let bestGroup = -1;
      let bestDistanceSquared = Infinity;
      for (let group = 0; group < groupLength; group++) {
        if (groupKeys[group] === 0 || groupCounts[group] < rules.minCandidateCount) continue;
        const neighbor = groupFirstIndices[group];
        if (
          source[neighbor * 4 + 3] !== centerAlpha &&
          groupCounts[group] < rules.minAlphaAgreement
        ) continue;

        const dL = labL[center] - labL[neighbor];
        const da = labA[center] - labA[neighbor];
        const db = labB[center] - labB[neighbor];
        // Standard, unweighted Oklab Euclidean distance.
        const distanceSquared = dL * dL + da * da + db * db;
        if (
          distanceSquared < bestDistanceSquared - 1e-12 ||
          (Math.abs(distanceSquared - bestDistanceSquared) <= 1e-12 &&
            (bestGroup < 0 || groupCounts[group] > groupCounts[bestGroup]))
        ) {
          bestGroup = group;
          bestDistanceSquared = distanceSquared;
        }
      }

      if (bestGroup >= 0 && bestDistanceSquared <= rules.maxColorDelta ** 2) {
        copyNeighbor(center, groupFirstIndices[bestGroup]);
        continue;
      }

      // Cleanup of an opaque stray point on a transparent background uses
      // the original strict transparency threshold, not the color threshold.
      if (transparentCount >= rules.minAlphaAgreement && firstTransparentIndex >= 0) {
        copyNeighbor(center, firstTransparentIndex);
      }
    }
  }

  return output;
}
