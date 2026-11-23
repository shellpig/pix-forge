import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

// Test the real TS layout helper and exporter with the existing Vite toolchain.
const testDist = await mkdtemp(join(tmpdir(), 'pix-forge-sheet-'));
after(() => rm(testDist, { recursive: true, force: true }));
await build({
  configFile: false,
  publicDir: false,
  logLevel: 'error',
  build: {
    outDir: testDist,
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: {
        layout: resolve('src/lib/spriteSheetLayout.ts'),
        exporter: resolve('src/lib/animationExport.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.mjs`,
    },
  },
});

const { getSpriteSheetLayout } = await import(pathToFileURL(join(testDist, 'layout.mjs')).href);
const { exportSpriteSheetPngBlob } = await import(pathToFileURL(join(testDist, 'exporter.mjs')).href);

test('10 frames default to a 4-by-3 near-square grid, not one horizontal row', () => {
  const layout = getSpriteSheetLayout(256, 256, 10, 8, 0);
  assert.equal(layout.columns, 4);
  assert.equal(layout.rows, 3);
  assert.equal(layout.width, 8192);
  assert.equal(layout.height, 6144);
  assert.equal(layout.pixelCount, 50_331_648);
  assert.equal(layout.isWithinLimits, false);
  assert.match(layout.errorMessage, /16,000,000/);
  assert.match(layout.errorMessage, /降低匯出倍率/);
});

test('4x scale brings the same layout inside the pixel budget', () => {
  const layout = getSpriteSheetLayout(256, 256, 10, 4, 0);
  assert.equal(layout.columns, 4);
  assert.equal(layout.rows, 3);
  assert.equal(layout.width, 4096);
  assert.equal(layout.height, 3072);
  assert.equal(layout.pixelCount, 12_582_912);
  assert.equal(layout.isWithinLimits, true);
  assert.equal(layout.errorMessage, null);
});

test('explicit single row stays available, but oversized width is rejected', () => {
  const layout = getSpriteSheetLayout(256, 256, 10, 8, -1);
  assert.equal(layout.columns, 10);
  assert.equal(layout.rows, 1);
  assert.equal(layout.width, 20_480);
  assert.equal(layout.isWithinLimits, false);
});

test('column override is used consistently for dimensions and safety', () => {
  const layout = getSpriteSheetLayout(256, 256, 10, 4, 2);
  assert.equal(layout.columns, 2);
  assert.equal(layout.rows, 5);
  assert.equal(layout.width, 2048);
  assert.equal(layout.height, 5120);
  assert.equal(layout.pixelCount, 10_485_760);
  assert.equal(layout.isWithinLimits, true);
});

test('width above 16384 is rejected even when total pixels are low', () => {
  const layout = getSpriteSheetLayout(17000, 1, 1, 1);
  assert.equal(layout.pixelCount, 17000);
  assert.equal(layout.isWithinLimits, false);
});

test('exporter rejects unsafe sheets before touching document canvas', async () => {
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    get() { throw new Error('Unexpected Canvas allocation before dimension guard'); },
  });
  try {
    const frames = Array.from({ length: 10 }, () => ({ width: 256, height: 256 }));
    await assert.rejects(exportSpriteSheetPngBlob(frames, 8, 0), /超過安全匯出上限/);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument, writable: true });
  }
});
