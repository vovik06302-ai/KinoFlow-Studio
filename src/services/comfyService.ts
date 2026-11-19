import workflowT2VTemplate from '../../workflow_t2v.json';
import workflowI2VTemplate from '../../workflow_i2v.json';
import { extractLastFrameFromVideo } from '../utils/videoFrameUtils';
import type {
  BaseModelId,
  CharacterReference,
  ConnectionInfo,
  DurationChoice,
  FpsChoice,
  GeneratedSegment,
  GenerationMode,
  GenerationProgress,
  GenerationSettings,
  ResolutionOption,
  RifeTargetFps,
  ShootingStyleId,
  ShootingStyleOption,
  StartFrameReference,
  VideoModelOption,
} from '../types/video';

export const SEGMENT_DURATION_SEC = 5;
export const DURATION_CHOICES: DurationChoice[] = [5, 10, 15, 20, 25, 30];
export const FPS_CHOICES: FpsChoice[] = [16, 24];
export const RIFE_FPS_CHOICES: RifeTargetFps[] = [24, 30];
export const IDENTITY_LOCK_MIN_WEIGHT = 0.75;
export const IDENTITY_LOCK_MAX_WEIGHT = 0.85;

export const SHOOTING_STYLES: ShootingStyleOption[] = [
  {
    id: 'arri-35mm',
    label: 'Кинематографичный реализм (ARRI 35mm)',
    promptCue:
      'Shot on ARRI Alexa 35 with 35mm prime cinema lens, natural filmic latitude, subtle 35mm optical grain, shallow depth of field, authentic live-action cinema grade',
    description: 'Живое кино: оптика 35mm, естественная глубина резкости и микрозерно',
  },
  {
    id: 'documentary-handheld',
    label: 'Документальная съемка (ручная камера)',
    promptCue:
      'Handheld documentary cinema camera, organic subtle operator micro-shake, unscripted natural daylight, candid observational framing, raw lifelike realism',
    description: 'Живая ручная камера, естественный дневной свет и репортажная органика',
  },
  {
    id: 'studio-lighting',
    label: 'Студийный свет',
    promptCue:
      'Controlled film-set studio lighting with soft diffused key light, subtle rim separation, realistic skin micro-texture and natural specular falloff, commercial live-action cinema',
    description: 'Выверенный мягкий ключевой и контровой свет без искусственного глянца',
  },
  {
    id: 'night-neon',
    label: 'Ночная/неон съемка',
    promptCue:
      'Low-light night cinematography on fast T1.4 cinema lens, practical neon and streetlamp reflections on wet surfaces and skin, deep clean shadows, authentic night-exterior exposure',
    description: 'Светосильная ночная оптика, реальные блики неона и глубокие тени',
  },
];

export function getShootingStyleOption(styleId: ShootingStyleId): ShootingStyleOption {
  return SHOOTING_STYLES.find((s) => s.id === styleId) ?? SHOOTING_STYLES[0];
}

export const AUTO_T2V_MODEL_FILE = 'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors';
export const AUTO_T2V_LOW_MODEL_FILE = 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors';
export const AUTO_I2V_MODEL_FILE = 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors';
export const AUTO_I2V_LOW_MODEL_FILE = 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors';

export const VIDEO_MODELS: VideoModelOption[] = [
  {
    id: 'auto',
    label: 'Авто (рекомендуется) · Wan 2.2 FP8 T2V/I2V',
    shortLabel: 'Авто (Wan 2.2 FP8)',
    architecture: 'wan22-moe',
    highNoiseFile: AUTO_T2V_MODEL_FILE,
    lowNoiseFile: AUTO_T2V_LOW_MODEL_FILE,
    i2vHighNoiseFile: AUTO_I2V_MODEL_FILE,
    i2vLowNoiseFile: AUTO_I2V_LOW_MODEL_FILE,
    textEncoderFile: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    textEncoderType: 'wan',
    vaeFile: 'wan_2.1_vae.safetensors',
    defaultFps: 16,
    defaultSteps: 28,
    vramHint:
      'Автомаршрутизация: T2V → wan2.2_t2v_14B fp8 (high+low noise) · I2V / продолжение → wan2.2_i2v_14B fp8 (high+low noise)',
  },
  {
    id: 'wan22-t2v-a14b-q4',
    label: 'Wan 2.2 A14B (MoE · GGUF Q4_K_M)',
    shortLabel: 'Wan 2.2 A14B Q4',
    architecture: 'wan22-moe',
    highNoiseFile: 'wan2.2_t2v_high_noise_14B_Q4_K_M.gguf',
    lowNoiseFile: 'wan2.2_t2v_low_noise_14B_Q4_K_M.gguf',
    i2vHighNoiseFile: 'wan2.2_i2v_high_noise_14B_Q4_K_M.gguf',
    i2vLowNoiseFile: 'wan2.2_i2v_low_noise_14B_Q4_K_M.gguf',
    textEncoderFile: 'umt5-xxl-encoder-Q8_0.gguf',
    textEncoderType: 'wan',
    vaeFile: 'wan_2.1_vae.safetensors',
    defaultFps: 16,
    defaultSteps: 28,
    vramHint: '~8.8 ГБ на эксперт · оптимально для 12 ГБ VRAM',
  },
  {
    id: 'wan22-t2v-a14b-q5',
    label: 'Wan 2.2 A14B (MoE · GGUF Q5_K_M)',
    shortLabel: 'Wan 2.2 A14B Q5',
    architecture: 'wan22-moe',
    highNoiseFile: 'wan2.2_t2v_high_noise_14B_Q5_K_M.gguf',
    lowNoiseFile: 'wan2.2_t2v_low_noise_14B_Q5_K_M.gguf',
    i2vHighNoiseFile: 'wan2.2_i2v_high_noise_14B_Q5_K_M.gguf',
    i2vLowNoiseFile: 'wan2.2_i2v_low_noise_14B_Q5_K_M.gguf',
    textEncoderFile: 'umt5-xxl-encoder-Q8_0.gguf',
    textEncoderType: 'wan',
    vaeFile: 'wan_2.1_vae.safetensors',
    defaultFps: 16,
    defaultSteps: 30,
    vramHint: '~10.5 ГБ на эксперт · DisTorch MultiGPU',
  },
  {
    id: 'wan22-ti2v-5b-fp8',
    label: 'Wan 2.2 TI2V-5B (Dense · FP8)',
    shortLabel: 'Wan 2.2 5B FP8',
    architecture: 'wan22-dense',
    highNoiseFile: 'wan2.2_ti2v_5B_fp8_e4m3fn.safetensors',
    lowNoiseFile: 'wan2.2_ti2v_5B_fp8_e4m3fn.safetensors',
    i2vHighNoiseFile: 'wan2.2_ti2v_5B_fp8_e4m3fn.safetensors',
    i2vLowNoiseFile: 'wan2.2_ti2v_5B_fp8_e4m3fn.safetensors',
    textEncoderFile: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    textEncoderType: 'wan',
    vaeFile: 'wan2.2_vae.safetensors',
    defaultFps: 24,
    defaultSteps: 24,
    vramHint: '~5.6 ГБ VRAM · T2V и I2V в одной модели',
  },
  {
    id: 'cogvideox-15-5b-fp8',
    label: 'CogVideoX 1.5-5B (DiT · FP8)',
    shortLabel: 'CogVideoX 1.5-5B',
    architecture: 'cogvideox',
    highNoiseFile: 'cogvideox_1_5_5b_fp8_e4m3fn.safetensors',
    lowNoiseFile: 'cogvideox_1_5_5b_fp8_e4m3fn.safetensors',
    i2vHighNoiseFile: 'cogvideox_1_5_5b_i2v_fp8_e4m3fn.safetensors',
    i2vLowNoiseFile: 'cogvideox_1_5_5b_i2v_fp8_e4m3fn.safetensors',
    textEncoderFile: 't5xxl_fp8_e4m3fn.safetensors',
    textEncoderType: 'wan',
    vaeFile: 'cogvideox_vae.safetensors',
    defaultFps: 16,
    defaultSteps: 30,
    vramHint: '~5.8 ГБ VRAM · T5-XXL в RAM',
  },
];

export const RESOLUTION_PRESETS: ResolutionOption[] = [
  { id: '832x480', label: '832 × 480 (16:9)', width: 832, height: 480, aspect: '16:9' },
  { id: '480x832', label: '480 × 832 (9:16)', width: 480, height: 832, aspect: '9:16' },
  { id: '1280x720', label: '1280 × 720 (HD 16:9)', width: 1280, height: 720, aspect: '16:9' },
  { id: '720x1280', label: '720 × 1280 (HD 9:16)', width: 720, height: 1280, aspect: '9:16' },
  { id: '768x768', label: '768 × 768 (1:1)', width: 768, height: 768, aspect: '1:1' },
];

export const DEFAULT_NEGATIVE_PROMPT =
  '3D render, CGI, plastic skin, cartoon, anime, oversaturated, morphing, distorted hands, blurry, wax face, airbrushed skin, synthetic gloss, uncanny valley, extra limbs, static frame, flickering artifacts, watermark, text overlay';

export interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: {
    title?: string;
    comment?: string;
  };
}

export type ComfyWorkflowGraph = Record<string, ComfyNode>;

export interface UploadedImageResult {
  name: string;
  subfolder: string;
  type: string;
}

export interface WorkflowBuildCharacter {
  name: string;
  weight: number;
  imageFilename: string;
}

export interface WorkflowBuildInput {
  settings: GenerationSettings;
  modeOverride?: GenerationMode;
  positivePrompt: string;
  negativePrompt: string;
  characters: WorkflowBuildCharacter[];
  startFrameFilename?: string;
  hasStartFrame?: boolean;
  seedOverride?: number;
  filenamePrefix?: string;
  segmentIndex?: number;
  isContinuation?: boolean;
}

export interface AutoModelRouteDecision {
  workflowMode: GenerationMode;
  workflowFile: 'workflow_t2v.json' | 'workflow_i2v.json';
  highNoiseModelFile: string;
  lowNoiseModelFile: string;
  isAuto: boolean;
  reason: 't2v_fresh' | 'i2v_start_frame' | 'i2v_extend' | 'i2v_chained_segment';
}

export interface PlannedSegment {
  index: number; // 1-based
  total: number;
  mode: GenerationMode;
  startSec: number;
  endSec: number;
  seedOffset: number;
}

export interface VideoOutputInfo {
  filename: string;
  subfolder: string;
  type: string;
  viewUrl: string;
}

export interface ParsedWsEvent {
  type: 'progress' | 'executing' | 'executed' | 'execution_error' | 'status' | 'other';
  promptId?: string;
  nodeId?: string | null;
  value?: number;
  max?: number;
  errorMessage?: string;
}

export function getModelOption(modelId: BaseModelId): VideoModelOption {
  return VIDEO_MODELS.find((m) => m.id === modelId) ?? VIDEO_MODELS[0];
}

export function normalizeBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return 'http://127.0.0.1:8188';
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

export function toWebSocketUrl(rawUrl: string, clientId: string): string {
  const base = normalizeBaseUrl(rawUrl);
  const wsBase = base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  return `${wsBase}/ws?clientId=${encodeURIComponent(clientId)}`;
}

/**
 * Wan 2.2 and CogVideoX temporal VAEs require frame counts aligned to 4n + 1
 * (e.g., 5s @ 16fps = 81 frames, 5s @ 24fps = 121 frames).
 */
export function secondsToAlignedFrames(seconds: number, fps: number = 16): number {
  const clampedSeconds = Math.max(1, Math.min(10, seconds));
  const rawFrames = Math.round(clampedSeconds * fps);
  const n = Math.max(4, Math.round((rawFrames - 1) / 4));
  return n * 4 + 1;
}

/**
 * Plans chained 5-second generation segments for durations from 5s up to 30s (6 segments).
 * Segment 1 uses the chosen mode (t2v or i2v); all follow-up segments automatically use i2v.
 */
export function planGenerationSegments(
  durationSec: DurationChoice,
  initialMode: GenerationMode,
): PlannedSegment[] {
  const total = Math.max(1, Math.min(6, Math.ceil(durationSec / SEGMENT_DURATION_SEC)));
  const segments: PlannedSegment[] = [];

  for (let i = 0; i < total; i += 1) {
    segments.push({
      index: i + 1,
      total,
      mode: i === 0 ? initialMode : 'i2v',
      startSec: i * SEGMENT_DURATION_SEC,
      endSec: (i + 1) * SEGMENT_DURATION_SEC,
      seedOffset: i,
    });
  }

  return segments;
}

/**
 * Protects character identity across chained segments (10-30s) and Extend Scene continuations
 * by clamping the character identity weight strictly into [0.75, 0.85] on every chained segment.
 */
export function computeChainedCharacterWeight(
  baseWeight: number,
  segmentIndex: number,
  isContinuation: boolean,
): number {
  const clamped = Math.max(0, Math.min(1, baseWeight));
  if (segmentIndex >= 2 || isContinuation) {
    const locked = Math.max(
      IDENTITY_LOCK_MIN_WEIGHT,
      Math.min(IDENTITY_LOCK_MAX_WEIGHT, clamped),
    );
    return Number(locked.toFixed(2));
  }
  return Number(clamped.toFixed(2));
}

/**
 * Computes aspect-preserving 1080p cinema upscale dimensions for ImageScale (#57).
 */
export function computeUpscaleTargetSize(
  width: number,
  height: number,
): { width: number; height: number } {
  if (width > height) {
    return { width: 1920, height: 1080 };
  }
  if (height > width) {
    return { width: 1080, height: 1920 };
  }
  return { width: 1080, height: 1080 };
}

export function formatSegmentLabel(
  segmentIndex: number,
  totalSegments: number,
  startSec: number,
  endSec: number,
): string {
  return `Рендер сегмента ${segmentIndex} из ${totalSegments} (${startSec}–${endSec} сек)...`;
}

export function getViewUrl(
  serverUrl: string,
  filename: string,
  subfolder: string = '',
  type: string = 'output',
): string {
  const base = normalizeBaseUrl(serverUrl);
  const params = new URLSearchParams({
    filename,
    subfolder,
    type,
  });
  return `${base}/view?${params.toString()}`;
}

export function getRawWorkflowTemplate(mode: GenerationMode = 't2v'): ComfyWorkflowGraph {
  const source = mode === 'i2v' ? workflowI2VTemplate : workflowT2VTemplate;
  return structuredClone(source) as ComfyWorkflowGraph;
}

/**
 * Automatic Video Model & Workflow Router (Auto-Model Routing):
 * - Segment 1 without start frame (T2V): workflow_t2v.json + wan2.2_t2v_14B_fp8_e4m3fn.safetensors
 * - Start frame uploaded (I2V), Extend Scene, or chained segments 2..6 (10-30s):
 *   workflow_i2v.json + wan2.2_i2v_14B_fp8_e4m3fn.safetensors
 */
export function resolveAutoModelRoute(params: {
  modelId: BaseModelId;
  mode: GenerationMode;
  segmentIndex?: number;
  hasStartFrame?: boolean;
  isContinuation?: boolean;
}): AutoModelRouteDecision {
  const segmentIndex = params.segmentIndex ?? 1;
  const isContinuation = Boolean(params.isContinuation);
  const hasStartFrame = Boolean(params.hasStartFrame);

  let workflowMode: GenerationMode;
  let reason: AutoModelRouteDecision['reason'];

  if (segmentIndex >= 2) {
    workflowMode = 'i2v';
    reason = 'i2v_chained_segment';
  } else if (isContinuation) {
    workflowMode = 'i2v';
    reason = 'i2v_extend';
  } else if (params.mode === 'i2v' || hasStartFrame) {
    workflowMode = 'i2v';
    reason = 'i2v_start_frame';
  } else {
    workflowMode = 't2v';
    reason = 't2v_fresh';
  }

  const workflowFile = workflowMode === 'i2v' ? 'workflow_i2v.json' : 'workflow_t2v.json';
  const isAuto = params.modelId === 'auto';

  if (isAuto) {
    return {
      workflowMode,
      workflowFile,
      highNoiseModelFile: workflowMode === 'i2v' ? AUTO_I2V_MODEL_FILE : AUTO_T2V_MODEL_FILE,
      lowNoiseModelFile:
        workflowMode === 'i2v' ? AUTO_I2V_LOW_MODEL_FILE : AUTO_T2V_LOW_MODEL_FILE,
      isAuto: true,
      reason,
    };
  }

  const model = getModelOption(params.modelId);
  return {
    workflowMode,
    workflowFile,
    highNoiseModelFile: workflowMode === 'i2v' ? model.i2vHighNoiseFile : model.highNoiseFile,
    lowNoiseModelFile: workflowMode === 'i2v' ? model.i2vLowNoiseFile : model.lowNoiseFile,
    isAuto: false,
    reason,
  };
}

/**
 * Formats a concise Russian status string showing what Auto-Model Routing selected.
 */
export function describeAutoRoutingStatus(params: {
  modelId: BaseModelId;
  mode: GenerationMode;
  durationSec: DurationChoice;
  hasStartFrame: boolean;
  isExtending: boolean;
}): string {
  const prefix =
    params.modelId === 'auto'
      ? 'Режим: Авто'
      : `Модель: ${getModelOption(params.modelId).shortLabel}`;

  if (params.isExtending) {
    return `${prefix} → Продолжение сцены (I2V)`;
  }
  if (params.mode === 'i2v' || params.hasStartFrame) {
    return `${prefix} → Оживление фото (I2V)`;
  }
  if (params.durationSec > SEGMENT_DURATION_SEC) {
    return `${prefix} → Старт с нуля (T2V) + продолжение (I2V)`;
  }
  return `${prefix} → Старт с нуля (T2V)`;
}

/**
 * Injects UI settings, prompts, Start Frame (for I2V), FPS, post-processing nodes,
 * and up to 3 character references into workflow_t2v.json or workflow_i2v.json.
 */
export function buildWorkflowFromTemplate(
  input: WorkflowBuildInput,
  baseTemplate?: ComfyWorkflowGraph,
): ComfyWorkflowGraph {
  const segmentIndex = input.segmentIndex ?? 1;
  const isContinuation = Boolean(input.isContinuation);
  const requestedMode: GenerationMode = input.modeOverride ?? input.settings.mode;
  const hasStartFrame = Boolean(input.hasStartFrame ?? input.startFrameFilename);

  const route = resolveAutoModelRoute({
    modelId: input.settings.modelId,
    mode: requestedMode,
    segmentIndex,
    hasStartFrame,
    isContinuation,
  });

  const mode: GenerationMode = route.workflowMode;
  const graph: ComfyWorkflowGraph = structuredClone(
    baseTemplate ?? getRawWorkflowTemplate(mode),
  );
  const model = getModelOption(input.settings.modelId);
  const steps = Math.max(4, Math.min(100, Math.round(input.settings.steps)));
  const seed = Math.max(0, Math.floor(input.seedOverride ?? input.settings.seed));
  const splitStep = Math.max(1, Math.min(steps - 1, Math.round(steps * 0.36)));
  const segmentFrames = secondsToAlignedFrames(SEGMENT_DURATION_SEC, input.settings.fps);

  // .gguf files need the ComfyUI-GGUF loaders; .safetensors need the standard ones.
  const configureUnetLoader = (nodeId: string, fileName: string) => {
    const node = graph[nodeId];
    if (!node) return;
    node.inputs.unet_name = fileName;
    if (fileName.toLowerCase().endsWith('.gguf')) {
      node.class_type = 'UnetLoaderGGUF';
      delete node.inputs.weight_dtype;
    } else {
      node.class_type = 'UNETLoader';
      node.inputs.weight_dtype = 'default';
    }
  };
  configureUnetLoader('1', route.highNoiseModelFile);
  configureUnetLoader('2', route.lowNoiseModelFile);
  if (graph['3']) {
    graph['3'].inputs.clip_name = model.textEncoderFile;
    graph['3'].inputs.type = model.textEncoderType;
    if (model.textEncoderFile.toLowerCase().endsWith('.gguf')) {
      graph['3'].class_type = 'CLIPLoaderGGUF';
      delete graph['3'].inputs.device;
    } else {
      graph['3'].class_type = 'CLIPLoader';
      graph['3'].inputs.device = 'cpu';
    }
  }
  if (graph['4']) {
    graph['4'].inputs.vae_name = model.vaeFile;
  }
  if (graph['5']) {
    graph['5'].inputs.text = input.positivePrompt.trim();
  }
  if (graph['6']) {
    graph['6'].inputs.text = input.negativePrompt.trim();
  }

  if (mode === 'i2v' && graph['7']) {
    graph['7'].inputs.image = input.startFrameFilename || '{{START_FRAME_IMAGE}}';
  }

  // Wan 2.2 has no IP-Adapter / FaceID support, so character photos are not injected into the
  // sampler graph. Identity is carried by the start frame (see runComfyGeneration) and by the
  // last-frame chaining between 5-second segments.
  // CLIP Vision (node 15) is only needed in I2V; the T2V template does not contain it.

  if (graph['30']) {
    graph['30'].inputs.width = input.settings.width;
    graph['30'].inputs.height = input.settings.height;
    graph['30'].inputs.length = segmentFrames;
  }

  if (graph['40']) {
    graph['40'].inputs.model = ['1', 0];
    graph['40'].inputs.noise_seed = seed;
    graph['40'].inputs.steps = steps;
    graph['40'].inputs.end_at_step = model.architecture === 'wan22-moe' ? splitStep : steps;
    graph['40'].inputs.return_with_leftover_noise =
      model.architecture === 'wan22-moe' ? 'enable' : 'disable';
  }

  if (model.architecture === 'wan22-moe') {
    if (graph['41']) {
      graph['41'].inputs.noise_seed = seed;
      graph['41'].inputs.steps = steps;
      graph['41'].inputs.start_at_step = splitStep;
    }
    if (graph['50']) {
      graph['50'].inputs.samples = ['41', 0];
    }
  } else {
    delete graph['2'];
    delete graph['41'];
    if (graph['50']) {
      graph['50'].inputs.samples = ['40', 0];
    }
  }

  // Post-processing chain: VAEDecodeTiled (#50) -> Optional 1080p Upscale (#55–57) -> Optional RIFE VFI (#58) -> VHS_VideoCombine (#60)
  let currentImageLink: [string, number] = ['50', 0];

  if (input.settings.upscale1080p) {
    const target1080p = computeUpscaleTargetSize(input.settings.width, input.settings.height);
    if (graph['56']) {
      graph['56'].inputs.image = currentImageLink;
    }
    if (graph['57']) {
      graph['57'].inputs.image = ['56', 0];
      graph['57'].inputs.width = target1080p.width;
      graph['57'].inputs.height = target1080p.height;
      currentImageLink = ['57', 0];
    }
  } else {
    delete graph['55'];
    delete graph['56'];
    delete graph['57'];
  }

  if (input.settings.rifeEnabled) {
    if (graph['58']) {
      graph['58'].inputs.frames = currentImageLink;
      graph['58'].inputs.multiplier = Math.max(
        2,
        Math.ceil(input.settings.rifeTargetFps / Math.max(1, input.settings.fps)),
      );
      currentImageLink = ['58', 0];
    }
  } else {
    delete graph['58'];
  }

  if (graph['60']) {
    graph['60'].inputs.images = currentImageLink;
    graph['60'].inputs.frame_rate = input.settings.rifeEnabled
      ? input.settings.rifeTargetFps
      : input.settings.fps;
    if (input.filenamePrefix) {
      graph['60'].inputs.filename_prefix = input.filenamePrefix;
    }
  }

  return graph;
}

/**
 * Checks connectivity to a local ComfyUI server via GET /system_stats.
 */
export async function checkConnection(
  serverUrl: string,
  timeoutMs: number = 4500,
): Promise<ConnectionInfo> {
  const base = normalizeBaseUrl(serverUrl);
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${base}/system_stats`, {
      method: 'GET',
      mode: 'cors',
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        status: 'offline',
        message: `Сервер ответил статусом HTTP ${response.status}.`,
        checkedAt: new Date().toLocaleTimeString('ru-RU'),
      };
    }

    const data = (await response.json()) as {
      system?: { comfyui_version?: string };
      devices?: Array<{ name?: string; vram_total?: number }>;
    };

    const primaryDevice = data.devices?.[0];
    const vramTotalGb =
      typeof primaryDevice?.vram_total === 'number'
        ? Math.round((primaryDevice.vram_total / 1024 ** 3) * 10) / 10
        : undefined;

    return {
      status: 'online',
      gpuName: primaryDevice?.name,
      vramTotalGb,
      comfyVersion: data.system?.comfyui_version,
      message: 'Соединение установлено',
      checkedAt: new Date().toLocaleTimeString('ru-RU'),
    };
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    return {
      status: 'offline',
      message: isAbort
        ? 'Таймаут подключения. Проверьте, запущен ли ComfyUI.'
        : 'Не удалось подключиться. Убедитесь, что ComfyUI запущен с --enable-cors-header "*".',
      checkedAt: new Date().toLocaleTimeString('ru-RU'),
    };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

/**
 * Uploads an image (character reference, start frame, or extracted last frame) via POST /upload/image.
 */
export async function uploadImage(
  serverUrl: string,
  file: File,
  subfolder: string = 'kinoflow_refs',
): Promise<UploadedImageResult> {
  const base = normalizeBaseUrl(serverUrl);
  const formData = new FormData();
  formData.append('image', file, file.name);
  formData.append('type', 'input');
  formData.append('subfolder', subfolder);
  formData.append('overwrite', 'true');

  const response = await fetch(`${base}/upload/image`, {
    method: 'POST',
    mode: 'cors',
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Ошибка загрузки изображения «${file.name}» (${response.status}): ${errText || response.statusText}`,
    );
  }

  const data = (await response.json()) as Partial<UploadedImageResult>;
  if (!data.name) {
    throw new Error(`ComfyUI не вернул имя загруженного файла для «${file.name}».`);
  }

  return {
    name: data.subfolder ? `${data.subfolder}/${data.name}` : data.name,
    subfolder: data.subfolder ?? '',
    type: data.type ?? 'input',
  };
}

/**
 * Enqueues a prepared workflow graph in ComfyUI via POST /prompt.
 */
export async function queuePrompt(
  serverUrl: string,
  workflow: ComfyWorkflowGraph,
  clientId: string,
): Promise<{ promptId: string; number?: number }> {
  const base = normalizeBaseUrl(serverUrl);
  const response = await fetch(`${base}/prompt`, {
    method: 'POST',
    mode: 'cors',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: workflow,
      client_id: clientId,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `ComfyUI отклонил задачу /prompt (${response.status}): ${errText || response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    prompt_id?: string;
    number?: number;
    error?: { message?: string };
  };

  if (data.error?.message) {
    throw new Error(`Ошибка валидации графа ComfyUI: ${data.error.message}`);
  }

  if (!data.prompt_id) {
    throw new Error('ComfyUI не вернул prompt_id после постановки в очередь.');
  }

  return {
    promptId: data.prompt_id,
    number: data.number,
  };
}

/**
 * Fetches execution history for a specific prompt_id via GET /history/{prompt_id}.
 */
export async function getHistory(
  serverUrl: string,
  promptId: string,
): Promise<Record<string, unknown>> {
  const base = normalizeBaseUrl(serverUrl);
  const response = await fetch(`${base}/history/${encodeURIComponent(promptId)}`, {
    method: 'GET',
    mode: 'cors',
  });

  if (!response.ok) {
    throw new Error(`Не удалось получить историю задачи (${response.status}).`);
  }

  return (await response.json()) as Record<string, unknown>;
}

/**
 * Sends POST /interrupt to cancel the active generation on ComfyUI.
 */
export async function interruptGeneration(serverUrl: string): Promise<void> {
  const base = normalizeBaseUrl(serverUrl);
  await fetch(`${base}/interrupt`, {
    method: 'POST',
    mode: 'cors',
  });
}

interface MediaFileEntry {
  filename?: string;
  subfolder?: string;
  type?: string;
}

/**
 * Extracts the generated MP4/WebM/GIF output descriptor from a ComfyUI /history response.
 */
export function extractVideoOutputFromHistory(
  historyPayload: Record<string, unknown>,
  promptId: string,
  serverUrl: string,
): VideoOutputInfo | null {
  const entry = historyPayload[promptId] as
    | {
        outputs?: Record<
          string,
          {
            gifs?: MediaFileEntry[];
            videos?: MediaFileEntry[];
            images?: MediaFileEntry[];
          }
        >;
      }
    | undefined;

  if (!entry?.outputs) {
    return null;
  }

  const nodeOutputs = Object.values(entry.outputs);
  const mediaCandidates: MediaFileEntry[] = [];

  for (const out of nodeOutputs) {
    if (Array.isArray(out.videos)) {
      mediaCandidates.push(...out.videos);
    }
    if (Array.isArray(out.gifs)) {
      mediaCandidates.push(...out.gifs);
    }
    if (Array.isArray(out.images)) {
      mediaCandidates.push(
        ...out.images.filter((item) => /\.(mp4|webm|mov|gif)$/i.test(item.filename ?? '')),
      );
    }
  }

  const preferred =
    mediaCandidates.find((item) => /\.mp4$/i.test(item.filename ?? '')) ?? mediaCandidates[0];

  if (!preferred?.filename) {
    return null;
  }

  const subfolder = preferred.subfolder ?? '';
  const type = preferred.type ?? 'output';

  return {
    filename: preferred.filename,
    subfolder,
    type,
    viewUrl: getViewUrl(serverUrl, preferred.filename, subfolder, type),
  };
}

export function parseComfyWsEvent(rawMessage: string, expectedPromptId?: string): ParsedWsEvent {
  try {
    const parsed = JSON.parse(rawMessage) as {
      type?: string;
      data?: {
        prompt_id?: string;
        node?: string | null;
        value?: number;
        max?: number;
        exception_message?: string;
      };
    };

    const data = parsed.data ?? {};
    if (expectedPromptId && data.prompt_id && data.prompt_id !== expectedPromptId) {
      return { type: 'other' };
    }

    if (parsed.type === 'progress') {
      return {
        type: 'progress',
        promptId: data.prompt_id,
        nodeId: data.node,
        value: typeof data.value === 'number' ? data.value : 0,
        max: typeof data.max === 'number' ? data.max : 1,
      };
    }

    if (parsed.type === 'executing') {
      return {
        type: 'executing',
        promptId: data.prompt_id,
        nodeId: data.node ?? null,
      };
    }

    if (parsed.type === 'executed') {
      return {
        type: 'executed',
        promptId: data.prompt_id,
        nodeId: data.node,
      };
    }

    if (parsed.type === 'execution_error') {
      return {
        type: 'execution_error',
        promptId: data.prompt_id,
        nodeId: data.node,
        errorMessage: data.exception_message || 'Ошибка выполнения узла в ComfyUI.',
      };
    }

    if (parsed.type === 'status') {
      return { type: 'status' };
    }

    return { type: 'other' };
  } catch {
    return { type: 'other' };
  }
}

interface ExecuteSingleSegmentOptions {
  serverUrl: string;
  workflow: ComfyWorkflowGraph;
  segment: PlannedSegment;
  signal: AbortSignal;
  onSegmentProgress: (
    segmentFraction: number,
    meta: {
      promptId?: string;
      transport?: 'ws' | 'polling';
      currentStep?: number;
      totalSteps?: number;
      currentNodeTitle?: string;
      detail?: string;
    },
  ) => void;
}

async function executeSingleComfyWorkflow(
  opts: ExecuteSingleSegmentOptions,
): Promise<{ promptId: string; output: VideoOutputInfo }> {
  const { serverUrl, workflow, signal, onSegmentProgress } = opts;
  const clientId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `kinoflow-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const wsUrl = toWebSocketUrl(serverUrl, clientId);
  let ws: WebSocket | null = null;
  let wsConnected = false;

  try {
    ws = await new Promise<WebSocket | null>((resolve) => {
      const socket = new WebSocket(wsUrl);
      const connectTimer = globalThis.setTimeout(() => {
        socket.close();
        resolve(null);
      }, 2500);

      socket.onopen = () => {
        globalThis.clearTimeout(connectTimer);
        wsConnected = true;
        resolve(socket);
      };
      socket.onerror = () => {
        globalThis.clearTimeout(connectTimer);
        resolve(null);
      };
    });
  } catch {
    ws = null;
  }

  const queued = await queuePrompt(serverUrl, workflow, clientId);
  const promptId = queued.promptId;

  onSegmentProgress(0.08, {
    promptId,
    transport: wsConnected ? 'ws' : 'polling',
  });

  const output = await new Promise<VideoOutputInfo>((resolve, reject) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let pollingFraction = 0.12;

    const cleanup = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      signal.removeEventListener('abort', onAbort);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const succeed = (info: VideoOutputInfo) => {
      if (settled) return;
      settled = true;
      cleanup();
      onSegmentProgress(1, {
        promptId,
        transport: wsConnected ? 'ws' : 'polling',
      });
      resolve(info);
    };

    const fetchResultAndFinish = async () => {
      try {
        onSegmentProgress(0.95, {
          promptId,
          transport: wsConnected ? 'ws' : 'polling',
          detail: 'Получение MP4 из /history и /view...',
        });
        const history = await getHistory(serverUrl, promptId);
        const video = extractVideoOutputFromHistory(history, promptId, serverUrl);
        if (video) {
          succeed(video);
          return true;
        }
        return false;
      } catch (err) {
        fail(err instanceof Error ? err : new Error('Ошибка чтения /history'));
        return true;
      }
    };

    const onAbort = () => {
      interruptGeneration(serverUrl).catch(() => {});
      fail(new Error('Генерация прервана пользователем.'));
    };

    signal.addEventListener('abort', onAbort);

    if (ws && wsConnected) {
      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        const parsed = parseComfyWsEvent(event.data, promptId);

        if (parsed.type === 'execution_error') {
          fail(new Error(parsed.errorMessage || 'Ошибка выполнения графа ComfyUI.'));
          return;
        }

        if (parsed.type === 'progress' && parsed.max && parsed.max > 0) {
          const stepVal = parsed.value ?? 0;
          const fraction = Math.min(0.92, 0.1 + (stepVal / parsed.max) * 0.82);
          const nodeTitle =
            (parsed.nodeId && workflow[parsed.nodeId]?._meta?.title) || 'Сэмплинг диффузии';
          onSegmentProgress(fraction, {
            promptId,
            transport: 'ws',
            currentStep: stepVal,
            totalSteps: parsed.max,
            currentNodeTitle: nodeTitle,
            detail: `${nodeTitle} · шаг ${stepVal} из ${parsed.max}`,
          });
        } else if (parsed.type === 'executing') {
          if (parsed.nodeId === null) {
            void fetchResultAndFinish();
          } else if (parsed.nodeId) {
            const nodeTitle = workflow[parsed.nodeId]?._meta?.title || `Узел #${parsed.nodeId}`;
            pollingFraction = Math.min(0.88, pollingFraction + 0.06);
            onSegmentProgress(pollingFraction, {
              promptId,
              transport: 'ws',
              currentNodeTitle: nodeTitle,
              detail: `Выполняется: ${nodeTitle}`,
            });
          }
        }
      };

      ws.onerror = () => {
        wsConnected = false;
      };
    }

    pollTimer = setInterval(async () => {
      if (settled) return;
      try {
        const history = await getHistory(serverUrl, promptId);
        if (history[promptId]) {
          const video = extractVideoOutputFromHistory(history, promptId, serverUrl);
          if (video) {
            succeed(video);
            return;
          }
        }
        if (!wsConnected) {
          pollingFraction = Math.min(0.88, pollingFraction + 0.04);
          onSegmentProgress(pollingFraction, {
            promptId,
            transport: 'polling',
            detail: 'Опрос /history ComfyUI...',
          });
        }
      } catch {
        // Retry on next poll interval
      }
    }, 2200);
  });

  return { promptId, output };
}

export interface RunGenerationOptions {
  settings: GenerationSettings;
  positivePrompt: string;
  negativePrompt: string;
  characters: CharacterReference[];
  startFrame?: StartFrameReference | null;
  isContinuation?: boolean;
  fallbackCharacterAnchors?: WorkflowBuildCharacter[];
  signal: AbortSignal;
  onProgress: (progress: GenerationProgress) => void;
}

export interface RunGenerationResult {
  promptId: string;
  output: VideoOutputInfo;
  segments: GeneratedSegment[];
  uploadedNames: string[];
}

/**
 * End-to-end Chained Generation pipeline (5s – 30s + unlimited Extend Scene):
 * 1. Uploads original character references and (in I2V mode) the initial Start Frame via /upload/image.
 * 2. Runs Segment 1 (0-5s) in the selected mode (T2V via workflow_t2v.json or I2V via workflow_i2v.json).
 * 3. For 10s – 30s durations (and Extend Scene continuations), extracts the last frame of each rendered
 *    segment via HTML5 <canvas>, uploads it, and passes BOTH the last frame AND the original character
 *    reference photos with locked identity weights (0.75–0.85) into every subsequent 5-second segment.
 */
export async function runComfyGeneration(
  options: RunGenerationOptions,
): Promise<RunGenerationResult> {
  const {
    settings,
    positivePrompt,
    negativePrompt,
    characters,
    startFrame,
    isContinuation = false,
    fallbackCharacterAnchors = [],
    signal,
    onProgress,
  } = options;
  const serverUrl = normalizeBaseUrl(settings.serverUrl);
  const plannedSegments = planGenerationSegments(settings.durationSec, settings.mode);

  if (settings.mode === 'i2v' && !startFrame) {
    throw new Error('В режиме «Оживление фото» загрузите стартовый кадр (Start Frame).');
  }

  const uploadedChars: WorkflowBuildCharacter[] = [];

  if (characters.length > 0) {
    for (let i = 0; i < characters.length; i += 1) {
      if (signal.aborted) {
        throw new Error('Генерация отменена пользователем.');
      }
      const char = characters[i];
      onProgress({
        phase: 'uploading',
        percent: Math.round(((i + 0.5) / characters.length) * 6),
        segmentIndex: 1,
        totalSegments: plannedSegments.length,
        segmentStartSec: 0,
        segmentEndSec: SEGMENT_DURATION_SEC,
        segmentMode: settings.mode,
        identityAnchorCount: characters.length,
        message: `Загрузка референса ${i + 1} из ${characters.length}: ${char.name || char.file.name}`,
      });
      const uploaded = await uploadImage(serverUrl, char.file, 'kinoflow_refs');
      uploadedChars.push({
        name: char.name || `Персонаж ${i + 1}`,
        weight: char.weight,
        imageFilename: uploaded.name,
      });
    }
  } else if (fallbackCharacterAnchors.length > 0) {
    uploadedChars.push(...fallbackCharacterAnchors.slice(0, 3));
  }

  let currentStartFrameFilename: string | undefined;

  // Wan 2.2 cannot take face references directly, so with no explicit start frame the first
  // character photo is used as the start frame: segment 1 then runs through I2V.
  if (!startFrame && !isContinuation && uploadedChars.length > 0) {
    currentStartFrameFilename = uploadedChars[0].imageFilename;
  }

  if (settings.mode === 'i2v' && startFrame) {
    if (signal.aborted) {
      throw new Error('Генерация отменена пользователем.');
    }
    onProgress({
      phase: 'uploading',
      percent: 8,
      segmentIndex: 1,
      totalSegments: plannedSegments.length,
      segmentStartSec: 0,
      segmentEndSec: SEGMENT_DURATION_SEC,
      segmentMode: 'i2v',
      identityAnchorCount: uploadedChars.length,
      message: `Загрузка стартового кадра: ${startFrame.file.name}`,
    });
    const uploadedStart = await uploadImage(serverUrl, startFrame.file, 'kinoflow_start');
    currentStartFrameFilename = uploadedStart.name;
  }

  const renderedSegments: GeneratedSegment[] = [];
  const baseProgressOffset = 10;
  const perSegmentBudget = (100 - baseProgressOffset) / plannedSegments.length;

  for (const segment of plannedSegments) {
    if (signal.aborted) {
      throw new Error('Генерация отменена пользователем.');
    }

    const segmentSeed = settings.seed + segment.seedOffset;
    const segmentLabel = formatSegmentLabel(
      segment.index,
      segment.total,
      segment.startSec,
      segment.endSec,
    );

    // Every chained 5s segment (2..6) and every Extend Scene continuation receives BOTH
    // the previous segment's last frame AND the original uploaded character references
    // with identity weight locked in [0.75, 0.85], and automatically routes to workflow_i2v.json
    // + wan2.2_i2v_14B_fp8_e4m3fn.safetensors in Auto mode.
    const route = resolveAutoModelRoute({
      modelId: settings.modelId,
      mode: segment.mode,
      segmentIndex: segment.index,
      hasStartFrame: Boolean(currentStartFrameFilename),
      isContinuation,
    });

    const workflow = buildWorkflowFromTemplate({
      settings,
      modeOverride: route.workflowMode,
      positivePrompt,
      negativePrompt,
      characters: uploadedChars,
      startFrameFilename: route.workflowMode === 'i2v' ? currentStartFrameFilename : undefined,
      hasStartFrame: route.workflowMode === 'i2v' && Boolean(currentStartFrameFilename),
      seedOverride: segmentSeed,
      filenamePrefix: `kinoflow_seg${segment.index}_${route.workflowMode}`,
      segmentIndex: segment.index,
      isContinuation,
    });

    const segStartPct = baseProgressOffset + (segment.index - 1) * perSegmentBudget;

    onProgress({
      phase: 'queuing',
      percent: Math.round(segStartPct),
      segmentIndex: segment.index,
      totalSegments: segment.total,
      segmentStartSec: segment.startSec,
      segmentEndSec: segment.endSec,
      segmentMode: segment.mode,
      identityAnchorCount: uploadedChars.length,
      message: segmentLabel,
    });

    const { promptId, output } = await executeSingleComfyWorkflow({
      serverUrl,
      workflow,
      segment,
      signal,
      onSegmentProgress: (fraction, meta) => {
        const overallPct = Math.min(99, Math.round(segStartPct + fraction * perSegmentBudget));
        onProgress({
          phase: fraction >= 0.95 ? 'finalizing' : 'running',
          percent: overallPct,
          promptId: meta.promptId,
          transport: meta.transport,
          currentStep: meta.currentStep,
          totalSteps: meta.totalSteps,
          currentNodeTitle: meta.currentNodeTitle,
          segmentIndex: segment.index,
          totalSegments: segment.total,
          segmentStartSec: segment.startSec,
          segmentEndSec: segment.endSec,
          segmentMode: segment.mode,
          identityAnchorCount: uploadedChars.length,
          message: meta.detail ? `${segmentLabel} ${meta.detail}` : segmentLabel,
        });
      },
    });

    renderedSegments.push({
      index: segment.index,
      mode: segment.mode,
      startSec: segment.startSec,
      endSec: segment.endSec,
      promptId,
      videoUrl: output.viewUrl,
      filename: output.filename,
      subfolder: output.subfolder,
      fileType: output.type,
      seed: segmentSeed,
    });

    // If more segments remain, extract the last frame of this segment as PNG and upload it for the next I2V segment
    if (segment.index < segment.total) {
      if (signal.aborted) {
        throw new Error('Генерация отменена пользователем.');
      }

      onProgress({
        phase: 'extracting_frame',
        percent: Math.min(99, Math.round(segStartPct + perSegmentBudget * 0.96)),
        segmentIndex: segment.index,
        totalSegments: segment.total,
        segmentStartSec: segment.startSec,
        segmentEndSec: segment.endSec,
        segmentMode: 'i2v',
        identityAnchorCount: uploadedChars.length,
        message: `Извлечение последнего кадра сегмента ${segment.index} из ${segment.total} для перехода в I2V...`,
      });

      const extracted = await extractLastFrameFromVideo(
        output.viewUrl,
        `chain_seg${segment.index}_last_frame.png`,
      );
      try {
        const uploadedNextFrame = await uploadImage(serverUrl, extracted.file, 'kinoflow_chain');
        currentStartFrameFilename = uploadedNextFrame.name;
      } finally {
        URL.revokeObjectURL(extracted.previewUrl);
      }
    }
  }

  const lastSegment = renderedSegments[renderedSegments.length - 1];

  onProgress({
    phase: 'completed',
    percent: 100,
    segmentIndex: plannedSegments.length,
    totalSegments: plannedSegments.length,
    segmentStartSec: lastSegment.startSec,
    segmentEndSec: lastSegment.endSec,
    segmentMode: lastSegment.mode,
    identityAnchorCount: uploadedChars.length,
    promptId: lastSegment.promptId,
    message:
      plannedSegments.length > 1
        ? `Все ${plannedSegments.length} сегментов (${settings.durationSec} сек) готовы`
        : 'Видео готово к просмотру',
  });

  return {
    promptId: lastSegment.promptId,
    output: {
      filename: lastSegment.filename,
      subfolder: lastSegment.subfolder,
      type: lastSegment.fileType,
      viewUrl: lastSegment.videoUrl,
    },
    segments: renderedSegments,
    uploadedNames: uploadedChars.map((c) => c.imageFilename),
  };
}
