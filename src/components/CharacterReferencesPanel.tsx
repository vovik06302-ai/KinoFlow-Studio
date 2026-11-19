import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import type { CharacterReference } from '../types/video';

interface CharacterReferencesPanelProps {
  characters: CharacterReference[];
  maxCharacters?: number;
  disabled: boolean;
  onAddFiles: (files: File[]) => void;
  onUpdateCharacter: (id: string, patch: Partial<Pick<CharacterReference, 'name' | 'weight'>>) => void;
  onRemoveCharacter: (id: string) => void;
}

const DEFAULT_NAME_PLACEHOLDERS = ['Марина', 'Владимир', 'Алексей'];

export function CharacterReferencesPanel({
  characters,
  maxCharacters = 3,
  disabled,
  onAddFiles,
  onUpdateCharacter,
  onRemoveCharacter,
}: CharacterReferencesPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const remainingSlots = Math.max(0, maxCharacters - characters.length);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      onAddFiles(files);
    }
    e.target.value = '';
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled || remainingSlots === 0) return;

    const droppedFiles = Array.from(e.dataTransfer.files).filter((file) =>
      file.type.startsWith('image/'),
    );
    if (droppedFiles.length > 0) {
      onAddFiles(droppedFiles);
    }
  };

  return (
    <section aria-labelledby="characters-heading" className="border-b border-[#222734] py-6">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2
          id="characters-heading"
          className="text-sm font-semibold tracking-tight text-[#F1F5F9]"
        >
          Референсы персонажей
        </h2>
        <span className="font-mono text-xs tabular-nums text-[#94A3B8]">
          {characters.length} / {maxCharacters} · IP-Adapter / FaceID
        </span>
      </div>

      {remainingSlots > 0 && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`mb-4 rounded-lg border border-dashed p-4 transition-colors ${
            isDragging
              ? 'border-[#E58E26] bg-[#E58E26]/10'
              : 'border-[#2D3546] bg-[#11151E] hover:border-[#424E66]'
          }`}
        >
          <input
            ref={fileInputRef}
            id="character-upload-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled}
            onChange={handleFileChange}
            className="sr-only"
          />
          <div className="flex flex-col items-center justify-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#1A202D] text-[#94A3B8]">
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-medium text-[#E2E8F0]">
                  Перетащите фото персонажей сюда
                </p>
                <p className="text-[11px] text-[#64748B]">
                  PNG, JPG или WebP · ещё {remainingSlots}{' '}
                  {remainingSlots === 1 ? 'слот' : 'слота'}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3.5 py-2 text-xs font-medium text-[#E2E8F0] transition-colors hover:border-[#3A4358] hover:bg-[#222838] focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50"
            >
              Выбрать фото
            </button>
          </div>
        </div>
      )}

      {characters.length === 0 ? (
        <p className="text-xs leading-relaxed text-[#64748B]">
          Загрузите портреты персонажей, чтобы зафиксировать их внешность в сцене через IP-Adapter /
          FaceID и сохранить имена при улучшении промпта.
        </p>
      ) : (
        <ul className="divide-y divide-[#1E2330]" data-testid="character-list">
          {characters.map((char, index) => {
            const placeholder = DEFAULT_NAME_PLACEHOLDERS[index] ?? `Персонаж ${index + 1}`;
            const displayName = char.name.trim() || placeholder;
            return (
              <li key={char.id} className="flex items-start gap-3.5 py-3.5 first:pt-1 last:pb-0">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-[#262C3A] bg-[#141821]">
                  <img
                    src={char.previewUrl}
                    alt={`Референс персонажа ${displayName}`}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                </div>

                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <label htmlFor={`char-name-${char.id}`} className="sr-only">
                      Имя персонажа {index + 1}
                    </label>
                    <input
                      id={`char-name-${char.id}`}
                      type="text"
                      value={char.name}
                      disabled={disabled}
                      onChange={(e) => onUpdateCharacter(char.id, { name: e.target.value })}
                      placeholder={`Имя (например, ${placeholder})`}
                      className="min-w-0 flex-1 rounded-md border border-[#262C3A] bg-[#141821] px-2.5 py-1.5 text-xs font-medium text-[#F1F5F9] placeholder-[#475569] focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
                    />
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onRemoveCharacter(char.id)}
                      aria-label={`Удалить референс «${displayName}»`}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-[#64748B] transition-colors hover:border-[#3B1F24] hover:bg-[#2A1519] hover:text-[#F87171] focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    <label
                      htmlFor={`char-weight-${char.id}`}
                      className="shrink-0 text-[11px] text-[#94A3B8]"
                    >
                      Вес IP-Adapter
                    </label>
                    <input
                      id={`char-weight-${char.id}`}
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={char.weight}
                      disabled={disabled}
                      onChange={(e) =>
                        onUpdateCharacter(char.id, { weight: Number(e.target.value) })
                      }
                      className="h-1.5 flex-1 cursor-pointer appearance-none rounded-sm bg-[#262C3A] accent-[#E58E26] disabled:opacity-50"
                    />
                    <span className="w-9 text-right font-mono text-xs tabular-nums text-[#E2E8F0]">
                      {char.weight.toFixed(2)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
