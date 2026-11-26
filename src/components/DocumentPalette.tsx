import React, { useMemo, useState } from 'react';
import { Check, Copy, Pipette, Undo2, Redo2 } from 'lucide-react';
import { useI18n, type TranslationKey } from '../i18n';
import { collectDocumentColors, normalizeDocumentHex } from '../lib/documentPalette';
import { buildPaletteMergePlan, getPaletteMergeGroups, createAutoMergeMapping, createManualMergeMapping, paletteMergeGroupId, MAX_AUTO_MERGE_COLORS } from '../lib/paletteMerge';
import { ColorPicker } from './ColorPicker';

interface Props {
  imageData: ImageData;
  disabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onReplaceColor: (source: string, target: string) => boolean;
  onApplyColors: (mapping: ReadonlyMap<string,string>) => boolean;
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

export function DocumentPalette({ imageData, disabled, canUndo, canRedo, onReplaceColor, onApplyColors, previewActive, draftResetVersion, previewDisabled, onPreviewColors, onCancelPreview, onPickColor, onUndo, onRedo }: Props) {
  const { t } = useI18n();
  const colors = useMemo(() => collectDocumentColors(imageData.data), [imageData]);
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
  const [lastImage, setLastImage] = useState(imageData);
  const [lastDraftResetVersion, setLastDraftResetVersion] = useState(draftResetVersion);

  // Reset transaction-local choices after external committed-image changes.
  // Keep only still-valid source selections; never re-preview automatically.
  if (lastDraftResetVersion !== draftResetVersion) {
    // Undo/Escape/canvas cancellation consumes the entire transient transaction.
    // Preserve the current mode, search, pagination and live-preview preference.
    setLastDraftResetVersion(draftResetVersion);
    setLastImage(imageData);
    setSelected([]);
    setDraft('');
    setChooseTarget(false);
    setTolerance(0);
    setOverrides(new Map());
    setCopyStatus(null);
  } else if (lastImage !== imageData) {
    setLastImage(imageData);
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
  const canApply = !disabled && mapping.size>0;
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
    if(enabled && !previewDisabled && !disabled && next.size) onPreviewColors(next);
    else onCancelPreview();
  };
  const updateDraft = (value:string) => {
    setDraft(value);
    setChooseTarget(false);
    showPreview(manualMapping(activeSelected,value));
  };
  const switchMode = (next:Mode) => {
    if(next===mode) return;
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
    onCancelPreview();
    setChooseTarget(false);
    setOverrides(new Map());
    setTolerance(0);
    if(mode==='single') setDraft(source ?? '');
    else { setSelected([]); setDraft(''); }
  };
  const apply = () => {
    if(!canApply) return;
    const ok=mode==='single' && source && target
      ? onReplaceColor(source,target)
      : onApplyColors(mapping);
    if(!ok) return;
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
    <div className="pt-2 space-y-2 border-t border-[#252B39]">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-[#E2E8F0]">{t('documentPalette.title')} ({colors.length})</h3>
        <div className="flex gap-1">
          <button type="button" title={t('documentPalette.undo')} aria-label={t('documentPalette.undo')} disabled={disabled || !canUndo} onClick={onUndo} className="p-1 rounded hover:bg-[#252B39] disabled:opacity-30"><Undo2 size={14}/></button>
          <button type="button" title={t('documentPalette.redo')} aria-label={t('documentPalette.redo')} disabled={disabled || !canRedo} onClick={onRedo} className="p-1 rounded hover:bg-[#252B39] disabled:opacity-30"><Redo2 size={14}/></button>
        </div>
      </div>
      <div className="flex rounded border border-[#2A3142] overflow-hidden">
        {MODES.map(m=><button key={m.id} type="button" disabled={disabled} aria-pressed={mode===m.id} onClick={()=>switchMode(m.id)} className={'flex-1 px-1 py-1.5 text-[11px] disabled:opacity-40 '+(mode===m.id?'bg-sky-500/20 text-sky-200':'text-[#94A3B8]')}>{t(m.label)}</button>)}
      </div>
      <p className="text-[11px] text-[#94A3B8]">{t(mode==='single'?'documentPalette.hint':mode==='manual'?'documentPalette.manualHint':'documentPalette.autoHint')}</p>

      {mode!=='auto' && <>
        {colors.length>PAGE_SIZE && <input aria-label={t('documentPalette.search')} placeholder={t('documentPalette.search')} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} className="w-full bg-[#0D1017] rounded border border-[#2A3142] px-2 py-1 text-xs font-mono"/>}
        {chooseTarget && <p className="text-[11px] text-sky-300">{t('documentPalette.chooseTargetHint')}</p>}
        <div className="grid grid-cols-8 gap-1">
          {visible.map(c=><button key={c.hex} type="button" disabled={disabled} aria-label={c.hex+' ('+c.count+' '+t('documentPalette.pixels')+')'} aria-pressed={activeSelected.includes(c.hex)} title={c.hex+' · '+c.count+' '+t('documentPalette.pixels')} onClick={()=>selectSwatch(c.hex)} className={'h-6 rounded border cursor-pointer disabled:opacity-40 '+(activeSelected.includes(c.hex)?'ring-2 ring-sky-400 border-white':'border-white/15 hover:border-white')} style={{backgroundColor:c.hex}}/>)}
        </div>
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
          <button type="button" disabled={disabled} aria-pressed={chooseTarget} onClick={()=>setChooseTarget(v=>!v)} className={secondary+(chooseTarget?' ring-1 ring-sky-400':'')}>{t('documentPalette.existing')}</button>
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
        </div>}
        <label className="flex items-center gap-2 text-xs text-[#CBD5E1]">
          <input type="checkbox" checked={livePreview && !previewDisabled} disabled={disabled || previewDisabled} onChange={e=>{setLivePreview(e.target.checked);showPreview(mapping,e.target.checked);}}/>
          {t('documentPalette.livePreview')}
        </label>
        <button type="button" disabled={!canApply} onClick={apply} className={primary}>{t(mode==='single'?'documentPalette.apply':'documentPalette.mergeApply')}</button>
        <button type="button" disabled={disabled && !previewActive} onClick={cancel} className={secondary}>{t('documentPalette.cancelEdit')}</button>
      </>}
    </div>
  );
}
