export declare const DEFAULT_INSTANCE_ID: string;
export declare const INSTANCE_IDS: string[];
export declare const DEFAULT_PORTABLE_FLAGS: string[];
export declare const LAUNCH_SCRIPT_NAMES: string[];
export declare const WIN_FLUSH_FIX_NODE_DIR: string;
export declare const WIN_FLUSH_FIX_PYTHON_SOURCE: string;

export declare function buildComfyLaunchEnv(
  baseEnv?: Record<string, string | undefined>,
): Record<string, string | undefined>;

export declare const FOREIGN_PYTHON_ENV_VARS: string[];
export declare function stripAnsi(text: string): string;
export declare function supportsDisableAssets(portableRoot: string | null, fsImpl?: unknown): boolean;
export declare function withDatabaseLockGuard(
  args: string[],
  portableRoot: string | null,
  fsImpl?: unknown,
): string[];
export declare function buildPortablePythonEnv(
  baseEnv?: Record<string, string | undefined>,
): Record<string, string | undefined>;

export declare function resolveComfyRootDir(comfyDirOrScript: string, fsImpl?: unknown): string | null;
export declare function findPortableRoot(comfyDir: string, fsImpl?: unknown): string | null;
export declare function stripGpuAndPortFlags(tokens: string[]): string[];
export declare function parseBatMainPyFlags(batContent: string | null | undefined): string[];
export declare function buildPortableLaunchArgs(options: {
  batContent?: string | null;
  flags?: string[] | null;
  gpuIndex: number;
  port: number;
}): string[];

export declare function validateInstanceLaunch(options: {
  instanceId?: string;
  gpuIndex: number;
  port: number;
  runningInstances?:
    | Map<string, { running?: boolean; child?: unknown; port?: number }>
    | Record<string, { running?: boolean; child?: unknown; port?: number }>;
}): { ok: boolean; error?: string };

export declare function readLogFileDelta(
  logPath: string | null,
  offset?: number,
  partial?: string,
  fsImpl?: unknown,
): { nextOffset: number; lines: string[]; nextPartial: string };

export declare function ensureWindowsFlushFixInstalled(
  comfyDirOrScript: string,
  fsImpl?: unknown,
): {
  ok: boolean;
  installed: boolean;
  updated?: boolean;
  path?: string;
  error?: string;
};

export declare function findLaunchScript(comfyDir: string, fsImpl?: unknown): string | null;
export declare function detectComfyDirectory(options?: {
  env?: Record<string, string | undefined>;
  homedir?: string;
  fsImpl?: unknown;
}): string | null;

export type LauncherEvent =
  | { type: 'log'; instanceId: string; line: string }
  | {
      type: 'started';
      instanceId: string;
      scriptPath: string;
      gpuIndex?: number;
      port?: number;
      logPath?: string;
    }
  | {
      type: 'exit';
      instanceId: string;
      code: number | null;
      uptimeMs?: number;
      lastLines?: string[];
    };

export interface LauncherState {
  instanceId: string;
  running: boolean;
  pid: number | null;
  scriptPath: string | null;
  gpuIndex: number;
  port: number;
  logPath: string | null;
  logs: string[];
}

export interface StartInstanceOptions {
  instanceId?: string;
  comfyDir: string;
  gpuIndex: number;
  port: number;
  logsDir?: string;
}

export interface StartInstanceResult {
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

export declare class ComfyLauncher {
  constructor(options?: {
    spawnImpl?: unknown;
    killImpl?: (child: unknown) => void;
    maxLogLines?: number;
    pollIntervalMs?: number;
    platform?: string;
    baseEnv?: Record<string, string | undefined>;
    fsImpl?: unknown;
    logsDir?: string | null;
    getLogsDir?: (() => string) | null;
  });
  subscribe(listener: (event: LauncherEvent) => void): () => void;
  getState(instanceId?: string): LauncherState;
  getAllStates(): Record<string, LauncherState>;
  pollInstanceLog(instanceId?: string, flushPartial?: boolean): string[];
  startInstance(options: StartInstanceOptions): StartInstanceResult;
  start(scriptPathOrOptions: string | null | StartInstanceOptions): StartInstanceResult;
  stop(instanceId?: string): { ok: boolean; wasRunning: boolean };
  stopAll(): { ok: boolean; stoppedIds: string[] };
}
