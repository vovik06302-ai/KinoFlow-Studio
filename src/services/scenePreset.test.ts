import test from 'node:test';
import assert from 'node:assert/strict';
import { exportScenePreset, parseScenePreset } from './scenePreset';
import type { GenerationSettings } from '../types/video';

const settings: GenerationSettings = {
  serverUrl: 'http://192.168.1.50:8188',
  comfyDir: 'C:\\Secret\\ComfyUI',
  mode: 't2v',
  modelId: 'wan22-t2v-a14b-q4',
  durationSec: 15,
  fps: 16,
  frames: 81,
  resolutionId: '1280x720',
  width: 1280,
  height: 720,
  steps: 24,
  seed: 777,
  seedLocked: true,
  upscale1080p: true,
  rifeEnabled: true,
  rifeTargetFps: 24,
  shootingStyle: 'night-neon',
};

test('exportScenePreset round-trips and never leaks server address, folders or seed', () => {
  const text = exportScenePreset({
    prompt: 'Marina on the quay',
    negativePrompt: 'blurry',
    cameraPreset: 'orbit',
    storyboardEnabled: true,
    storyboardShots: [
      { text: 'walks', camera: 'follow' },
      { text: 'turns', camera: 'none' },
      { text: 'smiles', camera: 'push-in' },
    ],
    settings,
  });
  assert.ok(!text.includes('192.168.1.50'));
  assert.ok(!text.includes('Secret'));
  assert.ok(!text.includes('777'));

  const preset = parseScenePreset(text);
  assert.equal(preset.prompt, 'Marina on the quay');
  assert.equal(preset.cameraPreset, 'orbit');
  assert.equal(preset.storyboardShots.length, 3);
  assert.equal(preset.storyboardShots[0].camera, 'follow');
  assert.equal(preset.settings.durationSec, 15);
  assert.equal(preset.settings.width, 1280);
  assert.equal(preset.settings.shootingStyle, 'night-neon');
  assert.equal(preset.settings.rifeEnabled, true);
});

test('parseScenePreset drops invalid fields, derives frames from fps and rejects foreign files', () => {
  const preset = parseScenePreset(
    JSON.stringify({
      format: 'kinoflow-scene-preset',
      version: 1,
      prompt: 5,
      cameraPreset: 'teleport',
      storyboardShots: [{ text: 'x', camera: 'nope' }, null],
      settings: { durationSec: 7, fps: 24, resolutionId: '832x480', steps: 9999, modelId: 'evil' },
    }),
  );
  assert.equal(preset.prompt, '');
  assert.equal(preset.cameraPreset, 'none');
  assert.deepEqual(preset.storyboardShots.map((s) => s.camera), ['none', 'none']);
  assert.equal(preset.settings.durationSec, undefined);
  assert.equal(preset.settings.steps, undefined);
  assert.equal(preset.settings.modelId, undefined);
  assert.equal(preset.settings.fps, 24);
  assert.equal(preset.settings.frames, 121, '5 s at 24 fps -> 121 frames');
  assert.equal(preset.settings.width, 832);

  assert.throws(() => parseScenePreset('not json'), /JSON/);
  assert.throws(() => parseScenePreset('{"hello":1}'), /не пресет/);
  assert.throws(
    () => parseScenePreset(JSON.stringify({ format: 'kinoflow-scene-preset', version: 99 })),
    /новой версии/,
  );
});
