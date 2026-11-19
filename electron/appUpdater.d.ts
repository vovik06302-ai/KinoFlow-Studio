export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  reason?: 'no_installer';
  assetName?: string;
  assetUrl?: string;
  size?: number | null;
  releaseUrl?: string | null;
}

export interface UpdateProgressEvent {
  phase: 'downloading' | 'downloaded' | 'error' | 'cancelled';
  received?: number;
  total?: number | null;
  percent?: number;
  message?: string;
}

export declare const DEFAULT_UPDATE_REPO: string;
export declare function parseVersion(
  value: string,
): { major: number; minor: number; patch: number; pre: string } | null;
export declare function compareVersions(a: string, b: string): number;
export declare function pickInstallerAsset(
  assets: Array<{ name: string; browser_download_url: string; size?: number }>,
): { name: string; browser_download_url: string; size?: number } | null;
export declare function interpretRelease(release: unknown, currentVersion: string): UpdateInfo;
export declare function downloadToFile(options: {
  url: string;
  destPath: string;
  expectedSize?: number | null;
  signal?: AbortSignal;
  onProgress?: (progress: { received: number; total: number | null; percent: number }) => void;
  fetchImpl?: typeof fetch;
}): Promise<{ path: string; size: number }>;

export declare class UpdateManager {
  constructor(options: {
    repo?: string;
    currentVersion: string;
    tempDir: string;
    fetchImpl?: typeof fetch;
    apiBase?: string;
  });
  subscribe(listener: (event: UpdateProgressEvent) => void): () => void;
  check(): Promise<UpdateInfo>;
  download(): Promise<{ path: string }>;
  cancel(): { cancelled: boolean };
  install(spawnImpl?: unknown): { started: boolean };
}
