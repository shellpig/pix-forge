import React, { useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  Copy,
  Crop,
  Download,
  Film,
  FolderArchive,
  LayoutGrid,
  Lock,
  RotateCcw,
  Unlock,
} from 'lucide-react';
import { PRESET_PALETTES } from '../lib/palettes';
import {
  DitherMode,
  DownscaleMode,
  PaletteMode,
  PixelEngineConfig,
  PixelEngineResult,
} from '../lib/pixelEngine';

interface ControlPanelProps {
  config: PixelEngineConfig;
  result: PixelEngineResult | null;
  sourceSize: { w: number; h: number } | null;
  frameCount: number;
  fps: number;
  spriteSheetCols: number;
  isExporting: boolean;
  lockAspect: boolean;
  exportScale: number;
  onChangeExportScale: (scale: number) => void;
  onChangeSpriteSheetCols: (cols: number) => void;
  onToggleLockAspect: () => void;
  onUpdateConfig: (patch: Partial<PixelEngineConfig>) => void;
  onSelectDimensions: (w: number, h: number) => void;
  onResetConfig: () => void;
  onOpenCropMode: () => void;
  onPickColor: (hex: string) => void;
  onDownloadPng: () => void;
  onCopyPng: () => Promise<void>;
  onDownloadSpriteSheet: () => void;
  onDownloadGif: () => void;
  onDownloadZip: () => void;
}

const SQUARE_PRESETS: Array<[number, number]> = [
  [16, 16],
  [32, 32],
  [48, 48],
  [64, 64],
  [96, 96],
  [128, 128],
];

const RECT_PRESETS: Array<[number, number]> = [
  [32, 48],
  [48, 32],
  [64, 48],
  [96, 48],
  [128, 64],
  [128, 96],
];

const DOWNSCALE_OPTIONS: Array<{ id: DownscaleMode; label: string; desc: string }> = [
  {
    id: 'clean-sprite',
    label: '精緻角色 (推薦)',
    desc: '雙邊濾波去雜訊＋主色聚類＋高彩焦點保護（保留瞳孔與臉部乾淨色塊，不黑糊）。',
  },
  {
    id: 'pixeloe',
    label: 'PixelOE (LAB 分離)',
    desc: '將明暗與色相分離運算，僅強化輪廓明暗、維持原色乾淨，適合細線插畫。',
  },
  {
    id: 'k-centroid',
    label: 'K-Centroid 銳利',
    desc: '純雙色聚類取多數色塊，消除反鋸齒灰邊，適合賽璐璐與遊戲貼圖。',
  },
  {
    id: 'area',
    label: '柔和原圖縮放',
    desc: '漸進式高畫質區域平均縮圖，最忠實還原 64×64 以上立繪的柔和漸層。',
  },
];

export function ControlPanel({
  config,
  result,
  sourceSize,
  frameCount,
  fps,
  spriteSheetCols,
  isExporting,
  lockAspect,
  exportScale,
  onChangeExportScale,
  onChangeSpriteSheetCols,
  onToggleLockAspect,
  onUpdateConfig,
  onSelectDimensions,
  onResetConfig,
  onOpenCropMode,
  onPickColor,
  onDownloadPng,
  onCopyPng,
  onDownloadSpriteSheet,
  onDownloadGif,
  onDownloadZip,
}: ControlPanelProps) {
  const [copiedHex, setCopiedHex] = useState<string | null>(null);
  const [copiedImg, setCopiedImg] = useState<boolean>(false);

  const handleWidthInput = (raw: string) => {
    const val = parseInt(raw, 10);
    if (Number.isNaN(val)) return;
    const clampedW = Math.max(8, Math.min(256, val));
    if (lockAspect && sourceSize) {
      const ratio = sourceSize.h / sourceSize.w;
      const matchedH = Math.max(8, Math.min(256, Math.round(clampedW * ratio)));
      onSelectDimensions(clampedW, matchedH);
    } else {
      onSelectDimensions(clampedW, config.targetH);
    }
  };

  const handleHeightInput = (raw: string) => {
    const val = parseInt(raw, 10);
    if (Number.isNaN(val)) return;
    const clampedH = Math.max(8, Math.min(256, val));
    if (lockAspect && sourceSize) {
      const ratio = sourceSize.w / sourceSize.h;
      const matchedW = Math.max(8, Math.min(256, Math.round(clampedH * ratio)));
      onSelectDimensions(matchedW, clampedH);
    } else {
      onSelectDimensions(config.targetW, clampedH);
    }
  };

  const handleCopyHex = (hex: string) => {
    navigator.clipboard?.writeText(hex).catch(() => {});
    onPickColor(hex);
    setCopiedHex(hex);
    window.setTimeout(() => setCopiedHex((curr) => (curr === hex ? null : curr)), 1200);
  };

  const handleCopyImageClick = async () => {
    await onCopyPng();
    setCopiedImg(true);
    window.setTimeout(() => setCopiedImg(false), 1600);
  };

  const activeDownscale = DOWNSCALE_OPTIONS.find((o) => o.id === config.downscaleMode);

  const effectiveCols =
    spriteSheetCols <= 0 || spriteSheetCols > frameCount ? Math.max(1, frameCount) : spriteSheetCols;
  const effectiveRows = Math.max(1, Math.ceil(frameCount / effectiveCols));
  const sheetW = config.targetW * exportScale * effectiveCols;
  const sheetH = config.targetH * exportScale * effectiveRows;

  return (
    <aside className="w-full md:w-[308px] xl:w-[356px] shrink-0 border-t md:border-t-0 md:border-l border-[#222733] bg-[#11141B] flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto studio-scroll divide-y divide-[#1E2330]">
        {/* Section 1: Output Resolution & Crop */}
        <section className="p-4 space-y-3.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-[#E2E8F0] tracking-wide">
              輸出像素尺寸{frameCount > 1 ? '（全組共用）' : ''}
            </h2>
            <button
              type="button"
              onClick={onOpenCropMode}
              className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
            >
              <Crop className="w-3.5 h-3.5" />
              調整裁切框
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex-1">
              <span className="block text-[11px] text-[#8B95A8] mb-1">寬度 (W)</span>
              <input
                type="number"
                min={8}
                max={256}
                value={config.targetW}
                onChange={(e) => handleWidthInput(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#181C26] border border-[#2A3142] focus:border-sky-400 rounded text-sm font-mono tabular-nums text-[#F1F5F9] outline-none"
              />
            </label>

            <button
              type="button"
              onClick={() => onSelectDimensions(config.targetH, config.targetW)}
              title="對調寬高"
              className="mt-5 p-2 bg-[#181C26] hover:bg-[#222836] border border-[#2A3142] rounded text-[#94A3B8] hover:text-[#F1F5F9] transition-colors cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>

            <label className="flex-1">
              <span className="block text-[11px] text-[#8B95A8] mb-1">高度 (H)</span>
              <input
                type="number"
                min={8}
                max={256}
                value={config.targetH}
                onChange={(e) => handleHeightInput(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#181C26] border border-[#2A3142] focus:border-sky-400 rounded text-sm font-mono tabular-nums text-[#F1F5F9] outline-none"
              />
            </label>

            <button
              type="button"
              onClick={onToggleLockAspect}
              title={lockAspect ? '已鎖定原圖長寬比' : '自由長寬比（自動裁切符合比例）'}
              className={`mt-5 p-2 border rounded transition-colors cursor-pointer ${
                lockAspect
                  ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                  : 'bg-[#181C26] border-[#2A3142] text-[#8B95A8] hover:text-[#E2E8F0]'
              }`}
            >
              {lockAspect ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="space-y-2">
            <div>
              <span className="block text-[11px] text-[#64748B] mb-1.5">常用正方形</span>
              <div className="grid grid-cols-3 gap-1.5">
                {SQUARE_PRESETS.map(([w, h]) => {
                  const active = config.targetW === w && config.targetH === h;
                  return (
                    <button
                      key={`${w}x${h}`}
                      type="button"
                      onClick={() => onSelectDimensions(w, h)}
                      className={`py-1.5 text-xs font-mono tabular-nums rounded border transition-colors cursor-pointer ${
                        active
                          ? 'bg-sky-500/15 border-sky-400/60 text-sky-300 font-medium'
                          : 'bg-[#161A23] border-[#252B39] text-[#CBD5E1] hover:border-[#384156]'
                      }`}
                    >
                      {w}×{h}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <span className="block text-[11px] text-[#64748B] mb-1.5">非正方形（自動置中裁切）</span>
              <div className="grid grid-cols-3 gap-1.5">
                {RECT_PRESETS.map(([w, h]) => {
                  const active = config.targetW === w && config.targetH === h;
                  return (
                    <button
                      key={`${w}x${h}`}
                      type="button"
                      onClick={() => onSelectDimensions(w, h)}
                      className={`py-1.5 text-xs font-mono tabular-nums rounded border transition-colors cursor-pointer ${
                        active
                          ? 'bg-sky-500/15 border-sky-400/60 text-sky-300 font-medium'
                          : 'bg-[#161A23] border-[#252B39] text-[#CBD5E1] hover:border-[#384156]'
                      }`}
                    >
                      {w}×{h}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Downscale & Contrast-Aware Algorithm */}
        <section className="p-4 space-y-3.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-[#E2E8F0] tracking-wide">
              降採樣與輪廓演算法
            </h2>
            <button
              type="button"
              onClick={onResetConfig}
              className="inline-flex items-center gap-1 text-[11px] text-[#8B95A8] hover:text-[#E2E8F0] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              重設
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {DOWNSCALE_OPTIONS.map((opt) => {
              const active = config.downscaleMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onUpdateConfig({ downscaleMode: opt.id })}
                  className={`px-2.5 py-2 text-xs text-left rounded border transition-colors whitespace-nowrap truncate cursor-pointer ${
                    active
                      ? 'bg-sky-500/15 border-sky-400/60 text-sky-200 font-medium'
                      : 'bg-[#161A23] border-[#252B39] text-[#CBD5E1] hover:border-[#384156]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {activeDownscale && (
            <p className="text-[11px] leading-relaxed text-[#8B95A8]">{activeDownscale.desc}</p>
          )}

          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#CBD5E1]">色塊平滑化（去細線雜訊）</span>
              <span className="font-mono tabular-nums text-sky-300">{config.smoothness}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={config.smoothness}
              onChange={(e) => onUpdateConfig({ smoothness: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#CBD5E1]">細緻輪廓強調</span>
              <span className="font-mono tabular-nums text-[#94A3B8]">{config.outlineStrength}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={config.outlineStrength}
              onChange={(e) => onUpdateConfig({ outlineStrength: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#CBD5E1]">邊緣銳化</span>
              <span className="font-mono tabular-nums text-[#94A3B8]">{config.preSharpen}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={config.preSharpen}
              onChange={(e) => onUpdateConfig({ preSharpen: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>
        </section>

        {/* Section 3: Color Quantization & Palette */}
        <section className="p-4 space-y-3.5">
          <h2 className="text-xs font-semibold text-[#E2E8F0] tracking-wide">
            色彩量化與色盤 (OKLab)
          </h2>

          <div className="grid grid-cols-3 gap-1 p-1 bg-[#161A23] border border-[#252B39] rounded-md">
            {(
              [
                ['auto', '自動萃取'],
                ['preset', '經典色盤'],
                ['full', '保留原色'],
              ] as Array<[PaletteMode, string]>
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => onUpdateConfig({ paletteMode: mode })}
                className={`py-1.5 text-xs rounded transition-colors whitespace-nowrap cursor-pointer ${
                  config.paletteMode === mode
                    ? 'bg-[#262E40] text-sky-300 font-medium'
                    : 'text-[#8B95A8] hover:text-[#E2E8F0]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {config.paletteMode === 'auto' && (
            <div className="space-y-2.5">
              {/* Shared Sequence Palette Toggle (confirmed Phase 1 preference!) */}
              {frameCount > 1 && (
                <div className="p-2.5 rounded bg-[#161A23] border border-[#252B39] space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#E2E8F0]">
                      全組共用統一色盤
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={config.sharedSequencePalette}
                      onClick={() =>
                        onUpdateConfig({ sharedSequencePalette: !config.sharedSequencePalette })
                      }
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                        config.sharedSequencePalette ? 'bg-sky-500' : 'bg-[#2C3344]'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                          config.sharedSequencePalette ? 'translate-x-4.5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  <p className="text-[11px] text-[#8B95A8] leading-snug">
                    {config.sharedSequencePalette
                      ? '跨全部影格萃取同一套色盤，播放動畫時色彩穩定不閃爍。'
                      : '每張影格各自獨立算色盤（適合畫面色系差異極大的影格）。'}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between text-xs">
                <span className="text-[#CBD5E1]">色數上限</span>
                <span className="font-mono tabular-nums text-sky-300">
                  {config.autoColorCount} 色
                </span>
              </div>
              <input
                type="range"
                min={4}
                max={64}
                step={2}
                value={config.autoColorCount}
                onChange={(e) => onUpdateConfig({ autoColorCount: Number(e.target.value) })}
                className="w-full studio-slider"
              />
              <div className="flex items-center gap-1.5">
                {[8, 12, 16, 24, 32, 48, 64].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onUpdateConfig({ autoColorCount: n })}
                    className={`flex-1 py-1 text-[11px] font-mono tabular-nums rounded border transition-colors cursor-pointer ${
                      config.autoColorCount === n
                        ? 'bg-sky-500/15 border-sky-400/60 text-sky-300'
                        : 'bg-[#161A23] border-[#252B39] text-[#94A3B8] hover:text-[#E2E8F0]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {config.paletteMode === 'preset' && (
            <div className="space-y-1.5 max-h-44 overflow-y-auto studio-scroll pr-0.5">
              {PRESET_PALETTES.map((pal) => {
                const active = config.presetPaletteId === pal.id;
                return (
                  <button
                    key={pal.id}
                    type="button"
                    onClick={() => onUpdateConfig({ presetPaletteId: pal.id })}
                    className={`w-full px-2.5 py-2 rounded border text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-sky-500/10 border-sky-400/60'
                        : 'bg-[#161A23] border-[#252B39] hover:border-[#384156]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        className={`text-xs ${
                          active ? 'text-sky-200 font-medium' : 'text-[#CBD5E1]'
                        }`}
                      >
                        {pal.name}
                      </span>
                      <span className="text-[10px] font-mono tabular-nums text-[#8B95A8]">
                        {pal.colors.length} 色
                      </span>
                    </div>
                    <div className="flex h-2 rounded-xs overflow-hidden">
                      {pal.colors.slice(0, 24).map((hex, i) => (
                        <span
                          key={`${pal.id}-${i}`}
                          className="flex-1 h-full"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {config.paletteMode !== 'full' && (
            <div className="space-y-2.5 pt-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-[#CBD5E1] whitespace-nowrap">抖動 (Dithering)</span>
                <div className="flex items-center bg-[#161A23] border border-[#252B39] rounded p-0.5">
                  {(
                    [
                      ['none', '無'],
                      ['bayer4', 'Bayer'],
                      ['floyd', 'Floyd'],
                    ] as Array<[DitherMode, string]>
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onUpdateConfig({ ditherMode: mode })}
                      className={`px-2.5 py-1 text-[11px] rounded transition-colors cursor-pointer ${
                        config.ditherMode === mode
                          ? 'bg-[#262E40] text-sky-300 font-medium'
                          : 'text-[#8B95A8] hover:text-[#CBD5E1]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {config.ditherMode !== 'none' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#94A3B8]">抖動強度</span>
                    <span className="font-mono tabular-nums text-[#CBD5E1]">
                      {config.ditherStrength}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={config.ditherStrength}
                    onChange={(e) => onUpdateConfig({ ditherStrength: Number(e.target.value) })}
                    className="w-full studio-slider"
                  />
                </div>
              )}
            </div>
          )}

          {result && result.palette.length > 0 && (
            <div className="pt-1">
              <div className="flex items-center justify-between text-[11px] text-[#8B95A8] mb-1.5">
                <span>
                  輸出色盤（共 <span className="font-mono text-[#CBD5E1]">{result.uniqueColorCount}</span> 色）
                </span>
                <span className="font-mono text-sky-300">
                  {copiedHex ? `已選取 ${copiedHex}` : '點擊取色／複製'}
                </span>
              </div>
              <div className="grid grid-cols-12 gap-1">
                {result.palette.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => handleCopyHex(hex)}
                    title={hex}
                    className="h-5 rounded-[2px] border border-white/10 hover:scale-110 hover:z-10 transition-transform cursor-pointer"
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Section 4: Tone & Alpha Adjustments */}
        <section className="p-4 space-y-3">
          <h2 className="text-xs font-semibold text-[#E2E8F0] tracking-wide">畫面微調與透明邊緣</h2>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#CBD5E1]">對比度</span>
              <span className="font-mono tabular-nums text-[#94A3B8]">
                {config.contrast > 0 ? `+${config.contrast}` : config.contrast}
              </span>
            </div>
            <input
              type="range"
              min={-30}
              max={50}
              step={2}
              value={config.contrast}
              onChange={(e) => onUpdateConfig({ contrast: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#CBD5E1]">飽和度</span>
              <span className="font-mono tabular-nums text-[#94A3B8]">
                {config.saturation > 0 ? `+${config.saturation}` : config.saturation}
              </span>
            </div>
            <input
              type="range"
              min={-50}
              max={60}
              step={2}
              value={config.saturation}
              onChange={(e) => onUpdateConfig({ saturation: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#CBD5E1]">透明裁切閾值 (Alpha Cutoff)</span>
              <span className="font-mono tabular-nums text-[#94A3B8]">{config.alphaThreshold}</span>
            </div>
            <input
              type="range"
              min={0}
              max={240}
              step={8}
              value={config.alphaThreshold}
              onChange={(e) => onUpdateConfig({ alphaThreshold: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>
        </section>
      </div>

      {/* Pinned Export Footer inside Inspector */}
      <div className="p-4 border-t border-[#222733] bg-[#0F1218] space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[#CBD5E1] whitespace-nowrap">匯出倍率</span>
          <div className="flex items-center bg-[#161A23] border border-[#252B39] rounded p-0.5">
            {[1, 4, 8, 16].map((scale) => (
              <button
                key={scale}
                type="button"
                onClick={() => onChangeExportScale(scale)}
                className={`px-2.5 py-1 text-[11px] font-mono tabular-nums rounded transition-colors cursor-pointer ${
                  exportScale === scale
                    ? 'bg-[#262E40] text-sky-300 font-medium'
                    : 'text-[#8B95A8] hover:text-[#CBD5E1]'
                }`}
              >
                {scale === 1 ? '1:1' : `${scale}×`}
              </button>
            ))}
          </div>
        </div>

        {frameCount > 1 ? (
          /* Multi-Frame Animation Export Panel */
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-[#94A3B8] whitespace-nowrap">Sheet 排列欄數</span>
              <div className="flex items-center bg-[#161A23] border border-[#252B39] rounded p-0.5">
                {[0, 2, 4, 8]
                  .filter((c) => c === 0 || c < frameCount)
                  .map((c) => {
                    const active = spriteSheetCols === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => onChangeSpriteSheetCols(c)}
                        className={`px-2 py-1 text-[11px] font-mono tabular-nums rounded transition-colors whitespace-nowrap cursor-pointer ${
                          active
                            ? 'bg-[#262E40] text-sky-300 font-medium'
                            : 'text-[#8B95A8] hover:text-[#CBD5E1]'
                        }`}
                      >
                        {c === 0 ? `單排(${frameCount})` : `${c}欄`}
                      </button>
                    );
                  })}
              </div>
            </div>

            <button
              type="button"
              disabled={!result || isExporting}
              onClick={onDownloadSpriteSheet}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#081018] bg-sky-400 hover:bg-sky-300 disabled:opacity-40 rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Sprite Sheet PNG ({sheetW}×{sheetH})
            </button>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={!result || isExporting}
                onClick={onDownloadGif}
                className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-[#E2E8F0] bg-[#1A202D] hover:bg-[#232B3C] border border-[#2D3546] disabled:opacity-40 rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                <Film className="w-3.5 h-3.5 text-sky-400" />
                動態 GIF ({fps} FPS)
              </button>

              <button
                type="button"
                disabled={!result || isExporting}
                onClick={onDownloadZip}
                className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-[#E2E8F0] bg-[#1A202D] hover:bg-[#232B3C] border border-[#2D3546] disabled:opacity-40 rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                <FolderArchive className="w-3.5 h-3.5 text-sky-400" />
                影格 ZIP ({frameCount}張)
              </button>
            </div>

            <div className="flex items-center justify-between pt-0.5 text-[11px] text-[#8B95A8]">
              <button
                type="button"
                disabled={!result}
                onClick={onDownloadPng}
                className="hover:text-sky-300 transition-colors cursor-pointer"
              >
                下載目前單格 PNG
              </button>
              <button
                type="button"
                disabled={!result}
                onClick={handleCopyImageClick}
                className="hover:text-sky-300 transition-colors cursor-pointer"
              >
                {copiedImg ? '已複製目前單格' : '複製目前單格'}
              </button>
            </div>
          </div>
        ) : (
          /* Single-Image Export Buttons */
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!result}
              onClick={onDownloadPng}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#081018] bg-sky-400 hover:bg-sky-300 disabled:opacity-40 rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              下載 PNG ({config.targetW * exportScale}×{config.targetH * exportScale})
            </button>

            <button
              type="button"
              disabled={!result}
              onClick={handleCopyImageClick}
              title="複製 PNG 到剪貼簿"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-[#E2E8F0] bg-[#1A202D] hover:bg-[#232B3C] border border-[#2D3546] disabled:opacity-40 rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              {copiedImg ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  已複製
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  複製
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
