import { createDocumentColorPreview, normalizeDocumentHex } from './documentPalette';
import { appendFrameEdit, canRedoFrame, canUndoFrame, getEffectiveFrameImageData, getHistoryFloor, type FrameHistoryState } from './frameHistory';

export const MAX_BATCH_HISTORY_BYTES = 64 * 1024 * 1024;
export const MAX_PIXEL_HISTORY = 40;

export interface JournalFrame extends FrameHistoryState { id: string }
export interface SinglePixelEdit { type: 'pixel-edit'; frameId: string; after: ImageData }
export interface BatchFrameChange { frameId: string; before: ImageData; after: ImageData; beforeIsBaseline: boolean }
export interface BatchPixelEdit {
  type: 'batch-pixel-edit';
  transactionId: string;
  changes: readonly BatchFrameChange[];
  bytes: number;
}
export type PixelEdit = SinglePixelEdit | BatchPixelEdit;
export type HistoryEntry<T extends JournalFrame> = PixelEdit | {type:'delete-frame'; frame:T; index:number};
export interface HistoryJournal<T extends JournalFrame> {
  frames: T[];
  undo: HistoryEntry<T>[];
  redo: HistoryEntry<T>[];
}
export interface HistoryLimits { maxHistory: number; maxBatchBytes: number }
const defaults: HistoryLimits = {maxHistory:MAX_PIXEL_HISTORY,maxBatchBytes:MAX_BATCH_HISTORY_BYTES};

export interface BatchAvailability { isPlaying: boolean; isConversionPending: boolean; isBatchProcessing: boolean; hasPendingReconvert: boolean; hasPreview: boolean }
export type BatchBlockReason = 'not-animation'|'playing'|'conversion-pending'|'pending-reconvert'|'preview-active'|'unconverted-frame'|'invalid-mapping'|'no-change'|'memory-budget';
export function getBatchBlockReason(frames: readonly JournalFrame[], status: BatchAvailability): BatchBlockReason | null {
  if (frames.length < 2) return 'not-animation';
  if (status.isPlaying) return 'playing';
  if (status.isConversionPending || status.isBatchProcessing) return 'conversion-pending';
  if (status.hasPendingReconvert) return 'pending-reconvert';
  if (status.hasPreview) return 'preview-active';
  const ids = new Set<string>();
  for (const frame of frames) {
    const effective = getEffectiveFrameImageData(frame);
    if (ids.has(frame.id) || !effective || !frame.convertedResult ||
        effective.width !== frame.convertedResult.width || effective.height !== frame.convertedResult.height ||
        effective.data.length !== effective.width * effective.height * 4 ||
        (frame.historyIndex > 0 && effective !== frame.editHistory[frame.historyIndex])) return 'unconverted-frame';
    ids.add(frame.id);
  }
  return null;
}

export function batchHistoryBytes<T extends JournalFrame>(journal: HistoryJournal<T>): number {
  return [...journal.undo,...journal.redo].reduce((sum,e)=>sum+(e.type==='batch-pixel-edit'?e.bytes:0),0);
}

function batchEntries<T extends JournalFrame>(entries: readonly HistoryEntry<T>[]): BatchPixelEdit[] {
  return entries.filter((e): e is BatchPixelEdit => e.type==='batch-pixel-edit');
}
function afterIndex(frame: JournalFrame, after: ImageData): number {
  return frame.editHistory.indexOf(after,1);
}

/** Resolve exact adjacent snapshots, not mutable numeric indices. */
function batchBoundary(frame: JournalFrame, change: BatchFrameChange): number {
  const index=afterIndex(frame,change.after);
  if(index<=getHistoryFloor(frame)) return -1;
  if(change.beforeIsBaseline) {
    if(index!==1 || frame.convertedResult?.imageData!==change.before) return -1;
  } else if(frame.editHistory[index-1]!==change.before) return -1;
  return index;
}

/** Applied checkpoints are atomic barriers; retain newer local edits where possible.
 * Undone retired batches lose their entire redo branch on every affected frame.
 * No pixels are changed; baseline slot 0 retains the conversion semantics.
 */
export function retireBatchHistory<T extends JournalFrame>(
  journal: HistoryJournal<T>, retireApplied=true, retireRedo=true,
): {journal: HistoryJournal<T>; retired: number} {
  const applied=retireApplied?batchEntries(journal.undo):[];
  const undone=retireRedo?batchEntries(journal.redo):[];
  if(!applied.length&&!undone.length) return {journal,retired:0};
  const affected=new Set([...applied,...undone].flatMap(e=>e.changes.map(c=>c.frameId)));
  const frames=journal.frames.map(frame=>{
    if(!affected.has(frame.id)) return frame;
    let floor=getHistoryFloor(frame);
    let end=frame.editHistory.length;
    for(const entry of applied) for(const c of entry.changes) if(c.frameId===frame.id) {
      const index=afterIndex(frame,c.after);
      // Missing boundary is unsafe: checkpoint the current committed image.
      floor=Math.max(floor,index>0&&index<=frame.historyIndex?index:Math.max(0,frame.historyIndex));
    }
    for(const entry of undone) for(const c of entry.changes) if(c.frameId===frame.id) {
      const index=afterIndex(frame,c.after);
      end=Math.min(end,index>frame.historyIndex?index:Math.max(0,frame.historyIndex+1));
    }
    end=Math.max(end,frame.historyIndex+1);
    if(floor>0) {
      return {...frame,editHistory:[frame.editHistory[0],...frame.editHistory.slice(floor,end)],
        historyIndex:frame.historyIndex-floor+1,historyFloor:1};
    }
    return {...frame,editHistory:frame.editHistory.slice(0,end)};
  });
  const removed=new Set([...applied,...undone]);
  const byId=new Map(frames.map(f=>[f.id,f]));
  const keep=(e:HistoryEntry<T>)=>{
    if(e.type==='batch-pixel-edit') return !removed.has(e);
    if(e.type==='delete-frame'||!affected.has(e.frameId)) return true;
    const frame=byId.get(e.frameId);
    return !!frame && afterIndex(frame,e.after)>getHistoryFloor(frame);
  };
  return {journal:{frames,undo:journal.undo.filter(keep),redo:journal.redo.filter(keep)},retired:removed.size};
}

/** Before a new edit forks history, discard any undone batch as a whole.
 * Retire applied batches BEFORE a frame cap, journal cap or memory limit can
 * evict any one of their snapshots. This deliberately uses a conservative
 * checkpoint policy rather than retaining unbounded duplicate buffers.
 */
function prepareForEdit<T extends JournalFrame>(journal: HistoryJournal<T>, ids: ReadonlySet<string>,
  limits: HistoryLimits, extraBytes=0): {journal:HistoryJournal<T>;retired:number} {
  const dropped=retireBatchHistory(journal,false,true);
  let next=dropped.journal;
  let retired=dropped.retired;
  const batches=batchEntries(next.undo);
  const frameCap=next.frames.some(f=>{
    if(!ids.has(f.id)) return false;
    // appendFrameEdit preserves index 0 and removes the oldest manual slots.
    const removed=Math.max(0,f.historyIndex+2-Math.max(2,limits.maxHistory));
    if(!removed) return false;
    return batches.some(e=>e.changes.some(c=>{
      if(c.frameId!==f.id) return false;
      const index=batchBoundary(f,c);
      return index<1 || index<=removed || (!c.beforeIsBaseline && index-1<=removed);
    }));
  });
  const journalCap=next.undo.slice(0,Math.max(0,next.undo.length-limits.maxHistory+1)).some(e=>e.type==='batch-pixel-edit');
  if(batches.length&&(frameCap||journalCap||batchHistoryBytes(next)+extraBytes>limits.maxBatchBytes)) {
    const sealed=retireBatchHistory(next,true,false);
    next=sealed.journal; retired+=sealed.retired;
  }
  return {journal:{...next,redo:[]},retired};
}

function pruneMissingSingles<T extends JournalFrame>(journal:HistoryJournal<T>):HistoryJournal<T> {
  const byId=new Map(journal.frames.map(f=>[f.id,f]));
  const keep=(entry:HistoryEntry<T>)=>{
    if(entry.type!=='pixel-edit') return true;
    const f=byId.get(entry.frameId);
    // A deleted frame may be restored by the existing deletion journal.
    return !f || afterIndex(f,entry.after)>getHistoryFloor(f);
  };
  return {...journal,undo:journal.undo.filter(keep),redo:journal.redo.filter(keep)};
}

export function commitSinglePixelEdit<T extends JournalFrame>(journal:HistoryJournal<T>,frameId:string,
  next:ImageData,limits:HistoryLimits=defaults):{journal:HistoryJournal<T>;retired:number}|null {
  const frame=journal.frames.find(f=>f.id===frameId);
  if(!frame?.convertedResult||next.width!==frame.convertedResult.width||next.height!==frame.convertedResult.height) return null;
  const prepared=prepareForEdit(journal,new Set([frameId]),limits);
  let after:ImageData|undefined;
  const frames=prepared.journal.frames.map(f=>{
    if(f.id!==frameId) return f;
    const edited=appendFrameEdit(f,next,limits.maxHistory);
    after=edited.editHistory[edited.historyIndex];
    return edited;
  });
  if(!after) return null;
  const entry:SinglePixelEdit={type:'pixel-edit',frameId,after};
  return {journal:pruneMissingSingles({frames,undo:[...prepared.journal.undo,entry].slice(-limits.maxHistory),redo:[]}),retired:prepared.retired};
}

export type BatchCommitResult<T extends JournalFrame> =
  | {ok:false;reason:BatchBlockReason}
  | {ok:true;journal:HistoryJournal<T>;transaction:BatchPixelEdit;changedPixels:number;retired:number};

/** Prepare every changed frame before publishing any state. Reuse Phase 02
 * remapping and its alpha-preserving, simultaneous semantics.
 */
export function commitSequenceColors<T extends JournalFrame>(journal:HistoryJournal<T>, mapping:ReadonlyMap<string,string>,
  status:BatchAvailability,transactionId:string,limits:HistoryLimits=defaults):BatchCommitResult<T> {
  const reason=getBatchBlockReason(journal.frames,status);
  if(reason) return {ok:false,reason};
  const normalized=new Map<string,string>();
  for(const [from,to] of mapping) {
    const source=normalizeDocumentHex(from),target=normalizeDocumentHex(to);
    if(!source||!target||(normalized.has(source)&&normalized.get(source)!==target)) return {ok:false,reason:'invalid-mapping'};
    normalized.set(source,target);
  }
  if([...journal.undo,...journal.redo].some(e=>e.type==='batch-pixel-edit'&&e.transactionId===transactionId)) return {ok:false,reason:'invalid-mapping'};
  const candidates=new Map<string,ImageData>();
  let bytes=0,changedPixels=0;
  for(const frame of journal.frames) {
    const before=getEffectiveFrameImageData(frame)!;
    const preview=createDocumentColorPreview(before.data,normalized);
    if(!preview) continue;
    bytes+=before.data.byteLength+preview.data.byteLength;
    if(bytes>limits.maxBatchBytes) return {ok:false,reason:'memory-budget'};
    candidates.set(frame.id,new ImageData(new Uint8ClampedArray(preview.data),before.width,before.height));
    changedPixels+=preview.changed;
  }
  if(!candidates.size) return {ok:false,reason:'no-change'};
  const prepared=prepareForEdit(journal,new Set(candidates.keys()),limits,bytes);
  const changes:BatchFrameChange[]=[];
  const frames=prepared.journal.frames.map(f=>{
    const candidate=candidates.get(f.id);
    if(!candidate) return f;
    const before=getEffectiveFrameImageData(f)!;
    const edited=appendFrameEdit(f,candidate,limits.maxHistory);
    // If the old manual position would be lost, keep it immediately before
    // the new batch; the earlier entries have already been retired as needed.
    changes.push({frameId:f.id,before,after:edited.editHistory[edited.historyIndex],beforeIsBaseline:f.historyIndex<=0});
    return edited;
  });
  const transaction:BatchPixelEdit={type:'batch-pixel-edit',transactionId,changes,bytes};
  // The normal 40-slot limit retains both adjacent snapshots (cap >= 3).
  // Do not publish even one frame if a malformed/too-small limit breaks this.
  if(changes.some(c=>batchBoundary(frames.find(f=>f.id===c.frameId)!,c)<1)) return {ok:false,reason:'memory-budget'};
  return {ok:true,journal:pruneMissingSingles({frames,undo:[...prepared.journal.undo,transaction].slice(-limits.maxHistory),redo:[]}),transaction,changedPixels,retired:prepared.retired};
}

export type HistoryDirection='undo'|'redo';
export type MoveResult<T extends JournalFrame>={status:'applied';journal:HistoryJournal<T>;frameIds:string[]}|{status:'blocked'|'stale'|'empty'};

/** Entire transaction validates first; no participant or stack is changed on
 * missing frames, trimmed snapshots, or newer edits blocking the boundary.
 */
export function movePixelEntry<T extends JournalFrame>(journal:HistoryJournal<T>,entry:PixelEdit,direction:HistoryDirection):MoveResult<T> {
  const stack=journal[direction];
  const position=stack.lastIndexOf(entry);
  if(position<0) return {status:'stale'};
  const targets=new Map<string,number>();
  const changes=entry.type==='batch-pixel-edit'?entry.changes:[entry];
  for(const c of changes) {
    const f=journal.frames.find(f=>f.id===c.frameId);
    if(!f||targets.has(c.frameId)) return {status:entry.type==='batch-pixel-edit'?'blocked':'stale'};
    const index='before' in c?batchBoundary(f,c):afterIndex(f,c.after);
    if(index<=getHistoryFloor(f)) return {status:entry.type==='batch-pixel-edit'?'blocked':'stale'};
    if(f.historyIndex!==(direction==='undo'?index:index-1)) return {status:'blocked'};
    targets.set(f.id,direction==='undo'?index-1:index);
  }
  const other=direction==='undo'?'redo':'undo';
  const next={...journal,frames:journal.frames.map(f=>targets.has(f.id)?{...f,historyIndex:targets.get(f.id)!}:f),
    [direction]:stack.filter((_,i)=>i!==position),[other]:[...journal[other],entry]};
  return {status:'applied',journal:next,frameIds:[...targets.keys()]};
}

export function moveFramePixelHistory<T extends JournalFrame>(journal:HistoryJournal<T>,frameId:string,direction:HistoryDirection):MoveResult<T> {
  const f=journal.frames.find(f=>f.id===frameId);
  if(!f||!(direction==='undo'?canUndoFrame(f):canRedoFrame(f))) return {status:'empty'};
  const after=f.editHistory[direction==='undo'?f.historyIndex:f.historyIndex+1];
  const matches=(entry:HistoryEntry<T>)=>entry.type==='pixel-edit'?entry.frameId===frameId&&entry.after===after:
    entry.type==='batch-pixel-edit'&&entry.changes.some(c=>c.frameId===frameId&&c.after===after);
  const entry=[...journal[direction]].reverse().find(matches);
  if(entry&&entry.type!=='delete-frame') return movePixelEntry(journal,entry,direction);
  // Restored workspaces and legacy entries can have a local history with no
  // journal entry. Never use the fallback to cross a known batch boundary.
  if([...journal.undo,...journal.redo].some(e=>e.type==='batch-pixel-edit'&&matches(e))) return {status:'blocked'};
  return {status:'applied',journal:{...journal,frames:journal.frames.map(x=>x.id===frameId?{...x,historyIndex:x.historyIndex+(direction==='undo'?-1:1)}:x)},frameIds:[frameId]};
}

export function canMoveFramePixelHistory<T extends JournalFrame>(journal:HistoryJournal<T>,frameId:string,direction:HistoryDirection):boolean {
  return moveFramePixelHistory(journal,frameId,direction).status==='applied';
}
