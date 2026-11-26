import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

// Run the TypeScript module via Node 22's built-in type stripping, without compiler APIs.
test('document palette operations', () => {
  const moduleUrl = new URL('../src/lib/documentPalette.ts', import.meta.url).href;
  const script = `import { test } from 'node:test';
import assert from 'node:assert/strict';
const { collectDocumentColors, normalizeDocumentHex, replaceDocumentColor, remapDocumentColors, createDocumentColorPreview } = await import(${JSON.stringify(moduleUrl)});
test('normalizes complete HEX values only', () => {
  assert.equal(normalizeDocumentHex(' FFD997 '), '#ffd997');
  assert.equal(normalizeDocumentHex('#ff0'), null);
  assert.equal(normalizeDocumentHex('#gg0000'), null);
});

test('global replacement preserves alpha and transparent pixels; unrelated colors untouched', () => {
  const data = new Uint8ClampedArray([255,155,120,255, 1,2,3,255, 255,155,120,128, 255,155,120,0]);
  assert.equal(replaceDocumentColor(data, '#FF9B78', '#FFD997'), 2);
  assert.deepEqual([...data], [255,217,151,255, 1,2,3,255, 255,217,151,128, 255,155,120,0]);
  assert.equal(replaceDocumentColor(data, '#ffd997', '#ffd997'), 0);
  assert.equal(replaceDocumentColor(data, '#ffd997', 'invalid'), 0);
  assert.deepEqual(collectDocumentColors(data), [{hex:'#ffd997',count:2},{hex:'#010203',count:1}]);
});

test('document palette includes all colors beyond quick-palette limit', () => {
  const data = new Uint8ClampedArray(100*4);
  for(let i=0;i<100;i++) {data[i*4]=i;data[i*4+3]=255;}
  assert.equal(collectDocumentColors(data).length, 100);
});
test('multi-color mapping is simultaneous, never cascading', () => {
  const data = new Uint8ClampedArray([255,0,0,255, 0,255,0,128, 0,0,255,255, 255,0,0,0]);
  const mapping = new Map([['#ff0000','#00ff00'],['#00ff00','#0000ff']]);
  assert.equal(remapDocumentColors(data, mapping), 2);
  assert.deepEqual([...data], [0,255,0,255, 0,0,255,128, 0,0,255,255, 255,0,0,0]);
});

test('cyclic mappings and black targets use the original RGB value', () => {
  const data = new Uint8ClampedArray([255,0,0,255, 0,255,0,255, 0,0,255,255]);
  assert.equal(remapDocumentColors(data, new Map([['#ff0000','#00ff00'],['#00ff00','#ff0000'],['#0000ff','#000000']])), 3);
  assert.deepEqual([...data], [0,255,0,255, 255,0,0,255, 0,0,0,255]);
});

test('invalid or contradictory mappings are atomic no-ops', () => {
  const data = new Uint8ClampedArray([255,0,0,255, 0,255,0,255]);
  const original = new Uint8ClampedArray(data);
  assert.equal(remapDocumentColors(data, new Map([['#ff0000','#00ff00'],['#00ff00','invalid']])), 0);
  assert.deepEqual(data, original);
  assert.equal(remapDocumentColors(data, new Map([['#FF0000','#00ff00'],['ff0000','#0000ff']])), 0);
  assert.deepEqual(data, original);
  assert.equal(remapDocumentColors(data, new Map([['#FF0000','ff0000']])), 0);
  assert.equal(remapDocumentColors(data, new Map()), 0);
  assert.equal(remapDocumentColors(data, new Map([['#0000ff','#ff0000']])), 0);
  assert.deepEqual(data, original);
});

test('multiple sources merge in one pass and normalized duplicate entries are harmless', () => {
  const data = new Uint8ClampedArray([255,0,0,255, 0,255,0,128, 0,0,255,255]);
  assert.equal(remapDocumentColors(data, new Map([['#FF0000','#0000ff'],['ff0000','0000FF'],['#00ff00','#0000ff']])), 2);
  assert.deepEqual(collectDocumentColors(data), [{hex:'#0000ff',count:3}]);
  assert.equal(data[7],128);
});

test('preview is isolated, repeatable and null for no-op', () => {
  const baseline = new Uint8ClampedArray([255,0,0,255, 0,255,0,128, 255,0,0,0]);
  const original = new Uint8ClampedArray(baseline);
  const first = createDocumentColorPreview(baseline, new Map([['#ff0000','#00ff00']]));
  const second = createDocumentColorPreview(baseline, new Map([['#ff0000','#0000ff']]));
  assert.equal(first.changed,1);
  assert.equal(second.changed,1);
  assert.notStrictEqual(first.data,baseline);
  assert.notStrictEqual(first.data,second.data);
  assert.deepEqual([...first.data], [0,255,0,255, 0,255,0,128, 255,0,0,0]);
  assert.deepEqual([...second.data], [0,0,255,255, 0,255,0,128, 255,0,0,0]);
  assert.deepEqual(baseline, original);
  assert.equal(createDocumentColorPreview(baseline, new Map([['#ff0000','#ff0000']])),null);
  assert.equal(createDocumentColorPreview(baseline, new Map([['#ff0000','invalid']])),null);
});

`;
  execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { stdio: 'pipe' });
});
