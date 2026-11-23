import React from 'react';
import {
  Eraser,
  PaintBucket,
  Pencil,
  Pipette,
  Redo2,
  RotateCcw,
  Undo2,
  Wand2,
} from 'lucide-react';

export type PixelTool = 'pencil' | 'eraser' | 'eyedropper' | 'bucket' | 'wand';

export interface PixelEditorState {
  tool: PixelTool;
  brushSize: 1 | 2 | 3;
  colorHex: string;
  tolerance: number; // 0..80
  contiguous: boolean;
}

interface PixelEditorBarProps {
  editor: PixelEditorState;
  palette: string[];
  canUndo: boolean;
  canRedo: boolean;
  hasManualEdits: boolean;
  editStepCount: number;
  onUpdateEditor: (patch: Partial<PixelEditorState>) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAutoRemoveBg: () => void;
  onResetEdits: () => void;
}

const TOOL_ITEMS: Array<{
  id: PixelTool;
  label: string;
  shortcut: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'pencil', label: '畫筆', shortcut: 'B', title: '像素畫筆 (B) — 點擊或拖曳上色', icon: Pencil },
  {
    id: 'eraser',
    label: '橡皮擦',
    shortcut: 'E',
    title: '橡皮擦 / 手動點格去背 (E) — 點擊單格或拖曳變透明',
    icon: Eraser,
  },
  { id: 'eyedropper', label: '滴管', shortcut: 'I', title: '滴管吸色 (I 或 Alt+點擊)', icon: Pipette },
  { id: 'bucket', label: '油漆桶', shortcut: 'G', title: '油漆桶填色 (G)', icon: PaintBucket },
  {
    id: 'wand',
    label: '魔術棒去背',
    shortcut: 'W',
    title: '魔術棒去背 (W) — 點擊背景區域一次變透明',
    icon: Wand2,
  },
];

export function PixelEditorBar({
  editor,
  palette,
  canUndo,
  canRedo,
  hasManualEdits,
  editStepCount,
  onUpdateEditor,
  onUndo,
  onRedo,
  onAutoRemoveBg,
  onResetEdits,
}: PixelEditorBarProps) {
  return (
    <div className="px-3 py-1.5 border-b border-[#222733] bg-[#131722] flex flex-col gap-1.5 shrink-0">
      {/* Single-row toolbar: never wraps vertically when Undo/Reset buttons appear,
          keeping the edit canvas position and size completely stable. */}
      <div className="flex items-center gap-1.5 overflow-x-auto studio-scroll whitespace-nowrap">
        {/* 5 Core Pixel Tools */}
        <div className="flex items-center bg-[#0D1017] border border-[#262C3B] rounded-md p-0.5 shrink-0">
          {TOOL_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = editor.tool === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={item.title}
                onClick={() => onUpdateEditor({ tool: item.id })}
                className={`inline-flex items-center gap-1 px-1.5 py-1 text-[11px] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-sky-500/20 text-sky-200 font-medium'
                    : 'text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-[#191F2C]'
                }`}
              >
                <Icon className="w-3 h-3" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="h-4 w-px bg-[#262B38] shrink-0" aria-hidden="true" />

        {/* Active Color Picker */}
        <label
          title="選擇目前畫筆／油漆桶顏色"
          className="inline-flex items-center gap-1.5 px-1.5 py-1 bg-[#0D1017] border border-[#2A3142] hover:border-sky-400/50 rounded-md cursor-pointer shrink-0"
        >
          <span
            className="w-3.5 h-3.5 rounded-[2px] border border-white/25 shrink-0"
            style={{ backgroundColor: editor.colorHex }}
          />
          <input
            type="color"
            value={editor.colorHex}
            onChange={(e) => onUpdateEditor({ colorHex: e.target.value.toLowerCase() })}
            className="sr-only"
          />
          <span className="text-[11px] font-mono tabular-nums text-[#CBD5E1] uppercase">
            {editor.colorHex}
          </span>
        </label>

        {/* Contextual Tool Options */}
        {(editor.tool === 'pencil' || editor.tool === 'eraser') && (
          <div className="flex items-center gap-0.5 bg-[#0D1017] border border-[#262C3B] rounded-md p-0.5 shrink-0">
            <span className="px-1 text-[10px] text-[#8B95A8] whitespace-nowrap">筆刷</span>
            {([1, 2, 3] as const).map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => onUpdateEditor({ brushSize: sz })}
                className={`px-1.5 py-0.5 text-[11px] font-mono tabular-nums rounded transition-colors cursor-pointer ${
                  editor.brushSize === sz
                    ? 'bg-[#262E40] text-sky-300 font-medium'
                    : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                {sz}px
              </button>
            ))}
          </div>
        )}

        {(editor.tool === 'bucket' || editor.tool === 'wand') && (
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-[#0D1017] border border-[#262C3B] rounded-md">
              <span className="text-[11px] text-[#94A3B8] whitespace-nowrap">容差</span>
              <input
                type="range"
                min={0}
                max={80}
                step={2}
                value={editor.tolerance}
                onChange={(e) => onUpdateEditor({ tolerance: Number(e.target.value) })}
                className="w-16 studio-slider"
              />
              <span className="text-[11px] font-mono tabular-nums text-sky-300 w-5 text-right">
                {editor.tolerance}
              </span>
            </div>

            <button
              type="button"
              onClick={() => onUpdateEditor({ contiguous: !editor.contiguous })}
              title="相連區域：只處理與點擊處相連的像素；全域同色：處理整張圖所有相近顏色"
              className={`px-2 py-1 text-[11px] rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                editor.contiguous
                  ? 'bg-[#161B26] border-[#2D3546] text-[#CBD5E1]'
                  : 'bg-sky-500/15 border-sky-400/50 text-sky-300'
              }`}
            >
              {editor.contiguous ? '僅相連區域' : '全域同色'}
            </button>
          </div>
        )}

        {/* One-Click Corner Auto Background Removal */}
        <button
          type="button"
          onClick={onAutoRemoveBg}
          title="從圖片四個角落自動偵測並清除背景（可配合容差調整，不滿意可按 Ctrl+Z 復原）"
          className="inline-flex items-center px-2 py-1 text-[11px] font-medium text-emerald-200 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          一鍵去背
        </button>

        {/* Undo / Redo / Reset Edits right next to One-Click BG Removal */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="flex items-center bg-[#0D1017] border border-[#262C3B] rounded-md p-0.5">
            <button
              type="button"
              disabled={!canUndo}
              onClick={onUndo}
              title="復原 (Ctrl+Z)"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-[#CBD5E1] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors cursor-pointer"
            >
              <Undo2 className="w-3 h-3" />
              <span className="hidden sm:inline">復原</span>
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={onRedo}
              title="重做 (Ctrl+Y)"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-[#CBD5E1] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors cursor-pointer"
            >
              <Redo2 className="w-3 h-3" />
              <span className="hidden sm:inline">重做</span>
            </button>
          </div>

          {hasManualEdits && (
            <button
              type="button"
              onClick={onResetEdits}
              title="清除所有手動畫筆與去背紀錄，回到自動轉換結果"
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/35 rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              還原自動轉換 ({editStepCount})
            </button>
          )}
        </div>
      </div>

      {/* Quick Clickable Palette Row for Fast Pixel Touch-up */}
      {palette.length > 0 && (
        <div className="w-full pt-1.5 border-t border-[#1E2330] flex items-center gap-2 overflow-x-auto">
          <span className="text-[11px] text-[#8B95A8] whitespace-nowrap shrink-0">快速取色</span>
          <div className="flex items-center gap-1">
            {palette.slice(0, 32).map((hex) => {
              const selected = editor.colorHex.toLowerCase() === hex.toLowerCase();
              return (
                <button
                  key={hex}
                  type="button"
                  title={`選取畫筆顏色 ${hex}`}
                  onClick={() =>
                    onUpdateEditor({
                      colorHex: hex,
                      tool: editor.tool === 'eraser' || editor.tool === 'wand' || editor.tool === 'eyedropper'
                        ? 'pencil'
                        : editor.tool,
                    })
                  }
                  className={`w-4 h-4 rounded-[2px] shrink-0 transition-transform cursor-pointer ${
                    selected
                      ? 'ring-2 ring-sky-400 ring-offset-1 ring-offset-[#131722] scale-110 z-10'
                      : 'border border-white/15 hover:scale-110'
                  }`}
                  style={{ backgroundColor: hex }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
