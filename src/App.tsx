import { useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Play, Square, Type as TypeIcon } from 'lucide-react';
import { CharacterReferencesPanel } from './components/CharacterReferencesPanel';
import { CorsGuideView } from './components/CorsGuideView';
import { ModelsSetupView } from './components/ModelsSetupView';
import { PreviewAndHistoryPanel } from './components/PreviewAndHistoryPanel';
import { PromptWorkspace } from './components/PromptWorkspace';
import { SettingsPanel } from './components/SettingsPanel';
import { StartFramePanel } from './components/StartFramePanel';
import { UpdateControl } from './components/UpdateControl';
import { WorkflowInspectorView } from './components/WorkflowInspectorView';
import {
  DEFAULT_NEGATIVE_PROMPT,
  DURATION_CHOICES,
  FPS_CHOICES,
  RIFE_FPS_CHOICES,
  SEGMENT_DURATION_SEC,
  SHOOTING_STYLES,
  checkConnection,
  describeAutoRoutingStatus,
  getModelOption,
  getShootingStyleOption,
  resolveAutoModelRoute,
  runComfyGeneration,
  secondsToAlignedFrames,
} from './services/comfyService';
import {
  loadHistory,
  loadSavedSettings,
  saveHistory,
  saveSettings,
} from './services/historyStorage';
import { DEFAULT_COMFY_DIR } from './services/modelManagerService';
import { enhanceScenePrompt } from './services/promptService';
import { extractLastFrameFromVideo } from './utils/videoFrameUtils';
import type {
  CharacterReference,
  ConnectionInfo,
  DurationChoice,
  FpsChoice,
  GeneratedSegment,
  GenerationHistoryItem,
  GenerationMode,
  GenerationProgress,
  GenerationSettings,
  RifeTargetFps,
  ShootingStyleId,
  StartFrameReference,
} from './types/video';

type WorkspaceTab = 'studio' | 'models' | 'workflow' | 'cors';

function randomSeed(): number {
  return Math.floor(Math.random() * 4_294_967_295);
}

function getInitialSettings(): GenerationSettings {
  const defaults: GenerationSettings = {
    serverUrl: 'http://127.0.0.1:8188',
    comfyDir: DEFAULT_COMFY_DIR,
    mode: 't2v',
    modelId: 'auto',
    durationSec: 5,
    fps: 16,
    frames: secondsToAlignedFrames(SEGMENT_DURATION_SEC, 16),
    resolutionId: '832x480',
    width: 832,
    height: 480,
    steps: 28,
    seed: 104729,
    seedLocked: false,
    upscale1080p: false,
    rifeEnabled: false,
    rifeTargetFps: 24,
    shootingStyle: 'arri-35mm',
  };

  const saved = loadSavedSettings();
  if (!saved) return defaults;

  const validMode: GenerationMode = saved.mode === 'i2v' ? 'i2v' : 't2v';
  const validDuration: DurationChoice = DURATION_CHOICES.includes(
    saved.durationSec as DurationChoice,
  )
    ? (saved.durationSec as DurationChoice)
    : 5;
  const validFps: FpsChoice = FPS_CHOICES.includes(saved.fps as FpsChoice)
    ? (saved.fps as FpsChoice)
    : 16;
  const validRifeFps: RifeTargetFps = RIFE_FPS_CHOICES.includes(
    saved.rifeTargetFps as RifeTargetFps,
  )
    ? (saved.rifeTargetFps as RifeTargetFps)
    : 24;
  const validStyle: ShootingStyleId = SHOOTING_STYLES.some((s) => s.id === saved.shootingStyle)
    ? (saved.shootingStyle as ShootingStyleId)
    : 'arri-35mm';

  return {
    ...defaults,
    ...saved,
    comfyDir:
      typeof saved.comfyDir === 'string' && saved.comfyDir.trim().length > 0
        ? saved.comfyDir.trim()
        : DEFAULT_COMFY_DIR,
    mode: validMode,
    durationSec: validDuration,
    fps: validFps,
    frames: secondsToAlignedFrames(SEGMENT_DURATION_SEC, validFps),
    upscale1080p: Boolean(saved.upscale1080p),
    rifeEnabled: Boolean(saved.rifeEnabled),
    rifeTargetFps: validRifeFps,
    shootingStyle: validStyle,
  };
}

const IDLE_PROGRESS: GenerationProgress = {
  phase: 'idle',
  percent: 0,
  message: '',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('studio');
  const [settings, setSettings] = useState<GenerationSettings>(getInitialSettings);
  const [connection, setConnection] = useState<ConnectionInfo>({ status: 'idle' });
  const [startFrame, setStartFrame] = useState<StartFrameReference | null>(null);
  const [characters, setCharacters] = useState<CharacterReference[]>([]);

  const [prompt, setPrompt] = useState('');
  const [originalPromptBeforeEnhance, setOriginalPromptBeforeEnhance] = useState<string | null>(
    null,
  );
  const [negativePrompt, setNegativePrompt] = useState(DEFAULT_NEGATIVE_PROMPT);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);

  const [progress, setProgress] = useState<GenerationProgress>(IDLE_PROGRESS);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isExtending, setIsExtending] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [extendingSourceVideo, setExtendingSourceVideo] = useState<GenerationHistoryItem | null>(
    null,
  );

  const [history, setHistory] = useState<GenerationHistoryItem[]>(() => loadHistory());
  const [activeVideo, setActiveVideo] = useState<GenerationHistoryItem | null>(() => {
    const initial = loadHistory();
    return initial[0] ?? null;
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const charactersRef = useRef<CharacterReference[]>(characters);
  charactersRef.current = characters;
  const startFrameRef = useRef<StartFrameReference | null>(startFrame);
  startFrameRef.current = startFrame;

  const isGenerating =
    progress.phase === 'uploading' ||
    progress.phase === 'queuing' ||
    progress.phase === 'running' ||
    progress.phase === 'extracting_frame' ||
    progress.phase === 'finalizing';

  const autoRoutingStatus = describeAutoRoutingStatus({
    modelId: settings.modelId,
    mode: settings.mode,
    durationSec: settings.durationSec,
    hasStartFrame: Boolean(startFrame),
    isExtending: Boolean(extendingSourceVideo),
  });

  const activeRoutePreview = resolveAutoModelRoute({
    modelId: settings.modelId,
    mode: settings.mode,
    segmentIndex: 1,
    hasStartFrame: Boolean(startFrame),
    isContinuation: Boolean(extendingSourceVideo),
  });

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  useEffect(() => {
    return () => {
      for (const char of charactersRef.current) {
        URL.revokeObjectURL(char.previewUrl);
      }
      if (startFrameRef.current) {
        URL.revokeObjectURL(startFrameRef.current.previewUrl);
      }
    };
  }, []);

  const handleSettingsChange = useCallback((patch: Partial<GenerationSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleModeChange = useCallback((nextMode: GenerationMode) => {
    setSettings((prev) => ({ ...prev, mode: nextMode }));
    setGenerationError(null);
  }, []);

  const handleSelectStartFrameFile = useCallback((file: File, sourceLabel?: string) => {
    setStartFrame((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return {
        file,
        previewUrl: URL.createObjectURL(file),
        sourceLabel,
      };
    });
    setGenerationError(null);
  }, []);

  const handleClearStartFrame = useCallback(() => {
    setStartFrame((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return null;
    });
    setExtendingSourceVideo(null);
  }, []);

  const handleCheckConnection = useCallback(async () => {
    setConnection({ status: 'checking', message: 'Подключение к серверу ComfyUI...' });
    const result = await checkConnection(settings.serverUrl);
    if (result.detectedUrl && result.detectedUrl !== settings.serverUrl) {
      setSettings((prev) => ({ ...prev, serverUrl: result.detectedUrl! }));
    }
    setConnection(result);
  }, [settings.serverUrl]);

  const handleAddCharacterFiles = useCallback((files: File[]) => {
    setCharacters((prev) => {
      const remaining = Math.max(0, 3 - prev.length);
      if (remaining === 0) return prev;
      const accepted = files.slice(0, remaining);
      const nextItems: CharacterReference[] = accepted.map((file, idx) => {
        const cleanFileName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
        return {
          id: `${Date.now()}-${idx}-${Math.random().toString(16).slice(2)}`,
          file,
          previewUrl: URL.createObjectURL(file),
          name: cleanFileName.length > 0 && cleanFileName.length <= 24 ? cleanFileName : '',
          weight: 0.75,
        };
      });
      return [...prev, ...nextItems];
    });
  }, []);

  const handleUpdateCharacter = useCallback(
    (id: string, patch: Partial<Pick<CharacterReference, 'name' | 'weight'>>) => {
      setCharacters((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    },
    [],
  );

  const handleRemoveCharacter = useCallback((id: string) => {
    setCharacters((prev) => {
      const target = prev.find((c) => c.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((c) => c.id !== id);
    });
  }, []);

  const handlePromptChange = useCallback((value: string) => {
    setPrompt(value);
    setEnhanceError(null);
    setGenerationError(null);
  }, []);

  const handleEnhancePrompt = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      setEnhanceError('Введите описание сцены перед улучшением промпта.');
      return;
    }

    setIsEnhancing(true);
    setEnhanceError(null);

    try {
      const modelOption = getModelOption(settings.modelId);
      const styleOption = getShootingStyleOption(settings.shootingStyle);
      const enhanced = await enhanceScenePrompt({
        prompt: trimmed,
        model: `${modelOption.label} (${settings.mode === 'i2v' ? 'Image-to-Video' : 'Text-to-Video'})`,
        characters: characters.map((c) => ({ name: c.name, weight: c.weight })),
        durationSec: settings.durationSec,
        resolution: settings.upscale1080p
          ? `${settings.width}x${settings.height} (1080p cinema upscale)`
          : `${settings.width}x${settings.height}`,
        shootingStyleLabel: styleOption.label,
        shootingStyleCue: styleOption.promptCue,
      });

      if (originalPromptBeforeEnhance === null) {
        setOriginalPromptBeforeEnhance(trimmed);
      }
      setPrompt(enhanced);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Ошибка обращения к сервису улучшения промптов.';
      setEnhanceError(message);
    } finally {
      setIsEnhancing(false);
    }
  }, [prompt, settings, characters, originalPromptBeforeEnhance]);

  const handleRevertEnhancedPrompt = useCallback(() => {
    if (originalPromptBeforeEnhance !== null) {
      setPrompt(originalPromptBeforeEnhance);
      setOriginalPromptBeforeEnhance(null);
    }
  }, [originalPromptBeforeEnhance]);

  const handleLoadLocalVideo = useCallback(
    (file: File) => {
      const objectUrl = URL.createObjectURL(file);
      const item: GenerationHistoryItem = {
        id: `local-${Date.now()}`,
        createdAt: new Date().toISOString(),
        mode: settings.mode,
        prompt: `Загруженный клип: ${file.name}`,
        negativePrompt,
        modelId: settings.modelId,
        modelLabel: 'Локальный файл',
        width: settings.width,
        height: settings.height,
        durationSec: 5,
        fps: settings.fps,
        outputFps: settings.rifeEnabled ? settings.rifeTargetFps : settings.fps,
        upscale1080p: settings.upscale1080p,
        rifeEnabled: settings.rifeEnabled,
        rifeTargetFps: settings.rifeTargetFps,
        shootingStyle: settings.shootingStyle,
        frames: settings.frames,
        steps: settings.steps,
        seed: settings.seed,
        characters: characters.map((c, idx) => ({
          name: c.name.trim() || `Персонаж ${idx + 1}`,
          weight: c.weight,
        })),
        videoUrl: objectUrl,
        filename: file.name,
        subfolder: '',
        fileType: 'local',
        serverUrl: settings.serverUrl,
      };
      setActiveVideo(item);
      setExtendError(null);
      setGenerationError(null);
    },
    [settings, negativePrompt, characters],
  );

  const handleExtendScene = useCallback(
    async (videoEl: HTMLVideoElement | null, videoUrl: string, extraSeconds: 5 | 10 | 15) => {
      setIsExtending(true);
      setExtendError(null);

      try {
        const extracted = await extractLastFrameFromVideo(
          videoEl ?? videoUrl,
          `extend_start_frame_${Date.now()}.png`,
        );

        setStartFrame((prev) => {
          if (prev) {
            URL.revokeObjectURL(prev.previewUrl);
          }
          return {
            file: extracted.file,
            previewUrl: extracted.previewUrl,
            sourceLabel: `Последний кадр предыдущего видео (${extracted.width}×${extracted.height}) · +${extraSeconds} сек`,
          };
        });

        setSettings((prev) => ({
          ...prev,
          mode: 'i2v',
          durationSec: extraSeconds,
          frames: secondsToAlignedFrames(SEGMENT_DURATION_SEC, prev.fps),
        }));

        setExtendingSourceVideo(activeVideo);
        setGenerationError(null);

        // Focus prompt textarea so the user can describe the continuation action immediately
        window.requestAnimationFrame(() => {
          const textarea = document.getElementById(
            'scene-prompt-textarea',
          ) as HTMLTextAreaElement | null;
          textarea?.focus();
        });
      } catch (err) {
        setExtendError(
          err instanceof Error
            ? err.message
            : 'Не удалось извлечь последний кадр видео через <canvas>.',
        );
      } finally {
        setIsExtending(false);
      }
    },
    [activeVideo],
  );

  const handleGenerate = useCallback(async () => {
    if (activeTab !== 'studio') {
      setActiveTab('studio');
    }

    const activePrompt = prompt.trim();
    if (!activePrompt) {
      setGenerationError('Введите текстовое описание сцены перед запуском генерации.');
      return;
    }

    if (settings.mode === 'i2v' && !startFrame) {
      setGenerationError(
        'В режиме «Оживление фото» сначала загрузите стартовый кадр (Start Frame).',
      );
      return;
    }

    const effectiveSeed = settings.seedLocked ? settings.seed : randomSeed();
    const runSettings: GenerationSettings = { ...settings, seed: effectiveSeed };
    if (!settings.seedLocked) {
      setSettings(runSettings);
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setGenerationError(null);
    setProgress({
      phase: 'uploading',
      percent: 4,
      segmentIndex: 1,
      totalSegments: Math.ceil(runSettings.durationSec / SEGMENT_DURATION_SEC),
      segmentStartSec: 0,
      segmentEndSec: SEGMENT_DURATION_SEC,
      segmentMode: runSettings.mode,
      message: 'Инициализация пайплайна ComfyUI...',
    });

    try {
      const fallbackCharacterAnchors =
        characters.length === 0 && extendingSourceVideo?.characters
          ? extendingSourceVideo.characters
              .filter((c) => Boolean(c.filename))
              .map((c) => ({
                name: c.name,
                weight: c.weight,
                imageFilename: c.filename as string,
              }))
          : [];

      const result = await runComfyGeneration({
        settings: runSettings,
        positivePrompt: activePrompt,
        negativePrompt,
        characters,
        startFrame,
        isContinuation: Boolean(extendingSourceVideo),
        fallbackCharacterAnchors,
        signal: controller.signal,
        onProgress: setProgress,
      });

      const modelOption = getModelOption(runSettings.modelId);

      // If this generation extends a previous scene, chain the prior segments cleanly with no duration cap
      let combinedSegments: GeneratedSegment[] = result.segments;
      let totalDurationSec: number = runSettings.durationSec;

      if (extendingSourceVideo) {
        const priorSegments: GeneratedSegment[] =
          extendingSourceVideo.segments && extendingSourceVideo.segments.length > 0
            ? extendingSourceVideo.segments
            : [
                {
                  index: 1,
                  mode: extendingSourceVideo.mode,
                  startSec: 0,
                  endSec: extendingSourceVideo.durationSec,
                  promptId: extendingSourceVideo.id,
                  videoUrl: extendingSourceVideo.videoUrl,
                  filename: extendingSourceVideo.filename,
                  subfolder: extendingSourceVideo.subfolder,
                  fileType: extendingSourceVideo.fileType,
                  seed: extendingSourceVideo.seed,
                },
              ];

        const baseOffsetSec = priorSegments[priorSegments.length - 1]?.endSec ?? 0;
        const shiftedNewSegments = result.segments.map((seg, i) => ({
          ...seg,
          index: priorSegments.length + i + 1,
          startSec: baseOffsetSec + i * SEGMENT_DURATION_SEC,
          endSec: baseOffsetSec + (i + 1) * SEGMENT_DURATION_SEC,
        }));

        combinedSegments = [...priorSegments, ...shiftedNewSegments];
        totalDurationSec = baseOffsetSec + runSettings.durationSec;
      }

      const item: GenerationHistoryItem = {
        id: result.promptId,
        createdAt: new Date().toISOString(),
        mode: runSettings.mode,
        prompt: originalPromptBeforeEnhance || activePrompt,
        enhancedPrompt: originalPromptBeforeEnhance ? activePrompt : undefined,
        negativePrompt,
        modelId: runSettings.modelId,
        modelLabel: modelOption.shortLabel,
        width: runSettings.width,
        height: runSettings.height,
        durationSec: totalDurationSec,
        fps: runSettings.fps,
        outputFps: runSettings.rifeEnabled ? runSettings.rifeTargetFps : runSettings.fps,
        upscale1080p: runSettings.upscale1080p,
        rifeEnabled: runSettings.rifeEnabled,
        rifeTargetFps: runSettings.rifeTargetFps,
        shootingStyle: runSettings.shootingStyle,
        frames: runSettings.frames,
        steps: runSettings.steps,
        seed: runSettings.seed,
        characters:
          characters.length > 0
            ? characters.map((c, idx) => ({
                name: c.name.trim() || `Персонаж ${idx + 1}`,
                weight: c.weight,
                filename: result.uploadedNames[idx],
              }))
            : fallbackCharacterAnchors.map((c) => ({
                name: c.name,
                weight: c.weight,
                filename: c.imageFilename,
              })),
        videoUrl: result.output.viewUrl,
        filename: result.output.filename,
        subfolder: result.output.subfolder,
        fileType: result.output.type,
        serverUrl: runSettings.serverUrl,
        segments: combinedSegments,
        isExtendedFromId: extendingSourceVideo?.id,
      };

      setHistory((prev) => [item, ...prev.filter((h) => h.id !== item.id)]);
      setActiveVideo(item);
      setExtendingSourceVideo(null);
      setConnection({ status: 'online', message: 'Соединение активно' });
    } catch (err) {
      const isCancelled = controller.signal.aborted;
      const msg =
        err instanceof Error
          ? err.message
          : 'Не удалось связаться с локальным сервером ComfyUI.';
      setProgress({
        phase: isCancelled ? 'cancelled' : 'error',
        percent: 0,
        message: isCancelled ? 'Генерация отменена' : '',
      });
      if (!isCancelled) {
        setGenerationError(
          `${msg} Проверьте, что ComfyUI запущен на ${runSettings.serverUrl} с флагом --enable-cors-header "*".`,
        );
      }
    } finally {
      abortControllerRef.current = null;
    }
  }, [
    activeTab,
    prompt,
    settings,
    negativePrompt,
    characters,
    startFrame,
    originalPromptBeforeEnhance,
    extendingSourceVideo,
  ]);

  const handleCancelGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleRestoreHistoryItem = useCallback((item: GenerationHistoryItem) => {
    const validDuration: DurationChoice = DURATION_CHOICES.includes(
      item.durationSec as DurationChoice,
    )
      ? (item.durationSec as DurationChoice)
      : item.durationSec > 30
        ? 30
        : 5;
    const validFps: FpsChoice = FPS_CHOICES.includes(item.fps) ? item.fps : 16;
    const validRifeFps: RifeTargetFps = RIFE_FPS_CHOICES.includes(
      item.rifeTargetFps as RifeTargetFps,
    )
      ? (item.rifeTargetFps as RifeTargetFps)
      : 24;
    const validStyle: ShootingStyleId = SHOOTING_STYLES.some((s) => s.id === item.shootingStyle)
      ? (item.shootingStyle as ShootingStyleId)
      : 'arri-35mm';

    setSettings((prev) => ({
      ...prev,
      serverUrl: item.serverUrl || prev.serverUrl,
      mode: item.mode || 't2v',
      modelId: item.modelId,
      width: item.width,
      height: item.height,
      resolutionId: `${item.width}x${item.height}`,
      durationSec: validDuration,
      fps: validFps,
      frames: secondsToAlignedFrames(SEGMENT_DURATION_SEC, validFps),
      steps: item.steps,
      seed: item.seed,
      seedLocked: true,
      upscale1080p: Boolean(item.upscale1080p),
      rifeEnabled: Boolean(item.rifeEnabled),
      rifeTargetFps: validRifeFps,
      shootingStyle: validStyle,
    }));
    setPrompt(item.enhancedPrompt || item.prompt);
    setOriginalPromptBeforeEnhance(item.enhancedPrompt ? item.prompt : null);
    setNegativePrompt(item.negativePrompt);
    setActiveVideo(item);
    setActiveTab('studio');
  }, []);

  const handleDeleteHistoryItem = useCallback((id: string) => {
    setHistory((prev) => {
      const next = prev.filter((item) => item.id !== id);
      setActiveVideo((curr) => (curr?.id === id ? (next[0] ?? null) : curr));
      return next;
    });
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
    setActiveVideo(null);
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0D11] text-[#E6E9F0]">
      {/* Top Bar: strict 3-zone contract */}
      <header className="border-b border-[#222734] bg-[#0D1016]">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:gap-8 sm:px-6">
          {/* Zone 1: Single-line wordmark */}
          <a
            href="#studio"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('studio');
            }}
            className="whitespace-nowrap shrink-0 font-[var(--font-display)] text-base font-bold tracking-tight text-[#F8FAFC]"
          >
            KinoFlow Studio
          </a>

          {/* Zone 2: Clean single-line text nav links (desktop) */}
          <nav aria-label="Основная навигация" className="hidden items-center gap-6 md:flex">
            <button
              type="button"
              onClick={() => setActiveTab('studio')}
              className={`whitespace-nowrap shrink-0 border-b-2 py-4 text-sm font-medium transition-colors ${
                activeTab === 'studio'
                  ? 'border-[#E58E26] text-[#F8FAFC]'
                  : 'border-transparent text-[#94A3B8] hover:text-[#E2E8F0]'
              }`}
            >
              Студия
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('models')}
              className={`whitespace-nowrap shrink-0 border-b-2 py-4 text-sm font-medium transition-colors ${
                activeTab === 'models'
                  ? 'border-[#E58E26] text-[#F8FAFC]'
                  : 'border-transparent text-[#94A3B8] hover:text-[#E2E8F0]'
              }`}
            >
              Модели и установка
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('workflow')}
              className={`whitespace-nowrap shrink-0 border-b-2 py-4 text-sm font-medium transition-colors ${
                activeTab === 'workflow'
                  ? 'border-[#E58E26] text-[#F8FAFC]'
                  : 'border-transparent text-[#94A3B8] hover:text-[#E2E8F0]'
              }`}
            >
              Workflow API
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('cors')}
              className={`whitespace-nowrap shrink-0 border-b-2 py-4 text-sm font-medium transition-colors ${
                activeTab === 'cors'
                  ? 'border-[#E58E26] text-[#F8FAFC]'
                  : 'border-transparent text-[#94A3B8] hover:text-[#E2E8F0]'
              }`}
            >
              Инструкция
            </button>
          </nav>

          {/* Zone 3: Compact Auto-Routing status + Single primary CTA */}
          <div className="flex shrink-0 items-center gap-3">
            <UpdateControl busy={isGenerating} />
            <span
              data-testid="auto-routing-status"
              className="hidden whitespace-nowrap font-mono text-[11px] text-[#94A3B8] xl:inline"
            >
              {autoRoutingStatus}
            </span>

            {isGenerating ? (
              <button
                type="button"
                onClick={handleCancelGeneration}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-md border border-[#7F1D1D] bg-[#2A1215] px-3.5 py-2 text-xs font-semibold text-[#FCA5A5] transition-colors hover:bg-[#3A191D] focus-visible:outline-2 focus-visible:outline-[#E58E26]"
              >
                <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                <span>Остановить</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleGenerate()}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-md bg-[#E58E26] px-3.5 py-2 text-xs font-semibold text-[#0B0D11] transition-colors hover:bg-[#EE9B38] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E58E26] sm:px-4"
              >
                <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                <span className="hidden sm:inline">Сгенерировать видео</span>
                <span className="sm:hidden">Создать</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Navigation Tabs (< md) */}
      <nav
        aria-label="Мобильная навигация"
        className="flex border-b border-[#222734] bg-[#0D1016] px-2 md:hidden"
      >
        <button
          type="button"
          onClick={() => setActiveTab('studio')}
          className={`flex-1 whitespace-nowrap border-b-2 py-3 text-xs font-medium transition-colors ${
            activeTab === 'studio'
              ? 'border-[#E58E26] text-[#F8FAFC]'
              : 'border-transparent text-[#94A3B8]'
          }`}
        >
          Студия
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('models')}
          className={`flex-1 whitespace-nowrap border-b-2 py-3 text-xs font-medium transition-colors ${
            activeTab === 'models'
              ? 'border-[#E58E26] text-[#F8FAFC]'
              : 'border-transparent text-[#94A3B8]'
          }`}
        >
          Модели
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('workflow')}
          className={`flex-1 whitespace-nowrap border-b-2 py-3 text-xs font-medium transition-colors ${
            activeTab === 'workflow'
              ? 'border-[#E58E26] text-[#F8FAFC]'
              : 'border-transparent text-[#94A3B8]'
          }`}
        >
          Workflow
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('cors')}
          className={`flex-1 whitespace-nowrap border-b-2 py-3 text-xs font-medium transition-colors ${
            activeTab === 'cors'
              ? 'border-[#E58E26] text-[#F8FAFC]'
              : 'border-transparent text-[#94A3B8]'
          }`}
        >
          Инструкция
        </button>
      </nav>

      {/* Main Content */}
      <main>
        {activeTab === 'studio' && (
          <div className="mx-auto max-w-[1440px]">
            {/* Mode Selector Bar at the top of the Studio workspace */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#222734] bg-[#0D1118] px-4 py-3 sm:px-6">
              <div
                role="group"
                aria-label="Режим генерации"
                className="inline-flex w-full items-center rounded-lg border border-[#262C3A] bg-[#141821] p-1 sm:w-auto"
              >
                <button
                  type="button"
                  disabled={isGenerating}
                  aria-pressed={settings.mode === 't2v'}
                  onClick={() => handleModeChange('t2v')}
                  className={`inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50 sm:flex-initial ${
                    settings.mode === 't2v'
                      ? 'bg-[#222838] text-[#F8FAFC]'
                      : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                  }`}
                >
                  <TypeIcon className="h-3.5 w-3.5 text-[#F6AD55]" aria-hidden="true" />
                  <span>Текст → Видео</span>
                </button>
                <button
                  type="button"
                  disabled={isGenerating}
                  aria-pressed={settings.mode === 'i2v'}
                  onClick={() => handleModeChange('i2v')}
                  className={`inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#E58E26] disabled:opacity-50 sm:flex-initial ${
                    settings.mode === 'i2v'
                      ? 'bg-[#222838] text-[#F8FAFC]'
                      : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                  }`}
                >
                  <ImageIcon className="h-3.5 w-3.5 text-[#F6AD55]" aria-hidden="true" />
                  <span>Оживление фото</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#94A3B8]">
                <span className="font-medium text-[#CBD5E1] xl:hidden">{autoRoutingStatus}</span>
                <span className="xl:hidden" aria-hidden="true">
                  ·
                </span>
                <span className="font-mono text-[11px] text-[#94A3B8]">
                  {activeRoutePreview.workflowFile} · {activeRoutePreview.highNoiseModelFile}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[460px_minmax(0,1fr)] xl:grid-cols-[500px_minmax(0,1fr)]">
              {/* Left Control Rail */}
              <div className="border-b border-[#222734] bg-[#0F1219] px-5 py-6 sm:px-6 lg:min-h-[calc(100vh-116px)] lg:border-r lg:border-b-0">
                <SettingsPanel
                  settings={settings}
                  connection={connection}
                  disabled={isGenerating}
                  onChange={handleSettingsChange}
                  onCheckConnection={() => void handleCheckConnection()}
                  onRandomizeSeed={() => handleSettingsChange({ seed: randomSeed() })}
                />

                {settings.mode === 'i2v' && (
                  <StartFramePanel
                    startFrame={startFrame}
                    disabled={isGenerating}
                    onSelectFile={(file) => handleSelectStartFrameFile(file)}
                    onClear={handleClearStartFrame}
                  />
                )}

                <CharacterReferencesPanel
                  characters={characters}
                  maxCharacters={3}
                  disabled={isGenerating}
                  onAddFiles={handleAddCharacterFiles}
                  onUpdateCharacter={handleUpdateCharacter}
                  onRemoveCharacter={handleRemoveCharacter}
                />

                <PromptWorkspace
                  prompt={prompt}
                  originalPromptBeforeEnhance={originalPromptBeforeEnhance}
                  negativePrompt={negativePrompt}
                  characters={characters}
                  isEnhancing={isEnhancing}
                  enhanceError={enhanceError}
                  disabled={isGenerating}
                  onPromptChange={handlePromptChange}
                  onNegativePromptChange={setNegativePrompt}
                  onEnhancePrompt={() => void handleEnhancePrompt()}
                  onRevertEnhancedPrompt={handleRevertEnhancedPrompt}
                />
              </div>

              {/* Right Preview & History Stage */}
              <div className="px-5 py-6 sm:px-8">
                <PreviewAndHistoryPanel
                  progress={progress}
                  generationError={generationError}
                  activeVideo={activeVideo}
                  history={history}
                  isGenerating={isGenerating}
                  isExtending={isExtending}
                  extendError={extendError}
                  onCheckConnection={() => void handleCheckConnection()}
                  onCancelGeneration={handleCancelGeneration}
                  onExtendScene={(el, url, extraSec) =>
                    void handleExtendScene(el, url, extraSec)
                  }
                  onLoadLocalVideo={handleLoadLocalVideo}
                  onSelectHistoryItem={setActiveVideo}
                  onRestoreHistoryItem={handleRestoreHistoryItem}
                  onDeleteHistoryItem={handleDeleteHistoryItem}
                  onClearHistory={handleClearHistory}
                  onOpenCorsGuide={() => setActiveTab('cors')}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'models' && (
          <ModelsSetupView
            comfyDir={settings.comfyDir}
            onComfyDirChange={(nextDir) => handleSettingsChange({ comfyDir: nextDir })}
          />
        )}

        {activeTab === 'workflow' && (
          <WorkflowInspectorView
            settings={settings}
            prompt={prompt}
            negativePrompt={negativePrompt}
            characters={characters}
            startFrame={startFrame}
          />
        )}

        {activeTab === 'cors' && <CorsGuideView />}
      </main>
    </div>
  );
}
