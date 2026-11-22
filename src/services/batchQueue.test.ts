import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearFinishedBatchItems,
  createBatchQueueItem,
  enqueueBatchItem,
  getNextPendingBatchItem,
  loadBatchQueue,
  loadQueueServers,
  saveQueueServers,
  removeBatchItem,
  saveBatchQueue,
  updateBatchItem,
} from './batchQueue';
import type { GenerationSettings } from '../types/video';

const sampleSettings: GenerationSettings = {
  serverUrl: 'http://127.0.0.1:8188',
  comfyDir: 'C:\\ComfyUI',
  mode: 't2v',
  modelId: 'auto',
  durationSec: 5,
  fps: 16,
  frames: 81,
  resolutionId: '832x480',
  width: 832,
  height: 480,
  steps: 28,
  seed: 42,
  seedLocked: false,
  upscale1080p: false,
  rifeEnabled: false,
  rifeTargetFps: 24,
  shootingStyle: 'arri-35mm',
};

test('batchQueue helpers enqueue, advance, update, remove, and clear finished items', () => {
  const first = createBatchQueueItem({
    prompt: '  Rainy street at night  ',
    negativePrompt: 'blurry',
    cameraPreset: 'push-in',
    lightingPreset: '',
    settings: sampleSettings,
  });
  const second = createBatchQueueItem({
    prompt: 'Sunny beach sunrise',
    negativePrompt: 'blurry',
    cameraPreset: 'none',
    lightingPreset: '',
    settings: { ...sampleSettings, fastLightX2V: true, steps: 6 },
  });

  let queue = enqueueBatchItem([], first);
  queue = enqueueBatchItem(queue, second);
  assert.equal(queue.length, 2);
  assert.equal(queue[0].prompt, 'Rainy street at night');
  assert.equal(getNextPendingBatchItem(queue)?.id, first.id);

  queue = updateBatchItem(queue, first.id, { status: 'completed', resultHistoryId: 'hist-1' });
  assert.equal(getNextPendingBatchItem(queue)?.id, second.id);

  const cleared = clearFinishedBatchItems(queue);
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0].id, second.id);

  const emptied = removeBatchItem(cleared, second.id);
  assert.equal(emptied.length, 0);
});

test('loadBatchQueue resets stale running items back to pending across reloads', () => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };

  try {
    const job = createBatchQueueItem({
      prompt: 'Interrupted scene',
      negativePrompt: '',
      cameraPreset: 'none',
      lightingPreset: '',
      settings: sampleSettings,
    });
    saveBatchQueue([{ ...job, status: 'running' }]);
    const restored = loadBatchQueue();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].status, 'pending');
  } finally {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  }
});

test('queue servers default to both ports, keep only known URLs and survive a reload', () => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  try {
    assert.deepEqual(loadQueueServers(), ['http://127.0.0.1:8188', 'http://127.0.0.1:8189']);
    saveQueueServers(['http://127.0.0.1:8189', 'http://evil.example:1']);
    assert.deepEqual(loadQueueServers(), ['http://127.0.0.1:8189']);
    saveQueueServers([]);
    assert.deepEqual(loadQueueServers(), [], 'an empty choice means: use the current server only');
  } finally {
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  }
});
