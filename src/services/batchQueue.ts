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
