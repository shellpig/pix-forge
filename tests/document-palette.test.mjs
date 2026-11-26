import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/documentPalette.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { collectDocumentColors, normalizeDocumentHex, replaceDocumentColor } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

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
