import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WorkerUnavailableError,
  aggregateWorkerProgress,
  chooseQueueServers,
  describeQueueServer,
  runWorkerPool,
} from './batchScheduler';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeQueue(ids: string[]) {
  const status = new Map(ids.map((id) => [id, 'pending'] as const));
  const state = new Map<string, string>(status);
  return {
    state,
    pickNext: (claimed: ReadonlySet<string>) => {
      const id = ids.find((candidate) => state.get(candidate) === 'pending' && !claimed.has(candidate));
      return id ? { id } : null;
    },
  };
}

test('two workers split the queue: every job runs exactly once and both servers are used', async () => {
  const queue = makeQueue(['a', 'b', 'c', 'd', 'e']);
  const ranOn: Record<string, string> = {};
  let active = 0;
  let maxActive = 0;

  const result = await runWorkerPool({
    workers: ['8188', '8189'],
    pickNext: queue.pickNext,
    shouldStop: () => false,
    runJob: async (job, worker) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      ranOn[job.id] = worker;
      queue.state.set(job.id, 'running');
      await sleep(15);
      queue.state.set(job.id, 'completed');
      active -= 1;
    },
  });

  assert.deepEqual([...result.startedJobIds].sort(), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(maxActive, 2, 'two scenes render at the same time');
  assert.equal(new Set(Object.values(ranOn)).size, 2, 'both servers got work');
  assert.ok([...queue.state.values()].every((s) => s === 'completed'));
});

test('one server behaves like the old sequential queue', async () => {
  const queue = makeQueue(['a', 'b', 'c']);
  const order: string[] = [];
  let active = 0;
  let maxActive = 0;
  await runWorkerPool({
    workers: ['8188'],
    pickNext: queue.pickNext,
    shouldStop: () => false,
    runJob: async (job) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(job.id);
      queue.state.set(job.id, 'completed');
      await sleep(5);
      active -= 1;
    },
  });
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.equal(maxActive, 1);
});

test('a job failure does not stop the worker, but an unavailable server hands its job to the other one', async () => {
  const queue = makeQueue(['a', 'b', 'c']);
  const ranOn: Record<string, string> = {};
  const released: string[] = [];
  const retired: string[] = [];

  await runWorkerPool({
    workers: ['8188', '8189'],
    pickNext: queue.pickNext,
    shouldStop: () => false,
    onJobReleased: (job) => {
      released.push(job.id);
      queue.state.set(job.id, 'pending');
    },
    onWorkerRetired: (worker) => retired.push(worker),
    runJob: async (job, worker) => {
      queue.state.set(job.id, 'running');
      await sleep(5);
      if (worker === '8189') {
        throw new WorkerUnavailableError('нет ноды VHS_VideoCombine');
      }
      if (job.id === 'b') {
        queue.state.set(job.id, 'failed');
        throw new Error('ошибка самой сцены');
      }
      ranOn[job.id] = worker;
      queue.state.set(job.id, 'completed');
    },
  });

  assert.deepEqual(retired, ['8189']);
  assert.equal(released.length, 1);
  // Every job ends up finished or failed on the healthy server, none is left pending or lost.
  assert.ok([...queue.state.values()].every((s) => s === 'completed' || s === 'failed'));
  assert.equal(queue.state.get('b'), 'failed');
  assert.ok(Object.values(ranOn).every((worker) => worker === '8188'));
});

test('when every server is unavailable the jobs stay pending instead of being lost', async () => {
  const queue = makeQueue(['a', 'b']);
  const result = await runWorkerPool({
    workers: ['8188', '8189'],
    pickNext: queue.pickNext,
    shouldStop: () => false,
    onJobReleased: (job) => queue.state.set(job.id, 'pending'),
    runJob: async () => {
      throw new WorkerUnavailableError();
    },
  });
  assert.equal(result.retiredWorkers, 2);
  assert.deepEqual([...queue.state.values()], ['pending', 'pending']);
});

test('stopping the queue prevents new jobs from being taken', async () => {
  const queue = makeQueue(['a', 'b', 'c', 'd']);
  let stop = false;
  const started: string[] = [];
  await runWorkerPool({
    workers: ['8188', '8189'],
    pickNext: queue.pickNext,
    shouldStop: () => stop,
    runJob: async (job) => {
      started.push(job.id);
      queue.state.set(job.id, 'completed');
      stop = true;
      await sleep(5);
    },
  });
  assert.ok(started.length <= 2, 'only jobs that were already taken may finish');
  assert.ok(queue.state.get('d') === 'pending');
});

test('chooseQueueServers keeps the online servers in order and falls back to the current server', () => {
  const online = (url: string) => url !== 'http://127.0.0.1:8189';
  assert.deepEqual(
    chooseQueueServers(['http://127.0.0.1:8188/', 'http://127.0.0.1:8189', 'http://127.0.0.1:8188'], 'http://x', online),
    ['http://127.0.0.1:8188'],
  );
  assert.deepEqual(chooseQueueServers([], 'http://127.0.0.1:8188', online), ['http://127.0.0.1:8188']);
  assert.deepEqual(chooseQueueServers(['http://127.0.0.1:8189'], 'http://127.0.0.1:8188', online), []);
});

test('aggregateWorkerProgress averages several workers and passes a single worker through', () => {
  assert.deepEqual(
    aggregateWorkerProgress([{ label: 'порт 8188', progress: { percent: 40, message: 'сегмент 2' } }]),
    { percent: 40, message: 'сегмент 2' },
  );
  const both = aggregateWorkerProgress([
    { label: 'порт 8188', progress: { percent: 40, message: '' } },
    { label: 'порт 8189', progress: { percent: 61, message: '' } },
  ]);
  assert.equal(both.percent, 51);
  assert.match(both.message, /Параллельно на 2 видеокартах/);
  assert.match(both.message, /порт 8188: 40%/);
  assert.equal(describeQueueServer('http://127.0.0.1:8189'), 'порт 8189');
  assert.equal(describeQueueServer('http://192.168.1.5:8188'), '192.168.1.5:8188');
});
