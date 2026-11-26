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

test('advanced palette modes and brush share the custom color picker without removing quick swatches', () => {
  const panel = readFileSync('src/components/ControlPanel.tsx', 'utf8');
  const document = readFileSync('src/components/DocumentPalette.tsx', 'utf8');
  const brush = readFileSync('src/components/PixelEditorBar.tsx', 'utf8');
  assert.match(document, /<ColorPicker/);
  assert.match(brush, /<ColorPicker/);
  assert.match(brush, /palette\.slice\(0, 32\)\.map/);
  for (const mode of ['single', 'manual', 'auto']) assert.ok(document.includes("id:'" + mode + "'"));
  assert.match(app, /onApplyColors=\{handleApplyDocumentColors\}/);
  assert.match(panel, /onApplyColors=\{onApplyColors\}/);
  assert.match(document, /onApplyColors\(mapping\)/);
  assert.match(document, /onPreviewColors\(next\)/);
  assert.match(document, /onCancelPreview\(\)/);
});

test('preview cancellation consumes undo and redo before modifying either history stack', () => {
  for (const name of ['handleUndo', 'handleRedo', 'handleGlobalUndo', 'handleGlobalRedo']) {
    const start = app.indexOf('const '+name+' = useCallback(');
    assert.ok(start >= 0);
    const body = app.slice(start, app.indexOf('\n  }, [', start));
    assert.match(body, /=> \{\s*if \(dismissPalettePreview\(\)\) return(?: true)?;/);
  }
  const start = app.indexOf('const dismissPalettePreview =');
  const body = app.slice(start, app.indexOf('}, [previewImageData]);', start));
  assert.match(body, /if \(!previewImageData\) return false;/);
  assert.match(body, /setPalettePreview\(null\)/);
  assert.match(body, /setPaletteDraftResetVersion\(version => version \+ 1\)/);
  assert.doesNotMatch(body, /setFrames\(|undoStackRef|redoStackRef|handleCommitImageData/);
  assert.match(app, /onCancelPalettePreview=\{dismissPalettePreview\}/);
  assert.match(app, /paletteDraftResetVersion=\{paletteDraftResetVersion\}/);
  const panel = readFileSync('src/components/ControlPanel.tsx', 'utf8');
  const document = readFileSync('src/components/DocumentPalette.tsx', 'utf8');
  assert.match(panel, /draftResetVersion=\{paletteDraftResetVersion\}/);
  const reset = document.slice(document.indexOf('if (lastDraftResetVersion !== draftResetVersion)'), document.indexOf('else if (lastImage !== paletteIdentity)'));
  for (const action of ['setSelected([])', "setDraft('')", 'setChooseTarget(false)', 'setTolerance(0)', 'setOverrides(new Map())']) {
    assert.ok(reset.includes(action), 'missing draft reset: ' + action);
  }
});

test('preview keyboard cancellation consumes first Ctrl+Z, ignores held-key repeats, and Escape leaves committed history alone', () => {
  // Exercise the actual shortcut handler's history/preview section with isolated
  // state and synthetic keyboard events, not a duplicate implementation.
  const start = app.indexOf('const onKeyDown = (e: KeyboardEvent) => {');
  const end = app.indexOf("if (viewMode === 'animate'", start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end)
    .replace('(e: KeyboardEvent)', '(e)')
    .replace('e.target as HTMLElement | null', 'e.target') + '}; return onKeyDown;';
  const ref = {current:false};
  let preview = true;
  let committedColors = 30;
  let undo = 0, redo = 0, cancels = 0;
  const dismiss = () => {
    if (!preview) return false;
    preview = false;
    cancels++;
    return true;
  };
  class FakeInput { constructor(type) { this.tagName='INPUT'; this.type=type; } }
  const handler = new Function('dismissPalettePreview', 'previewShortcutConsumedRef', 'handleGlobalUndo', 'handleGlobalRedo', 'HTMLInputElement', code)(
    dismiss, ref, () => { undo++; committedColors=32; return true; },
    () => { redo++; committedColors=30; return true; }, FakeInput
  );
  const press = (key, extras={}) => {
    const event = {key, ctrlKey:false, metaKey:false, shiftKey:false, repeat:false, isComposing:false,
      target:null, prevented:false, preventDefault(){this.prevented=true;}, ...extras};
    handler(event);
    return event.prevented;
  };
  assert.equal(press('z',{ctrlKey:true,target:new FakeInput('range')}),true);
  assert.equal(preview,false);
  assert.equal(committedColors,30);
  assert.equal(undo,0);
  assert.equal(cancels,1);
  assert.equal(press('z',{ctrlKey:true,repeat:true}),true);
  assert.equal(undo,0);
  assert.equal(press('z',{ctrlKey:true,target:new FakeInput('range')}),true);
  assert.equal(undo,1);
  assert.equal(committedColors,32);
  assert.equal(press('y',{ctrlKey:true}),true);
  assert.equal(redo,1);
  assert.equal(committedColors,30);
  preview=true;
  assert.equal(press('Escape',{target:new FakeInput('text')}),true);
  assert.equal(cancels,2);
  assert.equal(committedColors,30);
  assert.equal(undo,1);
  assert.equal(press('z',{ctrlKey:true,target:new FakeInput('text')}),false);
  assert.equal(undo,1); // native text undo outside preview
  preview=true;
  assert.equal(press('z',{metaKey:true,shiftKey:true}),true);
  assert.equal(redo,1);
  assert.equal(cancels,3);
});

test('batch pixel journal is the shared local/global history path and never persists transient transactions',()=>{
  assert.match(app,/commitSinglePixelEdit\(readHistoryJournal\(\), activeFrame.id, next\)/);
  assert.match(app,/commitSequenceColors\(readHistoryJournal\(\), mapping,/);
  assert.match(app,/moveFramePixelHistory\(readHistoryJournal\(\), activeFrame.id, 'undo'\)/);
  assert.match(app,/moveFramePixelHistory\(readHistoryJournal\(\), activeFrame.id, 'redo'\)/);
  assert.match(app,/movePixelEntry\(readHistoryJournal\(\), entry, 'undo'\)/);
  assert.match(app,/movePixelEntry\(readHistoryJournal\(\), entry, 'redo'\)/);
  assert.match(app,/framesRef.current = journal.frames;\s*undoStackRef.current = journal.undo;\s*redoStackRef.current = journal.redo;\s*setFrames\(journal.frames\)/);
  assert.match(app,/sealBatchHistory\(\);\s*const currentFrames = framesRef.current;/);
  assert.match(app,/sealBatchHistory\(targetId\)/);
  assert.match(app,/manualEditCheckpoint: manualImg && \(getHistoryFloor\(f\) > 0 \|\| appliedBatchFrameIds.has\(f.id\)\)/);
  assert.match(app,/historyFloor: manualImg && pf.manualEditCheckpoint === true \? 1 : undefined/);
});

test('sequence scope keeps the document palette mounted across active-frame changes and routes the whole mapping once',()=>{
  const panel=readFileSync('src/components/ControlPanel.tsx','utf8');
  const doc=readFileSync('src/components/DocumentPalette.tsx','utf8');
  assert.ok(panel.includes("key={paletteScope === 'sequence' ? 'sequence' : activeFrameId ?? 'none'}"));
  assert.ok(panel.includes("onPreviewColors={paletteScope === 'sequence' ? onPreviewSequenceColors : onPreviewColors}"));
  assert.match(doc,/onApplySequenceColors\(mapping\)/);
  assert.match(app,/onApplySequenceColors=\{handleApplySequencePalette\}/);
  assert.match(app,/equalPaletteMappings\(validSequencePreview.mapping,mapping\)/);
  assert.match(app,/previewSequenceFrame\(activeFrame, validSequencePreview.mapping\)/);
  assert.match(app,/sequencePreview.frames === frames/);
  assert.match(app,/const timelineFrames:[\s\S]*?imageData: getEffectiveFrameImageData\(f\)/);
  assert.match(app,/onUndoSequence=\{handleGlobalUndo\}/);
  assert.match(app,/onRedoSequence=\{handleGlobalRedo\}/);
});
