import {
  PRESET_PALETTES,
  RGBColor,
  OKLabColor,
  hexToRgb,
  oklabToRgb,
  rgbToHex,
  rgbToOklab,
} from './palettes';

export type DownscaleMode = 'clean-sprite' | 'pixeloe' | 'k-centroid' | 'area';
export type PaletteMode = 'full' | 'auto' | 'preset';
export type DitherMode = 'none' | 'bayer4' | 'floyd';

export interface CropRect {
  /** Normalized 0..1 coordinates on source image */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PixelEngineConfig {
  targetW: number;
  targetH: number;
  crop: CropRect;
  downscaleMode: DownscaleMode;
  outlineStrength: number; // 0..100
  smoothness: number; // 0..100
  preSharpen: number; // 0..100
  paletteMode: PaletteMode;
  autoColorCount: number; // 4..64
  sharedSequencePalette: boolean; // Share one unified OKLab palette across all animation frames
  presetPaletteId: string;
  ditherMode: DitherMode;
  ditherStrength: number; // 0..100
  contrast: number; // -30..50
  saturation: number; // -50..60
  alphaThreshold: number; // 0..255
}

export interface PixelEngineResult {
  imageData: ImageData;
  width: number;
  height: number;
  palette: string[];
  uniqueColorCount: number;
  computeMs: number;
}

export const DEFAULT_ENGINE_CONFIG: PixelEngineConfig = {
  targetW: 64,
  targetH: 64,
  crop: { x: 0, y: 0, w: 1, h: 1 },
  downscaleMode: 'clean-sprite',
  outlineStrength: 25,
  smoothness: 30,
  preSharpen: 15,
  paletteMode: 'auto',
  autoColorCount: 32,
  sharedSequencePalette: true,
  presetPaletteId: 'endesga32',
  ditherMode: 'none',
  ditherStrength: 40,
  contrast: 6,
  saturation: 12,
  alphaThreshold: 128,
};

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Edge-preserving bilateral smoothing on the working buffer.
 */
function applyBilateralSmooth(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  smoothnessPct: number,
  alphaThreshold: number
): void {
  if (smoothnessPct <= 0) return;

  const strength = smoothnessPct / 100;
  const sigmaColor = 18 + strength * 34;
  const invTwoSigmaColorSq = 1 / (2 * sigmaColor * sigmaColor);
  const passes = strength > 0.65 ? 2 : 1;

  const spatialW = [0.55, 0.85, 0.55, 0.85, 1.0, 0.85, 0.55, 0.85, 0.55];

  let src = new Uint8ClampedArray(data);
  const dst = new Uint8ClampedArray(data.length);

  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cOff = (y * w + x) * 4;
        const ca = src[cOff + 3];
        if (ca < alphaThreshold) {
          dst[cOff] = src[cOff];
          dst[cOff + 1] = src[cOff + 1];
          dst[cOff + 2] = src[cOff + 2];
          dst[cOff + 3] = ca;
          continue;
        }

        const cr = src[cOff];
        const cg = src[cOff + 1];
        const cb = src[cOff + 2];

        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let sumW = 0;

        let ki = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy;
          const rowOff = ny * w;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx;
            const nOff = (rowOff + nx) * 4;
            const sw = spatialW[ki++];
            if (src[nOff + 3] < alphaThreshold) continue;

            const dr = src[nOff] - cr;
            const dg = src[nOff + 1] - cg;
            const db = src[nOff + 2] - cb;
            const colorDistSq = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
            const weight = sw * Math.exp(-colorDistSq * invTwoSigmaColorSq);

            sumR += src[nOff] * weight;
            sumG += src[nOff + 1] * weight;
            sumB += src[nOff + 2] * weight;
            sumW += weight;
          }
        }

        const blend = Math.min(1, strength * 1.15);
        const invBlend = 1 - blend;
        dst[cOff] = Math.round(cr * invBlend + (sumR / sumW) * blend);
        dst[cOff + 1] = Math.round(cg * invBlend + (sumG / sumW) * blend);
        dst[cOff + 2] = Math.round(cb * invBlend + (sumB / sumW) * blend);
        dst[cOff + 3] = ca;
      }
    }

    data.set(dst);
    if (pass + 1 < passes) {
      src = new Uint8ClampedArray(dst);
    }
  }
}

/**
 * Gentle unsharp mask on the working buffer
 */
function applyPreSharpen(data: Uint8ClampedArray, w: number, h: number, strengthPct: number): void {
  if (strengthPct <= 0) return;
  const amount = (strengthPct / 100) * 0.45;
  const copy = new Uint8ClampedArray(data);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (copy[i + 3] < 16) continue;
      const up = i - w * 4;
      const dn = i + w * 4;
      const lt = i - 4;
      const rt = i + 4;
      for (let c = 0; c < 3; c++) {
        const blur = (copy[up + c] + copy[dn + c] + copy[lt + c] + copy[rt + c]) * 0.25;
        const diff = copy[i + c] - blur;
        const delta = Math.max(-42, Math.min(42, diff * amount * 2.0));
        data[i + c] = clamp255(Math.round(copy[i + c] + delta));
      }
    }
  }
}

/**
 * Gentle 3x3 contrast-aware outline preservation.
 */
function applyGentleOutlinePreservation(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  strengthPct: number,
  alphaThreshold: number
): void {
  if (strengthPct <= 0) return;
  const strength = (strengthPct / 100) * 0.42;
  const n = w * h;
  const src = new Uint8ClampedArray(data);
  const lum = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const off = i * 4;
    lum[i] = 0.299 * src[off] + 0.587 * src[off + 1] + 0.114 * src[off + 2];
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const off = idx * 4;
      if (src[off + 3] < alphaThreshold) continue;

      let minL = 255;
      let maxL = 0;
      let sumL = 0;
      let minIdx = idx;
      let maxIdx = idx;
      let count = 0;

      for (let dy = -1; dy <= 1; dy++) {
        const row = (y + dy) * w;
        for (let dx = -1; dx <= 1; dx++) {
          const ni = row + (x + dx);
          if (src[ni * 4 + 3] < alphaThreshold) continue;
          const l = lum[ni];
          sumL += l;
          count++;
          if (l < minL) {
            minL = l;
            minIdx = ni;
          }
          if (l > maxL) {
            maxL = l;
            maxIdx = ni;
          }
        }
      }

      if (count < 4) continue;
      const range = maxL - minL;
      if (range < 55) continue;

      const meanL = sumL / count;
      const darkDist = meanL - minL;
      const brightDist = maxL - meanL;

      if (darkDist > brightDist * 1.35 && lum[idx] > minL + 25) {
        const weight = Math.min(1, (darkDist - brightDist) / range) * strength;
        const mOff = minIdx * 4;
        const inv = 1 - weight;
        data[off] = Math.round(src[off] * inv + src[mOff] * weight);
        data[off + 1] = Math.round(src[off + 1] * inv + src[mOff + 1] * weight);
        data[off + 2] = Math.round(src[off + 2] * inv + src[mOff + 2] * weight);
      } else if (brightDist > darkDist * 1.45 && lum[idx] < maxL - 25) {
        const weight = Math.min(1, (brightDist - darkDist) / range) * strength * 0.85;
        const mOff = maxIdx * 4;
        const inv = 1 - weight;
        data[off] = Math.round(src[off] * inv + src[mOff] * weight);
        data[off + 1] = Math.round(src[off + 1] * inv + src[mOff + 1] * weight);
        data[off + 2] = Math.round(src[off + 2] * inv + src[mOff + 2] * weight);
      }
    }
  }
}

/**
 * Downscale working buffer (targetW * P, targetH * P) to (targetW, targetH)
 */
function downscaleBuffer(
  workData: Uint8ClampedArray,
  workW: number,
  targetW: number,
  targetH: number,
  patchSize: number,
  mode: DownscaleMode,
  outlineStrength: number,
  alphaThreshold: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(targetW * targetH * 4);
  const maxPatchPixels = patchSize * patchSize;

  const pR = new Uint8Array(maxPatchPixels);
  const pG = new Uint8Array(maxPatchPixels);
  const pB = new Uint8Array(maxPatchPixels);
  const pL = new Float32Array(maxPatchPixels);
  const order = new Int32Array(maxPatchPixels);

  const outlineFactor = outlineStrength / 100;

  for (let ty = 0; ty < targetH; ty++) {
    const startY = ty * patchSize;
    for (let tx = 0; tx < targetW; tx++) {
      const startX = tx * patchSize;
      const outOff = (ty * targetW + tx) * 4;

      let count = 0;
      let alphaSum = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;

      for (let py = 0; py < patchSize; py++) {
        const rowOff = (startY + py) * workW;
        for (let px = 0; px < patchSize; px++) {
          const idx = (rowOff + startX + px) * 4;
          const a = workData[idx + 3];
          alphaSum += a;
          if (a >= alphaThreshold) {
            const r = workData[idx];
            const g = workData[idx + 1];
            const b = workData[idx + 2];
            pR[count] = r;
            pG[count] = g;
            pB[count] = b;
            pL[count] = 0.299 * r + 0.587 * g + 0.114 * b;
            order[count] = count;
            sumR += r;
            sumG += g;
            sumB += b;
            count++;
          }
        }
      }

      const avgAlpha = alphaSum / maxPatchPixels;
      if (count === 0 || (alphaThreshold > 0 && avgAlpha < alphaThreshold)) {
        out[outOff] = 0;
        out[outOff + 1] = 0;
        out[outOff + 2] = 0;
        out[outOff + 3] = 0;
        continue;
      }

      const avgR = sumR / count;
      const avgG = sumG / count;
      const avgB = sumB / count;

      if (mode === 'area') {
        out[outOff] = Math.round(avgR);
        out[outOff + 1] = Math.round(avgG);
        out[outOff + 2] = Math.round(avgB);
        out[outOff + 3] = 255;
        continue;
      }

      if (mode === 'pixeloe') {
        for (let i = 1; i < count; i++) {
          const key = order[i];
          const keyL = pL[key];
          let j = i - 1;
          while (j >= 0 && pL[order[j]] > keyL) {
            order[j + 1] = order[j];
            j--;
          }
          order[j + 1] = key;
        }

        const medIdx = order[count >> 1];
        const lowIdx = order[Math.floor((count - 1) * 0.18)];
        const highIdx = order[Math.floor((count - 1) * 0.82)];

        const avgLab = rgbToOklab(Math.round(avgR), Math.round(avgG), Math.round(avgB));
        const medLab = rgbToOklab(pR[medIdx], pG[medIdx], pB[medIdx]);
        const lowLab = rgbToOklab(pR[lowIdx], pG[lowIdx], pB[lowIdx]);
        const highLab = rgbToOklab(pR[highIdx], pG[highIdx], pB[highIdx]);

        const darkGap = medLab.L - lowLab.L;
        const brightGap = highLab.L - medLab.L;
        const lRange = highLab.L - lowLab.L;

        const outA = avgLab.a * 0.55 + medLab.a * 0.45;
        const outB = avgLab.b * 0.55 + medLab.b * 0.45;
        let outL = medLab.L * 0.65 + avgLab.L * 0.35;

        if (lRange > 0.18) {
          const pull = 0.25 + outlineFactor * 0.5;
          if (darkGap > brightGap * 1.25 && darkGap > 0.14) {
            outL = outL * (1 - pull) + lowLab.L * pull;
          } else if (brightGap > darkGap * 1.25 && brightGap > 0.14) {
            outL = outL * (1 - pull) + highLab.L * pull;
          }
        }

        const rgb = oklabToRgb(outL, outA, outB);
        out[outOff] = rgb.r;
        out[outOff + 1] = rgb.g;
        out[outOff + 2] = rgb.b;
        out[outOff + 3] = 255;
        continue;
      }

      let minIdx = 0;
      let maxIdx = 0;
      for (let k = 1; k < count; k++) {
        if (pL[k] < pL[minIdx]) minIdx = k;
        if (pL[k] > pL[maxIdx]) maxIdx = k;
      }

      let r1 = pR[minIdx];
      let g1 = pG[minIdx];
      let b1 = pB[minIdx];
      let r2 = pR[maxIdx];
      let g2 = pG[maxIdx];
      let b2 = pB[maxIdx];

      let c1Count = 0;
      let c2Count = 0;

      for (let iter = 0; iter < 4; iter++) {
        let sr1 = 0, sg1 = 0, sb1 = 0;
        let sr2 = 0, sg2 = 0, sb2 = 0;
        c1Count = 0;
        c2Count = 0;

        for (let k = 0; k < count; k++) {
          const dr1 = pR[k] - r1;
          const dg1 = pG[k] - g1;
          const db1 = pB[k] - b1;
          const d1 = dr1 * dr1 * 0.3 + dg1 * dg1 * 0.59 + db1 * db1 * 0.11;

          const dr2 = pR[k] - r2;
          const dg2 = pG[k] - g2;
          const db2 = pB[k] - b2;
          const d2 = dr2 * dr2 * 0.3 + dg2 * dg2 * 0.59 + db2 * db2 * 0.11;

          if (d1 <= d2) {
            sr1 += pR[k];
            sg1 += pG[k];
            sb1 += pB[k];
            c1Count++;
          } else {
            sr2 += pR[k];
            sg2 += pG[k];
            sb2 += pB[k];
            c2Count++;
          }
        }

        if (c1Count > 0) {
          r1 = sr1 / c1Count;
          g1 = sg1 / c1Count;
          b1 = sb1 / c1Count;
        }
        if (c2Count > 0) {
          r2 = sr2 / c2Count;
          g2 = sg2 / c2Count;
          b2 = sb2 / c2Count;
        }
      }

      if (mode === 'k-centroid') {
        if (c1Count >= c2Count) {
          out[outOff] = Math.round(r1);
          out[outOff + 1] = Math.round(g1);
          out[outOff + 2] = Math.round(b1);
        } else {
          out[outOff] = Math.round(r2);
          out[outOff + 1] = Math.round(g2);
          out[outOff + 2] = Math.round(b2);
        }
        out[outOff + 3] = 255;
        continue;
      }

      const dr = r2 - r1;
      const dg = g2 - g1;
      const db = b2 - b1;
      const clusterSep = Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11);

      if (clusterSep < 22) {
        out[outOff] = Math.round(avgR);
        out[outOff + 1] = Math.round(avgG);
        out[outOff + 2] = Math.round(avgB);
        out[outOff + 3] = 255;
      } else {
        const lab1 = rgbToOklab(Math.round(r1), Math.round(g1), Math.round(b1));
        const lab2 = rgbToOklab(Math.round(r2), Math.round(g2), Math.round(b2));
        const chroma1 = Math.hypot(lab1.a, lab1.b);
        const chroma2 = Math.hypot(lab2.a, lab2.b);

        const share1 = c1Count / count;
        const share2 = c2Count / count;

        const score1 = share1 + (chroma1 > 0.08 && share1 >= 0.28 ? chroma1 * 1.15 : 0);
        const score2 = share2 + (chroma2 > 0.08 && share2 >= 0.28 ? chroma2 * 1.15 : 0);

        const winR = score1 >= score2 ? r1 : r2;
        const winG = score1 >= score2 ? g1 : g2;
        const winB = score1 >= score2 ? b1 : b2;

        out[outOff] = Math.round(winR * 0.8 + avgR * 0.2);
        out[outOff + 1] = Math.round(winG * 0.8 + avgG * 0.2);
        out[outOff + 2] = Math.round(winB * 0.8 + avgB * 0.2);
        out[outOff + 3] = 255;
      }
    }
  }

  return out;
}

/**
 * Adjust contrast and saturation cleanly on the target pixel grid
 */
function applyToneAdjustments(
  data: Uint8ClampedArray,
  contrast: number,
  saturation: number
): void {
  if (contrast === 0 && saturation === 0) return;

  const cFactor = (100 + contrast) / 100;
  const sFactor = (100 + saturation) / 100;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;

    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    if (contrast !== 0) {
      r = (r - 128) * cFactor + 128;
      g = (g - 128) * cFactor + 128;
      b = (b - 128) * cFactor + 128;
    }

    if (saturation !== 0) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * sFactor;
      g = gray + (g - gray) * sFactor;
      b = gray + (b - gray) * sFactor;
    }

    data[i] = clamp255(Math.round(r));
    data[i + 1] = clamp255(Math.round(g));
    data[i + 2] = clamp255(Math.round(b));
  }
}

/**
 * Chroma-Aware & Rare-Focal-Preserving OKLab Palette Extraction across 1 or multiple buffers!
 * When given all frames of an animation sequence, produces one unified palette so colors never flicker across frames.
 */
export function extractAutoPaletteFromBuffers(
  buffers: Uint8ClampedArray[],
  k: number
): RGBColor[] {
  const freqMap = new Map<number, number>();
  for (const data of buffers) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      freqMap.set(key, (freqMap.get(key) || 0) + 1);
    }
  }

  const uniqueCount = freqMap.size;
  if (uniqueCount === 0) return [{ r: 0, g: 0, b: 0 }];

  if (uniqueCount <= k) {
    const out: RGBColor[] = [];
    freqMap.forEach((_, key) => {
      out.push({ r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255 });
    });
    return out;
  }

  // Cap sample pool cleanly if huge multi-frame sequence (> 12,000 unique RGB colors)
  let entries = Array.from(freqMap.entries());
  if (entries.length > 8192) {
    entries.sort((a, b) => b[1] - a[1]);
    entries = entries.slice(0, 8192);
  }

  const n = entries.length;
  const ptsL = new Float32Array(n);
  const ptsA = new Float32Array(n);
  const ptsB = new Float32Array(n);
  const impWeights = new Float32Array(n);

  let maxCountIdx = 0;
  let maxCount = -1;

  for (let idx = 0; idx < n; idx++) {
    const [key, count] = entries[idx];
    const lab = rgbToOklab((key >> 16) & 255, (key >> 8) & 255, key & 255);
    const chroma = Math.hypot(lab.a, lab.b);
    ptsL[idx] = lab.L;
    ptsA[idx] = lab.a;
    ptsB[idx] = lab.b;
    impWeights[idx] = Math.pow(count, 0.42) * (1 + chroma * 6.5);
    if (count > maxCount) {
      maxCount = count;
      maxCountIdx = idx;
    }
  }

  const centL = new Float32Array(k);
  const centA = new Float32Array(k);
  const centB = new Float32Array(k);

  centL[0] = ptsL[maxCountIdx];
  centA[0] = ptsA[maxCountIdx];
  centB[0] = ptsB[maxCountIdx];

  const minDistSq = new Float32Array(n);
  minDistSq.fill(Infinity);

  for (let c = 1; c < k; c++) {
    const prevL = centL[c - 1];
    const prevA = centA[c - 1];
    const prevB = centB[c - 1];

    let bestIdx = 0;
    let bestScore = -1;

    for (let i = 0; i < n; i++) {
      const dL = ptsL[i] - prevL;
      const da = ptsA[i] - prevA;
      const db = ptsB[i] - prevB;
      const d2 = dL * dL + (da * da + db * db) * 1.45;
      if (d2 < minDistSq[i]) minDistSq[i] = d2;

      const score = minDistSq[i] * impWeights[i];
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    centL[c] = ptsL[bestIdx];
    centA[c] = ptsA[bestIdx];
    centB[c] = ptsB[bestIdx];
  }

  const sumL = new Float32Array(k);
  const sumA = new Float32Array(k);
  const sumB = new Float32Array(k);
  const sumW = new Float32Array(k);

  for (let iter = 0; iter < 10; iter++) {
    sumL.fill(0);
    sumA.fill(0);
    sumB.fill(0);
    sumW.fill(0);

    for (let i = 0; i < n; i++) {
      const l = ptsL[i];
      const a = ptsA[i];
      const b = ptsB[i];
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dL = l - centL[c];
        const da = a - centA[c];
        const db = b - centB[c];
        const d = dL * dL + (da * da + db * db) * 1.35;
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      const w = impWeights[i];
      sumL[bestC] += l * w;
      sumA[bestC] += a * w;
      sumB[bestC] += b * w;
      sumW[bestC] += w;
    }

    for (let c = 0; c < k; c++) {
      if (sumW[c] > 0) {
        centL[c] = sumL[c] / sumW[c];
        centA[c] = sumA[c] / sumW[c];
        centB[c] = sumB[c] / sumW[c];
      }
    }
  }

  const palette: RGBColor[] = [];
  for (let c = 0; c < k; c++) {
    if (sumW[c] > 0) {
      palette.push(oklabToRgb(centL[c], centA[c], centB[c]));
    }
  }
  return palette;
}

/**
 * Map pixel grid to target RGB palette in OKLab space with optional Bayer 4x4 or Floyd-Steinberg dithering
 */
function quantizeWithPalette(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  palette: RGBColor[],
  ditherMode: DitherMode,
  ditherStrengthPct: number
): void {
  const palLab: OKLabColor[] = palette.map((c) => rgbToOklab(c.r, c.g, c.b));
  const palLen = palette.length;
  const strength = ditherStrengthPct / 100;

  const findNearest = (r: number, g: number, b: number): RGBColor => {
    const lab = rgbToOklab(r, g, b);
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let p = 0; p < palLen; p++) {
      const dL = lab.L - palLab[p].L;
      const da = lab.a - palLab[p].a;
      const db = lab.b - palLab[p].b;
      const d = dL * dL + (da * da + db * db) * 1.35;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = p;
      }
    }
    return palette[bestIdx];
  };

  if (ditherMode === 'floyd' && strength > 0) {
    const buf = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) buf[i] = data[i];

    const addError = (nx: number, ny: number, er: number, eg: number, eb: number, weight: number) => {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) return;
      const o = (ny * w + nx) * 4;
      if (data[o + 3] === 0) return;
      buf[o] = clamp255(buf[o] + er * weight);
      buf[o + 1] = clamp255(buf[o + 1] + eg * weight);
      buf[o + 2] = clamp255(buf[o + 2] + eb * weight);
    };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const off = (y * w + x) * 4;
        if (data[off + 3] === 0) continue;

        const oldR = clamp255(buf[off]);
        const oldG = clamp255(buf[off + 1]);
        const oldB = clamp255(buf[off + 2]);
        const nearest = findNearest(oldR, oldG, oldB);

        data[off] = nearest.r;
        data[off + 1] = nearest.g;
        data[off + 2] = nearest.b;

        const er = Math.max(-56, Math.min(56, oldR - nearest.r)) * strength;
        const eg = Math.max(-56, Math.min(56, oldG - nearest.g)) * strength;
        const eb = Math.max(-56, Math.min(56, oldB - nearest.b)) * strength;

        addError(x + 1, y, er, eg, eb, 7 / 16);
        addError(x - 1, y + 1, er, eg, eb, 3 / 16);
        addError(x, y + 1, er, eg, eb, 5 / 16);
        addError(x + 1, y + 1, er, eg, eb, 1 / 16);
      }
    }
    return;
  }

  const bayerSpread = ditherMode === 'bayer4' ? strength * 40 : 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const off = (y * w + x) * 4;
      if (data[off + 3] === 0) continue;

      let r = data[off];
      let g = data[off + 1];
      let b = data[off + 2];

      if (bayerSpread > 0) {
        const threshold = BAYER_4X4[y & 3][x & 3] / 16 - 0.5;
        const delta = threshold * bayerSpread;
        r = clamp255(r + delta);
        g = clamp255(g + delta);
        b = clamp255(b + delta);
      }

      const nearest = findNearest(r, g, b);
      data[off] = nearest.r;
      data[off + 1] = nearest.g;
      data[off + 2] = nearest.b;
    }
  }
}

/**
 * Collect unique palette colors used in the final pixel art, sorted perceptually by luminance
 */
export function collectUsedPalette(data: Uint8ClampedArray): {
  swatches: string[];
  totalUnique: number;
} {
  const seen = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    seen.set(key, (seen.get(key) || 0) + 1);
  }

  const entries = Array.from(seen.entries());
  const limited =
    entries.length > 64
      ? entries.sort((a, b) => b[1] - a[1]).slice(0, 48)
      : entries;

  const sorted = limited
    .map(([key]) => {
      const r = (key >> 16) & 255;
      const g = (key >> 8) & 255;
      const b = key & 255;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      return { hex: rgbToHex(r, g, b), lum };
    })
    .sort((a, b) => a.lum - b.lum)
    .map((x) => x.hex);

  return { swatches: sorted, totalUnique: seen.size };
}

/**
 * Stage 1: Preprocess, downscale, and tone-adjust a raw working buffer WITHOUT palette quantization
 */
function downscaleWorkingBufferPreQuant(
  workData: Uint8ClampedArray,
  workW: number,
  workH: number,
  targetW: number,
  targetH: number,
  patchSize: number,
  config: PixelEngineConfig
): Uint8ClampedArray {
  if (config.smoothness > 0) {
    applyBilateralSmooth(workData, workW, workH, config.smoothness, config.alphaThreshold);
  }

  if (config.preSharpen > 0) {
    applyPreSharpen(workData, workW, workH, config.preSharpen);
  }

  if (config.outlineStrength > 0 && config.downscaleMode !== 'area') {
    applyGentleOutlinePreservation(
      workData,
      workW,
      workH,
      config.outlineStrength,
      config.alphaThreshold
    );
  }

  const pixelBytes = downscaleBuffer(
    workData,
    workW,
    targetW,
    targetH,
    patchSize,
    config.downscaleMode,
    config.outlineStrength,
    config.alphaThreshold
  );

  applyToneAdjustments(pixelBytes, config.contrast, config.saturation);
  return pixelBytes;
}

/**
 * Core processing function on raw RGBA working buffer (also directly testable outside DOM)
 */
export function processWorkingBuffer(
  workData: Uint8ClampedArray,
  workW: number,
  workH: number,
  targetW: number,
  targetH: number,
  patchSize: number,
  config: PixelEngineConfig
): { data: Uint8ClampedArray; palette: string[]; uniqueColorCount: number } {
  const pixelBytes = downscaleWorkingBufferPreQuant(
    workData,
    workW,
    workH,
    targetW,
    targetH,
    patchSize,
    config
  );

  if (config.paletteMode === 'auto') {
    const k = Math.max(2, Math.min(64, Math.round(config.autoColorCount)));
    const autoPalette = extractAutoPaletteFromBuffers([pixelBytes], k);
    quantizeWithPalette(pixelBytes, targetW, targetH, autoPalette, config.ditherMode, config.ditherStrength);
  } else if (config.paletteMode === 'preset') {
    const preset = PRESET_PALETTES.find((p) => p.id === config.presetPaletteId) || PRESET_PALETTES[0];
    const presetRgb = preset.colors.map(hexToRgb);
    quantizeWithPalette(pixelBytes, targetW, targetH, presetRgb, config.ditherMode, config.ditherStrength);
  }

  const { swatches, totalUnique } = collectUsedPalette(pixelBytes);
  return { data: pixelBytes, palette: swatches, uniqueColorCount: totalUnique };
}

/**
 * Keep the existing multi-step resampling algorithm on both the browser main
 * thread and inside a module Worker (where document is unavailable).
 */
function createResampleCanvas(): HTMLCanvasElement | OffscreenCanvas {
  return typeof document === 'undefined'
    ? new OffscreenCanvas(1, 1)
    : document.createElement('canvas');
}

/**
 * Multi-step high-quality canvas resample helper.
 */
function resampleToWorkingBuffer(
  sourceImage: HTMLImageElement | ImageBitmap,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  workW: number,
  workH: number
): ImageData {
  let curCanvas = createResampleCanvas();
  let curW = Math.max(workW, Math.round(sw));
  let curH = Math.max(workH, Math.round(sh));

  if (curW > workW * 2 || curH > workH * 2) {
    const stepW = Math.max(workW * 2, Math.round(curW * 0.5));
    const stepH = Math.max(workH * 2, Math.round(curH * 0.5));
    curCanvas.width = stepW;
    curCanvas.height = stepH;
    const cctx = curCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!cctx) throw new Error('無法建立瀏覽器 2D Canvas 繪圖環境');
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, stepW, stepH);
    curW = stepW;
    curH = stepH;

    while (curW > workW * 2 || curH > workH * 2) {
      const nextW = Math.max(workW, Math.round(curW * 0.5));
      const nextH = Math.max(workH, Math.round(curH * 0.5));
      const nextCanvas = createResampleCanvas();
      nextCanvas.width = nextW;
      nextCanvas.height = nextH;
      const nctx = nextCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!nctx) throw new Error('無法建立瀏覽器 2D Canvas 繪圖環境');
      nctx.imageSmoothingEnabled = true;
      nctx.imageSmoothingQuality = 'high';
      nctx.drawImage(curCanvas, 0, 0, curW, curH, 0, 0, nextW, nextH);
      curCanvas = nextCanvas;
      curW = nextW;
      curH = nextH;
    }

    const workCanvas = createResampleCanvas();
    workCanvas.width = workW;
    workCanvas.height = workH;
    const workCtx = workCanvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!workCtx) throw new Error('無法建立瀏覽器 2D Canvas 繪圖環境');
    workCtx.imageSmoothingEnabled = true;
    workCtx.imageSmoothingQuality = 'high';
    workCtx.drawImage(curCanvas, 0, 0, curW, curH, 0, 0, workW, workH);
    return workCtx.getImageData(0, 0, workW, workH);
  }

  const workCanvas = createResampleCanvas();
  workCanvas.width = workW;
  workCanvas.height = workH;
  const workCtx = workCanvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!workCtx) throw new Error('無法建立瀏覽器 2D Canvas 繪圖環境');
  workCtx.imageSmoothingEnabled = true;
  workCtx.imageSmoothingQuality = 'high';
  workCtx.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, workW, workH);
  return workCtx.getImageData(0, 0, workW, workH);
}

/**
 * Batch High-Res 2D Sequence -> Pixel Art Conversion Pipeline.
 * When sharedSequencePalette is enabled in 'auto' mode, extracts ONE unified OKLab palette
 * across all frames so sprites never flicker during animation playback.
 */
export function runBatchPixelConversion(
  sourceImages: Array<HTMLImageElement | ImageBitmap>,
  config: PixelEngineConfig
): PixelEngineResult[] {
  if (sourceImages.length === 0) return [];
  const t0 = performance.now();

  const targetW = Math.max(8, Math.min(256, Math.round(config.targetW)));
  const targetH = Math.max(8, Math.min(256, Math.round(config.targetH)));
  const maxDim = Math.max(targetW, targetH);

  const patchSize = maxDim <= 96 ? 4 : 3;
  const workW = targetW * patchSize;
  const workH = targetH * patchSize;

  // Stage 1: Preprocess & downscale every frame
  const preQuantBuffers: Uint8ClampedArray[] = sourceImages.map((sourceImage) => {
    const sourceW = 'naturalWidth' in sourceImage ? sourceImage.naturalWidth : sourceImage.width;
    const sourceH = 'naturalHeight' in sourceImage ? sourceImage.naturalHeight : sourceImage.height;
    const sx = Math.max(0, Math.min(1, config.crop.x)) * sourceW;
    const sy = Math.max(0, Math.min(1, config.crop.y)) * sourceH;
    const sw = Math.max(
      1,
      Math.min(sourceW - sx, config.crop.w * sourceW)
    );
    const sh = Math.max(
      1,
      Math.min(sourceH - sy, config.crop.h * sourceH)
    );

    const workImg = resampleToWorkingBuffer(sourceImage, sx, sy, sw, sh, workW, workH);
    return downscaleWorkingBufferPreQuant(
      workImg.data,
      workW,
      workH,
      targetW,
      targetH,
      patchSize,
      config
    );
  });

  // Stage 2: Shared or Per-Frame Palette Quantization & Dithering
  if (config.paletteMode === 'auto') {
    const k = Math.max(2, Math.min(64, Math.round(config.autoColorCount)));
    if (config.sharedSequencePalette && preQuantBuffers.length > 1) {
      const sharedPalette = extractAutoPaletteFromBuffers(preQuantBuffers, k);
      for (const buf of preQuantBuffers) {
        quantizeWithPalette(
          buf,
          targetW,
          targetH,
          sharedPalette,
          config.ditherMode,
          config.ditherStrength
        );
      }
    } else {
      for (const buf of preQuantBuffers) {
        const framePalette = extractAutoPaletteFromBuffers([buf], k);
        quantizeWithPalette(
          buf,
          targetW,
          targetH,
          framePalette,
          config.ditherMode,
          config.ditherStrength
        );
      }
    }
  } else if (config.paletteMode === 'preset') {
    const preset =
      PRESET_PALETTES.find((p) => p.id === config.presetPaletteId) || PRESET_PALETTES[0];
    const presetRgb = preset.colors.map(hexToRgb);
    for (const buf of preQuantBuffers) {
      quantizeWithPalette(
        buf,
        targetW,
        targetH,
        presetRgb,
        config.ditherMode,
        config.ditherStrength
      );
    }
  }

  const totalMs = Math.round(performance.now() - t0);

  return preQuantBuffers.map((buf) => {
    const outImageData = new ImageData(new Uint8ClampedArray(buf), targetW, targetH);
    const { swatches, totalUnique } = collectUsedPalette(outImageData.data);
    return {
      imageData: outImageData,
      width: targetW,
      height: targetH,
      palette: swatches,
      uniqueColorCount: totalUnique,
      computeMs: totalMs,
    };
  });
}

/**
 * Single-Image convenience wrapper
 */
export function runPixelConversion(
  sourceImage: HTMLImageElement,
  config: PixelEngineConfig
): PixelEngineResult {
  return runBatchPixelConversion([sourceImage], config)[0];
}

/**
 * Render an ImageData onto a crisp nearest-neighbor upscaled PNG Blob
 */
export function exportPixelPngBlob(imageData: ImageData, scale: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = imageData.width;
    srcCanvas.height = imageData.height;
    const srcCtx = srcCanvas.getContext('2d');
    if (!srcCtx) return reject(new Error('無法建立匯出畫布'));
    srcCtx.putImageData(imageData, 0, 0);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = imageData.width * scale;
    outCanvas.height = imageData.height * scale;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return reject(new Error('無法建立匯出畫布'));
    outCtx.imageSmoothingEnabled = false;
    outCtx.drawImage(srcCanvas, 0, 0, outCanvas.width, outCanvas.height);

    outCanvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG 編碼失敗'));
    }, 'image/png');
  });
}

/**
 * Compute centered maximum crop rectangle on source image matching targetW / targetH aspect ratio
 */
export function computeCenteredAspectCrop(
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number
): CropRect {
  if (srcW <= 0 || srcH <= 0 || targetW <= 0 || targetH <= 0) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  const srcRatio = srcW / srcH;
  const targetRatio = targetW / targetH;

  if (Math.abs(srcRatio - targetRatio) < 0.002) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }

  if (targetRatio > srcRatio) {
    const h = srcRatio / targetRatio;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  } else {
    const w = targetRatio / srcRatio;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
}
