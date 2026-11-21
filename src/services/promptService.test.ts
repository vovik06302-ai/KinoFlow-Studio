import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composeOfflineCinematicPrompt,
  containsCyrillic,
  enhancePromptViaLocalLlm,
  enhanceScenePrompt,
  enhanceScenePromptDetailed,
  parseEnhancePromptResponse,
  translatePromptToEnglishViaLocalLlm,
} from './promptService';
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

test('enhanceScenePromptDetailed works autonomously in Electron file:// and offlineMode via offline-composer', async () => {
  const result = await enhanceScenePromptDetailed(
    {
      prompt: 'Девушка идёт по набережной',
      model: 'Wan 2.2',
      characters: [{ name: 'Марина', weight: 0.8 }],
      durationSec: 5,
      resolution: '832x480',
      cameraMovement: 'slow smooth push-in',
      lightingPreset: 'warm golden hour sunlight',
      shootingStyleCue: 'Shot on ARRI Alexa 35',
    },
    { pageProtocol: 'file:' },
  );

  assert.equal(result.source, 'offline-composer');
  assert.match(result.enhancedPrompt, /Девушка идёт по набережной/);
  assert.match(result.enhancedPrompt, /Марина/);
  assert.match(result.enhancedPrompt, /slow smooth push-in/);
  assert.match(result.enhancedPrompt, /warm golden hour sunlight/);
  assert.match(result.enhancedPrompt, /ARRI Alexa 35/);

  const offlineDirect = await enhanceScenePrompt(
    {
      prompt: 'Ночной дождь на проспекте',
      model: 'Wan 2.2',
      characters: [],
      durationSec: 5,
      resolution: '832x480',
    },
    { offlineMode: true },
  );
  assert.match(offlineDirect, /Ночной дождь на проспекте/);
  assert.match(offlineDirect, /live-action cinema footage/);
});

test('composeOfflineCinematicPrompt avoids duplicating cues already present in the prompt', () => {
  const composed = composeOfflineCinematicPrompt({
    prompt: 'Марина идёт под дождём, slow smooth push-in',
    model: 'Wan 2.2',
    characters: [{ name: 'Марина', weight: 0.8 }],
    durationSec: 5,
    resolution: '832x480',
    cameraMovement: 'slow smooth push-in',
  });
  assert.equal(composed.match(/slow smooth push-in/g)?.length, 1);
  assert.equal(composed.includes('featuring Марина'), false);
});

test('enhancePromptViaLocalLlm supports Ollama /api/chat and OpenAI-compatible /v1/chat/completions', async () => {
  const calls: string[] = [];
  const ollamaFetch = (async (url: string) => {
    calls.push(url);
    return new Response(
      JSON.stringify({ message: { content: '"Rain falls on wet asphalt, slow dolly forward."' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;

  const ollamaResult = await enhancePromptViaLocalLlm(
    {
      prompt: 'Дождь на асфальте',
      model: 'Wan 2.2',
      characters: [],
      durationSec: 5,
      resolution: '832x480',
    },
    { url: 'http://127.0.0.1:11434', model: 'qwen2.5:7b', fetchImpl: ollamaFetch },
  );
  assert.equal(calls[0], 'http://127.0.0.1:11434/api/chat');
  assert.equal(ollamaResult, 'Rain falls on wet asphalt, slow dolly forward.');

  const lmStudioFetch = (async (url: string) => {
    calls.push(url);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: 'Handheld tracking shot at dusk.' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;

  const detailed = await enhanceScenePromptDetailed(
    {
      prompt: 'Улица на закате',
      model: 'Wan 2.2',
      characters: [],
      durationSec: 5,
      resolution: '832x480',
    },
    {
      offlineMode: true,
      localLlmUrl: 'http://127.0.0.1:1234',
      localLlmModel: 'local-model',
      fetchImpl: lmStudioFetch,
    },
  );
  assert.equal(calls[1], 'http://127.0.0.1:1234/v1/chat/completions');
  assert.equal(detailed.source, 'local-llm');
  assert.equal(detailed.enhancedPrompt, 'Handheld tracking shot at dusk.');
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

test('containsCyrillic and translatePromptToEnglishViaLocalLlm translate Russian prompts via Ollama/LM Studio', async () => {
  assert.equal(containsCyrillic('Ночной город в дожде'), true);
  assert.equal(containsCyrillic('Rainy night city street'), false);

  // Already English -> skips LLM call
  let called = false;
  const skipFetch = (async () => {
    called = true;
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  const skipped = await translatePromptToEnglishViaLocalLlm('A cat jumps on a sofa', {
    url: 'http://127.0.0.1:11434',
    fetchImpl: skipFetch,
  });
  assert.equal(skipped, 'A cat jumps on a sofa');
  assert.equal(called, false);

  const ollamaFetch = (async () =>
    new Response(
      JSON.stringify({ message: { content: 'A rainy neon street at night, slow dolly forward.' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as unknown as typeof fetch;

  const translated = await translatePromptToEnglishViaLocalLlm('Дождливая неоновая улица ночью', {
    url: 'http://127.0.0.1:11434',
    model: 'qwen2.5:7b',
    fetchImpl: ollamaFetch,
  });
  assert.equal(translated, 'A rainy neon street at night, slow dolly forward.');
});

