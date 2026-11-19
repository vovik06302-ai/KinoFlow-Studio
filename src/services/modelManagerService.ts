import {
  DEFAULT_COMFY_DIR,
  REQUIRED_MODELS,
  formatBytes,
  formatEta,
  formatSpeed,
} from '../../electron/modelCatalog.js';
import type {
  ModelDownloadProgressEvent,
  ModelDownloadSnapshot,
  ModelScanResult,
} from '../types/models';

export { DEFAULT_COMFY_DIR, REQUIRED_MODELS, formatBytes, formatEta, formatSpeed };

export function isElectronModelBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.kinoflowModels?.isElectron);
}

export async function selectComfyDirectoryNative(): Promise<string | null> {
  if (window.kinoflowModels?.selectComfyDirectory) {
    return window.kinoflowModels.selectComfyDirectory();
  }
  return null;
}

export async function scanComfyModels(comfyDir: string): Promise<ModelScanResult> {
  if (window.kinoflowModels?.scanModels) {
    return window.kinoflowModels.scanModels(comfyDir);
  }

  const response = await fetch('/api/models/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comfyDir }),
  });

  const payload = (await response.json().catch(() => ({}))) as ModelScanResult & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || `Ошибка проверки папки моделей (HTTP ${response.status}).`);
  }

  return payload;
}

export async function startModelsDownload(
  comfyDir: string,
  modelIds?: string[],
): Promise<{ started: boolean; queue: string[] }> {
  if (window.kinoflowModels?.startDownload) {
    return window.kinoflowModels.startDownload(comfyDir, modelIds);
  }

  const response = await fetch('/api/models/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comfyDir, modelIds }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    started?: boolean;
    queue?: string[];
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || `Не удалось запустить загрузку (HTTP ${response.status}).`);
  }

  return {
    started: Boolean(payload.started),
    queue: Array.isArray(payload.queue) ? payload.queue : [],
  };
}

export async function cancelModelsDownload(modelId?: string): Promise<{ cancelled: boolean }> {
  if (window.kinoflowModels?.cancelDownload) {
    return window.kinoflowModels.cancelDownload(modelId);
  }

  const response = await fetch('/api/models/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId }),
  });

  if (!response.ok) {
    return { cancelled: false };
  }

  const data = (await response.json().catch(() => ({}))) as { cancelled?: boolean };
  return { cancelled: Boolean(data.cancelled) };
}

export async function getModelsDownloadState(): Promise<ModelDownloadSnapshot> {
  if (window.kinoflowModels?.getDownloadState) {
    return window.kinoflowModels.getDownloadState();
  }

  const response = await fetch('/api/models/state');
  if (!response.ok) {
    return { isRunning: false, currentModelId: null, active: [] };
  }
  return (await response.json()) as ModelDownloadSnapshot;
}

export async function openComfyFolderNative(targetPath: string): Promise<void> {
  if (window.kinoflowModels?.openFolder) {
    await window.kinoflowModels.openFolder(targetPath);
  }
}

export function subscribeToModelDownloadEvents(
  callback: (event: ModelDownloadProgressEvent) => void,
): () => void {
  if (window.kinoflowModels?.onProgress) {
    return window.kinoflowModels.onProgress(callback);
  }

  const source = new EventSource('/api/models/events');
  source.onmessage = (evt) => {
    try {
      const parsed = JSON.parse(evt.data) as ModelDownloadProgressEvent;
      callback(parsed);
    } catch {
      // Ignore malformed SSE chunks
    }
  };

  return () => {
    source.close();
  };
}
