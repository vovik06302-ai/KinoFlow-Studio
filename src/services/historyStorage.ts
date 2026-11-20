import type {
  GenerationHistoryItem,
  GenerationSettings,
  HistoryCharacterSummary,
} from '../types/video';

const HISTORY_KEY = 'kinoflow_generation_history_v1';
const SETTINGS_KEY = 'kinoflow_generation_settings_v1';
const MAX_HISTORY_ITEMS = 24;

function sanitizeCharacters(raw: unknown): HistoryCharacterSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry, idx) => ({
      name:
        typeof entry.name === 'string' && entry.name.trim()
          ? entry.name
          : `Персонаж ${idx + 1}`,
      weight:
        typeof entry.weight === 'number' && Number.isFinite(entry.weight) ? entry.weight : 0.75,
      filename: typeof entry.filename === 'string' ? entry.filename : undefined,
    }));
}

export function sanitizeHistoryItems(raw: unknown): GenerationHistoryItem[] {
  if (!Array.isArray(raw)) return [];
  const clean: GenerationHistoryItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string' || !item.id || typeof item.videoUrl !== 'string') {
      continue;
    }
    const fps = item.fps === 24 ? 24 : 16;
    clean.push({
      ...(item as unknown as GenerationHistoryItem),
      id: item.id,
      createdAt:
        typeof item.createdAt === 'string' && item.createdAt
          ? item.createdAt
          : new Date().toISOString(),
      mode: item.mode === 'i2v' ? 'i2v' : 't2v',
      prompt: typeof item.prompt === 'string' ? item.prompt : '',
      negativePrompt: typeof item.negativePrompt === 'string' ? item.negativePrompt : '',
      modelId: typeof item.modelId === 'string' ? (item.modelId as GenerationHistoryItem['modelId']) : 'auto',
      modelLabel: typeof item.modelLabel === 'string' ? item.modelLabel : 'Wan 2.2',
      width: typeof item.width === 'number' && item.width > 0 ? item.width : 832,
      height: typeof item.height === 'number' && item.height > 0 ? item.height : 480,
      durationSec:
        typeof item.durationSec === 'number' && item.durationSec > 0 ? item.durationSec : 5,
      fps,
      frames: typeof item.frames === 'number' && item.frames > 0 ? item.frames : 81,
      steps: typeof item.steps === 'number' && item.steps > 0 ? item.steps : 28,
      seed: typeof item.seed === 'number' && Number.isFinite(item.seed) ? item.seed : 0,
      characters: sanitizeCharacters(item.characters),
      videoUrl: item.videoUrl,
      filename: typeof item.filename === 'string' ? item.filename : 'video.mp4',
      subfolder: typeof item.subfolder === 'string' ? item.subfolder : '',
      fileType: typeof item.fileType === 'string' ? item.fileType : 'output',
      serverUrl: typeof item.serverUrl === 'string' ? item.serverUrl : 'http://127.0.0.1:8188',
      segments: Array.isArray(item.segments)
        ? (item.segments as GenerationHistoryItem['segments'])
        : undefined,
    });
  }
  return clean.slice(0, MAX_HISTORY_ITEMS);
}

export function loadHistory(): GenerationHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return sanitizeHistoryItems(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveHistory(items: GenerationHistoryItem[]): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS)));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadSavedSettings(): Partial<GenerationSettings> | null {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<GenerationSettings>) : null;
  } catch {
    return null;
  }
}

export function saveSettings(settings: GenerationSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}
