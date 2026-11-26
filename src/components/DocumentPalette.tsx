import React, { useMemo, useState } from 'react';
import { Check, Copy, Pipette, Undo2, Redo2 } from 'lucide-react';
import { useI18n } from '../i18n';
import { collectDocumentColors, normalizeDocumentHex } from '../lib/documentPalette';

interface Props {
  imageData: ImageData;
  disabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onReplaceColor: (source: string, target: string) => boolean;
  previewActive: boolean;
  previewDisabled: boolean;
  onPreviewColors: (mapping: ReadonlyMap<string, string>) => void;
  onCancelPreview: () => void;
  onPickColor: (hex: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

const PAGE_SIZE = 64;

export function DocumentPalette({ imageData, disabled, canUndo, canRedo, onReplaceColor, previewActive, previewDisabled, onPreviewColors, onCancelPreview, onPickColor, onUndo, onRedo }: Props) {
  const { t } = useI18n();
  const colors = useMemo(() => collectDocumentColors(imageData.data), [imageData]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [chooseTarget, setChooseTarget] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const source = colors.find(c => c.hex === selected);
  const target = normalizeDocumentHex(draft);
  const filtered = useMemo(() => colors.filter(c => c.hex.includes(search.trim().toLowerCase())), [colors, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const canApply = !disabled && !!source && !!target && target !== source.hex;

  const updateDraft = (value: string) => {
    setDraft(value);
    if (!previewActive || !source) return;
    const normalized = normalizeDocumentHex(value);
    if (!normalized || normalized === source.hex) {
      onCancelPreview();
      return;
    }
    onPreviewColors(new Map([[source.hex, normalized]]));
  };

  const selectSwatch = (hex: string) => {
    setCopyStatus('idle');
    if (chooseTarget && source) {
      updateDraft(hex);
      setChooseTarget(false);
    } else {
      onCancelPreview();
      setSelected(hex);
      setDraft(hex);
      setChooseTarget(false);
    }
  };
  const apply = () => {
    if (!canApply || !source || !target) return;
    if (onReplaceColor(source.hex, target)) {
      setSelected(target);
      setDraft(target);
      setChooseTarget(false);
      setCopyStatus('idle');
    }
  };
  const copy = async () => {
    if (!source) return;
    try {
      await navigator.clipboard.writeText(source.hex);
      setCopyStatus('ok');
    } catch {
      setCopyStatus('error');
    }
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
      <p className="text-[11px] text-[#94A3B8]">{t('documentPalette.hint')}</p>
      {colors.length > PAGE_SIZE && <input aria-label={t('documentPalette.search')} placeholder={t('documentPalette.search')} value={search} onChange={e => {setSearch(e.target.value); setPage(0);}} className="w-full bg-[#0D1017] rounded border border-[#2A3142] px-2 py-1 text-xs font-mono"/>}
      <div className="grid grid-cols-8 gap-1">
        {visible.map(c => <button key={c.hex} type="button" disabled={disabled} aria-label={c.hex + ' (' + c.count + ' ' + t('documentPalette.pixels') + ')'} aria-pressed={source?.hex === c.hex} title={c.hex + ' · ' + c.count + ' ' + t('documentPalette.pixels')} onClick={() => selectSwatch(c.hex)} className={'h-6 rounded border cursor-pointer disabled:opacity-40 ' + (source?.hex === c.hex ? 'ring-2 ring-sky-400 border-white' : 'border-white/15 hover:border-white')} style={{backgroundColor:c.hex}}/>)}
      </div>
      {visible.length === 0 && <p className="text-xs text-[#94A3B8]">{t('documentPalette.empty')}</p>}
      {pageCount > 1 && <div className="flex items-center justify-between text-xs">
        <button type="button" disabled={currentPage===0} onClick={() => setPage(currentPage-1)} className="disabled:opacity-30">{t('documentPalette.prev')}</button>
        <span>{currentPage+1} / {pageCount}</span>
        <button type="button" disabled={currentPage+1>=pageCount} onClick={() => setPage(currentPage+1)} className="disabled:opacity-30">{t('documentPalette.next')}</button>
      </div>}
      {source && <div className="space-y-2 bg-[#0D1017] rounded border border-[#2A3142] p-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[#94A3B8]">{t('documentPalette.source')}</span>
          <span className="w-5 h-5 rounded border border-white/20" style={{backgroundColor:source.hex}}/>
          <span className="font-mono select-all">{source.hex}</span>
          <button type="button" title={t('documentPalette.copy')} aria-label={t('documentPalette.copy')} onClick={copy} className="ml-auto p-1 hover:text-sky-300">{copyStatus==='ok' ? <Check size={14}/> : <Copy size={14}/>}</button>
          <button type="button" title={t('documentPalette.brush')} aria-label={t('documentPalette.brush')} disabled={disabled} onClick={() => onPickColor(source.hex)} className="p-1 hover:text-sky-300 disabled:opacity-30"><Pipette size={14}/></button>
        </div>
        {copyStatus !== 'idle' && <p role="status" className="text-[11px] text-[#94A3B8]">{copyStatus==='ok'?t('documentPalette.copied'):t('documentPalette.failed')}</p>}
        <label className="block text-xs text-[#CBD5E1]">{t('documentPalette.target')}
          <div className="flex items-center gap-2 mt-1">
            <span className="w-6 h-6 shrink-0 rounded border border-white/20" style={{backgroundColor:target ?? 'transparent'}}/>
            <input aria-invalid={!target} disabled={disabled} value={draft} onChange={e => {updateDraft(e.target.value);setChooseTarget(false);}} onKeyDown={e => {if(e.key==='Enter'){e.preventDefault();apply();}}} className="min-w-0 flex-1 bg-[#161A23] rounded border border-[#2A3142] px-2 py-1 font-mono text-sm"/>
          </div>
        </label>
        {!target && <p className="text-[11px] text-rose-300">{t('documentPalette.invalid')}</p>}
        <button type="button" disabled={disabled} aria-pressed={chooseTarget} onClick={() => setChooseTarget(v => !v)} className={'w-full rounded border px-2 py-1 text-xs disabled:opacity-40 '+(chooseTarget?'border-sky-400 text-sky-300':'border-[#2A3142] text-[#CBD5E1]')}>{t('documentPalette.existing')}</button>
        <button type="button" disabled={!previewActive && (!canApply || previewDisabled)} aria-pressed={previewActive} onClick={() => {
          if (previewActive) onCancelPreview();
          else if (source && target) onPreviewColors(new Map([[source.hex, target]]));
        }} className="w-full rounded border border-[#2A3142] px-2 py-1 text-xs text-[#CBD5E1] disabled:opacity-40">
          {previewActive ? t('documentPalette.cancelPreview') : t('documentPalette.preview')}
        </button>
        <button type="button" disabled={!canApply} onClick={apply} className="w-full rounded bg-sky-600 hover:bg-sky-500 text-white py-1.5 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed">{t('documentPalette.apply')}</button>
      </div>}
    </div>
  );
}
