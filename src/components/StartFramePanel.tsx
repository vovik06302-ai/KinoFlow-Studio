import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { Image as ImageIcon, Replace, Trash2 } from 'lucide-react';
import type { StartFrameReference } from '../types/video';

interface StartFramePanelProps {
  startFrame: StartFrameReference | null;
  endFrame?: StartFrameReference | null;
  disabled: boolean;
  onSelectFile: (file: File) => void;
  onClear: () => void;
  onSelectEndFrameFile?: (file: File) => void;
  onClearEndFrame?: () => void;
}

export function StartFramePanel({
  startFrame,
  endFrame = null,
  disabled,
  onSelectFile,
  onClear,
  onSelectEndFrameFile,
  onClearEndFrame,
}: StartFramePanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const endInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingEnd, setIsDraggingEnd] = useState(false);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onSelectFile(file);
    }
    e.target.value = '';
  };

  const handleEndFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onSelectEndFrameFile) {
      onSelectEndFrameFile(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
    if (file) {
      onSelectFile(file);
    }
  };

  const handleEndDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingEnd(false);
    if (disabled || !onSelectEndFrameFile) return;
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
    if (file) {
      onSelectEndFrameFile(file);
    }
  };

  return (
    <section
      aria-labelledby="start-frame-heading"
      className="border-b border-[#222734] py-5"
      data-testid="start-frame-section"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2
          id="start-frame-heading"
          className="text-sm font-semibold tracking-tight text-[#F1F5F9]"
        >
          Стартовый кадр (Start Frame)
        </h2>
        <span className="font-mono text-xs text-[#94A3B8]">
          {endFrame ? 'WanFirstLastFrameToVideo' : 'workflow_i2v.json'}
        </span>
      </div>

      <input
        ref={inputRef}
        id="start-frame-upload-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onChange={handleFileChange}
        className="sr-only"
      />

      {startFrame ? (
        <div className="space-y-2.5">
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-[#2B3242] bg-[#0B0D11]">
            <img
              src={startFrame.previewUrl}
              alt="Стартовый кадр для оживления фото"
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-mono text-xs text-[#E2E8F0]">
                {startFrame.file.name}
              </p>
              {startFrame.sourceLabel && (
                <p className="mt-0.5 text-[11px] text-[#F6AD55]">{startFrame.sourceLabel}</p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-2.5 py-1.5 text-xs font-medium text-[#E2E8F0] transition-colors hover:bg-[#222838] focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50"
              >
                <Replace className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Заменить</span>
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={onClear}
                aria-label="Удалить стартовый кадр"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-[#64748B] transition-colors hover:border-[#3B1F24] hover:bg-[#2A1519] hover:text-[#F87171] focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`rounded-lg border border-dashed p-4 transition-colors ${
            isDragging
              ? 'border-[#E58E26] bg-[#E58E26]/10'
              : 'border-[#2D3546] bg-[#11151E] hover:border-[#424E66]'
          }`}
        >
          <div className="flex flex-col items-center justify-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#1A202D] text-[#F6AD55]">
                <ImageIcon className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-medium text-[#E2E8F0]">
                  Загрузите стартовый кадр для анимации
                </p>
                <p className="text-[11px] text-[#64748B]">
                  PNG, JPG или WebP · автоподгон пропорций включён
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              className="shrink-0 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3.5 py-2 text-xs font-medium text-[#E2E8F0] transition-colors hover:border-[#3A4358] hover:bg-[#222838] focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50"
            >
              Выбрать кадр
            </button>
          </div>
        </div>
      )}

      {/* Optional End Frame (First + Last Frame video transition) */}
      {onSelectEndFrameFile && onClearEndFrame && (
        <div className="mt-4 border-t border-[#1E2330] pt-4" data-testid="end-frame-section">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-[#CBD5E1]">
              Конечный кадр (End Frame · опционально)
            </span>
            <span className="font-mono text-[10.5px] text-[#64748B]">плавный переход А → Б</span>
          </div>

          <input
            ref={endInputRef}
            id="end-frame-upload-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled}
            onChange={handleEndFileChange}
            className="sr-only"
          />

          {endFrame ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[#2B3242] bg-[#11151E] p-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <img
                  src={endFrame.previewUrl}
                  alt="Конечный кадр для перехода"
                  referrerPolicy="no-referrer"
                  className="h-11 w-16 shrink-0 rounded border border-[#262C3A] bg-[#0B0D11] object-cover"
                />
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-[#E2E8F0]">
                    {endFrame.file.name}
                  </p>
                  <p className="text-[11px] text-[#94A3B8]">
                    Финал сцены · WanFirstLastFrameToVideo
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => endInputRef.current?.click()}
                  className="rounded-md border border-[#2B3242] bg-[#1A1F2B] px-2 py-1 text-[11px] font-medium text-[#E2E8F0] hover:bg-[#222838] disabled:opacity-50"
                >
                  Заменить
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onClearEndFrame}
                  aria-label="Удалить конечный кадр"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#64748B] hover:bg-[#2A1519] hover:text-[#F87171] disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!disabled) setIsDraggingEnd(true);
              }}
              onDragLeave={() => setIsDraggingEnd(false)}
              onDrop={handleEndDrop}
              className={`flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2.5 transition-colors ${
                isDraggingEnd
                  ? 'border-[#E58E26] bg-[#E58E26]/10'
                  : 'border-[#262C3A] bg-[#11151E] hover:border-[#3A4358]'
              }`}
            >
              <p className="text-[11px] text-[#94A3B8]">
                Задайте финальный кадр — модель плавно доведёт сцену до него
              </p>
              <button
                type="button"
                disabled={disabled}
                onClick={() => endInputRef.current?.click()}
                className="shrink-0 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-2.5 py-1.5 text-[11px] font-medium text-[#E2E8F0] hover:bg-[#222838] disabled:opacity-50"
              >
                Выбрать финал
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
