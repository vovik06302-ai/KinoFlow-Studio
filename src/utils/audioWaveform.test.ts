import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeWaveformPeaks,
  formatAudioTime,
  resolveSegmentAudioUrl,
} from './audioWaveform';
import type { GeneratedSegment, GenerationHistoryItem } from '../types/video';

const makeSegment = (index: number, audioUrl?: string): GeneratedSegment => ({
  index,
  mode: 't2v',
  startSec: (index - 1) * 5,
  endSec: index * 5,
  promptId: `seg-${index}`,
  videoUrl: `http://127.0.0.1:8188/view?filename=seg${index}.mp4`,
  filename: `seg${index}.mp4`,
  subfolder: '',
  fileType: 'output',
  seed: 100 + index,
  ...(audioUrl ? { audioUrl, hasAudio: true } : {}),
});

const makeHistoryItem = (
  segments?: GeneratedSegment[],
  audioUrl?: string,
): GenerationHistoryItem => ({
  id: 'hist-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  mode: 't2v',
  prompt: 'Rainy street',
  negativePrompt: '',
  modelId: 'auto',
  modelLabel: 'Wan 2.2',
  width: 832,
  height: 480,
  durationSec: 10,
  fps: 16,
  frames: 81,
  steps: 28,
  seed: 100,
  characters: [],
  videoUrl: 'http://127.0.0.1:8188/view?filename=seg1.mp4',
  filename: 'seg1.mp4',
  subfolder: '',
  fileType: 'output',
  serverUrl: 'http://127.0.0.1:8188',
  ...(segments ? { segments } : {}),
  ...(audioUrl ? { audioUrl, hasAudio: true } : {}),
});

test('resolveSegmentAudioUrl checks segment audioUrl strictly for multi-segment videos', () => {
  const seg1WithAudio = makeSegment(1, 'http://127.0.0.1:8188/view?filename=seg1.wav');
  const seg2Silent = makeSegment(2);
  const item = makeHistoryItem(
    [seg1WithAudio, seg2Silent],
    'http://127.0.0.1:8188/view?filename=seg1.wav',
  );

  assert.equal(
    resolveSegmentAudioUrl(seg1WithAudio, item),
    'http://127.0.0.1:8188/view?filename=seg1.wav',
  );
  assert.equal(resolveSegmentAudioUrl(seg2Silent, item), null);
});

test('resolveSegmentAudioUrl falls back to item audioUrl when no segments or single segment', () => {
  const legacyWithAudio = makeHistoryItem(undefined, 'http://127.0.0.1:8188/view?filename=legacy.mp3');
  assert.equal(
    resolveSegmentAudioUrl(null, legacyWithAudio),
    'http://127.0.0.1:8188/view?filename=legacy.mp3',
  );

  const singleSeg = makeSegment(1);
  const singleItem = makeHistoryItem([singleSeg], 'http://127.0.0.1:8188/view?filename=single.mp3');
  assert.equal(
    resolveSegmentAudioUrl(singleSeg, singleItem),
    'http://127.0.0.1:8188/view?filename=single.mp3',
  );

  assert.equal(resolveSegmentAudioUrl(null, makeHistoryItem()), null);
});

test('computeWaveformPeaks computes normalized peak bars from PCM samples', () => {
  assert.deepEqual(computeWaveformPeaks(new Float32Array(0), 16), []);

  const samples = new Float32Array([0.0, 0.25, -0.5, 0.25, 0.0, 1.0, -0.25, 0.5]);
  const peaks = computeWaveformPeaks(samples, 8);
  assert.equal(peaks.length, 8);
  assert.equal(peaks[5], 1);
  assert.equal(peaks[2], 0.5);
  assert.ok(peaks.every((p) => p >= 0.08 && p <= 1));

  const silent = computeWaveformPeaks(new Float32Array(32), 8);
  assert.deepEqual(silent, new Array(8).fill(0.12));
});

test('formatAudioTime formats seconds as M:SS cleanly', () => {
  assert.equal(formatAudioTime(0), '0:00');
  assert.equal(formatAudioTime(5.8), '0:05');
  assert.equal(formatAudioTime(65), '1:05');
  assert.equal(formatAudioTime(Number.NaN), '0:00');
  assert.equal(formatAudioTime(-3), '0:00');
});
