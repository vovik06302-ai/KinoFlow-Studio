import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_AUTOSAVE_INTERVAL_MS,
  loadHistory,
  sanitizeHistoryItems,
  saveHistory,
  startHistoryAutoSave,
} from './historyStorage';
import type { GenerationHistoryItem } from '../types/video';

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

