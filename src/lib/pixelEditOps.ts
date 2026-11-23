import { RGBColor } from './palettes';

export interface RGBA extends RGBColor {
  a: number;
}

export function cloneImageData(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}

/**
 * Perceptually weighted Euclidean color distance (0..~255 scale)
 */
function colorDistance(
  r1: number,
  g1: number,
  b1: number,
  a1: number,
  r2: number,
  g2: number,
  b2: number,
  a2: number
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  const da = a1 - a2;
  return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11 + da * da * 0.5);
}

/**
 * Paint a square pixel brush stamp centered at (cx, cy) onto ImageData (mutates in place)
 */
export function stampBrush(
  img: ImageData,
  cx: number,
  cy: number,
  size: number,
  color: RGBA
): void {
  const { width, height, data } = img;
  const half = Math.floor((size - 1) / 2);
  const startX = cx - half;
  const startY = cy - half;

  for (let dy = 0; dy < size; dy++) {
    const py = startY + dy;
    if (py < 0 || py >= height) continue;
    for (let dx = 0; dx < size; dx++) {
      const px = startX + dx;
      if (px < 0 || px >= width) continue;
      const off = (py * width + px) * 4;
      data[off] = color.r;
      data[off + 1] = color.g;
      data[off + 2] = color.b;
      data[off + 3] = color.a;
    }
  }
}

/**
 * Draw continuous pixel stroke from (x0, y0) to (x1, y1) using Bresenham's algorithm
 * so fast dragging never skips pixels.
 */
export function drawBrushStroke(
  img: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  color: RGBA
): void {
  let cx = x0;
  let cy = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    stampBrush(img, cx, cy, size, color);
    if (cx === x1 && cy === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
}

/**
 * Read pixel RGBA at (x, y)
 */
export function getPixelAt(img: ImageData, x: number, y: number): RGBA | null {
  if (x < 0 || x >= img.width || y < 0 || y >= img.height) return null;
  const off = (y * img.width + x) * 4;
  return {
    r: img.data[off],
    g: img.data[off + 1],
    b: img.data[off + 2],
    a: img.data[off + 3],
  };
}

/**
 * Flood fill (contiguous) or global color replace (non-contiguous) with tolerance.
 * Used for both Paint Bucket (fillColor.a = 255) and Magic Wand Erase (fillColor.a = 0).
 * Returns number of modified pixels.
 */
export function floodFillOrReplace(
  img: ImageData,
  startX: number,
  startY: number,
  fillColor: RGBA,
  tolerance: number,
  contiguous: boolean
): number {
  const { width, height, data } = img;
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return 0;

  const startOff = (startY * width + startX) * 4;
  const sr = data[startOff];
  const sg = data[startOff + 1];
  const sb = data[startOff + 2];
  const sa = data[startOff + 3];

  // If clicking already transparent pixel with eraser/magic wand, nothing to do
  if (fillColor.a === 0 && sa === 0) return 0;
  // If clicking exact same color with bucket (tolerance 0), nothing to do
  if (
    tolerance === 0 &&
    sr === fillColor.r &&
    sg === fillColor.g &&
    sb === fillColor.b &&
    sa === fillColor.a
  ) {
    return 0;
  }

  let modified = 0;

  if (!contiguous) {
    for (let i = 0; i < data.length; i += 4) {
      const dist = colorDistance(data[i], data[i + 1], data[i + 2], data[i + 3], sr, sg, sb, sa);
      if (dist <= tolerance) {
        data[i] = fillColor.r;
        data[i + 1] = fillColor.g;
        data[i + 2] = fillColor.b;
        data[i + 3] = fillColor.a;
        modified++;
      }
    }
    return modified;
  }

  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;

  const startIdx = startY * width + startX;
  stack[top++] = startIdx;
  visited[startIdx] = 1;

  while (top > 0) {
    const idx = stack[--top];
    const x = idx % width;
    const y = (idx - x) / width;
    const off = idx * 4;

    data[off] = fillColor.r;
    data[off + 1] = fillColor.g;
    data[off + 2] = fillColor.b;
    data[off + 3] = fillColor.a;
    modified++;

    // 4-connected neighbors
    const checkNeighbor = (nx: number, ny: number) => {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
      const nIdx = ny * width + nx;
      if (visited[nIdx]) return;
      const nOff = nIdx * 4;
      // Don't cross between opaque and already-transparent when starting from opaque
      if (sa > 0 && data[nOff + 3] === 0) return;
      if (sa === 0 && data[nOff + 3] > 0) return;
      const dist = colorDistance(
        data[nOff],
        data[nOff + 1],
        data[nOff + 2],
        data[nOff + 3],
        sr,
        sg,
        sb,
        sa
      );
      if (dist <= tolerance) {
        visited[nIdx] = 1;
        stack[top++] = nIdx;
      }
    };

    checkNeighbor(x - 1, y);
    checkNeighbor(x + 1, y);
    checkNeighbor(x, y - 1);
    checkNeighbor(x, y + 1);
  }

  return modified;
}

/**
 * One-Click Auto Corner Background Removal:
 * Seeds flood-fill transparency from the 4 corners (and matching edge segments)
 * using gradual neighbor-aware matching so soft sky gradients / white studio backdrops peel cleanly
 * without eating into the foreground character.
 */
export function autoRemoveCornerBackground(img: ImageData, tolerance: number): number {
  const { width, height, data } = img;
  if (width < 2 || height < 2) return 0;

  const corners: Array<[number, number]> = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];

  // Collect opaque corner seed colors
  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;

  // Store seed reference color for each corner so sky gradients near top corners remove cleanly
  const seeds: Array<{ x: number; y: number; r: number; g: number; b: number }> = [];
  for (const [cx, cy] of corners) {
    const off = (cy * width + cx) * 4;
    if (data[off + 3] > 0) {
      seeds.push({ x: cx, y: cy, r: data[off], g: data[off + 1], b: data[off + 2] });
    }
  }

  if (seeds.length === 0) return 0;

  // Push all border pixels that match any corner seed within tolerance
  const tryPush = (x: number, y: number, refR: number, refG: number, refB: number, tol: number) => {
    const idx = y * width + x;
    if (visited[idx]) return;
    const off = idx * 4;
    if (data[off + 3] === 0) return;
    const d = colorDistance(data[off], data[off + 1], data[off + 2], 255, refR, refG, refB, 255);
    if (d <= tol) {
      visited[idx] = 1;
      stack[top++] = idx;
    }
  };

  for (const s of seeds) {
    // Seed from the corner itself and top/side edges near matching color
    const cIdx = s.y * width + s.x;
    if (!visited[cIdx]) {
      visited[cIdx] = 1;
      stack[top++] = cIdx;
    }
  }

  // Also seed along top & side edges if they match one of the top two corners (great for character busts!)
  for (let x = 0; x < width; x++) {
    for (const s of seeds) {
      tryPush(x, 0, s.r, s.g, s.b, tolerance * 0.85);
    }
  }

  // Local step tolerance lets gentle sky gradients peel smoothly while stopping sharply at dark character outlines
  const stepTol = Math.max(10, tolerance * 0.58);
  const globalTol = Math.max(tolerance * 1.45, tolerance + 14);
  let modified = 0;

  while (top > 0) {
    const idx = stack[--top];
    const x = idx % width;
    const y = (idx - x) / width;
    const off = idx * 4;
    const cr = data[off];
    const cg = data[off + 1];
    const cb = data[off + 2];

    // Erase this pixel
    data[off] = 0;
    data[off + 1] = 0;
    data[off + 2] = 0;
    data[off + 3] = 0;
    modified++;

    const checkNeighbor = (nx: number, ny: number) => {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
      const nIdx = ny * width + nx;
      if (visited[nIdx]) return;
      const nOff = nIdx * 4;
      if (data[nOff + 3] === 0) return;

      const nr = data[nOff];
      const ng = data[nOff + 1];
      const nb = data[nOff + 2];

      // Must be close to current neighbor (stops at crisp outlines!) AND within broad range of a corner seed
      const stepDist = colorDistance(nr, ng, nb, 255, cr, cg, cb, 255);
      if (stepDist > stepTol) return;

      let matchesSeed = false;
      for (const s of seeds) {
        if (colorDistance(nr, ng, nb, 255, s.r, s.g, s.b, 255) <= globalTol) {
          matchesSeed = true;
          break;
        }
      }

      if (matchesSeed) {
        visited[nIdx] = 1;
        stack[top++] = nIdx;
      }
    };

    checkNeighbor(x - 1, y);
    checkNeighbor(x + 1, y);
    checkNeighbor(x, y - 1);
    checkNeighbor(x, y + 1);
  }

  return modified;
}
