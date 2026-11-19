export type ModelFileStatus =
  | 'installed'
  | 'missing'
  | 'partial'
  | 'size_mismatch'
  | 'queued'
  | 'downloading'
  | 'error';

export interface RequiredModelDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  filename: string;
  targetSubfolder: string;
  repoId: string;
  downloadUrl: string;
  expectedSizeBytes: number;
}

export interface ScannedModelItem extends RequiredModelDefinition {
  status: 'installed' | 'missing' | 'partial' | 'size_mismatch';
  existingSizeBytes: number | null;
  partialSizeBytes: number;
  targetPath: string;
}

export interface ModelScanResult {
  comfyDir: string;
  directoryExists: boolean;
  models: ScannedModelItem[];
}

export interface ModelDownloadProgressEvent {
  type: 'model-progress' | 'queue-finished';
  modelId?: string;
  state?: 'queued' | 'downloading' | 'installed' | 'cancelled' | 'error';
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  speedBytesPerSec?: number;
  etaSec?: number | null;
  resumedFromBytes?: number;
  error?: string;
  message?: string;
}

export interface ModelDownloadSnapshot {
  isRunning: boolean;
  currentModelId: string | null;
  active: ModelDownloadProgressEvent[];
}

export interface ElectronModelsBridge {
  isElectron: boolean;
  selectComfyDirectory: () => Promise<string | null>;
  scanModels: (comfyDir: string) => Promise<ModelScanResult>;
  startDownload: (
    comfyDir: string,
    modelIds?: string[],
  ) => Promise<{ started: boolean; queue: string[] }>;
  cancelDownload: (modelId?: string) => Promise<{ cancelled: boolean }>;
  getDownloadState: () => Promise<ModelDownloadSnapshot>;
  openFolder: (targetPath: string) => Promise<void>;
  onProgress: (callback: (event: ModelDownloadProgressEvent) => void) => () => void;
}

declare global {
  interface Window {
    kinoflowModels?: ElectronModelsBridge;
  }
}
