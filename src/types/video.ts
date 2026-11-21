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

export interface GenerationSettings {
  serverUrl: string;
  comfyDir: string;
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
  offlineMode?: boolean;
  localLlmUrl?: string;
  localLlmModel?: string;
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
}
