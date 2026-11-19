import type { GenerationHistoryItem, GenerationSettings } from '../types/video';

const HISTORY_KEY = 'kinoflow_generation_history_v1';
const SETTINGS_KEY = 'kinoflow_generation_settings_v1';
const MAX_HISTORY_ITEMS = 24;

export function loadHistory(): GenerationHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GenerationHistoryItem[]) : [];
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
