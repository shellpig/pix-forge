import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const dir=await mkdtemp(join(tmpdir(),'pixforge-batch-history-'));
after(()=>rm(dir,{recursive:true,force:true}));
await build({configFile:false,publicDir:false,logLevel:'error',build:{
  outDir:dir,emptyOutDir:false,minify:false,lib:{
    entry:{batchHistory:resolve('src/lib/batchHistory.ts'),frameHistory:resolve('src/lib/frameHistory.ts')},
    formats:['es'],fileName:(_format,name)=>name+'.mjs',
  },
}});
const {commitSequenceColors,commitSinglePixelEdit,movePixelEntry,moveFramePixelHistory,retireBatchHistory,
  batchHistoryBytes,getBatchBlockReason,canMoveFramePixelHistory,MAX_BATCH_HISTORY_BYTES}=await import(pathToFileURL(join(dir,'batchHistory.mjs')).href);
const {getEffectiveFrameImageData,applyFrameConversion,getHistoryFloor}=await import(pathToFileURL(join(dir,'frameHistory.mjs')).href);

globalThis.ImageData=class {constructor(data,width,height){this.data=data;this.width=width;this.height=height;}};
const img=(v,alpha=255)=>new ImageData(new Uint8ClampedArray([v,0,0,alpha]),1,1);
const result=(v,alpha=255)=>({imageData:img(v,alpha),width:1,height:1,palette:[],uniqueColorCount:1,computeMs:1});
const frame=(id,v,alpha=255)=>({id,convertedResult:result(v,alpha),editHistory:[],historyIndex:-1});
const journal=(...frames)=>({frames,undo:[],redo:[]});
const values=j=>j.frames.map(f=>getEffectiveFrameImageData(f)?.data[0]);
const ready={isPlaying:false,isConversionPending:false,isBatchProcessing:false,hasPendingReconvert:false,hasPreview:false};
const hex=v=>'#'+v.toString(16).padStart(2,'0')+'0000';
const mapping=(from,to)=>new Map([[hex(from),hex(to)]]);
const apply=(j,from,to,id='batch1',limits)=>{const r=commitSequenceColors(j,mapping(from,to),ready,id,limits);assert.equal(r.ok,true,JSON.stringify(r));return r;};
const single=(j,id,v,limits)=>{const r=commitSinglePixelEdit(j,id,img(v),limits);assert.ok(r);return r;};
const step=(j,id,d)=>{const r=moveFramePixelHistory(j,id,d);assert.equal(r.status,'applied');return r.journal;};
const global=(j,d)=>{const r=movePixelEntry(j,j[d].at(-1),d);assert.equal(r.status,'applied');return r.journal;};
const noBatch=j=>assert.ok([...j.undo,...j.redo].every(e=>e.type!=='batch-pixel-edit'));

test('batch commits changed frames only with one journal entry and preserves alpha',()=>{
  const original=journal(frame('a',10),frame('b',10,127),frame('c',20),frame('d',10,0));
  const before=original.frames.map(f=>f.convertedResult.imageData);
  const r=apply(original,10,30);
  assert.deepEqual(values(r.journal),[30,30,20,10]);
  assert.equal(r.changedPixels,2);
  assert.equal(r.journal.undo.length,1);
  assert.equal(r.transaction.type,'batch-pixel-edit');
  assert.deepEqual(r.transaction.changes.map(c=>c.frameId),['a','b']);
  assert.equal(r.transaction.bytes,16);
  assert.equal(getEffectiveFrameImageData(r.journal.frames[1]).data[3],127);
  assert.strictEqual(r.journal.frames[2],original.frames[2]);
  assert.strictEqual(r.journal.frames[3],original.frames[3]);
  assert.strictEqual(r.transaction.changes[0].before,before[0]);
  assert.strictEqual(r.transaction.changes[0].after,r.journal.frames[0].editHistory[1]);
  assert.deepEqual(values(original),[10,10,20,10]);
  assert.equal(original.undo.length,0);
  let j=global(r.journal,'undo');
  assert.deepEqual(values(j),[10,10,20,10]);
  assert.equal(j.redo.length,1);
  j=global(j,'redo');
  assert.deepEqual(values(j),[30,30,20,10]);
});

test('local undo is atomic, blocks until newer participating edits are resolved, unrelated edits stay intact',()=>{
  let j=apply(journal(frame('a',10),frame('b',10),frame('c',40)),10,30).journal;
  j=single(j,'a',50).journal;
  j=single(j,'c',60).journal;
  const blocked=moveFramePixelHistory(j,'b','undo');
  assert.equal(blocked.status,'blocked');
  assert.equal(canMoveFramePixelHistory(j,'b','undo'),false);
  assert.deepEqual(values(j),[50,30,60]);
  j=step(j,'a','undo');
  j=step(j,'b','undo');
  assert.deepEqual(values(j),[10,10,60]);
  assert.equal(j.redo.filter(e=>e.type==='batch-pixel-edit').length,1);
  j=step(j,'a','redo');
  assert.deepEqual(values(j),[30,30,60]);
  j=step(j,'a','redo');
  assert.deepEqual(values(j),[50,30,60]);
});

test('batch redo cannot jump across an earlier local edit on another frame',()=>{
  let j=single(journal(frame('a',10),frame('b',10)),'a',20).journal;
  const r=commitSequenceColors(j,new Map([[hex(10),hex(30)],[hex(20),hex(30)]]),ready,'batch');
  assert.equal(r.ok,true);
  j=step(r.journal,'a','undo');
  j=step(j,'a','undo');
  assert.deepEqual(values(j),[10,10]);
  assert.equal(moveFramePixelHistory(j,'b','redo').status,'blocked');
  j=step(j,'a','redo');
  j=step(j,'b','redo');
  assert.deepEqual(values(j),[30,30]);
});

test('reordering uses frame ids; missing frames or changed baseline reject the entire transaction',()=>{
  const r=apply(journal(frame('a',10),frame('b',10)),10,30);
  const reversed={...r.journal,frames:[...r.journal.frames].reverse()};
  assert.deepEqual(values(global(reversed,'undo')),[10,10]);
  const missing={...r.journal,frames:[r.journal.frames[0]]};
  assert.equal(movePixelEntry(missing,r.transaction,'undo').status,'blocked');
  const changed={...r.journal,frames:[applyFrameConversion(r.journal.frames[0],result(70)),r.journal.frames[1]]};
  assert.equal(movePixelEntry(changed,r.transaction,'undo').status,'blocked');
  assert.deepEqual(values(changed),[30,30]);
  assert.equal(changed.undo.length,1);
});

test('forking after batch undo removes its redo from every participant',()=>{
  let j=apply(journal(frame('a',10),frame('b',10),frame('c',40)),10,30).journal;
  j=global(j,'undo');
  const r=single(j,'c',50);
  assert.equal(r.retired,1);
  j=r.journal;
  noBatch(j);
  assert.deepEqual(values(j),[10,10,50]);
  assert.equal(moveFramePixelHistory(j,'a','redo').status,'empty');
  assert.equal(moveFramePixelHistory(j,'b','redo').status,'empty');
});

test('per-frame cap checkpoints whole batch before one participant loses its snapshot',()=>{
  const limits={maxHistory:5,maxBatchBytes:1000};
  let j=apply(journal(frame('a',10),frame('b',10)),10,30,'b1',limits).journal;
  for(const v of [40,50,60]) j=single(j,'a',v,limits).journal;
  const r=single(j,'a',70,limits);
  assert.equal(r.retired,1);
  j=r.journal;
  noBatch(j);
  assert.deepEqual(values(j),[70,30]);
  assert.equal(getHistoryFloor(j.frames[1]),1);
  assert.equal(moveFramePixelHistory(j,'b','undo').status,'empty');
  for(let i=0;i<3;i++) j=step(j,'a','undo');
  assert.equal(moveFramePixelHistory(j,'a','undo').status,'empty');
  assert.equal(values(j)[1],30);
  assert.ok(j.frames.every(f=>f.editHistory.length<=limits.maxHistory));
});

test('frame cap preserves batch when only older independent snapshots are trimmed',()=>{
  const limits={maxHistory:8,maxBatchBytes:1000};
  let j=journal(frame('a',10),frame('b',20));
  for(const v of [11,12,13,14]) j=single(j,'a',v,limits).journal;
  let r=apply(j,14,30,'late',limits);
  j=r.journal;
  // Use a larger global journal limit in this scenario by trimming only
  // irrelevant earlier single entries, simulating the bounded global stack.
  j={...j,undo:j.undo.filter(e=>e.type==='batch-pixel-edit')};
  for(const v of [40,50,60]) j=single(j,'a',v,limits).journal;
  assert.ok(j.undo.some(e=>e.type==='batch-pixel-edit'));
  for(let i=0;i<3;i++) j=step(j,'a','undo');
  j=step(j,'a','undo');
  assert.deepEqual(values(j),[14,20]);
});

test('global history cap retires a batch even when edits occur only on another frame',()=>{
  const limits={maxHistory:4,maxBatchBytes:1000};
  let j=apply(journal(frame('a',10),frame('b',10),frame('c',40)),10,30,'b1',limits).journal;
  for(const v of [41,42,43]) j=single(j,'c',v,limits).journal;
  const r=single(j,'c',44,limits);
  assert.equal(r.retired,1);
  noBatch(r.journal);
  assert.deepEqual(values(r.journal),[30,30,44]);
  assert.equal(moveFramePixelHistory(r.journal,'a','undo').status,'empty');
  assert.equal(moveFramePixelHistory(r.journal,'b','undo').status,'empty');
});

test('memory limit evicts whole earlier batches, rejects oversized single transaction without mutation',()=>{
  const limits={maxHistory:40,maxBatchBytes:20};
  const base=journal(frame('a',10),frame('b',10));
  const first=apply(base,10,30,'b1',limits);
  assert.equal(batchHistoryBytes(first.journal),16);
  const second=apply(first.journal,30,50,'b2',limits);
  assert.equal(second.retired,1);
  assert.equal(batchHistoryBytes(second.journal),16);
  let j=global(second.journal,'undo');
  assert.deepEqual(values(j),[30,30]);
  assert.equal(batchHistoryBytes(j),16); // redo is budgeted too
  assert.equal(moveFramePixelHistory(j,'a','undo').status,'empty');
  assert.equal(moveFramePixelHistory(j,'b','undo').status,'empty');
  const rejected=commitSequenceColors(base,mapping(10,30),ready,'oversized',{maxHistory:40,maxBatchBytes:15});
  assert.deepEqual(rejected,{ok:false,reason:'memory-budget'});
  assert.deepEqual(values(base),[10,10]);
  assert.equal(base.undo.length,0);
  assert.equal(MAX_BATCH_HISTORY_BYTES,64*1024*1024);
});

test('structural checkpoint keeps current pixels, drops applied and undone batches as indivisible units',()=>{
  let j=apply(journal(frame('a',10),frame('b',10)),10,30,'first').journal;
  j=apply(j,30,50,'second').journal;
  j=global(j,'undo');
  const r=retireBatchHistory(j);
  assert.equal(r.retired,2);
  noBatch(r.journal);
  assert.deepEqual(values(r.journal),[30,30]);
  for(const id of ['a','b']){
    assert.equal(moveFramePixelHistory(r.journal,id,'undo').status,'empty');
    assert.equal(moveFramePixelHistory(r.journal,id,'redo').status,'empty');
  }
  const changed={...r.journal,frames:r.journal.frames.map(f=>applyFrameConversion(f,result(99)))};
  assert.deepEqual(values(changed),[30,30]);
});

test('all special states, invalid mappings, and no-op operations fail without any mutation',()=>{
  const j=journal(frame('a',10),frame('b',10));
  for(const [flag,reason] of [['isPlaying','playing'],['isConversionPending','conversion-pending'],['isBatchProcessing','conversion-pending'],['hasPendingReconvert','pending-reconvert'],['hasPreview','preview-active']]){
    assert.equal(getBatchBlockReason(j.frames,{...ready,[flag]:true}),reason);
    assert.deepEqual(commitSequenceColors(j,mapping(10,30),{...ready,[flag]:true},'x'),{ok:false,reason});
  }
  const unconverted={...j,frames:[j.frames[0],{...j.frames[1],convertedResult:null}]};
  assert.deepEqual(commitSequenceColors(unconverted,mapping(10,30),ready,'x'),{ok:false,reason:'unconverted-frame'});
  assert.deepEqual(commitSequenceColors(j,new Map([[hex(10),'bad']]),ready,'x'),{ok:false,reason:'invalid-mapping'});
  assert.deepEqual(commitSequenceColors(j,new Map([[hex(10),hex(30)],['0A0000',hex(50)]]),ready,'x'),{ok:false,reason:'invalid-mapping'});
  assert.deepEqual(commitSequenceColors(j,mapping(99,30),ready,'x'),{ok:false,reason:'no-change'});
  assert.deepEqual(values(j),[10,10]);
  assert.equal(j.undo.length,0);
});

test('120-frame batch uses a single transaction and can undo/redo every changed frame',()=>{
  const j=journal(...Array.from({length:120},(_,i)=>frame(String(i),i%3?10:20)));
  const r=apply(j,10,30);
  assert.equal(r.transaction.changes.length,80);
  assert.equal(r.journal.undo.length,1);
  assert.deepEqual(values(global(r.journal,'undo')),values(j));
  assert.deepEqual(values(global(global(r.journal,'undo'),'redo')),values(r.journal));
});

test('120 full-size 256x256 frames stay within the 64 MiB retained batch budget',()=>{
  const w=256,h=256;
  const frames=Array.from({length:120},(_,i)=>{
    const data=new Uint8ClampedArray(w*h*4);
    for(let p=0;p<data.length;p+=4){data[p]=10;data[p+3]=255;}
    return {id:String(i),convertedResult:{imageData:new ImageData(data,w,h),width:w,height:h,palette:[hex(10)],uniqueColorCount:1,computeMs:0},editHistory:[],historyIndex:-1};
  });
  const initial=journal(...frames);
  const r=commitSequenceColors(initial,mapping(10,30),ready,'full-size');
  assert.equal(r.ok,true);
  assert.equal(r.changedPixels,120*w*h);
  assert.equal(r.transaction.bytes,60*1024*1024);
  assert.equal(batchHistoryBytes(r.journal),60*1024*1024);
  const undone=global(r.journal,'undo');
  for(let i=0;i<frames.length;i++) assert.strictEqual(getEffectiveFrameImageData(undone.frames[i]),frames[i].convertedResult.imageData);
  const redone=global(undone,'redo');
  for(let i=0;i<frames.length;i++) assert.strictEqual(getEffectiveFrameImageData(redone.frames[i]),r.transaction.changes[i].after);
});

test('multiple batches interleave with per-frame edits and remain one-step transactions',()=>{
  let j=apply(journal(frame('a',10),frame('b',10),frame('c',40)),10,20,'first').journal;
  j=single(j,'a',30).journal;
  const r=commitSequenceColors(j,new Map([[hex(20),hex(50)],[hex(30),hex(50)]]),ready,'second');
  assert.equal(r.ok,true);
  j=r.journal;
  assert.deepEqual(values(j),[50,50,40]);
  j=global(j,'undo');
  assert.deepEqual(values(j),[30,20,40]);
  j=global(j,'undo');
  assert.deepEqual(values(j),[20,20,40]);
  j=global(j,'undo');
  assert.deepEqual(values(j),[10,10,40]);
  j=global(j,'redo');
  j=global(j,'redo');
  j=global(j,'redo');
  assert.deepEqual(values(j),[50,50,40]);
});
