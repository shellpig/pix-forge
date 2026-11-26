import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'vite';

const dir=await mkdtemp(join(tmpdir(),'pixforge-canvas-source-pick-'));
after(()=>rm(dir,{recursive:true,force:true}));
await build({configFile:false,publicDir:false,logLevel:'error',build:{outDir:dir,emptyOutDir:false,minify:false,
  lib:{entry:{canvasSourcePick:resolve('src/lib/canvasSourcePick.ts'),documentPalette:resolve('src/lib/documentPalette.ts')},
  formats:['es'],fileName:(_format,name)=>name+'.mjs'}}});
const {pixelCoordsFromClient,readCanvasSourceColor,selectCanvasSourceColor}=await import(pathToFileURL(join(dir,'canvasSourcePick.mjs')).href);
const {collectDocumentColors,createDocumentColorPreview}=await import(pathToFileURL(join(dir,'documentPalette.mjs')).href);

test('canvas content coordinates remain exact at zoom, pan and fractional CSS size',()=>{
  const rect={left:-23.25,top:101.5,width:405.5,height:202.75};
  for(const [x,y] of [[0,0],[1,2],[31,15],[63,31]]){
    const clientX=rect.left+(x+.5)*rect.width/64;
    const clientY=rect.top+(y+.5)*rect.height/32;
    assert.deepEqual(pixelCoordsFromClient(rect,clientX,clientY,64,32),{x,y});
  }
  assert.deepEqual(pixelCoordsFromClient(rect,rect.left,rect.top,64,32),{x:0,y:0});
  assert.equal(pixelCoordsFromClient(rect,rect.left+rect.width,rect.top,64,32),null);
  assert.equal(pixelCoordsFromClient(rect,rect.left-.01,rect.top,64,32),null);
  assert.equal(pixelCoordsFromClient(rect,rect.left,rect.top+rect.height,64,32),null);
  assert.equal(pixelCoordsFromClient({...rect,width:0},0,0,64,32),null);
  assert.equal(pixelCoordsFromClient(rect,NaN,0,64,32),null);
});

test('sampling reads exact committed RGB including semi-transparent pixels, ignores alpha zero and never mutates',()=>{
  const image={width:3,height:1,data:new Uint8ClampedArray([255,155,120,255,1,2,3,127,7,8,9,0])};
  const original=[...image.data];
  assert.equal(readCanvasSourceColor(image,0,0),'#ff9b78');
  assert.equal(readCanvasSourceColor(image,1,0),'#010203');
  assert.equal(readCanvasSourceColor(image,2,0),null);
  assert.equal(readCanvasSourceColor(image,3,0),null);
  assert.equal(readCanvasSourceColor(image,-1,0),null);
  assert.equal(readCanvasSourceColor(image,0.5,0),null);
  assert.deepEqual([...image.data],original);
  assert.deepEqual(collectDocumentColors(image.data).map(c=>c.hex).sort(),['#010203','#ff9b78']);
});

test('single canvas pick replaces the selected source and initializes the target to its exact HEX',()=>{
  const selected=['#123456','#654321'];
  assert.deepEqual(selectCanvasSourceColor('single',selected,'#abcdef','#ff9b78'),
    {selected:['#ff9b78'],draft:'#ff9b78'});
  assert.deepEqual(selected,['#123456','#654321']);
});

test('manual picking accumulates unique colors across frames and preserves the chosen target',()=>{
  const frameA={width:1,height:1,data:new Uint8ClampedArray([255,155,120,255])};
  const frameB={width:1,height:1,data:new Uint8ClampedArray([255,186,136,255])};
  let state=selectCanvasSourceColor('manual',[],'',readCanvasSourceColor(frameA,0,0));
  assert.deepEqual(state,{selected:['#ff9b78'],draft:'#ff9b78'});
  state=selectCanvasSourceColor('manual',state.selected,'#ffd997',readCanvasSourceColor(frameB,0,0));
  assert.deepEqual(state,{selected:['#ff9b78','#ffba88'],draft:'#ffd997'});
  state=selectCanvasSourceColor('manual',state.selected,state.draft,readCanvasSourceColor(frameA,0,0));
  assert.deepEqual(state,{selected:['#ff9b78','#ffba88'],draft:'#ffd997'});
  const mapping=new Map(state.selected.map(hex=>[hex,state.draft]));
  assert.deepEqual([...createDocumentColorPreview(frameA.data,mapping).data],[255,217,151,255]);
  assert.deepEqual([...createDocumentColorPreview(frameB.data,mapping).data],[255,217,151,255]);
  assert.deepEqual([...frameA.data],[255,155,120,255]);
  assert.deepEqual([...frameB.data],[255,186,136,255]);
});
