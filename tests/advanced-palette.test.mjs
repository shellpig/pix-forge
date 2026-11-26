import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const dir = await mkdtemp(join(tmpdir(), 'pix-forge-advanced-palette-'));
after(() => rm(dir, { recursive: true, force: true }));
await build({
  configFile:false, publicDir:false, logLevel:'error',
  build:{
    outDir:dir, emptyOutDir:false, minify:false,
    lib:{
      entry:{
        colorPicker:resolve('src/lib/colorPicker.ts'),
        paletteMerge:resolve('src/lib/paletteMerge.ts'),
        documentPalette:resolve('src/lib/documentPalette.ts'),
        palettes:resolve('src/lib/palettes.ts'),
      },
      formats:['es'], fileName:(_format,name)=>name+'.mjs',
    },
  },
});
const { hexToHsl, hslToHex } = await import(pathToFileURL(join(dir,'colorPicker.mjs')).href);
const { buildPaletteMergePlan, getPaletteMergeGroups, createAutoMergeMapping,
  createManualMergeMapping, paletteMergeGroupId, MAX_AUTO_MERGE_COLORS } =
  await import(pathToFileURL(join(dir,'paletteMerge.mjs')).href);
const { createDocumentColorPreview, remapDocumentColors } =
  await import(pathToFileURL(join(dir,'documentPalette.mjs')).href);
const { hexToRgb, rgbToOklab, oklabDistSq } =
  await import(pathToFileURL(join(dir,'palettes.mjs')).href);

const c=(hex,count=1)=>({hex,count});
const lab=hex=>{ const {r,g,b}=hexToRgb(hex); return rgbToOklab(r,g,b); };
const distance=(a,b)=>Math.sqrt(oklabDistSq(lab(a),lab(b)));

test('RGB to HSL and HSL to RGB handle primaries, neutral colors and hue wrapping',()=>{
  assert.deepEqual(hexToHsl('#ff0000'),{h:0,s:100,l:50});
  assert.equal(hslToHex(120,100,50),'#00ff00');
  assert.equal(hslToHex(240,100,50),'#0000ff');
  assert.equal(hslToHex(360,100,50),'#ff0000');
  assert.equal(hslToHex(-120,100,50),'#0000ff');
  assert.equal(hslToHex(180,0,0),'#000000');
  assert.equal(hslToHex(180,0,100),'#ffffff');
  assert.equal(hslToHex(180,0,50),'#808080');
});

test('HSL round trips existing sRGB colors without byte drift',()=>{
  for(const r of [0,1,18,64,128,203,254,255])
    for(const g of [0,7,32,99,127,193,255])
      for(const b of [0,2,77,128,201,255]){
        const hex='#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
        const {h,s,l}=hexToHsl(hex);
        assert.equal(hslToHex(h,s,l),hex);
      }
});

test('manual merge normalizes all inputs and preserves unrelated colors and alpha',()=>{
  const mapping=createManualMergeMapping(['#FF0000','00ff00','#0000ff'],'0000FF');
  assert.deepEqual([...mapping],[['#ff0000','#0000ff'],['#00ff00','#0000ff']]);
  const data=new Uint8ClampedArray([255,0,0,255,0,255,0,128,0,0,255,255,255,0,0,0,255,255,0,255]);
  const preview=createDocumentColorPreview(data,mapping);
  assert.equal(preview.changed,2);
  assert.deepEqual([...preview.data],[0,0,255,255,0,0,255,128,0,0,255,255,255,0,0,0,255,255,0,255]);
  assert.equal(data[0],255);
  assert.equal(createManualMergeMapping(['#ff0000','bad'],'#0000ff').size,0);
});

test('complete-link grouping prevents chaining distant endpoints',()=>{
  const input=[c('#303030',2),c('#414141',10),c('#525252',3)];
  const a=input[0].hex,b=input[1].hex,d=input[2].hex;
  const tolerance=Math.max(distance(a,b),distance(b,d))+1e-9;
  assert.ok(distance(a,d)>tolerance);
  const plan=buildPaletteMergePlan(input);
  const groups=getPaletteMergeGroups(plan,tolerance);
  assert.equal(groups.length,2);
  for(const group of groups)
    for(const x of group.colors) for(const y of group.colors)
      assert.ok(distance(x.hex,y.hex)<=tolerance+1e-9);
  assert.equal(getPaletteMergeGroups(plan,distance(a,d)+1e-9).length,1);
});

test('hierarchy is deterministic, monotone and preserves the most-used existing representative',()=>{
  const input=[c('#ff0000',4),c('#fe0101',10),c('#00ff00',2),c('#ff0100',10)];
  const plan=buildPaletteMergePlan(input);
  const reversed=buildPaletteMergePlan([...input].reverse());
  assert.deepEqual(plan,reversed);
  let last=input.length;
  for(const tolerance of [0,.001,.01,.03,.1,.3,1]){
    const groups=getPaletteMergeGroups(plan,tolerance);
    assert.ok(groups.length<=last);
    last=groups.length;
    for(const g of groups) assert.equal(g.representative,g.colors[0].hex);
  }
  const groups=getPaletteMergeGroups(plan,.03);
  const merged=groups.find(g=>g.colors.length>1);
  assert.equal(merged.representative,'#fe0101');
  const mapping=createAutoMergeMapping(groups);
  assert.equal(mapping.get('#ff0000'),'#fe0101');
  const overridden=createAutoMergeMapping(groups,new Map([[paletteMergeGroupId(merged),'#ff0000']]));
  assert.equal(overridden.get('#fe0101'),'#ff0000');
  const invalid=createAutoMergeMapping(groups,new Map([[paletteMergeGroupId(merged),'#123456']]));
  assert.deepEqual(invalid,mapping);
});

test('auto mapping keeps only existing representatives and applies once without chaining',()=>{
  const input=[c('#ff0000',9),c('#fe0000',3),c('#00ff00',7),c('#00fe00',2)];
  const groups=getPaletteMergeGroups(buildPaletteMergePlan(input),.02);
  const mapping=createAutoMergeMapping(groups);
  assert.equal(mapping.size,2);
  const original=new Uint8ClampedArray([254,0,0,255,0,254,0,100,254,0,0,0]);
  const out=new Uint8ClampedArray(original);
  assert.equal(remapDocumentColors(out,mapping),2);
  assert.deepEqual([...out],[255,0,0,255,0,255,0,100,254,0,0,0]);
});

test('oversized palettes are rejected explicitly rather than silently truncated',()=>{
  const input=Array.from({length:MAX_AUTO_MERGE_COLORS+1},(_,i)=>c('#'+i.toString(16).padStart(6,'0')));
  assert.equal(buildPaletteMergePlan(input),null);
  assert.deepEqual(getPaletteMergeGroups(buildPaletteMergePlan([]),.1),[]);
  assert.equal(getPaletteMergeGroups(buildPaletteMergePlan([c('#123456')]),.1).length,1);
});
