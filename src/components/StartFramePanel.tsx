import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { Image as ImageIcon, Replace, Trash2 } from 'lucide-react';
import type { StartFrameReference } from '../types/video';

interface StartFramePanelProps {
  startFrame: StartFrameReference | null;
  disabled: boolean;
  onSelectFile: (file: File) => void;
  onClear: () => void;
}

export function StartFramePanel({
  startFrame,
  disabled,
  onSelectFile,
  onClear,
}: StartFramePanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onSelectFile(file);
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
        <span className="font-mono text-xs text-[#94A3B8]">workflow_i2v.json</span>
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
                  PNG, JPG или WebP · передаётся в ноду LoadImage
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
    </section>
  );
}
