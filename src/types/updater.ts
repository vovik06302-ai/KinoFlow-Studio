export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  size?: number | null;
  releaseUrl?: string | null;
  error?: string;
}

export interface UpdateProgressEvent {
  phase: 'downloading' | 'downloaded' | 'error' | 'cancelled';
  received?: number;
  total?: number | null;
  percent?: number;
  message?: string;
}

export interface ElectronUpdaterBridge {
  isElectron: boolean;
  getVersion: () => Promise<string>;
  checkForUpdate: () => Promise<UpdateInfo>;
  downloadUpdate: () => Promise<{ ok: boolean; error?: string }>;
  cancelDownload: () => Promise<{ cancelled: boolean }>;
  installUpdate: () => Promise<{ ok: boolean; error?: string }>;
  onProgress: (callback: (event: UpdateProgressEvent) => void) => () => void;
}

declare global {
  interface Window {
    kinoflowUpdater?: ElectronUpdaterBridge;
  }
  // Injected by Vite (`define`) from package.json "version".
  const __APP_VERSION__: string;
}
