/**
 * Storyboard + camera presets.
 * A long video (10–30 s) is generated as chained 5-second segments. Instead of repeating one
 * static prompt for every segment, each segment can get its own action and camera move.
 */

export type CameraPresetId = 'none' | 'static' | 'push-in' | 'pull-out' | 'pan' | 'orbit' | 'follow';

export interface CameraPreset {
  id: CameraPresetId;
  label: string;
  /** English cue appended to the prompt (the text encoder works best with English). */
  cue: string;
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'none', label: 'Не указывать', cue: '' },
  { id: 'static', label: 'Статика', cue: 'static locked-off camera on a tripod, no camera movement' },
  {
    id: 'push-in',
    label: 'Наезд',
    cue: 'slow smooth push-in, the camera dollies forward toward the subject',
  },
  {
    id: 'pull-out',
    label: 'Отъезд',
    cue: 'slow smooth pull-out, the camera dollies backward revealing more of the scene',
  },
  { id: 'pan', label: 'Панорама', cue: 'smooth horizontal pan from left to right' },
  {
    id: 'orbit',
    label: 'Облёт',
    cue: 'slow orbit shot, the camera circles around the subject',
  },
  {
    id: 'follow',
    label: 'Следование',
    cue: 'tracking shot, the camera follows the subject from behind at a steady distance',
  },
];

export interface StoryboardShot {
  text: string;
  camera: CameraPresetId;
}

export const EMPTY_SHOT: StoryboardShot = { text: '', camera: 'none' };

export function getCameraPreset(id: CameraPresetId): CameraPreset {
  return CAMERA_PRESETS.find((preset) => preset.id === id) ?? CAMERA_PRESETS[0];
}

/** Keeps existing shots, pads with empty ones or trims so the list matches `count` segments. */
export function resizeStoryboard(shots: StoryboardShot[], count: number): StoryboardShot[] {
  const size = Math.max(0, Math.floor(count));
  return Array.from({ length: size }, (_, index) => shots[index] ?? { ...EMPTY_SHOT });
}

export interface SegmentPromptInput {
  /** The general scene description: place, characters, style, light. */
  basePrompt: string;
  /** Shot for this segment (undefined when the storyboard is off). */
  shot?: StoryboardShot;
  /** Camera used when the shot has no own camera, or when there is no storyboard. */
  defaultCamera: CameraPresetId;
}

function endWithPeriod(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Prompt for one 5-second segment: general scene + what happens in this segment + camera move.
 * With an empty storyboard and no camera it returns the base prompt unchanged.
 */
export function buildSegmentPrompt({ basePrompt, shot, defaultCamera }: SegmentPromptInput): string {
  const parts: string[] = [];
  const base = basePrompt.trim();
  const action = shot?.text.trim() ?? '';

  if (action) {
    if (base) parts.push(endWithPeriod(base));
    parts.push(endWithPeriod(action));
  } else if (base) {
    parts.push(base);
  }

  const cameraId = shot && shot.camera !== 'none' ? shot.camera : defaultCamera;
  const cue = getCameraPreset(cameraId).cue;
  if (cue && parts.length > 0) {
    const last = parts.length - 1;
    parts[last] = endWithPeriod(parts[last]);
    parts.push(`Camera: ${cue}.`);
  }

  return parts.join(' ');
}

/** Number of 5-second segments for a given duration (matches planGenerationSegments). */
export function countStoryboardSegments(durationSec: number, segmentSec = 5): number {
  return Math.max(1, Math.min(6, Math.ceil(durationSec / segmentSec)));
}
