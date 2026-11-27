import React,{useEffect,useState} from 'react';
import { detectSheetGrid,sheetCells,MAX_SHEET_PIXELS,type SheetMode } from '../lib/spriteSheetImport';

export function SpriteSheetDialog({file,zh,onClose,onImport}:{file:File;zh:boolean;onClose:()=>void;onImport:(files:File[],mode:SheetMode)=>Promise<void>}) {
  const [image,setImage]=useState<HTMLImageElement|null>(null);
  const [cols,setCols]=useState(4),[rows,setRows]=useState(4);
  const [mode,setMode]=useState<SheetMode>('original');
  const [error,setError]=useState(''),[hint,setHint]=useState(''),[busy,setBusy]=useState(false);
  const tr=(a:string,b:string)=>zh?a:b;
  useEffect(()=>{
    const url=URL.createObjectURL(file);const img=new Image();let cancelled=false;
    img.onload=()=>{
      if(cancelled)return;
      try{
        if(img.naturalWidth*img.naturalHeight>MAX_SHEET_PIXELS)throw new Error('Image exceeds 16 MP');
        const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
        const ctx=c.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');
        ctx.drawImage(img,0,0);const detected=detectSheetGrid(ctx.getImageData(0,0,c.width,c.height));
        if(detected){setCols(detected.cols);setRows(detected.rows);setHint(zh?'已偵測格線，請確認。':'Grid detected; confirm the preview.');}
        else setHint(zh?'無法確定格線，請手動指定。':'Grid uncertain; specify rows and columns.');
        setImage(img);
      }catch(e){setError(String(e));}
    };img.onerror=()=>{if(!cancelled)setError('Image decode failed');};img.src=url;
    return()=>{cancelled=true;URL.revokeObjectURL(url);};
  },[file,zh]);
  let cells:ReturnType<typeof sheetCells>=[];let validation='';
  if(image){try{cells=sheetCells(image.naturalWidth,image.naturalHeight,cols,rows);
    if(mode==='native'&&(cells[0].outputW>256||cells[0].outputH>256))validation=tr('原生像素精修限 256×256 以下；請使用不轉 Pixel 或先轉換。','Native editing requires cells at most 256×256. Choose original or convert.');
  }catch(e){validation=String(e);}}
  async function submit(){
    if(!image||!cells.length||validation||busy)return;
    setBusy(true);setError('');
    try{
      const files:File[]=[];
      const c=document.createElement('canvas');c.width=cells[0].outputW;c.height=cells[0].outputH;
      const ctx=c.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');
      for(const [i,cell] of cells.entries()){
        ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(image,cell.x,cell.y,cell.w,cell.h,0,0,cell.w,cell.h);
        const blob=await new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('PNG encoding failed')),'image/png'));
        files.push(new File([blob],file.name.replace(/\.[^.]+$/,'')+'-'+String(i+1).padStart(3,'0')+'.png',{type:'image/png'}));
      }
      await onImport(files,mode);onClose();
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  return <div role="dialog" aria-modal="true" aria-label="Sprite Sheet import" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
    <div className="w-full max-w-lg max-h-[90dvh] overflow-auto rounded-lg border border-slate-600 bg-[#11141B] p-4 space-y-3">
      <div className="flex justify-between items-center"><h2 className="font-semibold">{tr('匯入 Sprite Sheet','Import Sprite Sheet')}</h2><button disabled={busy} onClick={onClose}>×</button></div>
      {image&&<div className="relative w-fit max-w-full mx-auto"><img src={image.src} alt="Sprite sheet" className="max-w-full max-h-[40dvh] object-contain"/>{cells.length>0&&<div className="absolute inset-0 grid pointer-events-none" style={{gridTemplateColumns:'repeat('+cols+',1fr)',gridTemplateRows:'repeat('+rows+',1fr)'}}>{cells.map((_,i)=><div key={i} className="border border-sky-400/70 text-[10px] text-sky-300">{i+1}</div>)}</div>}</div>}
      <p className="text-xs text-slate-300">{hint}</p>
      <div className="flex gap-3">{[[tr('欄數','Columns'),cols,setCols],[tr('列數','Rows'),rows,setRows]].map(([label,value,setter])=><label key={String(label)} className="flex-1 text-xs">{String(label)}<input type="number" min={1} max={128} value={Number(value)} disabled={busy} onChange={e=>(setter as (v:number)=>void)(Number(e.target.value))} className="block w-full bg-slate-800 rounded p-2"/></label>)}</div>
      {cells.length>0&&<p className="text-xs">{cells.length} {tr('影格','frames')} · {cells[0].outputW}×{cells[0].outputH}</p>}
      <label className="block text-xs">{tr('處理方式','Processing')}<select className="block w-full bg-slate-800 p-2 rounded" value={mode} disabled={busy} onChange={e=>setMode(e.target.value as SheetMode)}>
        <option value="original">{tr('不轉 Pixel（僅播放與匯出）','No pixel conversion (play/export only)')}</option>
        <option value="native">{tr('不轉 Pixel（確認為原生像素圖）','No pixel conversion (confirmed native pixel art)')}</option>
        <option value="convert">{tr('轉成 Pixel Art','Convert to pixel art')}</option>
      </select></label>
      <p className="text-xs text-slate-400">{tr('依左至右、上至下拆分。原生像素圖由你確認；仿像素風圖片請先轉換再精修。','Frames are split left to right, top to bottom. Confirm native pixel art yourself; convert pixel-style images before editing.')}</p>
      {(error||validation)&&<p role="alert" className="text-xs text-rose-300">{error||validation}</p>}
      <button data-testid="sprite-import-confirm" disabled={busy||!cells.length||!!validation} onClick={()=>void submit()} className="bg-sky-700 rounded p-2 w-full disabled:opacity-40">{busy?tr('匯入中…','Importing…'):tr('拆分並匯入','Split and import')}</button>
    </div>
  </div>;
}
