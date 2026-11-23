import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

// Compile the real browser TypeScript with the existing Vite toolchain.
const temp = await mkdtemp(join(tmpdir(), 'pix-forge-isolated-'));
after(() => rm(temp, { recursive: true, force: true }));
await build({
  configFile: false,
  publicDir: false,
  logLevel: 'error',
  build: {
    outDir: temp,
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: {
        isolated: resolve('src/lib/isolatedPixels.ts'),
        engine: resolve('src/lib/pixelEngine.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.mjs`,
    },
  },
});
const { removeIsolatedPixels, getEffectiveIsolatedPixelMode, isCleanupDisabledByDither } =
  await import(pathToFileURL(join(temp, 'isolated.mjs')).href);
const { processWorkingBuffer, DEFAULT_ENGINE_CONFIG } =
  await import(pathToFileURL(join(temp, 'engine.mjs')).href);

const RGBA = (r, g = r, b = r, a = 255) => [r, g, b, a];
const make = (w, h, color) => {
  const bytes = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < bytes.length; i += 4) bytes.set(color, i);
  return bytes;
};
const put = (bytes, w, x, y, rgba) => bytes.set(rgba, (y * w + x) * 4);
const pixel = (bytes, w, x, y) => Array.from(bytes.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

test('light clears only close-color islands with 7/8 or 8/8 neighbor support', () => {
  const input = make(5, 5, RGBA(100));
  put(input, 5, 2, 2, RGBA(108));
  const original = new Uint8ClampedArray(input);
  const out = removeIsolatedPixels(input, 5, 5, 'light');
  assert.deepEqual(pixel(out, 5, 2, 2), RGBA(100));
  assert.deepEqual(input, original, 'input must remain unchanged');
  assert.notStrictEqual(out, input);
});

test('light protects a high-contrast eye glint, strong removes it', () => {
  const input = make(5, 5, RGBA(35));
  put(input, 5, 2, 2, RGBA(245));
  assert.deepEqual(pixel(removeIsolatedPixels(input, 5, 5, 'light'), 5, 2, 2), RGBA(245));
  assert.deepEqual(pixel(removeIsolatedPixels(input, 5, 5, 'strong'), 5, 2, 2), RGBA(35));
});

test('strong uses a 6/8 majority, while light requires 7/8', () => {
  const input = make(5, 5, RGBA(90));
  put(input, 5, 2, 2, RGBA(94));
  put(input, 5, 1, 1, RGBA(112));
  put(input, 5, 3, 3, RGBA(115));
  assert.deepEqual(pixel(removeIsolatedPixels(input, 5, 5, 'light'), 5, 2, 2), RGBA(94));
  assert.deepEqual(pixel(removeIsolatedPixels(input, 5, 5, 'strong'), 5, 2, 2), RGBA(90));
});

test('do not alter connected two-pixel strokes, including diagonal connections', () => {
  const input = make(7, 7, RGBA(100));
  put(input, 7, 3, 3, RGBA(255));
  put(input, 7, 4, 4, RGBA(255));
  const out = removeIsolatedPixels(input, 7, 7, 'strong');
  assert.deepEqual(pixel(out, 7, 3, 3), RGBA(255));
  assert.deepEqual(pixel(out, 7, 4, 4), RGBA(255));
});

test('transparent RGB is normalized: erase opaque specks and fill transparent pinholes', () => {
  const empty = make(5, 5, RGBA(201, 77, 9, 0));
  put(empty, 5, 2, 2, RGBA(9, 60, 80));
  assert.deepEqual(pixel(removeIsolatedPixels(empty, 5, 5, 'light'), 5, 2, 2), RGBA(0, 0, 0, 0));

  const filled = make(5, 5, RGBA(51, 120, 90));
  put(filled, 5, 2, 2, RGBA(255, 12, 9, 0));
  assert.deepEqual(pixel(removeIsolatedPixels(filled, 5, 5, 'light'), 5, 2, 2), RGBA(51, 120, 90));
});

test('skip the outer border entirely', () => {
  const input = make(5, 5, RGBA(60));
  put(input, 5, 0, 2, RGBA(70));
  const output = removeIsolatedPixels(input, 5, 5, 'strong');
  assert.deepEqual(pixel(output, 5, 0, 2), RGBA(70));
});

test('read from original snapshot, never cascade modifications across neighbors', () => {
  const input = make(7, 5, RGBA(100));
  put(input, 7, 2, 2, RGBA(104));
  put(input, 7, 3, 2, RGBA(105));
  put(input, 7, 4, 2, RGBA(106));
  const output = removeIsolatedPixels(input, 7, 5, 'light');
  assert.deepEqual(pixel(output, 7, 2, 2), RGBA(100));
  assert.deepEqual(pixel(output, 7, 3, 2), RGBA(105), 'middle pixel originally has only 6 matching neighbors');
  assert.deepEqual(pixel(output, 7, 4, 2), RGBA(100));
});

test('off mode leaves the buffer unchanged; reject malformed buffer dimensions in active mode', () => {
  const input = make(3, 3, RGBA(99));
  assert.deepEqual(removeIsolatedPixels(input, 3, 3, 'off'), input);
  assert.throws(() => removeIsolatedPixels(input, 4, 4, 'light'), /尺寸不正確/);
});

test('dithering suppresses cleanup while preserving the selected mode', () => {
  const settings = { isolatedPixelMode: 'light', paletteMode: 'auto', ditherMode: 'floyd' };
  assert.equal(isCleanupDisabledByDither(settings), true);
  assert.equal(getEffectiveIsolatedPixelMode(settings), 'off');
  assert.equal(getEffectiveIsolatedPixelMode({ ...settings, ditherMode: 'none' }), 'light');
  assert.equal(getEffectiveIsolatedPixelMode({ ...settings, paletteMode: 'preset', ditherMode: 'bayer4' }), 'off');
  assert.equal(getEffectiveIsolatedPixelMode({ ...settings, paletteMode: 'full' }), 'light');
});

test('single-buffer conversion applies cleanup even in full-color mode', () => {
  const input = make(5, 5, RGBA(100));
  put(input, 5, 2, 2, RGBA(240));
  const config = {
    ...DEFAULT_ENGINE_CONFIG,
    targetW: 5,
    targetH: 5,
    paletteMode: 'full',
    downscaleMode: 'area',
    ditherMode: 'none',
    isolatedPixelMode: 'strong',
    outlineStrength: 0,
    smoothness: 0,
    preSharpen: 0,
    contrast: 0,
    saturation: 0,
  };
  const result = processWorkingBuffer(input, 5, 5, 5, 5, 1, config);
  assert.deepEqual(pixel(result.data, 5, 2, 2), RGBA(100));
  assert.equal(result.uniqueColorCount, 1);
});

test('batch and single conversion both route through the same cleanup helper', async () => {
  const engine = await readFile('src/lib/pixelEngine.ts', 'utf8');
  const panel = await readFile('src/components/ControlPanel.tsx', 'utf8');
  assert.match(engine, /const finalPixels = removeIsolatedPixels\(/);
  assert.match(engine, /const finalBuffers = preQuantBuffers\.map\(\(buf\) =>\s*removeIsolatedPixels\(/);
  assert.match(panel, /disabled=\{cleanupDisabledByDither\}/);
  assert.match(panel, /isCleanupDisabledByDither\(config\)/);
});
