import type { GenerationSettings } from '../types/video';
import type { CameraPresetId } from './storyboard';

export type BatchQueueStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface BatchQueueItem {
  id: string;
  createdAt: string;
  prompt: string;
  negativePrompt: string;
  cameraPreset: CameraPresetId;
  lightingPreset: string;
  settings: GenerationSettings;
  status: BatchQueueStatus;
  error?: string;
  resultHistoryId?: string;
}

const BATCH_QUEUE_STORAGE_KEY = 'kinoflow_studio_batch_queue_v1';
const MAX_BATCH_ITEMS = 40;

export function createBatchQueueItem(input: {
  prompt: string;
  negativePrompt: string;
  cameraPreset: CameraPresetId;
  lightingPreset: string;
  settings: GenerationSettings;
}): BatchQueueItem {
  return {
    id: `batch-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    prompt: input.prompt.trim(),
    negativePrompt: input.negativePrompt,
    cameraPreset: input.cameraPreset,
    lightingPreset: input.lightingPreset,
    settings: { ...input.settings },
    status: 'pending',
  };
}

export function enqueueBatchItem(
  queue: BatchQueueItem[],
  item: BatchQueueItem,
): BatchQueueItem[] {
  return [...queue, item].slice(-MAX_BATCH_ITEMS);
}

export function removeBatchItem(queue: BatchQueueItem[], id: string): BatchQueueItem[] {
  return queue.filter((item) => item.id !== id);
}

export function clearFinishedBatchItems(queue: BatchQueueItem[]): BatchQueueItem[] {
  return queue.filter((item) => item.status === 'pending' || item.status === 'running');
}

export function updateBatchItem(
  queue: BatchQueueItem[],
  id: string,
  patch: Partial<Pick<BatchQueueItem, 'status' | 'error' | 'resultHistoryId'>>,
): BatchQueueItem[] {
  return queue.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

export function getNextPendingBatchItem(queue: BatchQueueItem[]): BatchQueueItem | null {
  return queue.find((item) => item.status === 'pending') ?? null;
}

export function loadBatchQueue(): BatchQueueItem[] {
  try {
    const raw = localStorage.getItem(BATCH_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is BatchQueueItem =>
          Boolean(item) &&
          typeof item.id === 'string' &&
          typeof item.prompt === 'string' &&
          Boolean(item.settings),
      )
      .map((item) => ({
        ...item,
        // Never revive stale "running" items after a reload — reset them to pending.
        status: item.status === 'running' ? 'pending' : item.status,
      }))
      .slice(0, MAX_BATCH_ITEMS);
  } catch {
    return [];
  }
}

export function saveBatchQueue(queue: BatchQueueItem[]): void {
  try {
    localStorage.setItem(
      BATCH_QUEUE_STORAGE_KEY,
      JSON.stringify(queue.slice(0, MAX_BATCH_ITEMS)),
    );
  } catch {
    // Ignore storage quota errors
  }
}

/** Servers the queue can spread scenes over (ComfyUI instance 1 on GPU 0, instance 2 on GPU 1). */
export const QUEUE_SERVER_CHOICES: Array<{ url: string; label: string }> = [
  { url: 'http://127.0.0.1:8188', label: 'Порт 8188 · видеокарта 0' },
  { url: 'http://127.0.0.1:8189', label: 'Порт 8189 · видеокарта 1' },
];

const QUEUE_SERVERS_STORAGE_KEY = 'kinoflow_studio_queue_servers_v1';

export function loadQueueServers(): string[] {
  const allowed = new Set(QUEUE_SERVER_CHOICES.map((choice) => choice.url));
  try {
    const raw = localStorage.getItem(QUEUE_SERVERS_STORAGE_KEY);
    if (!raw) return QUEUE_SERVER_CHOICES.map((choice) => choice.url);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return QUEUE_SERVER_CHOICES.map((choice) => choice.url);
    return parsed.filter((url): url is string => typeof url === 'string' && allowed.has(url));
  } catch {
    return QUEUE_SERVER_CHOICES.map((choice) => choice.url);
  }
}

export function saveQueueServers(urls: string[]): void {
  try {
    localStorage.setItem(QUEUE_SERVERS_STORAGE_KEY, JSON.stringify(urls));
  } catch {
    // Ignore storage quota errors
  }
}

/** Live progress of a queue job, kept in memory only. */
export interface QueueItemLiveProgress {
  percent: number;
  text: string;
  serverUrl: string;
}
