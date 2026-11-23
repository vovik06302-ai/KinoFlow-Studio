import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COMFY_INSTANCES_SETTINGS,
  HISTORY_AUTOSAVE_INTERVAL_MS,
  loadHistory,
  loadSavedSettings,
  normalizeComfyInstancesSettings,
  sanitizeHistoryItems,
  saveHistory,
  saveSettings,
  startHistoryAutoSave,
} from './historyStorage';
import type { GenerationHistoryItem, GenerationSettings } from '../types/video';

test('sanitizeHistoryItems normalizes legacy entries missing characters or numeric fields', () => {
  const result = sanitizeHistoryItems([
    {
      id: 'legacy-1',
      videoUrl: 'http://127.0.0.1:8188/view?filename=clip.mp4',
      prompt: 'Old clip',
      // Missing characters, width, height, fps, createdAt, mode, etc.
    },
    {
      id: 'legacy-2',
      videoUrl: 'http://127.0.0.1:8188/view?filename=clip2.mp4',
      characters: [{ name: 'Марина' }, null, { weight: 0.8 }],
      fps: 24,
      mode: 'i2v',
    },
    // Corrupted entries without required id/videoUrl should be dropped
    null,
    'broken',
    { id: 'missing-url' },
  ]);

  assert.equal(result.length, 2);
  assert.deepEqual(result[0].characters, []);
  assert.equal(result[0].width, 832);
  assert.equal(result[0].height, 480);
  assert.equal(result[0].fps, 16);
  assert.equal(result[0].mode, 't2v');

  assert.equal(result[1].characters.length, 2);
  assert.equal(result[1].characters[0].name, 'Марина');
  assert.equal(result[1].characters[0].weight, 0.75);
  assert.equal(result[1].characters[1].name, 'Персонаж 2');
  assert.equal(result[1].characters[1].weight, 0.8);
  assert.equal(result[1].fps, 24);
  assert.equal(result[1].mode, 'i2v');
});

test('sanitizeHistoryItems returns empty array for non-array values', () => {
  assert.deepEqual(sanitizeHistoryItems(null), []);
  assert.deepEqual(sanitizeHistoryItems({}), []);
  assert.deepEqual(sanitizeHistoryItems('bad'), []);
});

test('startHistoryAutoSave persists latest history every 30s, flushes on unload/pagehide, and cleans up cleanly', () => {
  assert.equal(HISTORY_AUTOSAVE_INTERVAL_MS, 30_000);

  let currentHistory: GenerationHistoryItem[] = [
    {
      id: 'gen-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      mode: 't2v',
      prompt: 'First scene',
      negativePrompt: '',
      modelId: 'auto',
      modelLabel: 'Wan 2.2',
      width: 832,
      height: 480,
      durationSec: 5,
      fps: 16,
      frames: 81,
      steps: 28,
      seed: 42,
      characters: [],
      videoUrl: 'http://127.0.0.1:8188/view?filename=gen-1.mp4',
      filename: 'gen-1.mp4',
      subfolder: '',
      fileType: 'output',
      serverUrl: 'http://127.0.0.1:8188',
    },
  ];

  const savedSnapshots: GenerationHistoryItem[][] = [];
  let registeredTick: (() => void) | null = null;
  let registeredDelay = 0;
  let clearedId: unknown = null;
  const fakeTimerId = { id: 'autosave-timer' } as unknown as ReturnType<typeof setInterval>;

  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const fakeWindow = {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      listeners.get(type)?.delete(listener);
    },
  };

  const stop = startHistoryAutoSave(() => currentHistory, {
    saveFn: (items) => savedSnapshots.push([...items]),
    setIntervalImpl: (handler, timeout) => {
      registeredTick = handler;
      registeredDelay = timeout;
      return fakeTimerId;
    },
    clearIntervalImpl: (id) => {
      clearedId = id;
    },
    windowTarget: fakeWindow,
  });

  assert.equal(registeredDelay, 30_000);
  assert.ok(registeredTick);
  assert.equal(listeners.get('beforeunload')?.size, 1);
  assert.equal(listeners.get('pagehide')?.size, 1);

  // First 30s tick saves initial history
  (registeredTick as () => void)();
  assert.equal(savedSnapshots.length, 1);
  assert.equal(savedSnapshots[0][0].id, 'gen-1');

  // Update history and trigger second 30s tick
  currentHistory = [
    { ...currentHistory[0], id: 'gen-2', prompt: 'Second scene' },
    ...currentHistory,
  ];
  (registeredTick as () => void)();
  assert.equal(savedSnapshots.length, 2);
  assert.equal(savedSnapshots[1].map((item) => item.id).join(','), 'gen-2,gen-1');

  // Trigger accidental browser close events
  for (const fn of listeners.get('beforeunload') ?? []) {
    (fn as () => void)();
  }
  for (const fn of listeners.get('pagehide') ?? []) {
    (fn as () => void)();
  }
  assert.equal(savedSnapshots.length, 4);

  // Cleanup clears interval and detaches unload listeners
  stop();
  assert.equal(clearedId, fakeTimerId);
  assert.equal(listeners.get('beforeunload')?.size, 0);
  assert.equal(listeners.get('pagehide')?.size, 0);
});

test('saveHistory and loadHistory round-trip via window.localStorage', () => {
  const store = new Map<string, string>();
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  };

  try {
    const sample: GenerationHistoryItem = {
      id: 'saved-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      mode: 'i2v',
      prompt: 'Harbor at dusk',
      negativePrompt: '',
      modelId: 'auto',
      modelLabel: 'Wan 2.2',
      width: 832,
      height: 480,
      durationSec: 5,
      fps: 16,
      frames: 81,
      steps: 28,
      seed: 99,
      characters: [{ name: 'Марина', weight: 0.75 }],
      videoUrl: 'http://127.0.0.1:8188/view?filename=harbor.mp4',
      filename: 'harbor.mp4',
      subfolder: '',
      fileType: 'output',
      serverUrl: 'http://127.0.0.1:8188',
    };

    saveHistory([sample]);
    const restored = loadHistory();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].id, 'saved-1');
    assert.equal(restored[0].prompt, 'Harbor at dusk');
    assert.equal(restored[0].characters[0].name, 'Марина');
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as unknown as { window?: unknown }).window;
    } else {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
  }
});

test('normalizeComfyInstancesSettings validates GPU index (0-7) and port (1024-65535) with safe defaults', () => {
  assert.deepEqual(normalizeComfyInstancesSettings(undefined), DEFAULT_COMFY_INSTANCES_SETTINGS);
  assert.deepEqual(
    normalizeComfyInstancesSettings({
      '1': { gpuIndex: 0, port: 8188 },
      '2': { gpuIndex: 3, port: 8190 },
    }),
    {
      '1': { gpuIndex: 0, port: 8188 },
      '2': { gpuIndex: 3, port: 8190 },
    },
  );
  // Invalid out-of-range values fall back to safe defaults
  assert.deepEqual(
    normalizeComfyInstancesSettings({
      '1': { gpuIndex: 9, port: 80 },
      '2': { gpuIndex: -1, port: 99999 },
    }),
    DEFAULT_COMFY_INSTANCES_SETTINGS,
  );
});

test('sanitizeHistoryItems preserves optional audio fields on items and segments while staying backward-compatible', () => {
  const result = sanitizeHistoryItems([
    {
      id: 'with-audio',
      videoUrl: 'http://127.0.0.1:8188/view?filename=rain.mp4',
      prompt: 'Rainy street',
      soundDescription: 'rain and thunder',
      hasAudio: true,
      audioUrl: 'http://127.0.0.1:8188/view?filename=rain.wav',
      segments: [
        {
          index: 1,
          mode: 't2v',
          startSec: 0,
          endSec: 5,
          promptId: 'seg-1',
          videoUrl: 'http://127.0.0.1:8188/view?filename=rain.mp4',
          filename: 'rain.mp4',
          subfolder: '',
          fileType: 'output',
          seed: 42,
          hasAudio: true,
          audioUrl: 'http://127.0.0.1:8188/view?filename=rain.wav',
        },
      ],
    },
    {
      id: 'legacy-no-audio',
      videoUrl: 'http://127.0.0.1:8188/view?filename=silent.mp4',
      prompt: 'Silent clip',
    },
  ]);

  assert.equal(result.length, 2);
  assert.equal(result[0].hasAudio, true);
  assert.equal(result[0].soundDescription, 'rain and thunder');
  assert.equal(result[0].audioUrl, 'http://127.0.0.1:8188/view?filename=rain.wav');
  assert.equal(result[0].segments?.[0].hasAudio, true);
  assert.equal(result[0].segments?.[0].audioUrl, 'http://127.0.0.1:8188/view?filename=rain.wav');

  assert.equal(result[1].hasAudio, undefined);
  assert.equal(result[1].audioUrl, undefined);
  assert.equal(result[1].soundDescription, undefined);
});

test('saveSettings never persists audioApiKey to localStorage', () => {
  const store = new Map<string, string>();
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  };

  try {
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
      soundDescription: 'ocean waves',
      generateAudio: true,
      audioStrategy: 'external-api',
      audioApiEndpoint: 'https://audio.example.com/generate',
      audioApiKey: 'super-secret-key',
    };

    saveSettings(sampleSettings);
    const rawStored = [...store.values()].join('\n');
    assert.ok(!rawStored.includes('super-secret-key'), 'audioApiKey must never be stored in localStorage');

    const restored = loadSavedSettings();
    assert.equal(restored?.soundDescription, 'ocean waves');
    assert.equal(restored?.audioApiEndpoint, 'https://audio.example.com/generate');
    assert.equal(restored?.audioApiKey, undefined);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as unknown as { window?: unknown }).window;
    } else {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
  }
});
