import { useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, ListPlus, Play, Square, Type as TypeIcon } from 'lucide-react';
import { BatchQueuePanel } from './components/BatchQueuePanel';
import { CharacterReferencesPanel } from './components/CharacterReferencesPanel';
import { CorsGuideView } from './components/CorsGuideView';
import { ModelsSetupView } from './components/ModelsSetupView';
import { PreviewAndHistoryPanel } from './components/PreviewAndHistoryPanel';
import { PromptWorkspace } from './components/PromptWorkspace';
import { SettingsPanel } from './components/SettingsPanel';
import { StartFramePanel } from './components/StartFramePanel';
import { ComfyLauncherPanel } from './components/ComfyLauncherPanel';
import { ScenePresetBar } from './components/ScenePresetBar';
import { StoryboardPanel } from './components/StoryboardPanel';
import { UpdateControl } from './components/UpdateControl';
import { WorkflowInspectorView } from './components/WorkflowInspectorView';
import {
  clearFinishedBatchItems,
  createBatchQueueItem,
  enqueueBatchItem,
  getNextPendingBatchItem,
  loadBatchQueue,
  removeBatchItem,
  saveBatchQueue,
  updateBatchItem,
} from './services/batchQueue';
import type { BatchQueueItem } from './services/batchQueue';
import {
  DEFAULT_NEGATIVE_PROMPT,
  DURATION_CHOICES,
  FPS_CHOICES,
  RIFE_FPS_CHOICES,
  SAMPLER_CHOICES,
  SCHEDULER_CHOICES,
  SEGMENT_DURATION_SEC,
  SHOOTING_STYLES,
  VIDEO_MODELS,
  applyLightingToPrompt,
  applyShootingStyleToPrompt,
  checkConnection,
  computeOutputFps,
  describeAutoRoutingStatus,
  formatGenerationErrorMessage,
  getModelOption,
  getShootingStyleOption,
  isElectronComfyBridgeAvailable,
  resolveAutoModelRoute,
  runComfyGeneration,
  secondsToAlignedFrames,
} from './services/comfyService';
import {
  DEFAULT_COMFY_INSTANCES_SETTINGS,
  HISTORY_AUTOSAVE_INTERVAL_MS,
  loadHistory,
  loadSavedSettings,
  normalizeComfyInstancesSettings,
  saveHistory,
  saveSettings,
  startHistoryAutoSave,
} from './services/historyStorage';
import { DEFAULT_COMFY_DIR } from './services/modelManagerService';
import { PreflightError, fetchAvailableLoras } from './services/preflightService';
import { exportScenePreset } from './services/scenePreset';
import type { ScenePreset } from './services/scenePreset';
import { countStoryboardSegments, getCameraPreset, resizeStoryboard } from './services/storyboard';
import type { CameraPresetId, StoryboardShot } from './services/storyboard';
import type { PreflightReport } from './services/preflightService';
import {
  containsCyrillic,
  enhanceScenePromptDetailed,
  translatePromptToEnglishViaLocalLlm,
} from './services/promptService';
import { extractLastFrameFromVideo } from './utils/videoFrameUtils';
import type {
  BaseModelId,
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
  SamplerName,
  SchedulerName,
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
    comfyInstances: {
      '1': { ...DEFAULT_COMFY_INSTANCES_SETTINGS['1'] },
      '2': { ...DEFAULT_COMFY_INSTANCES_SETTINGS['2'] },
    },
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
    offlineMode: false,
    localLlmUrl: '',
    localLlmModel: '',
    fastLightX2V: false,
    samplerName: 'uni_pc',
    scheduler: 'simple',
    customLoraName: '',
    customLoraStrength: 0.8,
    autoCropStartFrame: true,
    preventColorDrift: true,
    autoTranslateRuPrompt: true,
  };

  const saved = loadSavedSettings();
  if (!saved) return defaults;

  const validMode: GenerationMode = saved.mode === 'i2v' ? 'i2v' : 't2v';
  const validModelId: BaseModelId = VIDEO_MODELS.some((m) => m.id === saved.modelId)
    ? (saved.modelId as BaseModelId)
    : 'auto';
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
  const validSampler: SamplerName = SAMPLER_CHOICES.includes(saved.samplerName as SamplerName)
    ? (saved.samplerName as SamplerName)
    : 'uni_pc';
  const validScheduler: SchedulerName = SCHEDULER_CHOICES.includes(
    saved.scheduler as SchedulerName,
  )
    ? (saved.scheduler as SchedulerName)
    : 'simple';

  return {
    ...defaults,
    ...saved,
    comfyDir:
      typeof saved.comfyDir === 'string' && saved.comfyDir.trim().length > 0
        ? saved.comfyDir.trim()
        : DEFAULT_COMFY_DIR,
    comfyInstances: normalizeComfyInstancesSettings(saved.comfyInstances),
    mode: validMode,
    modelId: validModelId,
    durationSec: validDuration,
    fps: validFps,
    frames: secondsToAlignedFrames(SEGMENT_DURATION_SEC, validFps),
    upscale1080p: Boolean(saved.upscale1080p),
    rifeEnabled: Boolean(saved.rifeEnabled),
    rifeTargetFps: validRifeFps,
    shootingStyle: validStyle,
    offlineMode: Boolean(saved.offlineMode),
    localLlmUrl: typeof saved.localLlmUrl === 'string' ? saved.localLlmUrl : '',
    localLlmModel: typeof saved.localLlmModel === 'string' ? saved.localLlmModel : '',
    fastLightX2V: Boolean(saved.fastLightX2V),
    samplerName: validSampler,
    scheduler: validScheduler,
    customLoraName: typeof saved.customLoraName === 'string' ? saved.customLoraName : '',
    customLoraStrength:
      typeof saved.customLoraStrength === 'number' && Number.isFinite(saved.customLoraStrength)
        ? saved.customLoraStrength
        : 0.8,
    autoCropStartFrame: saved.autoCropStartFrame !== false,
    preventColorDrift: saved.preventColorDrift !== false,
    autoTranslateRuPrompt: saved.autoTranslateRuPrompt !== false,
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
  const [endFrame, setEndFrame] = useState<StartFrameReference | null>(null);
  const [characters, setCharacters] = useState<CharacterReference[]>([]);
  const [availableLoras, setAvailableLoras] = useState<string[]>([]);
  const [isLoadingLoras, setIsLoadingLoras] = useState(false);

  const [prompt, setPrompt] = useState('');
  const [originalPromptBeforeEnhance, setOriginalPromptBeforeEnhance] = useState<string | null>(
    null,
  );
  const [negativePrompt, setNegativePrompt] = useState(DEFAULT_NEGATIVE_PROMPT);
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('none');
  const [lightingPreset, setLightingPreset] = useState('');
  const [storyboardEnabled, setStoryboardEnabled] = useState(false);
  const [storyboardShots, setStoryboardShots] = useState<StoryboardShot[]>([]);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [enhanceSourceLabel, setEnhanceSourceLabel] = useState<string | null>(null);

  const [progress, setProgress] = useState<GenerationProgress>(IDLE_PROGRESS);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [preflightReport, setPreflightReport] = useState<PreflightReport | null>(null);
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
  const [batchQueue, setBatchQueue] = useState<BatchQueueItem[]>(() => loadBatchQueue());
  const [isRunningBatchQueue, setIsRunningBatchQueue] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const stopBatchQueueRef = useRef(false);
  const batchQueueRef = useRef<BatchQueueItem[]>(batchQueue);
  batchQueueRef.current = batchQueue;
  const historyRef = useRef<GenerationHistoryItem[]>(history);
  historyRef.current = history;
  const charactersRef = useRef<CharacterReference[]>(characters);
  charactersRef.current = characters;
  const startFrameRef = useRef<StartFrameReference | null>(startFrame);
  startFrameRef.current = startFrame;
  const endFrameRef = useRef<StartFrameReference | null>(endFrame);
  endFrameRef.current = endFrame;

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
    return startHistoryAutoSave(() => historyRef.current, {
      intervalMs: HISTORY_AUTOSAVE_INTERVAL_MS,
    });
  }, []);

  useEffect(() => {
    saveBatchQueue(batchQueue);
  }, [batchQueue]);

  useEffect(() => {
    return () => {
      for (const char of charactersRef.current) {
        URL.revokeObjectURL(char.previewUrl);
      }
      if (startFrameRef.current) {
        URL.revokeObjectURL(startFrameRef.current.previewUrl);
      }
      if (endFrameRef.current) {
        URL.revokeObjectURL(endFrameRef.current.previewUrl);
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

  const handleSelectEndFrameFile = useCallback((file: File) => {
    setEndFrame((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return {
        file,
        previewUrl: URL.createObjectURL(file),
      };
    });
    setGenerationError(null);
  }, []);

  const handleClearEndFrame = useCallback(() => {
    setEndFrame((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return null;
    });
  }, []);

  const handleRefreshLoras = useCallback(
    async (urlOverride?: string) => {
      const targetUrl = urlOverride ?? settings.serverUrl;
      setIsLoadingLoras(true);
      try {
        const loras = await fetchAvailableLoras(targetUrl);
        setAvailableLoras(loras);
      } finally {
        setIsLoadingLoras(false);
      }
    },
    [settings.serverUrl],
  );

  useEffect(() => {
    if (!isElectronComfyBridgeAvailable()) return;
    let active = true;

    const launcher = typeof window !== 'undefined' ? window.kinoflowLauncher : undefined;
    if (launcher?.detectDir) {
      void launcher
        .detectDir()
        .then((res) => {
          if (active && res.comfyDir && res.comfyDir !== settings.comfyDir) {
            setSettings((prev) => ({ ...prev, comfyDir: res.comfyDir! }));
          }
        })
        .catch(() => undefined);
    }

    void checkConnection(settings.serverUrl, 3500)
      .then((result) => {
        if (!active) return;
        const resolvedUrl = result.detectedUrl || settings.serverUrl;
        if (result.detectedUrl && result.detectedUrl !== settings.serverUrl) {
          setSettings((prev) => ({ ...prev, serverUrl: result.detectedUrl! }));
        }
        setConnection(result);
        if (result.status === 'online') {
          void handleRefreshLoras(resolvedUrl);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
    // Run initial Electron environment auto-detection once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCheckConnection = useCallback(async () => {
    setConnection({ status: 'checking', message: 'Подключение к серверу ComfyUI...' });
    const result = await checkConnection(settings.serverUrl);
    const resolvedUrl = result.detectedUrl || settings.serverUrl;
    if (result.detectedUrl && result.detectedUrl !== settings.serverUrl) {
      setSettings((prev) => ({ ...prev, serverUrl: result.detectedUrl! }));
    }
    setConnection(result);
    if (result.status === 'online') {
      void handleRefreshLoras(resolvedUrl);
    }
  }, [settings.serverUrl, handleRefreshLoras]);

  const handleAddCharacterFiles = useCallback((files: File[]) => {
    setCharacters((prev) => {
      const remaining = Math.max(0, 1 - prev.length);
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
    setEnhanceSourceLabel(null);
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
      const cameraCue = getCameraPreset(cameraPreset).cue;
      const result = await enhanceScenePromptDetailed(
        {
          prompt: trimmed,
          model: `${modelOption.label} (${settings.mode === 'i2v' ? 'Image-to-Video' : 'Text-to-Video'})`,
          characters: characters.map((c) => ({ name: c.name, weight: c.weight })),
          durationSec: settings.durationSec,
          resolution: settings.upscale1080p
            ? `${settings.width}x${settings.height} (1080p cinema upscale)`
            : `${settings.width}x${settings.height}`,
          shootingStyleLabel: styleOption.label,
          shootingStyleCue: styleOption.promptCue,
          cameraMovement: cameraCue || undefined,
          lightingPreset: lightingPreset || undefined,
        },
        {
          offlineMode: Boolean(settings.offlineMode),
          localLlmUrl: settings.localLlmUrl,
          localLlmModel: settings.localLlmModel,
        },
      );

      if (originalPromptBeforeEnhance === null) {
        setOriginalPromptBeforeEnhance(trimmed);
      }
      setPrompt(result.enhancedPrompt);
      setEnhanceSourceLabel(
        result.source === 'local-llm'
          ? 'Улучшено: локальная LLM (автономно)'
          : result.source === 'offline-composer'
            ? 'Улучшено: автономный кинематографический конструктор'
            : 'Улучшено: Gemini',
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Ошибка обращения к сервису улучшения промптов.';
      setEnhanceError(message);
    } finally {
      setIsEnhancing(false);
    }
  }, [prompt, settings, characters, cameraPreset, lightingPreset, originalPromptBeforeEnhance]);

  const handleTranslatePrompt = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || !settings.localLlmUrl?.trim()) return;
    setIsTranslating(true);
    setEnhanceError(null);
    try {
      const translated = await translatePromptToEnglishViaLocalLlm(trimmed, {
        url: settings.localLlmUrl,
        model: settings.localLlmModel,
      });
      if (!translated) {
        setEnhanceError(
          'Локальная LLM не ответила на запрос перевода. Проверьте запущен ли Ollama / LM Studio.',
        );
        return;
      }
      if (originalPromptBeforeEnhance === null) {
        setOriginalPromptBeforeEnhance(trimmed);
      }
      setPrompt(translated);
      setEnhanceSourceLabel('Переведено RU → EN (локальная LLM)');
    } finally {
      setIsTranslating(false);
    }
  }, [prompt, settings.localLlmUrl, settings.localLlmModel, originalPromptBeforeEnhance]);

  const handleRevertEnhancedPrompt = useCallback(() => {
    if (originalPromptBeforeEnhance !== null) {
      setPrompt(originalPromptBeforeEnhance);
      setOriginalPromptBeforeEnhance(null);
      setEnhanceSourceLabel(null);
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
        outputFps: computeOutputFps(settings.fps, settings.rifeEnabled),
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
    setPreflightReport(null);
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

    const completedSegmentsCheckpoint: GeneratedSegment[] = [];

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

      let promptForComfy = activePrompt;
      if (
        runSettings.autoTranslateRuPrompt !== false &&
        runSettings.localLlmUrl?.trim() &&
        containsCyrillic(activePrompt)
      ) {
        setProgress((prev) => ({
          ...prev,
          message: 'Перевод русского промпта на английский (локальная LLM)...',
        }));
        const translated = await translatePromptToEnglishViaLocalLlm(activePrompt, {
          url: runSettings.localLlmUrl,
          model: runSettings.localLlmModel,
        });
        if (translated) {
          promptForComfy = translated;
        }
      }

      const styledPrompt = applyShootingStyleToPrompt(
        promptForComfy,
        runSettings.shootingStyle,
        originalPromptBeforeEnhance !== null,
      );
      const effectivePositivePrompt = applyLightingToPrompt(
        styledPrompt,
        lightingPreset,
        originalPromptBeforeEnhance !== null,
      );

      const result = await runComfyGeneration({
        settings: runSettings,
        positivePrompt: effectivePositivePrompt,
        negativePrompt,
        characters,
        storyboard:
          storyboardEnabled && runSettings.durationSec >= 10
            ? resizeStoryboard(storyboardShots, countStoryboardSegments(runSettings.durationSec))
            : undefined,
        defaultCamera: cameraPreset,
        startFrame,
        endFrame: runSettings.mode === 'i2v' ? endFrame : null,
        isContinuation: Boolean(extendingSourceVideo),
        fallbackCharacterAnchors,
        signal: controller.signal,
        onProgress: setProgress,
        onSegmentCompleted: (_seg, allCompleted) => {
          completedSegmentsCheckpoint.length = 0;
          completedSegmentsCheckpoint.push(...allCompleted);
        },
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

      const lastRenderedSeg = result.segments[result.segments.length - 1];
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
        outputFps: computeOutputFps(runSettings.fps, runSettings.rifeEnabled),
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
        localFilePath: lastRenderedSeg?.localFilePath,
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

      // Save any already-finished segments so multi-segment progress is never lost
      let partialSavedNote = '';
      if (completedSegmentsCheckpoint.length > 0) {
        const modelOption = getModelOption(runSettings.modelId);
        const lastDone = completedSegmentsCheckpoint[completedSegmentsCheckpoint.length - 1];
        const partialDuration = completedSegmentsCheckpoint.length * SEGMENT_DURATION_SEC;
        const partialItem: GenerationHistoryItem = {
          id: lastDone.promptId,
          createdAt: new Date().toISOString(),
          mode: runSettings.mode,
          prompt: originalPromptBeforeEnhance || activePrompt,
          enhancedPrompt: originalPromptBeforeEnhance ? activePrompt : undefined,
          negativePrompt,
          modelId: runSettings.modelId,
          modelLabel: `${modelOption.shortLabel} (частично)`,
          width: runSettings.width,
          height: runSettings.height,
          durationSec: partialDuration,
          fps: runSettings.fps,
          outputFps: computeOutputFps(runSettings.fps, runSettings.rifeEnabled),
          upscale1080p: runSettings.upscale1080p,
          rifeEnabled: runSettings.rifeEnabled,
          rifeTargetFps: runSettings.rifeTargetFps,
          shootingStyle: runSettings.shootingStyle,
          frames: runSettings.frames,
          steps: runSettings.steps,
          seed: runSettings.seed,
          characters: characters.map((c, idx) => ({
            name: c.name.trim() || `Персонаж ${idx + 1}`,
            weight: c.weight,
          })),
          videoUrl: lastDone.videoUrl,
          filename: lastDone.filename,
          subfolder: lastDone.subfolder,
          fileType: lastDone.fileType,
          serverUrl: runSettings.serverUrl,
          localFilePath: lastDone.localFilePath,
          segments: [...completedSegmentsCheckpoint],
        };
        setHistory((prev) => [partialItem, ...prev.filter((h) => h.id !== partialItem.id)]);
        setActiveVideo(partialItem);
        partialSavedNote = ` Готовые сегменты (${completedSegmentsCheckpoint.length} шт., ${partialDuration} с) сохранены в историю — можно продолжить с последнего кадра.`;
      }

      setProgress({
        phase: isCancelled ? 'cancelled' : 'error',
        percent: 0,
        message: isCancelled
          ? `Генерация отменена.${partialSavedNote}`
          : '',
      });
      if (!isCancelled && err instanceof PreflightError) {
        setPreflightReport(err.report);
        setGenerationError('Проверка перед запуском нашла, чего не хватает в ComfyUI.');
      } else if (!isCancelled) {
        const formatted = formatGenerationErrorMessage({
          message: msg,
          serverUrl: runSettings.serverUrl,
          isElectron: isElectronComfyBridgeAvailable(),
          pageProtocol:
            typeof window !== 'undefined' && window.location
              ? window.location.protocol
              : undefined,
        });
        setGenerationError(`${formatted}${partialSavedNote}`);
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
    endFrame,
    originalPromptBeforeEnhance,
    extendingSourceVideo,
    storyboardEnabled,
    storyboardShots,
    cameraPreset,
    lightingPreset,
  ]);

  const handleCancelGeneration = useCallback(() => {
    stopBatchQueueRef.current = true;
    abortControllerRef.current?.abort();
  }, []);

  const handleAddToBatchQueue = useCallback(() => {
    const activePrompt = prompt.trim();
    if (!activePrompt) {
      setGenerationError('Введите описание сцены перед добавлением в очередь.');
      return;
    }
    if (settings.mode === 'i2v' && !startFrame) {
      setGenerationError(
        'Для режима I2V в очереди выберите стартовый кадр или переключитесь на «Текст → Видео».',
      );
      return;
    }
    const item = createBatchQueueItem({
      prompt: activePrompt,
      negativePrompt,
      cameraPreset,
      lightingPreset,
      settings,
    });
    setBatchQueue((prev) => enqueueBatchItem(prev, item));
    setGenerationError(null);
    if (activeTab !== 'studio') {
      setActiveTab('studio');
    }
  }, [prompt, negativePrompt, cameraPreset, lightingPreset, settings, startFrame, activeTab]);

  const handleRemoveBatchItem = useCallback((id: string) => {
    setBatchQueue((prev) => removeBatchItem(prev, id));
  }, []);

  const handleClearFinishedBatchItems = useCallback(() => {
    setBatchQueue((prev) => clearFinishedBatchItems(prev));
  }, []);

  const handleStopBatchQueue = useCallback(() => {
    stopBatchQueueRef.current = true;
    abortControllerRef.current?.abort();
  }, []);

  const handleStartBatchQueue = useCallback(async () => {
    if (isRunningBatchQueue || isGenerating) return;
    stopBatchQueueRef.current = false;
    setIsRunningBatchQueue(true);
    setGenerationError(null);
    setPreflightReport(null);

    try {
      while (!stopBatchQueueRef.current) {
        const nextJob = getNextPendingBatchItem(batchQueueRef.current);
        if (!nextJob) break;

        setBatchQueue((prev) => updateBatchItem(prev, nextJob.id, { status: 'running', error: undefined }));

        const effectiveSeed = nextJob.settings.seedLocked ? nextJob.settings.seed : randomSeed();
        const runSettings: GenerationSettings = { ...nextJob.settings, seed: effectiveSeed };
        const controller = new AbortController();
        abortControllerRef.current = controller;

        setProgress({
          phase: 'uploading',
          percent: 4,
          segmentIndex: 1,
          totalSegments: Math.ceil(runSettings.durationSec / SEGMENT_DURATION_SEC),
          segmentStartSec: 0,
          segmentEndSec: SEGMENT_DURATION_SEC,
          segmentMode: runSettings.mode,
          message: `Очередь: запуск сцены «${nextJob.prompt.slice(0, 48)}»...`,
        });

        try {
          let promptForComfy = nextJob.prompt;
          if (
            runSettings.autoTranslateRuPrompt !== false &&
            runSettings.localLlmUrl?.trim() &&
            containsCyrillic(nextJob.prompt)
          ) {
            const translated = await translatePromptToEnglishViaLocalLlm(nextJob.prompt, {
              url: runSettings.localLlmUrl,
              model: runSettings.localLlmModel,
            });
            if (translated) promptForComfy = translated;
          }

          const styledPrompt = applyShootingStyleToPrompt(
            promptForComfy,
            runSettings.shootingStyle,
            false,
          );
          const effectivePositivePrompt = applyLightingToPrompt(
            styledPrompt,
            nextJob.lightingPreset,
            false,
          );

          const result = await runComfyGeneration({
            settings: runSettings,
            positivePrompt: effectivePositivePrompt,
            negativePrompt: nextJob.negativePrompt,
            characters: [],
            defaultCamera: nextJob.cameraPreset,
            startFrame: runSettings.mode === 'i2v' ? startFrameRef.current : null,
            endFrame: runSettings.mode === 'i2v' ? endFrameRef.current : null,
            signal: controller.signal,
            onProgress: setProgress,
          });

          const modelOption = getModelOption(runSettings.modelId);
          const lastRenderedSeg = result.segments[result.segments.length - 1];
          const historyItem: GenerationHistoryItem = {
            id: result.promptId,
            createdAt: new Date().toISOString(),
            mode: runSettings.mode,
            prompt: nextJob.prompt,
            enhancedPrompt: promptForComfy !== nextJob.prompt ? promptForComfy : undefined,
            negativePrompt: nextJob.negativePrompt,
            modelId: runSettings.modelId,
            modelLabel: modelOption.shortLabel,
            width: runSettings.width,
            height: runSettings.height,
            durationSec: runSettings.durationSec,
            fps: runSettings.fps,
            outputFps: computeOutputFps(runSettings.fps, runSettings.rifeEnabled),
            upscale1080p: runSettings.upscale1080p,
            rifeEnabled: runSettings.rifeEnabled,
            rifeTargetFps: runSettings.rifeTargetFps,
            shootingStyle: runSettings.shootingStyle,
            frames: runSettings.frames,
            steps: runSettings.steps,
            seed: runSettings.seed,
            characters: [],
            videoUrl: result.output.viewUrl,
            filename: result.output.filename,
            subfolder: result.output.subfolder,
            fileType: result.output.type,
            serverUrl: runSettings.serverUrl,
            localFilePath: lastRenderedSeg?.localFilePath,
            segments: result.segments,
          };

          setHistory((prev) => [historyItem, ...prev.filter((h) => h.id !== historyItem.id)]);
          setActiveVideo(historyItem);
          setBatchQueue((prev) =>
            updateBatchItem(prev, nextJob.id, {
              status: 'completed',
              resultHistoryId: historyItem.id,
            }),
          );
        } catch (err) {
          const isCancelled = controller.signal.aborted || stopBatchQueueRef.current;
          const rawMsg =
            err instanceof Error ? err.message : 'Ошибка выполнения задачи в очереди ComfyUI.';
          const formatted = formatGenerationErrorMessage({
            message: rawMsg,
            serverUrl: runSettings.serverUrl,
            isElectron: isElectronComfyBridgeAvailable(),
            pageProtocol:
              typeof window !== 'undefined' && window.location
                ? window.location.protocol
                : undefined,
          });
          setBatchQueue((prev) =>
            updateBatchItem(prev, nextJob.id, {
              status: isCancelled ? 'pending' : 'failed',
              error: isCancelled ? undefined : formatted,
            }),
          );
          if (isCancelled) {
            setProgress({ phase: 'cancelled', percent: 0, message: 'Очередь остановлена.' });
            break;
          }
          setGenerationError(formatted);
        } finally {
          abortControllerRef.current = null;
        }
      }
    } finally {
      setIsRunningBatchQueue(false);
    }
  }, [isRunningBatchQueue, isGenerating]);

  const handleExportScenePreset = useCallback(
    () =>
      exportScenePreset({
        prompt,
        negativePrompt,
        cameraPreset,
        storyboardEnabled,
        storyboardShots,
        settings,
      }),
    [prompt, negativePrompt, cameraPreset, storyboardEnabled, storyboardShots, settings],
  );

  const handleImportScenePreset = useCallback(
    (preset: ScenePreset) => {
      handlePromptChange(preset.prompt);
      setOriginalPromptBeforeEnhance(null);
      setNegativePrompt(preset.negativePrompt || DEFAULT_NEGATIVE_PROMPT);
      setCameraPreset(preset.cameraPreset);
      setStoryboardEnabled(preset.storyboardEnabled);
      setStoryboardShots(preset.storyboardShots);
      handleSettingsChange(preset.settings);
    },
    [handlePromptChange, handleSettingsChange],
  );

  // Ctrl+Enter starts a generation from anywhere in the studio.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        if (activeTab === 'studio' && !isGenerating) {
          event.preventDefault();
          void handleGenerate();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab, isGenerating, handleGenerate]);

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

    const validModelId: BaseModelId = VIDEO_MODELS.some((m) => m.id === item.modelId)
      ? item.modelId
      : 'auto';

    setSettings((prev) => ({
      ...prev,
      serverUrl: item.serverUrl || prev.serverUrl,
      mode: item.mode || 't2v',
      modelId: validModelId,
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
            <UpdateControl busy={isGenerating} offlineMode={Boolean(settings.offlineMode)} />
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddToBatchQueue}
                  title="Добавить текущую сцену в очередь пакетной генерации"
                  className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3 py-2 text-xs font-medium text-[#E2E8F0] transition-colors hover:border-[#3A4358] hover:bg-[#222838] focus-visible:outline-2 focus-visible:outline-[#E58E26]"
                >
                  <ListPlus className="h-3.5 w-3.5 text-[#F6AD55]" aria-hidden="true" />
                  <span className="hidden sm:inline">В очередь</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-md bg-[#E58E26] px-3.5 py-2 text-xs font-semibold text-[#0B0D11] transition-colors hover:bg-[#EE9B38] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E58E26] sm:px-4"
                >
                  <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  <span className="hidden sm:inline">Сгенерировать видео</span>
                  <span className="sm:hidden">Создать</span>
                </button>
              </div>
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
                  availableLoras={availableLoras}
                  isLoadingLoras={isLoadingLoras}
                  disabled={isGenerating}
                  onChange={handleSettingsChange}
                  onCheckConnection={() => void handleCheckConnection()}
                  onRefreshLoras={() => void handleRefreshLoras()}
                  onRandomizeSeed={() => handleSettingsChange({ seed: randomSeed() })}
                />

                <ComfyLauncherPanel
                  comfyDir={settings.comfyDir}
                  instancesConfig={
                    settings.comfyInstances ?? DEFAULT_COMFY_INSTANCES_SETTINGS
                  }
                  serverUrl={settings.serverUrl}
                  connectionStatus={connection.status}
                  disabled={isGenerating}
                  onChangeInstancesConfig={(nextInstances) =>
                    handleSettingsChange({ comfyInstances: nextInstances })
                  }
                  onCheckConnection={() => void handleCheckConnection()}
                />

                {settings.mode === 'i2v' && (
                  <StartFramePanel
                    startFrame={startFrame}
                    endFrame={endFrame}
                    disabled={isGenerating}
                    onSelectFile={(file) => handleSelectStartFrameFile(file)}
                    onClear={handleClearStartFrame}
                    onSelectEndFrameFile={handleSelectEndFrameFile}
                    onClearEndFrame={handleClearEndFrame}
                  />
                )}

                <CharacterReferencesPanel
                  characters={characters}
                  maxCharacters={1}
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
                  cameraPreset={cameraPreset}
                  lightingPreset={lightingPreset}
                  enhanceSourceLabel={enhanceSourceLabel}
                  isEnhancing={isEnhancing}
                  isTranslating={isTranslating}
                  enhanceError={enhanceError}
                  offlineMode={Boolean(settings.offlineMode)}
                  hasLocalLlm={Boolean(settings.localLlmUrl?.trim())}
                  disabled={isGenerating}
                  onPromptChange={handlePromptChange}
                  onNegativePromptChange={setNegativePrompt}
                  onCameraPresetChange={setCameraPreset}
                  onLightingPresetChange={setLightingPreset}
                  onEnhancePrompt={() => void handleEnhancePrompt()}
                  onTranslatePrompt={() => void handleTranslatePrompt()}
                  onRevertEnhancedPrompt={handleRevertEnhancedPrompt}
                />

                <StoryboardPanel
                  durationSec={settings.durationSec}
                  storyboardEnabled={storyboardEnabled}
                  shots={storyboardShots}
                  disabled={isGenerating}
                  onStoryboardEnabledChange={setStoryboardEnabled}
                  onShotsChange={setStoryboardShots}
                />

                <ScenePresetBar
                  disabled={isGenerating}
                  onExport={handleExportScenePreset}
                  onImport={handleImportScenePreset}
                />
              </div>

              {/* Right Preview & History Stage */}
              <div className="space-y-6 px-5 py-6 sm:px-8">
                <BatchQueuePanel
                  items={batchQueue}
                  isRunningQueue={isRunningBatchQueue}
                  isGenerating={isGenerating}
                  onStartQueue={() => void handleStartBatchQueue()}
                  onStopQueue={handleStopBatchQueue}
                  onRemoveItem={handleRemoveBatchItem}
                  onClearFinished={handleClearFinishedBatchItems}
                />

                <PreviewAndHistoryPanel
                  comfyDir={settings.comfyDir}
                  progress={progress}
                  generationError={generationError}
                  preflightReport={preflightReport}
                  onOpenModels={() => setActiveTab('models')}
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
            requiredModelIds={
              preflightReport
                ? Array.from(
                    new Set(
                      preflightReport.missingFiles
                        .map((file) => file.catalogModelId)
                        .filter((id): id is string => Boolean(id)),
                    ),
                  )
                : []
            }
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
            endFrame={endFrame}
          />
        )}

        {activeTab === 'cors' && <CorsGuideView />}
      </main>
    </div>
  );
}
