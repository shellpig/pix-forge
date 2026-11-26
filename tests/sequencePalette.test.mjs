import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'vite';

const dir=await mkdtemp(join(tmpdir(),'pixforge-sequence-palette-'));
after(()=>rm(dir,{recursive:true,force:true}));
await build({configFile:false,publicDir:false,logLevel:'error',build:{outDir:dir,emptyOutDir:false,minify:false,
  lib:{entry:{sequencePalette:resolve('src/lib/sequencePalette.ts'),batchHistory:resolve('src/lib/batchHistory.ts'),
    frameHistory:resolve('src/lib/frameHistory.ts'),paletteMerge:resolve('src/lib/paletteMerge.ts')},
  formats:['es'],fileName:(_format,name)=>name+'.mjs'}}});
const load=async name=>import(pathToFileURL(join(dir,name+'.mjs')).href);
const {collectSequencePalette,getSequenceMappingStats,previewSequenceFrame,equalPaletteMappings}=await load('sequencePalette');
const {commitSequenceColors,commitSinglePixelEdit,movePixelEntry,getBatchBlockReason}=await load('batchHistory');
const {getEffectiveFrameImageData}=await load('frameHistory');
const {buildPaletteMergePlan,getPaletteMergeGroups,createAutoMergeMapping,createManualMergeMapping}=await load('paletteMerge');
globalThis.ImageData=class {constructor(data,width,height){this.data=data;this.width=width;this.height=height;}};
const image=(...pixels)=>new ImageData(new Uint8ClampedArray(pixels.flat()),pixels.length,1);
const frame=(id,img)=>({id,convertedResult:{imageData:img,width:img.width,height:img.height,palette:[],uniqueColorCount:1,computeMs:0},editHistory:[],historyIndex:-1});
const p=(r,g,b,a=255)=>[r,g,b,a];
const ready={isPlaying:false,isConversionPending:false,isBatchProcessing:false,hasPendingReconvert:false,hasPreview:false};
const journal=(...frames)=>({frames,undo:[],redo:[]});
const fixture=()=>journal(frame('a',image(p(255,0,0),p(255,0,0,128),p(0,255,0))),
  frame('b',image(p(255,0,0),p(0,0,255),p(0,255,0,0))),frame('c',image(p(0,0,255),p(0,0,255))));
const pixels=j=>j.frames.map(f=>[...getEffectiveFrameImageData(f).data]);

test('sequence palette sums visible pixels and unique frame membership independently of shared conversion palette',()=>{
 const j=fixture(); const palette=collectSequencePalette(j.frames);
 assert.equal(palette.frameCount,3);assert.equal(palette.convertedCount,3);
 assert.deepEqual(palette.colors.map(c=>[c.hex,c.count,c.pixelCount,c.frameCount,c.frameIds]),[
  ['#0000ff',3,3,2,['b','c']],['#ff0000',3,3,2,['a','b']],['#00ff00',1,1,1,['a']]]);
 const edited=commitSinglePixelEdit(j,'c',image(p(255,0,0),p(255,0,0))).journal;
 const after=collectSequencePalette(edited.frames);
 assert.equal(after.colors.find(c=>c.hex==='#ff0000').count,5);
 assert.equal(after.colors.find(c=>c.hex==='#ff0000').frameCount,3);
});

test('unconverted frames are counted but not scanned; all-frame apply is blocked',()=>{
 const j=fixture();j.frames.push({...j.frames[0],id:'pending',convertedResult:null});
 const palette=collectSequencePalette(j.frames);
 assert.equal(palette.convertedCount,3);assert.equal(palette.frameCount,4);
 assert.equal(getBatchBlockReason(j.frames,ready),'unconverted-frame');
 assert.deepEqual(commitSequenceColors(j,new Map([['#ff0000','#000000']]),ready,'pending'),{ok:false,reason:'unconverted-frame'});
});

test('mapping stats predict union color count, changed pixels, unique affected frames and exact history charge',()=>{
 const j=fixture(),palette=collectSequencePalette(j.frames);
 const mapping=new Map([['#ff0000','#0000ff'],['#00ff00','#0000ff']]);
 const stats=getSequenceMappingStats(palette,mapping);
 assert.equal(stats.after,1);assert.equal(stats.changedPixels,4);
 assert.deepEqual([...stats.affectedFrameIds].sort(),['a','b']);assert.equal(stats.bytes,48);
 const r=commitSequenceColors(j,mapping,ready,'merge');
 assert.equal(r.ok,true);assert.equal(r.changedPixels,stats.changedPixels);assert.equal(r.transaction.bytes,stats.bytes);
 assert.equal(collectSequencePalette(r.journal.frames).colors.length,stats.after);
 assert.strictEqual(r.journal.frames[2],j.frames[2]);
 const undo=movePixelEntry(r.journal,r.transaction,'undo');assert.equal(undo.status,'applied');assert.deepEqual(pixels(undo.journal),pixels(j));
 const redo=movePixelEntry(undo.journal,r.transaction,'redo');assert.equal(redo.status,'applied');assert.deepEqual(pixels(redo.journal),pixels(r.journal));
});

test('lazy sequence preview supports scrubbing affected and unaffected frames without changing committed pixels',()=>{
 const j=fixture(),before=pixels(j);
 const mapping=new Map([['#ff0000','#000000']]);
 const a=previewSequenceFrame(j.frames[0],mapping),b=previewSequenceFrame(j.frames[1],mapping),c=previewSequenceFrame(j.frames[2],mapping);
 assert.deepEqual([...a.data],[0,0,0,255,0,0,0,128,0,255,0,255]);
 assert.deepEqual([...b.data],[0,0,0,255,0,0,255,255,0,255,0,0]);
 assert.strictEqual(c,j.frames[2].convertedResult.imageData);
 assert.deepEqual(pixels(j),before);assert.equal(j.undo.length,0);
 assert.equal(equalPaletteMappings(mapping,new Map(mapping)),true);
 assert.equal(equalPaletteMappings(mapping,new Map([['#ff0000','#ffffff']])),false);
 assert.equal(equalPaletteMappings(mapping,new Map()),false);
});

test('manual merge can select source colors from different frames and creates a single batch',()=>{
 const j=journal(frame('a',image(p(255,0,0))),frame('b',image(p(0,255,0))),frame('c',image(p(0,0,255))));
 const mapping=createManualMergeMapping(['#ff0000','#00ff00'],'#123456');
 const r=commitSequenceColors(j,mapping,ready,'manual');
 assert.equal(r.ok,true);assert.equal(r.journal.undo.length,1);
 assert.equal(r.transaction.changes.length,2);
 assert.deepEqual(collectSequencePalette(r.journal.frames).colors.map(c=>c.hex),['#123456','#0000ff']);
});

test('automatic grouping uses whole-animation frequency, including manual pixels on other frames',()=>{
 const j=journal(frame('a',image(p(255,0,0),p(255,0,0))),
  frame('b',image(p(254,0,0),p(254,0,0),p(254,0,0))),frame('c',image(p(0,0,255))));
 const palette=collectSequencePalette(j.frames);
 const plan=buildPaletteMergePlan(palette.colors),groups=getPaletteMergeGroups(plan,.03);
 const mapping=createAutoMergeMapping(groups);
 assert.equal(mapping.get('#ff0000'),'#fe0000');
 const r=commitSequenceColors(j,mapping,ready,'auto');assert.equal(r.ok,true);
 assert.equal(r.journal.undo.length,1);assert.equal(collectSequencePalette(r.journal.frames).colors.length,2);
});
