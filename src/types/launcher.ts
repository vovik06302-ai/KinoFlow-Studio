export type LauncherEvent =
  | { type: 'log'; line: string }
  | { type: 'started'; scriptPath: string }
  | { type: 'exit'; code: number | null };

export interface LauncherState {
  running: boolean;
  pid: number | null;
  scriptPath: string | null;
  logs: string[];
}

export interface ElectronLauncherBridge {
  isElectron: boolean;
  getState: () => Promise<LauncherState>;
  detectDir?: () => Promise<{ comfyDir: string | null }>;
  start: (comfyDir: string) => Promise<{ ok: boolean; scriptPath?: string; error?: string }>;
  stop: () => Promise<{ ok: boolean; wasRunning: boolean }>;
  onEvent: (callback: (event: LauncherEvent) => void) => () => void;
}

declare global {
  interface Window {
    kinoflowLauncher?: ElectronLauncherBridge;
  }
}
