import React, { useEffect, useMemo, useRef, useState } from 'react';
import { selectCanvasSourceColor, type CanvasSourcePickMode, type CanvasSourcePickEvent } from '../lib/canvasSourcePick';
import { Check, Copy, Pipette, Undo2, Redo2 } from 'lucide-react';
import { useI18n, type TranslationKey } from '../i18n';
import { collectDocumentColors, normalizeDocumentHex } from '../lib/documentPalette';
import { buildPaletteMergePlan, getPaletteMergeGroups, createAutoMergeMapping, createManualMergeMapping, paletteMergeGroupId, MAX_AUTO_MERGE_COLORS } from '../lib/paletteMerge';
import { ColorPicker } from './ColorPicker';
import { getSequenceMappingStats, type SequencePalette } from '../lib/sequencePalette';
import { MAX_BATCH_HISTORY_BYTES, type BatchBlockReason } from '../lib/batchHistory';

interface Props {
  imageData: ImageData;
  sequencePalette: SequencePalette | null;
  sequenceFrameNames: {id:string;name:string;index:number}[];
  sequenceBlockReason: BatchBlockReason | null;
  onApplySequenceColors: (mapping: ReadonlyMap<string,string>) => BatchBlockReason | null;
  disabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onReplaceColor: (source: string, target: string) => boolean;
  onApplyColors: (mapping: ReadonlyMap<string,string>) => boolean;
  canvasSourcePickMode: CanvasSourcePickMode | null;
  canvasPickEvent: CanvasSourcePickEvent | null;
  onConsumeCanvasPickEvent: (event:CanvasSourcePickEvent)=>void;
  onStartCanvasSourcePick: (mode:CanvasSourcePickMode)=>void;
  onStopCanvasSourcePick: ()=>void;
  onFinishCanvasSourcePick: ()=>void;
  canvasSourcePickDisabled: boolean;
  previewActive: boolean;
  draftResetVersion: number;
  previewDisabled: boolean;
  onPreviewColors: (mapping: ReadonlyMap<string, string>) => void;
  onCancelPreview: () => void;
  onPickColor: (hex: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

const PAGE_SIZE = 64;
type Mode = 'single'|'manual'|'auto';
const MODES: {id:Mode; label:TranslationKey}[] = [
  {id:'single',label:'documentPalette.singleMode'},
  {id:'manual',label:'documentPalette.manualMode'},
  {id:'auto',label:'documentPalette.autoMode'},
];
const secondary = 'w-full rounded border border-[#2A3142] px-2 py-1 text-xs text-[#CBD5E1] disabled:opacity-40';
const primary = 'w-full rounded bg-sky-600 hover:bg-sky-500 text-white py-1.5 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed';

export function DocumentPalette({ imageData, sequencePalette, sequenceFrameNames, sequenceBlockReason, onApplySequenceColors, disabled, canUndo, canRedo, onReplaceColor, onApplyColors, canvasSourcePickMode, canvasPickEvent, onConsumeCanvasPickEvent, onStartCanvasSourcePick, onStopCanvasSourcePick, onFinishCanvasSourcePick, canvasSourcePickDisabled, previewActive, draftResetVersion, previewDisabled, onPreviewColors, onCancelPreview, onPickColor, onUndo, onRedo }: Props) {
  const { t } = useI18n();
  const isSequence = sequencePalette !== null;
  const colors = useMemo(() => sequencePalette?.colors ?? collectDocumentColors(imageData.data), [sequencePalette, imageData]);
  const sequenceColors = useMemo(() => new Map(sequencePalette?.colors.map(c=>[c.hex,c]) ?? []), [sequencePalette]);
  const frameNames = useMemo(()=>new Map(sequenceFrameNames.map(f=>[f.id,f])),[sequenceFrameNames]);
  const paletteIdentity = sequencePalette ?? imageData;
  const colorSet = useMemo(()=>new Set(colors.map(c=>c.hex)),[colors]);
  const [mode, setMode] = useState<Mode>('single');
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [chooseTarget, setChooseTarget] = useState(false);
  const [livePreview, setLivePreview] = useState(true);
  const [tolerance, setTolerance] = useState(0);
  const [overrides, setOverrides] = useState<ReadonlyMap<string,string>>(new Map());
  const [copyStatus, setCopyStatus] = useState<{hex:string;ok:boolean}|null>(null);
  const [lastImage, setLastImage] = useState(paletteIdentity);
  const [batchError, setBatchError] = useState<BatchBlockReason | null>(null);
  const [detailHex, setDetailHex] = useState<string | null>(null);
  const [revealHex,setRevealHex] = useState<string|null>(null);
  const paletteRootRef = useRef<HTMLDivElement>(null);
  const lastPickEvent = useRef<CanvasSourcePickEvent|null>(null);
  const [lastDraftResetVersion, setLastDraftResetVersion] = useState(draftResetVersion);

  // Reset transaction-local choices after external committed-image changes.
  // Keep only still-valid source selections; never re-preview automatically.
  if (lastDraftResetVersion !== draftResetVersion) {
    // Undo/Escape/canvas cancellation consumes the entire transient transaction.
    // Preserve the current mode, search, pagination and live-preview preference.
    setLastDraftResetVersion(draftResetVersion);
    setLastImage(paletteIdentity);
    setSelected([]);
    setDraft('');
    setChooseTarget(false);
    setTolerance(0);
    setOverrides(new Map());
    setCopyStatus(null);
    setBatchError(null);
    setDetailHex(null);
    setRevealHex(null);
  } else if (lastImage !== paletteIdentity) {
    setLastImage(paletteIdentity);
    setBatchError(null);
    setDetailHex(null);
    setRevealHex(null);
    setSelected(prev=>prev.filter(c=>colorSet.has(c)));
    setChooseTarget(false);
    setOverrides(new Map());
    setTolerance(0);
    setCopyStatus(null);
    setDraft(()=>mode==='single' && selected.length===1 && colorSet.has(selected[0]) ? selected[0] : '');
  }

  const activeSelected = selected.filter(c=>colorSet.has(c));
  const source = mode==='single' ? activeSelected[0] : undefined;
  const target = normalizeDocumentHex(draft);
  const filtered = useMemo(() => colors.filter(c => c.hex.includes(search.trim().toLowerCase())), [colors, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const plan = useMemo(()=>mode==='auto' ? buildPaletteMergePlan(colors) : null,[mode,colors]);
  const groups = useMemo(()=>plan ? getPaletteMergeGroups(plan,tolerance/1000) : [],[plan,tolerance]);
  const mergedGroups = groups.filter(g=>g.colors.length>1);
  const manualMapping = (sources:readonly string[], value:string, currentMode:Mode=mode) =>
    sources.length >= (currentMode==='manual'?2:1) ? createManualMergeMapping(sources,value) : new Map<string,string>();
  const mapping = mode==='auto' ? createAutoMergeMapping(groups,overrides) : manualMapping(activeSelected,draft);
  const sequenceStats = useMemo(()=>sequencePalette ? getSequenceMappingStats(sequencePalette,mapping) : null,[sequencePalette,mapping]);
  const overBudget = !!sequenceStats && sequenceStats.bytes > MAX_BATCH_HISTORY_BYTES;
  const canApply = !disabled && !canvasSourcePickMode && mapping.size>0 && !overBudget && (!sequenceStats || sequenceStats.changedPixels > 0);
  const detail = detailHex ? sequenceColors.get(detailHex) : undefined;
  const stats = useMemo(()=>{
    let changed=0;
    const after=new Set<string>();
    for(const c of colors) {
      const next=mapping.get(c.hex) ?? c.hex;
      after.add(next);
      if(next!==c.hex) changed+=c.count;
    }
    return {after:after.size,changed};
  },[colors,mapping]);

  const showPreview = (next:ReadonlyMap<string,string>, enabled=livePreview) => {
    setBatchError(null);
    if(enabled && !canvasSourcePickMode && !previewDisabled && !disabled && next.size) onPreviewColors(next);
    else onCancelPreview();
  };
  useEffect(() => {
    if (!canvasPickEvent || lastPickEvent.current === canvasPickEvent) return;
    lastPickEvent.current = canvasPickEvent;
    if (canvasPickEvent.type === 'finish') {
      showPreview(mapping);
    } else if (!disabled && mode === canvasPickEvent.mode && colorSet.has(canvasPickEvent.hex)) {
      const hex = canvasPickEvent.hex;
      const next = selectCanvasSourceColor(mode,activeSelected,draft,hex);
      setSelected(next.selected);
      setDraft(next.draft);
      setSearch('');
      setPage(Math.floor(colors.findIndex(c=>c.hex===hex)/PAGE_SIZE));
      setChooseTarget(false);
      setCopyStatus(null);
      setBatchError(null);
      if (isSequence) setDetailHex(hex);
      setRevealHex(hex);
    }
    onConsumeCanvasPickEvent(canvasPickEvent);
  }, [canvasPickEvent, disabled, mode, colorSet, activeSelected, draft, colors, isSequence, mapping, onConsumeCanvasPickEvent]);

  useEffect(() => {
    if (!revealHex) return;
    // Do not pull a phone user away from the canvas mid multi-pick.
    if (canvasSourcePickMode && window.matchMedia('(max-width: 767px)').matches) return;
    paletteRootRef.current?.querySelector('[data-palette-hex="'+revealHex+'"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
    setRevealHex(null);
  }, [revealHex,currentPage,canvasSourcePickMode]);

  const updateDraft = (value:string) => {
    setDraft(value);
    setChooseTarget(false);
    showPreview(manualMapping(activeSelected,value));
  };
  const switchMode = (next:Mode) => {
    if(next===mode) return;
    onStopCanvasSourcePick();
    onCancelPreview();
    setMode(next);
    setSelected([]);
    setDraft('');
    setChooseTarget(false);
    setTolerance(0);
    setOverrides(new Map());
    setCopyStatus(null);
  };
  const selectSwatch = (hex:string) => {
    setCopyStatus(null);
    if(chooseTarget && activeSelected.length>0) {
      updateDraft(hex);
      return;
    }
    if(mode==='single') {
      onCancelPreview();
      setSelected([hex]);
      setDraft(hex);
      setChooseTarget(false);
    } else if(mode==='manual') {
      const next=activeSelected.includes(hex) ? activeSelected.filter(c=>c!==hex) : [...activeSelected,hex];
      const nextDraft=next.length===0 ? '' : activeSelected.length===0 ? hex : draft;
      setSelected(next);
      setDraft(nextDraft);
      showPreview(manualMapping(next,nextDraft));
    }
  };
  const updateTolerance = (value:number) => {
    setTolerance(value);
    setOverrides(new Map());
    showPreview(plan ? createAutoMergeMapping(getPaletteMergeGroups(plan,value/1000)) : new Map());
  };
  const updateRepresentative = (id:string,hex:string) => {
    const next=new Map(overrides);
    next.set(id,hex);
    setOverrides(next);
    showPreview(createAutoMergeMapping(groups,next));
  };
  const cancel = () => {
    onStopCanvasSourcePick();
    onCancelPreview();
    setBatchError(null);
    setDetailHex(null);
    setRevealHex(null);
    setChooseTarget(false);
    setOverrides(new Map());
    setTolerance(0);
    if(mode==='single') setDraft(source ?? '');
    else { setSelected([]); setDraft(''); }
  };
  const apply = () => {
    if(!canApply) return;
    if (isSequence) {
      const reason = onApplySequenceColors(mapping);
      setBatchError(reason);
      if (reason) return;
    } else {
      const ok=mode==='single' && source && target
        ? onReplaceColor(source,target)
        : onApplyColors(mapping);
      if(!ok) return;
    }
    onCancelPreview();
    setSelected(mode==='single' && target ? [target] : []);
    setDraft(mode==='single' && target ? target : '');
    setChooseTarget(false);
    setTolerance(0);
    setOverrides(new Map());
    setCopyStatus(null);
  };
  const copy = async () => {
    if(!source) return;
    try {await navigator.clipboard.writeText(source);setCopyStatus({hex:source,ok:true});}
    catch {setCopyStatus({hex:source,ok:false});}
  };

  return (
    <div ref={paletteRootRef} className="pt-2 space-y-2 border-t border-[#252B39]">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-[#E2E8F0]">{t(isSequence?'sequencePalette.title':'documentPalette.title')} ({colors.length})</h3>
        <div className="flex gap-1">
          <button type="button" title={t('documentPalette.undo')} aria-label={t('documentPalette.undo')} disabled={!canUndo || (!isSequence && disabled)} onClick={onUndo} className="p-1 rounded hover:bg-[#252B39] disabled:opacity-30"><Undo2 size={14}/></button>
          <button type="button" title={t('documentPalette.redo')} aria-label={t('documentPalette.redo')} disabled={!canRedo || (!isSequence && disabled)} onClick={onRedo} className="p-1 rounded hover:bg-[#252B39] disabled:opacity-30"><Redo2 size={14}/></button>
        </div>
      </div>
      {sequencePalette && <div className="space-y-1 text-[11px] text-[#94A3B8]">
        <p>{t('sequencePalette.coverage',{converted:sequencePalette.convertedCount,total:sequencePalette.frameCount})}</p>
        <p>{t('sequencePalette.historyHint')}</p>
        {sequenceBlockReason && <p role="status" className="text-amber-300">{t(`sequencePalette.block.${sequenceBlockReason}`)}</p>}
      </div>}
      <div className="flex rounded border border-[#2A3142] overflow-hidden">
        {MODES.map(m=><button key={m.id} type="button" disabled={disabled} aria-pressed={mode===m.id} onClick={()=>switchMode(m.id)} className={'flex-1 px-1 py-1.5 text-[11px] disabled:opacity-40 '+(mode===m.id?'bg-sky-500/20 text-sky-200':'text-[#94A3B8]')}>{t(m.label)}</button>)}
      </div>
      <p className="text-[11px] text-[#94A3B8]">{t(mode==='single'?(isSequence?'sequencePalette.singleHint':'documentPalette.hint'):mode==='manual'?'documentPalette.manualHint':'documentPalette.autoHint')}</p>

      {mode!=='auto' && <>
        <button type="button" aria-pressed={!!canvasSourcePickMode}
          disabled={disabled || canvasSourcePickDisabled}
          onClick={()=>{if(canvasSourcePickMode) onFinishCanvasSourcePick(); else {setChooseTarget(false);onStartCanvasSourcePick(mode);}}}
          className={secondary+' flex items-center justify-center gap-1 '+(canvasSourcePickMode?'border-sky-400 text-sky-300':'')}>
          <Pipette size={14}/>{t(canvasSourcePickMode?'documentPalette.canvasPickDone':'documentPalette.canvasPick')}
        </button>
        {(colors.length>PAGE_SIZE || search.length>0) && <input aria-label={t('documentPalette.search')} placeholder={t('documentPalette.search')} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} className="w-full bg-[#0D1017] rounded border border-[#2A3142] px-2 py-1 text-xs font-mono"/>}
        {chooseTarget && <p className="text-[11px] text-sky-300">{t('documentPalette.chooseTargetHint')}</p>}
        {isSequence ? <div className="space-y-1 max-h-64 overflow-y-auto studio-scroll">
          {visible.map(c=>{
            const color = sequenceColors.get(c.hex)!;
            return <div key={c.hex} className="flex items-center gap-1">
              <button type="button" data-palette-hex={c.hex} disabled={disabled} aria-pressed={activeSelected.includes(c.hex)}
                onClick={()=>{selectSwatch(c.hex);setDetailHex(c.hex);}}
                className={'flex-1 min-w-0 flex items-center gap-2 rounded px-1 py-1 text-[11px] border '+(activeSelected.includes(c.hex)?'border-sky-400 bg-sky-500/10':'border-transparent hover:bg-[#252B39]')}>
                <span className="w-5 h-5 shrink-0 rounded border border-white/20" style={{backgroundColor:c.hex}}/>
                <span className="font-mono">{c.hex}</span>
                <span className="ml-auto tabular-nums">{c.count}</span>
                <span className="text-[#94A3B8] tabular-nums">{color.frameCount}/{sequencePalette!.frameCount}</span>
              </button>
              <button type="button" aria-label={t('sequencePalette.showFrames',{hex:c.hex})} title={t('sequencePalette.showFrames',{hex:c.hex})}
                aria-expanded={detailHex===c.hex} onClick={()=>setDetailHex(prev=>prev===c.hex?null:c.hex)}
                className="text-sky-300 px-1 text-xs">ⓘ</button>
            </div>;
          })}
        </div> : <div className="grid grid-cols-8 gap-1">
          {visible.map(c=><button key={c.hex} type="button" data-palette-hex={c.hex} disabled={disabled} aria-label={c.hex+' ('+c.count+' '+t('documentPalette.pixels')+')'} aria-pressed={activeSelected.includes(c.hex)} title={c.hex+' · '+c.count+' '+t('documentPalette.pixels')} onClick={()=>selectSwatch(c.hex)} className={'h-6 rounded border cursor-pointer disabled:opacity-40 '+(activeSelected.includes(c.hex)?'ring-2 ring-sky-400 border-white':'border-white/15 hover:border-white')} style={{backgroundColor:c.hex}}/>)}
        </div>}
        {detail && <div className="rounded border border-[#2A3142] p-2 text-[11px] space-y-1">
          <p className="font-mono">{detail.hex} · {t('sequencePalette.colorFrames',{count:detail.frameCount,total:sequencePalette!.frameCount})}</p>
          <div className="max-h-24 overflow-y-auto studio-scroll text-[#94A3B8]">
            {detail.frameIds.map(id=>frameNames.get(id)).filter(Boolean).sort((a,b)=>a!.index-b!.index).map(f=><div key={f!.id} className="truncate" title={f!.name}>{f!.index}. {f!.name}</div>)}
          </div>
        </div>}
        {visible.length===0 && <p className="text-xs text-[#94A3B8]">{t('documentPalette.empty')}</p>}
        {pageCount>1 && <div className="flex items-center justify-between text-xs">
          <button type="button" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)} className="disabled:opacity-30">{t('documentPalette.prev')}</button>
          <span>{currentPage+1} / {pageCount}</span>
          <button type="button" disabled={currentPage+1>=pageCount} onClick={()=>setPage(currentPage+1)} className="disabled:opacity-30">{t('documentPalette.next')}</button>
        </div>}
        {mode==='manual' && <div className="flex justify-between items-center text-xs">
          <span>{t('documentPalette.selectedCount',{count:activeSelected.length})}</span>
          <button type="button" disabled={!activeSelected.length || disabled} onClick={cancel} className="text-sky-300 disabled:opacity-40">{t('documentPalette.clearSelection')}</button>
        </div>}
        {activeSelected.length>0 && <div className="space-y-2 bg-[#0D1017] rounded border border-[#2A3142] p-2">
          {source && <div className="flex items-center gap-2 text-xs">
            <span className="text-[#94A3B8]">{t('documentPalette.source')}</span>
            <span className="w-5 h-5 rounded border border-white/20" style={{backgroundColor:source}}/>
            <span className="font-mono select-all">{source}</span>
            <button type="button" title={t('documentPalette.copy')} aria-label={t('documentPalette.copy')} onClick={copy} className="ml-auto p-1 hover:text-sky-300">{copyStatus && copyStatus.hex===source && copyStatus.ok?<Check size={14}/>:<Copy size={14}/>}</button>
            <button type="button" title={t('documentPalette.brush')} aria-label={t('documentPalette.brush')} disabled={disabled} onClick={()=>onPickColor(source)} className="p-1 hover:text-sky-300 disabled:opacity-30"><Pipette size={14}/></button>
          </div>}
          {source && copyStatus && copyStatus.hex===source && <p role="status" className="text-[11px] text-[#94A3B8]">{t(copyStatus.ok?'documentPalette.copied':'documentPalette.failed')}</p>}
          <p className="text-xs text-[#CBD5E1]">{t('documentPalette.target')}</p>
          <ColorPicker key={mode} value={draft} onChange={updateDraft} onEnter={apply} disabled={disabled}/>
          <button type="button" disabled={disabled || !!canvasSourcePickMode} aria-pressed={chooseTarget} onClick={()=>setChooseTarget(v=>!v)} className={secondary+(chooseTarget?' ring-1 ring-sky-400':'')}>{t('documentPalette.existing')}</button>
        </div>}
      </>}

      {mode==='auto' && (!plan
        ? <p className="text-xs text-amber-200">{t('documentPalette.autoLimit',{max:MAX_AUTO_MERGE_COLORS})}</p>
        : <>
          <label className="block text-xs text-[#CBD5E1]">
            <span className="flex justify-between gap-2"><span>{t('documentPalette.tolerance')}</span><span className="font-mono text-sky-300">{(tolerance/1000).toFixed(3)}</span></span>
            <input type="range" min={0} max={300} step={5} value={tolerance} disabled={disabled} onChange={e=>updateTolerance(Number(e.target.value))} className="w-full studio-slider"/>
          </label>
          {mergedGroups.length===0 ? <p className="text-xs text-[#94A3B8]">{t('documentPalette.autoNoGroups')}</p> : <>
            <p className="text-[11px] text-[#94A3B8]">{t('documentPalette.autoOverrideHint')}</p>
            <div className="max-h-64 overflow-y-auto studio-scroll space-y-2">
              {mergedGroups.map(g=>{
                const id=paletteMergeGroupId(g);
                const rep=overrides.get(id) ?? g.representative;
                return <div key={id} className="space-y-1 rounded border border-[#2A3142] p-2">
                  <span className="text-[11px] text-[#94A3B8]">{t('documentPalette.groupCount',{count:g.colors.length})}</span>
                  <div className="flex flex-wrap gap-1">
                    {g.colors.map(c=><span key={c.hex} title={c.hex+' · '+c.count} className={'w-4 h-4 rounded border '+(rep===c.hex?'ring-2 ring-sky-400 border-white':'border-white/15')} style={{backgroundColor:c.hex}}/>)}
                  </div>
                  <label className="flex items-center gap-2 text-[11px]">
                    <span>{t('documentPalette.representative')}</span>
                    <span className="w-4 h-4 rounded border border-white/20 shrink-0" style={{backgroundColor:rep}}/>
                    <select value={rep} onChange={e=>updateRepresentative(id,e.target.value)} disabled={disabled} className="min-w-0 flex-1 bg-[#161A23] border border-[#2A3142] rounded font-mono text-xs">
                      {g.colors.map(c=><option key={c.hex} value={c.hex}>{c.hex} ({c.count})</option>)}
                    </select>
                  </label>
                </div>;
              })}
            </div>
          </>}
        </>)}

      {(mode==='auto' ? !!plan : activeSelected.length>0) && <>
        {mapping.size>0 && <div className="text-[11px] text-sky-300 space-y-1">
          <p>{t('documentPalette.resultCount',{before:colors.length,after:stats.after})}</p>
          <p>{t('documentPalette.changedPixels',{count:stats.changed})}</p>
          {sequenceStats && <p>{t('sequencePalette.affectedFrames',{count:sequenceStats.affectedFrameIds.length,total:sequencePalette!.frameCount})}</p>}
          {sequenceStats && <p>{t('sequencePalette.memory',{mib:(sequenceStats.bytes/1024/1024).toFixed(2)})}</p>}
        </div>}
        {overBudget && <p role="status" className="text-xs text-amber-300">{t('sequencePalette.block.memory-budget')}</p>}
        {batchError && <p role="alert" className="text-xs text-amber-300">{t(`sequencePalette.block.${batchError}`)}</p>}
        <label className="flex items-center gap-2 text-xs text-[#CBD5E1]">
          <input type="checkbox" checked={livePreview && !previewDisabled} disabled={disabled || previewDisabled || !!canvasSourcePickMode} onChange={e=>{setLivePreview(e.target.checked);showPreview(mapping,e.target.checked);}}/>
          {t('documentPalette.livePreview')}
        </label>
        <button type="button" disabled={!canApply} onClick={apply} className={primary}>{t(isSequence?'sequencePalette.applyAll':mode==='single'?'documentPalette.apply':'documentPalette.mergeApply')}</button>
        <button type="button" disabled={disabled && !previewActive} onClick={cancel} className={secondary}>{t('documentPalette.cancelEdit')}</button>
      </>}
    </div>
  );
}
