import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

// Run the TypeScript module via Node 22's built-in type stripping, without compiler APIs.
test('document palette operations', () => {
  const moduleUrl = new URL('../src/lib/documentPalette.ts', import.meta.url).href;
  const script = `import { test } from 'node:test';
import assert from 'node:assert/strict';
const { collectDocumentColors, normalizeDocumentHex, replaceDocumentColor } = await import(${JSON.stringify(moduleUrl)});
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
`;
  execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { stdio: 'pipe' });
});
