import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { ChevronDown, Dices, Lock, RefreshCw, Unlock } from 'lucide-react';
import {
  DURATION_CHOICES,
  FPS_CHOICES,
  RESOLUTION_PRESETS,
  RIFE_FPS_CHOICES,
  SEGMENT_DURATION_SEC,
  SHOOTING_STYLES,
  VIDEO_MODELS,
  computeUpscaleTargetSize,
  getModelOption,
  getShootingStyleOption,
  planGenerationSegments,
  secondsToAlignedFrames,
} from '../services/comfyService';
import type {
  BaseModelId,
  ConnectionInfo,
  DurationChoice,
  FpsChoice,
  GenerationSettings,
  RifeTargetFps,
  ShootingStyleId,
} from '../types/video';

interface SettingsPanelProps {
  settings: GenerationSettings;
  connection: ConnectionInfo;
  disabled: boolean;
  onChange: (patch: Partial<GenerationSettings>) => void;
  onCheckConnection: () => void;
  onRandomizeSeed: () => void;
}

function formatFramesRu(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} кадров`;
  if (mod10 === 1) return `${count} кадр`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} кадра`;
  return `${count} кадров`;
}

function formatSegmentsRu(count: number): string {
  if (count === 1) return '1 сегмент';
  if (count >= 2 && count <= 4) return `${count} сегмента`;
  return `${count} сегментов`;
}

export function SettingsPanel({
  settings,
  connection,
  disabled,
  onChange,
  onCheckConnection,
  onRandomizeSeed,
}: SettingsPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const activeModel = getModelOption(settings.modelId);
  const activeStyle = getShootingStyleOption(settings.shootingStyle);
  const upscaleTarget = computeUpscaleTargetSize(settings.width, settings.height);
  const segmentCount = planGenerationSegments(settings.durationSec, settings.mode).length;
  const framesPerSegment = secondsToAlignedFrames(SEGMENT_DURATION_SEC, settings.fps);

  const handleModelChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const nextModelId = e.target.value as BaseModelId;
    const nextModel = getModelOption(nextModelId);
    const nextFps = nextModel.defaultFps;
    onChange({
      modelId: nextModelId,
      fps: nextFps,
      frames: secondsToAlignedFrames(SEGMENT_DURATION_SEC, nextFps),
      steps: nextModel.defaultSteps,
    });
  };

  const handleDurationSelect = (sec: DurationChoice) => {
    onChange({
      durationSec: sec,
      frames: secondsToAlignedFrames(SEGMENT_DURATION_SEC, settings.fps),
    });
  };

  const handleFpsSelect = (fps: FpsChoice) => {
    onChange({
      fps,
      frames: secondsToAlignedFrames(SEGMENT_DURATION_SEC, fps),
    });
  };

  const handleResolutionChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const preset = RESOLUTION_PRESETS.find((r) => r.id === e.target.value);
    if (!preset) return;
    onChange({
      resolutionId: preset.id,
      width: preset.width,
      height: preset.height,
    });
  };

  const statusColorClass =
    connection.status === 'online'
      ? 'text-[#22C55E]'
      : connection.status === 'offline'
        ? 'text-[#EF4444]'
        : 'text-[#94A3B8]';

  const statusDotClass =
    connection.status === 'online'
      ? 'bg-[#22C55E]'
      : connection.status === 'offline'
        ? 'bg-[#EF4444]'
        : 'bg-[#64748B]';

  const statusLabel =
    connection.status === 'online'
      ? 'Online'
      : connection.status === 'offline'
        ? 'Offline'
        : connection.status === 'checking'
          ? 'Проверка...'
          : 'Не проверено';

  return (
    <section aria-labelledby="settings-heading" className="border-b border-[#222734] pb-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2
          id="settings-heading"
          className="text-sm font-semibold tracking-tight text-[#F1F5F9]"
        >
          Подключение и параметры модели
        </h2>
        <div
          className={`flex items-center gap-2 text-xs font-medium ${statusColorClass}`}
          role="status"
          aria-live="polite"
        >
          <span
            className={`h-2 w-2 rounded-full ${statusDotClass}`}
            aria-hidden="true"
          />
          <span>{statusLabel}</span>
        </div>
      </div>

      {/* Server URL + Check Connection */}
      <div className="mb-4">
        <label
          htmlFor="comfy-server-url"
          className="mb-1.5 block text-xs font-medium text-[#94A3B8]"
        >
          Адрес локального сервера ComfyUI
        </label>
        <div className="flex items-stretch gap-2">
          <input
            id="comfy-server-url"
            type="url"
            value={settings.serverUrl}
            disabled={disabled}
            onChange={(e) => onChange({ serverUrl: e.target.value })}
            placeholder="http://127.0.0.1:8188"
            className="min-w-0 flex-1 rounded-md border border-[#262C3A] bg-[#141821] px-3 py-2 font-mono text-xs text-[#F1F5F9] placeholder-[#475569] transition-colors focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={onCheckConnection}
            disabled={disabled || connection.status === 'checking'}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3.5 py-2 text-xs font-medium text-[#E2E8F0] transition-colors hover:border-[#3A4358] hover:bg-[#222838] focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${connection.status === 'checking' ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Проверить</span>
          </button>
        </div>

        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#64748B]">
          <span>Быстрый порт:</span>
          {[
            { label: '8188 · Portable', url: 'http://127.0.0.1:8188' },
            { label: '8000 · Desktop', url: 'http://127.0.0.1:8000' },
          ].map((preset) => {
            const isCurrent = settings.serverUrl.trim().replace(/\/+$/, '') === preset.url;
            return (
              <button
                key={preset.url}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ serverUrl: preset.url })}
                className={`rounded border px-2 py-0.5 font-mono text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50 ${
                  isCurrent
                    ? 'border-[#E58E26]/60 bg-[#E58E26]/10 text-[#F6AD55]'
                    : 'border-[#262C3A] bg-[#141821] text-[#94A3B8] hover:border-[#3A4358] hover:text-[#E2E8F0]'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {connection.message && (
          <p
            className={`mt-2 text-xs leading-relaxed ${
              connection.status === 'offline' ? 'text-[#F87171]' : 'text-[#94A3B8]'
            }`}
          >
            {connection.message}
            {connection.gpuName && (
              <span className="font-mono text-[#CBD5E1]">
                {' '}
                · {connection.gpuName}
                {connection.vramTotalGb ? ` (${connection.vramTotalGb} ГБ VRAM)` : ''}
              </span>
            )}
          </p>
        )}
      </div>

      {/* Duration (5 / 10 / 15 / 20 / 25 / 30s) + Base FPS (16 / 24) */}
      <div className="mb-4 space-y-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-[#94A3B8]">Длительность видео</span>
          <span className="font-mono text-[11px] tabular-nums text-[#64748B]">
            {formatSegmentsRu(segmentCount)} · {formatFramesRu(framesPerSegment)} / сегм.
          </span>
        </div>

        <div
          role="group"
          aria-label="Длительность видео"
          className="grid grid-cols-3 gap-1 rounded-md border border-[#262C3A] bg-[#141821] p-1 sm:grid-cols-6"
        >
          {DURATION_CHOICES.map((sec) => {
            const isSelected = settings.durationSec === sec;
            return (
              <button
                key={sec}
                type="button"
                disabled={disabled}
                aria-pressed={isSelected}
                aria-label={`${sec} сек`}
                onClick={() => handleDurationSelect(sec)}
                className={`whitespace-nowrap rounded py-1.5 font-mono text-xs font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50 ${
                  isSelected
                    ? 'bg-[#E58E26] text-[#0B0D11]'
                    : 'text-[#94A3B8] hover:bg-[#1E2433] hover:text-[#F1F5F9]'
                }`}
              >
                {sec}с
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-[#94A3B8]">Базовая частота (сегмент)</span>
          <div
            role="group"
            aria-label="Частота кадров FPS"
            className="grid grid-cols-2 gap-1 rounded-md border border-[#262C3A] bg-[#141821] p-1"
          >
            {FPS_CHOICES.map((fps) => {
              const isSelected = settings.fps === fps;
              return (
                <button
                  key={fps}
                  type="button"
                  disabled={disabled}
                  aria-pressed={isSelected}
                  onClick={() => handleFpsSelect(fps)}
                  className={`whitespace-nowrap rounded px-2.5 py-1 font-mono text-xs font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50 ${
                    isSelected
                      ? 'bg-[#252C3D] text-[#F8FAFC]'
                      : 'text-[#94A3B8] hover:bg-[#1E2433] hover:text-[#F1F5F9]'
                  }`}
                >
                  {fps} fps
                </button>
              );
            })}
          </div>
        </div>

        {segmentCount > 1 && (
          <p className="text-[11px] leading-relaxed text-[#94A3B8]">
            Цепочка из {segmentCount} сегментов по 5 сек: в каждый новый отрезок передаются последний
            кадр и исходные фото персонажей с фиксацией веса 0.75–0.85.
          </p>
        )}
      </div>

      {/* Parameter Grid: Resolution, Steps, Seed */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label
            htmlFor="resolution-select"
            className="mb-1.5 block text-xs font-medium text-[#94A3B8]"
          >
            Разрешение
          </label>
          <select
            id="resolution-select"
            value={settings.resolutionId}
            disabled={disabled}
            onChange={handleResolutionChange}
            className="w-full rounded-md border border-[#262C3A] bg-[#141821] px-3 py-2 font-mono text-xs tabular-nums text-[#F1F5F9] transition-colors focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
          >
            {RESOLUTION_PRESETS.map((res) => (
              <option key={res.id} value={res.id} className="bg-[#141821] text-[#F1F5F9]">
                {res.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="steps-input" className="mb-1.5 block text-xs font-medium text-[#94A3B8]">
            Шаги (Steps)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="steps-range"
              type="range"
              min={8}
              max={50}
              step={1}
              value={settings.steps}
              disabled={disabled}
              aria-label="Количество шагов сэмплинга"
              onChange={(e) => onChange({ steps: Number(e.target.value) })}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-sm bg-[#262C3A] accent-[#E58E26] disabled:opacity-50"
            />
            <input
              id="steps-input"
              type="number"
              min={8}
              max={50}
              value={settings.steps}
              disabled={disabled}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (!Number.isNaN(val)) {
                  onChange({ steps: Math.max(4, Math.min(100, val)) });
                }
              }}
              className="w-16 rounded-md border border-[#262C3A] bg-[#141821] px-2 py-1.5 text-right font-mono text-xs tabular-nums text-[#F1F5F9] focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
            />
          </div>
        </div>

        <div>
          <label htmlFor="seed-input" className="mb-1.5 block text-xs font-medium text-[#94A3B8]">
            Seed
          </label>
          <div className="flex items-stretch gap-1.5">
            <input
              id="seed-input"
              type="number"
              min={0}
              value={settings.seed}
              disabled={disabled}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (!Number.isNaN(val) && val >= 0) {
                  onChange({ seed: Math.floor(val) });
                }
              }}
              className="min-w-0 flex-1 rounded-md border border-[#262C3A] bg-[#141821] px-2.5 py-1.5 font-mono text-xs tabular-nums text-[#F1F5F9] focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
            />
            <button
              type="button"
              onClick={onRandomizeSeed}
              disabled={disabled}
              aria-label="Случайный Seed"
              title="Сгенерировать случайный Seed"
              className="inline-flex items-center justify-center rounded-md border border-[#262C3A] bg-[#1A1F2B] px-2.5 text-[#CBD5E1] transition-colors hover:border-[#3A4358] hover:text-white focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50"
            >
              <Dices className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onChange({ seedLocked: !settings.seedLocked })}
              disabled={disabled}
              aria-pressed={settings.seedLocked}
              aria-label={settings.seedLocked ? 'Разблокировать Seed' : 'Зафиксировать Seed'}
              title={
                settings.seedLocked
                  ? 'Seed зафиксирован между генерациями'
                  : 'Seed будет обновляться при каждой генерации'
              }
              className={`inline-flex items-center justify-center rounded-md border px-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50 ${
                settings.seedLocked
                  ? 'border-[#E58E26]/60 bg-[#E58E26]/15 text-[#F6AD55]'
                  : 'border-[#262C3A] bg-[#1A1F2B] text-[#94A3B8] hover:text-[#E2E8F0]'
              }`}
            >
              {settings.seedLocked ? (
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Realism & Post-Processing Block */}
      <div className="mt-5 border-t border-[#1E2330] pt-5">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold tracking-tight text-[#F1F5F9]">
            Качество и реализм
          </h3>
          <span className="font-mono text-[11px] tabular-nums text-[#64748B]">
            {settings.upscale1080p
              ? `${upscaleTarget.width}×${upscaleTarget.height}`
              : `${settings.width}×${settings.height}`}
            {' · '}
            {settings.rifeEnabled ? `${settings.rifeTargetFps} fps RIFE` : `${settings.fps} fps`}
          </span>
        </div>

        {/* Shooting Style Dropdown */}
        <div className="mb-3.5">
          <label
            htmlFor="shooting-style-select"
            className="mb-1.5 block text-xs font-medium text-[#94A3B8]"
          >
            Стиль съемки
          </label>
          <select
            id="shooting-style-select"
            value={settings.shootingStyle}
            disabled={disabled}
            onChange={(e) => onChange({ shootingStyle: e.target.value as ShootingStyleId })}
            className="w-full rounded-md border border-[#262C3A] bg-[#141821] px-3 py-2 text-xs font-medium text-[#F1F5F9] transition-colors focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
          >
            {SHOOTING_STYLES.map((style) => (
              <option key={style.id} value={style.id} className="bg-[#141821] text-[#F1F5F9]">
                {style.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-[#64748B]">{activeStyle.description}</p>
        </div>

        {/* Post-processing toggles */}
        <div className="space-y-2.5">
          <label
            htmlFor="upscale-1080p-toggle"
            className="flex cursor-pointer items-start justify-between gap-3 rounded-md border border-[#222734] bg-[#121620] px-3 py-2.5 transition-colors hover:border-[#2F374A]"
          >
            <div className="min-w-0">
              <span className="block text-xs font-medium text-[#E2E8F0]">
                Кино-апскейл до 1080p
              </span>
              <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-[#64748B]">
                Узлы #55–57 · 4x-UltraSharp → {upscaleTarget.width}×{upscaleTarget.height}
              </span>
            </div>
            <input
              id="upscale-1080p-toggle"
              type="checkbox"
              checked={settings.upscale1080p}
              disabled={disabled}
              onChange={(e) => onChange({ upscale1080p: e.target.checked })}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-[#3A4358] bg-[#0D1017] accent-[#E58E26] focus-visible:outline-2 focus-visible:outline-[#E58E26]"
            />
          </label>

          <div className="rounded-md border border-[#222734] bg-[#121620] px-3 py-2.5 transition-colors hover:border-[#2F374A]">
            <label
              htmlFor="rife-vfi-toggle"
              className="flex cursor-pointer items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <span className="block text-xs font-medium text-[#E2E8F0]">
                  Плавность 24 / 30 FPS (RIFE)
                </span>
                <span className="mt-0.5 block font-mono text-[11px] text-[#64748B]">
                  Узел #58 · интерполяция кадров RIFE VFI без дёрганости
                </span>
              </div>
              <input
                id="rife-vfi-toggle"
                type="checkbox"
                checked={settings.rifeEnabled}
                disabled={disabled}
                onChange={(e) => onChange({ rifeEnabled: e.target.checked })}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-[#3A4358] bg-[#0D1017] accent-[#E58E26] focus-visible:outline-2 focus-visible:outline-[#E58E26]"
              />
            </label>

            {settings.rifeEnabled && (
              <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[#1E2330] pt-2.5">
                <span className="text-[11px] text-[#94A3B8]">Целевая частота RIFE</span>
                <div
                  role="group"
                  aria-label="Целевая частота кадров RIFE"
                  className="grid grid-cols-2 gap-1 rounded-md border border-[#262C3A] bg-[#0D1017] p-0.5"
                >
                  {RIFE_FPS_CHOICES.map((targetFps: RifeTargetFps) => {
                    const isSelected = settings.rifeTargetFps === targetFps;
                    return (
                      <button
                        key={targetFps}
                        type="button"
                        disabled={disabled}
                        aria-pressed={isSelected}
                        onClick={() => onChange({ rifeTargetFps: targetFps })}
                        className={`whitespace-nowrap rounded px-2.5 py-1 font-mono text-[11px] font-medium tabular-nums transition-colors ${
                          isSelected
                            ? 'bg-[#E58E26] text-[#0B0D11]'
                            : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                        }`}
                      >
                        {targetFps} fps
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Collapsible Advanced Settings (Auto-Model Routing default) */}
      <div className="mt-5 border-t border-[#1E2330] pt-4">
        <button
          type="button"
          onClick={() => setShowAdvanced((prev) => !prev)}
          aria-expanded={showAdvanced}
          aria-controls="advanced-settings-panel"
          className="flex w-full items-center justify-between gap-2 text-left text-xs font-medium text-[#94A3B8] transition-colors hover:text-[#E2E8F0] focus-visible:outline-2 focus-visible:outline-[#E58E26]"
        >
          <span>Расширенные настройки</span>
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-[#64748B]">
            <span>{activeModel.shortLabel}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </span>
        </button>

        {showAdvanced && (
          <div id="advanced-settings-panel" className="mt-3 space-y-2">
            <label
              htmlFor="base-model-select"
              className="block text-xs font-medium text-[#94A3B8]"
            >
              Выбор видеомодели
            </label>
            <select
              id="base-model-select"
              value={settings.modelId}
              disabled={disabled}
              onChange={handleModelChange}
              className="w-full rounded-md border border-[#262C3A] bg-[#141821] px-3 py-2 text-xs font-medium text-[#F1F5F9] transition-colors focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
            >
              {VIDEO_MODELS.map((model) => (
                <option key={model.id} value={model.id} className="bg-[#141821] text-[#F1F5F9]">
                  {model.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] leading-relaxed text-[#64748B]">{activeModel.vramHint}</p>
          </div>
        )}
      </div>
    </section>
  );
}
