import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, RotateCcw, Wand2 } from 'lucide-react';
import { LIGHTING_PRESETS } from '../../serverPromptHelper';
import { PROMPT_TEMPLATES, appendPromptTemplate } from '../services/promptTemplates';
import { CAMERA_PRESETS } from '../services/storyboard';
import type { CameraPresetId } from '../services/storyboard';
import type { CharacterReference } from '../types/video';

interface PromptWorkspaceProps {
  prompt: string;
  originalPromptBeforeEnhance: string | null;
  negativePrompt: string;
  characters: CharacterReference[];
  cameraPreset: CameraPresetId;
  lightingPreset: string;
  enhanceSourceLabel?: string | null;
  isEnhancing: boolean;
  enhanceError: string | null;
  offlineMode?: boolean;
  hasLocalLlm?: boolean;
  disabled: boolean;
  onPromptChange: (value: string) => void;
  onNegativePromptChange: (value: string) => void;
  onCameraPresetChange: (camera: CameraPresetId) => void;
  onLightingPresetChange: (lightingCue: string) => void;
  onEnhancePrompt: () => void;
  onRevertEnhancedPrompt: () => void;
}

export function PromptWorkspace({
  prompt,
  originalPromptBeforeEnhance,
  negativePrompt,
  characters,
  cameraPreset,
  lightingPreset,
  enhanceSourceLabel,
  isEnhancing,
  enhanceError,
  offlineMode = false,
  hasLocalLlm = false,
  disabled,
  onPromptChange,
  onNegativePromptChange,
  onCameraPresetChange,
  onLightingPresetChange,
  onEnhancePrompt,
  onRevertEnhancedPrompt,
}: PromptWorkspaceProps) {
  const [showNegative, setShowNegative] = useState(false);
  const namedCharacters = characters.filter((c) => c.name.trim().length > 0);

  const enhanceHint = hasLocalLlm
    ? 'Улучшение промпта через локальную LLM (автономно)'
    : offlineMode
      ? 'Автономный кинематографический конструктор промпта (без интернета)'
      : 'Камера и освещение применяются сразу к генерации и при улучшении промпта';

  return (
    <section aria-label="Рабочая область промптов" className="pt-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <label
          htmlFor="scene-prompt-textarea"
          className="text-sm font-semibold tracking-tight text-[#F1F5F9]"
        >
          Описание сцены
        </label>
        <div className="flex items-center gap-2">
          {originalPromptBeforeEnhance !== null && (
            <button
              type="button"
              onClick={onRevertEnhancedPrompt}
              disabled={disabled || isEnhancing}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-[#94A3B8] transition-colors hover:bg-[#1A1F2B] hover:text-[#E2E8F0] focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              <span>Вернуть исходный</span>
            </button>
          )}
          <button
            type="button"
            onClick={onEnhancePrompt}
            disabled={disabled || isEnhancing || !prompt.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-[#E58E26]/45 bg-[#E58E26]/12 px-3 py-1.5 text-xs font-medium text-[#F6AD55] transition-colors hover:bg-[#E58E26]/20 focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isEnhancing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{isEnhancing ? 'Улучшение...' : 'Улучшить промпт'}</span>
          </button>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="prompt-camera-select"
            className="text-[11px] uppercase tracking-wider text-[#94A3B8]"
          >
            Движение камеры
          </label>
          <select
            id="prompt-camera-select"
            value={cameraPreset}
            disabled={disabled}
            onChange={(e) => onCameraPresetChange(e.target.value as CameraPresetId)}
            className="w-full rounded-md border border-[#262C3A] bg-[#141821] px-2 py-1.5 text-xs text-[#F1F5F9] outline-none focus:border-[#E58E26] disabled:opacity-60"
          >
            {CAMERA_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id} className="bg-[#141821] text-[#F1F5F9]">
                {preset.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="prompt-lighting-select"
            className="text-[11px] uppercase tracking-wider text-[#94A3B8]"
          >
            Освещение
          </label>
          <select
            id="prompt-lighting-select"
            value={lightingPreset}
            disabled={disabled}
            onChange={(e) => onLightingPresetChange(e.target.value)}
            className="w-full rounded-md border border-[#262C3A] bg-[#141821] px-2 py-1.5 text-xs text-[#F1F5F9] outline-none focus:border-[#E58E26] disabled:opacity-60"
          >
            <option value="" className="bg-[#141821] text-[#F1F5F9]">
              По умолчанию (из стиля)
            </option>
            {LIGHTING_PRESETS.map((l) => (
              <option key={l.cue} value={l.cue} className="bg-[#141821] text-[#F1F5F9]">
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-1.5">
        <label
          htmlFor="prompt-template-select"
          className="text-[11px] uppercase tracking-wider text-[#94A3B8]"
        >
          Шаблон промпта
        </label>
        <select
          id="prompt-template-select"
          value=""
          disabled={disabled || isEnhancing}
          onChange={(e) => {
            const templateId = e.target.value;
            if (!templateId) return;
            onPromptChange(appendPromptTemplate(prompt, templateId));
          }}
          className="w-full rounded-md border border-[#262C3A] bg-[#141821] px-2.5 py-1.5 text-xs text-[#F1F5F9] outline-none focus:border-[#E58E26] disabled:opacity-60"
        >
          <option value="" className="bg-[#141821] text-[#94A3B8]">
            Добавить готовый шаблон к промпту...
          </option>
          {PROMPT_TEMPLATES.map((template) => (
            <option key={template.id} value={template.id} className="bg-[#141821] text-[#F1F5F9]">
              {template.label}
            </option>
          ))}
        </select>
      </div>

      <textarea
        id="scene-prompt-textarea"
        rows={5}
        value={prompt}
        disabled={disabled || isEnhancing}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder="Опишите движение камеры, освещение и действия персонажей..."
        className="w-full resize-y rounded-md border border-[#262C3A] bg-[#141821] px-3.5 py-2.5 text-sm leading-relaxed text-[#F1F5F9] placeholder-[#475569] transition-colors focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B]">
        <span>
          {enhanceSourceLabel
            ? enhanceSourceLabel
            : namedCharacters.length > 0
              ? `Персонаж в промпте: ${namedCharacters.map((c) => c.name.trim()).join(', ')}`
              : enhanceHint}
        </span>
        <span className="font-mono tabular-nums">{prompt.length} симв.</span>
      </div>

      {enhanceError && (
        <div
          role="alert"
          className="mt-3 rounded-md border border-[#7F1D1D] bg-[#2A1215] px-3 py-2 text-xs text-[#FCA5A5]"
        >
          {enhanceError}
        </div>
      )}

      <div className="mt-4 border-t border-[#1D222E] pt-3">
        <button
          type="button"
          onClick={() => setShowNegative((prev) => !prev)}
          aria-expanded={showNegative}
          aria-controls="negative-prompt-panel"
          className="flex w-full items-center justify-between py-1 text-left text-xs font-medium text-[#94A3B8] transition-colors hover:text-[#E2E8F0] focus-visible:outline-2 focus-visible:outline-[#E58E26]"
        >
          <span>Негативный промпт (Negative Prompt)</span>
          {showNegative ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>

        {showNegative && (
          <div id="negative-prompt-panel" className="mt-2">
            <label htmlFor="negative-prompt-textarea" className="sr-only">
              Негативный промпт
            </label>
            <textarea
              id="negative-prompt-textarea"
              rows={3}
              value={negativePrompt}
              disabled={disabled}
              onChange={(e) => onNegativePromptChange(e.target.value)}
              placeholder="static, blurry, deformed hands, watermark..."
              className="w-full resize-y rounded-md border border-[#262C3A] bg-[#141821] px-3 py-2 font-mono text-xs leading-relaxed text-[#CBD5E1] placeholder-[#475569] transition-colors focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
            />
          </div>
        )}
      </div>
    </section>
  );
}
