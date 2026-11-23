export type GenerationMode = 't2v' | 'i2v';

export type DurationChoice = 5 | 10 | 15 | 20 | 25 | 30;

export type FpsChoice = 16 | 24;

export type RifeTargetFps = 24 | 30;

export type ShootingStyleId =
  | 'arri-35mm'
  | 'documentary-handheld'
  | 'studio-lighting'
  | 'night-neon';

export interface ShootingStyleOption {
  id: ShootingStyleId;
  label: string;
  promptCue: string;
  description: string;
}

export type BaseModelId =
  | 'auto'
  | 'wan22-t2v-a14b-q4'
  | 'wan22-t2v-a14b-q5'
  | 'wan22-ti2v-5b-fp8';

export interface VideoModelOption {
  id: BaseModelId;
  label: string;
  shortLabel: string;
  architecture: 'wan22-moe' | 'wan22-dense';
  highNoiseFile: string;
  lowNoiseFile: string;
  i2vHighNoiseFile: string;
  i2vLowNoiseFile: string;
  textEncoderFile: string;
  textEncoderType: 'wan' | 'sd3';
  vaeFile: string;
  defaultFps: FpsChoice;
  defaultSteps: number;
  vramHint: string;
}

export interface ResolutionOption {
  id: string;
  label: string;
  width: number;
  height: number;
  aspect: string;
}

export interface StartFrameReference {
  file: File;
  previewUrl: string;
  sourceLabel?: string;
}

export interface CharacterReference {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  weight: number; // 0.0 to 1.0
  uploadedFilename?: string;
}

export type SamplerName = 'uni_pc' | 'euler' | 'dpmpp_2m' | 'res_multistep';

export type SchedulerName = 'simple' | 'beta' | 'normal' | 'sgm_uniform';

export type AudioGenerationStrategy = 'comfy-audiocraft' | 'external-api';

export type AudioCraftModelType = 'audiogen' | 'musicgen';

export interface ComfyInstanceSettings {
  gpuIndex: number;
  port: number;
}

export interface ComfyInstancesSettings {
  '1': ComfyInstanceSettings;
  '2': ComfyInstanceSettings;
}

export interface GenerationSettings {
  serverUrl: string;
  comfyDir: string;
  /** Per-instance GPU and port configuration for multi-GPU ComfyUI launcher. */
  comfyInstances?: ComfyInstancesSettings;
  mode: GenerationMode;
  modelId: BaseModelId;
  durationSec: DurationChoice;
  fps: FpsChoice;
  frames: number; // aligned frames per 5-second segment
  resolutionId: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  seedLocked: boolean;
  upscale1080p: boolean;
  rifeEnabled: boolean;
  rifeTargetFps: RifeTargetFps;
  shootingStyle: ShootingStyleId;
  /** LightX2V 4–8 step distilled LoRA speedup mode (3–4x faster Wan 2.2 MoE). */
  fastLightX2V?: boolean;
  /** Fine sampler controls (Wan 2.2 CFG, Flow Shift, sampler, scheduler). */
  cfg?: number;
  cfgLow?: number;
  flowShift?: number;
  samplerName?: SamplerName;
  scheduler?: SchedulerName;
  /** Optional custom style/motion LoRA from ComfyUI models/loras. */
  customLoraName?: string;
  customLoraStrength?: number;
  /** Center-crop I2V start/end frames to exact target aspect ratio before encoding. */
  autoCropStartFrame?: boolean;
  /** Color-drift mitigation across chained 10–30s segments (gentle CFG/shift decay + high-bitrate intermediate + negative guard). */
  preventColorDrift?: boolean;
  /** Automatically translate Cyrillic prompts to English via configured local LLM before generation. */
  autoTranslateRuPrompt?: boolean;
  offlineMode?: boolean;
  localLlmUrl?: string;
  localLlmModel?: string;
  /** Optional text prompt for soundtrack/SFX generation (AudioCraft or external audio API). */
  soundDescription?: string;
  /** When true, generates audio alongside video (Strategy A) or enables audio workflow controls. */
  generateAudio?: boolean;
  /** Strategy A: ComfyUI-AudioCraft nodes in workflow; Strategy B: external audio generation API fallback. */
  audioStrategy?: AudioGenerationStrategy;
  /** AudioCraft model variant for Strategy A: AudioGen (SFX/ambient) or MusicGen (music). */
  audioCraftModel?: AudioCraftModelType;
  /** Configurable HTTP endpoint for external audio generation API (Strategy B fallback). */
  audioApiEndpoint?: string;
  /** Optional API key / Bearer token for external audio generation API (kept in memory only). */
  audioApiKey?: string;
}

export type ConnectionStatus = 'idle' | 'checking' | 'online' | 'offline';

export interface ConnectionInfo {
  status: ConnectionStatus;
  message?: string;
  gpuName?: string;
  vramTotalGb?: number;
  comfyVersion?: string;
  checkedAt?: string;
  detectedUrl?: string;
}

export type GenerationPhase =
  | 'idle'
  | 'uploading'
  | 'queuing'
  | 'running'
  | 'extracting_frame'
  | 'finalizing'
  | 'completed'
  | 'error'
  | 'cancelled';

export interface GenerationProgress {
  phase: GenerationPhase;
  percent: number;
  currentStep?: number;
  totalSteps?: number;
  currentNodeTitle?: string;
  promptId?: string;
  segmentIndex?: number; // 1-based
  totalSegments?: number;
  segmentStartSec?: number;
  segmentEndSec?: number;
  segmentMode?: GenerationMode;
  identityAnchorCount?: number;
  message: string;
  transport?: 'ws' | 'polling';
}

export interface GeneratedSegment {
  index: number; // 1-based
  mode: GenerationMode;
  startSec: number;
  endSec: number;
  promptId: string;
  videoUrl: string;
  filename: string;
  subfolder: string;
  fileType: string;
  seed: number;
  localFilePath?: string;
  audioUrl?: string;
  hasAudio?: boolean;
}

export interface HistoryCharacterSummary {
  name: string;
  weight: number;
  filename?: string;
}

export interface GenerationHistoryItem {
  id: string;
  createdAt: string;
  mode: GenerationMode;
  prompt: string;
  enhancedPrompt?: string;
  negativePrompt: string;
  modelId: BaseModelId;
  modelLabel: string;
  width: number;
  height: number;
  durationSec: number;
  fps: FpsChoice;
  outputFps?: number;
  upscale1080p?: boolean;
  rifeEnabled?: boolean;
  rifeTargetFps?: RifeTargetFps;
  shootingStyle?: ShootingStyleId;
  frames: number;
  steps: number;
  seed: number;
  characters: HistoryCharacterSummary[];
  videoUrl: string;
  filename: string;
  subfolder: string;
  fileType: string;
  serverUrl: string;
  segments?: GeneratedSegment[];
  isExtendedFromId?: string;
  localFilePath?: string;
  soundDescription?: string;
  audioUrl?: string;
  hasAudio?: boolean;
}
