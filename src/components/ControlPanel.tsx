import React, { useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  Copy,
  Download,
  Film,
  FolderArchive,
  LayoutGrid,
  Lock,
  RotateCcw,
  Unlock,
} from 'lucide-react';
import { DocumentPalette } from './DocumentPalette';
import { PRESET_PALETTES } from '../lib/palettes';
import {
  getSpriteSheetLayout,
  MAX_SPRITE_SHEET_PIXELS,
  MAX_SPRITE_SHEET_SIDE,
} from '../lib/spriteSheetLayout';
import { isCleanupDisabledByDither } from '../lib/isolatedPixels';
import {
  DitherMode,
  IsolatedPixelMode,
  DownscaleMode,
  PaletteMode,
  PixelEngineConfig,
  PixelEngineResult,
} from '../lib/pixelEngine';
import { useI18n, type TranslationKey } from '../i18n';

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
  onPickColor: (hex: string) => void;
  activeFrameId: string | null;
  paletteEditingDisabled: boolean;
  palettePreviewActive: boolean;
  palettePreviewDisabled: boolean;
  onPreviewColors: (mapping: ReadonlyMap<string, string>) => void;
  onCancelPreview: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onReplaceColor: (source: string, target: string) => boolean;
  onUndo: () => void;
  onRedo: () => void;
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

const DOWNSCALE_OPTIONS: Array<{ id: DownscaleMode; labelKey: TranslationKey; descKey: TranslationKey }> = [
  { id: 'clean-sprite', labelKey: 'panel.algo.cleanSprite', descKey: 'panel.algo.cleanSpriteDesc' },
  { id: 'pixeloe', labelKey: 'panel.algo.pixeloe', descKey: 'panel.algo.pixeloeDesc' },
  { id: 'k-centroid', labelKey: 'panel.algo.kCentroid', descKey: 'panel.algo.kCentroidDesc' },
  { id: 'area', labelKey: 'panel.algo.area', descKey: 'panel.algo.areaDesc' },
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
  onPickColor,
  activeFrameId,
  paletteEditingDisabled,
  palettePreviewActive,
  palettePreviewDisabled,
  onPreviewColors,
  onCancelPreview,
  canUndo,
  canRedo,
  onReplaceColor,
  onUndo,
  onRedo,
  onDownloadPng,
  onCopyPng,
  onDownloadSpriteSheet,
  onDownloadGif,
  onDownloadZip,
}: ControlPanelProps) {
  const { locale, t } = useI18n();
  const [copiedHex, setCopiedHex] = useState<string | null>(null);
  const [copiedImg, setCopiedImg] = useState<boolean>(false);
  const cleanupDisabledByDither = isCleanupDisabledByDither(config);

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

  const sheetLayout =
    frameCount > 0
      ? getSpriteSheetLayout(config.targetW, config.targetH, frameCount, exportScale, spriteSheetCols)
      : null;
  const sheetW = sheetLayout?.width ?? 0;
  const sheetH = sheetLayout?.height ?? 0;

  return (
    <aside className="w-full md:w-[308px] xl:w-[356px] shrink-0 border-t md:border-t-0 md:border-l border-[#222733] bg-[#11141B] flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto studio-scroll divide-y divide-[#1E2330]">
        {/* Section 1: Output Resolution & Crop */}
        <section className="p-4 space-y-3.5">
          <h2 className="text-xs font-semibold text-[#E2E8F0] tracking-wide">
            {t('panel.resolution')}
            {frameCount > 1 ? t('panel.resolutionShared') : ''}
          </h2>

          <div className="flex items-center gap-2">
            <label className="flex-1">
              <span className="block text-[11px] text-[#8B95A8] mb-1">{t('panel.width')}</span>
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
              title={t('panel.swapTitle')}
              className="mt-5 p-2 bg-[#181C26] hover:bg-[#222836] border border-[#2A3142] rounded text-[#94A3B8] hover:text-[#F1F5F9] transition-colors cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>

            <label className="flex-1">
              <span className="block text-[11px] text-[#8B95A8] mb-1">{t('panel.height')}</span>
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
              title={lockAspect ? t('panel.lockTitle') : t('panel.unlockTitle')}
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
              <span className="block text-[11px] text-[#64748B] mb-1.5">{t('panel.squarePresets')}</span>
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
              <span className="block text-[11px] text-[#64748B] mb-1.5">{t('panel.rectPresets')}</span>
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
              {t('panel.algorithm')}
            </h2>
            <button
              type="button"
              onClick={onResetConfig}
              className="inline-flex items-center gap-1 text-[11px] text-[#8B95A8] hover:text-[#E2E8F0] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              {t('panel.reset')}
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
                  {t(opt.labelKey)}
                </button>
              );
            })}
          </div>

          {activeDownscale && (
            <p className="text-[11px] leading-relaxed text-[#8B95A8]">{t(activeDownscale.descKey)}</p>
          )}

          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#CBD5E1]">{t('panel.smoothness')}</span>
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
              <span className="text-[#CBD5E1]">{t('panel.outlineStrength')}</span>
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
              <span className="text-[#CBD5E1]">{t('panel.preSharpen')}</span>
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
            {t('panel.paletteSection')}
          </h2>

          <div className="grid grid-cols-3 gap-1 p-1 bg-[#161A23] border border-[#252B39] rounded-md">
            {(
              [
                ['auto', 'panel.paletteAuto'],
                ['preset', 'panel.palettePreset'],
                ['full', 'panel.paletteFull'],
              ] as Array<[PaletteMode, TranslationKey]>
            ).map(([mode, labelKey]) => (
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
                {t(labelKey)}
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
                      {t('panel.sharedPalette')}
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
                      ? t('panel.sharedPaletteOn')
                      : t('panel.sharedPaletteOff')}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between text-xs">
                <span className="text-[#CBD5E1]">{t('panel.maxColors')}</span>
                <span className="font-mono tabular-nums text-sky-300">
                  {t('panel.colorCount', { count: config.autoColorCount })}
                </span>
              </div>
              <input
                type="range"
                min={2}
                max={64}
                step={1}
                value={config.autoColorCount}
                onChange={(e) => onUpdateConfig({ autoColorCount: Number(e.target.value) })}
                className="w-full studio-slider"
              />
              <div className="flex items-center gap-1.5">
                {[2, 4, 8, 16, 32, 64].map((n) => (
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
                        {t('panel.colorCount', { count: pal.colors.length })}
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
                <span className="text-xs text-[#CBD5E1] whitespace-nowrap">{t('panel.dither')}</span>
                <div className="flex items-center bg-[#161A23] border border-[#252B39] rounded p-0.5">
                  {(
                    [
                      ['none', t('panel.ditherNone')],
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
                    <span className="text-[#94A3B8]">{t('panel.ditherStrength')}</span>
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

          {/* Post-quantization cleanup, disabled while actual dithering is active. */}
          <div className="space-y-1.5 pt-2 border-t border-[#252B39]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-[#CBD5E1]">{t('panel.cleanup')}</span>
              <div role="group" aria-label={t('panel.cleanupAria')} className="flex items-center gap-0.5 rounded p-0.5 bg-[#161A23] border border-[#252B39]">
                {([
                  ['off', 'panel.cleanupOff'],
                  ['light', 'panel.cleanupLight'],
                  ['strong', 'panel.cleanupStrong'],
                ] as Array<[IsolatedPixelMode, TranslationKey]>).map(([mode, labelKey]) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={cleanupDisabledByDither}
                    aria-pressed={config.isolatedPixelMode === mode}
                    onClick={() => onUpdateConfig({ isolatedPixelMode: mode })}
                    className={`px-2.5 py-1 text-[11px] rounded transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                      config.isolatedPixelMode === mode
                        ? 'bg-[#262E40] text-sky-300 font-medium'
                        : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                    }`}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-[#8B95A8]">
              {cleanupDisabledByDither
                ? t('panel.cleanupDisabledDither')
                : config.isolatedPixelMode === 'light'
                  ? t('panel.cleanupLightDesc')
                  : config.isolatedPixelMode === 'strong'
                    ? t('panel.cleanupStrongDesc')
                    : t('panel.cleanupOffDesc')}
            </p>
          </div>

          {result && result.palette.length > 0 && (
            <div className="pt-1">
              <div className="flex items-center justify-between text-[11px] text-[#8B95A8] mb-1.5">
                <span>{t('panel.outputPalette', { count: result.uniqueColorCount })}</span>
                <span className="font-mono text-sky-300">
                  {copiedHex ? t('panel.copiedHex', { hex: copiedHex }) : t('panel.clickToCopyHex')}
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

          {result && (
            <DocumentPalette
              key={activeFrameId ?? 'none'}
              imageData={result.imageData}
              disabled={paletteEditingDisabled}
              previewActive={palettePreviewActive}
              previewDisabled={palettePreviewDisabled}
              onPreviewColors={onPreviewColors}
              onCancelPreview={onCancelPreview}
              canUndo={canUndo}
              canRedo={canRedo}
              onReplaceColor={onReplaceColor}
              onPickColor={onPickColor}
              onUndo={onUndo}
              onRedo={onRedo}
            />
          )}
        </section>

        {/* Section 4: Tone & Alpha Adjustments */}
        <section className="p-4 space-y-3">
          <h2 className="text-xs font-semibold text-[#E2E8F0] tracking-wide">{t('panel.toneSection')}</h2>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#CBD5E1]">{t('panel.contrast')}</span>
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
              <span className="text-[#CBD5E1]">{t('panel.saturation')}</span>
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
              <span className="text-[#CBD5E1]">{t('panel.alphaCutoff')}</span>
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
          <span className="text-xs text-[#CBD5E1] whitespace-nowrap">{t('panel.exportScale')}</span>
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
              <span className="text-xs text-[#94A3B8] whitespace-nowrap">{t('panel.sheetCols')}</span>
              <div className="flex items-center bg-[#161A23] border border-[#252B39] rounded p-0.5 overflow-x-auto studio-scroll">
                {[0, -1, 2, 4, 8, 16]
                  .filter((c) => c <= 0 || c <= frameCount)
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
                        {c === 0
                          ? t('panel.sheetAuto', { cols: sheetLayout?.columns ?? 1 })
                          : c === -1
                            ? t('panel.sheetSingleRow', { count: frameCount })
                            : t('panel.sheetColsN', { cols: c })}
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

            {sheetLayout && !sheetLayout.isWithinLimits && (
              <p className="text-[11px] text-amber-300 leading-relaxed" role="alert">
                {t('error.sheetOversize', {
                  width: sheetLayout.width.toLocaleString(locale),
                  height: sheetLayout.height.toLocaleString(locale),
                  pixels: sheetLayout.pixelCount.toLocaleString(locale),
                  maxSide: MAX_SPRITE_SHEET_SIDE.toLocaleString(locale),
                  maxPixels: MAX_SPRITE_SHEET_PIXELS.toLocaleString(locale),
                })}
              </p>
            )}

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={!result || isExporting}
                onClick={onDownloadGif}
                className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-[#E2E8F0] bg-[#1A202D] hover:bg-[#232B3C] border border-[#2D3546] disabled:opacity-40 rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                <Film className="w-3.5 h-3.5 text-sky-400" />
                {t('panel.exportGif', { fps })}
              </button>

              <button
                type="button"
                disabled={!result || isExporting}
                onClick={onDownloadZip}
                className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-[#E2E8F0] bg-[#1A202D] hover:bg-[#232B3C] border border-[#2D3546] disabled:opacity-40 rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                <FolderArchive className="w-3.5 h-3.5 text-sky-400" />
                {t('panel.exportZip', { count: frameCount })}
              </button>
            </div>

            <div className="flex items-center justify-between pt-0.5 text-[11px] text-[#8B95A8]">
              <button
                type="button"
                disabled={!result}
                onClick={onDownloadPng}
                className="hover:text-sky-300 transition-colors cursor-pointer"
              >
                {t('panel.downloadCurrentFrame')}
              </button>
              <button
                type="button"
                disabled={!result}
                onClick={handleCopyImageClick}
                className="hover:text-sky-300 transition-colors cursor-pointer"
              >
                {copiedImg ? t('panel.copiedCurrentFrame') : t('panel.copyCurrentFrame')}
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
              {t('panel.downloadPng', {
                w: config.targetW * exportScale,
                h: config.targetH * exportScale,
              })}
            </button>

            <button
              type="button"
              disabled={!result}
              onClick={handleCopyImageClick}
              title={t('panel.copyPngTitle')}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-[#E2E8F0] bg-[#1A202D] hover:bg-[#232B3C] border border-[#2D3546] disabled:opacity-40 rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              {copiedImg ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  {t('panel.copied')}
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  {t('panel.copy')}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
