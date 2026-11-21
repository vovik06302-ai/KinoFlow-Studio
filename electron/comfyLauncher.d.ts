export declare const LAUNCH_SCRIPT_NAMES: string[];
export declare function buildComfyLaunchEnv(
  baseEnv?: Record<string, string | undefined>,
): Record<string, string | undefined>;
export declare function findLaunchScript(comfyDir: string, fsImpl?: unknown): string | null;
export declare function detectComfyDirectory(options?: {
  env?: Record<string, string | undefined>;
  homedir?: string;
  fsImpl?: unknown;
}): string | null;

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

export declare class ComfyLauncher {
  constructor(options?: {
    spawnImpl?: unknown;
    killImpl?: (child: unknown) => void;
    maxLogLines?: number;
    platform?: string;
    baseEnv?: Record<string, string | undefined>;
  });
  subscribe(listener: (event: LauncherEvent) => void): () => void;
  getState(): LauncherState;
  start(scriptPath: string | null): { ok: boolean; scriptPath?: string; error?: string };
  stop(): { ok: boolean; wasRunning: boolean };
}
