import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viewport = readFileSync('src/components/CanvasViewport.tsx', 'utf8');
const timeline = readFileSync('src/components/FrameTimelineBar.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

test('one scrollable toolbar includes animation transport, without a separate playback row', () => {
  assert.match(viewport, /Compact single-row toolbar/);
  assert.match(viewport, /overflow-x-auto studio-scroll whitespace-nowrap/);
  assert.doesNotMatch(viewport, /Animation Playback Bar/);
  assert.match(viewport, /onTogglePlay/);
  assert.match(viewport, /onStepFrame\(-1\)/);
  assert.match(viewport, /onStepFrame\(1\)/);
  assert.match(viewport, /FPS_PRESETS\.map/);
  assert.match(viewport, /toolbar\.fpsInputAria/);
});

test('removes duplicate size buttons and preserves right-panel size controls', () => {
  assert.doesNotMatch(viewport, /QUICK_RES_BUTTONS/);
  assert.doesNotMatch(viewport, /onSelectDimensions/);
  assert.match(app, /<ControlPanel[\s\S]*?onSelectDimensions=\{handleSelectDimensions\}/);
});

test('single-frame hint uses a compact timeline row, multi-frame uses thumbnails', () => {
  assert.doesNotMatch(viewport, /Single-Frame Hint inside Animate Mode/);
  assert.match(timeline, /timeline\.singleHint/);
  assert.match(timeline, /!isSingleFrame && \(/);
  assert.match(timeline, /w-\[52px\]/);
  assert.match(timeline, /h-\[38px\]/);
});

test('moving controls keeps upload, timeline interactions and manual edit navigation', () => {
  assert.match(viewport, /onSelectSample\(sample\)/);
  assert.match(viewport, /onEditFrame\(activeFrameId\)/);
  assert.match(timeline, /onAppendFiles\(list\)/);
  assert.match(timeline, /onReorderFrames\(dragIndex, index\)/);
  assert.match(timeline, /onDeleteFrame\(frame.id\)/);
  assert.match(timeline, /onEditFrame\(frame.id\)/);
});

test('fixed shortcut footer becomes accessible help and live coordinate overlay', () => {
  assert.doesNotMatch(viewport, /Bottom Contextual Hint & Live Pixel Coordinate Bar/);
  assert.match(viewport, /aria-label=\{t\('toolbar\.shortcutsAria'\)\}/);
  assert.match(viewport, /role="dialog" aria-label=\{t\('shortcuts\.dialogAria'\)\}/);
  assert.match(viewport, /viewMode === 'edit' && hoverPixel/);
  assert.match(viewport, /X:\{hoverPixel\.x\} Y:\{hoverPixel\.y\}/);
});

test('removes duplicate top-right download button and enables wheel zoom overflow in edit mode', () => {
  const headerMatch = app.match(/<header[\s\S]*?<\/header>/);
  assert.ok(headerMatch);
  assert.doesNotMatch(headerMatch[0], /下載 PNG/);
  assert.doesNotMatch(headerMatch[0], /handleDownloadPng/);
  assert.match(viewport, /addEventListener\('wheel', handleWheel, \{ passive: false \}\)/);
  assert.match(viewport, /className="m-auto shrink-0"/);
});

test('crop preview draws decoded sourceImage onto canvas instead of reusing revoked blob src', () => {
  assert.doesNotMatch(viewport, /src=\{sourceImage\.src\}/);
  assert.match(viewport, /ref=\{cropPreviewCanvasRef\}/);
});

test('frame deletion shows nearby confirmation popover with skip option and supports Ctrl+Z restore', () => {
  assert.match(timeline, /aria-label=\{t\('timeline\.confirmAria'\)\}/);
  assert.match(timeline, /timeline\.dontAskAgain/);
  assert.match(app, /type: 'delete-frame'/);
  assert.match(app, /handleGlobalUndo/);
});

test('palette preview is separate from committed editing, persistence and export', () => {
  const previewStart = app.indexOf('const handlePreviewDocumentColors =');
  const applyStart = app.indexOf('const handleApplyDocumentColors =');
  const replaceStart = app.indexOf('const handleReplaceDocumentColor =');
  assert.ok(previewStart >= 0 && previewStart < applyStart && applyStart < replaceStart);
  const preview = app.slice(previewStart, applyStart);
  const apply = app.slice(applyStart, replaceStart);
  assert.match(preview, /createDocumentColorPreview\(activeResult\.imageData\.data, mapping\)/);
  assert.doesNotMatch(preview, /handleCommitImageData|setFrames\(/);
  assert.equal((apply.match(/handleCommitImageData\(/g) || []).length, 1);
  assert.match(app, /<CanvasViewport[\s\S]*?result=\{activeResult\}[\s\S]*?previewImageData=\{previewImageData\}/);
  assert.match(viewport, /syncCanvasesWithImageData\(previewImageData \?\? result\.imageData\)/);
  assert.match(viewport, /if \(!result \|\| previewImageData\) return;/);
  assert.match(app, /exportPixelPngBlob\(activeResult\.imageData, exportScale\)/);
  assert.match(app, /getEffectiveFrameImageData\(f\)/);
});

test('output palette retains one-click brush selection and clipboard copy', () => {
  const panel = readFileSync('src/components/ControlPanel.tsx', 'utf8');
  assert.match(panel, /onClick=\{\(\) => handleCopyHex\(hex\)\}/);
  assert.match(panel, /const handleCopyHex[\s\S]*?navigator\.clipboard\?\.writeText\(hex\)[\s\S]*?onPickColor\(hex\)/);
  assert.match(panel, /<DocumentPalette/);
});
