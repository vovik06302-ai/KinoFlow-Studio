import workflowT2VTemplate from '../../workflow_t2v.json';
import workflowI2VTemplate from '../../workflow_i2v.json';
import { extractLastFrameFromVideo } from '../utils/videoFrameUtils';
import { PreflightError, buildModelResolutionKey, runPreflight } from './preflightService';
import type { VideoExportBackend } from './preflightService';
import { buildSegmentPrompt } from './storyboard';
import type { CameraPresetId, StoryboardShot } from './storyboard';
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

export const GENERATION_PARAM_LIMITS = {
  minSteps: 4,
  maxSteps: 100,
  minFrames: 17,
  maxFrames: 241,
  frameAlignmentStep: 4,
  minDimension: 256,
  maxDimension: 1920,
  dimensionMultiple: 16,
  minSeed: 0,
  maxSeed: 4_294_967_295,
  maxCharacters: 3,
  minCharacterWeight: 0,
  maxCharacterWeight: 1,
} as const;

/** RIFE doubles the number of frames, so the playback rate must double as well. */
export const RIFE_MULTIPLIER = 2;

/**
 * Real playback rate of the exported video. RIFE inserts one frame between every pair,
 * so 16 fps -> 32 fps. Using any other rate would play the clip in slow motion.
 */
export function computeOutputFps(fps: number, rifeEnabled: boolean): number {
  return rifeEnabled ? fps * RIFE_MULTIPLIER : fps;
}
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

/**
 * Applies the selected shooting style prompt cue to direct (non-Gemini-enhanced) prompts
 * without duplicating it if already included.
 */
export function applyShootingStyleToPrompt(
  prompt: string,
  shootingStyle: ShootingStyleId,
  alreadyEnhanced: boolean = false,
): string {
  const trimmed = prompt.trim();
  if (!trimmed || alreadyEnhanced) return trimmed;
  const style = getShootingStyleOption(shootingStyle);
  if (!style.promptCue) return trimmed;
  if (trimmed.toLowerCase().includes(style.promptCue.slice(0, 28).toLowerCase())) {
    return trimmed;
  }
  const separator = /[.!?]$/.test(trimmed) ? ' ' : '. ';
  return `${trimmed}${separator}${style.promptCue}`;
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
  videoExportBackend?: VideoExportBackend;
  /** Exact option strings from ComfyUI /object_info when models are located inside subfolders. */
  resolvedModelNames?: Record<string, string>;
  /** Optional validated format/codec for ComfyUI Core SaveVideo node. */
  coreVideoFormat?: string;
  coreVideoCodec?: string;
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
  type:
    | 'progress'
    | 'executing'
    | 'executed'
    | 'execution_error'
    | 'execution_interrupted'
    | 'status'
    | 'other';
  promptId?: string;
  nodeId?: string | null;
  nodeType?: string;
  value?: number;
  max?: number;
  errorMessage?: string;
}

export interface GenerationParamValidationIssue {
  field:
    | 'settings'
    | 'mode'
    | 'modelId'
    | 'serverUrl'
    | 'durationSec'
    | 'fps'
    | 'frames'
    | 'width'
    | 'height'
    | 'steps'
    | 'seed'
    | 'rifeEnabled'
    | 'rifeTargetFps'
    | 'positivePrompt'
    | 'negativePrompt'
    | 'startFrame'
    | 'characters';
  message: string;
}

export interface GenerationParamValidationResult {
  valid: boolean;
  issues: GenerationParamValidationIssue[];
}

export interface ValidateGenerationParamsInput {
  settings: Partial<GenerationSettings> | null | undefined;
  positivePrompt?: unknown;
  negativePrompt?: unknown;
  hasStartFrame?: boolean;
  characters?: unknown;
}

export class GenerationParamsValidationError extends Error {
  readonly issues: GenerationParamValidationIssue[];

  constructor(issues: GenerationParamValidationIssue[]) {
    const details = issues.map((issue) => issue.message).join('; ');
    super(`Некорректные параметры генерации: ${details}`);
    this.name = 'GenerationParamsValidationError';
    this.issues = issues;
  }
}

export function getModelOption(modelId: BaseModelId | string): VideoModelOption {
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
 * Validates generation parameter types and ranges on the client before any upload,
 * preflight, or `/prompt` request is sent to ComfyUI.
 */
export function validateGenerationParams(
  input: ValidateGenerationParamsInput,
): GenerationParamValidationResult {
  const issues: GenerationParamValidationIssue[] = [];
  const settings = input?.settings;

  if (!settings || typeof settings !== 'object') {
    issues.push({
      field: 'settings',
      message: 'Параметры генерации (settings) не переданы.',
    });
    return { valid: false, issues };
  }

  if (settings.mode !== 't2v' && settings.mode !== 'i2v') {
    issues.push({
      field: 'mode',
      message: 'Режим генерации (mode) должен быть «t2v» или «i2v».',
    });
  }

  if (
    typeof settings.modelId !== 'string' ||
    !VIDEO_MODELS.some((model) => model.id === settings.modelId)
  ) {
    issues.push({
      field: 'modelId',
      message: 'Выбрана неподдерживаемая видеомодель (modelId).',
    });
  }

  if (typeof settings.serverUrl !== 'string' || !settings.serverUrl.trim()) {
    issues.push({
      field: 'serverUrl',
      message: 'Адрес сервера ComfyUI (serverUrl) должен быть непустой строкой.',
    });
  } else {
    const rawUrl = settings.serverUrl.trim();
    if (/\s/.test(rawUrl)) {
      issues.push({
        field: 'serverUrl',
        message: 'Адрес сервера ComfyUI (serverUrl) не должен содержать пробелы.',
      });
    } else {
      try {
        const parsed = new URL(normalizeBaseUrl(rawUrl));
        if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
          issues.push({
            field: 'serverUrl',
            message: 'Адрес сервера ComfyUI (serverUrl) должен быть корректным HTTP/HTTPS URL.',
          });
        }
      } catch {
        issues.push({
          field: 'serverUrl',
          message: 'Адрес сервера ComfyUI (serverUrl) имеет некорректный формат URL.',
        });
      }
    }
  }

  if (
    typeof settings.durationSec !== 'number' ||
    !Number.isInteger(settings.durationSec) ||
    !DURATION_CHOICES.includes(settings.durationSec as DurationChoice)
  ) {
    issues.push({
      field: 'durationSec',
      message: `Длительность (durationSec) должна быть одним из значений: ${DURATION_CHOICES.join(', ')} сек.`,
    });
  }

  if (
    typeof settings.fps !== 'number' ||
    !Number.isInteger(settings.fps) ||
    !FPS_CHOICES.includes(settings.fps as FpsChoice)
  ) {
    issues.push({
      field: 'fps',
      message: `Частота кадров (fps) должна быть одним из значений: ${FPS_CHOICES.join(', ')}.`,
    });
  }

  if (
    typeof settings.frames !== 'number' ||
    !Number.isInteger(settings.frames) ||
    settings.frames < GENERATION_PARAM_LIMITS.minFrames ||
    settings.frames > GENERATION_PARAM_LIMITS.maxFrames ||
    (settings.frames - 1) % GENERATION_PARAM_LIMITS.frameAlignmentStep !== 0
  ) {
    issues.push({
      field: 'frames',
      message: `Количество кадров (frames) должно быть целым числом вида 4n + 1 в диапазоне ${GENERATION_PARAM_LIMITS.minFrames}–${GENERATION_PARAM_LIMITS.maxFrames}.`,
    });
  }

  const validateDimension = (field: 'width' | 'height', value: unknown, label: string) => {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < GENERATION_PARAM_LIMITS.minDimension ||
      value > GENERATION_PARAM_LIMITS.maxDimension ||
      value % GENERATION_PARAM_LIMITS.dimensionMultiple !== 0
    ) {
      issues.push({
        field,
        message: `${label} (${field}) должна быть целым числом в диапазоне ${GENERATION_PARAM_LIMITS.minDimension}–${GENERATION_PARAM_LIMITS.maxDimension}, кратным ${GENERATION_PARAM_LIMITS.dimensionMultiple}.`,
      });
    }
  };
  validateDimension('width', settings.width, 'Ширина');
  validateDimension('height', settings.height, 'Высота');

  if (
    typeof settings.steps !== 'number' ||
    !Number.isInteger(settings.steps) ||
    settings.steps < GENERATION_PARAM_LIMITS.minSteps ||
    settings.steps > GENERATION_PARAM_LIMITS.maxSteps
  ) {
    issues.push({
      field: 'steps',
      message: `Количество шагов (steps) должно быть целым числом в диапазоне ${GENERATION_PARAM_LIMITS.minSteps}–${GENERATION_PARAM_LIMITS.maxSteps}.`,
    });
  }

  if (
    typeof settings.seed !== 'number' ||
    !Number.isInteger(settings.seed) ||
    settings.seed < GENERATION_PARAM_LIMITS.minSeed ||
    settings.seed > GENERATION_PARAM_LIMITS.maxSeed
  ) {
    issues.push({
      field: 'seed',
      message: `Seed должен быть целым числом в диапазоне ${GENERATION_PARAM_LIMITS.minSeed}–${GENERATION_PARAM_LIMITS.maxSeed}.`,
    });
  }

  if (settings.rifeEnabled !== undefined && typeof settings.rifeEnabled !== 'boolean') {
    issues.push({
      field: 'rifeEnabled',
      message: 'Параметр RIFE (rifeEnabled) должен быть логическим значением.',
    });
  } else if (
    settings.rifeEnabled === true &&
    (typeof settings.rifeTargetFps !== 'number' ||
      !Number.isInteger(settings.rifeTargetFps) ||
      !RIFE_FPS_CHOICES.includes(settings.rifeTargetFps as RifeTargetFps))
  ) {
    issues.push({
      field: 'rifeTargetFps',
      message: `Целевой FPS для RIFE (rifeTargetFps) должен быть одним из значений: ${RIFE_FPS_CHOICES.join(', ')}.`,
    });
  }

  if (input.positivePrompt !== undefined) {
    if (typeof input.positivePrompt !== 'string' || !input.positivePrompt.trim()) {
      issues.push({
        field: 'positivePrompt',
        message: 'Промпт сцены (positivePrompt) должен быть непустой строкой.',
      });
    }
  }

  if (input.negativePrompt !== undefined && typeof input.negativePrompt !== 'string') {
    issues.push({
      field: 'negativePrompt',
      message: 'Негативный промпт (negativePrompt) должен быть строкой.',
    });
  }

  if (settings.mode === 'i2v' && input.hasStartFrame === false) {
    issues.push({
      field: 'startFrame',
      message: 'В режиме «Оживление фото» загрузите стартовый кадр (Start Frame).',
    });
  }

  if (input.characters !== undefined) {
    if (!Array.isArray(input.characters)) {
      issues.push({
        field: 'characters',
        message: 'Список референсов персонажей (characters) должен быть массивом.',
      });
    } else {
      if (input.characters.length > GENERATION_PARAM_LIMITS.maxCharacters) {
        issues.push({
          field: 'characters',
          message: `Допускается не более ${GENERATION_PARAM_LIMITS.maxCharacters} референсов персонажей.`,
        });
      }
      input.characters.forEach((char, index) => {
        const weight =
          char && typeof char === 'object' ? (char as { weight?: unknown }).weight : undefined;
        if (
          typeof weight !== 'number' ||
          !Number.isFinite(weight) ||
          weight < GENERATION_PARAM_LIMITS.minCharacterWeight ||
          weight > GENERATION_PARAM_LIMITS.maxCharacterWeight
        ) {
          issues.push({
            field: 'characters',
            message: `Вес персонажа #${index + 1} должен быть числом от ${GENERATION_PARAM_LIMITS.minCharacterWeight} до ${GENERATION_PARAM_LIMITS.maxCharacterWeight}.`,
          });
        }
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
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

  const resolveOption = (classType: string, field: string, fileName: string): string => {
    const map = input.resolvedModelNames;
    if (!map) return fileName;
    return map[buildModelResolutionKey(classType, field, fileName)] ?? fileName;
  };

  // .gguf files need the ComfyUI-GGUF loaders; .safetensors need the standard ones.
  const configureUnetLoader = (nodeId: string, fileName: string) => {
    const node = graph[nodeId];
    if (!node) return;
    if (fileName.toLowerCase().endsWith('.gguf')) {
      node.class_type = 'UnetLoaderGGUF';
      node.inputs.unet_name = resolveOption('UnetLoaderGGUF', 'unet_name', fileName);
      delete node.inputs.weight_dtype;
    } else {
      node.class_type = 'UNETLoader';
      node.inputs.unet_name = resolveOption('UNETLoader', 'unet_name', fileName);
      node.inputs.weight_dtype = 'default';
    }
  };
  configureUnetLoader('1', route.highNoiseModelFile);
  configureUnetLoader('2', route.lowNoiseModelFile);

  if (graph['3']) {
    graph['3'].inputs.type = model.textEncoderType;
    if (model.textEncoderFile.toLowerCase().endsWith('.gguf')) {
      graph['3'].class_type = 'CLIPLoaderGGUF';
      graph['3'].inputs.clip_name = resolveOption(
        'CLIPLoaderGGUF',
        'clip_name',
        model.textEncoderFile,
      );
      delete graph['3'].inputs.device;
    } else {
      graph['3'].class_type = 'CLIPLoader';
      graph['3'].inputs.clip_name = resolveOption('CLIPLoader', 'clip_name', model.textEncoderFile);
      graph['3'].inputs.device = 'cpu';
    }
  }
  if (graph['4']) {
    graph['4'].inputs.vae_name = resolveOption('VAELoader', 'vae_name', model.vaeFile);
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

  // Ensure ModelSamplingSD3 (shift=5.0) sits between UNET loader(s) and KSamplerAdvanced for Wan 2.2.
  if (!graph['101']) {
    graph['101'] = {
      class_type: 'ModelSamplingSD3',
      inputs: {
        model: ['1', 0],
        shift: 5.0,
      },
      _meta: {
        title: 'Wan 2.2 Flow Shift (High-Noise, shift=5.0)',
      },
    };
  }
  if (model.architecture === 'wan22-moe' && !graph['102']) {
    graph['102'] = {
      class_type: 'ModelSamplingSD3',
      inputs: {
        model: ['2', 0],
        shift: 5.0,
      },
      _meta: {
        title: 'Wan 2.2 Flow Shift (Low-Noise, shift=5.0)',
      },
    };
  }

  // Wan 2.2 TI2V-5B (wan22-dense) uses 48-channel wan2.2_vae and requires Wan22ImageToVideoLatent
  // instead of 16-channel EmptyHunyuanLatentVideo / WanImageToVideo.
  if (model.architecture === 'wan22-dense') {
    const latentInputs: Record<string, unknown> = {
      vae: ['4', 0],
      width: input.settings.width,
      height: input.settings.height,
      length: segmentFrames,
      batch_size: 1,
    };
    if (mode === 'i2v' && graph['7']) {
      latentInputs.start_image = ['7', 0];
    }
    graph['30'] = {
      class_type: 'Wan22ImageToVideoLatent',
      inputs: latentInputs,
      _meta: {
        title: 'Wan 2.2 TI2V-5B 48-ch Latent',
      },
    };
    if (graph['40']) {
      graph['40'].inputs.positive = ['5', 0];
      graph['40'].inputs.negative = ['6', 0];
      graph['40'].inputs.latent_image = ['30', 0];
    }
  } else if (graph['30']) {
    graph['30'].inputs.width = input.settings.width;
    graph['30'].inputs.height = input.settings.height;
    graph['30'].inputs.length = segmentFrames;
  }

  if (graph['40']) {
    graph['40'].inputs.model = ['101', 0];
    graph['40'].inputs.noise_seed = seed;
    graph['40'].inputs.steps = steps;
    graph['40'].inputs.end_at_step = model.architecture === 'wan22-moe' ? splitStep : steps;
    graph['40'].inputs.return_with_leftover_noise =
      model.architecture === 'wan22-moe' ? 'enable' : 'disable';
  }

  if (model.architecture === 'wan22-moe') {
    if (graph['41']) {
      graph['41'].inputs.model = ['102', 0];
      graph['41'].inputs.noise_seed = seed;
      graph['41'].inputs.steps = steps;
      graph['41'].inputs.start_at_step = splitStep;
    }
    if (graph['50']) {
      graph['50'].inputs.samples = ['41', 0];
    }
  } else {
    delete graph['2'];
    delete graph['102'];
    delete graph['41'];
    if (graph['50']) {
      graph['50'].inputs.samples = ['40', 0];
    }
  }

  // Post-processing chain: VAEDecodeTiled (#50) -> Optional 1080p Upscale (#55–57) -> Optional RIFE VFI (#58) -> VHS_VideoCombine (#60)
  let currentImageLink: [string, number] = ['50', 0];

  if (input.settings.upscale1080p) {
    const target1080p = computeUpscaleTargetSize(input.settings.width, input.settings.height);
    if (graph['55'] && typeof graph['55'].inputs.model_name === 'string') {
      graph['55'].inputs.model_name = resolveOption(
        'UpscaleModelLoader',
        'model_name',
        graph['55'].inputs.model_name,
      );
    }
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
      graph['58'].inputs.multiplier = RIFE_MULTIPLIER;
      currentImageLink = ['58', 0];
    }
  } else {
    delete graph['58'];
  }

  const outputFps = computeOutputFps(input.settings.fps, input.settings.rifeEnabled);
  const resolvedPrefix =
    input.filenamePrefix ||
    (typeof graph['60']?.inputs?.filename_prefix === 'string'
      ? graph['60'].inputs.filename_prefix
      : mode === 'i2v'
        ? 'kinoflow_i2v_seg'
        : 'kinoflow_t2v_seg');

  if (input.videoExportBackend === 'core') {
    graph['60'] = {
      class_type: 'CreateVideo',
      inputs: {
        images: currentImageLink,
        fps: outputFps,
      },
      _meta: {
        title: 'Create Video (ComfyUI Core)',
      },
    };
    graph['61'] = {
      class_type: 'SaveVideo',
      inputs: {
        video: ['60', 0],
        filename_prefix: resolvedPrefix,
        format: input.coreVideoFormat ?? 'mp4',
        codec: input.coreVideoCodec ?? 'h264',
      },
      _meta: {
        title: 'Save MP4 Video (ComfyUI Core)',
      },
    };
  } else if (graph['60']) {
    graph['60'].inputs.images = currentImageLink;
    graph['60'].inputs.frame_rate = outputFps;
    if (input.filenamePrefix) {
      graph['60'].inputs.filename_prefix = input.filenamePrefix;
    }
  }

  return graph;
}

interface ElectronComfyRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  multipart?: {
    fieldName: string;
    fileName: string;
    contentType: string;
    bytesBase64: string;
    fields?: Record<string, string>;
  };
}

interface ElectronComfyResponse {
  ok: boolean;
  status: number;
  statusText: string;
  bodyText: string;
  networkError?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

interface ElectronComfyProbeHit {
  baseUrl: string;
  systemStats: {
    system?: { comfyui_version?: string };
    devices?: Array<{ name?: string; vram_total?: number }>;
  };
}

interface ElectronComfyBridge {
  isElectron?: boolean;
  request: (options: ElectronComfyRequestOptions) => Promise<ElectronComfyResponse>;
  probe: (excludeBaseUrl?: string, candidatePorts?: number[]) => Promise<ElectronComfyProbeHit | null>;
}

function getElectronComfyBridge(): ElectronComfyBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { kinoflowComfy?: ElectronComfyBridge }).kinoflowComfy;
  return candidate && typeof candidate.request === 'function' ? candidate : null;
}

export function isElectronComfyBridgeAvailable(): boolean {
  return getElectronComfyBridge() !== null;
}

/**
 * Formats a user-facing generation error without attaching misleading CORS flags when the error
 * came from ComfyUI itself (HTTP 400/500, node crash, missing frame) or from Electron desktop.
 */
export function formatGenerationErrorMessage(params: {
  message: string;
  serverUrl: string;
  isElectron: boolean;
  pageProtocol?: string;
}): string {
  const { message, serverUrl, isElectron, pageProtocol } = params;
  const trimmed = message.trim();
  const isNetworkFailure =
    /^failed to fetch$/i.test(trimmed) ||
    /^networkerror/i.test(trimmed) ||
    /^load failed$/i.test(trimmed) ||
    /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|NETWORK_ERROR/i.test(trimmed);

  if (!isNetworkFailure) {
    return trimmed;
  }

  return classifyConnectionError({
    serverUrl,
    isElectron,
    pageProtocol,
    errorCode: /ECONNREFUSED/i.test(trimmed)
      ? 'ECONNREFUSED'
      : /ETIMEDOUT/i.test(trimmed)
        ? 'ETIMEDOUT'
        : /ENOTFOUND/i.test(trimmed)
          ? 'ENOTFOUND'
          : undefined,
  });
}

/**
 * A fetch-compatible function for simple GET requests: goes through the Electron main-process
 * bridge when it exists (no CORS problems, any port), otherwise uses the browser's fetch.
 */
export function createComfyFetch(): typeof fetch {
  const bridge = getElectronComfyBridge();
  if (!bridge) return fetch;
  return (async (input: RequestInfo | URL) => {
    const res = await bridge.request({ url: String(input), method: 'GET', timeoutMs: 15000 });
    if (res.networkError) {
      throw new TypeError(res.errorMessage || res.errorCode || 'network error');
    }
    return new Response(res.bodyText, { status: res.status });
  }) as typeof fetch;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function buildOnlineConnectionInfo(
  data: {
    system?: { comfyui_version?: string };
    devices?: Array<{ name?: string; vram_total?: number }>;
  },
  detectedUrl?: string,
): ConnectionInfo {
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
    message: detectedUrl
      ? `Соединение установлено (автопоиск: ${detectedUrl})`
      : 'Соединение установлено',
    checkedAt: new Date().toLocaleTimeString('ru-RU'),
    detectedUrl,
  };
}

/**
 * Produces an accurate, actionable Russian diagnostic message for failed ComfyUI connections,
 * distinguishing HTTPS Mixed Content blocks, closed ports (ECONNREFUSED), timeouts, and CORS.
 */
export function classifyConnectionError(params: {
  serverUrl: string;
  isElectron: boolean;
  pageProtocol?: string;
  isAbort?: boolean;
  errorCode?: string;
}): string {
  const base = normalizeBaseUrl(params.serverUrl);
  const code = (params.errorCode ?? '').toUpperCase();

  if (params.isAbort || code === 'ABORT_ERR' || code === 'ETIMEDOUT') {
    return `Таймаут подключения к ${base}. Проверьте, запущен ли ComfyUI и не завис ли сервер.`;
  }

  if (params.isElectron) {
    if (code === 'ECONNREFUSED') {
      return `ComfyUI не отвечает по адресу ${base} (порт закрыт). Запустите ComfyUI (run_nvidia_gpu.bat или ComfyUI Desktop) или переключите порт (8188 / 8000).`;
    }
    if (code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
      return `Хост ${base} недоступен (${code}). Проверьте правильность IP-адреса и порта ComfyUI.`;
    }
    return `Не удалось подключиться к ${base}${code ? ` (${code})` : ''}. Убедитесь, что ComfyUI запущен на этом порту.`;
  }

  const isHttpsPage = params.pageProtocol === 'https:';
  const isHttpTarget = /^http:\/\//i.test(base);
  if (isHttpsPage && isHttpTarget) {
    return `Браузер блокирует запросы с HTTPS-страницы на локальный ${base} (Mixed Content). Откройте KinoFlow Studio в Windows-приложении (.exe) или локально по http://localhost:3000.`;
  }

  return `Не удалось подключиться к ${base}. Проверьте, что ComfyUI запущен (порт 8188 для Portable или 8000 для Desktop) с флагом --enable-cors-header "*".`;
}

/**
 * Builds the workflow variants a generation will use (T2V and/or I2V) so the pre-flight check
 * can verify nodes and model files for all of them before anything is queued.
 */
export function buildPreflightGraphs(params: {
  settings: GenerationSettings;
  hasStartFrame: boolean;
  isContinuation: boolean;
}): ComfyWorkflowGraph[] {
  const { settings, hasStartFrame, isContinuation } = params;
  const planned = planGenerationSegments(settings.durationSec, settings.mode);
  const graphs = new Map<string, ComfyWorkflowGraph>();

  for (const segment of planned) {
    const route = resolveAutoModelRoute({
      modelId: settings.modelId,
      mode: segment.mode,
      segmentIndex: segment.index,
      hasStartFrame: segment.index === 1 ? hasStartFrame : true,
      isContinuation,
    });
    if (graphs.has(route.workflowMode)) continue;
    graphs.set(
      route.workflowMode,
      buildWorkflowFromTemplate({
        settings,
        modeOverride: route.workflowMode,
        positivePrompt: 'preflight',
        negativePrompt: '',
        characters: [],
        startFrameFilename: route.workflowMode === 'i2v' ? 'preflight.png' : undefined,
        hasStartFrame: route.workflowMode === 'i2v',
        segmentIndex: segment.index,
        isContinuation,
      }),
    );
  }
  return [...graphs.values()];
}

/**
 * Checks connectivity to a local ComfyUI server via GET /system_stats.
 * In Electron, requests run natively in the main process (no CORS flag required)
 * and automatically probe standard ports (8188 / 8000 / 8189) if the selected port is closed.
 */
export async function checkConnection(
  serverUrl: string,
  timeoutMs: number = 4500,
): Promise<ConnectionInfo> {
  const base = normalizeBaseUrl(serverUrl);
  const electronBridge = getElectronComfyBridge();

  if (electronBridge) {
    const res = await electronBridge.request({
      url: `${base}/system_stats`,
      method: 'GET',
      timeoutMs,
    });

    if (res.ok) {
      try {
        const data = JSON.parse(res.bodyText) as {
          system?: { comfyui_version?: string };
          devices?: Array<{ name?: string; vram_total?: number }>;
        };
        return buildOnlineConnectionInfo(data);
      } catch {
        return {
          status: 'offline',
          message: `Сервер по адресу ${base} вернул некорректный JSON (возможно, этот порт занят другой программой).`,
          checkedAt: new Date().toLocaleTimeString('ru-RU'),
        };
      }
    }

    if (!res.networkError) {
      return {
        status: 'offline',
        message: `Сервер ответил статусом HTTP ${res.status}.`,
        checkedAt: new Date().toLocaleTimeString('ru-RU'),
      };
    }

    // If port is closed on loopback, automatically check other standard ComfyUI ports (8188 / 8000 / 8189)
    if (
      (res.errorCode === 'ECONNREFUSED' || res.errorCode === 'NETWORK_ERROR') &&
      /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(base)
    ) {
      const detected = await electronBridge.probe(base).catch(() => null);
      if (detected) {
        return buildOnlineConnectionInfo(detected.systemStats, detected.baseUrl);
      }
    }

    return {
      status: 'offline',
      message: classifyConnectionError({
        serverUrl: base,
        isElectron: true,
        isAbort: res.errorCode === 'ABORT_ERR',
        errorCode: res.errorCode,
      }),
      checkedAt: new Date().toLocaleTimeString('ru-RU'),
    };
  }

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

    return buildOnlineConnectionInfo(data);
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    const pageProtocol =
      typeof window !== 'undefined' && window.location ? window.location.protocol : undefined;
    return {
      status: 'offline',
      message: classifyConnectionError({
        serverUrl: base,
        isElectron: false,
        pageProtocol,
        isAbort,
      }),
      checkedAt: new Date().toLocaleTimeString('ru-RU'),
    };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

/**
 * Builds a flat, collision-resistant filename for ComfyUI's root `input/` folder.
 * Standard ComfyUI `LoadImage` only validates files in root `input/` and rejects subfolder paths
 * containing `/` with HTTP 400 ("Value not in list").
 */
export function buildRootUploadFilename(
  originalName: string,
  prefix: string = 'kinoflow',
  timestamp: number = Date.now(),
): string {
  const baseName = originalName.replace(/^.*[\\/]/, '').trim() || 'frame.png';
  const extMatch = /\.(png|jpe?g|webp|bmp)$/i.exec(baseName);
  const ext = extMatch ? extMatch[0].toLowerCase() : '.png';
  const stemRaw = extMatch ? baseName.slice(0, -extMatch[0].length) : baseName;
  const safeStem = stemRaw
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'frame';
  const safePrefix = prefix
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'kinoflow';
  return `${safePrefix}_${timestamp}_${safeStem}${ext}`;
}

/**
 * Uploads an image (character reference, start frame, or extracted last frame) via POST /upload/image
 * directly into ComfyUI's root `input/` directory so `LoadImage` always accepts it.
 */
export async function uploadImage(
  serverUrl: string,
  file: File,
  prefix: string = 'kinoflow_ref',
): Promise<UploadedImageResult> {
  const base = normalizeBaseUrl(serverUrl);
  const electronBridge = getElectronComfyBridge();
  const uploadFileName = buildRootUploadFilename(file.name, prefix);

  if (electronBridge) {
    const bytesBase64 = arrayBufferToBase64(await file.arrayBuffer());
    const res = await electronBridge.request({
      url: `${base}/upload/image`,
      method: 'POST',
      timeoutMs: 30000,
      multipart: {
        fieldName: 'image',
        fileName: uploadFileName,
        contentType: file.type || 'image/png',
        bytesBase64,
        fields: {
          type: 'input',
          subfolder: '',
          overwrite: 'true',
        },
      },
    });

    if (!res.ok) {
      throw new Error(
        `Ошибка загрузки изображения «${file.name}» (${res.status || res.errorCode || 'ERR'}): ${
          res.bodyText || res.errorMessage || res.statusText
        }`,
      );
    }

    const data = JSON.parse(res.bodyText) as Partial<UploadedImageResult>;
    if (!data.name) {
      throw new Error(`ComfyUI не вернул имя загруженного файла для «${file.name}».`);
    }

    return {
      name: data.subfolder ? `${data.subfolder}/${data.name}` : data.name,
      subfolder: data.subfolder ?? '',
      type: data.type ?? 'input',
    };
  }

  const formData = new FormData();
  formData.append('image', file, uploadFileName);
  formData.append('type', 'input');
  formData.append('subfolder', '');
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
  const payload = JSON.stringify({
    prompt: workflow,
    client_id: clientId,
  });
  const electronBridge = getElectronComfyBridge();

  let ok: boolean;
  let status: number;
  let statusText: string;
  let bodyText: string;

  if (electronBridge) {
    const res = await electronBridge.request({
      url: `${base}/prompt`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: payload,
      timeoutMs: 30000,
    });
    ok = res.ok;
    status = res.status;
    statusText = res.errorMessage || res.statusText;
    bodyText = res.bodyText;
  } else {
    const response = await fetch(`${base}/prompt`, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
      },
      body: payload,
    });
    ok = response.ok;
    status = response.status;
    statusText = response.statusText;
    bodyText = await response.text().catch(() => '');
  }

  if (!ok) {
    throw new Error(
      `ComfyUI отклонил задачу /prompt (${status}): ${bodyText || statusText}`,
    );
  }

  const data = JSON.parse(bodyText) as {
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
  const url = `${base}/history/${encodeURIComponent(promptId)}`;
  const electronBridge = getElectronComfyBridge();

  if (electronBridge) {
    const res = await electronBridge.request({
      url,
      method: 'GET',
      timeoutMs: 15000,
    });
    if (!res.ok) {
      throw new Error(`Не удалось получить историю задачи (${res.status || res.errorCode}).`);
    }
    return JSON.parse(res.bodyText) as Record<string, unknown>;
  }

  const response = await fetch(url, {
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
  const electronBridge = getElectronComfyBridge();

  if (electronBridge) {
    await electronBridge.request({
      url: `${base}/interrupt`,
      method: 'POST',
      timeoutMs: 8000,
    });
    return;
  }

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

interface HistoryStatusEntry {
  status_str?: string;
  completed?: boolean;
  messages?: Array<[string, Record<string, unknown>?]>;
}

function extractTracebackLocation(traceback: unknown): string | null {
  if (!Array.isArray(traceback) || traceback.length === 0) return null;
  for (let i = traceback.length - 1; i >= 0; i -= 1) {
    const entry = traceback[i];
    if (typeof entry !== 'string') continue;
    const match = /File "([^"]+)", line (\d+)(?:, in ([^\r\n]+))?/.exec(entry);
    if (!match) continue;
    const normalizedPath = match[1].replace(/\\/g, '/');
    const parts = normalizedPath.split('/').filter(Boolean);
    const shortPath = parts.slice(-2).join('/') || normalizedPath;
    const fnName = match[3]?.trim();
    return fnName ? `${shortPath}:${match[2]} in ${fnName}` : `${shortPath}:${match[2]}`;
  }
  return null;
}

export function formatComfyExecutionError(params: {
  nodeId?: unknown;
  nodeType?: string;
  exceptionMessage?: unknown;
  traceback?: unknown;
}): string {
  const nodeId =
    params.nodeId !== undefined && params.nodeId !== null && String(params.nodeId).trim()
      ? String(params.nodeId).trim()
      : null;
  const nodeType = typeof params.nodeType === 'string' && params.nodeType.trim() ? params.nodeType.trim() : undefined;
  const exc =
    typeof params.exceptionMessage === 'string' && params.exceptionMessage.trim()
      ? params.exceptionMessage.trim()
      : 'Ошибка выполнения узла в ComfyUI.';
  const nodePrefix = nodeId
    ? `Узел #${nodeId}${nodeType ? ` (${nodeType})` : ''}: `
    : nodeType
      ? `${nodeType}: `
      : '';

  const location = extractTracebackLocation(params.traceback);
  const tracebackText = Array.isArray(params.traceback)
    ? params.traceback.filter((item): item is string => typeof item === 'string').join('\n')
    : '';
  const baseMessage = location
    ? `Ошибка ComfyUI · ${nodePrefix}${exc} [${location}]`
    : `Ошибка ComfyUI · ${nodePrefix}${exc}`;

  if (/errno\s*22|invalid argument/i.test(exc)) {
    const isConsoleStreamCrash = /tqdm|flush|stdout|stderr|logger|prestartup_script/i.test(tracebackText);
    if (isConsoleStreamCrash) {
      return `${baseMessage}. Сбой консольного вывода прогресса в Windows — перезапустите ComfyUI из KinoFlow Studio или обновите ComfyUI и ComfyUI-Manager.`;
    }
    return `${baseMessage}. Возможные причины на Windows: сбой консольного прогресс-бара (перезапустите ComfyUI из KinoFlow Studio или обновите ComfyUI/Manager), расположение ComfyUI в OneDrive либо повреждённый файл модели.`;
  }

  return baseMessage;
}

/**
 * Inspects `/history/{prompt_id}` status block for ComfyUI execution errors or interruptions
 * so failed workflows surface immediately instead of polling indefinitely.
 */
export function extractExecutionErrorFromHistory(
  historyPayload: Record<string, unknown>,
  promptId: string,
): string | null {
  const entry = historyPayload[promptId] as { status?: HistoryStatusEntry } | undefined;
  const status = entry?.status;
  if (!status) return null;

  if (Array.isArray(status.messages)) {
    for (const msg of status.messages) {
      if (!Array.isArray(msg)) continue;
      const [eventType, payload] = msg;
      if (eventType === 'execution_error') {
        return formatComfyExecutionError({
          nodeId: payload?.node_id ?? payload?.node,
          nodeType: typeof payload?.node_type === 'string' ? payload.node_type : undefined,
          exceptionMessage: payload?.exception_message,
          traceback: payload?.traceback,
        });
      }
      if (eventType === 'execution_interrupted') {
        return 'Генерация была прервана на сервере ComfyUI.';
      }
    }
  }

  if (status.status_str === 'error') {
    return 'ComfyUI завершил задачу с ошибкой. Проверьте консоль ComfyUI для деталей.';
  }

  return null;
}

/**
 * Returns true once ComfyUI marks the prompt as completed/finished in `/history/{prompt_id}`.
 */
export function isHistoryPromptFinished(
  historyPayload: Record<string, unknown>,
  promptId: string,
): boolean {
  const entry = historyPayload[promptId] as { status?: HistoryStatusEntry } | undefined;
  const status = entry?.status;
  if (!status) return false;
  return (
    status.completed === true ||
    status.status_str === 'success' ||
    status.status_str === 'error'
  );
}

export function parseComfyWsEvent(rawMessage: string, expectedPromptId?: string): ParsedWsEvent {
  try {
    const parsed = JSON.parse(rawMessage) as {
      type?: string;
      data?: {
        prompt_id?: string;
        node?: string | null;
        node_id?: string | null;
        node_type?: string;
        value?: number;
        max?: number;
        exception_message?: string;
        traceback?: string[];
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
      const nodeId = data.node_id ?? data.node ?? null;
      const nodeType = data.node_type;
      return {
        type: 'execution_error',
        promptId: data.prompt_id,
        nodeId,
        nodeType,
        errorMessage: formatComfyExecutionError({
          nodeId,
          nodeType,
          exceptionMessage: data.exception_message,
          traceback: data.traceback,
        }),
      };
    }

    if (parsed.type === 'execution_interrupted') {
      return {
        type: 'execution_interrupted',
        promptId: data.prompt_id,
        nodeId: data.node_id ?? data.node ?? null,
        errorMessage: 'Генерация была прервана на сервере ComfyUI.',
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
        const execError = extractExecutionErrorFromHistory(history, promptId);
        if (execError) {
          fail(new Error(execError));
          return true;
        }
        const video = extractVideoOutputFromHistory(history, promptId, serverUrl);
        if (video) {
          succeed(video);
          return true;
        }
        if (isHistoryPromptFinished(history, promptId)) {
          fail(
            new Error(
              'ComfyUI завершил выполнение графа, но не вернул видеофайл. Проверьте узел экспорта видео (VHS_VideoCombine / SaveVideo) в консоли ComfyUI.',
            ),
          );
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

        if (parsed.type === 'execution_error' || parsed.type === 'execution_interrupted') {
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
      ws.onclose = () => {
        wsConnected = false;
      };
    }

    pollTimer = setInterval(async () => {
      if (settled) return;
      try {
        const history = await getHistory(serverUrl, promptId);
        if (history[promptId]) {
          const execError = extractExecutionErrorFromHistory(history, promptId);
          if (execError) {
            fail(new Error(execError));
            return;
          }
          const video = extractVideoOutputFromHistory(history, promptId, serverUrl);
          if (video) {
            succeed(video);
            return;
          }
          if (isHistoryPromptFinished(history, promptId)) {
            fail(
              new Error(
                'ComfyUI завершил выполнение графа, но не вернул видеофайл. Проверьте узел экспорта видео (VHS_VideoCombine / SaveVideo) в консоли ComfyUI.',
              ),
            );
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
  /** Per-segment actions and camera moves; shot i is used for the i-th 5-second segment. */
  storyboard?: StoryboardShot[];
  /** Camera move applied to segments whose shot has no own camera (or when there is no storyboard). */
  defaultCamera?: CameraPresetId;
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
    storyboard,
    defaultCamera = 'none',
    startFrame,
    isContinuation = false,
    fallbackCharacterAnchors = [],
    signal,
    onProgress,
  } = options;
  const validation = validateGenerationParams({
    settings,
    positivePrompt,
    negativePrompt,
    hasStartFrame: Boolean(startFrame),
    characters,
  });
  if (!validation.valid) {
    throw new GenerationParamsValidationError(validation.issues);
  }

  const serverUrl = normalizeBaseUrl(settings.serverUrl);
  const plannedSegments = planGenerationSegments(settings.durationSec, settings.mode);

  // Catch HTTPS -> HTTP Mixed Content immediately in browser preview before firing fetch/WebSocket.
  if (
    typeof window !== 'undefined' &&
    !getElectronComfyBridge() &&
    window.location?.protocol === 'https:' &&
    /^http:\/\//i.test(serverUrl)
  ) {
    throw new Error(
      classifyConnectionError({
        serverUrl,
        isElectron: false,
        pageProtocol: 'https:',
      }),
    );
  }

  const preflightReport = await runPreflight(
    serverUrl,
    buildPreflightGraphs({
      settings,
      hasStartFrame: Boolean(startFrame) || (characters.length > 0 && !isContinuation),
      isContinuation,
    }),
    createComfyFetch(),
  );
  if (preflightReport && !preflightReport.ok) {
    throw new PreflightError(preflightReport);
  }
  const videoExportBackend: VideoExportBackend = preflightReport?.videoExportBackend ?? 'vhs';
  const resolvedModelNames = preflightReport?.resolvedModelNames;
  const coreVideoFormat = preflightReport?.coreVideoFormat;
  const coreVideoCodec = preflightReport?.coreVideoCodec;

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
      const uploaded = await uploadImage(serverUrl, char.file, 'kinoflow_ref');
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

    // Every chained 5s segment (2..6) and every Extend Scene continuation receives the
    // previous segment's last frame and automatically routes to workflow_i2v.json.
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
      positivePrompt: buildSegmentPrompt({
        basePrompt: positivePrompt,
        shot: storyboard?.[segment.index - 1],
        defaultCamera,
      }),
      negativePrompt,
      characters: uploadedChars,
      startFrameFilename: route.workflowMode === 'i2v' ? currentStartFrameFilename : undefined,
      hasStartFrame: route.workflowMode === 'i2v' && Boolean(currentStartFrameFilename),
      seedOverride: segmentSeed,
      filenamePrefix: `kinoflow_seg${segment.index}_${route.workflowMode}`,
      segmentIndex: segment.index,
      isContinuation,
      videoExportBackend,
      resolvedModelNames,
      coreVideoFormat,
      coreVideoCodec,
    });

    const segStartPct = baseProgressOffset + (segment.index - 1) * perSegmentBudget;

    onProgress({
      phase: 'queuing',
      percent: Math.round(segStartPct),
      segmentIndex: segment.index,
      totalSegments: segment.total,
      segmentStartSec: segment.startSec,
      segmentEndSec: segment.endSec,
      segmentMode: route.workflowMode,
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
          segmentMode: route.workflowMode,
          identityAnchorCount: uploadedChars.length,
          message: meta.detail ? `${segmentLabel} ${meta.detail}` : segmentLabel,
        });
      },
    });

    renderedSegments.push({
      index: segment.index,
      mode: route.workflowMode,
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
