import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GpuUsageMonitor,
  NVIDIA_SMI_QUERY_ARGS,
  hasGpuSnapshotChanged,
  parseNvidiaSmiCsv,
  queryGpuUsage,
} from './gpuMonitor.js';

test('parseNvidiaSmiCsv parses dual NVIDIA RTX GPUs with utilization and VRAM usage, handling [N/A] safely', () => {
  const output = [
    '0, 84, 9842, 12282, NVIDIA GeForce RTX 4070 Ti',
    '1, 17, 1024, 12282, NVIDIA GeForce RTX 4070 Ti',
    '2, [N/A], [N/A], 8192, Virtual Display Adapter',
    'invalid line without enough commas',
    '',
  ].join('\r\n');

  assert.deepEqual(parseNvidiaSmiCsv(output), [
    {
      index: 0,
      utilizationPercent: 84,
      vramUsedMb: 9842,
      vramTotalMb: 12282,
      vramUsagePercent: 80,
      name: 'NVIDIA GeForce RTX 4070 Ti',
    },
    {
      index: 1,
      utilizationPercent: 17,
      vramUsedMb: 1024,
      vramTotalMb: 12282,
      vramUsagePercent: 8,
      name: 'NVIDIA GeForce RTX 4070 Ti',
    },
    {
      index: 2,
      utilizationPercent: null,
      vramUsedMb: null,
      vramTotalMb: 8192,
      vramUsagePercent: null,
      name: 'Virtual Display Adapter',
    },
  ]);

  assert.deepEqual(parseNvidiaSmiCsv(''), []);
});

test('queryGpuUsage executes nvidia-smi with windowsHide and returns real utilization + VRAM or unavailable on error', async () => {
  const calls: Array<{
    file: string;
    args: string[];
    options: { windowsHide?: boolean; timeout?: number };
  }> = [];

  const okResult = await queryGpuUsage({
    platform: 'linux',
    execFileImpl: (
      file: string,
      args: string[],
      options: { windowsHide?: boolean; timeout?: number },
      cb: (err: Error | null, stdout: string) => void,
    ) => {
      calls.push({ file, args, options });
      cb(
        null,
        '0, 62, 6144, 12288, NVIDIA GeForce RTX 4070 Ti\n1, 95, 11059, 12288, NVIDIA GeForce RTX 4070 Ti\n',
      );
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'nvidia-smi');
  assert.deepEqual(calls[0].args, NVIDIA_SMI_QUERY_ARGS);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(okResult.available, true);
  assert.equal(okResult.gpus.length, 2);
  assert.equal(okResult.gpus[0].utilizationPercent, 62);
  assert.equal(okResult.gpus[0].vramUsedMb, 6144);
  assert.equal(okResult.gpus[0].vramTotalMb, 12288);
  assert.equal(okResult.gpus[0].vramUsagePercent, 50);
  assert.equal(okResult.gpus[1].utilizationPercent, 95);
  assert.equal(okResult.gpus[1].vramUsagePercent, 90);

  const errResult = await queryGpuUsage({
    platform: 'linux',
    execFileImpl: (
      _file: string,
      _args: string[],
      _options: unknown,
      cb: (err: Error | null, stdout: string) => void,
    ) => {
      cb(new Error('ENOENT nvidia-smi'), '');
    },
  });

  assert.equal(errResult.available, false);
  assert.deepEqual(errResult.gpus, []);
  assert.match(errResult.error ?? '', /ENOENT/);
});

test('hasGpuSnapshotChanged ignores updatedAt timestamp and detects real load/VRAM deltas', () => {
  const base = {
    available: true,
    gpus: [
      {
        index: 0,
        utilizationPercent: 50,
        vramUsedMb: 4096,
        vramTotalMb: 12288,
        vramUsagePercent: 33,
        name: 'RTX 4070 Ti',
      },
    ],
    updatedAt: '2026-11-21T00:00:00.000Z',
  };

  const sameMetricsNewTimestamp = {
    ...base,
    gpus: [{ ...base.gpus[0] }],
    updatedAt: '2026-11-21T00:00:05.000Z',
  };
  assert.equal(hasGpuSnapshotChanged(base, sameMetricsNewTimestamp), false);

  const vramChanged = {
    ...base,
    gpus: [{ ...base.gpus[0], vramUsedMb: 5120, vramUsagePercent: 42 }],
    updatedAt: '2026-11-21T00:00:05.000Z',
  };
  assert.equal(hasGpuSnapshotChanged(base, vramChanged), true);
});

test('GpuUsageMonitor deduplicates overlapping polls, caches rapid reads, and skips unchanged IPC broadcasts', async () => {
  let queryCount = 0;
  let clockMs = 10_000;
  let currentUsage = 48;
  let currentVramMb = 4096;
  let resolvePending:
    | ((val: {
        available: boolean;
        gpus: Array<{
          index: number;
          utilizationPercent: number;
          vramUsedMb: number;
          vramTotalMb: number;
          vramUsagePercent: number;
          name: string;
        }>;
        updatedAt: string;
      }) => void)
    | null = null;

  const monitor = new GpuUsageMonitor({
    intervalMs: 60_000,
    minCacheMs: 1500,
    nowImpl: () => clockMs,
    queryImpl: () => {
      queryCount += 1;
      if (queryCount === 1) {
        return new Promise((resolve) => {
          resolvePending = resolve;
        });
      }
      return Promise.resolve({
        available: true,
        gpus: [
          {
            index: 0,
            utilizationPercent: currentUsage,
            vramUsedMb: currentVramMb,
            vramTotalMb: 12288,
            vramUsagePercent: Math.round((currentVramMb / 12288) * 100),
            name: 'RTX 4070 Ti',
          },
        ],
        updatedAt: new Date(clockMs).toISOString(),
      });
    },
  });

  const emitted: Array<{ util: number | null; vram: number | null }> = [];
  const unsubscribe = monitor.subscribe((snapshot) => {
    emitted.push({
      util: snapshot.gpus[0]?.utilizationPercent ?? null,
      vram: snapshot.gpus[0]?.vramUsedMb ?? null,
    });
  });

  // 1. Overlapping pollNow calls share a single in-flight query
  const p1 = monitor.pollNow();
  const p2 = monitor.pollNow();
  assert.equal(queryCount, 1);

  resolvePending!({
    available: true,
    gpus: [
      {
        index: 0,
        utilizationPercent: 48,
        vramUsedMb: 4096,
        vramTotalMb: 12288,
        vramUsagePercent: 33,
        name: 'RTX 4070 Ti',
      },
    ],
    updatedAt: new Date(clockMs).toISOString(),
  });
  await Promise.all([p1, p2]);
  assert.equal(emitted.length, 1);

  // 2. Rapid pollNow within minCacheMs returns cached snapshot without spawning nvidia-smi
  clockMs += 500;
  await monitor.pollNow();
  assert.equal(queryCount, 1);
  assert.equal(emitted.length, 1);

  // 3. Forced poll with identical values does NOT emit duplicate IPC update
  clockMs += 2000;
  await monitor.pollNow({ force: true });
  assert.equal(queryCount, 2);
  assert.equal(emitted.length, 1, 'unchanged metrics must not broadcast over IPC');

  // 4. Changed VRAM value triggers exactly one IPC update
  clockMs += 2000;
  currentVramMb = 8192;
  await monitor.pollNow({ force: true });
  assert.equal(queryCount, 3);
  assert.equal(emitted.length, 2);
  assert.deepEqual(emitted[1], { util: 48, vram: 8192 });

  unsubscribe();
  monitor.stop();
});
