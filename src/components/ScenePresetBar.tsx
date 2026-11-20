import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Download, Upload } from 'lucide-react';
import { parseScenePreset } from '../services/scenePreset';
import type { ScenePreset } from '../services/scenePreset';

interface ScenePresetBarProps {
  disabled?: boolean;
  onExport: () => string;
  onImport: (preset: ScenePreset) => void;
}

/** Saves the current scene (prompts, storyboard, camera, main settings) to a JSON file and back. */
export function ScenePresetBar({ disabled = false, onExport, onImport }: ScenePresetBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const handleExport = () => {
    const blob = new Blob([onExport()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'kinoflow_scene_preset.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    setMessage({ kind: 'ok', text: 'Пресет сохранён в файл kinoflow_scene_preset.json.' });
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      onImport(parseScenePreset(await file.text()));
      setMessage({ kind: 'ok', text: `Пресет «${file.name}» загружен.` });
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Не удалось прочитать пресет.',
      });
    }
  };

  return (
    <section aria-label="Пресеты сцен" className="mt-6 border-t border-[#1D222E] pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight text-[#F1F5F9]">Пресет сцены</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3 py-1.5 text-xs font-medium text-[#E2E8F0] hover:bg-[#222838]"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Экспорт</span>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3 py-1.5 text-xs font-medium text-[#E2E8F0] hover:bg-[#222838] disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Импорт</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void handleFile(event)}
          />
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-[#64748B]">
        В файл попадают описание, раскадровка, камера и основные настройки. Адрес сервера, папки и
        фото не сохраняются.
      </p>
      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`mt-2 text-[11px] ${message.kind === 'error' ? 'text-[#FCA5A5]' : 'text-[#9AE6B4]'}`}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
