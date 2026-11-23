import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

// Bundle just the history helper using the project's existing Vite toolchain,
// so the regression tests continue to work without an extra tsx dependency.
const testDist = await mkdtemp(join(tmpdir(), 'pix-forge-history-'));
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
      entry: resolve('src/lib/frameHistory.ts'),
      formats: ['es'],
      fileName: () => 'frameHistory.mjs',
    },
  },
});
const {
  appendFrameEdit,
  applyFrameConversion,
  getEffectiveFrameImageData,
} = await import(pathToFileURL(join(testDist, 'frameHistory.mjs')).href);

class TestImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

// ImageData is browser-provided; provide the same constructor contract in Node.
globalThis.ImageData = TestImageData;

const image = (value) => new ImageData(new Uint8ClampedArray([value, 0, 0, 255]), 1, 1);
const result = (value) => ({
  imageData: image(value),
  width: 1,
  height: 1,
  palette: [],
  uniqueColorCount: 1,
  computeMs: 1,
});
const makeFrame = (value) => ({
  convertedResult: result(value),
  editHistory: [],
  historyIndex: -1,
});

test('new conversion updates history baseline but keeps manual edit snapshots', () => {
  let frame = makeFrame(10);
  frame = appendFrameEdit(frame, image(20), 40);
  frame = appendFrameEdit(frame, image(30), 40);
  const originalEdit = frame.editHistory[2];
  frame = applyFrameConversion(frame, result(100));

  assert.equal(frame.historyIndex, 2);
  assert.equal(frame.editHistory[0].data[0], 100);
  assert.equal(frame.editHistory[1].data[0], 20);
  assert.equal(frame.editHistory[2].data[0], 30);
  assert.strictEqual(frame.editHistory[2], originalEdit);
  assert.equal(getEffectiveFrameImageData(frame).data[0], 30);
});

test('undo to zero and paint again forks history from current conversion B', () => {
  let frame = makeFrame(10);
  frame = appendFrameEdit(frame, image(20), 40);
  frame = appendFrameEdit(frame, image(30), 40);
  frame = applyFrameConversion(frame, result(100));

  frame = { ...frame, historyIndex: 0 }; // Ctrl+Z back to baseline
  assert.equal(getEffectiveFrameImageData(frame).data[0], 100);
  frame = appendFrameEdit(frame, image(110), 40);
  assert.equal(frame.historyIndex, 1);
  assert.deepEqual(frame.editHistory.map((img) => img.data[0]), [100, 110]);
  frame = { ...frame, historyIndex: 0 };
  assert.equal(getEffectiveFrameImageData(frame).data[0], 100);
  frame = { ...frame, historyIndex: 1 };
  assert.equal(getEffectiveFrameImageData(frame).data[0], 110);
});

test('history cap preserves the conversion baseline rather than truncating it', () => {
  let frame = makeFrame(10);
  for (let i = 0; i < 12; i++) frame = appendFrameEdit(frame, image(20 + i), 5);
  assert.equal(frame.editHistory.length, 5);
  assert.equal(frame.historyIndex, 4);
  assert.deepEqual(frame.editHistory.map((img) => img.data[0]), [10, 28, 29, 30, 31]);
  frame = applyFrameConversion(frame, result(200));
  assert.equal(frame.editHistory[0].data[0], 200);
  assert.equal(getEffectiveFrameImageData({ ...frame, historyIndex: 0 }).data[0], 200);
});

test('no manual edits means conversion has no synthetic undo history', () => {
  let frame = makeFrame(10);
  frame = applyFrameConversion(frame, result(50));
  assert.equal(frame.historyIndex, -1);
  assert.deepEqual(frame.editHistory, []);
  assert.equal(getEffectiveFrameImageData(frame).data[0], 50);
});
