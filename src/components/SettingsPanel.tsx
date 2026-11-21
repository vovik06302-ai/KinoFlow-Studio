import { useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Dices,
  Lock,
  RefreshCw,
  ShieldCheck,
  Unlock,
  Zap,
} from 'lucide-react';
import {
  DURATION_CHOICES,
  FPS_CHOICES,
  RESOLUTION_PRESETS,
  SAMPLER_CHOICES,
  SCHEDULER_CHOICES,
  SEGMENT_DURATION_SEC,
  SHOOTING_STYLES,
  VIDEO_MODELS,
  computeUpscaleTargetSize,
  getModelOption,
  getShootingStyleOption,
  planGenerationSegments,
  secondsToAlignedFrames,
} from '../services/comfyService';
import { estimateVramUsage } from '../services/vramEstimator';
import type {
  BaseModelId,
  ConnectionInfo,
  DurationChoice,
  FpsChoice,
  GenerationSettings,
  SamplerName,
  SchedulerName,
  ShootingStyleId,
} from '../types/video';

interface SettingsPanelProps {
  settings: GenerationSettings;
  connection: ConnectionInfo;
  availableLoras?: string[];
  isLoadingLoras?: boolean;
  disabled: boolean;
  onChange: (patch: Partial<GenerationSettings>) => void;
  onCheckConnection: () => void;
  onRefreshLoras?: () => void;
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
  availableLoras = [],
  isLoadingLoras = false,
  disabled,
  onChange,
  onCheckConnection,
  onRefreshLoras,
  onRandomizeSeed,
}: SettingsPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const activeModel = getModelOption(settings.modelId);
  const activeStyle = getShootingStyleOption(settings.shootingStyle);
  const upscaleTarget = computeUpscaleTargetSize(settings.width, settings.height);
  const segmentCount = planGenerationSegments(settings.durationSec, settings.mode).length;
  const framesPerSegment = secondsToAlignedFrames(SEGMENT_DURATION_SEC, settings.fps);

  const vramEstimate = estimateVramUsage({
    modelId: settings.modelId,
    width: settings.width,
    height: settings.height,
    frames: framesPerSegment,
    upscale1080p: settings.upscale1080p,
    rifeEnabled: settings.rifeEnabled,
    fastLightX2V: settings.fastLightX2V,
    vramTotalGb: connection.vramTotalGb,
  });

  const handleToggleLightX2V = (enabled: boolean) => {
    if (enabled) {
      onChange({
        fastLightX2V: true,
        steps: settings.steps > 8 ? 6 : Math.max(4, settings.steps),
        cfg: 1.0,
        cfgLow: 1.0,
        flowShift: settings.flowShift ?? 5.0,
      });
    } else {
      onChange({
        fastLightX2V: false,
        steps: settings.steps <= 8 ? activeModel.defaultSteps : settings.steps,
        cfg: undefined,
        cfgLow: undefined,
      });
    }
  };

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

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#64748B]">
          <span>Быстрый порт:</span>
          {[
            { label: '8188 · Portable', url: 'http://127.0.0.1:8188' },
            { label: '8000 · Desktop', url: 'http://127.0.0.1:8000' },
            { label: '8189 · Вторая карта', url: 'http://127.0.0.1:8189' },
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
            Цепочка из {segmentCount} сегментов по 5 сек: последний кадр каждого отрезка передаётся
            в следующий сегмент (I2V), а каждый готовый сегмент сохраняется автоматически.
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
              min={settings.fastLightX2V ? 4 : 8}
              max={settings.fastLightX2V ? 12 : 50}
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
              min={4}
              max={50}
              value={settings.steps}
              disabled={disabled}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (!Number.isNaN(val)) {
                  onChange({ steps: Math.max(4, Math.min(100, Math.round(val))) });
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

      {/* VRAM Usage Estimator & OOM Safety Guard */}
      <div
        data-testid="vram-estimate-banner"
        className={`mt-4 rounded-md border px-3 py-2.5 text-xs ${
          vramEstimate.level === 'oom_risk'
            ? 'border-[#7F1D1D] bg-[#241013] text-[#FCA5A5]'
            : vramEstimate.level === 'tight'
              ? 'border-[#784A18] bg-[#22170A] text-[#FBD38D]'
              : 'border-[#222734] bg-[#121620] text-[#94A3B8]'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            {vramEstimate.level === 'ok' ? (
              <ShieldCheck
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#22C55E]"
                aria-hidden="true"
              />
            ) : (
              <AlertTriangle
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                  vramEstimate.level === 'oom_risk' ? 'text-[#EF4444]' : 'text-[#F59E0B]'
                }`}
                aria-hidden="true"
              />
            )}
            <div className="min-w-0">
              <p className="font-mono text-[11px] font-medium text-[#E2E8F0]">
                {vramEstimate.headline}
              </p>
              {vramEstimate.recommendation && (
                <p className="mt-1 text-[11px] leading-relaxed opacity-90">
                  {vramEstimate.recommendation}
                </p>
              )}
            </div>
          </div>
          {vramEstimate.safePatch && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(vramEstimate.safePatch!)}
              className="shrink-0 whitespace-nowrap rounded border border-[#E58E26]/60 bg-[#E58E26]/15 px-2.5 py-1 text-[11px] font-semibold text-[#F6AD55] transition-colors hover:bg-[#E58E26]/25 disabled:opacity-50"
            >
              Безопасные параметры
            </button>
          )}
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
            {settings.rifeEnabled ? `${settings.fps * 2} fps RIFE` : `${settings.fps} fps`}
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

        {/* Post-processing & Acceleration toggles */}
        <div className="space-y-2.5">
          <label
            htmlFor="lightx2v-turbo-toggle"
            className={`flex cursor-pointer items-start justify-between gap-3 rounded-md border px-3 py-2.5 transition-colors ${
              settings.fastLightX2V
                ? 'border-[#E58E26]/55 bg-[#1D160D]'
                : 'border-[#222734] bg-[#121620] hover:border-[#2F374A]'
            }`}
          >
            <div className="min-w-0">
              <span className="flex items-center gap-1.5 text-xs font-medium text-[#E2E8F0]">
                <Zap className="h-3.5 w-3.5 text-[#F6AD55]" aria-hidden="true" />
                <span>Турбо-режим LightX2V (4–8 шагов · ×3–4 быстрее)</span>
              </span>
              <span className="mt-0.5 block font-mono text-[11px] text-[#64748B]">
                Узлы #105–106 · LoRA-дистилляция Wan 2.2 · CFG 1.0 · скачать в «Модели и установка»
              </span>
            </div>
            <input
              id="lightx2v-turbo-toggle"
              type="checkbox"
              checked={Boolean(settings.fastLightX2V)}
              disabled={disabled}
              onChange={(e) => handleToggleLightX2V(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-[#3A4358] bg-[#0D1017] accent-[#E58E26] focus-visible:outline-2 focus-visible:outline-[#E58E26]"
            />
          </label>

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
                  Плавность ×2 (RIFE)
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
              <p className="mt-2.5 border-t border-[#1E2330] pt-2.5 text-[11px] text-[#94A3B8]">
                Кадров вдвое больше, поэтому частота на выходе {settings.fps * 2} fps. Длительность
                ролика не меняется.
              </p>
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
          <div id="advanced-settings-panel" className="mt-3 space-y-4">
            <div className="space-y-2">
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

            {/* Fine Sampler Controls (CFG High/Low, Flow Shift, Sampler, Scheduler) */}
            <div className="space-y-3 border-t border-[#1E2330] pt-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#E2E8F0]">
                  Сэмплер, CFG и Flow Shift
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      cfg: settings.fastLightX2V ? 1.0 : 3.5,
                      cfgLow: settings.fastLightX2V ? 1.0 : 3.5,
                      flowShift: 5.0,
                      samplerName: 'uni_pc',
                      scheduler: 'simple',
                    })
                  }
                  className="text-[11px] text-[#64748B] transition-colors hover:text-[#CBD5E1] disabled:opacity-50"
                >
                  Сбросить
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="cfg-high-input"
                    className="mb-1 block text-[11px] text-[#94A3B8]"
                  >
                    CFG High
                  </label>
                  <input
                    id="cfg-high-input"
                    type="number"
                    min={1}
                    max={12}
                    step={0.5}
                    value={settings.cfg ?? (settings.fastLightX2V ? 1.0 : 3.5)}
                    disabled={disabled}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (!Number.isNaN(val)) {
                        onChange({ cfg: Math.max(1, Math.min(12, val)) });
                      }
                    }}
                    className="w-full rounded-md border border-[#262C3A] bg-[#141821] px-2.5 py-1.5 font-mono text-xs tabular-nums text-[#F1F5F9] focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
                  />
                </div>

                <div>
                  <label
                    htmlFor="cfg-low-input"
                    className="mb-1 block text-[11px] text-[#94A3B8]"
                  >
                    CFG Low
                  </label>
                  <input
                    id="cfg-low-input"
                    type="number"
                    min={1}
                    max={12}
                    step={0.5}
                    value={settings.cfgLow ?? settings.cfg ?? (settings.fastLightX2V ? 1.0 : 3.5)}
                    disabled={disabled}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (!Number.isNaN(val)) {
                        onChange({ cfgLow: Math.max(1, Math.min(12, val)) });
                      }
                    }}
                    className="w-full rounded-md border border-[#262C3A] bg-[#141821] px-2.5 py-1.5 font-mono text-xs tabular-nums text-[#F1F5F9] focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
                  />
                </div>

                <div>
                  <label
                    htmlFor="flow-shift-input"
                    className="mb-1 block text-[11px] text-[#94A3B8]"
                  >
                    Flow Shift
                  </label>
                  <input
                    id="flow-shift-input"
                    type="number"
                    min={1}
                    max={12}
                    step={0.5}
                    value={settings.flowShift ?? 5.0}
                    disabled={disabled}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (!Number.isNaN(val)) {
                        onChange({ flowShift: Math.max(1, Math.min(12, val)) });
                      }
                    }}
                    className="w-full rounded-md border border-[#262C3A] bg-[#141821] px-2.5 py-1.5 font-mono text-xs tabular-nums text-[#F1F5F9] focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="sampler-select"
                    className="mb-1 block text-[11px] text-[#94A3B8]"
                  >
                    Сэмплер
                  </label>
                  <select
                    id="sampler-select"
                    value={settings.samplerName ?? 'uni_pc'}
                    disabled={disabled}
                    onChange={(e) => onChange({ samplerName: e.target.value as SamplerName })}
                    className="w-full rounded-md border border-[#262C3A] bg-[#141821] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9] focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
                  >
                    {SAMPLER_CHOICES.map((sampler) => (
                      <option
                        key={sampler}
                        value={sampler}
                        className="bg-[#141821] text-[#F1F5F9]"
                      >
                        {sampler}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="scheduler-select"
                    className="mb-1 block text-[11px] text-[#94A3B8]"
                  >
                    Планировщик (Scheduler)
                  </label>
                  <select
                    id="scheduler-select"
                    value={settings.scheduler ?? 'simple'}
                    disabled={disabled}
                    onChange={(e) => onChange({ scheduler: e.target.value as SchedulerName })}
                    className="w-full rounded-md border border-[#262C3A] bg-[#141821] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9] focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
                  >
                    {SCHEDULER_CHOICES.map((sched) => (
                      <option
                        key={sched}
                        value={sched}
                        className="bg-[#141821] text-[#F1F5F9]"
                      >
                        {sched}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Custom LoRA Loader (LoraLoaderModelOnly) */}
            <div className="space-y-2.5 border-t border-[#1E2330] pt-3.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="custom-lora-select" className="text-xs font-medium text-[#E2E8F0]">
                  Пользовательская LoRA (models/loras)
                </label>
                {onRefreshLoras && (
                  <button
                    type="button"
                    disabled={disabled || isLoadingLoras}
                    onClick={onRefreshLoras}
                    className="inline-flex items-center gap-1 text-[11px] text-[#94A3B8] transition-colors hover:text-[#E2E8F0] disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${isLoadingLoras ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>Обновить список</span>
                  </button>
                )}
              </div>

              <select
                id="custom-lora-select"
                value={settings.customLoraName ?? ''}
                disabled={disabled}
                onChange={(e) => onChange({ customLoraName: e.target.value })}
                className="w-full rounded-md border border-[#262C3A] bg-[#141821] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9] focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
              >
                <option value="" className="bg-[#141821] text-[#94A3B8]">
                  Без дополнительной LoRA
                </option>
                {availableLoras.map((lora) => (
                  <option key={lora} value={lora} className="bg-[#141821] text-[#F1F5F9]">
                    {lora}
                  </option>
                ))}
                {settings.customLoraName &&
                  !availableLoras.includes(settings.customLoraName) && (
                    <option
                      value={settings.customLoraName}
                      className="bg-[#141821] text-[#F1F5F9]"
                    >
                      {settings.customLoraName}
                    </option>
                  )}
              </select>

              {settings.customLoraName && (
                <div className="flex items-center gap-2.5">
                  <label
                    htmlFor="custom-lora-strength"
                    className="shrink-0 text-[11px] text-[#94A3B8]"
                  >
                    Сила LoRA
                  </label>
                  <input
                    id="custom-lora-strength"
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={settings.customLoraStrength ?? 0.8}
                    disabled={disabled}
                    onChange={(e) => onChange({ customLoraStrength: Number(e.target.value) })}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-sm bg-[#262C3A] accent-[#E58E26]"
                  />
                  <span className="w-9 text-right font-mono text-xs tabular-nums text-[#E2E8F0]">
                    {(settings.customLoraStrength ?? 0.8).toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            {/* I2V Crop & Long-Chain Color-Drift Mitigation */}
            <div className="space-y-2 border-t border-[#1E2330] pt-3.5">
              <label
                htmlFor="auto-crop-i2v-toggle"
                className="flex cursor-pointer items-start justify-between gap-3 rounded-md border border-[#222734] bg-[#121620] px-3 py-2 transition-colors hover:border-[#2F374A]"
              >
                <div className="min-w-0">
                  <span className="block text-xs font-medium text-[#E2E8F0]">
                    Авто-кадрирование фото в I2V (center crop)
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[#64748B]">
                    Узлы #70–71 · подгоняет фото под пропорции ролика без растягивания лиц
                  </span>
                </div>
                <input
                  id="auto-crop-i2v-toggle"
                  type="checkbox"
                  checked={settings.autoCropStartFrame !== false}
                  disabled={disabled}
                  onChange={(e) => onChange({ autoCropStartFrame: e.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-[#3A4358] bg-[#0D1017] accent-[#E58E26]"
                />
              </label>

              <label
                htmlFor="color-drift-toggle"
                className="flex cursor-pointer items-start justify-between gap-3 rounded-md border border-[#222734] bg-[#121620] px-3 py-2 transition-colors hover:border-[#2F374A]"
              >
                <div className="min-w-0">
                  <span className="block text-xs font-medium text-[#E2E8F0]">
                    Защита от дрейфа цвета в цепочках 10–30с
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[#64748B]">
                    Мягкое снижение CFG/Shift со 2-го сегмента и CRF 14 для промежуточных кадров
                  </span>
                </div>
                <input
                  id="color-drift-toggle"
                  type="checkbox"
                  checked={settings.preventColorDrift !== false}
                  disabled={disabled}
                  onChange={(e) => onChange({ preventColorDrift: e.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-[#3A4358] bg-[#0D1017] accent-[#E58E26]"
                />
              </label>
            </div>

            <div className="space-y-2.5 border-t border-[#1E2330] pt-3.5">
              <label
                htmlFor="offline-mode-toggle"
                className="flex cursor-pointer items-start justify-between gap-3 rounded-md border border-[#222734] bg-[#121620] px-3 py-2.5 transition-colors hover:border-[#2F374A]"
              >
                <div className="min-w-0">
                  <span className="block text-xs font-medium text-[#E2E8F0]">
                    Автономный режим (без интернета)
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[#64748B]">
                    Отключает автопроверку обновлений GitHub и облачный Gemini; промпт улучшается
                    локально
                  </span>
                </div>
                <input
                  id="offline-mode-toggle"
                  type="checkbox"
                  checked={Boolean(settings.offlineMode)}
                  disabled={disabled}
                  onChange={(e) => onChange({ offlineMode: e.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-[#3A4358] bg-[#0D1017] accent-[#E58E26]"
                />
              </label>

              <div className="space-y-2 rounded-md border border-[#222734] bg-[#121620] p-3">
                <span className="block text-xs font-medium text-[#E2E8F0]">
                  Локальная LLM для промптов (опционально)
                </span>
                <p className="text-[11px] leading-relaxed text-[#64748B]">
                  Укажите адрес локального Ollama (<span className="font-mono">http://127.0.0.1:11434</span>)
                  или LM Studio (<span className="font-mono">http://127.0.0.1:1234</span>) для
                  перевода и обогащения промптов без интернета.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    id="local-llm-url"
                    type="url"
                    value={settings.localLlmUrl ?? ''}
                    disabled={disabled}
                    onChange={(e) => onChange({ localLlmUrl: e.target.value })}
                    placeholder="http://127.0.0.1:11434"
                    aria-label="Адрес локальной LLM"
                    className="rounded-md border border-[#262C3A] bg-[#141821] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9] placeholder-[#475569] focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
                  />
                  <input
                    id="local-llm-model"
                    type="text"
                    value={settings.localLlmModel ?? ''}
                    disabled={disabled}
                    onChange={(e) => onChange({ localLlmModel: e.target.value })}
                    placeholder="qwen2.5:7b"
                    aria-label="Модель локальной LLM"
                    className="rounded-md border border-[#262C3A] bg-[#141821] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9] placeholder-[#475569] focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
                  />
                </div>

                <label
                  htmlFor="auto-translate-ru-toggle"
                  className="flex cursor-pointer items-center justify-between gap-2 pt-1 text-[11px] text-[#94A3B8]"
                >
                  <span>Автоперевод русских промптов на английский перед генерацией</span>
                  <input
                    id="auto-translate-ru-toggle"
                    type="checkbox"
                    checked={settings.autoTranslateRuPrompt !== false}
                    disabled={disabled}
                    onChange={(e) => onChange({ autoTranslateRuPrompt: e.target.checked })}
                    className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-[#3A4358] bg-[#0D1017] accent-[#E58E26]"
                  />
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
