import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceScenePrompt, parseEnhancePromptResponse } from './promptService';
import {
  buildEnhancePromptMessages,
  enhancePromptWithRetry,
  formatGeminiEnhanceError,
  isTransientGeminiError,
} from '../../serverPromptHelper';

test('parseEnhancePromptResponse returns trimmed enhancedPrompt on valid 200 JSON', async () => {
  const res = new Response(JSON.stringify({ enhancedPrompt: '  Slow dolly push in 35mm film.  ' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  const text = await parseEnhancePromptResponse(res);
  assert.equal(text, 'Slow dolly push in 35mm film.');
});

test('parseEnhancePromptResponse explains HTML 200 SPA fallback instead of opaque (200) error', async () => {
  const res = new Response('<!doctype html><html><body>KinoFlow Studio</body></html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
  await assert.rejects(
    () => parseEnhancePromptResponse(res),
    /HTML-страницу вместо JSON|server\.ts/,
  );
});

test('parseEnhancePromptResponse propagates backend JSON error message cleanly', async () => {
  const res = new Response(
    JSON.stringify({ error: 'Сервер Gemini временно перегружен (503).' }),
    {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    },
  );
  await assert.rejects(() => parseEnhancePromptResponse(res), /временно перегружен \(503\)/);
});

test('enhanceScenePrompt explains standalone Electron file:// limitation clearly', async () => {
  await assert.rejects(
    () =>
      enhanceScenePrompt(
        {
          prompt: 'Девушка идёт по набережной',
          model: 'Wan 2.2',
          characters: [],
          durationSec: 5,
          resolution: '832x480',
        },
        { pageProtocol: 'file:' },
      ),
    /автономном Windows-приложении/,
  );
});

test('enhancePromptWithRetry retries 503 UNAVAILABLE and falls back to secondary model', async () => {
  const calls: string[] = [];
  const messages = buildEnhancePromptMessages({
    prompt: 'Марина идёт по вечерней улице',
    characters: [{ name: 'Марина', weight: 0.8 }],
  });

  const enhanced = await enhancePromptWithRetry(
    {
      generateText: async ({ model }) => {
        calls.push(model);
        if (model === 'gemini-3.1-flash-lite') {
          throw new Error(
            '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}',
          );
        }
        return 'Handheld 35mm tracking shot of Марина walking down a rain-slicked avenue.';
      },
    },
    messages,
    {
      retryDelayMs: 1,
      sleep: async () => {},
    },
  );

  assert.deepEqual(calls, [
    'gemini-3.1-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-4-hydrogen',
  ]);
  assert.match(enhanced, /Марина/);
});

test('formatGeminiEnhanceError turns raw Gemini JSON 503/429/403 errors into clean Russian messages', () => {
  const overload = formatGeminiEnhanceError(
    new Error(
      '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}',
    ),
  );
  assert.equal(overload.status, 503);
  assert.match(overload.message, /временно перегружен/);
  assert.ok(!overload.message.includes('{'));

  const quota = formatGeminiEnhanceError(new Error('429 RESOURCE_EXHAUSTED'));
  assert.equal(quota.status, 429);
  assert.match(quota.message, /лимит запросов/);

  const missingKey = formatGeminiEnhanceError(
    new Error('GEMINI_API_KEY is not configured in the server environment.'),
  );
  assert.equal(missingKey.status, 500);
  assert.match(missingKey.message, /GEMINI_API_KEY/);

  assert.equal(isTransientGeminiError(new Error('503 UNAVAILABLE')), true);
  assert.equal(isTransientGeminiError(new Error('403 PERMISSION_DENIED')), false);
});
