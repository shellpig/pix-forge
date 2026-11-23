import { RGBColor, rgbToOklab } from './palettes';
import { exportPixelPngBlob, extractAutoPaletteFromBuffers } from './pixelEngine';

/**
 * Export multiple frames arranged into a crisp nearest-neighbor Sprite Sheet PNG Blob.
 */
export function exportSpriteSheetPngBlob(
  frames: ImageData[],
  scale: number,
  columns: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (frames.length === 0) return reject(new Error('沒有可匯出的影格'));

    const frameW = frames[0].width;
    const frameH = frames[0].height;
    const cols = Math.max(1, Math.min(frames.length, Math.round(columns)));
    const rows = Math.ceil(frames.length / cols);

    const cellW = frameW * scale;
    const cellH = frameH * scale;

    const sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = cellW * cols;
    sheetCanvas.height = cellH * rows;
    const sheetCtx = sheetCanvas.getContext('2d');
    if (!sheetCtx) return reject(new Error('無法建立 Sprite Sheet 畫布'));
    sheetCtx.imageSmoothingEnabled = false;
    sheetCtx.clearRect(0, 0, sheetCanvas.width, sheetCanvas.height);

    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = frameW;
    tmpCanvas.height = frameH;
    const tmpCtx = tmpCanvas.getContext('2d');
    if (!tmpCtx) return reject(new Error('無法建立影格暫存畫布'));

    frames.forEach((frame, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      tmpCtx.clearRect(0, 0, frameW, frameH);
      tmpCtx.putImageData(frame, 0, 0);
      sheetCtx.drawImage(tmpCanvas, 0, 0, frameW, frameH, col * cellW, row * cellH, cellW, cellH);
    });

    sheetCanvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Sprite Sheet PNG 編碼失敗'));
    }, 'image/png');
  });
}

// --- Pure TypeScript CRC32 + Stored ZIP Builder (Zero Dependencies, Spec-Compliant) ---

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function buildStoredZipBytes(
  entries: Array<{ filename: string; data: Uint8Array }>
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.filename);
    const data = entry.data;
    const crc = crc32(data);
    const size = data.length;

    // Local File Header (30 bytes + filename)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true); // version needed (2.0)
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // compression method: 0 = STORE
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0x5421, true); // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // compressed size
    lv.setUint32(22, size, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra field len
    localHeader.set(nameBytes, 30);

    localChunks.push(localHeader, data);

    // Central Directory Header (46 bytes + filename)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true); // UTF-8 flag
    cv.setUint16(10, 0, true); // STORE
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x5421, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, localOffset, true);
    centralHeader.set(nameBytes, 46);

    centralChunks.push(centralHeader);
    localOffset += localHeader.length + data.length;
  }

  let centralSize = 0;
  for (const c of centralChunks) centralSize += c.length;

  // End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, localOffset, true);
  ev.setUint16(20, 0, true);

  const totalLen = localOffset + centralSize + eocd.length;
  const out = new Uint8Array(totalLen);
  let cursor = 0;
  for (const chunk of localChunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  for (const chunk of centralChunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  out.set(eocd, cursor);
  return out;
}

/**
 * Package all pixel frames (upscaled cleanly by `scale`) into a downloadable ZIP Blob.
 */
export async function exportFramesZipBlob(
  frames: Array<{ name: string; imageData: ImageData }>,
  scale: number
): Promise<Blob> {
  const entries: Array<{ filename: string; data: Uint8Array }> = [];
  const padWidth = Math.max(2, String(frames.length).length);

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const blob = await exportPixelPngBlob(f.imageData, scale);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const idxStr = String(i + 1).padStart(padWidth, '0');
    const cleanBase = f.name
      .replace(/\.[^.]+$/, '')
      .replace(/[^\w\u4e00-\u9fff-]+/g, '_')
      .slice(0, 40);
    const filename = `${idxStr}_${cleanBase || 'frame'}_${f.imageData.width * scale}x${f.imageData.height * scale}.png`;
    entries.push({ filename, data: bytes });
  }

  const zipBytes = buildStoredZipBytes(entries);
  return new Blob([zipBytes], { type: 'application/zip' });
}

// --- Pure TypeScript GIF89a Animated Encoder (Transparency + Disposal=2 + Exact FPS) ---

function lzwEncodeGif(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  const outBytes: number[] = [];
  let bitBuf = 0;
  let bitCount = 0;

  const emitCode = (code: number, width: number) => {
    bitBuf |= code << bitCount;
    bitCount += width;
    while (bitCount >= 8) {
      outBytes.push(bitBuf & 0xff);
      bitBuf >>>= 8;
      bitCount -= 8;
    }
  };

  let codeWidth = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  // Use fast Map<number, number> keyed by (prefix << 8) | suffix
  let dict = new Map<number, number>();

  emitCode(clearCode, codeWidth);

  if (indices.length > 0) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      const hit = dict.get(key);
      if (hit !== undefined) {
        prefix = hit;
      } else {
        emitCode(prefix, codeWidth);
        if (nextCode < 4096) {
          dict.set(key, nextCode++);
          if (nextCode > 1 << codeWidth && codeWidth < 12) {
            codeWidth++;
          }
        } else {
          // Dictionary full -> emit Clear Code and reset cleanly
          emitCode(clearCode, codeWidth);
          dict = new Map<number, number>();
          codeWidth = minCodeSize + 1;
          nextCode = eoiCode + 1;
        }
        prefix = k;
      }
    }
    emitCode(prefix, codeWidth);
  }

  emitCode(eoiCode, codeWidth);
  if (bitCount > 0) {
    outBytes.push(bitBuf & 0xff);
  }

  // Wrap bitstream into GIF 255-byte sub-blocks + 0x00 terminator
  const blockCount = Math.ceil(outBytes.length / 255);
  const packed = new Uint8Array(outBytes.length + blockCount + 1);
  let srcOff = 0;
  let dstOff = 0;
  while (srcOff < outBytes.length) {
    const len = Math.min(255, outBytes.length - srcOff);
    packed[dstOff++] = len;
    for (let i = 0; i < len; i++) {
      packed[dstOff++] = outBytes[srcOff++];
    }
  }
  packed[dstOff] = 0;
  return packed;
}

/**
 * Encode pixel art frames into a standard GIF89a byte array with crisp nearest-neighbor scaling,
 * Disposal Method 2 (no ghost trails on transparent moving sprites), infinite loop, and custom FPS.
 */
export function encodeAnimatedGifBytes(
  frames: Array<{ width: number; height: number; data: Uint8ClampedArray }>,
  scale: number,
  fps: number
): Uint8Array<ArrayBuffer> {
  if (frames.length === 0) throw new Error('沒有可匯出的影格');

  const srcW = frames[0].width;
  const srcH = frames[0].height;
  const outW = srcW * scale;
  const outH = srcH * scale;
  const delayCs = Math.max(2, Math.round(100 / Math.max(1, Math.min(60, fps))));

  // Collect all unique opaque RGB colors across all frames
  const uniqueRgb = new Map<number, RGBColor>();
  let hasTransparency = false;

  for (const frame of frames) {
    const d = frame.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) {
        hasTransparency = true;
      } else {
        const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
        if (!uniqueRgb.has(key)) {
          uniqueRgb.set(key, { r: d[i], g: d[i + 1], b: d[i + 2] });
        }
      }
    }
  }

  const maxOpaqueSlots = hasTransparency ? 255 : 256;
  let palette: RGBColor[];
  if (uniqueRgb.size === 0) {
    palette = [{ r: 0, g: 0, b: 0 }];
  } else if (uniqueRgb.size <= maxOpaqueSlots) {
    palette = Array.from(uniqueRgb.values());
  } else {
    // Smooth OKLab quantization down to 255 colors if user kept Full Color mode
    palette = extractAutoPaletteFromBuffers(
      frames.map((f) => f.data),
      maxOpaqueSlots
    );
  }

  const transparentIdx = hasTransparency ? palette.length : -1;
  const totalSlotsNeeded = palette.length + (hasTransparency ? 1 : 0);

  let colorBits = 2;
  while (1 << colorBits < totalSlotsNeeded && colorBits < 8) {
    colorBits++;
  }
  const tableSize = 1 << colorBits;

  // Build fast exact + fallback OKLab lookup for mapping every pixel to palette index
  const exactLookup = new Map<number, number>();
  const palLab = palette.map((c, idx) => {
    exactLookup.set((c.r << 16) | (c.g << 8) | c.b, idx);
    return rgbToOklab(c.r, c.g, c.b);
  });

  const mapRgbToIndex = (r: number, g: number, b: number): number => {
    const key = (r << 16) | (g << 8) | b;
    const cached = exactLookup.get(key);
    if (cached !== undefined) return cached;

    const lab = rgbToOklab(r, g, b);
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let p = 0; p < palLab.length; p++) {
      const dL = lab.L - palLab[p].L;
      const da = lab.a - palLab[p].a;
      const db = lab.b - palLab[p].b;
      const d = dL * dL + (da * da + db * db) * 1.35;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = p;
      }
    }
    exactLookup.set(key, bestIdx);
    return bestIdx;
  };

  const chunks: Uint8Array[] = [];

  // 1. Header + Logical Screen Descriptor (13 bytes)
  const header = new Uint8Array(13);
  header.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // "GIF89a"
  const hv = new DataView(header.buffer);
  hv.setUint16(6, outW, true);
  hv.setUint16(8, outH, true);
  // Global Color Table Flag (0x80) | Color Resolution (7<<4) | Size of GCT (colorBits - 1)
  header[10] = 0x80 | 0x70 | (colorBits - 1);
  header[11] = hasTransparency ? transparentIdx : 0; // Background color index
  header[12] = 0; // Pixel aspect ratio
  chunks.push(header);

  // 2. Global Color Table (tableSize * 3 bytes)
  const gct = new Uint8Array(tableSize * 3);
  for (let i = 0; i < palette.length; i++) {
    gct[i * 3] = palette[i].r;
    gct[i * 3 + 1] = palette[i].g;
    gct[i * 3 + 2] = palette[i].b;
  }
  chunks.push(gct);

  // 3. NETSCAPE 2.0 Application Extension (Infinite Loop)
  chunks.push(
    new Uint8Array([
      0x21, 0xff, 0x0b,
      0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, // "NETSCAPE2.0"
      0x03, 0x01, 0x00, 0x00, 0x00,
    ])
  );

  // 4. Per-Frame Graphic Control Extension + Image Descriptor + LZW Data
  const minCodeSize = Math.max(2, colorBits);
  const frameIndices = new Uint8Array(outW * outH);

  for (const frame of frames) {
    const d = frame.data;

    // Nearest-neighbor upscaled index buffer
    for (let sy = 0; sy < srcH; sy++) {
      for (let sx = 0; sx < srcW; sx++) {
        const off = (sy * srcW + sx) * 4;
        const idx =
          d[off + 3] < 128 && hasTransparency
            ? transparentIdx
            : mapRgbToIndex(d[off], d[off + 1], d[off + 2]);

        const baseY = sy * scale;
        const baseX = sx * scale;
        for (let dy = 0; dy < scale; dy++) {
          const rowOff = (baseY + dy) * outW + baseX;
          for (let dx = 0; dx < scale; dx++) {
            frameIndices[rowOff + dx] = idx;
          }
        }
      }
    }

    // Graphic Control Extension (8 bytes)
    // Disposal Method = 2 (Restore to Background = 0x08) | Transparent flag (0x01 if transparent)
    const gce = new Uint8Array(8);
    gce[0] = 0x21;
    gce[1] = 0xf9;
    gce[2] = 0x04;
    gce[3] = 0x08 | (hasTransparency ? 0x01 : 0x00);
    gce[4] = delayCs & 0xff;
    gce[5] = (delayCs >> 8) & 0xff;
    gce[6] = hasTransparency ? transparentIdx : 0;
    gce[7] = 0x00;
    chunks.push(gce);

    // Image Descriptor (10 bytes)
    const desc = new Uint8Array(10);
    const dv = new DataView(desc.buffer);
    desc[0] = 0x2c;
    dv.setUint16(1, 0, true);
    dv.setUint16(3, 0, true);
    dv.setUint16(5, outW, true);
    dv.setUint16(7, outH, true);
    desc[9] = 0x00;
    chunks.push(desc);

    // LZW Minimum Code Size + Sub-blocks
    chunks.push(new Uint8Array([minCodeSize]));
    chunks.push(lzwEncodeGif(frameIndices, minCodeSize));
  }

  // 5. GIF Trailer
  chunks.push(new Uint8Array([0x3b]));

  let totalLen = 0;
  for (const c of chunks) totalLen += c.length;
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) {
    result.set(c, pos);
    pos += c.length;
  }
  return result;
}

export function exportAnimatedGifBlob(frames: ImageData[], scale: number, fps: number): Blob {
  const bytes = encodeAnimatedGifBytes(frames, scale, fps);
  return new Blob([bytes], { type: 'image/gif' });
}
