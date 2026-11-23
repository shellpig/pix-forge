import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

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
      fileName: (_format, name) => name + '.mjs',
    },
  },
});
const {
  removeIsolatedPixels, getEffectiveIsolatedPixelMode, isCleanupDisabledByDither,
  CLEANUP_RULES, LOCAL_EXTREME_L_MARGIN,
} = await import(pathToFileURL(join(temp, 'isolated.mjs')).href);
const { processWorkingBuffer, DEFAULT_ENGINE_CONFIG } =
  await import(pathToFileURL(join(temp, 'engine.mjs')).href);

const RGBA = (r, g = r, b = r, a = 255) => [r, g, b, a];
const make = (w, h, color) => {
  const bytes = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < bytes.length; i += 4) bytes.set(color, i);
  return bytes;
};
const put = (bytes, w, x, y, rgba) => bytes.set(rgba, (y * w + x) * 4);
const pixel = (bytes, w, x, y) =>
  Array.from(bytes.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
const neighborhood = (centerColor, neighborColors) => {
  assert.equal(neighborColors.length, 8);
  const bytes = make(5, 5, RGBA(128));
  put(bytes, 5, 2, 2, centerColor);
  const positions = [[1,1], [2,1], [3,1], [1,2], [3,2], [1,3], [2,3], [3,3]];
  positions.forEach(([x,y], i) => put(bytes, 5, x, y, neighborColors[i]));
  return bytes;
};

test('config constants define distinct color and alpha rules', () => {
  assert.deepEqual(CLEANUP_RULES.light, {
    minCandidateCount: 4, maxColorDelta: 0.2, minAlphaAgreement: 7,
  });
  assert.deepEqual(CLEANUP_RULES.strong, {
    minCandidateCount: 3, maxColorDelta: 0.3, minAlphaAgreement: 6,
  });
  assert.equal(LOCAL_EXTREME_L_MARGIN, 0.12);
});

test('light replaces a close-color isolated point with only four votes', () => {
  const input = neighborhood(RGBA(108), [
    RGBA(100), RGBA(100), RGBA(100), RGBA(100),
    RGBA(102), RGBA(104), RGBA(106), RGBA(110),
  ]);
  const original = new Uint8ClampedArray(input);
  const result = removeIsolatedPixels(input, 5, 5, 'light');
  assert.deepEqual(pixel(result, 5, 2, 2), RGBA(100));
  assert.deepEqual(input, original, 'the source snapshot must never be mutated');
  assert.notStrictEqual(result, input);
});

test('strong needs three matching neighbors, while light needs four', () => {
  const colors = [
    RGBA(105), RGBA(105), RGBA(105),
    RGBA(98), RGBA(102), RGBA(110), RGBA(112), RGBA(118),
  ];
  const input = neighborhood(RGBA(115), colors);
  assert.deepEqual(pixel(removeIsolatedPixels(input, 5, 5, 'light'), 5, 2, 2), RGBA(115));
  assert.deepEqual(pixel(removeIsolatedPixels(input, 5, 5, 'strong'), 5, 2, 2), RGBA(105));

  const withFour = neighborhood(RGBA(115), [...colors.slice(0, 3), RGBA(105), ...colors.slice(4)]);
  assert.deepEqual(pixel(removeIsolatedPixels(withFour, 5, 5, 'light'), 5, 2, 2), RGBA(105));
});

test('both modes protect a luminance-maximum highlight and luminance-minimum dark point', () => {
  const bright = neighborhood(RGBA(245), Array(8).fill(RGBA(35)));
  const dark = neighborhood(RGBA(10), Array(8).fill(RGBA(200)));
  for (const mode of ['light', 'strong']) {
    assert.deepEqual(pixel(removeIsolatedPixels(bright, 5, 5, mode), 5, 2, 2), RGBA(245));
    assert.deepEqual(pixel(removeIsolatedPixels(dark, 5, 5, mode), 5, 2, 2), RGBA(10));
  }
});

test('light retains a saturated red accent over gray; strong replaces it within the wider delta', () => {
  // Standard Oklab distance (220,50,50) -> gray(128) is about 0.2065;
  // the two lightness values differ by only 0.0133, so extreme protection does not apply.
  const input = neighborhood(RGBA(220, 50, 50), Array(8).fill(RGBA(128)));
  assert.deepEqual(pixel(removeIsolatedPixels(input, 5, 5, 'light'), 5, 2, 2), RGBA(220, 50, 50));
  assert.deepEqual(pixel(removeIsolatedPixels(input, 5, 5, 'strong'), 5, 2, 2), RGBA(128));
});

test('closest eligible color beats the most frequent color in Strong mode', () => {
  const input = neighborhood(RGBA(120), [
    RGBA(80), RGBA(80), RGBA(80), RGBA(80), RGBA(80),
    RGBA(118), RGBA(118), RGBA(118),
  ]);
  assert.deepEqual(pixel(removeIsolatedPixels(input, 5, 5, 'strong'), 5, 2, 2), RGBA(118));
  assert.deepEqual(pixel(removeIsolatedPixels(input, 5, 5, 'light'), 5, 2, 2), RGBA(80));
});

test('two connected pixels, even diagonally, are not isolated', () => {
  const input = make(7, 7, RGBA(100));
  put(input, 7, 3, 3, RGBA(255));
  put(input, 7, 4, 4, RGBA(255));
  const result = removeIsolatedPixels(input, 7, 7, 'strong');
  assert.deepEqual(pixel(result, 7, 3, 3), RGBA(255));
  assert.deepEqual(pixel(result, 7, 4, 4), RGBA(255));
});

test('transparent neighbors ignore hidden RGB; replacement copies the real neighbor RGBA', () => {
  const background = RGBA(201, 77, 9, 0);
  const speck = neighborhood(RGBA(9, 60, 80), Array(8).fill(background));
  assert.deepEqual(pixel(removeIsolatedPixels(speck, 5, 5, 'light'), 5, 2, 2), background);

  const mixedInvisible = neighborhood(RGBA(9, 60, 80), [
    RGBA(100, 3, 8, 0), RGBA(2, 200, 8, 0), RGBA(0, 0, 0, 0), RGBA(2, 2, 2, 0),
    RGBA(100, 200, 3, 0), RGBA(9, 9, 9, 0), RGBA(0, 0, 0, 0), RGBA(255, 255, 255, 0),
  ]);
  assert.equal(pixel(removeIsolatedPixels(mixedInvisible, 5, 5, 'light'), 5, 2, 2)[3], 0);
});

test('transparent holes only fill from a single color with 7/6 matching votes', () => {
  const filled = neighborhood(RGBA(255, 12, 9, 0), Array(8).fill(RGBA(51, 120, 90)));
  for (const mode of ['light', 'strong']) {
    assert.deepEqual(pixel(removeIsolatedPixels(filled, 5, 5, mode), 5, 2, 2), RGBA(51, 120, 90));
  }
  const neighbors = [...Array(6).fill(RGBA(51, 120, 90)), RGBA(49, 118, 88), RGBA(52, 121, 91)];
  const sixVotes = neighborhood(RGBA(255, 12, 9, 0), neighbors);
  assert.deepEqual(pixel(removeIsolatedPixels(sixVotes, 5, 5, 'light'), 5, 2, 2), RGBA(255, 12, 9, 0));
  assert.deepEqual(pixel(removeIsolatedPixels(sixVotes, 5, 5, 'strong'), 5, 2, 2), RGBA(51, 120, 90));
});

test('opaque speck is cleared only with enough transparent neighbors', () => {
  const center = RGBA(100);
  const five = neighborhood(center, [
    ...Array(5).fill(RGBA(0, 0, 0, 0)), RGBA(90), RGBA(110), RGBA(112),
  ]);
  assert.deepEqual(pixel(removeIsolatedPixels(five, 5, 5, 'strong'), 5, 2, 2), center);
  const six = neighborhood(center, [
    ...Array(6).fill(RGBA(0, 0, 0, 0)), RGBA(90), RGBA(110),
  ]);
  assert.equal(pixel(removeIsolatedPixels(six, 5, 5, 'strong'), 5, 2, 2)[3], 0);
  assert.deepEqual(pixel(removeIsolatedPixels(six, 5, 5, 'light'), 5, 2, 2), center);
});

test('local luminance extreme guard runs before a possible transparent cleanup', () => {
  const input = neighborhood(RGBA(245), [
    ...Array(6).fill(RGBA(0, 0, 0, 0)), RGBA(35), RGBA(40),
  ]);
  assert.deepEqual(pixel(removeIsolatedPixels(input, 5, 5, 'strong'), 5, 2, 2), RGBA(245));
});

test('snapshot prevents a 3-vote group becoming 4 votes during left-to-right processing', () => {
  const input = make(7, 7, RGBA(110));
  put(input, 7, 2, 2, RGBA(116)); // First center: four 110-color neighbors.
  put(input, 7, 3, 3, RGBA(117)); // Later center: only three 110-color neighbors.
  put(input, 7, 3, 2, RGBA(130));
  put(input, 7, 1, 3, RGBA(129));
  put(input, 7, 2, 3, RGBA(128));
  put(input, 7, 2, 4, RGBA(132));
  put(input, 7, 3, 4, RGBA(133));
  const out = removeIsolatedPixels(input, 7, 7, 'light');
  assert.deepEqual(pixel(out, 7, 2, 2), RGBA(110));
  assert.deepEqual(pixel(out, 7, 3, 3), RGBA(117), 'must use the original three votes, not an updated neighbor');
});

test('the outer image border is left untouched', () => {
  const input = make(5, 5, RGBA(60));
  put(input, 5, 0, 2, RGBA(70));
  assert.deepEqual(pixel(removeIsolatedPixels(input, 5, 5, 'strong'), 5, 0, 2), RGBA(70));
});

test('off mode is a no-op; active mode checks buffer dimensions', () => {
  const input = make(3, 3, RGBA(99));
  assert.deepEqual(removeIsolatedPixels(input, 3, 3, 'off'), input);
  assert.throws(() => removeIsolatedPixels(input, 4, 4, 'light'), /尺寸不正確/);
});

test('dithering disables cleanup but does not erase the saved mode', () => {
  const settings = { isolatedPixelMode: 'light', paletteMode: 'auto', ditherMode: 'floyd' };
  assert.equal(isCleanupDisabledByDither(settings), true);
  assert.equal(getEffectiveIsolatedPixelMode(settings), 'off');
  assert.equal(getEffectiveIsolatedPixelMode({ ...settings, ditherMode: 'none' }), 'light');
  assert.equal(getEffectiveIsolatedPixelMode({ ...settings, paletteMode: 'preset', ditherMode: 'bayer4' }), 'off');
  assert.equal(getEffectiveIsolatedPixelMode({ ...settings, paletteMode: 'full' }), 'light');
});

test('single-buffer full-color conversion follows the revised rules and used-color count', () => {
  const input = make(5, 5, RGBA(100));
  put(input, 5, 2, 2, RGBA(108)); // Old 240 highlight would be protected now.
  const config = {
    ...DEFAULT_ENGINE_CONFIG,
    targetW: 5, targetH: 5,
    paletteMode: 'full', downscaleMode: 'area',
    ditherMode: 'none', isolatedPixelMode: 'strong',
    outlineStrength: 0, smoothness: 0, preSharpen: 0,
    contrast: 0, saturation: 0,
  };
  const result = processWorkingBuffer(input, 5, 5, 5, 5, 1, config);
  assert.deepEqual(pixel(result.data, 5, 2, 2), RGBA(100));
  assert.equal(result.uniqueColorCount, 1);
});

test('single-buffer and batch conversion both call the shared helper', async () => {
  const engine = await readFile('src/lib/pixelEngine.ts', 'utf8');
  const panel = await readFile('src/components/ControlPanel.tsx', 'utf8');
  assert.match(engine, /const finalPixels = removeIsolatedPixels\(/);
  assert.match(engine, /const finalBuffers = preQuantBuffers\.map\(\(buf\) =>\s*removeIsolatedPixels\(/);
  assert.match(panel, /disabled=\{cleanupDisabledByDither\}/);
});
