import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHistoryItems } from './historyStorage';

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
