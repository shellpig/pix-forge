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
  assert.match(viewport, /自訂播放速度（1 至 30 FPS）/);
});

test('removes duplicate size buttons and preserves right-panel size controls', () => {
  assert.doesNotMatch(viewport, /QUICK_RES_BUTTONS/);
  assert.doesNotMatch(viewport, /onSelectDimensions/);
  assert.match(app, /<ControlPanel[\s\S]*?onSelectDimensions=\{handleSelectDimensions\}/);
});

test('single-frame hint uses a compact timeline row, multi-frame uses thumbnails', () => {
  assert.doesNotMatch(viewport, /Single-Frame Hint inside Animate Mode/);
  assert.match(timeline, /加入更多影格即可播放動畫/);
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
  assert.match(viewport, /aria-label="查看操作快捷鍵"/);
  assert.match(viewport, /role="dialog" aria-label="操作快捷鍵說明"/);
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
