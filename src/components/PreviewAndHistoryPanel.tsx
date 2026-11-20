import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  AlertCircle,
  Download,
  FastForward,
  Film,
  FolderOpen,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react';
import {
  computeUpscaleTargetSize,
  formatSegmentLabel,
  getShootingStyleOption,
} from '../services/comfyService';
import type { PreflightReport } from '../services/preflightService';
import { mergeVideoSegments } from '../utils/videoFrameUtils';
import type { FilmMergeProgress } from '../types/film';
import type {
  GenerationHistoryItem,
  GenerationProgress,
} from '../types/video';

interface PreviewAndHistoryPanelProps {
  progress: GenerationProgress;
  generationError: string | null;
  preflightReport: PreflightReport | null;
  onOpenModels: () => void;
  activeVideo: GenerationHistoryItem | null;
  history: GenerationHistoryItem[];
  isGenerating: boolean;
  isExtending: boolean;
  extendError: string | null;
  onCheckConnection: () => void;
  onCancelGeneration: () => void;
  onExtendScene: (
    videoEl: HTMLVideoElement | null,
    videoUrl: string,
    extraSeconds: 5 | 10 | 15,
  ) => void;
  onLoadLocalVideo: (file: File) => void;
  onSelectHistoryItem: (item: GenerationHistoryItem) => void;
  onRestoreHistoryItem: (item: GenerationHistoryItem) => void;
  onDeleteHistoryItem: (id: string) => void;
  onClearHistory: () => void;
  onOpenCorsGuide: () => void;
}

export function PreviewAndHistoryPanel({
  progress,
  generationError,
  preflightReport,
  onOpenModels,
  activeVideo,
  history,
  isGenerating,
  isExtending,
  extendError,
  onCheckConnection,
  onCancelGeneration,
  onExtendScene,
  onLoadLocalVideo,
  onSelectHistoryItem,
  onRestoreHistoryItem,
  onDeleteHistoryItem,
  onClearHistory,
  onOpenCorsGuide,
}: PreviewAndHistoryPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState(0);
  const [extendDuration, setExtendDuration] = useState<5 | 10 | 15>(5);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);
  const [mergeProgress, setMergeProgress] = useState<FilmMergeProgress | null>(null);
  const [savedFilmPath, setSavedFilmPath] = useState<string | null>(null);

  const segments = activeVideo?.segments && activeVideo.segments.length > 0 ? activeVideo.segments : null;
  const activeSegment = segments
    ? segments[Math.min(selectedSegmentIndex, segments.length - 1)]
    : null;
  const currentVideoSrc = activeSegment ? activeSegment.videoUrl : activeVideo?.videoUrl ?? '';
  const currentFilename = activeSegment ? activeSegment.filename : activeVideo?.filename ?? 'video.mp4';

  useEffect(() => {
    setSelectedSegmentIndex(0);
    setMergeError(null);
  }, [activeVideo?.id]);

  const handleDownload = async (url: string, filename: string) => {
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) {
        throw new Error('direct');
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename.endsWith('.mp4') ? filename : `${filename}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    } catch {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  };

  // Space plays / pauses the preview unless the user is typing or pressing a control.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        tag === 'BUTTON' ||
        tag === 'A' ||
        target?.isContentEditable
      ) {
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      event.preventDefault();
      if (video.paused) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleMergeAndDownload = async () => {
    if (!segments || segments.length < 2) return;
    setIsMerging(true);
    setMergeError(null);
    setMergeNotice(null);
    setSavedFilmPath(null);
    setMergeProgress(null);
    try {
      const filmBridge = window.kinoflowFilm;
      if (filmBridge) {
        // Desktop app: lossless-quality join with FFmpeg, duplicated stitch frames removed.
        const unsubscribe = filmBridge.onProgress(setMergeProgress);
        try {
          const result = await filmBridge.mergeSegments(
            segments.map((s) => s.videoUrl),
            `kinoflow_film_${activeVideo?.durationSec ?? 10}s.mp4`,
          );
          if (result.ok && result.path) {
            setSavedFilmPath(result.path);
            setMergeNotice(`Фильм сохранён: ${result.path}`);
            return;
          }
          if (result.code === 'CANCELLED') return;
          if (result.code !== 'FFMPEG_NOT_FOUND') {
            throw new Error(result.error ?? 'Не удалось склеить видеосегменты.');
          }
          setMergeNotice(
            'FFmpeg не найден, использована встроенная склейка (в реальном времени, качество ниже). Установите FFmpeg для быстрой склейки без потерь.',
          );
        } finally {
          unsubscribe();
        }
      }

      const { blob, extension } = await mergeVideoSegments(
        segments.map((s) => s.videoUrl),
        activeVideo?.fps ?? 16,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `kinoflow_merged_${activeVideo?.durationSec ?? 10}s.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      setMergeError(
        err instanceof Error ? err.message : 'Не удалось склеить видеосегменты.',
      );
    } finally {
      setIsMerging(false);
      setMergeProgress(null);
    }
  };

  const handleLocalFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onLoadLocalVideo(file);
    }
    e.target.value = '';
  };

  const handleVideoEnded = () => {
    if (segments && selectedSegmentIndex < segments.length - 1) {
      setSelectedSegmentIndex((prev) => prev + 1);
    }
  };

  const totalSegs = progress.totalSegments ?? 1;
  const currentSeg = progress.segmentIndex ?? 1;
  const segmentHeading =
    progress.totalSegments && progress.segmentIndex
      ? formatSegmentLabel(
          progress.segmentIndex,
          progress.totalSegments,
          progress.segmentStartSec ?? 0,
          progress.segmentEndSec ?? 5,
        )
      : progress.message || 'Выполнение задачи в ComfyUI...';

  return (
    <div className="flex flex-col gap-6">
      <input
        ref={localVideoInputRef}
        id="local-video-upload-input"
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleLocalFilePicked}
        className="sr-only"
      />

      {/* Primary Stage: Video Player & Progress */}
      <section aria-labelledby="preview-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2
            id="preview-heading"
            className="text-sm font-semibold tracking-tight text-[#F1F5F9]"
          >
            Предпросмотр результата
          </h2>

          <div className="flex flex-wrap items-center gap-2">
            {!isGenerating && (
              <button
                type="button"
                onClick={() => localVideoInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#262C3A] bg-[#141821] px-3 py-1.5 text-xs font-medium text-[#CBD5E1] transition-colors hover:border-[#3A4358] hover:text-white focus-visible:outline-2 focus-visible:outline-[#E58E26]"
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Открыть видео</span>
              </button>
            )}

            {isGenerating ? (
              <button
                type="button"
                onClick={onCancelGeneration}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#7F1D1D] bg-[#2A1215] px-3.5 py-1.5 text-xs font-medium text-[#FCA5A5] transition-colors hover:bg-[#3A191D] focus-visible:outline-2 focus-visible:outline-[#E58E26]"
              >
                <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                <span>Прервать задачу</span>
              </button>
            ) : (
              activeVideo && (
                <button
                  type="button"
                  onClick={() => void handleDownload(currentVideoSrc, currentFilename)}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3.5 py-1.5 text-xs font-medium text-[#E2E8F0] transition-colors hover:border-[#3A4358] hover:bg-[#222838] focus-visible:outline-2 focus-visible:outline-[#E58E26]"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Скачать .mp4</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* 16:9 Cinema Viewport */}
        <div className="overflow-hidden rounded-lg border border-[#222734] bg-[#0E1117]">
          <div className="relative aspect-video w-full bg-[#080A0E]">
            {activeVideo && !isGenerating ? (
              <video
                ref={videoRef}
                key={`${activeVideo.id}-${selectedSegmentIndex}`}
                src={currentVideoSrc}
                crossOrigin={
                  currentVideoSrc.startsWith('blob:') || currentVideoSrc.startsWith('data:')
                    ? undefined
                    : 'anonymous'
                }
                controls
                playsInline
                loop={!segments || segments.length <= 1}
                onEnded={handleVideoEnded}
                className="h-full w-full object-contain"
              />
            ) : isGenerating ? (
              <div className="flex h-full w-full flex-col items-center justify-center p-8 text-center">
                <div className="w-full max-w-lg space-y-4">
                  {/* Segment indicator header */}
                  <div className="space-y-1">
                    <div className="flex items-baseline justify-between gap-4">
                      <span
                        className="text-sm font-semibold text-[#F8FAFC]"
                        data-testid="segment-progress-heading"
                      >
                        {segmentHeading}
                      </span>
                      <span className="font-mono text-sm font-semibold tabular-nums text-[#F6AD55]">
                        {progress.percent}%
                      </span>
                    </div>
                    {progress.message && progress.message !== segmentHeading && (
                      <p className="text-left text-xs text-[#94A3B8]">{progress.message}</p>
                    )}
                  </div>

                  {/* Overall progress bar */}
                  <div
                    role="progressbar"
                    aria-valuenow={progress.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Прогресс генерации видео"
                    className="h-2 w-full overflow-hidden rounded-full bg-[#1E2433]"
                  >
                    <div
                      className="h-full bg-[#E58E26] transition-[width] duration-200 ease-out"
                      style={{ width: `${Math.max(4, progress.percent)}%` }}
                    />
                  </div>

                  {/* Multi-segment visual timeline */}
                  {totalSegs > 1 && (
                    <div
                      className={`grid gap-1.5 pt-1 ${
                        totalSegs >= 5 ? 'grid-cols-3 sm:grid-cols-6' : ''
                      }`}
                      style={
                        totalSegs < 5
                          ? { gridTemplateColumns: `repeat(${totalSegs}, minmax(0, 1fr))` }
                          : undefined
                      }
                    >
                      {Array.from({ length: totalSegs }, (_, idx) => {
                        const segNum = idx + 1;
                        const isDone = segNum < currentSeg;
                        const isCurrent = segNum === currentSeg;
                        return (
                          <div
                            key={segNum}
                            className={`rounded border px-2 py-1.5 text-left font-mono text-[11px] tabular-nums ${
                              isDone
                                ? 'border-[#16A34A]/40 bg-[#16A34A]/10 text-[#4ADE80]'
                                : isCurrent
                                  ? 'border-[#E58E26]/60 bg-[#E58E26]/15 text-[#F6AD55]'
                                  : 'border-[#222734] bg-[#121620] text-[#64748B]'
                            }`}
                          >
                            <div>Сегм. {segNum}</div>
                            <div className="text-[10px] opacity-80">
                              {idx * 5}–{(idx + 1) * 5}с
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#94A3B8]">
                    <span>
                      {progress.transport === 'ws'
                        ? 'Канал: WebSocket (/ws)'
                        : progress.transport === 'polling'
                          ? 'Канал: HTTP опрос (/history)'
                          : 'Подготовка задачи'}
                      {progress.segmentMode && (
                        <> · Режим: {progress.segmentMode === 'i2v' ? 'I2V' : 'T2V'}</>
                      )}
                      {progress.identityAnchorCount && progress.identityAnchorCount > 0 ? (
                        <> · Защита лиц: {progress.identityAnchorCount} реф. (0.75–0.85)</>
                      ) : null}
                    </span>
                    {progress.promptId && (
                      <span className="font-mono text-[11px] text-[#64748B]">
                        ID: {progress.promptId.slice(0, 12)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center px-6 py-10 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-[#222734] bg-[#141821] text-[#64748B]">
                  <Film className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="text-sm font-semibold text-[#E2E8F0]">
                  Здесь появится сгенерированное видео
                </h3>
                <p className="mt-1.5 max-w-md text-xs leading-relaxed text-[#64748B]">
                  Выберите режим «Текст → Видео» или «Оживление фото», задайте длительность до 30
                  секунд с 1080p-апскейлом и RIFE — или откройте готовый клип для безлимитного
                  продолжения сцены.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={onCheckConnection}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3.5 py-2 text-xs font-medium text-[#E2E8F0] transition-colors hover:border-[#3A4358] hover:bg-[#222838] focus-visible:outline-2 focus-visible:outline-[#E58E26]"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Проверить ComfyUI</span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenCorsGuide}
                    className="whitespace-nowrap rounded-md border border-[#262C3A] bg-[#141821] px-3.5 py-2 text-xs font-medium text-[#CBD5E1] transition-colors hover:border-[#3A4358] hover:text-white focus-visible:outline-2 focus-visible:outline-[#E58E26]"
                  >
                    Настройка CORS в ComfyUI
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Segment Selector Strip (for chained 10-20s videos or extended scenes) */}
          {activeVideo && !isGenerating && segments && segments.length > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#1E2330] bg-[#10141D] px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {segments.map((seg, idx) => (
                  <button
                    key={`${seg.promptId}-${seg.index}`}
                    type="button"
                    onClick={() => setSelectedSegmentIndex(idx)}
                    className={`whitespace-nowrap rounded px-2.5 py-1 font-mono text-[11px] tabular-nums transition-colors ${
                      selectedSegmentIndex === idx
                        ? 'bg-[#252C3D] text-[#F8FAFC]'
                        : 'text-[#94A3B8] hover:bg-[#191E2A] hover:text-[#E2E8F0]'
                    }`}
                  >
                    Сегмент {seg.index} ({seg.startSec}–{seg.endSec}с)
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={isMerging}
                onClick={() => void handleMergeAndDownload()}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3 py-1.5 text-xs font-medium text-[#E2E8F0] transition-colors hover:bg-[#222838] disabled:opacity-50"
              >
                {isMerging ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>
                  {isMerging
                    ? mergeProgress
                      ? mergeProgress.phase === 'downloading'
                        ? `Загрузка ${mergeProgress.index}/${mergeProgress.total}...`
                        : 'Кодирование...'
                      : 'Склейка...'
                    : 'Склеить и скачать'}
                </span>
              </button>
            </div>
          )}

          {/* Extend Scene Bar + Active Video Metadata */}
          {activeVideo && !isGenerating && (
            <div className="space-y-3 border-t border-[#1E2330] px-4 py-3.5">
              {/* Extend Scene Controls (Unlimited) */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#252C3D] bg-[#131823] px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#F1F5F9]">
                    Продолжить сцену без ограничений
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#94A3B8]">
                    Текущая сцена: <span className="font-mono tabular-nums text-[#CBD5E1]">{activeVideo.durationSec} сек</span>
                    {segments && segments.length > 1 ? ` (${segments.length} сегм.)` : ''} ·
                    последний кадр + исходные референсы лиц (вес 0.75–0.85)
                  </p>
                </div>

                <div className="flex flex-wrap shrink-0 items-center gap-2">
                  <div
                    role="group"
                    aria-label="Длительность продолжения"
                    className="flex items-center rounded-md border border-[#262C3A] bg-[#0D1017] p-0.5"
                  >
                    {([5, 10, 15] as const).map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        aria-pressed={extendDuration === sec}
                        onClick={() => setExtendDuration(sec)}
                        className={`whitespace-nowrap rounded px-2.5 py-1 font-mono text-xs tabular-nums transition-colors ${
                          extendDuration === sec
                            ? 'bg-[#252C3D] text-[#F8FAFC]'
                            : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                        }`}
                      >
                        +{sec}с
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    disabled={isExtending}
                    onClick={() =>
                      onExtendScene(videoRef.current, currentVideoSrc, extendDuration)
                    }
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#E58E26]/55 bg-[#E58E26]/15 px-3.5 py-1.5 text-xs font-semibold text-[#F6AD55] transition-colors hover:bg-[#E58E26]/25 focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50"
                  >
                    {isExtending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <FastForward className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span>
                      {isExtending
                        ? 'Извлечение кадра...'
                        : `Продолжить сцену (+${extendDuration} сек)`}
                    </span>
                  </button>
                </div>
              </div>

              {extendError && (
                <div
                  role="alert"
                  className="rounded-md border border-[#7F1D1D] bg-[#241013] px-3 py-2 text-xs text-[#FCA5A5]"
                >
                  {extendError}
                </div>
              )}

              {mergeError && (
                <div
                  role="alert"
                  className="rounded-md border border-[#7F1D1D] bg-[#241013] px-3 py-2 text-xs text-[#FCA5A5]"
                >
                  {mergeError}
                </div>
              )}

              {mergeNotice && (
                <div
                  role="status"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#2A3A2E] bg-[#111C16] px-3 py-2 text-xs text-[#9AE6B4]"
                >
                  <span className="min-w-0 break-all">{mergeNotice}</span>
                  {savedFilmPath && window.kinoflowFilm ? (
                    <button
                      type="button"
                      onClick={() => void window.kinoflowFilm?.showFile(savedFilmPath)}
                      className="shrink-0 rounded border border-[#2F4A38] px-2 py-1 text-[11px] font-medium hover:bg-[#162A1E]"
                    >
                      Показать в папке
                    </button>
                  ) : null}
                </div>
              )}

              <div>
                <p className="line-clamp-2 text-xs leading-relaxed text-[#CBD5E1]">
                  {activeVideo.enhancedPrompt || activeVideo.prompt}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] tabular-nums text-[#64748B]">
                  <span>{activeVideo.mode === 'i2v' ? 'I2V' : 'T2V'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{activeVideo.modelLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {activeVideo.upscale1080p
                      ? (() => {
                          const target = computeUpscaleTargetSize(
                            activeVideo.width,
                            activeVideo.height,
                          );
                          return `${target.width}×${target.height} (1080p Upscale)`;
                        })()
                      : `${activeVideo.width}×${activeVideo.height}`}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {activeVideo.durationSec} сек ·{' '}
                    {activeVideo.rifeEnabled
                      ? `${activeVideo.outputFps ?? activeVideo.fps * 2} fps (RIFE)`
                      : `${activeVideo.fps} fps`}
                  </span>
                  {activeVideo.shootingStyle && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{getShootingStyleOption(activeVideo.shootingStyle).label}</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>Steps {activeVideo.steps}</span>
                  <span aria-hidden="true">·</span>
                  <span>Seed {activeVideo.seed}</span>
                  {activeVideo.characters.length > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        Персонажи:{' '}
                        {activeVideo.characters
                          .map((c) => `${c.name} (${c.weight.toFixed(2)})`)
                          .join(', ')}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Generation Error Callout */}
        {generationError && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2.5 rounded-md border border-[#7F1D1D] bg-[#241013] px-3.5 py-3 text-xs text-[#FCA5A5]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#EF4444]" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium text-[#FECACA]">
                {preflightReport ? 'ComfyUI не готов к запуску' : 'Не удалось выполнить генерацию'}
              </p>
              <p className="leading-relaxed text-[#FCA5A5]/90">{generationError}</p>
              {preflightReport && (
                <div className="space-y-2 pt-1" data-testid="preflight-report">
                  {preflightReport.missingNodes.length > 0 && (
                    <div>
                      <p className="font-medium text-[#FECACA]">Не установлены ноды</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[#FCA5A5]/90">
                        {preflightReport.missingNodes.map((node) => (
                          <li key={node.classType}>
                            <span className="font-mono">{node.classType}</span>
                            {node.pack ? (
                              <>
                                {' — установите '}
                                <a
                                  href={node.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline underline-offset-2"
                                >
                                  {node.pack}
                                </a>
                              </>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {preflightReport.missingFiles.length > 0 && (
                    <div>
                      <p className="font-medium text-[#FECACA]">Не найдены файлы моделей</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[#FCA5A5]/90">
                        {preflightReport.missingFiles.map((file) => (
                          <li key={`${file.classType}-${file.value}`}>
                            <span className="font-mono">{file.value}</span>
                            {' → '}
                            <span className="font-mono">{file.folder}</span>
                            {!file.catalogModelId && file.value.toLowerCase().endsWith('.gguf')
                              ? ' (GGUF скачивается вручную)'
                              : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {preflightReport.missingFiles.some((file) => file.catalogModelId) && (
                      <button
                        type="button"
                        onClick={onOpenModels}
                        className="rounded-md border border-[#E58E26] bg-[#2A1D0B] px-3 py-1.5 text-xs font-semibold text-[#F5B461] hover:bg-[#3A2810]"
                      >
                        Открыть «Модели и установка»
                      </button>
                    )}
                    <span className="text-[11px] text-[#FCA5A5]/70">
                      После установки перезапустите ComfyUI и повторите генерацию.
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Local Generation History */}
      <section aria-labelledby="history-heading" className="border-t border-[#222734] pt-6">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-2.5">
            <h2
              id="history-heading"
              className="text-sm font-semibold tracking-tight text-[#F1F5F9]"
            >
              История генераций
            </h2>
            <span className="font-mono text-xs tabular-nums text-[#64748B]">
              {history.length}
            </span>
          </div>

          {history.length > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              className="text-xs font-medium text-[#64748B] transition-colors hover:text-[#F87171] focus-visible:outline-2 focus-visible:outline-[#E58E26]"
            >
              Очистить историю
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="rounded-lg border border-[#1E2330] bg-[#10141C] px-4 py-6 text-center">
            <p className="text-xs text-[#64748B]">
              Завершённые генерации автоматически сохраняются в локальной истории браузера с
              параметрами, сегментами, seed и ссылкой на{' '}
              <span className="font-mono text-[#94A3B8]">.mp4</span> файл ComfyUI.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[#1E2330] rounded-lg border border-[#222734] bg-[#10141C]">
            {history.map((item) => {
              const isSelected = activeVideo?.id === item.id;
              return (
                <li
                  key={item.id}
                  className={`flex items-start justify-between gap-3 px-4 py-3 transition-colors ${
                    isSelected ? 'bg-[#181D28]' : 'hover:bg-[#141923]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectHistoryItem(item)}
                    className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-[#E58E26]"
                  >
                    <p className="truncate text-xs font-medium text-[#F1F5F9]">
                      {item.prompt}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] tabular-nums text-[#64748B]">
                      <span>{item.mode === 'i2v' ? 'I2V' : 'T2V'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.modelLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {item.durationSec}с ·{' '}
                        {item.rifeEnabled
                          ? `${item.outputFps ?? item.fps * 2} fps RIFE`
                          : `${item.fps} fps`}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {item.upscale1080p ? '1080p Upscale' : `${item.width}×${item.height}`}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Seed {item.seed}</span>
                      <span aria-hidden="true">·</span>
                      <span>{new Date(item.createdAt).toLocaleTimeString('ru-RU')}</span>
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onRestoreHistoryItem(item)}
                      aria-label={`Повторить параметры генерации от ${new Date(item.createdAt).toLocaleTimeString('ru-RU')}`}
                      title="Загрузить параметры и промпт в редактор"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#94A3B8] transition-colors hover:bg-[#222838] hover:text-[#F1F5F9] focus-visible:outline-2 focus-visible:outline-[#E58E26]"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownload(item.videoUrl, item.filename)}
                      aria-label={`Скачать ${item.filename}`}
                      title="Скачать .mp4"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#94A3B8] transition-colors hover:bg-[#222838] hover:text-[#F1F5F9] focus-visible:outline-2 focus-visible:outline-[#E58E26]"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteHistoryItem(item.id)}
                      aria-label={`Удалить запись ${item.filename}`}
                      title="Удалить из истории"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#64748B] transition-colors hover:bg-[#2A1519] hover:text-[#F87171] focus-visible:outline-2 focus-visible:outline-[#E58E26]"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
