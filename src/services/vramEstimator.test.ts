import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateVramUsage } from './vramEstimator';

test('estimateVramUsage reports ok for Wan 2.2 5B on 12 GB GPU at 480p', () => {
  const res = estimateVramUsage({
    modelId: 'wan22-ti2v-5b-fp8',
    width: 832,
    height: 480,
    frames: 81,
    vramTotalGb: 12,
  });
  assert.equal(res.level, 'ok');
  assert.equal(res.safePatch, null);
  assert.ok(res.estimatedGb > 6 && res.estimatedGb < 9);
});

test('estimateVramUsage flags oom_risk on 8 GB GPU with 14B 720p + upscale and offers safePatch', () => {
  const res = estimateVramUsage({
    modelId: 'auto',
    width: 1280,
    height: 720,
    frames: 121,
    upscale1080p: true,
    rifeEnabled: true,
    vramTotalGb: 8,
  });
  assert.equal(res.level, 'oom_risk');
  assert.ok(res.safePatch);
  assert.equal(res.safePatch?.width, 832);
  assert.equal(res.safePatch?.height, 480);
  assert.equal(res.safePatch?.fps, 16);
  assert.equal(res.safePatch?.upscale1080p, false);
  assert.equal(res.safePatch?.modelId, 'wan22-ti2v-5b-fp8');
  assert.match(res.recommendation ?? '', /Out of Memory/);
});

test('estimateVramUsage recommends GGUF Q4_K_M on 12 GB GPU when auto 14B FP8 exceeds budget', () => {
  const res = estimateVramUsage({
    modelId: 'auto',
    width: 1280,
    height: 720,
    frames: 81,
    vramTotalGb: 12,
  });
  assert.equal(res.level, 'oom_risk');
  assert.equal(res.safePatch?.modelId, 'wan22-t2v-a14b-q4');
});
