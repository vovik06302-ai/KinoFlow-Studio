import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMERA_PRESETS,
  buildSegmentPrompt,
  countStoryboardSegments,
  resizeStoryboard,
} from './storyboard';

test('buildSegmentPrompt returns the base prompt untouched when there is no storyboard and no camera', () => {
  assert.equal(
    buildSegmentPrompt({ basePrompt: 'A man walks along a rainy quay', defaultCamera: 'none' }),
    'A man walks along a rainy quay',
  );
});

test('buildSegmentPrompt combines the scene, the segment action and the camera cue', () => {
  const prompt = buildSegmentPrompt({
    basePrompt: 'Marina in a red coat, rainy night, neon light',
    shot: { text: 'she opens the door and steps out', camera: 'push-in' },
    defaultCamera: 'static',
  });
  assert.match(prompt, /^Marina in a red coat, rainy night, neon light\. she opens the door and steps out\./);
  assert.match(prompt, /Camera: slow smooth push-in/);
  assert.ok(!prompt.includes('locked-off'), 'the shot camera wins over the default camera');
});

test('a shot without its own camera falls back to the default camera; empty shot keeps base prompt', () => {
  const withDefault = buildSegmentPrompt({
    basePrompt: 'Quay at dusk',
    shot: { text: 'a boat drifts by', camera: 'none' },
    defaultCamera: 'orbit',
  });
  assert.match(withDefault, /Camera: slow orbit shot/);

  const emptyShot = buildSegmentPrompt({
    basePrompt: 'Quay at dusk',
    shot: { text: '   ', camera: 'none' },
    defaultCamera: 'pan',
  });
  assert.equal(emptyShot, 'Quay at dusk. Camera: smooth horizontal pan from left to right.');
});

test('a camera cue is not added to an empty prompt', () => {
  assert.equal(buildSegmentPrompt({ basePrompt: '', defaultCamera: 'push-in' }), '');
});

test('resizeStoryboard keeps typed shots when the duration changes', () => {
  const shots = [
    { text: 'first', camera: 'pan' as const },
    { text: 'second', camera: 'none' as const },
  ];
  const grown = resizeStoryboard(shots, 4);
  assert.equal(grown.length, 4);
  assert.equal(grown[0].text, 'first');
  assert.equal(grown[3].text, '');
  assert.equal(resizeStoryboard(grown, 1).length, 1);
});

test('countStoryboardSegments matches 5 s chunks capped at 6 and every preset has a cue except none', () => {
  assert.equal(countStoryboardSegments(5), 1);
  assert.equal(countStoryboardSegments(10), 2);
  assert.equal(countStoryboardSegments(30), 6);
  for (const preset of CAMERA_PRESETS) {
    assert.equal(preset.cue === '', preset.id === 'none');
  }
});
