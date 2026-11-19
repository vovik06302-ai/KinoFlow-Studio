import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { buildWorkflowFromTemplate, getRawWorkflowTemplate } from '../services/comfyService';
import type {
  CharacterReference,
  GenerationMode,
  GenerationSettings,
  StartFrameReference,
} from '../types/video';

interface WorkflowInspectorViewProps {
  settings: GenerationSettings;
  prompt: string;
  negativePrompt: string;
  characters: CharacterReference[];
  startFrame: StartFrameReference | null;
}

export function WorkflowInspectorView({
  settings,
  prompt,
  negativePrompt,
  characters,
  startFrame,
}: WorkflowInspectorViewProps) {
  const [workflowKind, setWorkflowKind] = useState<GenerationMode>(settings.mode);
  const [mode, setMode] = useState<'rendered' | 'template'>('rendered');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setWorkflowKind(settings.mode);
  }, [settings.mode]);

  const jsonOutput = useMemo(() => {
    if (mode === 'template') {
      return JSON.stringify(getRawWorkflowTemplate(workflowKind), null, 2);
    }

    const built = buildWorkflowFromTemplate({
      settings,
      modeOverride: workflowKind,
      positivePrompt: prompt || '(пустой промпт — введите описание сцены в Студии)',
      negativePrompt,
      hasStartFrame: workflowKind === 'i2v',
      startFrameFilename:
        workflowKind === 'i2v'
          ? startFrame
            ? `kinoflow_start/${startFrame.file.name}`
            : 'kinoflow_chain/last_frame.png'
          : undefined,
      characters: characters.map((c, idx) => ({
        name: c.name.trim() || `Персонаж ${idx + 1}`,
        weight: c.weight,
        imageFilename: c.uploadedFilename || `kinoflow_refs/${c.file.name}`,
      })),
    });

    return JSON.stringify(built, null, 2);
  }, [mode, workflowKind, settings, prompt, negativePrompt, characters, startFrame]);

  const activeFileName = workflowKind === 'i2v' ? 'workflow_i2v.json' : 'workflow_t2v.json';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonOutput);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable in restricted contexts
    }
  };

  const handleDownloadJson = () => {
    const blob = new Blob([jsonOutput], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download =
      mode === 'template' ? activeFileName : activeFileName.replace('.json', '_configured.json');
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-[#222734] pb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#F8FAFC]">
            Шаблоны ComfyUI API ({activeFileName})
          </h1>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-[#94A3B8]">
            Для старта по тексту используется <span className="font-mono text-[#CBD5E1]">workflow_t2v.json</span>,
            а для оживления фото и цепочки сегментов (10–30 сек и безлимитного продолжения) —{' '}
            <span className="font-mono text-[#CBD5E1]">workflow_i2v.json</span> с{' '}
            <span className="font-mono text-[#F6AD55]">LoadImage (#7)</span>, апскейлом 1080p (
            <span className="font-mono text-[#F6AD55]">#55–57</span>) и{' '}
            <span className="font-mono text-[#F6AD55]">RIFE VFI (#58)</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border border-[#262C3A] bg-[#11151E] p-0.5">
            <button
              type="button"
              onClick={() => setWorkflowKind('t2v')}
              className={`whitespace-nowrap rounded px-3 py-1.5 font-mono text-xs font-medium transition-colors ${
                workflowKind === 't2v'
                  ? 'bg-[#E58E26] text-[#0B0D11]'
                  : 'text-[#94A3B8] hover:text-[#E2E8F0]'
              }`}
            >
              workflow_t2v.json
            </button>
            <button
              type="button"
              onClick={() => setWorkflowKind('i2v')}
              className={`whitespace-nowrap rounded px-3 py-1.5 font-mono text-xs font-medium transition-colors ${
                workflowKind === 'i2v'
                  ? 'bg-[#E58E26] text-[#0B0D11]'
                  : 'text-[#94A3B8] hover:text-[#E2E8F0]'
              }`}
            >
              workflow_i2v.json
            </button>
          </div>

          <div className="flex items-center rounded-md border border-[#262C3A] bg-[#11151E] p-0.5">
            <button
              type="button"
              onClick={() => setMode('rendered')}
              className={`whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === 'rendered'
                  ? 'bg-[#222838] text-[#F8FAFC]'
                  : 'text-[#94A3B8] hover:text-[#E2E8F0]'
              }`}
            >
              Текущие параметры
            </button>
            <button
              type="button"
              onClick={() => setMode('template')}
              className={`whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === 'template'
                  ? 'bg-[#222838] text-[#F8FAFC]'
                  : 'text-[#94A3B8] hover:text-[#E2E8F0]'
              }`}
            >
              Исходный шаблон
            </button>
          </div>

          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3 py-1.5 text-xs font-medium text-[#E2E8F0] transition-colors hover:bg-[#222838]"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-[#22C55E]" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{copied ? 'Скопировано' : 'Копировать JSON'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadJson}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3 py-1.5 text-xs font-medium text-[#E2E8F0] transition-colors hover:bg-[#222838]"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Скачать JSON</span>
          </button>
        </div>
      </div>

      {/* Node Injection Reference Summary */}
      <div className="mb-6 grid grid-cols-1 gap-4 border-b border-[#222734] pb-6 sm:grid-cols-3">
        <div>
          <p className="font-mono text-xs font-medium text-[#F6AD55]">Узлы 1–4, 30, 40–41</p>
          <p className="mt-1 text-xs leading-relaxed text-[#94A3B8]">
            Модель ({workflowKind === 'i2v' ? 'I2V' : 'T2V'} Wan 2.2 / CogVideoX), UMT5-XXL в RAM,
            Video VAE и сэмплинг 5-секундных сегментов (<span className="font-mono">81 / 121</span>{' '}
            кадров).
          </p>
        </div>
        <div>
          <p className="font-mono text-xs font-medium text-[#F6AD55]">
            {workflowKind === 'i2v' ? 'Узлы 7–8 и 10–22' : 'Узлы 10–12 и 20–22'}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[#94A3B8]">
            {workflowKind === 'i2v'
              ? 'Стартовый кадр (#7) + исходные референсы персонажей (#10–12, #20–22) с защитой веса 0.75–0.85 на каждом новом сегменте.'
              : 'До 3 исходных фото персонажей (/upload/image) и веса IP-Adapter / FaceID. Пустые слоты вырезаются.'}
          </p>
        </div>
        <div>
          <p className="font-mono text-xs font-medium text-[#F6AD55]">Узлы 55–57, 58, 60</p>
          <p className="mt-1 text-xs leading-relaxed text-[#94A3B8]">
            Постобработка: нейро-апскейл <span className="font-mono">1080p</span> (#55–57),
            интерполяция <span className="font-mono">RIFE VFI</span> 24/30 FPS (#58) и экспорт{' '}
            <span className="font-mono">.mp4</span> (#60).
          </p>
        </div>
      </div>

      <pre className="max-h-[620px] overflow-auto rounded-lg border border-[#222734] bg-[#0F1219] p-4 font-mono text-xs leading-relaxed text-[#CBD5E1]">
        <code>{jsonOutput}</code>
      </pre>
    </div>
  );
}
