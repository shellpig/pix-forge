import React, { useEffect, useRef, useState } from 'react';
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';

export interface TimelineFramePreview {
  id: string;
  name: string;
  imageData: ImageData | null;
  hasManualEdits: boolean;
}

interface FrameTimelineBarProps {
  frames: TimelineFramePreview[];
  activeFrameId: string | null;
  isPlaying: boolean;
  onSelectFrame: (id: string) => void;
  onEditFrame: (id: string) => void;
  onReorderFrames: (fromIndex: number, toIndex: number) => void;
  onDeleteFrame: (id: string) => void;
  onAppendFiles: (files: File[]) => void;
}

function FrameThumbCanvas({ imageData }: { imageData: ImageData | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageData) return;
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, imageData.width, imageData.height);
      ctx.putImageData(imageData, 0, 0);
    }
  }, [imageData]);

  if (!imageData) {
    return <div className="w-full h-full bg-[#161A23] animate-pulse" />;
  }

  return (
    <canvas
      ref={canvasRef}
      className="max-w-full max-h-full object-contain pixelated block"
    />
  );
}

export function FrameTimelineBar({
  frames,
  activeFrameId,
  isPlaying,
  onSelectFrame,
  onEditFrame,
  onReorderFrames,
  onDeleteFrame,
  onAppendFiles,
}: FrameTimelineBarProps) {
  const appendInputRef = useRef<HTMLInputElement | null>(null);
  const confirmPopoverRef = useRef<HTMLDivElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState<boolean>(false);
  const [dontAskChecked, setDontAskChecked] = useState<boolean>(false);
  const [pendingDelete, setPendingDelete] = useState<{
    frameId: string;
    frameNumber: number;
    anchorX: number;
    anchorY: number;
  } | null>(null);

  useEffect(() => {
    if (!pendingDelete) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (confirmPopoverRef.current && !confirmPopoverRef.current.contains(e.target as Node)) {
        setPendingDelete(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPendingDelete(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [pendingDelete]);

  useEffect(() => {
    if (pendingDelete && !frames.some((f) => f.id === pendingDelete.frameId)) {
      setPendingDelete(null);
    }
  }, [frames, pendingDelete]);

  const activeIdx = frames.findIndex((f) => f.id === activeFrameId);
  const isSingleFrame = frames.length <= 1;

  const handleAppendChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files ? Array.from(e.target.files) : [];
    if (list.length > 0) {
      onAppendFiles(list);
    }
    e.target.value = '';
  };

  return (
    <div className={'border-t border-[#222733] bg-[#0F1218] px-3 shrink-0 ' + (isSingleFrame ? 'py-1' : 'py-1.5')}>
      <input
        ref={appendInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleAppendChange}
      />

      <div className={'flex items-center justify-between gap-2 ' + (isSingleFrame ? '' : 'mb-1')}>
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-[#94A3B8]">
          <span className="font-medium text-[#E2E8F0]">影格時間軸</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums text-sky-300">
            {activeIdx >= 0 ? String(activeIdx + 1).padStart(2, '0') : '--'} /{' '}
            {String(frames.length).padStart(2, '0')}
          </span>
          <span aria-hidden="true" className="hidden sm:inline">·</span>
          <span className="min-w-0 truncate text-[11px] text-[#7A879C]">
            {isSingleFrame
              ? '加入更多影格即可播放動畫'
              : '拖曳排序 · 點選切換影格 · 雙擊精修'}
          </span>
        </div>

        <button
          type="button"
          onClick={() => appendInputRef.current?.click()}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[#E2E8F0] bg-[#1A202D] hover:bg-[#232B3C] border border-[#2D3546] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-3 h-3 text-sky-400" />
          追加影格
        </button>
      </div>

      {!isSingleFrame && (
        <div className="flex items-center gap-1.5 overflow-x-auto studio-scroll pb-0.5">
        {frames.map((frame, index) => {
          const isActive = frame.id === activeFrameId;
          const isDragging = dragIndex === index;
          const isDropTarget = dropTargetIndex === index && dragIndex !== null && dragIndex !== index;

          return (
            <div
              key={frame.id}
              draggable={!isPlaying}
              onDragStart={(e) => {
                setDragIndex(index);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(index));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dropTargetIndex !== index) setDropTargetIndex(index);
              }}
              onDragLeave={() => {
                if (dropTargetIndex === index) setDropTargetIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== index) {
                  onReorderFrames(dragIndex, index);
                }
                setDragIndex(null);
                setDropTargetIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setDropTargetIndex(null);
              }}
              onClick={() => onSelectFrame(frame.id)}
              onDoubleClick={() => onEditFrame(frame.id)}
              title={`${frame.name}（雙擊進入像素精修，拖曳可調整順序）`}
              className={`group relative shrink-0 w-[52px] rounded border transition-all cursor-pointer select-none ${
                isActive
                  ? 'border-sky-400 bg-[#172130]'
                  : 'border-[#252B39] bg-[#141821] hover:border-[#3A445C]'
              } ${isDragging ? 'opacity-40 scale-95' : 'opacity-100'} ${
                isDropTarget ? 'ring-2 ring-sky-400/80 ring-offset-1 ring-offset-[#0F1218]' : ''
              }`}
            >
              {/* Thumbnail Viewport */}
              <div className="h-[38px] w-full p-0.5 bg-checkerboard flex items-center justify-center overflow-hidden rounded-t-[3px] relative">
                <FrameThumbCanvas imageData={frame.imageData} />

                {/* Hover Quick Actions: Edit single frame / Delete frame */}
                <div className="absolute top-0.5 right-0.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    title="針對這格進行像素精修"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditFrame(frame.id);
                    }}
                    className="p-0.5 bg-[#0B0D11]/85 hover:bg-sky-500 text-[#E2E8F0] hover:text-[#081018] rounded-[2px] cursor-pointer"
                  >
                    <Pencil className="w-2.5 h-2.5" />
                  </button>
                  {frames.length > 1 && (
                    <button
                      type="button"
                      title="刪除此影格"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (skipDeleteConfirm) {
                          onDeleteFrame(frame.id);
                          return;
                        }
                        const rect = e.currentTarget.getBoundingClientRect();
                        const anchorX = Math.max(
                          116,
                          Math.min(window.innerWidth - 116, rect.left + rect.width / 2)
                        );
                        const anchorY = Math.max(96, rect.top - 8);
                        setDontAskChecked(false);
                        setPendingDelete({
                          frameId: frame.id,
                          frameNumber: index + 1,
                          anchorX,
                          anchorY,
                        });
                      }}
                      className="p-0.5 bg-[#0B0D11]/85 hover:bg-rose-500 text-[#E2E8F0] hover:text-white rounded-[2px] cursor-pointer"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>

                {!isPlaying && (
                  <GripVertical className="w-3 h-3 text-white/40 absolute top-0.5 left-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                )}
              </div>

              {/* Footer Row: Index + Edited Indicator */}
              <div className="px-1 py-0.5 flex items-center justify-between text-[9px] font-mono tabular-nums">
                <span className={isActive ? 'text-sky-300 font-semibold' : 'text-[#94A3B8]'}>
                  #{String(index + 1).padStart(2, '0')}
                </span>
                {frame.hasManualEdits && (
                  <span className="text-[9px] font-sans text-amber-300" title="此影格已手動修圖">
                    已修
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {/* Quick Append Card */}
        <button
          type="button"
          onClick={() => appendInputRef.current?.click()}
          className="shrink-0 w-[52px] h-[52px] rounded border border-dashed border-[#2D3546] hover:border-sky-400/60 bg-[#12161F] hover:bg-[#171C28] flex flex-col items-center justify-center gap-1 text-[#8B95A8] hover:text-sky-300 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span className="text-[10px]">加影格</span>
        </button>
        </div>
      )}

      {pendingDelete && (
        <div
          ref={confirmPopoverRef}
          role="dialog"
          aria-label="確認刪除影格"
          style={{
            left: pendingDelete.anchorX,
            top: pendingDelete.anchorY,
            transform: 'translate(-50%, -100%)',
          }}
          className="fixed z-50 w-[216px] p-2.5 bg-[#151B26] border border-[#364056] rounded-md shadow-2xl text-xs text-[#E2E8F0]"
        >
          <p className="font-medium text-[#F8FAFC]">
            確定刪除第 #{String(pendingDelete.frameNumber).padStart(2, '0')} 格？
          </p>
          <p className="mt-0.5 text-[11px] text-[#94A3B8]">
            刪除後可按 Ctrl+Z 復原
          </p>
          <label className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-[#CBD5E1] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontAskChecked}
              onChange={(e) => setDontAskChecked(e.target.checked)}
              className="accent-sky-400 cursor-pointer"
            />
            本次不再詢問
          </label>
          <div className="mt-2.5 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="px-2 py-1 text-[11px] text-[#CBD5E1] bg-[#1D2433] hover:bg-[#263044] border border-[#2D3546] rounded cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                if (dontAskChecked) setSkipDeleteConfirm(true);
                const targetId = pendingDelete.frameId;
                setPendingDelete(null);
                onDeleteFrame(targetId);
              }}
              className="px-2.5 py-1 text-[11px] font-medium text-white bg-rose-500 hover:bg-rose-400 rounded cursor-pointer"
            >
              刪除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
