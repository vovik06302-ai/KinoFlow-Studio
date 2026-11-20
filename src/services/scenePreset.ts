import {
  DURATION_CHOICES,
  FPS_CHOICES,
  RESOLUTION_PRESETS,
  SHOOTING_STYLES,
  VIDEO_MODELS,
  secondsToAlignedFrames,
} from './comfyService';
import { CAMERA_PRESETS } from './storyboard';
import type { CameraPresetId, StoryboardShot } from './storyboard';
import type { BaseModelId, DurationChoice, FpsChoice, GenerationSettings, ShootingStyleId } from '../types/video';

/**
 * A scene preset is a small JSON file with everything needed to repeat a scene: the prompts,
 * the storyboard, the camera and the main generation settings. It never contains server
 * addresses, folders, seeds or images.
 */

export const SCENE_PRESET_FORMAT = 'kinoflow-scene-preset';
export const SCENE_PRESET_VERSION = 1;
const SEGMENT_SEC = 5;

export interface ScenePreset {
  format: typeof SCENE_PRESET_FORMAT;
  version: typeof SCENE_PRESET_VERSION;
  prompt: string;
  negativePrompt: string;
  cameraPreset: CameraPresetId;
  storyboardEnabled: boolean;
  storyboardShots: StoryboardShot[];
  settings: Partial<
    Pick<
      GenerationSettings,
      | 'modelId'
      | 'durationSec'
      | 'fps'
      | 'resolutionId'
      | 'width'
      | 'height'
      | 'steps'
      | 'frames'
      | 'upscale1080p'
      | 'rifeEnabled'
      | 'shootingStyle'
    >
  >;
}

export interface ScenePresetSource {
  prompt: string;
  negativePrompt: string;
  cameraPreset: CameraPresetId;
  storyboardEnabled: boolean;
  storyboardShots: StoryboardShot[];
  settings: GenerationSettings;
}

export function exportScenePreset(source: ScenePresetSource): string {
  const { settings } = source;
  const preset: ScenePreset = {
    format: SCENE_PRESET_FORMAT,
    version: SCENE_PRESET_VERSION,
    prompt: source.prompt,
    negativePrompt: source.negativePrompt,
    cameraPreset: source.cameraPreset,
    storyboardEnabled: source.storyboardEnabled,
    storyboardShots: source.storyboardShots,
    settings: {
      modelId: settings.modelId,
      durationSec: settings.durationSec,
      fps: settings.fps,
      resolutionId: settings.resolutionId,
      width: settings.width,
      height: settings.height,
      steps: settings.steps,
      frames: settings.frames,
      upscale1080p: settings.upscale1080p,
      rifeEnabled: settings.rifeEnabled,
      shootingStyle: settings.shootingStyle,
    },
  };
  return JSON.stringify(preset, null, 2);
}

const CAMERA_IDS = new Set<string>(CAMERA_PRESETS.map((preset) => preset.id));

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Reads a preset from text. Unknown or invalid fields are dropped instead of failing, so a
 * hand-edited file still loads; a file that is not a KinoFlow preset is rejected.
 */
export function parseScenePreset(text: string): ScenePreset {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Файл не похож на JSON.');
  }
  if (!raw || typeof raw !== 'object' || (raw as { format?: unknown }).format !== SCENE_PRESET_FORMAT) {
    throw new Error('Это не пресет сцены KinoFlow Studio.');
  }
  const data = raw as Record<string, unknown>;
  if (typeof data.version === 'number' && data.version > SCENE_PRESET_VERSION) {
    throw new Error('Пресет создан в более новой версии приложения. Обновите KinoFlow Studio.');
  }

  const shots: StoryboardShot[] = Array.isArray(data.storyboardShots)
    ? data.storyboardShots.slice(0, 6).map((item) => {
        const shot = (item ?? {}) as Record<string, unknown>;
        const camera = asString(shot.camera, 'none');
        return {
          text: asString(shot.text),
          camera: (CAMERA_IDS.has(camera) ? camera : 'none') as CameraPresetId,
        };
      })
    : [];

  const rawSettings = (data.settings && typeof data.settings === 'object' ? data.settings : {}) as Record<
    string,
    unknown
  >;
  const settings: ScenePreset['settings'] = {};

  if (VIDEO_MODELS.some((model) => model.id === rawSettings.modelId)) {
    settings.modelId = rawSettings.modelId as BaseModelId;
  }
  if (DURATION_CHOICES.includes(rawSettings.durationSec as DurationChoice)) {
    settings.durationSec = rawSettings.durationSec as DurationChoice;
  }
  if (FPS_CHOICES.includes(rawSettings.fps as FpsChoice)) {
    settings.fps = rawSettings.fps as FpsChoice;
    settings.frames = secondsToAlignedFrames(SEGMENT_SEC, settings.fps);
  }
  const resolution = RESOLUTION_PRESETS.find((item) => item.id === rawSettings.resolutionId);
  if (resolution) {
    settings.resolutionId = resolution.id;
    settings.width = resolution.width;
    settings.height = resolution.height;
  }
  if (typeof rawSettings.steps === 'number' && rawSettings.steps >= 1 && rawSettings.steps <= 100) {
    settings.steps = Math.round(rawSettings.steps);
  }
  if (typeof rawSettings.upscale1080p === 'boolean') settings.upscale1080p = rawSettings.upscale1080p;
  if (typeof rawSettings.rifeEnabled === 'boolean') settings.rifeEnabled = rawSettings.rifeEnabled;
  if (SHOOTING_STYLES.some((style) => style.id === rawSettings.shootingStyle)) {
    settings.shootingStyle = rawSettings.shootingStyle as ShootingStyleId;
  }

  const camera = asString(data.cameraPreset, 'none');
  return {
    format: SCENE_PRESET_FORMAT,
    version: SCENE_PRESET_VERSION,
    prompt: asString(data.prompt),
    negativePrompt: asString(data.negativePrompt),
    cameraPreset: (CAMERA_IDS.has(camera) ? camera : 'none') as CameraPresetId,
    storyboardEnabled: data.storyboardEnabled === true,
    storyboardShots: shots,
    settings,
  };
}
