import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDownloadFilename,
  resolveHistoryItemDownload,
  triggerVideoDownload,
} from './videoDownload';
import type { GenerationHistoryItem } from '../types/video';

const sampleHistoryItem: GenerationHistoryItem = {
  id: 'hist-42',
  createdAt: '2026-01-01T12:00:00.000Z',
  mode: 't2v',
  prompt: 'Neon street in the rain',
  negativePrompt: '',
  modelId: 'auto',
  modelLabel: 'Wan 2.2',
  width: 832,
  height: 480,
  durationSec: 10,
  fps: 16,
  frames: 81,
  steps: 28,
  seed: 1001,
  characters: [],
  videoUrl: 'http://127.0.0.1:8188/view?filename=scene_final.mp4&type=output',
  filename: 'scene_final.mp4',
  subfolder: '',
  fileType: 'output',
  serverUrl: 'http://127.0.0.1:8188',
  segments: [
    {
      index: 1,
      mode: 't2v',
      startSec: 0,
      endSec: 5,
      promptId: 'seg-1',
      videoUrl: 'http://127.0.0.1:8188/view?filename=seg1.mp4&type=output',
      filename: 'seg1',
      subfolder: '',
      fileType: 'output',
      seed: 1001,
    },
    {
      index: 2,
      mode: 'i2v',
      startSec: 5,
      endSec: 10,
      promptId: 'seg-2',
      videoUrl: 'http://127.0.0.1:8188/view?filename=seg2.webm&type=output',
      filename: 'seg2.webm',
      subfolder: '',
      fileType: 'output',
      seed: 1002,
    },
  ],
};

test('normalizeDownloadFilename ensures safe filename with video extension', () => {
  assert.equal(normalizeDownloadFilename('clip.mp4'), 'clip.mp4');
  assert.equal(normalizeDownloadFilename('clip.webm'), 'clip.webm');
  assert.equal(normalizeDownloadFilename('my render (1)'), 'my_render_1.mp4');
  assert.equal(normalizeDownloadFilename('C:\\renders\\shot_01'), 'shot_01.mp4');
  assert.equal(normalizeDownloadFilename('', 'abc-123'), 'kinoflow_abc-123.mp4');
  assert.equal(normalizeDownloadFilename(''), 'kinoflow_video.mp4');
});

test('resolveHistoryItemDownload extracts URL and normalized filename from history item or segment', () => {
  assert.deepEqual(resolveHistoryItemDownload(sampleHistoryItem), {
    url: 'http://127.0.0.1:8188/view?filename=scene_final.mp4&type=output',
    filename: 'scene_final.mp4',
  });
  assert.deepEqual(resolveHistoryItemDownload(sampleHistoryItem, 0), {
    url: 'http://127.0.0.1:8188/view?filename=seg1.mp4&type=output',
    filename: 'seg1.mp4',
  });
  assert.deepEqual(resolveHistoryItemDownload(sampleHistoryItem, 1), {
    url: 'http://127.0.0.1:8188/view?filename=seg2.webm&type=output',
    filename: 'seg2.webm',
  });
  assert.equal(resolveHistoryItemDownload({ ...sampleHistoryItem, videoUrl: '', segments: [] }), null);
  assert.equal(resolveHistoryItemDownload(null), null);
});

test('triggerVideoDownload uses CORS blob when available and falls back to direct URL on network error', async () => {
  const clicks: Array<{ href: string; download: string }> = [];
  const revoked: string[] = [];

  const mode1 = await triggerVideoDownload(
    'http://127.0.0.1:8188/view?filename=clip.mp4',
    'clip',
    {
      fetchImpl: (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as unknown as typeof fetch,
      createObjectURL: () => 'blob:mock-video-1',
      revokeObjectURL: (u) => revoked.push(u),
      clickLink: (href, download) => clicks.push({ href, download }),
      scheduleRevoke: (fn) => fn(),
    },
  );
  assert.equal(mode1, 'blob');
  assert.deepEqual(clicks[0], { href: 'blob:mock-video-1', download: 'clip.mp4' });
  assert.deepEqual(revoked, ['blob:mock-video-1']);

  const mode2 = await triggerVideoDownload(
    'http://127.0.0.1:8188/view?filename=fallback.mp4',
    'fallback.mp4',
    {
      fetchImpl: (async () => {
        throw new TypeError('CORS blocked');
      }) as unknown as typeof fetch,
      clickLink: (href, download) => clicks.push({ href, download }),
    },
  );
  assert.equal(mode2, 'direct');
  assert.deepEqual(clicks[1], {
    href: 'http://127.0.0.1:8188/view?filename=fallback.mp4',
    download: 'fallback.mp4',
  });
});
