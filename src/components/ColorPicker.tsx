import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useI18n, type TranslationKey } from '../i18n';
import { normalizeDocumentHex } from '../lib/documentPalette';
import { hexToRgb, rgbToHex } from '../lib/palettes';
import { hexToHsl, hslToHex, type HSLColor } from '../lib/colorPicker';

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onEnter?: () => void;
  layout?: 'vertical' | 'compact';
}

/** Controlled color editor. Callers choose whether a change affects the brush
 * or an isolated document preview. It never commits document history. */
export function ColorPicker({ value, onChange, disabled = false, onEnter, layout = 'vertical' }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'rgb'|'hsl'>('rgb');
  const [hslDraft, setHslDraft] = useState<{hex:string; value:HSLColor} | null>(null);
  const [copyStatus, setCopyStatus] = useState<{hex:string; ok:boolean} | null>(null);
  const hex = normalizeDocumentHex(value);
  const rgb = hexToRgb(hex ?? '#000000');
  const hsl = hex && hslDraft?.hex === hex ? hslDraft.value : hexToHsl(hex ?? '#000000');
  const changeRgb = (key:'r'|'g'|'b', n:number) => {
    const next = {...rgb, [key]:n};
    setHslDraft(null);
    onChange(rgbToHex(next.r,next.g,next.b));
  };
  const changeHsl = (key:keyof HSLColor, n:number) => {
    const next = {...hsl,[key]:n};
    const nextHex = hslToHex(next.h,next.s,next.l);
    // Keep intentional hue at zero saturation and avoid round-trip drift.
    setHslDraft({hex:nextHex,value:next});
    onChange(nextHex);
  };
  const copy = async () => {
    if (!hex) return;
    try { await navigator.clipboard.writeText(hex); setCopyStatus({hex,ok:true}); }
    catch { setCopyStatus({hex,ok:false}); }
  };
  const channel = (key:TranslationKey, value:number, max:number, onValue:(n:number)=>void, gradient:string) => (
    <label key={key} className="color-picker-channel grid grid-cols-[minmax(0,1fr)_3rem] gap-x-2 items-center text-[11px]">
      <span className="color-picker-channel-label text-[#CBD5E1]">{t(key)}</span>
      <span className="color-picker-channel-value font-mono text-right tabular-nums text-sky-300">{Math.round(value)}</span>
      <input type="range" aria-label={t(key)} min={0} max={max} step={1} value={Math.round(value)}
        disabled={disabled || !hex} onChange={e=>onValue(Number(e.target.value))}
        className="col-span-2 w-full studio-slider" style={{background:gradient}} />
    </label>
  );
  const rgbGradient=(key:'r'|'g'|'b')=>{
    const a={...rgb,[key]:0}, b={...rgb,[key]:255};
    return 'linear-gradient(to right,'+rgbToHex(a.r,a.g,a.b)+','+rgbToHex(b.r,b.g,b.b)+')';
  };
  return (
    <div data-color-picker-layout={layout} className="color-picker-layout min-w-0 text-xs">
      <div className="color-picker-content grid gap-2 min-w-0">
        <div className="color-picker-controls grid gap-2 min-w-0">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="w-7 h-7 rounded border border-white/20 shrink-0" style={{backgroundColor:hex ?? 'transparent'}}/>
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t('colorPicker.hex')}</span>
              <input aria-label={t('colorPicker.hex')} aria-invalid={!hex} value={value} disabled={disabled}
                onChange={e=>{setHslDraft(null);onChange(e.target.value);}}
                onKeyDown={e=>{if(e.key==='Enter' && onEnter){e.preventDefault();onEnter();}}}
                className="w-full bg-[#161A23] rounded border border-[#2A3142] px-2 py-1 font-mono text-sm"/>
            </label>
            <button type="button" disabled={!hex} title={t('documentPalette.copy')} aria-label={t('documentPalette.copy')}
              onClick={copy} className="p-1 rounded hover:text-sky-300 disabled:opacity-30">
              {copyStatus && copyStatus.hex===hex && copyStatus.ok ? <Check size={14}/> : <Copy size={14}/>}
            </button>
          </div>
          {!hex && <p className="text-rose-300 text-[11px]">{t('documentPalette.invalid')}</p>}
          {copyStatus && copyStatus.hex===hex && <p role="status" className="text-[11px] text-[#94A3B8]">{t(copyStatus.ok?'documentPalette.copied':'documentPalette.failed')}</p>}
          <div className="flex rounded border border-[#2A3142] overflow-hidden">
            {(['rgb','hsl'] as const).map(m=><button key={m} type="button" aria-pressed={mode===m}
              onClick={()=>setMode(m)} className={'flex-1 py-1 font-mono '+(mode===m?'bg-sky-500/20 text-sky-200':'text-[#94A3B8]')}>{m.toUpperCase()}</button>)}
          </div>
        </div>
        <div className="color-picker-channels grid gap-2 min-w-0">
          {mode==='rgb' ? <>
            {channel('colorPicker.red',rgb.r,255,n=>changeRgb('r',n),rgbGradient('r'))}
            {channel('colorPicker.green',rgb.g,255,n=>changeRgb('g',n),rgbGradient('g'))}
            {channel('colorPicker.blue',rgb.b,255,n=>changeRgb('b',n),rgbGradient('b'))}
          </> : <>
            {channel('colorPicker.hue',hsl.h,360,n=>changeHsl('h',n),'linear-gradient(to right,red,yellow,lime,cyan,blue,magenta,red)')}
            {channel('colorPicker.saturation',hsl.s,100,n=>changeHsl('s',n),'linear-gradient(to right,'+hslToHex(hsl.h,0,hsl.l)+','+hslToHex(hsl.h,100,hsl.l)+')')}
            {channel('colorPicker.lightness',hsl.l,100,n=>changeHsl('l',n),'linear-gradient(to right,#000,'+hslToHex(hsl.h,hsl.s,50)+',#fff)')}
          </>}
        </div>
      </div>
    </div>
  );
}
