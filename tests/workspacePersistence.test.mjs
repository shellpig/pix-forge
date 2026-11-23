import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const testDist = await mkdtemp(join(tmpdir(), 'pix-forge-persist-'));
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
      entry: resolve('src/lib/workspacePersistence.ts'),
      formats: ['es'],
      fileName: () => 'workspacePersistence.mjs',
    },
  },
});

const {
  normalizeRestoredSession,
  serializeManualEdit,
  loadPersistedWorkspace,
} = await import(pathToFileURL(join(testDist, 'workspacePersistence.mjs')).href);

test('normalizeRestoredSession rejects empty, corrupt, or unsupported version payloads', () => {
  assert.equal(normalizeRestoredSession(null), null);
  assert.equal(normalizeRestoredSession({ version: 2, frames: [] }), null);
  assert.equal(normalizeRestoredSession({ version: 1, frames: [] }), null);
  assert.equal(
    normalizeRestoredSession({ version: 1, frames: [{ id: 'f1', name: 'bad.png' }] }),
    null
  );
});

test('normalizeRestoredSession merges defaults and sanitizes invalid viewMode/fps', () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  const restored = normalizeRestoredSession({
    version: 1,
    activeSampleId: null,
    activeFrameId: 'f1',
    viewMode: 'nonexistent',
    config: { targetW: 48, targetH: 48 },
    fps: 999,
    exportScale: 4,
    spriteSheetCols: 4,
    frames: [{ id: 'f1', name: 'hero.png', sourceBlob: blob }],
  });

  assert.ok(restored);
  assert.equal(restored.viewMode, 'side-by-side');
  assert.equal(restored.fps, 10);
  assert.equal(restored.exportScale, 4);
  assert.equal(restored.config.targetW, 48);
  assert.equal(restored.config.targetH, 48);
  assert.deepEqual(restored.config.crop, { x: 0, y: 0, w: 1, h: 1 });
  assert.equal(restored.frames.length, 1);
  assert.equal(restored.frames[0].id, 'f1');
});

test('serializeManualEdit copies pixel buffer safely and loadPersistedWorkspace degrades gracefully without IndexedDB', async () => {
  const buf = new Uint8ClampedArray([255, 0, 128, 255]);
  const serialized = serializeManualEdit({ width: 1, height: 1, data: buf });
  assert.ok(serialized);
  buf[0] = 0;
  assert.equal(serialized.data[0], 255);
  assert.equal(await loadPersistedWorkspace(), null);
});
