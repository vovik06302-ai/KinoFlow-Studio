import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  HardDriveDownload,
  Loader2,
  RefreshCw,
  Square,
} from 'lucide-react';
import {
  DEFAULT_COMFY_DIR,
  REQUIRED_MODELS,
  cancelModelsDownload,
  formatBytes,
  formatEta,
  formatSpeed,
  getModelsDownloadState,
  isElectronModelBridgeAvailable,
  openComfyFolderNative,
  scanComfyModels,
  selectComfyDirectoryNative,
  startModelsDownload,
  subscribeToModelDownloadEvents,
} from '../services/modelManagerService';
import type { ModelDownloadProgressEvent, ScannedModelItem } from '../types/models';

interface ModelsSetupViewProps {
  comfyDir: string;
  requiredModelIds?: string[];
  onComfyDirChange: (nextDir: string) => void;
}

const VHS_CLONE_CMD = 'git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git';

function createInitialModels(): ScannedModelItem[] {
  return REQUIRED_MODELS.map((m) => ({
    ...m,
    status: 'missing',
    existingSizeBytes: null,
    partialSizeBytes: 0,
    targetPath: `${m.targetSubfolder}/${m.filename}`,
  }));
}

export function ModelsSetupView({
  comfyDir,
  requiredModelIds = [],
  onComfyDirChange,
}: ModelsSetupViewProps) {
  const [dirInput, setDirInput] = useState(comfyDir || DEFAULT_COMFY_DIR);
  const [copiedVhs, setCopiedVhs] = useState(false);
  const [models, setModels] = useState<ScannedModelItem[]>(createInitialModels);
  const [directoryExists, setDirectoryExists] = useState<boolean | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [isDownloadingQueue, setIsDownloadingQueue] = useState(false);
  const [progressById, setProgressById] = useState<Record<string, ModelDownloadProgressEvent>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const isElectron = isElectronModelBridgeAvailable();

  useEffect(() => {
    setDirInput(comfyDir || DEFAULT_COMFY_DIR);
  }, [comfyDir]);

  const runScan = useCallback(async (targetDir: string) => {
    const trimmed = targetDir.trim();
    if (!trimmed) {
      setDirectoryExists(false);
      setModels(createInitialModels());
      return;
    }

    setIsScanning(true);
    setScanError(null);
    try {
      const result = await scanComfyModels(trimmed);
      setDirectoryExists(result.directoryExists);
      setModels(result.models);
    } catch (err) {
      setScanError(
        err instanceof Error ? err.message : 'Не удалось проверить папку моделей ComfyUI.',
      );
    } finally {
      setIsScanning(false);
    }
  }, []);

  // Scan on mount / when persisted comfyDir changes
  useEffect(() => {
    void runScan(comfyDir || DEFAULT_COMFY_DIR);
  }, [comfyDir, runScan]);

  // Restore any active download state and subscribe to live Electron IPC / Node SSE events
  useEffect(() => {
    let mounted = true;

    void getModelsDownloadState().then((snapshot) => {
      if (!mounted) return;
      setIsDownloadingQueue(snapshot.isRunning);
      if (snapshot.active.length > 0) {
        const nextMap: Record<string, ModelDownloadProgressEvent> = {};
        for (const ev of snapshot.active) {
          if (ev.modelId) {
            nextMap[ev.modelId] = ev;
          }
        }
        setProgressById(nextMap);
      }
    });

    const unsubscribe = subscribeToModelDownloadEvents((event) => {
      if (!mounted) return;

      if (event.type === 'queue-finished') {
        setIsDownloadingQueue(false);
        void runScan(comfyDir || DEFAULT_COMFY_DIR);
        return;
      }

      if (event.type === 'model-progress' && event.modelId) {
        const modelId = event.modelId;

        if (event.state === 'downloading' || event.state === 'queued') {
          setIsDownloadingQueue(true);
        }

        if (event.state === 'installed') {
          setModels((prev) =>
            prev.map((m) =>
              m.id === modelId
                ? {
                    ...m,
                    status: 'installed',
                    existingSizeBytes: event.totalBytes ?? m.expectedSizeBytes,
                    partialSizeBytes: 0,
                  }
                : m,
            ),
          );
          setProgressById((prev) => {
            const copy = { ...prev };
            delete copy[modelId];
            return copy;
          });
          return;
        }

        if (event.state === 'cancelled') {
          setProgressById((prev) => {
            const copy = { ...prev };
            delete copy[modelId];
            return copy;
          });
          if ((event.downloadedBytes ?? 0) > 0) {
            setModels((prev) =>
              prev.map((m) =>
                m.id === modelId
                  ? {
                      ...m,
                      status: 'partial',
                      partialSizeBytes: event.downloadedBytes ?? m.partialSizeBytes,
                    }
                  : m,
              ),
            );
          }
          return;
        }

        setProgressById((prev) => ({
          ...prev,
          [modelId]: event,
        }));
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [comfyDir, runScan]);

  const handleSaveAndScanDir = () => {
    const trimmed = dirInput.trim() || DEFAULT_COMFY_DIR;
    setDirInput(trimmed);
    onComfyDirChange(trimmed);
    void runScan(trimmed);
  };

  const handleBrowseFolder = async () => {
    const picked = await selectComfyDirectoryNative();
    if (picked) {
      setDirInput(picked);
      onComfyDirChange(picked);
      void runScan(picked);
    }
  };

  const handleStartDownload = async (modelIds?: string[]) => {
    const targetDir = dirInput.trim();
    if (!targetDir) {
      setActionError('Укажите путь к папке ComfyUI перед началом загрузки.');
      return;
    }

    if (targetDir !== comfyDir) {
      onComfyDirChange(targetDir);
    }

    setActionError(null);
    try {
      const res = await startModelsDownload(targetDir, modelIds);
      if (res.started) {
        setIsDownloadingQueue(true);
      } else {
        await runScan(targetDir);
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Не удалось запустить скачивание моделей.',
      );
    }
  };

  const handleCancelDownload = async (modelId?: string) => {
    setActionError(null);
    await cancelModelsDownload(modelId);
  };

  const requiredSet = useMemo(() => new Set(requiredModelIds), [requiredModelIds]);

  const summary = useMemo(() => {
    const installedCount = models.filter((m) => m.status === 'installed').length;
    const missingModels = models.filter((m) => m.status !== 'installed');
    const requiredMissingModels = missingModels.filter((m) => requiredSet.has(m.id));
    const remainingBytes = missingModels.reduce(
      (sum, m) => sum + Math.max(0, m.expectedSizeBytes - m.partialSizeBytes),
      0,
    );
    const requiredRemainingBytes = requiredMissingModels.reduce(
      (sum, m) => sum + Math.max(0, m.expectedSizeBytes - m.partialSizeBytes),
      0,
    );
    return {
      totalCount: models.length,
      installedCount,
      missingCount: missingModels.length,
      remainingBytes,
      requiredMissingIds: requiredMissingModels.map((m) => m.id),
      requiredRemainingBytes,
    };
  }, [models, requiredSet]);

  const handleCopyVhsCmd = async () => {
    try {
      await navigator.clipboard.writeText(VHS_CLONE_CMD);
      setCopiedVhs(true);
      window.setTimeout(() => setCopiedVhs(false), 1600);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Header + Primary Action */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-[#222734] pb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#F8FAFC]">
            Модели и установка
          </h1>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-[#94A3B8]">
            Автоматическая проверка и загрузка обязательных весов Wan 2.2 FP8, UMT5-XXL, VAE и
            CLIP Vision из официальных репозиториев{' '}
            <span className="font-mono text-[#CBD5E1]">Comfy-Org</span> на Hugging Face с
            поддержкой докачки при обрыве связи.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isDownloadingQueue ? (
            <button
              type="button"
              onClick={() => void handleCancelDownload()}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#7F1D1D] bg-[#2A1215] px-4 py-2 text-xs font-semibold text-[#FCA5A5] transition-colors hover:bg-[#3A191D] focus-visible:outline-2 focus-visible:outline-[#E58E26]"
            >
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              <span>Остановить загрузку</span>
            </button>
          ) : (
            <>
              {summary.requiredMissingIds.length > 0 &&
                summary.requiredMissingIds.length < summary.missingCount && (
                  <button
                    type="button"
                    disabled={!dirInput.trim() || isScanning}
                    onClick={() => void handleStartDownload(summary.requiredMissingIds)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-[#E58E26] px-4 py-2 text-xs font-semibold text-[#0B0D11] transition-colors hover:bg-[#EE9B38] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E58E26] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <HardDriveDownload className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      Скачать нужные для сцены ({summary.requiredMissingIds.length} ·{' '}
                      {formatBytes(summary.requiredRemainingBytes)})
                    </span>
                  </button>
                )}
              <button
                type="button"
                disabled={summary.missingCount === 0 || !dirInput.trim() || isScanning}
                onClick={() => void handleStartDownload()}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-4 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E58E26] disabled:cursor-not-allowed disabled:opacity-45 ${
                  summary.requiredMissingIds.length > 0 &&
                  summary.requiredMissingIds.length < summary.missingCount
                    ? 'border border-[#2B3242] bg-[#1A1F2B] text-[#E2E8F0] hover:border-[#3A4358] hover:bg-[#222838]'
                    : 'bg-[#E58E26] text-[#0B0D11] hover:bg-[#EE9B38]'
                }`}
              >
                <HardDriveDownload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {summary.missingCount === 0
                    ? 'Все модели установлены'
                    : `Скачать все недостающие модели (${summary.missingCount})`}
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* ComfyUI Directory Path & Disk Scan Control */}
      <section
        aria-labelledby="comfy-dir-heading"
        className="mb-6 rounded-lg border border-[#222734] bg-[#10141C] p-4 sm:p-5"
      >
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <label
            id="comfy-dir-heading"
            htmlFor="comfy-dir-input"
            className="text-xs font-semibold text-[#F1F5F9]"
          >
            Путь к папке ComfyUI на компьютере
          </label>
          <span className="font-mono text-[11px] tabular-nums text-[#94A3B8]">
            Установлено {summary.installedCount} из {summary.totalCount}
            {summary.missingCount > 0 ? ` · Осталось скачать ${formatBytes(summary.remainingBytes)}` : ''}
          </span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <input
            id="comfy-dir-input"
            type="text"
            value={dirInput}
            disabled={isDownloadingQueue}
            onChange={(e) => setDirInput(e.target.value)}
            onBlur={() => {
              const trimmed = dirInput.trim();
              if (trimmed && trimmed !== comfyDir) {
                onComfyDirChange(trimmed);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSaveAndScanDir();
              }
            }}
            placeholder={DEFAULT_COMFY_DIR}
            className="min-w-0 flex-1 rounded-md border border-[#262C3A] bg-[#141821] px-3 py-2 font-mono text-xs text-[#F1F5F9] placeholder-[#475569] transition-colors focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
          />

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {isElectron && (
              <button
                type="button"
                disabled={isDownloadingQueue}
                onClick={() => void handleBrowseFolder()}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3 py-2 text-xs font-medium text-[#E2E8F0] transition-colors hover:border-[#3A4358] hover:bg-[#222838] focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50"
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Выбрать папку</span>
              </button>
            )}

            <button
              type="button"
              disabled={isScanning || isDownloadingQueue}
              onClick={handleSaveAndScanDir}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3.5 py-2 text-xs font-medium text-[#E2E8F0] transition-colors hover:border-[#3A4358] hover:bg-[#222838] focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Проверить папку</span>
            </button>

            {isElectron && directoryExists && (
              <button
                type="button"
                onClick={() => void openComfyFolderNative(dirInput)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#262C3A] bg-[#141821] px-3 py-2 text-xs font-medium text-[#CBD5E1] transition-colors hover:border-[#3A4358] hover:text-white"
              >
                <span>Открыть</span>
              </button>
            )}
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B]">
          <span>
            {directoryExists === true
              ? 'Папка ComfyUI найдена · выполняется точная проверка файлов по размеру (байт-в-байт)'
              : directoryExists === false
                ? 'Указанная папка ещё не существует — укажите путь к Portable (C:\\ComfyUI_windows_portable\\ComfyUI) или Desktop (Documents\\ComfyUI)'
                : 'Укажите корневую папку ComfyUI (внутри которой находится каталог models/)'}
          </span>
          <span className="font-mono text-[#94A3B8]">
            {isElectron
              ? 'Канал: Electron IPC (Node.js + HTTP Range)'
              : 'Канал: локальный Node.js сервер (HTTP Range)'}
          </span>
        </div>

        {(scanError || actionError) && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-md border border-[#7F1D1D] bg-[#241013] px-3 py-2 text-xs text-[#FCA5A5]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#EF4444]" aria-hidden="true" />
            <span>{actionError || scanError}</span>
          </div>
        )}
      </section>

      {/* Models Checklist */}
      <section aria-labelledby="required-models-heading">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2
            id="required-models-heading"
            className="text-sm font-semibold tracking-tight text-[#F1F5F9]"
          >
            Обязательные модели для фотореалистичной генерации (Wan 2.2)
          </h2>
          <span className="font-mono text-xs tabular-nums text-[#64748B]">
            {models.length} файлов
          </span>
        </div>

        <ul className="divide-y divide-[#1E2330] rounded-lg border border-[#222734] bg-[#10141C]">
          {models.map((model) => {
            const live = progressById[model.id];
            const isDownloading = live?.state === 'downloading';
            const isQueued = live?.state === 'queued';
            const isError = live?.state === 'error';
            const isInstalled = model.status === 'installed' && !isDownloading && !isQueued;
            const isPartial = !isInstalled && !isDownloading && !isQueued && model.status === 'partial';
            const isMismatch =
              !isInstalled && !isDownloading && !isQueued && model.status === 'size_mismatch';

            const statusDotClass = isInstalled
              ? 'bg-[#22C55E]'
              : isDownloading || isQueued || isPartial
                ? 'bg-[#E58E26]'
                : isError || isMismatch
                  ? 'bg-[#EF4444]'
                  : 'bg-[#64748B]';

            const statusTextClass = isInstalled
              ? 'text-[#22C55E]'
              : isDownloading || isQueued || isPartial
                ? 'text-[#F6AD55]'
                : isError || isMismatch
                  ? 'text-[#F87171]'
                  : 'text-[#94A3B8]';

            const statusLabel = isInstalled
              ? 'Установлена'
              : isDownloading
                ? 'Загрузка...'
                : isQueued
                  ? 'В очереди'
                  : isError
                    ? 'Ошибка загрузки'
                    : isPartial
                      ? 'Недокачана (докачка)'
                      : isMismatch
                        ? 'Неверный размер'
                        : 'Не найдена';

            const progressPct = isDownloading
              ? (live.percent ?? 0)
              : isPartial && model.expectedSizeBytes > 0
                ? Number(((model.partialSizeBytes / model.expectedSizeBytes) * 100).toFixed(1))
                : 0;

            const isRequiredForCurrent = requiredSet.has(model.id) && !isInstalled;

            return (
              <li
                key={model.id}
                className={`px-4 py-4 sm:px-5 ${isRequiredForCurrent ? 'bg-[#171B26]' : ''}`}
              >
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  {/* Left: Name, description, subfolder, HF link */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <h3 className="text-sm font-semibold text-[#F1F5F9]">{model.name}</h3>
                      <span className="font-mono text-[11px] text-[#64748B]" aria-hidden="true">
                        ·
                      </span>
                      <span className="font-mono text-[11px] text-[#94A3B8]">
                        {model.category}
                      </span>
                      {isRequiredForCurrent && (
                        <>
                          <span className="font-mono text-[11px] text-[#64748B]" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-[11px] font-medium text-[#F6AD55]">
                            Требуется для текущей генерации
                          </span>
                        </>
                      )}
                    </div>

                    <p className="text-xs leading-relaxed text-[#94A3B8]">{model.description}</p>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] tabular-nums text-[#64748B]">
                      <span className="text-[#CBD5E1]">{model.targetSubfolder}/</span>
                      <span className="break-all text-[#94A3B8]">{model.filename}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-[#CBD5E1]">{formatBytes(model.expectedSizeBytes)}</span>
                      <span aria-hidden="true">·</span>
                      <a
                        href={model.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[#F6AD55] transition-colors hover:text-[#FBD38D]"
                      >
                        <span>Hugging Face ({model.repoId})</span>
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </div>
                  </div>

                  {/* Right: Status indicator + Action */}
                  <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
                    <div
                      className={`flex items-center gap-2 text-xs font-medium ${statusTextClass}`}
                      data-testid={`model-status-${model.id}`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${statusDotClass} ${
                          isDownloading ? 'animate-pulse' : ''
                        }`}
                        aria-hidden="true"
                      />
                      <span>{statusLabel}</span>
                    </div>

                    {isInstalled ? (
                      <div className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#4ADE80]">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Готово</span>
                      </div>
                    ) : isDownloading ? (
                      <button
                        type="button"
                        onClick={() => void handleCancelDownload(model.id)}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#7F1D1D] bg-[#2A1215] px-3 py-1.5 text-xs font-medium text-[#FCA5A5] transition-colors hover:bg-[#3A191D]"
                      >
                        <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                        <span>Пауза</span>
                      </button>
                    ) : isQueued ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-[#94A3B8]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        <span>Ожидание...</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={isDownloadingQueue || !dirInput.trim()}
                        onClick={() => void handleStartDownload([model.id])}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3 py-1.5 text-xs font-medium text-[#E2E8F0] transition-colors hover:border-[#E58E26]/60 hover:bg-[#222838] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{isPartial ? 'Докачать' : 'Скачать'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Live Download Progress or Resumable Partial Progress */}
                {(isDownloading || isPartial) && (
                  <div className="mt-3 space-y-1.5 border-t border-[#1A202D] pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] tabular-nums">
                      <span className="font-semibold text-[#F6AD55]">
                        {progressPct.toFixed(1)}%
                        {isDownloading && (live.resumedFromBytes ?? 0) > 0
                          ? ` · докачка с ${formatBytes(live.resumedFromBytes ?? 0)}`
                          : isPartial
                            ? ' · сохранён .part файл для докачки'
                            : ''}
                      </span>

                      <div className="flex flex-wrap items-center gap-x-2 text-[#94A3B8]">
                        <span>
                          {formatBytes(
                            isDownloading ? (live.downloadedBytes ?? 0) : model.partialSizeBytes,
                          )}{' '}
                          / {formatBytes(isDownloading ? (live.totalBytes ?? model.expectedSizeBytes) : model.expectedSizeBytes)}
                        </span>
                        {isDownloading && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#E2E8F0]">
                              {formatSpeed(live.speedBytesPerSec ?? 0)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>Осталось: {formatEta(live.etaSec)}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div
                      role="progressbar"
                      aria-valuenow={Math.round(progressPct)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Прогресс загрузки ${model.name}`}
                      className="h-1.5 w-full overflow-hidden rounded-full bg-[#1E2433]"
                    >
                      <div
                        className="h-full bg-[#E58E26] transition-[width] duration-200 ease-out"
                        style={{ width: `${Math.max(1, Math.min(100, progressPct))}%` }}
                      />
                    </div>
                  </div>
                )}

                {isMismatch && model.existingSizeBytes !== null && (
                  <p className="mt-2.5 text-xs text-[#F87171]">
                    Найден файл размером {formatBytes(model.existingSizeBytes)} вместо ожидаемых{' '}
                    {formatBytes(model.expectedSizeBytes)}. Нажмите «Скачать», чтобы перекачать
                    корректную копию.
                  </p>
                )}

                {isError && live?.error && (
                  <p className="mt-2.5 text-xs text-[#FCA5A5]">
                    {live.error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ComfyUI Video Export Nodes Info */}
      <section
        aria-labelledby="comfy-nodes-heading"
        className="mt-6 rounded-lg border border-[#222734] bg-[#10141C] p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <h2
              id="comfy-nodes-heading"
              className="text-sm font-semibold tracking-tight text-[#F1F5F9]"
            >
              Ноды ComfyUI для экспорта MP4
            </h2>
            <p className="text-xs leading-relaxed text-[#94A3B8]">
              Свежие сборки ComfyUI (Portable / Desktop) поддерживают экспорт видео через
              встроенные ноды{' '}
              <span className="font-mono text-[#CBD5E1]">CreateVideo</span> и{' '}
              <span className="font-mono text-[#CBD5E1]">SaveVideo</span> — KinoFlow Studio
              переключается на них автоматически, если{' '}
              <span className="font-mono text-[#CBD5E1]">VHS_VideoCombine</span> не установлен.
              Если вы используете более старую версию ComfyUI, установите пакет{' '}
              <a
                href="https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[#F6AD55] hover:text-[#FBD38D]"
              >
                <span>ComfyUI-VideoHelperSuite</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>{' '}
              в папку <span className="font-mono text-[#CBD5E1]">custom_nodes/</span> и
              перезапустите ComfyUI.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleCopyVhsCmd()}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3 py-1.5 text-xs font-medium text-[#E2E8F0] transition-colors hover:bg-[#222838]"
          >
            {copiedVhs ? (
              <Check className="h-3.5 w-3.5 text-[#22C55E]" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{copiedVhs ? 'Скопировано' : 'Копировать git clone'}</span>
          </button>
        </div>

        <pre className="mt-3 overflow-x-auto rounded-md border border-[#1E2330] bg-[#0B0D11] px-3 py-2 font-mono text-[11px] text-[#CBD5E1]">
          <code>{VHS_CLONE_CMD}</code>
        </pre>
      </section>
    </div>
  );
}
