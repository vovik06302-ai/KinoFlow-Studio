export type ComfyInstanceId = '1' | '2';

export interface LauncherStartPayload {
  instanceId?: ComfyInstanceId | string;
  comfyDir: string;
  gpuIndex: number;
  port: number;
}

export interface LauncherStopPayload {
  instanceId?: ComfyInstanceId | string;
  all?: boolean;
}

export type LauncherEvent =
  | { type: 'log'; instanceId?: string; line: string }
  | {
      type: 'started';
      instanceId?: string;
      scriptPath: string;
      gpuIndex?: number;
      port?: number;
      logPath?: string;
    }
  | { type: 'exit'; instanceId?: string; code: number | null };

export interface LauncherState {
  instanceId?: string;
  running: boolean;
  pid: number | null;
  scriptPath: string | null;
  gpuIndex?: number;
  port?: number;
  logPath?: string | null;
  logs: string[];
}

export interface LauncherStartResult {
  ok: boolean;
  instanceId?: string;
  scriptPath?: string;
  command?: string;
  args?: string[];
  gpuIndex?: number;
  port?: number;
  logPath?: string;
  error?: string;
}

export interface GpuUsageEntry {
  index: number;
  utilizationPercent: number | null;
  vramUsedMb: number | null;
  vramTotalMb: number | null;
  vramUsagePercent: number | null;
  name: string;
}

export interface GpuUsageSnapshot {
  available: boolean;
  gpus: GpuUsageEntry[];
  updatedAt: string;
  error?: string;
}

export interface ElectronLauncherBridge {
  isElectron: boolean;
  getState: (instanceId?: string) => Promise<LauncherState>;
  getAllStates?: () => Promise<Record<string, LauncherState>>;
  detectDir?: () => Promise<{ comfyDir: string | null }>;
  start: (payload: string | LauncherStartPayload) => Promise<LauncherStartResult>;
  stop: (
    payload?: string | LauncherStopPayload,
  ) => Promise<{ ok: boolean; wasRunning: boolean; stoppedIds?: string[] }>;
  installFlushFix?: (comfyDir?: string) => Promise<{
    ok: boolean;
    installed: boolean;
    updated?: boolean;
    path?: string;
    error?: string;
  }>;
  restart?: (payload?: string | LauncherStartPayload) => Promise<{
    ok: boolean;
    patched: boolean;
    restarted: boolean;
    patchPath?: string;
    scriptPath?: string;
    error?: string;
  }>;
  getGpuUsage?: () => Promise<GpuUsageSnapshot>;
  onGpuUsage?: (callback: (snapshot: GpuUsageSnapshot) => void) => () => void;
  onEvent: (callback: (event: LauncherEvent) => void) => () => void;
}

declare global {
  interface Window {
    kinoflowLauncher?: ElectronLauncherBridge;
  }
}
