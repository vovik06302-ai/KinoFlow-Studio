import fs from 'node:fs';
import { execFile } from 'node:child_process';

/**
 * Real-time per-GPU utilization and VRAM monitor powered by `nvidia-smi` (zero external dependencies).
 * Designed to avoid IPC flooding via:
 * - non-overlapping in-flight query deduplication,
 * - short TTL caching for on-demand reads (`minCacheMs`),
 * - change detection (`hasGpuSnapshotChanged`) so unchanged snapshots are not re-emitted over IPC,
 * - demand-driven polling (`start`/`stop` driven by active visible renderer watchers).
 * Never synthesizes or mocks metrics: when `nvidia-smi` is unavailable, returns `{ available: false, gpus: [] }`.
 */

export const NVIDIA_SMI_QUERY_ARGS = [
  '--query-gpu=index,utilization.gpu,memory.used,memory.total,name',
  '--format=csv,noheader,nounits',
];

const WINDOWS_NVIDIA_SMI_FALLBACKS = [
  'C:\\Windows\\System32\\nvidia-smi.exe',
  'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
];

/**
 * Resolves the `nvidia-smi` executable path.
 * Prefers known Windows driver paths when present, otherwise relies on PATH.
 */
export function resolveNvidiaSmiExecutable({ platform = process.platform, fsImpl = fs } = {}) {
  if (platform === 'win32') {
    for (const candidate of WINDOWS_NVIDIA_SMI_FALLBACKS) {
      try {
        if (fsImpl.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // try next location
      }
    }
    return 'nvidia-smi.exe';
  }
  return 'nvidia-smi';
}

function parseNonNegativeInt(raw) {
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const parsed = Math.round(Number(raw));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Pure CSV parser for:
 * `nvidia-smi --query-gpu=index,utilization.gpu,memory.used,memory.total,name --format=csv,noheader,nounits`
 */
export function parseNvidiaSmiCsv(stdout) {
  if (typeof stdout !== 'string' || !stdout.trim()) return [];

  const gpus = [];
  const lines = stdout.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Split on first 4 commas so GPU names containing commas stay intact
    const commaPositions = [];
    let searchFrom = 0;
    for (let k = 0; k < 4; k++) {
      const pos = line.indexOf(',', searchFrom);
      if (pos === -1) break;
      commaPositions.push(pos);
      searchFrom = pos + 1;
    }
    if (commaPositions.length < 4) continue;

    const rawIndex = line.slice(0, commaPositions[0]).trim();
    const rawUtil = line.slice(commaPositions[0] + 1, commaPositions[1]).trim();
    const rawMemUsed = line.slice(commaPositions[1] + 1, commaPositions[2]).trim();
    const rawMemTotal = line.slice(commaPositions[2] + 1, commaPositions[3]).trim();
    const rawName = line.slice(commaPositions[3] + 1).trim();

    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0) continue;

    const rawUtilInt = parseNonNegativeInt(rawUtil);
    const utilizationPercent =
      rawUtilInt !== null ? Math.max(0, Math.min(100, rawUtilInt)) : null;

    const vramUsedMb = parseNonNegativeInt(rawMemUsed);
    const vramTotalMb = parseNonNegativeInt(rawMemTotal);
    const vramUsagePercent =
      vramUsedMb !== null && vramTotalMb !== null && vramTotalMb > 0
        ? Math.max(0, Math.min(100, Math.round((vramUsedMb / vramTotalMb) * 100)))
        : null;

    gpus.push({
      index,
      utilizationPercent,
      vramUsedMb,
      vramTotalMb,
      vramUsagePercent,
      name: rawName,
    });
  }

  return gpus;
}

/**
 * Compares two GPU snapshots ignoring `updatedAt` timestamps so unchanged readings
 * do not flood Electron IPC channels.
 */
export function hasGpuSnapshotChanged(prev, next) {
  if (!prev || !next) return true;
  if (Boolean(prev.available) !== Boolean(next.available)) return true;
  const prevGpus = Array.isArray(prev.gpus) ? prev.gpus : [];
  const nextGpus = Array.isArray(next.gpus) ? next.gpus : [];
  if (prevGpus.length !== nextGpus.length) return true;

  for (let i = 0; i < nextGpus.length; i++) {
    const a = prevGpus[i];
    const b = nextGpus[i];
    if (
      a.index !== b.index ||
      a.utilizationPercent !== b.utilizationPercent ||
      a.vramUsedMb !== b.vramUsedMb ||
      a.vramTotalMb !== b.vramTotalMb ||
      a.vramUsagePercent !== b.vramUsagePercent ||
      a.name !== b.name
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Queries real GPU utilization and VRAM usage via `nvidia-smi` without a shell.
 */
export function queryGpuUsage({
  execFileImpl = execFile,
  platform = process.platform,
  fsImpl = fs,
  timeoutMs = 2500,
} = {}) {
  const executable = resolveNvidiaSmiExecutable({ platform, fsImpl });

  return new Promise((resolve) => {
    try {
      execFileImpl(
        executable,
        NVIDIA_SMI_QUERY_ARGS,
        {
          windowsHide: true,
          timeout: timeoutMs,
          maxBuffer: 256 * 1024,
        },
        (error, stdout) => {
          const updatedAt = new Date().toISOString();
          if (error) {
            resolve({
              available: false,
              gpus: [],
              updatedAt,
              error: String(error?.message ?? error),
            });
            return;
          }
          const gpus = parseNvidiaSmiCsv(String(stdout ?? ''));
          resolve({
            available: gpus.length > 0,
            gpus,
            updatedAt,
          });
        },
      );
    } catch (error) {
      resolve({
        available: false,
        gpus: [],
        updatedAt: new Date().toISOString(),
        error: String(error?.message ?? error),
      });
    }
  });
}

/**
 * Periodically polls `nvidia-smi` and emits updates to subscribers only when values change.
 * Guards against overlapping queries (`inFlight`) and bursts of on-demand reads (`minCacheMs`).
 */
export class GpuUsageMonitor {
  constructor({
    queryImpl = queryGpuUsage,
    intervalMs = 2500,
    minCacheMs = 1500,
    nowImpl = () => Date.now(),
    shouldPoll = () => true,
  } = {}) {
    this.queryImpl = queryImpl;
    this.intervalMs = intervalMs;
    this.minCacheMs = minCacheMs;
    this.nowImpl = nowImpl;
    this.shouldPoll = shouldPoll;
    this.listeners = new Set();
    this.timer = null;
    this.inFlight = null;
    this.hasPolledOnce = false;
    this.lastPolledAtMs = 0;
    this.lastSnapshot = {
      available: false,
      gpus: [],
      updatedAt: new Date(0).toISOString(),
    };
  }

  getSnapshot() {
    return {
      ...this.lastSnapshot,
      gpus: this.lastSnapshot.gpus.map((gpu) => ({ ...gpu })),
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(snapshot) {
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  async pollNow({ force = false } = {}) {
    if (this.inFlight) {
      return this.inFlight;
    }

    const now = this.nowImpl();
    if (!force && this.hasPolledOnce && now - this.lastPolledAtMs < this.minCacheMs) {
      return this.getSnapshot();
    }

    let queryPromise;
    try {
      queryPromise = Promise.resolve(this.queryImpl());
    } catch (error) {
      queryPromise = Promise.reject(error);
    }

    this.inFlight = queryPromise
      .then((snapshot) => {
        const changed = !this.hasPolledOnce || hasGpuSnapshotChanged(this.lastSnapshot, snapshot);
        this.hasPolledOnce = true;
        this.lastPolledAtMs = this.nowImpl();
        this.lastSnapshot = snapshot;
        const copy = this.getSnapshot();
        if (changed) {
          this.emit(copy);
        }
        return copy;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  isRunning() {
    return this.timer !== null;
  }

  start() {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      if (this.listeners.size === 0 || !this.shouldPoll()) return;
      void this.pollNow({ force: true });
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
