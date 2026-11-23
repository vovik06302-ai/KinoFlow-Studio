import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFilmMergeAudioOptions,
  detectAudioFormatFromMime,
  generateExternalAudio,
  validateExternalAudioEndpoint,
} from './audioService';

test('validateExternalAudioEndpoint accepts http/https URLs and rejects invalid schemes', () => {
  assert.equal(
    validateExternalAudioEndpoint('https://audio.example.com/v1/generate'),
    'https://audio.example.com/v1/generate',
  );
  assert.equal(
    validateExternalAudioEndpoint('http://127.0.0.1:9000/audio'),
    'http://127.0.0.1:9000/audio',
  );
  assert.throws(() => validateExternalAudioEndpoint(''), /Укажите адрес/);
  assert.throws(() => validateExternalAudioEndpoint('file:///etc/passwd'), /http:\/\/ или https:\/\//);
  assert.throws(() => validateExternalAudioEndpoint('javascript:alert(1)'), /http:\/\/ или https:\/\//);
  assert.throws(() => validateExternalAudioEndpoint('https://bad host/audio'), /пробелы/);
});

test('detectAudioFormatFromMime maps mp3, wav, and ogg correctly', () => {
  assert.deepEqual(detectAudioFormatFromMime('audio/wav'), {
    mimeType: 'audio/wav',
    extension: 'wav',
  });
  assert.deepEqual(detectAudioFormatFromMime('audio/ogg; codecs=opus'), {
    mimeType: 'audio/ogg',
    extension: 'ogg',
  });
  assert.deepEqual(detectAudioFormatFromMime('audio/mpeg'), {
    mimeType: 'audio/mpeg',
    extension: 'mp3',
  });
});

test('generateExternalAudio sends Authorization Bearer header and decodes binary MP3/WAV responses', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const fakeWavBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00]);

  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(fakeWavBytes, {
      status: 200,
      headers: { 'content-type': 'audio/wav' },
    });
  }) as unknown as typeof fetch;

  const result = await generateExternalAudio({
    endpoint: 'https://audio.example.com/v1/sfx',
    apiKey: 'secret-token-123',
    prompt: 'rain and distant thunder',
    durationSec: 10,
    fetchImpl: mockFetch,
  });

  assert.equal(capturedUrl, 'https://audio.example.com/v1/sfx');
  assert.equal(capturedInit?.method, 'POST');
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer secret-token-123');
  const parsedBody = JSON.parse(String(capturedInit?.body)) as {
    prompt: string;
    duration: number;
  };
  assert.equal(parsedBody.prompt, 'rain and distant thunder');
  assert.equal(parsedBody.duration, 10);

  assert.equal(result.extension, 'wav');
  assert.equal(result.mimeType, 'audio/wav');
  assert.match(result.filename, /^kinoflow_sound_\d+\.wav$/);
  assert.equal(result.base64, Buffer.from(fakeWavBytes).toString('base64'));
});

test('generateExternalAudio parses JSON base64 responses and surfaces API errors', async () => {
  const sampleMp3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00]).toString('base64');
  const jsonFetch = (async () =>
    new Response(
      JSON.stringify({ audioBase64: sampleMp3, mimeType: 'audio/mpeg' }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    )) as unknown as typeof fetch;

  const res = await generateExternalAudio({
    endpoint: 'https://audio.example.com/v1/music',
    prompt: 'calm ambient piano',
    durationSec: 5,
    fetchImpl: jsonFetch,
  });
  assert.equal(res.extension, 'mp3');
  assert.equal(res.base64, sampleMp3);

  const errorFetch = (async () =>
    new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      generateExternalAudio({
        endpoint: 'https://audio.example.com/v1/music',
        prompt: 'calm ambient piano',
        durationSec: 5,
        fetchImpl: errorFetch,
      }),
    /HTTP 429.*Quota exceeded/,
  );
});

test('buildFilmMergeAudioOptions forwards audioPath and clamps 0–200% volume to 0.0–2.0', () => {
  assert.equal(buildFilmMergeAudioOptions(null, 100), undefined);
  assert.equal(buildFilmMergeAudioOptions({ path: '   ', name: 'empty.mp3' }, 100), undefined);

  assert.deepEqual(
    buildFilmMergeAudioOptions({ path: 'C:\\audio\\rain.mp3', name: 'rain.mp3' }, 150),
    { audioPath: 'C:\\audio\\rain.mp3', audioVolume: 1.5 },
  );
  assert.deepEqual(
    buildFilmMergeAudioOptions({ path: 'C:\\audio\\rain.mp3', name: 'rain.mp3' }, 0),
    { audioPath: 'C:\\audio\\rain.mp3', audioVolume: 0 },
  );
  assert.deepEqual(
    buildFilmMergeAudioOptions({ path: 'C:\\audio\\rain.mp3', name: 'rain.mp3' }, 350),
    { audioPath: 'C:\\audio\\rain.mp3', audioVolume: 2 },
  );
  assert.deepEqual(
    buildFilmMergeAudioOptions({ path: 'C:\\audio\\rain.mp3', name: 'rain.mp3' }, -40),
    { audioPath: 'C:\\audio\\rain.mp3', audioVolume: 0 },
  );
});
