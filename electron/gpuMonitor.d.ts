export declare const NVIDIA_SMI_QUERY_ARGS: string[];

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

export declare function resolveNvidiaSmiExecutable(options?: {
  platform?: string;
  fsImpl?: unknown;
}): string;

export declare function parseNvidiaSmiCsv(stdout: string): GpuUsageEntry[];

export declare function hasGpuSnapshotChanged(
  prev: GpuUsageSnapshot | null | undefined,
  next: GpuUsageSnapshot | null | undefined,
): boolean;

export declare function queryGpuUsage(options?: {
  execFileImpl?: unknown;
  platform?: string;
  fsImpl?: unknown;
  timeoutMs?: number;
}): Promise<GpuUsageSnapshot>;

export declare class GpuUsageMonitor {
  constructor(options?: {
    queryImpl?: () => Promise<GpuUsageSnapshot>;
    intervalMs?: number;
    minCacheMs?: number;
    nowImpl?: () => number;
    shouldPoll?: () => boolean;
  });
  getSnapshot(): GpuUsageSnapshot;
  subscribe(listener: (snapshot: GpuUsageSnapshot) => void): () => void;
  pollNow(options?: { force?: boolean }): Promise<GpuUsageSnapshot>;
  isRunning(): boolean;
  start(): void;
  stop(): void;
}
