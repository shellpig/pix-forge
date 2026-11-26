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
  onPickColor: (hex: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

const PAGE_SIZE = 64;
const labels = {
  'zh-TW': {
    title: '文件色盤', hint: '點選要全域替換的顏色（目前影格）', source: '原始顏色',
    target: '替換為（HEX）', apply: '套用全域改色', copy: '複製 HEX', copied: '已複製',
    failed: '複製失敗，請手動選取 HEX', brush: '取為畫筆色', search: '搜尋 HEX',
    invalid: '請輸入 6 位 HEX 色碼', prev: '上一頁', next: '下一頁',
    pixels: '像素', undo: '復原', redo: '重做', existing: '使用現有色塊作為目標',
    empty: '沒有符合的顏色',
  },
  en: {
    title: 'Document palette', hint: 'Select a color to replace across the current frame', source: 'Source color',
    target: 'Replace with (HEX)', apply: 'Apply global replacement', copy: 'Copy HEX', copied: 'Copied',
    failed: 'Copy failed; select the HEX manually', brush: 'Use as brush color', search: 'Search HEX',
    invalid: 'Enter a 6-digit HEX color', prev: 'Previous', next: 'Next',
    pixels: 'pixels', undo: 'Undo', redo: 'Redo', existing: 'Use an existing swatch as target',
    empty: 'No matching colors',
  },
  ja: {
    title: 'ドキュメントパレット', hint: '現在のフレーム全体で置換する色を選択', source: '元の色',
    target: '置換先（HEX）', apply: '全体の色を置換', copy: 'HEXをコピー', copied: 'コピー済み',
    failed: 'コピーできません。HEXを手動で選択してください', brush: 'ブラシ色に設定', search: 'HEXを検索',
    invalid: '6桁のHEX色コードを入力', prev: '前へ', next: '次へ',
    pixels: 'ピクセル', undo: '元に戻す', redo: 'やり直す', existing: '既存の色を置換先にする',
    empty: '一致する色がありません',
  },
};

export function DocumentPalette({ imageData, disabled, canUndo, canRedo, onReplaceColor, onPickColor, onUndo, onRedo }: Props) {
  const { locale } = useI18n();
  const l = labels[locale];
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

  const selectSwatch = (hex: string) => {
    setCopyStatus('idle');
    if (chooseTarget && source) {
      setDraft(hex);
      setChooseTarget(false);
    } else {
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
        <h3 className="text-xs font-semibold text-[#E2E8F0]">{l.title} ({colors.length})</h3>
        <div className="flex gap-1">
          <button type="button" title={l.undo} aria-label={l.undo} disabled={disabled || !canUndo} onClick={onUndo} className="p-1 rounded hover:bg-[#252B39] disabled:opacity-30"><Undo2 size={14}/></button>
          <button type="button" title={l.redo} aria-label={l.redo} disabled={disabled || !canRedo} onClick={onRedo} className="p-1 rounded hover:bg-[#252B39] disabled:opacity-30"><Redo2 size={14}/></button>
        </div>
      </div>
      <p className="text-[11px] text-[#94A3B8]">{l.hint}</p>
      {colors.length > PAGE_SIZE && <input aria-label={l.search} placeholder={l.search} value={search} onChange={e => {setSearch(e.target.value); setPage(0);}} className="w-full bg-[#0D1017] rounded border border-[#2A3142] px-2 py-1 text-xs font-mono"/>}
      <div className="grid grid-cols-8 gap-1">
        {visible.map(c => <button key={c.hex} type="button" disabled={disabled} aria-label={c.hex + ' (' + c.count + ' ' + l.pixels + ')'} aria-pressed={source?.hex === c.hex} title={c.hex + ' · ' + c.count + ' ' + l.pixels} onClick={() => selectSwatch(c.hex)} className={'h-6 rounded border cursor-pointer disabled:opacity-40 ' + (source?.hex === c.hex ? 'ring-2 ring-sky-400 border-white' : 'border-white/15 hover:border-white')} style={{backgroundColor:c.hex}}/>)}
      </div>
      {visible.length === 0 && <p className="text-xs text-[#94A3B8]">{l.empty}</p>}
      {pageCount > 1 && <div className="flex items-center justify-between text-xs">
        <button type="button" disabled={currentPage===0} onClick={() => setPage(currentPage-1)} className="disabled:opacity-30">{l.prev}</button>
        <span>{currentPage+1} / {pageCount}</span>
        <button type="button" disabled={currentPage+1>=pageCount} onClick={() => setPage(currentPage+1)} className="disabled:opacity-30">{l.next}</button>
      </div>}
      {source && <div className="space-y-2 bg-[#0D1017] rounded border border-[#2A3142] p-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[#94A3B8]">{l.source}</span>
          <span className="w-5 h-5 rounded border border-white/20" style={{backgroundColor:source.hex}}/>
          <span className="font-mono select-all">{source.hex}</span>
          <button type="button" title={l.copy} aria-label={l.copy} onClick={copy} className="ml-auto p-1 hover:text-sky-300">{copyStatus==='ok' ? <Check size={14}/> : <Copy size={14}/>}</button>
          <button type="button" title={l.brush} aria-label={l.brush} disabled={disabled} onClick={() => onPickColor(source.hex)} className="p-1 hover:text-sky-300 disabled:opacity-30"><Pipette size={14}/></button>
        </div>
        {copyStatus !== 'idle' && <p role="status" className="text-[11px] text-[#94A3B8]">{copyStatus==='ok'?l.copied:l.failed}</p>}
        <label className="block text-xs text-[#CBD5E1]">{l.target}
          <div className="flex items-center gap-2 mt-1">
            <span className="w-6 h-6 shrink-0 rounded border border-white/20" style={{backgroundColor:target ?? 'transparent'}}/>
            <input aria-invalid={!target} disabled={disabled} value={draft} onChange={e => {setDraft(e.target.value);setChooseTarget(false);}} onKeyDown={e => {if(e.key==='Enter'){e.preventDefault();apply();}}} className="min-w-0 flex-1 bg-[#161A23] rounded border border-[#2A3142] px-2 py-1 font-mono text-sm"/>
          </div>
        </label>
        {!target && <p className="text-[11px] text-rose-300">{l.invalid}</p>}
        <button type="button" disabled={disabled} aria-pressed={chooseTarget} onClick={() => setChooseTarget(v => !v)} className={'w-full rounded border px-2 py-1 text-xs disabled:opacity-40 '+(chooseTarget?'border-sky-400 text-sky-300':'border-[#2A3142] text-[#CBD5E1]')}>{l.existing}</button>
        <button type="button" disabled={!canApply} onClick={apply} className="w-full rounded bg-sky-600 hover:bg-sky-500 text-white py-1.5 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed">{l.apply}</button>
      </div>}
    </div>
  );
}
